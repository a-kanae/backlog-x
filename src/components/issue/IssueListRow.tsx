import Link from "next/link";
import type { StoredIssue } from "@/types/entities";
import type { IssueSort } from "@/lib/datasource/types";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { UserLabel } from "@/components/ui/UserLabel";
import { formatDateTime } from "@/lib/format";

/**
 * 課題一覧の 1 行。各列を固定幅にしてテーブル的に整列させる（バッジは内容で幅が変わるため
 * 固定幅の枠に入れて列位置を揃える）。列見出しは IssueList のヘッダ行が担う。
 * 末尾の日時はソート中のフィールドに連動（登録日ソート中は登録日、それ以外は更新日）。
 */
export function IssueListRow({
  issue,
  sort,
}: {
  issue: StoredIssue;
  sort: IssueSort;
}) {
  const date = sort === "created" ? issue.created : issue.updated;
  return (
    <Link
      href={`/projects/${issue.projectId}/issues/${issue.keyId}`}
      // 一覧に最大 50 行並ぶため、自動 prefetch による大量の RSC キャッシュが
      // 左右キーでの兄弟ルート遷移と衝突し Hydration エラーを起こすため無効化。
      prefetch={false}
      className="flex items-center gap-3 border-b border-zinc-100 px-4 py-2.5 transition-colors hover:bg-zinc-50 dark:border-zinc-700/60 dark:hover:bg-zinc-800"
    >
      {/* キー（固定幅・等幅） */}
      <span className="w-16 shrink-0 font-mono text-xs text-zinc-500 dark:text-zinc-400">
        {issue.issueKey}
      </span>
      {/* ステータス（固定幅の枠にバッジを入れて左揃え） */}
      <span className="flex w-20 shrink-0">
        <StatusBadge master={issue.status} />
      </span>
      {/* 種別（固定幅の枠。狭い画面では隠す） */}
      <span className="hidden w-16 shrink-0 sm:flex">
        <StatusBadge master={issue.issueType} />
      </span>
      {/* 件名（可変・truncate） */}
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">
        {issue.summary}
      </span>
      {/* 担当者（固定幅・アイコン + 名前・はみ出しは隠す） */}
      <span className="hidden w-32 shrink-0 overflow-hidden lg:flex">
        {issue.assignee ? (
          <span className="min-w-0 truncate text-xs text-zinc-600 dark:text-zinc-300">
            <UserLabel user={issue.assignee} size={18} />
          </span>
        ) : null}
      </span>
      {/* 日時（固定幅・等幅数字） */}
      <span className="hidden w-32 shrink-0 text-right text-xs text-zinc-400 tabular-nums md:inline">
        {formatDateTime(date)}
      </span>
    </Link>
  );
}
