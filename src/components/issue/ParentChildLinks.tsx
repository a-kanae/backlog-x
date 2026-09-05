"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDataSource } from "@/lib/datasource/context";
import type { StoredIssue } from "@/types/entities";
import { StatusBadge } from "@/components/ui/StatusBadge";

/**
 * 親課題リンク + 子課題一覧。階層を辿れるようにする。
 * 親子とも DataSource から非同期取得（projectId スコープ越境はしない）。
 */

function IssueLinkRow({ issue }: { issue: StoredIssue }) {
  return (
    <Link
      href={`/projects/${issue.projectId}/issues/${issue.keyId}`}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
    >
      <span className="font-mono text-xs text-zinc-500">{issue.issueKey}</span>
      <StatusBadge master={issue.status} />
      <span className="min-w-0 flex-1 truncate">{issue.summary}</span>
    </Link>
  );
}

export function ParentChildLinks({ issue }: { issue: StoredIssue }) {
  const ds = useDataSource();
  const [parent, setParent] = useState<StoredIssue | null>(null);
  const [children, setChildren] = useState<StoredIssue[]>([]);

  useEffect(() => {
    let cancelled = false;
    // 親取得は parentIssueId が無ければ null を resolve する Promise に統一し、
    // 必ず .then 内で setParent する（effect 直下の同期 setState を避けるため）。
    const parentPromise: Promise<StoredIssue | null> =
      issue.parentIssueId != null
        ? ds
            .getIssueById(issue.projectId, issue.parentIssueId)
            .then((p) => p ?? null)
        : Promise.resolve(null);
    parentPromise.then((p) => {
      if (!cancelled) setParent(p);
    });
    ds.getChildIssues(issue.projectId, issue.id).then((list) => {
      if (!cancelled) setChildren(list);
    });
    return () => {
      cancelled = true;
    };
  }, [ds, issue.projectId, issue.id, issue.parentIssueId]);

  if (!parent && children.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {parent && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-zinc-400">親課題</h3>
          <IssueLinkRow issue={parent} />
        </section>
      )}
      {children.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-zinc-400">
            子課題（{children.length}）
          </h3>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700/60">
            {children.map((c) => (
              <IssueLinkRow key={c.id} issue={c} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
