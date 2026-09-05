/**
 * 表示用の整形ヘルパー（純粋関数）。
 *
 * 重要: 日時は「表示の整形」のみ行い、元の値（ISO 8601 文字列）は改変しない。
 * アーカイブの核は投稿者名義・日時の正確な保持なので、保存値はそのまま扱う。
 */

import type { StoredUser } from "@/types/entities";

/** ISO 8601 日時を「YYYY/MM/DD HH:mm」形式（ローカルタイム）に整形。表示専用 */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${mo}/${da} ${h}:${mi}`;
}

/** ISO 8601 日付を「YYYY/MM/DD」形式に整形。表示専用 */
export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}/${mo}/${da}`;
}

/** ユーザーの表示名（なければ「不明なユーザー」） */
export function userDisplayName(user: StoredUser | null): string {
  return user?.name ?? "不明なユーザー";
}

/** バイト数を人が読める単位に整形（例: 1536 → "1.5 KB"） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
