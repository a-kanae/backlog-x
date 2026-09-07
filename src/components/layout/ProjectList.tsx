"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDataSource } from "@/lib/datasource/context";
import type { ProjectMeta } from "@/types/entities";
import { formatDateTime } from "@/lib/format";
import { ExportButton } from "@/components/ingest/ExportButton";
import { RebuildIndexButton } from "@/components/ingest/RebuildIndexButton";
import { SampleDataButton } from "@/components/ingest/SampleDataButton";
import { DeleteProjectButton } from "@/components/ingest/DeleteProjectButton";
import { ProjectIcon } from "@/components/ui/ProjectIcon";
import { listSavedAttachmentIds } from "@/lib/storage/opfs";

export function ProjectList() {
  const ds = useDataSource();
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  // 添付「本体」が OPFS に実際に保存されている件数（projectId → 件数）。
  // メタ件数（ProjectMeta.attachmentCount = Backlog 上の添付数）と区別し、
  // このオリジンで実際に DL できる添付の数だけをカードに出すため別途取得する。
  const [savedAttachments, setSavedAttachments] = useState<Map<number, number>>(
    new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    ds.listProjects().then(async (list) => {
      if (cancelled) return;
      setProjects(list);
      // 各プロジェクトの OPFS 保存数を取得（DL 可能な添付の実数）
      const counts = new Map<number, number>();
      for (const p of list) {
        const ids = await listSavedAttachmentIds(p.projectId);
        counts.set(p.projectId, ids.length);
      }
      if (!cancelled) setSavedAttachments(counts);
    });
    return () => {
      cancelled = true;
    };
  }, [ds]);

  if (projects === null) {
    return <p className="text-sm text-zinc-400">読み込み中…</p>;
  }

  if (projects.length === 0) {
    return (
      <section className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-6 dark:border-zinc-700/60">
        <h2 className="text-lg font-medium">はじめに</h2>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          まだデータが取り込まれていません。エクスポート済みの Backlog
          データを取り込むと、
          課題・コメントを検索・閲覧できます。データはブラウザのローカル
          DB（IndexedDB）にのみ 保存され、外部には送信されません。
        </p>
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/setup"
            className="inline-flex w-fit items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            データを取り込む
          </Link>
          <SampleDataButton />
        </div>
        <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          Backlog のアカウントがなくても、
          <strong className="font-medium text-zinc-700 dark:text-zinc-300">
            サンプルデータ
          </strong>
          を読み込めば一覧・全文検索・課題詳細をそのまま試せます（架空のプロジェクト・課題
          60 件）。読み込んだデータもこのブラウザの中だけに保存されます。
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {projects.map((p) => (
          <li
            key={p.projectId}
            className="flex items-center gap-3 rounded-lg border border-zinc-200 p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-700/60 dark:hover:bg-zinc-800"
          >
            <Link
              href={`/projects/${p.projectId}`}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              <ProjectIcon
                projectId={p.projectId}
                projectKey={p.projectKey}
                size={40}
                className="shrink-0"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-baseline gap-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="font-mono text-xs text-zinc-400">
                    {p.projectKey}
                  </span>
                </span>
                <span className="text-xs text-zinc-500">
                  {/* どの種類のデータがあるかを必ず見せるため、0 件でも全項目を表示する。
                    添付は OPFS に本体が保存されている数（このオリジンで DL できる実数）。 */}
                  課題 {p.issueCount.toLocaleString()} 件 / コメント{" "}
                  {p.commentCount.toLocaleString()} 件 / 添付{" "}
                  {(savedAttachments.get(p.projectId) ?? 0).toLocaleString()} 件
                  / Wiki {(p.wikiCount ?? 0).toLocaleString()} 件 / ドキュメント{" "}
                  {(p.documentCount ?? 0).toLocaleString()} 件
                </span>
                <span className="text-xs text-zinc-400">
                  取り込み: {formatDateTime(p.lastImportedAt)}
                </span>
              </span>
            </Link>
            <RebuildIndexButton projectId={p.projectId} />
            <ExportButton projectId={p.projectId} projectKey={p.projectKey} />
            <DeleteProjectButton
              projectId={p.projectId}
              projectKey={p.projectKey}
              onDeleted={(deletedId) =>
                setProjects(
                  (prev) =>
                    prev?.filter((x) => x.projectId !== deletedId) ?? null,
                )
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
