/**
 * Backlog API v2 のレスポンス型。
 *
 * 公式 API が返す生の JSON 構造をそのまま表す。取り込み時に `@/lib/ingest/normalize`
 * で保存用の entities 型（`@/types/entities`）へ変換するため、ビューア層はこの型を
 * 直接参照しない（境界は DataSource）。
 *
 * 実データの構造を実測して定義した。汎用性のため、実測したプロジェクトでは
 * 空配列だったフィールド（category / versions / customFields 等）も型としては保持する。
 */

/** ユーザー種別。1=管理者, 2=一般, 3=レポーター, 4=ビューアー, 5=ゲストレポーター, 6=ゲストビューアー */
export type BacklogRoleType = 1 | 2 | 3 | 4 | 5 | 6;

/** Nulab アカウント情報（アイコン URL を含む）。ユーザーによっては null */
export interface NulabAccount {
  nulabId: string;
  name: string;
  uniqueId: string;
  iconUrl: string;
}

/** 投稿者・担当者などのユーザー */
export interface BacklogUser {
  id: number;
  userId: string | null;
  name: string;
  roleType: BacklogRoleType;
  lang: string | null;
  mailAddress: string | null;
  nulabAccount: NulabAccount | null;
  keyword: string | null;
  lastLoginTime: string | null;
}

/** ステータス（プロジェクトごとに定義） */
export interface BacklogStatus {
  id: number;
  projectId: number;
  name: string;
  color: string;
  displayOrder: number;
}

/** 課題種別 */
export interface BacklogIssueType {
  id: number;
  projectId: number;
  name: string;
  color: string;
  displayOrder: number;
}

/** 優先度（プロジェクト共通のマスタ） */
export interface BacklogPriority {
  id: number;
  name: string;
}

/** 完了理由 */
export interface BacklogResolution {
  id: number;
  name: string;
}

/** カテゴリー */
export interface BacklogCategory {
  id: number;
  projectId: number;
  name: string;
  displayOrder: number;
}

/** 発生バージョン / 完了バージョン */
export interface BacklogVersion {
  id: number;
  projectId: number;
  name: string;
  description: string | null;
  startDate: string | null;
  releaseDueDate: string | null;
  archived: boolean;
  displayOrder: number;
}

/** マイルストーン（versions と同じ構造） */
export type BacklogMilestone = BacklogVersion;

/** 添付ファイルのメタ（バイナリは別エンドポイントで取得） */
export interface BacklogAttachment {
  id: number;
  name: string;
  size: number;
  createdUser?: BacklogUser;
  created?: string;
}

/** 共有ファイル */
export interface BacklogSharedFile {
  id: number;
  type: string;
  dir: string;
  name: string;
  size: number;
  createdUser?: BacklogUser;
  created?: string;
}

/** カスタム属性のリスト項目 */
export interface BacklogCustomFieldListItem {
  id: number;
  name: string;
  displayOrder?: number;
}

/** カスタム属性値（実測したプロジェクトでは未使用だが汎用性のため保持） */
export interface BacklogCustomField {
  id: number;
  fieldTypeId: number;
  name: string;
  value:
    | string
    | number
    | BacklogCustomFieldListItem
    | BacklogCustomFieldListItem[]
    | null;
  otherValue?: string | null;
}

/** コメントの変更履歴の通知情報 */
export interface BacklogNotificationInfo {
  type: string;
}

/** コメントの変更履歴の添付情報（削除済み添付のメタが残る） */
export interface BacklogAttachmentInfo {
  id: number;
  type: string;
  name: string;
}

/** コメントの変更履歴の属性情報 */
export interface BacklogAttributeInfo {
  id: number;
  typeId: number;
}

/** コメントの変更ログ（ステータス変更・添付・通知など） */
export interface BacklogChangeLogEntry {
  field: string;
  newValue: string | null;
  originalValue: string | null;
  attachmentInfo: BacklogAttachmentInfo | null;
  attributeInfo: BacklogAttributeInfo | null;
  notificationInfo: BacklogNotificationInfo | null;
}

/** 通知 */
export interface BacklogNotification {
  id: number;
  alreadyRead: boolean;
  reason: number;
  user: BacklogUser;
  resourceAlreadyRead: boolean;
}

/** スター */
export interface BacklogStar {
  id: number;
  comment: string | null;
  url: string;
  title: string;
  presenter: BacklogUser;
  created: string;
}

/** 外部ファイルリンク */
export interface BacklogExternalFileLink {
  id: number;
  type: string;
  name: string;
  url: string;
}

