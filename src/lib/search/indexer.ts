"use client";

/**
 * 全文検索インデックスの構築と export（取り込み時に 1 回だけ）。
 *
 * 設計（PoC で実証）: 読み取り専用アーカイブ＝データ不変なので、kuromoji の分かち書き +
 * flexsearch index 構築は取り込み時に一度行い、export して searchIndex ストアに保存する。
 * 閲覧時は import で復元するだけ（高速）。
 *
 * flexsearch の encoder は v0.8 では「encode 関数」を型で受けられないため、kuromoji の
 * 分かち書き結果を空白連結した文字列を投入し、flexsearch 側は空白区切り（split: /\s+/）に
 * 限定する。これで形態素解析の精度を保ちつつ型に完全準拠する。
 */

import { Document } from "flexsearch";
import type { SearchDoc, SearchKind } from "./types";
import { getTokenizer, tokenize } from "./tokenizer";

/**
 * 索引を kind（課題/コメント/Wiki/ドキュメント）ごとに分けて持つための種別一覧。
 *
 * flexsearch の tag オプションでカテゴリ絞り込みを試みたが、非 DB（メモリ内）構成では
 * search() の内部実装が tag 指定時に limit を 0 に固定してしまい、その 0 が「無制限」ではなく
 * 既定の上限（実測で 100 件）にフォールバックするため、100 件を超えてヒットするクエリでは
 * 少数派カテゴリ（Wiki・ドキュメント）が多数派（課題・コメント）に埋もれて欠落するバグを確認した
 * （flexsearch 0.8.212 の既知の挙動。呼び出し側の limit 指定では回避不可）。
 * そのため kind ごとに独立したインデックスを持ち、カテゴリ単位で検索する設計にした。
 */
export const SEARCH_KINDS: SearchKind[] = [
  "issue",
  "comment",
  "wiki",
  "document",
];

/**
 * flexsearch に投入する形。
 * - title / body: 索引用。kuromoji で分かち書き済みの空白区切り文字列（検索のためだけに使う）
 * - displayTitle: 表示用。元の課題 summary（分かち書きしない生テキスト）。store にこちらを保存する
 */
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
  /** 結果一覧に出す本文の冒頭（生テキスト・分かち書きしない） */
  snippet: string;
}

/** スニペット用に本文の冒頭を切り出す（改行は空白に潰す） */
function makeSnippet(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * 検索インデックスを生成する。
 *
 * encoder: 既に空白で分かち済みなので normalize を切り split を空白のみに。
 * store: 検索結果の表示に必要なフィールドだけ保持（本文全体は持たない）。
 */
export function createIndex(): Document<IndexableDoc, false, false> {
  return new Document<IndexableDoc, false, false>({
    document: {
      id: "id",
      // 索引は分かち書き済みの title/body。表示用は store に displayTitle（生テキスト）を保存
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
    encoder: {
      normalize: false,
      split: /\s+/,
    },
    tokenize: "forward",
  });
}

/** 1 つのチャンク（export の key/data ペア）。searchIndex ストアへ保存する単位 */
export interface IndexChunk {
  chunkKey: string;
  data: string;
}

/**
 * flexsearch の export キーに kind プレフィックスを付けて、kind ごとのインデックスを
 * 同じ searchIndex ストア内で衝突なく区別できるようにする（例 "wiki::title.1.map"）。
 */
export function prefixedChunkKey(kind: SearchKind, rawKey: string): string {
  return `${kind}::${rawKey}`;
}

/** prefixedChunkKey で付けたプレフィックスを外し、生の flexsearch キーに戻す */
export function stripChunkKeyPrefix(
  kind: SearchKind,
  chunkKey: string,
): string {
  const prefix = `${kind}::`;
  return chunkKey.startsWith(prefix) ? chunkKey.slice(prefix.length) : chunkKey;
}

/**
 * SearchDoc 群を kind ごとに分けてそれぞれ独立したインデックスを構築し、export したチャンク配列を返す。
 *
 * SearchDoc.title / body は「未分かち書きの生テキスト」を渡す前提。ここで kuromoji 分かち書きして
 * 空白連結する（取り込み時の重い処理はここに集約。検索時は分かち書きしたクエリを投げるだけ）。
 *
 * kind ごとに Document を分ける理由は SEARCH_KINDS のコメント参照（flexsearch の tag 検索が
 * 非 DB 構成では実質使えないため、インデックス自体をカテゴリ単位で分離する）。
 */
export async function buildIndexChunks(
  docs: SearchDoc[],
  onProgress?: (done: number, total: number) => void,
): Promise<IndexChunk[]> {
  const tk = await getTokenizer();
  const total = docs.length;
  let done = 0;

  const chunks: IndexChunk[] = [];
  for (const kind of SEARCH_KINDS) {
    const kindDocs = docs.filter((d) => d.kind === kind);
    const index = createIndex();
    for (const d of kindDocs) {
      // コメントの title（親課題 summary）は索引しない。索引すると「親課題タイトルに語が
      // 含まれるだけで本文に無いコメント」が全部ヒットしてしまうため。コメントは body のみ索引する。
      // 課題・Wiki・ドキュメントは title を索引する（タイトル検索が有用）。
      // 親課題 summary は表示用の displayTitle として保持する（一覧で課題名を見せるため）。
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
      if (done % 500 === 0 || done === total) onProgress?.(done, total);
    }

    await index.export((key, data) => {
      if (data == null) return;
      const str = typeof data === "string" ? data : JSON.stringify(data);
      chunks.push({ chunkKey: prefixedChunkKey(kind, String(key)), data: str });
    });
  }
  onProgress?.(total, total);
  return chunks;
}
