/**
 * Backlog API の生レスポンス（@/types/backlog）→ 保存・表示用 entities（@/types/entities）への正規化。
 *
 * 投稿者名義・日時（createdUser / created / updated）はアーカイブの核なので改変せずそのまま写す。
 * 表示・検索に不要なフィールド（stars / notifications 等）は落としてストレージを節約する。
 */

import type {
  BacklogIssue,
  BacklogComment,
  BacklogUser,
  BacklogStatus,
  BacklogIssueType,
  BacklogPriority,
  BacklogResolution,
  BacklogCategory,
  BacklogChangeLogEntry,
  BacklogAttachment,
  BacklogWiki,
  BacklogDocument,
} from "@/types/backlog";
import type {
  StoredIssue,
  StoredComment,
  StoredUser,
  StoredChangeLog,
  StoredWiki,
  StoredDocument,
  AttachmentMeta,
  NamedColorMaster,
  NamedMaster,
} from "@/types/entities";

export function normalizeUser(user: BacklogUser): StoredUser {
  // アイコンは外部 URL を保存せず、別途 icons/ から Blob を userIcons ストアへ取り込む（normalize 対象外）。
  return {
    id: user.id,
    name: user.name,
    userId: user.userId,
    mailAddress: user.mailAddress,
  };
}

function normalizeColorMaster(
  m: BacklogStatus | BacklogIssueType,
): NamedColorMaster {
  return { id: m.id, name: m.name, color: m.color };
}

function normalizeNamedMaster(
  m: BacklogPriority | BacklogResolution | BacklogCategory,
): NamedMaster {
  return { id: m.id, name: m.name };
}

/** マイルストーン / 発生バージョン（BacklogVersion 構造）を id+name に正規化 */
function normalizeVersionMaster(m: { id: number; name: string }): NamedMaster {
  return { id: m.id, name: m.name };
}

export function normalizeIssue(issue: BacklogIssue): StoredIssue {
  return {
    id: issue.id,
    projectId: issue.projectId,
    issueKey: issue.issueKey,
    keyId: issue.keyId,
    issueType: normalizeColorMaster(issue.issueType),
    summary: issue.summary,
    // Backlog API の description は **null を返すことがある**（本文を書かずに作られた課題）。
    // StoredIssue.description は string なので、取り込みの境界でここで空文字に正規化する。
    // これを怠ると null のまま IndexedDB に入り、検索インデックス作成（makeSnippet の
    // text.replace）で「Cannot read properties of null」で落ちる（TH7 取り込みで実際に発生）。
    description: issue.description ?? "",
    status: normalizeColorMaster(issue.status),
    priority: issue.priority ? normalizeNamedMaster(issue.priority) : null,
    resolution: issue.resolution
      ? normalizeNamedMaster(issue.resolution)
      : null,
    assignee: issue.assignee ? normalizeUser(issue.assignee) : null,
    category: issue.category.map(normalizeNamedMaster),
    milestones: issue.milestone.map(normalizeVersionMaster),
    versions: issue.versions.map(normalizeVersionMaster),
    parentIssueId: issue.parentIssueId,
    startDate: issue.startDate,
    dueDate: issue.dueDate,
    estimatedHours: issue.estimatedHours,
    actualHours: issue.actualHours,
    createdUser: normalizeUser(issue.createdUser),
    created: issue.created,
    updatedUser: issue.updatedUser ? normalizeUser(issue.updatedUser) : null,
    updated: issue.updated,
    attachmentCount: issue.attachments.length,
  };
}

function normalizeChangeLog(entry: BacklogChangeLogEntry): StoredChangeLog {
  return {
    field: entry.field,
    newValue: entry.newValue,
    originalValue: entry.originalValue,
    attachmentName: entry.attachmentInfo?.name ?? null,
    notificationOnly:
      entry.field === "notification" &&
      entry.newValue === null &&
      entry.originalValue === null,
  };
}

export function normalizeComment(comment: BacklogComment): StoredComment {
  return {
    id: comment.id,
    projectId: comment.projectId,
    issueId: comment.issueId,
    content: comment.content,
    changeLog: (comment.changeLog ?? []).map(normalizeChangeLog),
    createdUser: normalizeUser(comment.createdUser),
    created: comment.created,
    updated: comment.updated,
  };
}

/** 課題の現存添付（attachments[]）を AttachmentMeta に変換 */
export function normalizeAttachments(issue: BacklogIssue): AttachmentMeta[] {
  return issue.attachments.map((att: BacklogAttachment) => ({
    id: att.id,
    projectId: issue.projectId,
    issueId: issue.id,
    name: att.name,
    size: att.size,
    createdUser: att.createdUser ? normalizeUser(att.createdUser) : null,
    created: att.created ?? null,
  }));
}

/**
 * Wiki を正規化。本文 content は詳細取得で埋まっている前提（一覧の空 content ではなく
 * getWikiDetail の結果を渡す）。
 */
export function normalizeWiki(wiki: BacklogWiki): StoredWiki {
  return {
    id: wiki.id,
    projectId: wiki.projectId,
    name: wiki.name,
    // Backlog API は本文未記入の Wiki で content に **null** を返す（TH7 の "Home" で実測）。
    // StoredWiki.content は string なので、取り込みの境界でここで空文字に潰す。
    // これを怠ると null のまま IndexedDB に入り、検索インデックス作成（makeSnippet の
    // text.replace）で「Cannot read properties of null」で落ちる。
    content: wiki.content ?? "",
    tags: wiki.tags.map((t) => ({ id: t.id, name: t.name })),
    createdUser: normalizeUser(wiki.createdUser),
    created: wiki.created,
    updatedUser: wiki.updatedUser ? normalizeUser(wiki.updatedUser) : null,
    updated: wiki.updated,
    attachmentCount: wiki.attachments.length,
  };
}

/** ドキュメントを正規化。本文は plain（プレーンテキスト）を採用、リッチ構造 json は MVP では捨てる。 */
export function normalizeDocument(doc: BacklogDocument): StoredDocument {
  return {
    id: doc.id,
    projectId: doc.projectId,
    title: doc.title,
    plain: doc.plain,
    emoji: doc.emoji,
    statusId: doc.statusId,
    tags: doc.tags.map((t) => ({ id: t.id, name: t.name })),
    childDocumentIds: doc.childDocumentIds,
    createdUser: normalizeUser(doc.createdUser),
    created: doc.created,
    updatedUser: doc.updatedUser ? normalizeUser(doc.updatedUser) : null,
    updated: doc.updated,
    attachmentCount: doc.attachments.length,
  };
}

/** 課題キー（例 "PROJ-1"）からプロジェクトキー（"PROJ"）を取り出す */
export function projectKeyFromIssueKey(issueKey: string): string {
  const idx = issueKey.lastIndexOf("-");
  return idx > 0 ? issueKey.slice(0, idx) : issueKey;
}
