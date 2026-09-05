/**
 * 生成した Blob を利用者のダウンロードフォルダに落とす。
 * アーカイブの書き出し（ExportButton）と Backlog ダンプの保存（ApiImporter）で共有する。
 */

"use client";

/** Blob を指定ファイル名でダウンロードさせる */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
