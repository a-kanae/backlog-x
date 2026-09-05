/**
 * IndexedDB に保存する形 = ビューアが表示に使う形。
 *
 * Backlog API の生レスポンス（`@/types/backlog`）から `@/lib/ingest/normalize` で
 * 変換した、表示・検索に必要な最小構造。DataSource の戻り値はすべてこの entities 型で、
 * ビューア層は生 Backlog 型を一切見ない。
 *
 * Phase 2 で中央保管（Firestore）に切り替える際も、この素の構造体をそのまま保存・配信
 * できるよう、関数や非シリアライズ値を含めない（JSON 化可能なプレーンオブジェクトに限る）。
 *
 * 投稿者名義・日時（createdUser / created / updated）はアーカイブの核なので改変せず保持する。
 */

/** 表示用の最小ユーザー情報 */
export interface StoredUser {
  id: number;
  name: string;
  /** ログインユーザー ID（メール突合とは別。Phase 1 では表示用） */
  userId: string | null;
  mailAddress: string | null;
}

/**
 * ユーザーアイコン画像（ローカル保存）。
 *
 * Backlog/Nulab の iconUrl を閲覧時に外部参照すると、解約後に 404 になり・
 * アクセスパターンが外部に漏れる。そのため取り込み時に画像バイナリを Blob として保存し、
 * 閲覧時は Object URL を生成して表示する（外部リクエストを一切出さない）。
 */
export interface StoredUserIcon {
  /** user.id */
  userId: number;
  /** 画像バイナリ */
  blob: Blob;
  /** MIME タイプ（image/png 等） */
  contentType: string;
}

/**
 * プロジェクトアイコン画像（ローカル保存）。
 *
 * Backlog の `/projects/:id/image` で取得できるプロジェクトのロゴ画像。ユーザーアイコンと
 * 同じ理由（解約後 404・外部参照を出さない）で取り込み時に Blob として保存し、閲覧時は
 * Object URL を生成して表示する。projectId で 1 枚（未設定なら保存しない）。
 */
export interface StoredProjectIcon {
  /** projectId */
  projectId: number;
  /** 画像バイナリ */
  blob: Blob;
  /** MIME タイプ（image/png 等） */
  contentType: string;
}

/**
 * プロジェクトに参加しているユーザーの「所属 + 権限（ロール）」のスナップショット。
 *
 * `GET /projects/:id/users` の各メンバーから取り込む。「誰がどのプロジェクトに参加していて、
 * それぞれ何の権限か」を表す（Backlog にはスペース単位のロールもあるが、backlog-x では
 * スペースの概念を持たず、プロジェクト参加者 × そのロールの粒度で保持する）。
 *
 * StoredUser（投稿者・担当者から副産物で拾う名義）とは別ストアにする理由:
 * 退職者など「課題は作ったがもうプロジェクトメンバーではない」ユーザーが StoredUser には
 * 含まれる一方、projectMembers は現在の参加者だけを表す。両者は集合が一致しないため分ける。
 * 名前・メール等は userId で users ストアと突き合わせる（ここでは roleType のみ持つ）。
 *
 * 主目的はエクスポートに載せて、取り込み側がプロジェクトの権限構成を復元できるようにすること。
 * backlog-x 本体はこのデータを表示に使わない（読み取り専用アーカイブの UI には出さない）。
 */
export interface StoredProjectMember {
  projectId: number;
  /** user.id（数値。users ストア・StoredUser.id と対応） */
  userId: number;
  /**
   * ロール種別（Backlog の roleType をそのまま保持）。
   * 1=管理者 / 2=一般ユーザー / 3=レポーター / 4=ビューアー / 5=ゲストリポーター / 6=ゲストビューア。
   */
  roleType: 1 | 2 | 3 | 4 | 5 | 6;
}

/** ステータス・課題種別など、色付きで表示する名前付きマスタ */
export interface NamedColorMaster {
  id: number;
  name: string;
  color: string;
}

/** 名前のみのマスタ（優先度・完了理由・カテゴリーなど） */
export interface NamedMaster {
  id: number;
  name: string;
}

/** 添付ファイルのメタ（バイナリは Phase 1 ではローカル参照、Phase 2 で中央 Storage） */
export interface AttachmentMeta {
  id: number;
  projectId: number;
  issueId: number;
  name: string;
  size: number;
  createdUser: StoredUser | null;
  created: string | null;
}

/** 保存・表示用の課題 */
export interface StoredIssue {
  id: number;
  projectId: number;
  /** 表示用キー（例: "PROJ-1"）。改変せず保持 */
  issueKey: string;
  /** プロジェクト内連番。ルーティングのキー */
  keyId: number;
  issueType: NamedColorMaster;
  summary: string;
  description: string;
  status: NamedColorMaster;
  priority: NamedMaster | null;
  resolution: NamedMaster | null;
  assignee: StoredUser | null;
  category: NamedMaster[];
  /** マイルストーン（Backlog の milestone[]・id+name のみ）。一覧フィルタ・詳細表示に使う */
  milestones: NamedMaster[];
  /** 発生バージョン（Backlog の versions[]・id+name のみ） */
  versions: NamedMaster[];
  /** 親課題 ID（なければ null）。子課題の階層表示に使う */
  parentIssueId: number | null;
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: number | null;
  actualHours: number | null;
  createdUser: StoredUser;
  created: string;
  updatedUser: StoredUser | null;
  updated: string;
  /** この課題が持つ現存添付の数（一覧でアイコン表示するため） */
  attachmentCount: number;
}

