"use client";

import { useEffect, useState } from "react";
import { useDataSource } from "./context";

/**
 * ユーザーアイコンを IndexedDB の Blob から取得し、Object URL を返すフック。
 *
 * 外部 URL（Backlog/Nulab）は一切参照しない。Blob → Object URL に変換し、
 * unmount・userId 変更時に必ず revoke してリークを防ぐ。
 * アイコンが無い（取り込まれていない）場合は null を返す（呼び出し側で頭文字フォールバック）。
 */
export function useUserIcon(userId: number | null | undefined): string | null {
  const ds = useDataSource();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    // userId が無ければ undefined を resolve する Promise に統一し、必ず .then 内で setState する
    // （effect 直下の同期 setState を避けるため）。
    const blobPromise: Promise<Blob | undefined> =
      userId == null ? Promise.resolve(undefined) : ds.getUserIcon(userId);
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
  }, [ds, userId]);

  return url;
}
