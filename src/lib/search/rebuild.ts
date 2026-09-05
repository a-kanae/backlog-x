"use client";

/**
 * 課題・コメント・Wiki・ドキュメントから全文検索インデックスを再構築して searchIndex ストアに保存する。
 *
 * SearchDoc: 課題 id=`i:${id}`/body=description、コメント id=`c:${id}`/body=content、
 * Wiki id=`w:${id}`/body=content、ドキュメント id=`d:${id}`/body=plain。
 * コメントの title は親課題の summary を引いて持たせる（結果を課題に紐づけて表示するため）。
 *
 * 全 kind を 1 回でまとめて索引する（searchIndex は projectId 単位で clear→put のため、
 * 複数回に分けて呼ぶと前段の結果が消える。必ず全 docs を集めてから 1 回だけ呼ぶこと）。
 * buildIndexChunks 内で kuromoji 分かち書き（重い処理）が走る。
 *
 * API 取り込み（seed.ts）とファイルインポート（projectArchive.ts）の両方から使う共通処理。
 * 戻り値は索引したドキュメント数。
 */

import type { SearchDoc } from "./types";
import type {
  StoredIssue,
  StoredComment,
  StoredWiki,
  StoredDocument,
  SearchIndexBlob,
} from "@/types/entities";
import { buildIndexChunksInWorker } from "./buildIndexInWorker";
import { putSearchIndex, clearSearchIndex } from "@/lib/db/repositories";

export interface RebuildSearchInput {
  issues: StoredIssue[];
  comments: StoredComment[];
  wikis: StoredWiki[];
  documents: StoredDocument[];
}

export type RebuildProgressCallback = (done: number, total: number) => void;

export async function rebuildSearchIndex(
  projectId: number,
  input: RebuildSearchInput,
  onProgress?: RebuildProgressCallback,
): Promise<number> {
  const { issues, comments, wikis, documents } = input;

  const summaryByIssueId = new Map<
    number,
    { keyId: number; summary: string }
  >();
  for (const issue of issues) {
    summaryByIssueId.set(issue.id, {
      keyId: issue.keyId,
      summary: issue.summary,
    });
  }

  const docs: SearchDoc[] = [];
  for (const issue of issues) {
    docs.push({
      id: `i:${issue.id}`,
      projectId,
      kind: "issue",
      issueId: issue.id,
      keyId: issue.keyId,
      title: issue.summary,
      // normalize で空文字化しているが、旧バージョンで取り込んだ既存データには null が
      // 残っていることがあるので、索引側でも潰しておく（落とすより空で索引する方が安全）。
      body: issue.description ?? "",
    });
  }
  for (const c of comments) {
    if (!c.content || c.content.trim() === "") continue; // 本文の無いコメントは索引しない
    const parent = summaryByIssueId.get(c.issueId);
    docs.push({
      id: `c:${c.id}`,
      projectId,
      kind: "comment",
      issueId: c.issueId,
      keyId: parent?.keyId ?? 0,
      title: parent?.summary ?? "",
      body: c.content,
    });
  }
  for (const w of wikis) {
    docs.push({
      id: `w:${w.id}`,
      projectId,
      kind: "wiki",
      issueId: 0,
      keyId: 0,
      wikiId: w.id,
      title: w.name,
      // normalize で空文字化しているが、旧バージョンで取り込んだ既存データには null が
      // 残っていることがあるので索引側でも潰す（issue.description と同じ理由）。
      body: w.content ?? "",
    });
  }
  for (const d of documents) {
    docs.push({
      id: `d:${d.id}`,
      projectId,
      kind: "document",
      issueId: 0,
      keyId: 0,
      documentId: d.id,
      title: d.title,
      body: d.plain,
    });
  }

  const chunks = await buildIndexChunksInWorker(docs, onProgress);

  // 旧インデックスを消してから保存（再構築で重複しないように）
  await clearSearchIndex(projectId);
  const blobs: SearchIndexBlob[] = chunks.map((chunk) => ({
    key: `${projectId}:${chunk.chunkKey}`,
    projectId,
    chunkKey: chunk.chunkKey,
    data: chunk.data,
  }));
  await putSearchIndex(blobs);
  return docs.length;
}
