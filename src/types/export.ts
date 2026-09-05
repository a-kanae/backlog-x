/**
 * プロジェクト単位のアーカイブ書き出しファイル（.json）のスキーマ。
 *
 * 取り込み済みの IndexedDB データ（課題・コメント・添付メタ・ユーザー・アイコン・マスタ・
 * 検索インデックス）を 1 ファイルにまとめ、別メンバーがインポートして同じアーカイブを
 * 再構築できるようにする。検索インデックスも含めるためインポート後の再構築は不要。
 *
 * アイコンの Blob はテキスト（JSON）に収めるため base64 文字列にして内包する。
 */

import type {
  StoredIssue,
  StoredComment,
  StoredWiki,
  StoredDocument,
  AttachmentMeta,
  StoredUser,
  StoredProjectMember,
  ProjectMeta,
} from "@/types/entities";
import type { MasterEntry } from "@/lib/db/schema";

/** 書き出しファイルのフォーマット識別子（インポート時に検証する） */
export const EXPORT_FORMAT = "backlog-x-archive";
/**
 * 書き出しフォーマットのバージョン。互換性が壊れる変更で上げる。
 * v2: Wiki・ドキュメントを追加（旧 v1 ファイルにはこれらが無い＝インポート時は空配列扱い）。
 * v3: 課題に milestones・versions を追加（旧 v2 以前の課題には無い＝インポート時は空配列で補完）。
 * v4: プロジェクトアイコン projectIcon を追加（旧 v3 以前には無い＝インポート時は未設定扱い）。
 * v5: プロジェクトメンバー projectMembers（参加者 + roleType）を追加（旧 v4 以前には無い＝
 *     インポート時は空扱い）。取り込み側での権限復元に使う。
 * v6: 本文（課題 description / コメント content / Wiki content）を Backlog 記法から
 *     Markdown(GFM) に変換して出力するようにした。課題リンクは中立スキーム issue:${issueKey}、
 *     メンションは mention:${name}（取り込み側が解決する）。旧 v5 以前は本文が Backlog 記法のまま。
 *     Document.plain は元々 Markdown なので変換対象外。
 * v7: 行をまたぐ強調 ''…'' / 打消 %%…%% も変換するようにした（v6 は 1 行内のみ変換だった）。
 *     空行（段落）をまたぐ強調は Markdown 仕様上変換不可のため記号が残る（少数）。
 * v8: 埋め込み画像 `#image(name)` を `![name](attachment:${name})` の画像リンクとして出力する
 *     ようにした（v7 以前は `（画像: name）` のテキスト）。参照は**添付ファイル名**（Backlog 記法が
 *     名前でしか参照しないため）で、取り込み側が attachmentMeta と突き合わせて自分の URL に
 *     解決する。旧 v7 以前のファイルは本文にテキストしか残っていないので画像には戻らない。
 * v9: 本文に貼られた**このスペース・このプロジェクトの課題 URL**（`<スペース>/view/KEY-123` /
 *     `…#comment-<id>`）を課題リンク `issue:${issueKey}` に変換して出力するようにした（v8 以前は
 *     Backlog のホストを指す素の URL のまま＝**Backlog を解約すると参照が死ぬ**外部リンク）。
 *     コメントアンカーは `issue:KEY-123#comment-<id>` として持ち、取り込み側が自分のコメント
 *     アンカー形へ解決する。**ホストとプロジェクトキーが一致するものだけ**変換するので、別スペース
 *     や別プロジェクト・Wiki・設定画面などの URL は素の URL のまま残る（誤リンクを作らない）。
 */
export const EXPORT_VERSION = 9;

/**
 * アイコン単体ファイルのフォーマット識別子。
 * Nulab アカウント連携ユーザーのアイコンはブラウザの CORS 制約で取得できないため、
 * CLI（scripts/fetch-icons.mjs）で全ユーザーぶん取得して書き出し、ブラウザのインポート機能で
 * 後から追加できるようにする。userIcons（IndexedDB）にのみ put する単体ファイル。
 */
export const ICONS_FORMAT = "backlog-x-icons";

/** アイコン単体ファイル（.json.gz）の本体 */
export interface IconsExport {
  format: typeof ICONS_FORMAT;
  version: number;
  exportedAt: string;
  /** base64 内包のアイコン（ProjectExport の userIcons と同形） */
  icons: ExportedUserIcon[];
}

/** アイコンを base64 で内包した形（StoredUserIcon の Blob を base64 化したもの） */
export interface ExportedUserIcon {
  userId: number;
  /** 画像バイナリの base64（data 部のみ。プレフィックスは付けない） */
  base64: string;
  contentType: string;
}

/** プロジェクトアイコンを base64 で内包した形（StoredProjectIcon の Blob を base64 化したもの） */
export interface ExportedProjectIcon {
  /** 画像バイナリの base64（data 部のみ。プレフィックスは付けない） */
  base64: string;
  contentType: string;
}

/** 検索インデックスチャンクを base64 で内包した形（SearchIndexBlob の data 互換） */
export interface ExportedSearchIndex {
  key: string;
  projectId: number;
  chunkKey: string;
  /** flexsearch の export チャンク文字列（そのまま JSON に載る） */
  data: string;
}

/** プロジェクト 1 件分の書き出しファイル本体 */
export interface ProjectExport {
  format: typeof EXPORT_FORMAT;
  version: number;
  /** 書き出し時刻（ISO 8601） */
  exportedAt: string;
  projectMeta: ProjectMeta;
  issues: StoredIssue[];
  comments: StoredComment[];
  attachmentMeta: AttachmentMeta[];
  masters: MasterEntry[];
  /** このプロジェクトに登場するユーザーのみ */
  users: StoredUser[];
  /** このプロジェクトに登場するユーザーのアイコン（base64 内包） */
  userIcons: ExportedUserIcon[];
  /** 検索インデックスチャンク（含めるのでインポート後の再構築不要） */
  searchIndex: ExportedSearchIndex[];
  /** Wiki（v2 で追加。旧 v1 ファイルには無いので任意） */
  wikis?: StoredWiki[];
  /** ドキュメント（v2 で追加。旧 v1 ファイルには無いので任意） */
  documents?: StoredDocument[];
  /** プロジェクトアイコン（v4 で追加。旧 v3 以前には無いので任意。未設定なら省略） */
  projectIcon?: ExportedProjectIcon;
  /**
   * プロジェクトメンバー（参加者 + roleType。v5 で追加。旧 v4 以前には無いので任意）。
   * base64 等の変換は不要（roleType は数値・userId は数値のプレーンな配列）。
   * 取り込み側がプロジェクトの権限構成を復元するために使う。
   */
  projectMembers?: StoredProjectMember[];
}
