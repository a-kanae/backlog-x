/**
 * DataSource インターフェース。ビューア層が依存する唯一の境界。
 *
 * Phase 1 は LocalDataSource（IndexedDB 読み出し）。Phase 2 で FirebaseDataSource を
 * 足すだけでビューアを無改修にできるよう、以下を守る:
 * - 戻り値は entities 型のみ（生 Backlog 型を出さない）
 * - 全メソッド async（IndexedDB の非同期・Firestore のネットワーク待ちを吸収）
 * - ページングを最初から契約に入れる（Firestore カーソルへ差し替えても interface 不変）
 * - 読み取り専用（書き込み系は持たない。取り込みは ingest 側の別関数）
 */

import type {
  StoredIssue,
  StoredComment,
  StoredWiki,
  WikiHeading,
  StoredDocument,
  AttachmentMeta,
  ProjectMeta,
  StoredUser,
  NamedColorMaster,
  NamedMaster,
} from "@/types/entities";
import type { SearchHit, SearchKind } from "@/lib/search/types";

export type IssueSort = "updated" | "created" | "keyId";
export type SortOrder = "asc" | "desc";

export type WikiSort = "updated" | "name";

export interface WikiListQuery {
  projectId: number;
  offset: number;
  limit: number;
  /** 既定は updated 降順 */
  sort?: WikiSort;
  order?: SortOrder;
}

export interface WikiListPage {
  items: StoredWiki[];
  total: number;
}

export interface IssueFilter {
  statusId?: number;
  issueTypeId?: number;
  categoryId?: number;
  assigneeId?: number;
  /** マイルストーン id（その id を含む課題に絞る） */
  milestoneId?: number;
  /** 発生バージョン id（その id を含む課題に絞る） */
  versionId?: number;
  /** 除外するステータス id（「未完了」= 完了 id を除外、に使う） */
  excludeStatusIds?: number[];
}

export interface IssueListQuery {
  projectId: number;
  offset: number;
  limit: number;
  /** 既定は updated 降順 */
  sort?: IssueSort;
  order?: SortOrder;
  filter?: IssueFilter;
}

export interface IssueListPage {
  items: StoredIssue[];
  total: number;
}

/** フィルタ UI の選択肢（ステータス・種別・カテゴリー・担当者・マイルストーン・発生バージョン） */
export interface FilterOptions {
  statuses: NamedColorMaster[];
  issueTypes: NamedColorMaster[];
  categories: NamedMaster[];
  assignees: StoredUser[];
  milestones: NamedMaster[];
  versions: NamedMaster[];
}

export interface DataSource {
  // プロジェクト
  listProjects(): Promise<ProjectMeta[]>;
  getProject(projectId: number): Promise<ProjectMeta | undefined>;

  // 課題
  listIssues(query: IssueListQuery): Promise<IssueListPage>;
  /** フィルタ UI の選択肢を取得 */
  getFilterOptions(projectId: number): Promise<FilterOptions>;
  getIssueByKeyId(
    projectId: number,
    keyId: number,
  ): Promise<StoredIssue | undefined>;
  getChildIssues(
    projectId: number,
    parentIssueId: number,
  ): Promise<StoredIssue[]>;
  /** 親課題を id から解決（親リンク表示用。なければ undefined） */
  getIssueById(
    projectId: number,
    issueId: number,
  ): Promise<StoredIssue | undefined>;

  // ユーザー（メンション @ユーザー名 の照合などに使う）
  listUsers(): Promise<StoredUser[]>;
  // ユーザーアイコン（ローカル保存の Blob。外部 URL は参照しない）
  getUserIcon(userId: number): Promise<Blob | undefined>;
  // プロジェクトアイコン（ローカル保存の Blob。外部 URL は参照しない）
  getProjectIcon(projectId: number): Promise<Blob | undefined>;

  // コメント
  listComments(projectId: number, issueId: number): Promise<StoredComment[]>;

  // 添付メタ（バイナリは別経路）
  listAttachments(
    projectId: number,
    issueId: number,
  ): Promise<AttachmentMeta[]>;

  // Wiki
  listWikis(query: WikiListQuery): Promise<WikiListPage>;
  /** サイドバーのページ一覧ツリー・タグ集計用に、全 Wiki の軽量見出し（id/name/tags）を返す */
  listWikiHeadings(projectId: number): Promise<WikiHeading[]>;
  getWikiById(
    projectId: number,
    wikiId: number,
  ): Promise<StoredWiki | undefined>;
  /** name が完全一致する Wiki を返す（Home ページの既定表示に使う）。無ければ undefined */
  getWikiByName(
    projectId: number,
    name: string,
  ): Promise<StoredWiki | undefined>;

  // ドキュメント（Backlog Document）
  listDocuments(projectId: number): Promise<StoredDocument[]>;
  getDocumentById(
    projectId: number,
    documentId: string,
  ): Promise<StoredDocument | undefined>;

  // 検索（実体は SearchEngine に委譲。DataSource はファサード）
  // kinds を省略すると全カテゴリを検索する。カテゴリタブ表示に合わせて絞り込む場合は
  // 呼び出し側が該当する kind の配列を渡す（多数派カテゴリに少数派が押し出されないよう、
  // カテゴリごとに独立して limit 件を確保するため）。
  search(
    projectId: number,
    query: string,
    limit?: number,
    kinds?: SearchKind[],
  ): Promise<SearchHit[]>;

  // 取り込み済みかの判定（UI のガード用）
  hasData(projectId: number): Promise<boolean>;
}
