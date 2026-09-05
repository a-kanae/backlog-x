"use client";

/**
 * 全文検索の実行（閲覧時）。
 *
 * searchIndex ストアに保存済みのチャンクを import で復元し（PoC 実測 ~56ms）、
 * クエリを kuromoji で分かち書きして検索する。インデックスはプロジェクト単位でキャッシュし、
 * 2 回目以降の検索は import を省く。
 */

import { Document } from "flexsearch";
import type { SearchHit, SearchKind } from "./types";
import type { NamedColorMaster, SearchIndexBlob } from "@/types/entities";
import { createIndex, SEARCH_KINDS, stripChunkKeyPrefix } from "./indexer";
import { getTokenizer, tokenizeByPhrase } from "./tokenizer";
import {
  getSearchIndexByProject,
  getIssueById,
  getCommentById,
  getWikiById,
  getDocumentById,
} from "@/lib/db/repositories";

type IndexableDoc = Record<string, string | number> & {
  id: string;
  kind: string;
  issueId: number;
  keyId: number;
  /** Wiki ヒットの遷移先 wiki.id（数値）。Wiki 以外は 0 */
  wikiId: number;
  /** ドキュメントヒットの遷移先 document.id（文字列）。ドキュメント以外は空文字 */
  documentId: string;
  /** store に保存される表示用の元タイトル（分かち書きしていない） */
  displayTitle: string;
  /** 結果一覧に出す本文の冒頭 */
  snippet: string;
};

/**
 * kind ごとに独立したインデックスを持つ（SEARCH_KINDS のコメント参照）。
 * キーは `${projectId}:${kind}`。プロジェクト×kind ごとに復元済みインデックスをキャッシュし、
 * 2 回目以降の検索は import を省く。
 */
const indexCache = new Map<
  string,
  Promise<Document<IndexableDoc, false, false> | null>
>();

function cacheKey(projectId: number, kind: SearchKind): string {
  return `${projectId}:${kind}`;
}

/**
 * 保存済みチャンクから kind 単位のインデックスを import で復元する。
 * chunkKey は `${kind}::${rawKey}` 形式なので、対象 kind のチャンクだけを取り出し、
 * プレフィックスを外して import する。対象チャンクが無ければ null（そのカテゴリは未索引）。
 */
async function loadIndex(
  projectId: number,
  kind: SearchKind,
): Promise<Document<IndexableDoc, false, false> | null> {
  const blobs: SearchIndexBlob[] = await getSearchIndexByProject(projectId);
  const prefix = `${kind}::`;
  const mine = blobs.filter((b) => b.chunkKey.startsWith(prefix));
  if (mine.length === 0) return null;
  const index = createIndex();
  for (const blob of mine) {
    // v0.8 の import は (key, data)。key は export 時の chunkKey（プレフィックス除去後）と一致させる。
    index.import(stripChunkKeyPrefix(kind, blob.chunkKey), blob.data);
  }
  return index as unknown as Document<IndexableDoc, false, false>;
}

function getIndex(
  projectId: number,
  kind: SearchKind,
): Promise<Document<IndexableDoc, false, false> | null> {
  const key = cacheKey(projectId, kind);
  let cached = indexCache.get(key);
  if (!cached) {
    cached = loadIndex(projectId, kind);
    indexCache.set(key, cached);
  }
  return cached;
}

/** プロジェクトのインデックスキャッシュを破棄（再取り込み後に呼ぶ） */
export function invalidateSearchIndex(projectId: number): void {
  for (const kind of SEARCH_KINDS) {
    indexCache.delete(cacheKey(projectId, kind));
  }
}

/**
 * 候補ドキュメントの元データを引き、後がけ検証用の検索対象テキスト（小文字）と、
 * 並び替え用の更新日時（updated・ISO 文字列）を取り出す。課題ヒットのみステータスも返す。
 *
 * コメントヒットはコメント自身の updated を使う（親課題ではなく）。テキスト・日付とも
 * ここで一度の DB アクセスから取るので、検証とソートで元データを二度引かずに済む。
 */
async function loadDocMeta(
  projectId: number,
  hit: SearchHit,
): Promise<{
  text: string;
  updated: string | null;
  status?: NamedColorMaster;
}> {
  if (hit.kind === "comment" && hit.id.startsWith("c:")) {
    const c = await getCommentById(Number(hit.id.slice(2)));
    if (!c || c.projectId !== projectId) return { text: "", updated: null };
    return {
      text: (c.content ?? "").toLowerCase(),
      updated: c.updated ?? null,
    };
  }
  if (hit.kind === "issue" && hit.id.startsWith("i:")) {
    const issue = await getIssueById(Number(hit.id.slice(2)));
    if (!issue || issue.projectId !== projectId)
      return { text: "", updated: null };
    return {
      text: `${issue.summary}\n${issue.description}`.toLowerCase(),
      updated: issue.updated ?? null,
      status: issue.status,
    };
  }
  if (hit.kind === "wiki" && hit.id.startsWith("w:")) {
    const w = await getWikiById(Number(hit.id.slice(2)));
    if (!w || w.projectId !== projectId) return { text: "", updated: null };
    return {
      text: `${w.name}\n${w.content}`.toLowerCase(),
      updated: w.updated ?? null,
    };
  }
  if (hit.kind === "document" && hit.id.startsWith("d:")) {
    const d = await getDocumentById(hit.id.slice(2));
    if (!d || d.projectId !== projectId) return { text: "", updated: null };
    return {
      text: `${d.title}\n${d.plain}`.toLowerCase(),
      updated: d.updated ?? null,
    };
  }
  return { text: "", updated: null };
}

