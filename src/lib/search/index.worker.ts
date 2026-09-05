/**
 * 検索インデックス構築の Web Worker。
 *
 * kuromoji の分かち書き + flexsearch の index 構築は重く、メインスレッドで回すと
 * その間 UI（進捗バー）が固まる。この重い処理を Worker に逃がし、進捗を postMessage で
 * 逐次メインに返すことで、取り込み中も UI が応答し続けるようにする。
 *
 * Worker には DOM/window が無いので、kuromoji の辞書は self（同一オリジン）から /dict を読む。
 */

import { Document } from "flexsearch";
import type { Tokenizer, IpadicFeatures } from "kuromoji";
import type { SearchDoc } from "./types";
import { SEARCH_KINDS, prefixedChunkKey } from "./indexer";

/** メイン → Worker: 構築要求 */
export interface BuildRequest {
  type: "build";
  docs: SearchDoc[];
}

/** Worker → メイン: 進捗 */
export interface ProgressMessage {
  type: "progress";
  done: number;
  total: number;
}

/** Worker → メイン: 完了（チャンク配列） */
export interface DoneMessage {
  type: "done";
  chunks: { chunkKey: string; data: string }[];
}

/** Worker → メイン: エラー */
export interface ErrorMessage {
  type: "error";
  message: string;
}

export type WorkerOutMessage = ProgressMessage | DoneMessage | ErrorMessage;

// --- 索引ロジック（indexer.ts と同じ方針。Worker 内で自己完結させる） ---

interface IndexableDoc extends Record<string, string | number> {
  id: string;
  kind: string;
  issueId: number;
  keyId: number;
  /** Wiki ヒットの遷移先 wiki.id（数値）。Wiki 以外は 0 */
  wikiId: number;
  /** ドキュメントヒットの遷移先 document.id（文字列）。ドキュメント以外は空文字 */
  documentId: string;
  title: string;
  body: string;
  displayTitle: string;
  snippet: string;
}

const SKIP_POS = /助詞|助動詞|記号|フィラー|接続詞/;
const MEANINGFUL = /[0-9a-z぀-ゟ゠-ヿ一-鿿０-９Ａ-Ｚａ-ｚ]/;

function tokenize(tk: Tokenizer<IpadicFeatures>, text: string): string[] {
  if (!text) return [];
  return tk
    .tokenize(text)
    .filter((t) => !SKIP_POS.test(t.pos))
    .map((t) =>
      t.basic_form && t.basic_form !== "*" ? t.basic_form : t.surface_form,
    )
    .map((w) => w.toLowerCase())
    .filter((w) => MEANINGFUL.test(w));
}

function makeSnippet(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function createIndex(): Document<IndexableDoc, false, false> {
  return new Document<IndexableDoc, false, false>({
    document: {
      id: "id",
      index: ["title", "body"],
      store: [
        "kind",
        "issueId",
        "keyId",
        "wikiId",
        "documentId",
        "displayTitle",
        "snippet",
      ],
    },
    encoder: { normalize: false, split: /\s+/ },
    tokenize: "forward",
  });
}

let tokenizerPromise: Promise<Tokenizer<IpadicFeatures>> | undefined;
function getWorkerTokenizer(): Promise<Tokenizer<IpadicFeatures>> {
  if (!tokenizerPromise) {
    tokenizerPromise = (async () => {
      const kuromoji = (await import("kuromoji")).default;
      return new Promise<Tokenizer<IpadicFeatures>>((resolve, reject) => {
        // Worker からも同一オリジンの /dict を読める
        kuromoji.builder({ dicPath: "/dict" }).build((err, tk) => {
          if (err) reject(err);
          else resolve(tk);
        });
      });
    })();
  }
  return tokenizerPromise;
}

/**
 * kind ごとに独立したインデックスを構築する（indexer.ts の SEARCH_KINDS コメント参照。
 * flexsearch の tag 検索が非 DB 構成では実質使えないため、カテゴリ単位でインデックスを分離する）。
 */
async function build(docs: SearchDoc[]): Promise<DoneMessage["chunks"]> {
  const tk = await getWorkerTokenizer();
  const total = docs.length;
  let done = 0;

  const chunks: DoneMessage["chunks"] = [];
  for (const kind of SEARCH_KINDS) {
    const kindDocs = docs.filter((d) => d.kind === kind);
    const index = createIndex();
    for (const d of kindDocs) {
      const indexTitle =
        d.kind === "comment" ? "" : tokenize(tk, d.title).join(" ");
      index.add({
        id: d.id,
        kind: d.kind,
        issueId: d.issueId,
        keyId: d.keyId,
        wikiId: d.wikiId ?? 0,
        documentId: d.documentId ?? "",
        title: indexTitle,
        body: tokenize(tk, d.body).join(" "),
        displayTitle: d.title,
        snippet: makeSnippet(d.body),
      });
      done++;
      if (done % 500 === 0 || done === total) {
        const msg: ProgressMessage = { type: "progress", done, total };
        self.postMessage(msg);
      }
    }

    await index.export((key, data) => {
      if (data == null) return;
      const str = typeof data === "string" ? data : JSON.stringify(data);
      chunks.push({ chunkKey: prefixedChunkKey(kind, String(key)), data: str });
    });
  }
  const msg: ProgressMessage = { type: "progress", done: total, total };
  self.postMessage(msg);
  return chunks;
}

self.onmessage = async (e: MessageEvent<BuildRequest>) => {
  if (e.data?.type !== "build") return;
  try {
    const chunks = await build(e.data.docs);
    const msg: DoneMessage = { type: "done", chunks };
    self.postMessage(msg);
  } catch (err) {
    const msg: ErrorMessage = {
      type: "error",
      message:
        err instanceof Error
          ? err.message
          : "検索インデックスの構築に失敗しました",
    };
    self.postMessage(msg);
  }
};
