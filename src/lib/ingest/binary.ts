/**
 * バイナリ（Blob）と base64 文字列の相互変換。
 *
 * 画像（ユーザー／プロジェクトのアイコン）は Blob のままでは JSON に入らないため、
 * 書き出しファイル（@/types/export）・Backlog ダンプ（@/types/dump）の両方で base64 に
 * して内包する。その変換をここに 1 箇所だけ置き、両方の経路で共有する。
 */

"use client";

/** Blob を base64 文字列（data 部のみ）に変換する */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000; // 引数長の上限を避けて分割
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** base64 文字列（data 部のみ）から Blob を復元する */
export function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}
