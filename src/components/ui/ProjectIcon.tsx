"use client";

/**
 * プロジェクトアイコン表示。
 *
 * 取り込み済みなら IndexedDB の Blob（useProjectIcon が Object URL 化）を角丸スクエアで表示し、
 * 未取り込み/未設定なら projectKey の頭文字を出すフォールバック。外部 URL は一切参照しない。
 * 一覧（ProjectList）とヘッダー（ProjectWorkspace）で共用する。
 */

import { useProjectIcon } from "@/lib/datasource/useProjectIcon";

export function ProjectIcon({
  projectId,
  projectKey,
  size = 36,
  className = "",
}: {
  projectId: number;
  /** フォールバック時に頭文字を出すためのキー（例 "PROJ"） */
  projectKey: string;
  /** ピクセルサイズ（正方形） */
  size?: number;
  className?: string;
}) {
  const iconUrl = useProjectIcon(projectId);
  const rounded = "rounded-lg";

  if (iconUrl) {
    return (
      // next/image は static export の制約と Blob URL の相性を避けるため使わず素の img。
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconUrl}
        alt=""
        width={size}
        height={size}
        className={`${rounded} object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  // フォールバック: 頭文字を角丸スクエアに。背景はロゴのプラムと被らない中間グレー。
  const initial = projectKey.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center ${rounded} bg-zinc-200 font-mono font-semibold text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300 ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
    >
      {initial}
    </span>
  );
}