/**
 * 1 つのフレーズ（スペース無しで続けて入力された語のまとまり）のトークンが、本文中で
 * 隣り合って（連続して）出現するかを判定する。
 *
 * 例えば「うちわ発注」は tokenize すると ["うちわ", "発注"] になるが、ユーザーはこれを
 * 「うちわ発注」というひと続きの言葉として入力している。そのため本文中でも「うちわ」の
 * 直後に「発注」が続く（活用等での若干のずれは許容しない、厳密な連接）場合のみ一致とみなす。
 * 1 トークンのフレーズはそのまま `includes` と同義（隣接判定の必要が無い）。
 */
function hasContiguousPhrase(text: string, phraseTokens: string[]): boolean {
  if (phraseTokens.length === 0) return true;
  if (phraseTokens.length === 1) return text.includes(phraseTokens[0]);

  const joined = phraseTokens.join("");
  return text.includes(joined);
}

/**
 * クエリの全フレーズが、本文の一定範囲内に近接して出現するか判定する。
 *
 * ユーザーがスペースで区切って複数語を入力した場合（例 "うちわ 発注"）は、各語が本文の
 * どこにあってもよい単純な AND を期待する一方、位置を完全に無視すると、例えば「うちわ発注」
 * を１フレーズとして入力したときにも、本文中の全く無関係な箇所にある「うちわ」と「発注」
 * だけで誤ヒットしてしまう（実例: 数百〜千文字離れた別々のリンク項目にそれぞれの語がある
 * だけの Wiki ページがヒットした）。フレーズ内は hasContiguousPhrase で厳密な連接一致を
 * 要求しつつ、フレーズ同士は一定範囲内の近接（AND よりは厳しく、完全な連接よりは緩い）を
 * 要求することで、両方の入力パターンの意図を区別する。
 */
const PROXIMITY_WINDOW = 100;

function hasProximityMatch(text: string, phraseGroups: string[][]): boolean {
  if (phraseGroups.length === 0) return true;
  if (!phraseGroups.every((tokens) => hasContiguousPhrase(text, tokens)))
    return false;
  if (phraseGroups.length === 1) return true;

  // フレーズごとに「連接した語順どおりの」出現位置をすべて集める。
  const positionsList = phraseGroups.map((tokens) => {
    const needle = tokens.length === 1 ? tokens[0] : tokens.join("");
    const positions: number[] = [];
    let idx = text.indexOf(needle);
    while (idx !== -1) {
      positions.push(idx);
      idx = text.indexOf(needle, idx + 1);
    }
    return positions;
  });
  if (positionsList.some((positions) => positions.length === 0)) return false;

  // 全フレーズの出現位置を 1 つの配列にまとめ、どのフレーズの出現かも記録してソート。
  const events = positionsList
    .flatMap((positions, groupIndex) =>
      positions.map((pos) => ({ pos, groupIndex })),
    )
    .sort((a, b) => a.pos - b.pos);

  // スライディングウィンドウ: 窓内に全フレーズが最低 1 回ずつ含まれるかを尺取り法で判定。
  const countByGroup = new Array(phraseGroups.length).fill(0);
  let distinctInWindow = 0;
  let left = 0;
  for (let right = 0; right < events.length; right++) {
    if (countByGroup[events[right].groupIndex]++ === 0) distinctInWindow++;
    while (events[right].pos - events[left].pos > PROXIMITY_WINDOW) {
      if (--countByGroup[events[left].groupIndex] === 0) distinctInWindow--;
      left++;
    }
    if (distinctInWindow === phraseGroups.length) return true;
  }
  return false;
}

/**
 * 更新日時（ISO 文字列）の降順で並べ替える比較関数。
 * updated が無い（null）ものは末尾に回す。新しい順（本家 Backlog の sort=UPDATED と同じ）。
 */
function byUpdatedDesc(a: SearchHit, b: SearchHit): number {
  // ISO 8601 文字列は辞書順比較がそのまま日時比較になる。null は最小扱い（末尾へ）。
  const av = a.updated ?? "";
  const bv = b.updated ?? "";
  if (av === bv) return 0;
  return av < bv ? 1 : -1;
}

