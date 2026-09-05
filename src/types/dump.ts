/**
 * Backlog ダンプ（.json.gz）のスキーマ。
 *
 * Backlog API から取得した**生レスポンスをそのまま**（正規化前で）保持するファイル。
 * backlog-x の書き出しファイル（@/types/export の ProjectExport）とは別物:
 *
 * - **Backlog ダンプ（この型）** = Backlog API のレスポンス原本。backlog-x を通す前の状態。
 *   取り込み処理そのものの検証・再現に使える（正規化で潰れる異常値も保持される）。
 * - **backlog-x ダンプ（ProjectExport）** = 正規化・索引済みのアーカイブ。取り込み後すぐ検索できる。
 *
 * 生のまま保持する理由: 「API が想定外の値（null 等）を返す」類の不具合は正規化で潰れてしまい、
 * 正規化後のデータでは再現できない。ダンプがあれば API を叩き直さずに何度でも再現できる。
 *
 * 添付バイナリはこのファイルに含めない（別ファイルの zip）。バイナリを base64 で JSON に
 * 埋めるとサイズが 1.3 倍に膨らむため、backlog-x の書き出しと同じ 2 ファイル構成にする。
 * アイコンは点数が少なく小さいので base64 で内包する（Blob は JSON に入らない）。
 */

import type {
  BacklogProject,
  BacklogIssue,
  BacklogComment,
  BacklogWiki,
  BacklogDocument,
  BacklogProjectMasters,
} from "@/types/backlog";
import type { StoredUser, StoredProjectMember } from "@/types/entities";
import type { IngestSelection } from "@/types/ingest";

/** ダンプファイルのフォーマット識別子（取り込み時に検証する） */
export const BACKLOG_DUMP_FORMAT = "backlog-x-raw-dump";

/**
 * ダンプフォーマットのバージョン。互換性が壊れる変更で上げる。
 * v1: 初版（課題・コメント・Wiki・ドキュメントの生レスポンス + メンバー + アイコン）。
 * v2: プロジェクト定義のマスタ（masters）を追加。課題からの逆算では拾えない「定義済みだが
 *     未使用のマスタ」を保持する。v1 ダンプには無いので取り込み側は任意扱い（逆算のみになる）。
 */
export const BACKLOG_DUMP_VERSION = 2;

/** アイコン画像を base64 で内包した形（StoredUserIcon の Blob を base64 化したもの） */
export interface DumpedUserIcon {
  userId: number;
  /** 画像バイナリの base64（data 部のみ） */
  base64: string;
  contentType: string;
}

/** プロジェクトアイコン（1 プロジェクトに 1 枚なので userId を持たない） */
export interface DumpedProjectIcon {
  base64: string;
  contentType: string;
}

/** Backlog ダンプ本体（.json.gz の中身） */
export interface BacklogDump {
  format: typeof BACKLOG_DUMP_FORMAT;
  version: number;
  /** ダンプを取得した時刻（ISO 8601） */
  dumpedAt: string;
  /** 正規化済みスペース URL（原本リンク用に取り込み先へ引き継ぐ） */
  spaceUrl: string;
  /** 対象プロジェクト（id / projectKey / name を使う） */
  project: BacklogProject;
  /** このダンプを取得したときの選択（取り込み時の既定値になる） */
  selection: IngestSelection;
  /**
   * プロジェクトに定義されたマスタ一式（v2 で追加・v1 ダンプには無い）。
   * 未使用のマスタもここに入るので、取り込み側は課題からの逆算とマージして使う。
   */
  masters?: BacklogProjectMasters;
  /** 課題の生レスポンス */
  rawIssues: BacklogIssue[];
  /** コメントの生レスポンス（全課題ぶんを平坦化。issueId で親に紐づく） */
  rawComments: BacklogComment[];
  /** Wiki の生レスポンス（本文入りの詳細） */
  rawWikis: BacklogWiki[];
  /** ドキュメントの生レスポンス */
  rawDocuments: BacklogDocument[];
  /** プロジェクト参加者 + 権限（roleType） */
  members: StoredProjectMember[];
  /** members の名前・メール解決用ユーザー */
  memberUsers: StoredUser[];
  /** ユーザーアイコン（base64 内包） */
  userIcons: DumpedUserIcon[];
  /** プロジェクトアイコン（未設定・取得失敗なら null） */
  projectIcon: DumpedProjectIcon | null;
}