/** 課題（/issues, /issues/:id のレスポンス要素） */
export interface BacklogIssue {
  id: number;
  projectId: number;
  issueKey: string;
  keyId: number;
  issueType: BacklogIssueType;
  summary: string;
  description: string;
  resolution: BacklogResolution | null;
  priority: BacklogPriority | null;
  status: BacklogStatus;
  assignee: BacklogUser | null;
  category: BacklogCategory[];
  versions: BacklogVersion[];
  milestone: BacklogMilestone[];
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: number | null;
  actualHours: number | null;
  parentIssueId: number | null;
  createdUser: BacklogUser;
  created: string;
  updatedUser: BacklogUser | null;
  updated: string;
  customFields: BacklogCustomField[];
  attachments: BacklogAttachment[];
  sharedFiles: BacklogSharedFile[];
  externalFileLinks: BacklogExternalFileLink[];
  stars: BacklogStar[];
}

/** コメント（/issues/:id/comments のレスポンス要素） */
export interface BacklogComment {
  id: number;
  projectId: number;
  issueId: number;
  content: string | null;
  changeLog: BacklogChangeLogEntry[] | null;
  createdUser: BacklogUser;
  created: string;
  updated: string;
  stars: BacklogStar[];
  notifications: BacklogNotification[];
}

/** プロジェクト（/projects のレスポンス要素） */
export interface BacklogProject {
  id: number;
  projectKey: string;
  name: string;
  chartEnabled: boolean;
  subtaskingEnabled: boolean;
  projectLeaderCanEditProjectLeader: boolean;
  textFormattingRule: string;
  archived: boolean;
  displayOrder: number;
}

/** Wiki のタグ（/wikis が返す tags 要素） */
export interface BacklogWikiTag {
  id: number;
  name: string;
}

/**
 * Wiki ページ（/wikis 一覧・/wikis/:id 詳細のレスポンス要素）。
 * 一覧では content が空文字で返り、本文は詳細（/wikis/:id）で取得する。
 *
 * ⚠️ content は **null が返ることがある**（本文を書いていない空ページ。TH7 の "Home" で実測）。
 * 一覧の「空文字」とは別物なので、取り込みの境界（normalize）で空文字に潰すこと。
 */
export interface BacklogWiki {
  id: number;
  projectId: number;
  name: string;
  content: string | null;
  tags: BacklogWikiTag[];
  attachments: BacklogAttachment[];
  sharedFiles: BacklogSharedFile[];
  stars: BacklogStar[];
  createdUser: BacklogUser;
  created: string;
  updatedUser: BacklogUser | null;
  updated: string;
}

/** ドキュメントのタグ（/documents が返す tags 要素） */
export interface BacklogDocumentTag {
  id: number;
  name: string;
}

/**
 * ドキュメント（Backlog Document・/documents?projectIdOrKey= のレスポンス要素）。
 * id は 32 文字の文字列。本文は plain（プレーンテキスト）と json（リッチ構造・null あり）。
 * childDocumentIds でツリー階層を表す。
 */
export interface BacklogDocument {
  id: string;
  projectId: number;
  title: string;
  plain: string;
  /** リッチテキスト構造（ProseMirror 等の JSON 文字列。null のこともある）。MVP では未使用 */
  json: string | null;
  emoji: string | null;
  statusId: number | null;
  tags: BacklogDocumentTag[];
  childDocumentIds: string[];
  attachments: BacklogAttachment[];
  createdUser: BacklogUser;
  created: string;
  updatedUser: BacklogUser | null;
  updated: string;
}

/**
 * プロジェクトに定義されたマスタ一式（`/projects/:id/statuses` 等の生レスポンス）。
 *
 * 課題に出現したマスタを逆算するだけでは「定義されているが未使用のマスタ」が欠ける
 * （全課題が「完了」のプロジェクトで状態が 1 件しか集まらない等）。取り込みでは
 * この定義側を基礎に置き、課題から拾ったぶんをマージする。
 *
 * priorities / resolutions はプロジェクトではなくスペース共通のマスタ。
 */
export interface BacklogProjectMasters {
  statuses: BacklogStatus[];
  issueTypes: BacklogIssueType[];
  categories: BacklogCategory[];
  /** バージョン兼マイルストーン（Backlog では同じマスタを両方の用途で使う） */
  versions: BacklogVersion[];
  priorities: BacklogPriority[];
  resolutions: BacklogResolution[];
}