/**
 * 単一 kind のインデックスだけを検索し、後がけ検証まで済ませた SearchHit を返す。
 * カテゴリ（kind）ごとに独立したインデックスを検索するので、他カテゴリのヒット数に
 * 関わらずそのカテゴリの limit 件を確保できる（多数派カテゴリに押し出されない）。
 */
async function searchKind(
  projectId: number,
  kind: SearchKind,
  phraseGroups: string[][],
  q: string,
  limit: number,
): Promise<SearchHit[]> {
  const index = await getIndex(projectId, kind);
  if (!index) return [];

  // 後がけ検証で減るぶんを見込み、候補は多めに取る
  const candidateLimit = limit * 4;
  const results = index.search(q, { limit: candidateLimit, enrich: true });

  // 複数フィールド（title/body）の結果をマージし、同一ドキュメントを重複排除する
  const seen = new Map<string, SearchHit>();
  for (const field of results) {
    for (const hit of field.result) {
      const doc = hit.doc;
      if (!doc) continue;
      const id = String(hit.id);
      if (seen.has(id)) continue;
      seen.set(id, {
        id,
        kind,
        issueId: doc.issueId,
        keyId: doc.keyId,
        wikiId: doc.wikiId ? Number(doc.wikiId) : undefined,
        documentId: doc.documentId ? String(doc.documentId) : undefined,
        summary: doc.displayTitle,
        snippet: doc.snippet ?? "",
        // updated は後がけ検証で元データを引くとき（loadDocMeta）に埋める。
        updated: null,
      });
    }
  }

  const candidates = [...seen.values()];

  // 検証用フレーズグループ（小文字）。全フレーズが条件を満たす候補だけ残す。
  const needleGroups = phraseGroups.map((tokens) =>
    tokens.map((t) => t.toLowerCase()),
  );
  if (needleGroups.length === 0) return candidates.slice(0, limit);

  // 後がけ検証: 各候補の元データを引き、全フレーズが条件（フレーズ内は連接、フレーズ間は
  // 一定範囲内の近接）を満たすものだけ残す（hasProximityMatch 参照。無関係な箇所にある
  // 語の組み合わせによる誤ヒットを除去する）。併せて並び替え用の updated も同じ DB
  // アクセスから拾う（loadDocMeta）。ここで limit 件そろった時点で打ち切る（このカテゴリの
  // 中だけで打ち切るので、他カテゴリを押し出す・押し出されることがない）。
  const verified: SearchHit[] = [];
  for (const hit of candidates) {
    const { text, updated, status } = await loadDocMeta(projectId, hit);
    if (hasProximityMatch(text, needleGroups)) {
      hit.updated = updated;
      hit.status = status;
      verified.push(hit);
      if (verified.length >= limit) break;
    }
  }
  return verified;
}

/**
 * プロジェクト内を全文検索する。クエリを kuromoji 分かち書きして投げ、結果を SearchHit に解決。
 * インデックス未構築（チャンクなし）の場合は空配列。
 *
 * 精度対策（フレーズ近接 後がけ検証）: クエリはスペースで「フレーズ」に区切り、フレーズごとに
 * kuromoji で分かち書きする（tokenizeByPhrase）。スペース無しで続けて入力された語
 * （例 "うちわ発注"）は、本文中でも同じ語順で連接している場合のみ一致とみなし、スペースで
 * 区切って入力された複数語（例 "うちわ 発注"）は各フレーズが本文のどこにあってもよい
 * ゆるい近接（一定範囲内）で一致とみなす（hasProximityMatch 参照）。これにより、単純な
 * AND だけでは起きる「本文中の全く離れた箇所にある語の組み合わせによる誤ヒット」を防ぎつつ、
 * スペース区切りで複数キーワードを指定する使い方も引き続きサポートする。
 *
 * カテゴリ絞り込み（kinds）: kind ごとに独立したインデックスを持つ設計（indexer.ts の
 * SEARCH_KINDS コメント参照）なので、kinds に指定された各カテゴリを個別に検索し、
 * それぞれで limit 件を確保してからまとめて updated 降順にソートする。呼び出し側が
 * 画面のカテゴリタブ（課題・Wiki・ドキュメント）に応じた kinds を渡す想定。
 */
export async function searchProject(
  projectId: number,
  query: string,
  limit = 30,
  kinds: SearchKind[] = SEARCH_KINDS,
): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const tk = await getTokenizer();
  const phraseGroups = tokenizeByPhrase(tk, trimmed);
  const allTokens = phraseGroups.flat();
  const q = allTokens.length > 0 ? allTokens.join(" ") : trimmed;

  const perKind = await Promise.all(
    kinds.map((kind) => searchKind(projectId, kind, phraseGroups, q, limit)),
  );
  const merged = perKind.flat();
  merged.sort(byUpdatedDesc);
  return merged;
}
