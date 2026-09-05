"use client";

import { useEffect, useState } from "react";
import { Paperclip, Download } from "lucide-react";
import type { AttachmentMeta } from "@/types/entities";
import { formatBytes } from "@/lib/format";
import { getAttachmentBlob, hasAttachmentBlob } from "@/lib/storage/opfs";

/**
 * 添付ファイルの一覧。
 *
 * メタ（名前・サイズ・登録者）は IndexedDB から渡される。バイナリ本体は取り込み時に
 * 「添付ファイルも含める」を選んだ場合のみ OPFS に保存されており、その場合はダウンロード
 * ボタンを出す。保存されていなければメタのみ表示（本体なしの注記）。
 */
export function AttachmentList({
  projectId,
  attachments,
}: {
  projectId: number;
  attachments: AttachmentMeta[];
}) {
  // OPFS にバイナリが保存されている添付 id の集合
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = new Set<number>();
      for (const att of attachments) {
        if (await hasAttachmentBlob(projectId, att.id)) ids.add(att.id);
      }
      if (!cancelled) setSavedIds(ids);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, attachments]);

  if (attachments.length === 0) return null;

  const anySaved = savedIds.size > 0;

  async function handleDownload(att: AttachmentMeta) {
    const blob = await getAttachmentBlob(projectId, att.id);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = att.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-zinc-400">
        添付ファイル（{attachments.length}）
      </h3>
      <ul className="rounded-lg border border-zinc-200 dark:border-zinc-700/60">
        {attachments.map((att) => {
          const saved = savedIds.has(att.id);
          return (
            <li
              key={att.id}
              className="flex items-center gap-3 border-b border-zinc-100 px-3 py-2 last:border-b-0 dark:border-zinc-700/60"
            >
              <Paperclip
                className="size-4 shrink-0 text-zinc-400"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-200">
                {att.name}
              </span>
              <span className="shrink-0 text-xs text-zinc-400 tabular-nums">
                {formatBytes(att.size)}
              </span>
              {saved && (
                <button
                  type="button"
                  onClick={() => handleDownload(att)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <Download className="size-3.5" aria-hidden />
                  ダウンロード
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {!anySaved && (
        <p className="text-xs text-zinc-400">
          ※
          メタ情報のみ取り込み済み。ファイル本体はこのアーカイブに含まれていません（取り込み時に
          「添付ファイルも含める」を選ぶと本体も保存されます）。
        </p>
      )}
    </section>
  );
}
