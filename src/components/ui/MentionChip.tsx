"use client";

import type { StoredUser } from "@/types/entities";
import { useUserIcon } from "@/lib/datasource/useUserIcon";

/**
 * メンション（@ユーザー名）の表示。原本（Backlog）に倣いオレンジ色で表示し、
 * ホバーでアイコン + 名前のオーバーレイを出す。
 * user が解決できない（取り込みに居ない）場合もテキストは出す（@名前）。
 */
export function MentionChip({
  name,
  user,
}: {
  name: string;
  user: StoredUser | null;
}) {
  const iconUrl = useUserIcon(user?.id);

  return (
    <span className="group relative inline-block">
      <span className="cursor-default rounded px-0.5 font-medium text-amber-600 dark:text-amber-400">
        @{name}
      </span>
      {/* ホバーで出るオーバーレイ（アイコン + 名前）。メンションの下に出す（行頭だと上が見切れるため）。
          本文より確実に手前に出すため z-50 + 濃い影。直下の本文と密着しないよう mt を取る。
          w-max で内容幅にフィットさせ、名前が右枠からはみ出さないようにする。 */}
      <span className="pointer-events-none absolute top-full left-0 z-50 mt-1.5 hidden w-max max-w-xs rounded-md border border-zinc-200 bg-white px-2.5 py-2 whitespace-nowrap shadow-xl group-hover:flex group-hover:items-center group-hover:gap-2 dark:border-zinc-600 dark:bg-zinc-800">
        {iconUrl ? (
          // Object URL（blob:）なので外部リクエストは発生しない
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={iconUrl}
            alt=""
            width={24}
            height={24}
            className="shrink-0 rounded-full"
          />
        ) : (
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-300 text-[10px] font-medium text-zinc-700 dark:bg-zinc-600 dark:text-zinc-200">
            {name.slice(0, 1)}
          </span>
        )}
        <span className="shrink-0 text-sm text-zinc-800 dark:text-zinc-100">
          {name}
        </span>
      </span>
    </span>
  );
}
