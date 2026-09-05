"use client";

import { useEffect, useState } from "react";
import { useDataSource } from "./context";

/**
 * プロジェクトアイコンを IndexedDB の Blob から取得し、Object URL を返すフック。
 *
 * useUserIcon と同型。外部 URL（Backlog）は一切参照せず、Blob → Object URL に変換し、
 * unmount・projectId 変更時に必ず revoke してリークを防ぐ。
 * アイコンが無い（未設定・未取り込み）場合は null を返す（呼び出し側でフォールバック表示）。
 */
export function useProjectIcon(
  projectId: number | null | undefined,
): string | null {
  const ds = useDataSource();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    // projectId が無ければ undefined を resolve する Promise に統一し、必ず .then 内で setState する
    // （effect 直下の同期 setState を避けるため）。
    const blobPromise: Promise<Blob | undefined> =
      projectId == null
        ? Promise.resolve(undefined)
        : ds.getProjectIcon(projectId);
    blobPromise.then((blob) => {
      if (cancelled) return;
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } else {
        setUrl(null);
      }
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ds, projectId]);

  return url;
}
