"use client";

import type { StoredDocument } from "@/types/entities";
import { UserLabel } from "@/components/ui/UserLabel";
import { MarkdownText } from "@/components/ui/MarkdownText";

/**
 * ドキュメント詳細。本文 plain は Backlog ドキュメント機能の標準 Markdown なので、
 * MarkdownText（react-markdown + remark-gfm）で整形して表示する（Wiki の BacklogText と
 * スタイルを揃える）。投稿者名義・日時は改変せず表示する（read-only 原則）。
 */
export function DocumentDetail({
  document: doc,
}: {
  document: StoredDocument;
}) {
  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          {doc.emoji && <span aria-hidden>{doc.emoji}</span>}
          <span>{doc.title || "(無題)"}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span>作成: {formatDate(doc.created)}</span>
          <UserLabel user={doc.createdUser} size={18} />
          <span className="text-zinc-300 dark:text-zinc-600">｜</span>
          <span>更新: {formatDate(doc.updated)}</span>
          <UserLabel user={doc.updatedUser ?? doc.createdUser} size={18} />
        </div>
        {doc.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {doc.tags.map((t) => (
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
        {doc.plain.trim() === "" ? (
          <p className="text-sm text-zinc-400">（本文なし）</p>
        ) : (
          <MarkdownText text={doc.plain} highlight />
        )}
      </div>

      {doc.attachmentCount > 0 && (
        <p className="text-xs text-zinc-400">
          添付ファイル {doc.attachmentCount}{" "}
          件（ファイル本体はこのビューアには取り込んでいません）
        </p>
      )}
    </article>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
