"use client";

import type { StoredUser } from "@/types/entities";
import { userDisplayName } from "@/lib/format";
import { useUserIcon } from "@/lib/datasource/useUserIcon";

/**
 * ユーザーをアイコン + 表示名で表示する。投稿者名義はアーカイブのまま改変しない。
 *
 * アイコンは IndexedDB にローカル保存した Blob を Object URL 化して表示する
 * （Backlog/Nulab の URL を外部参照しない）。アイコンが無ければ頭文字の丸でフォールバック。
 */
export function UserLabel({
  user,
  size = 20,
  showName = true,
}: {
  user: StoredUser | null;
  size?: number;
  showName?: boolean;
}) {
  const name = userDisplayName(user);
  const iconUrl = useUserIcon(user?.id);

  return (
    <span className="inline-flex items-center gap-1.5">
      {iconUrl ? (
        // Object URL（blob:）なので外部リクエストは発生しない
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconUrl}
          alt=""
          width={size}
          height={size}
          className="shrink-0 rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-300 text-[10px] font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
          style={{ width: size, height: size }}
        >
          {name.slice(0, 1)}
        </span>
      )}
      {showName && <span className="text-sm">{name}</span>}
    </span>
  );
}
