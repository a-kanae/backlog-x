/**
 * IndexedDB の低レベル read/write。DataSource（読み）と ingest（書き）が使う。
 *
 * 大量投入はトランザクションを 1 本に詰めすぎると固まる/失敗するため、BATCH_SIZE ごとに
 * トランザクションを区切る（tx.done を待ってから次バッチ）。
 */

"use client";

import type { StoreNames } from "idb";
import { getDB } from "./open";
import type { BacklogXDB, MasterEntry } from "./schema";
import type {
  StoredIssue,
  StoredComment,
  StoredUser,
  StoredUserIcon,
  StoredProjectIcon,
  StoredProjectMember,
  StoredWiki,
  WikiHeading,
  StoredDocument,
  AttachmentMeta,
  ProjectMeta,
  SearchIndexBlob,
} from "@/types/entities";

/** 1 トランザクションあたりの投入件数。大きすぎると長時間トランザクションで固まる */
const BATCH_SIZE = 500;

/** 進捗コールバック（投入済み件数 / 総件数） */
export type ProgressCallback = (done: number, total: number) => void;

/** 任意のストアへバッチ分割で bulk put する汎用関数 */
async function bulkPut<N extends StoreNames<BacklogXDB>>(
  storeName: N,
  items: BacklogXDB[N]["value"][],
  onProgress?: ProgressCallback,
): Promise<void> {
  const db = await getDB();
  const total = items.length;
  let done = 0;
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const tx = db.transaction(storeName, "readwrite");
    await Promise.all([...batch.map((item) => tx.store.put(item)), tx.done]);
    done += batch.length;
    onProgress?.(done, total);
  }
}

export function putIssues(
  items: StoredIssue[],
  onProgress?: ProgressCallback,
): Promise<void> {
  return bulkPut("issues", items, onProgress);
}

export function putComments(
  items: StoredComment[],
  onProgress?: ProgressCallback,
): Promise<void> {
  return bulkPut("comments", items, onProgress);
}

export function putAttachmentMeta(
  items: AttachmentMeta[],
  onProgress?: ProgressCallback,
): Promise<void> {
  return bulkPut("attachmentMeta", items, onProgress);
}

export function putUsers(items: StoredUser[]): Promise<void> {
  return bulkPut("users", items);
}

export function putUserIcons(items: StoredUserIcon[]): Promise<void> {
  return bulkPut("userIcons", items);
}

/** 全ユーザーを取得（メンション @ユーザー名 の照合などに使う） */
export async function getAllUsers(): Promise<StoredUser[]> {
  const db = await getDB();
  return db.getAll("users");
}

/** ユーザーアイコンの Blob を取得（なければ undefined）。表示時に Object URL 化して使う */
export async function getUserIcon(
  userId: number,
): Promise<StoredUserIcon | undefined> {
  const db = await getDB();
  return db.get("userIcons", userId);
}

/** プロジェクトアイコンを保存（projectId で 1 枚。再取り込みで上書き） */
export async function putProjectIcon(icon: StoredProjectIcon): Promise<void> {
  const db = await getDB();
  await db.put("projectIcons", icon);
}

/** プロジェクトアイコンの Blob を取得（なければ undefined）。表示時に Object URL 化して使う */
export async function getProjectIcon(
  projectId: number,
): Promise<StoredProjectIcon | undefined> {
  const db = await getDB();
  return db.get("projectIcons", projectId);
}

/**
 * プロジェクトのメンバー（参加者 + roleType）を保存する。
 * projectMembers は out-of-line key（`${projectId}:${userId}`）なので put(store, value, key) で入れる。
 * 再取り込み・再インポートで抜けたメンバーが残らないよう、対象プロジェクト分を先にクリアしてから入れ直す。
 */