/** コメントの変更ログ（ステータス変更・添付・通知など）の表示用 */
export interface StoredChangeLog {
  field: string;
  newValue: string | null;
  originalValue: string | null;
  /** 削除済み添付のメタが残ることがある */
  attachmentName: string | null;
  /** 通知のみの変更ログか（content 空のシステムコメント判定に使う） */
  notificationOnly: boolean;
}

/** 保存・表示用のコメント */
export interface StoredComment {
  id: number;
  projectId: number;
  issueId: number;
  content: string | null;
  changeLog: StoredChangeLog[];
  createdUser: StoredUser;
  created: string;
  updated: string;
}

/**
 * 保存・表示用の Wiki ページ。
 *
 * Backlog の Wiki（`/wikis`）。id はグローバル一意の数値（課題の keyId のような
 * プロジェクト内連番は無いので、ルーティングのキーは id を使う）。
 * 本文 content は一覧 API では空で返るため、取り込み時に `/wikis/:id`（詳細）で取得する。
 * 投稿者名義・日時（createdUser / created / updated）は改変せず保持。
 */
export interface StoredWiki {
  id: number;
  projectId: number;
  /** Wiki ページ名（タイトル） */
  name: string;
  /** 本文（Backlog 記法 or Markdown。プロジェクトの textFormattingRule で描画分岐） */
  content: string;
  /** タグ（id+name のみ。色は持たない） */
  tags: NamedMaster[];
  createdUser: StoredUser;
  created: string;
  updatedUser: StoredUser | null;
  updated: string;
  /** 添付の件数（MVP は本体 OPFS 保存せずメタ件数のみ） */
  attachmentCount: number;
}

/**
 * Wiki ツリー（サイドバーのページ一覧）構築用の軽量見出し。
 *
 * ツリー描画には本文 content は不要で、id（遷移先）・name（/ 区切りの階層パス）・
 * tags（タグ一覧の集計）だけあればよい。全件（実測では 199 件）を一度に読むため、
 * content を載せない軽量形にして転送・メモリを抑える。
 */
export interface WikiHeading {
  id: number;
  /** "/" 区切りの階層パス（例 "01.月別リリース内容/2026年/06月"）。ツリー化のキー */
  name: string;
  /** タグ（一覧の集計に使う） */
  tags: NamedMaster[];
}

/**
 * 保存・表示用のドキュメント（Backlog Document）。
 *
 * Wiki とは別エンティティ（`/documents?projectIdOrKey=`）。id は 32 文字の文字列、
 * childDocumentIds でツリー階層を表す。本文は plain（プレーンテキスト）を主軸に保存し、
 * リッチ構造 json の描画は将来。投稿者名義・日時は改変せず保持。
 */
export interface StoredDocument {
  /** 32 文字の文字列 ID（UUID 系）。ルーティングのキー */
  id: string;
  projectId: number;
  title: string;
  /** 本文プレーンテキスト（検索・表示の主軸） */
  plain: string;
  /** 絵文字（ドキュメントのアイコン） */
  emoji: string | null;
  statusId: number | null;
  /** タグ（id+name のみ） */
  tags: NamedMaster[];
  /** 子ドキュメント ID（ツリー階層） */
  childDocumentIds: string[];
  createdUser: StoredUser;
  created: string;
  updatedUser: StoredUser | null;
  updated: string;
  /** 添付の件数（MVP は本体 OPFS 保存せずメタ件数のみ） */
  attachmentCount: number;
}

/** プロジェクトのメタ（取り込み状況・件数・名前） */
export interface ProjectMeta {
  projectId: number;
  /** プロジェクトキー（例: "PROJ"）。課題の issueKey から導出 */
  projectKey: string;
  /** プロジェクト名。/projects から取れれば設定、なければ projectKey で代用 */
  name: string;
  issueCount: number;
  commentCount: number;
  attachmentCount: number;
  /** Wiki 件数（未取り込みや 0 件なら未設定 or 0） */
  wikiCount?: number;
  /** ドキュメント件数（未取り込みや 0 件なら未設定 or 0） */
  documentCount?: number;
  /**
   * このプロジェクトが属する Backlog スペースの URL（例 "https://example.backlog.jp"）。
   * API 取り込みでは入力された URL を保存し、原本（Backlog）へのリンクに使う。
   * フォルダ取り込みでは未設定（原本リンクを出さない）。
   */
  spaceUrl?: string;
  /** 最終取り込み時刻（ISO 8601）。差分更新の基準 */
  lastImportedAt: string;
}

/** flexsearch の export チャンク 1 件分（searchIndex ストアの値） */
export interface SearchIndexBlob {
  /** `${projectId}` または `${projectId}:${shardKey}` */
  key: string;
  projectId: number;
  /** flexsearch が export したチャンクのキー */
  chunkKey: string;
  /** flexsearch が export したチャンクのデータ（文字列化済み） */
  data: string;
}
