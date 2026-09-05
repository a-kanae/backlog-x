/**
 * IndexedDB のスキーマ定義（DB 名・version・ストア・インデックスの単一の真実）。
 *
 * 確定アーキ: 1 DB + projectId パーティション。すべてのストアは projectId で区切られ、
 * 権限境界 = データ境界 = パーティション単位をプロジェクトで一致させる（Phase 2 の越境防止の土台）。
 */

import type { DBSchema } from "idb";
import type {
  StoredIssue,
  StoredComment,
  StoredUser,
  StoredUserIcon,
  StoredProjectIcon,
  StoredProjectMember,
  StoredWiki,
  StoredDocument,
  AttachmentMeta,
  ProjectMeta,
  NamedColorMaster,
  NamedMaster,
  SearchIndexBlob,
} from "@/types/entities";

export const DB_NAME = "backlog-x";
// v5: masters に milestone / version kind を追加（課題のマイルストーン・発生バージョン）。
// 既存ストアの構造は変えず（masters の値は kind で区別するだけ）、再取り込みで充填する。
// v6: projectIcons ストアを追加（プロジェクトのロゴ画像・projectId で 1 枚）。
// v7: projectMembers ストアを追加（プロジェクト参加者 + roleType のスナップショット。
//     エクスポート／取り込み時の権限復元用。backlog-x 本体の表示には使わない）。
export const DB_VERSION = 7;

/** masters ストアの値。種別ごとに kind で区別し、projectId で引く */
export interface MasterEntry {
  /** `${projectId}:${kind}:${id}` */
  key: string;
  projectId: number;
  kind:
    | "status"
    | "issueType"
    | "priority"
    | "resolution"
    | "category"
    | "milestone"
    | "version";
  master: NamedColorMaster | NamedMaster;
  /**
   * Backlog 側の表示順（`/projects/:id/statuses` 等が返す displayOrder）。
   *
   * これを持たないと、読み出しがキー順（= id 順）になって Backlog の並びが崩れる。例えば
   * 状態は「未対応(1000) / 処理中(2000) / 処理済み(3000) / カスタム状態(3001) / 完了(4000)」で、
   * カスタム状態は id が大きい（59635）ため id 順では完了より後ろに来てしまう。
   *
   * 課題から逆算しただけのマスタ（プロジェクト定義に無い＝削除済み等）は値を持たない。
   * 並べ替えではそれらを末尾に置く。
   */
  displayOrder?: number;
}

export interface BacklogXDB extends DBSchema {
  issues: {
    key: number; // issue.id（グローバル一意）
    value: StoredIssue;
    indexes: {
      "by-project": number; // projectId
      "by-project-keyId": [number, number]; // [projectId, keyId] — 詳細ページの主検索 + keyId ソート
      "by-project-parent": [number, number]; // [projectId, parentIssueId] — 子課題
      "by-project-updated": [number, string]; // [projectId, updated] — 一覧の既定ソート
      "by-project-created": [number, string]; // [projectId, created] — 登録日ソート
    };
  };
  comments: {
    key: number; // comment.id
    value: StoredComment;
    indexes: {
      "by-issue": number; // issueId
      "by-project": number; // projectId（プロジェクト削除・件数集計用）
    };
  };
  attachmentMeta: {
    key: number; // attachment.id
    value: AttachmentMeta;
    indexes: {
      "by-issue": number; // issueId
      "by-project": number; // projectId
    };
  };
  users: {
    key: number; // user.id
    value: StoredUser;
  };
  userIcons: {
    key: number; // user.id
    value: StoredUserIcon;
  };
  projectIcons: {
    key: number; // projectId
    value: StoredProjectIcon;
  };
  projectMembers: {
    key: string; // `${projectId}:${userId}` — プロジェクト内で 1 ユーザー 1 レコード
    value: StoredProjectMember;
    indexes: {
      "by-project": number; // projectId（プロジェクトのメンバー一覧・削除）
    };
  };
  masters: {
    key: string; // `${projectId}:${kind}:${id}`
    value: MasterEntry;
    indexes: {
      "by-project-kind": [number, string]; // [projectId, kind]
    };
  };
  projectMeta: {
    key: number; // projectId
    value: ProjectMeta;
  };
  searchIndex: {
    key: string; // `${projectId}:${chunkKey}`
    value: SearchIndexBlob;
    indexes: {
      "by-project": number; // projectId
    };
  };
  wikis: {
    key: number; // wiki.id（グローバル一意）
    value: StoredWiki;
    indexes: {
      "by-project": number; // projectId（一覧・件数・削除）
      "by-project-name": [number, string]; // [projectId, name] — 名前ソート
      "by-project-updated": [number, string]; // [projectId, updated] — 更新日ソート（既定）
    };
  };
  documents: {
    key: string; // document.id（32 文字の文字列）
    value: StoredDocument;
    indexes: {
      "by-project": number; // projectId（一覧・件数・削除）
      "by-project-updated": [number, string]; // [projectId, updated] — 更新日ソート（既定）
    };
  };
}