export async function putProjectMembers(
  projectId: number,
  members: StoredProjectMember[],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("projectMembers", "readwrite");
  // 既存の同プロジェクト分をクリア（by-project インデックスでカーソル削除）
  const index = tx.store.index("by-project");
  let cursor = await index.openCursor(IDBKeyRange.only(projectId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  for (const m of members) {
    await tx.store.put(m, `${m.projectId}:${m.userId}`);
  }
  await tx.done;
}

/** プロジェクトのメンバー（参加者 + roleType）を取得する（エクスポート用） */
export async function getProjectMembersByProject(
  projectId: number,
): Promise<StoredProjectMember[]> {
  const db = await getDB();
  return db.getAllFromIndex("projectMembers", "by-project", projectId);
}

export function putSearchIndex(items: SearchIndexBlob[]): Promise<void> {
  return bulkPut("searchIndex", items);
}

/** プロジェクトの検索インデックスチャンクを取得（import で復元する） */
export async function getSearchIndexByProject(
  projectId: number,
): Promise<SearchIndexBlob[]> {
  const db = await getDB();
  return db.getAllFromIndex("searchIndex", "by-project", projectId);
}

/** プロジェクトの検索インデックスを全削除（再構築前のクリア用） */
export async function clearSearchIndex(projectId: number): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("searchIndex", "readwrite");
  const index = tx.store.index("by-project");
  let cursor = await index.openCursor(IDBKeyRange.only(projectId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export function putMasters(items: MasterEntry[]): Promise<void> {
  return bulkPut("masters", items);
}

export async function putProjectMeta(meta: ProjectMeta): Promise<void> {
  const db = await getDB();
  await db.put("projectMeta", meta);
}

// --- read 系 ---

export async function getProjectMetaAll(): Promise<ProjectMeta[]> {
  const db = await getDB();
  return db.getAll("projectMeta");
}

export async function getProjectMeta(
  projectId: number,
): Promise<ProjectMeta | undefined> {
  const db = await getDB();
  return db.get("projectMeta", projectId);
}

export async function countIssuesByProject(projectId: number): Promise<number> {
  const db = await getDB();
  return db.countFromIndex("issues", "by-project", projectId);
}

export async function getIssueByKeyId(
  projectId: number,
  keyId: number,
): Promise<StoredIssue | undefined> {
  const db = await getDB();
  return db.getFromIndex("issues", "by-project-keyId", [projectId, keyId]);
}

export async function getChildIssues(
  projectId: number,
  parentIssueId: number,
): Promise<StoredIssue[]> {
  const db = await getDB();
  return db.getAllFromIndex("issues", "by-project-parent", [
    projectId,
    parentIssueId,
  ]);
}

export async function getCommentsByIssue(
  issueId: number,
): Promise<StoredComment[]> {
  const db = await getDB();
  return db.getAllFromIndex("comments", "by-issue", issueId);
}

export async function getAttachmentsByIssue(
  issueId: number,
): Promise<AttachmentMeta[]> {
  const db = await getDB();
  return db.getAllFromIndex("attachmentMeta", "by-issue", issueId);
}

export async function getIssueById(
  id: number,
): Promise<StoredIssue | undefined> {
  const db = await getDB();
  return db.get("issues", id);
}

export async function getCommentById(
  id: number,
): Promise<StoredComment | undefined> {
  const db = await getDB();
  return db.get("comments", id);
}

export type IssueSortField = "updated" | "created" | "keyId";
export type IssueSortOrder = "asc" | "desc";

export interface IssueFilter {
  statusId?: number;
  issueTypeId?: number;
  categoryId?: number;
  assigneeId?: number;
  milestoneId?: number;
  versionId?: number;
  /** 除外するステータス id（「未完了」= 完了 id を除外、に使う） */
  excludeStatusIds?: number[];
}

export interface QueryIssuesParams {
  projectId: number;
  offset: number;
  limit: number;
  sort: IssueSortField;
  order: IssueSortOrder;
  filter: IssueFilter;
}

const SORT_INDEX: Record<
  IssueSortField,
  "by-project-updated" | "by-project-created" | "by-project-keyId"
> = {
  updated: "by-project-updated",
  created: "by-project-created",
  keyId: "by-project-keyId",
};

/** 課題がフィルタにマッチするか（カテゴリは複数持つので some） */
function matchesFilter(issue: StoredIssue, filter: IssueFilter): boolean {
  if (filter.statusId != null && issue.status.id !== filter.statusId)
    return false;
  if (filter.issueTypeId != null && issue.issueType.id !== filter.issueTypeId)
    return false;
  if (filter.assigneeId != null && issue.assignee?.id !== filter.assigneeId)
    return false;
  if (
    filter.categoryId != null &&
    !issue.category.some((c) => c.id === filter.categoryId)
  ) {
    return false;
  }
  // milestones / versions は v3 で追加。旧データには無いことがあるので ?? [] で防御する。
  if (
    filter.milestoneId != null &&
    !(issue.milestones ?? []).some((m) => m.id === filter.milestoneId)
  ) {
    return false;
  }
  if (
    filter.versionId != null &&
    !(issue.versions ?? []).some((v) => v.id === filter.versionId)
  ) {
    return false;
  }
  if (
    filter.excludeStatusIds &&
    filter.excludeStatusIds.includes(issue.status.id)
  ) {
    return false;
  }
  return true;
}

/**
 * プロジェクト内の課題をフィルタ + ソートでページング取得する。
 *
 * 指定ソートのインデックスをカーソルで回し、フィルタにマッチしたものだけ集める。
 * フィルタなしなら advance() で offset スキップ、フィルタありはマッチ数で offset/limit を適用。
 * total はフィルタ後の件数（フィルタなしはインデックス count で高速に求める）。
 */
export async function queryIssues(
  params: QueryIssuesParams,
): Promise<{ items: StoredIssue[]; total: number }> {
  const { projectId, offset, limit, sort, order, filter } = params;
  const db = await getDB();
  const hasFilter =
    filter.statusId != null ||
    filter.issueTypeId != null ||
    filter.categoryId != null ||
    filter.assigneeId != null ||
    filter.milestoneId != null ||
    filter.versionId != null ||
    (filter.excludeStatusIds != null && filter.excludeStatusIds.length > 0);

  // keyId は数値範囲、updated/created は文字列範囲
  const numRange = IDBKeyRange.bound(
    [projectId, -Infinity],
    [projectId, Infinity],
  );
  const strRange = IDBKeyRange.bound([projectId, ""], [projectId, "￿"]);
  const useRange = sort === "keyId" ? numRange : strRange;
  const direction = order === "desc" ? "prev" : "next";

  const items: StoredIssue[] = [];

  if (!hasFilter) {
    // 重要: count は別トランザクションなので、カーソル用の tx を開く「前」に取得する。
    // tx を開いた後に他の await（別 tx 操作）を挟むと idb が tx を自動コミットしてしまい、
    // 続く openCursor が TransactionInactiveError になる。
    const total = await db.countFromIndex("issues", "by-project", projectId);
    const tx = db.transaction("issues", "readonly");
    const index = tx.store.index(SORT_INDEX[sort]);
    let cursor = await index.openCursor(useRange, direction);
    if (cursor && offset > 0) cursor = await cursor.advance(offset);
    while (cursor && items.length < limit) {
      items.push(cursor.value);
      cursor = await cursor.continue();
    }
    await tx.done;
    return { items, total };
  }

  // フィルタあり: マッチを数えつつ offset スキップ・limit 収集。
  // tx 作成〜カーソル消化の間は外部 await を一切挟まない（自動コミット回避）。
  const tx = db.transaction("issues", "readonly");
  const index = tx.store.index(SORT_INDEX[sort]);
  let matched = 0;
  let cursor = await index.openCursor(useRange, direction);
  while (cursor) {
    if (matchesFilter(cursor.value, filter)) {
      if (matched >= offset && items.length < limit) {
        items.push(cursor.value);
      }
      matched += 1;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  // matched がフィルタ後の総件数
  return { items, total: matched };
}

/** プロジェクトの masters を kind で取得（フィルタの選択肢用） */
export async function getMastersByKind(
  projectId: number,
  kind: MasterEntry["kind"],
): Promise<MasterEntry[]> {
  const db = await getDB();
  return db.getAllFromIndex("masters", "by-project-kind", [projectId, kind]);
}

/** 課題に登場する担当者の一覧（フィルタの選択肢用）。projectId で絞る */
export async function getAssigneesByProject(
  projectId: number,
): Promise<StoredUser[]> {
  const db = await getDB();
  const seen = new Map<number, StoredUser>();
  const tx = db.transaction("issues", "readonly");
  const index = tx.store.index("by-project");
  let cursor = await index.openCursor(IDBKeyRange.only(projectId));
  while (cursor) {
    const a = cursor.value.assignee;
    if (a) seen.set(a.id, a);
    cursor = await cursor.continue();
  }
  await tx.done;
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

// --- プロジェクト単位の一括取得（エクスポート用） ---

/** projectId のすべての課題 */
export async function getIssuesByProject(
  projectId: number,
): Promise<StoredIssue[]> {
  const db = await getDB();
  return db.getAllFromIndex("issues", "by-project", projectId);
}

/** projectId のすべてのコメント */
export async function getCommentsByProject(
  projectId: number,
): Promise<StoredComment[]> {
  const db = await getDB();
  return db.getAllFromIndex("comments", "by-project", projectId);
}

/** projectId のすべての添付メタ */
export async function getAttachmentMetaByProject(
  projectId: number,
): Promise<AttachmentMeta[]> {
  const db = await getDB();
  return db.getAllFromIndex("attachmentMeta", "by-project", projectId);
}

/** projectId のすべての masters（kind 横断） */
export async function getMastersByProject(
  projectId: number,
): Promise<MasterEntry[]> {
  const db = await getDB();
  const out: MasterEntry[] = [];
  const tx = db.transaction("masters", "readonly");
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (cursor.value.projectId === projectId) out.push(cursor.value);
    cursor = await cursor.continue();
  }
  await tx.done;
  return out;
}

/** 指定した id のユーザーをまとめて取得（存在するものだけ返す） */
export async function getUsersByIds(ids: number[]): Promise<StoredUser[]> {
  const db = await getDB();
  const tx = db.transaction("users", "readonly");
  const found = await Promise.all(ids.map((id) => tx.store.get(id)));
  await tx.done;
  return found.filter((u): u is StoredUser => u !== undefined);
}

/** 指定した userId のアイコンをまとめて取得（存在するものだけ返す） */
export async function getUserIconsByIds(
  ids: number[],
): Promise<StoredUserIcon[]> {
  const db = await getDB();
  const tx = db.transaction("userIcons", "readonly");
  const found = await Promise.all(ids.map((id) => tx.store.get(id)));
  await tx.done;
  return found.filter((i): i is StoredUserIcon => i !== undefined);
}

// --- Wiki ---

export function putWikis(
  items: StoredWiki[],
  onProgress?: ProgressCallback,
): Promise<void> {
  return bulkPut("wikis", items, onProgress);
}

export async function countWikisByProject(projectId: number): Promise<number> {
  const db = await getDB();
  return db.countFromIndex("wikis", "by-project", projectId);
}

export async function getWikiById(id: number): Promise<StoredWiki | undefined> {
  const db = await getDB();
  return db.get("wikis", id);
}

/** projectId のすべての Wiki（エクスポート用） */
export async function getWikisByProject(
  projectId: number,
): Promise<StoredWiki[]> {
  const db = await getDB();
  return db.getAllFromIndex("wikis", "by-project", projectId);
}

/**
 * projectId 内で name が完全一致する Wiki を 1 件返す（無ければ undefined）。
 * 本家 Backlog の Wiki トップページ（name が "Home" のページ）を既定表示に使う。
 * Wiki は多くても数百件なので専用インデックスは張らず線形探索で足りる。
 */
export async function getWikiByName(
  projectId: number,
  name: string,
): Promise<StoredWiki | undefined> {
  const wikis = await getWikisByProject(projectId);
  return wikis.find((w) => w.name === name);
}

/**
 * projectId のすべての Wiki を、ツリー描画に必要な軽量見出し（id/name/tags）だけにして返す。
 * サイドバーのページ一覧ツリー・タグ一覧の集計に使う。本文 content は載せない。
 */
export async function getWikiHeadingsByProject(
  projectId: number,
): Promise<WikiHeading[]> {
  const wikis = await getWikisByProject(projectId);
  return wikis.map((w) => ({ id: w.id, name: w.name, tags: w.tags }));
}

export type WikiSortField = "updated" | "name";

export interface QueryWikisParams {
  projectId: number;
  offset: number;
  limit: number;
  sort: WikiSortField;
  order: IssueSortOrder;
}

const WIKI_SORT_INDEX: Record<
  WikiSortField,
  "by-project-updated" | "by-project-name"
> = {
  updated: "by-project-updated",
  name: "by-project-name",
};

/** プロジェクト内の Wiki を更新日 or 名前でソートしてページング取得 */
export async function queryWikis(
  params: QueryWikisParams,
): Promise<{ items: StoredWiki[]; total: number }> {
  const { projectId, offset, limit, sort, order } = params;
  const db = await getDB();
  const range = IDBKeyRange.bound([projectId, ""], [projectId, "￿"]);
  const direction = order === "desc" ? "prev" : "next";
  const items: StoredWiki[] = [];

  const total = await db.countFromIndex("wikis", "by-project", projectId);
  const tx = db.transaction("wikis", "readonly");
  const index = tx.store.index(WIKI_SORT_INDEX[sort]);
  let cursor = await index.openCursor(range, direction);
  if (cursor && offset > 0) cursor = await cursor.advance(offset);
  while (cursor && items.length < limit) {
    items.push(cursor.value);
    cursor = await cursor.continue();
  }
  await tx.done;
  return { items, total };
}

// --- ドキュメント（Backlog Document） ---

export function putDocuments(
  items: StoredDocument[],
  onProgress?: ProgressCallback,
): Promise<void> {
  return bulkPut("documents", items, onProgress);
}

export async function countDocumentsByProject(
  projectId: number,
): Promise<number> {
  const db = await getDB();
  return db.countFromIndex("documents", "by-project", projectId);
}

export async function getDocumentById(
  id: string,
): Promise<StoredDocument | undefined> {
  const db = await getDB();
  return db.get("documents", id);
}

/** projectId のすべてのドキュメント（エクスポート用・一覧用） */
export async function getDocumentsByProject(
  projectId: number,
): Promise<StoredDocument[]> {
  const db = await getDB();
  return db.getAllFromIndex("documents", "by-project", projectId);
}

// --- delete 系 ---

/**
 * `by-project` インデックスを持つストアから、そのプロジェクトのレコードを全削除する。
 *
 * カーソルを 1 件ずつ進めるのではなくキーをまとめて取ってから消す（大量件数でも
 * トランザクションを短く保てる）。ストア名はインデックスを持つものだけに型で絞る。
 */
async function clearByProjectIndex<
  N extends
    | "issues"
    | "comments"
    | "attachmentMeta"
    | "projectMembers"
    | "searchIndex"
    | "wikis"
    | "documents",
>(storeName: N, projectId: number): Promise<void> {
  const db = await getDB();
  // ジェネリックなストア名のままでは idb がインデックスの値型を絞れないため、
  // 生の projectId ではなく IDBKeyRange を渡す（どのストアでも受け取れる形）。
  const keys = await db.getAllKeysFromIndex(
    storeName,
    "by-project",
    IDBKeyRange.only(projectId),
  );
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    const tx = db.transaction(storeName, "readwrite");
    await Promise.all([...batch.map((k) => tx.store.delete(k)), tx.done]);
  }
}

/**
 * プロジェクト 1 件分のレコードを IndexedDB から削除する（添付バイナリは OPFS 側で別途）。
 *
 * `users` / `userIcons` は projectId を持たない共有マスタなので、そのプロジェクトを消す
 * だけでは消えない。**プロジェクトが 1 件も残らなくなったときに限って**まとめて消す
 * （他プロジェクトが参照している可能性を潰さずに、「全部消したのに人だけ残る」状態も
 * 作らないための折衷）。
 *
 * @returns 共有マスタ（users / userIcons）も消したか
 */
export async function deleteProjectRecords(
  projectId: number,
): Promise<{ clearedSharedMasters: boolean }> {
  const db = await getDB();

  await clearByProjectIndex("issues", projectId);
  await clearByProjectIndex("comments", projectId);
  await clearByProjectIndex("attachmentMeta", projectId);
  await clearByProjectIndex("projectMembers", projectId);
  await clearByProjectIndex("searchIndex", projectId);
  await clearByProjectIndex("wikis", projectId);
  await clearByProjectIndex("documents", projectId);

  // masters は by-project 単独のインデックスを持たない（by-project-kind の複合のみ）。
  // 取得側の getMastersByProject が kind を横断して集めてくれるので、その key を消す。
  const masters = await getMastersByProject(projectId);
  if (masters.length > 0) {
    const tx = db.transaction("masters", "readwrite");
    await Promise.all([
      ...masters.map((m) =>
        tx.store.delete(`${projectId}:${m.kind}:${m.master.id}`),
      ),
      tx.done,
    ]);
  }

  // projectId が主キーのストア
  await db.delete("projectIcons", projectId);
  await db.delete("projectMeta", projectId);

  const remaining = await db.count("projectMeta");
  if (remaining === 0) {
    await db.clear("users");
    await db.clear("userIcons");
    return { clearedSharedMasters: true };
  }
  return { clearedSharedMasters: false };
}
