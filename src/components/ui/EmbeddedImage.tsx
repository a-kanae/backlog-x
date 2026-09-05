"use client";

import { useEffect, useState } from "react";
import type { AttachmentMeta } from "@/types/entities";
import { getAttachmentBlob } from "@/lib/storage/opfs";

/**
 * 本文に埋め込まれた画像（Backlog 記法の `#image(name)`）。
 *
 * Backlog は**添付ファイル名**でしか参照しないので、課題の添付メタから同名のものを引き、
 * OPFS に保存されているバイナリを objectURL にして表示する（同名が複数あれば先頭 1 件）。
 *
 * 本体が無いとき（添付メタが無い / 取り込み時に「添付ファイルも含める」を選ばなかった）は、
 * 従来どおり `（画像: name）` のプレースホルダを出す。アーカイヴの正確性を優先し、
 * 「参照されているが手元に無い」ことを黙って消さない。
 */
export function EmbeddedImage({
  projectId,
  name,
  attachments,
}: {
  projectId: number;
  /** `#image(...)` に書かれた添付ファイル名 */
  name: string;
  /** この本文が属する課題の添付メタ（名前で照合する） */
  attachments: AttachmentMeta[];
}) {
  const meta = attachments.find((a) => a.name === name) ?? null;
  const attachmentId = meta?.id ?? null;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (attachmentId === null) return;
    let cancelled = false;
    // objectURL は「この effect で作ったもの」だけを解放したいので、
    // state ではなくローカル変数を cleanup で参照する。
    let objectUrl: string | null = null;
    (async () => {
      const blob = await getAttachmentBlob(projectId, attachmentId);
      if (!blob || cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [projectId, attachmentId]);

  if (url === null) {
    // 解決前・本体なしのいずれもプレースホルダ（読み込みは一瞬なのでスピナーは出さない）。
    return <span className="text-zinc-400">（画像: {name}）</span>;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={name}
        title={name}
        className="my-2 max-h-[30rem] max-w-full rounded-lg border border-zinc-200 dark:border-zinc-700/60"
      />
    </a>
  );
}
