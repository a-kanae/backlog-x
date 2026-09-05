"use client";

import { useEffect, useState } from "react";
import { useDataSource } from "@/lib/datasource/context";
import type { StoredIssue, AttachmentMeta, StoredUser } from "@/types/entities";
import { IssueMeta } from "./IssueMeta";
import { ParentChildLinks } from "./ParentChildLinks";
import { AttachmentList } from "./AttachmentList";
import { BacklogText } from "@/components/ui/BacklogText";
import { CommentThread } from "@/components/comment/CommentThread";
import { projectKeyFromIssueKey } from "@/lib/ingest/normalize";
import { parseDetailHash } from "@/lib/routing/params";
import { scrollToSelectorWithRetry } from "@/lib/highlight/useHighlightInContainer";

/**
 * 課題詳細の本体。ヘッダ → メタ → 詳細(description) → 親子リンク → 添付 → コメント。
 * 投稿者名義・日時はアーカイブのまま改変しない（IssueMeta / CommentThread に委譲）。
 */
export function IssueDetail({ issue }: { issue: StoredIssue }) {
  const ds = useDataSource();
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [users, setUsers] = useState<StoredUser[]>([]);
  const [spaceUrl, setSpaceUrl] = useState<string | undefined>(undefined);
  // 検索の本文ヒット（URL ハッシュ #q=）で来たとき、詳細（description）の枠を強調表示する。
  // コメントヒット（該当コメント枠を強調）と挙動を揃え、本文テキストの <mark> ハイライトはしない。
  const [descHighlighted, setDescHighlighted] = useState(false);
  const projectKey = projectKeyFromIssueKey(issue.issueKey);

  useEffect(() => {
    let cancelled = false;
    ds.listAttachments(issue.projectId, issue.id).then((list) => {
      if (!cancelled) setAttachments(list);
    });
    ds.listUsers().then((list) => {
      if (!cancelled) setUsers(list);
    });
    // 原本（Backlog）リンク用のスペース URL を projectMeta から取得
    ds.getProject(issue.projectId).then((meta) => {
      if (!cancelled) setSpaceUrl(meta?.spaceUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [ds, issue.projectId, issue.id]);

  // 本文ヒット（#q=<語>）で来たら、描画後に「詳細」枠へスクロール＋枠を強調する。
  // コメントヒット（#comment-<id>）とは排他（そちらは CommentThread が該当コメント枠を強調）。
  // 別タブ運用で開いた直後はタブがバックグラウンド化しやすいため、setTimeout ベースの
  // 共通ヘルパ（scrollToSelectorWithRetry）でリトライしつつ instant スクロールする。
  useEffect(() => {
    if (issue.description.trim() === "") return;
    if (parseDetailHash().highlightTerm.trim() === "") return;
    return scrollToSelectorWithRetry(
      () => document.body,
      "#issue-description",
      () => setDescHighlighted(true),
    );
  }, [issue.description]);

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        {/* 課題一覧へのバックリンクは上部のコンテンツカテゴリ「課題」タブで代替するため省略 */}
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm text-zinc-400">
            {issue.issueKey}
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {issue.summary}
        </h1>
      </header>

      <IssueMeta issue={issue} spaceUrl={spaceUrl} />

      {issue.description.trim() !== "" && (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-zinc-500">詳細</h2>
          {/* 検索の本文ヒットで来たら枠を強調（コメントヒットの枠強調と同じ見た目）。
              本文テキストの <mark> ハイライトはしないため BacklogText に highlight は渡さない。 */}
          <div
            id="issue-description"
            className={`scroll-mt-20 rounded-lg border p-4 transition-colors ${
              descHighlighted
                ? "border-amber-300 bg-amber-50 ring-2 ring-amber-300 dark:border-amber-700 dark:bg-amber-950/40 dark:ring-amber-700"
                : "border-zinc-200 dark:border-zinc-700/60"
            }`}
          >
            <BacklogText
              text={issue.description}
              projectId={issue.projectId}
              projectKey={projectKey}
              users={users}
              attachments={attachments}
            />
          </div>
        </section>
      )}

      <ParentChildLinks issue={issue} />

      <AttachmentList projectId={issue.projectId} attachments={attachments} />

      <CommentThread
        projectId={issue.projectId}
        issueId={issue.id}
        projectKey={projectKey}
        users={users}
        attachments={attachments}
      />
    </article>
  );
}
