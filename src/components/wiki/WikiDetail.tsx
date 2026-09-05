"use client";

import { useEffect, useState } from "react";
import type { StoredWiki, StoredUser } from "@/types/entities";
import { useDataSource } from "@/lib/datasource/context";
import { BacklogText } from "@/components/ui/BacklogText";
import { UserLabel } from "@/components/ui/UserLabel";

/**
 * Wiki 詳細。本文は課題 description と同じ Backlog 記法なので BacklogText を再利用する。
 * 投稿者名義・日時（createdUser / updated）は改変せず表示する（read-only 原則）。
 */
export function WikiDetail({ wiki }: { wiki: StoredWiki }) {
  const ds = useDataSource();
  // メンション解決用にユーザー一覧を読む（BacklogText に渡す）
  const [users, setUsers] = useState<StoredUser[]>([]);
  // 本文中の素の課題キー（PROJ-123）を内部リンク化するため projectKey を引く
  const [projectKey, setProjectKey] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    ds.listUsers().then((u) => {
      if (!cancelled) setUsers(u);
    });
    ds.getProject(wiki.projectId).then((meta) => {
      if (!cancelled) setProjectKey(meta?.projectKey);
    });
    return () => {
      cancelled = true;
    };
  }, [ds, wiki.projectId]);

  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{wiki.name}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span>作成: {formatDate(wiki.created)}</span>
          <UserLabel user={wiki.createdUser} size={18} />
          <span className="text-zinc-300 dark:text-zinc-600">｜</span>
          <span>更新: {formatDate(wiki.updated)}</span>
          <UserLabel user={wiki.updatedUser ?? wiki.createdUser} size={18} />
        </div>
        {wiki.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {wiki.tags.map((t) => (
              <span
                key={t.id}
                className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700/60 dark:bg-zinc-900/40">
        {wiki.content.trim() === "" ? (
          <p className="text-sm text-zinc-400">（本文なし）</p>
        ) : (
          <BacklogText
            text={wiki.content}
            projectId={wiki.projectId}
            projectKey={projectKey}
            users={users}
            highlight
          />
        )}
      </div>

      {wiki.attachmentCount > 0 && (
        <p className="text-xs text-zinc-400">
          添付ファイル {wiki.attachmentCount}{" "}
          件（本文中で参照。ファイル本体はこのビューアには取り込んでいません）
        </p>
      )}
    </article>
  );
}

/** ISO 文字列を "YYYY/MM/DD HH:mm" で表示（タイムゾーンはブラウザローカル） */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
