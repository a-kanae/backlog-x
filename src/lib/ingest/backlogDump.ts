/**
 * Backlog ダンプ（.json.gz）の書き出し / 読み込み。
 *
 * ダンプは「Backlog API の生レスポンス」を保持したファイル（スキーマは @/types/dump）。
 * 取り込み処理そのものは seed.ts の ingestFromDump が担うので、ここはファイル入出力と検証だけ。
 *
 * 用途:
 * - 取り込みのたびに Backlog API を叩かずに済ませる（不具合の再現・再取り込みを手元で回す）。
 * - API キーを持たない／渡したくないメンバーにも、管理者が作ったダンプを配って取り込ませる。
 *
 * 添付バイナリは別ファイル（zip）で、書き出し・読み込みとも backlog-x の書き出しと同じ
 * exportAttachmentsZip / importAttachmentsZip を流用する（処理系を共有する）。
 */

"use client";

import type { BacklogDump } from "@/types/dump";
import { BACKLOG_DUMP_FORMAT, BACKLOG_DUMP_VERSION } from "@/types/dump";
import { gzipJson, gunzipToJson } from "./projectArchive";

/** ダンプ本体のファイル名（例: backlog-raw-TH7.json.gz） */
export function dumpFileName(projectKey: string): string {
  return `backlog-raw-${projectKey}.json.gz`;
}

/** ダンプの添付 zip のファイル名（例: backlog-raw-TH7-attachments.zip） */
export function dumpAttachmentsFileName(projectKey: string): string {
  return `backlog-raw-${projectKey}-attachments.zip`;
}

/** ダンプを gzip 圧縮した Blob（.json.gz の中身）にする */
export function serializeDump(dump: BacklogDump): Promise<Blob> {
  return gzipJson(JSON.stringify(dump));
}

/**
 * パース済み JSON が Backlog ダンプかどうかを判定する。
 * backlog-x の書き出しファイル（format=backlog-x-archive）と同じ拡張子なので、
 * ファイル選択時の振り分けにも使う。
 */
export function isBacklogDump(parsed: unknown): parsed is BacklogDump {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as Record<string, unknown>).format === BACKLOG_DUMP_FORMAT
  );
}

/**
 * ダンプファイル（.json.gz）を解凍・パース・検証して BacklogDump として返す。
 * フォーマット不一致・未対応バージョン・必須フィールド欠落は例外。
 */
export async function parseDumpFile(file: Blob): Promise<BacklogDump> {
  const text = await gunzipToJson(file);
  const parsed: unknown = JSON.parse(text);
  return validateDump(parsed);
}

/**
 * パース済み JSON が BacklogDump の形をしているか検証する。
 * any/unknown を表に出さず、必要なフィールドの型を絞り込んでから返す。
 */
export function validateDump(parsed: unknown): BacklogDump {
  if (!isBacklogDump(parsed)) {
    throw new Error("Backlog ダンプファイルではありません");
  }
  const obj = parsed as unknown as Record<string, unknown>;
  if (typeof obj.version !== "number" || obj.version > BACKLOG_DUMP_VERSION) {
    throw new Error(
      `このダンプのバージョン（${String(obj.version)}）には対応していません。アプリを更新してください`,
    );
  }
  const project = obj.project;
  if (
    typeof project !== "object" ||
    project === null ||
    typeof (project as Record<string, unknown>).id !== "number" ||
    typeof (project as Record<string, unknown>).projectKey !== "string"
  ) {
    throw new Error("ダンプのプロジェクト情報が壊れています");
  }
  for (const field of [
    "rawIssues",
    "rawComments",
    "rawWikis",
    "rawDocuments",
    "members",
    "memberUsers",
    "userIcons",
  ]) {
    if (!Array.isArray(obj[field])) {
      throw new Error(`ダンプのデータ（${field}）が壊れています`);
    }
  }
  const selection = obj.selection;
  if (typeof selection !== "object" || selection === null) {
    throw new Error("ダンプの取得条件（selection）が壊れています");
  }
  return parsed;
}
