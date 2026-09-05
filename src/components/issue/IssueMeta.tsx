"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import type { StoredIssue } from "@/types/entities";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { UserLabel } from "@/components/ui/UserLabel";
import { formatDate, formatDateTime } from "@/lib/format";

/**
 * 課題のメタ情報（種別・状態・優先度・担当者・カテゴリー・日付・工数・作成/更新者）。
 * 値はアーカイブのまま改変しない。未設定は「—」で揃える。
 *
 * 既定では先頭の数項目だけ表示し、「さらに見る」で全項目を展開する（項目が多く縦に長いため）。
 * 2 カラム表示なので「3 段」= 先頭 6 項目（= 左右 3 行ぶん）を初期表示にする。
 */

/** 初期表示する項目数（2 カラム × 3 行 = 6 項目）。これを超える項目は展開時のみ表示 */
const INITIAL_ROWS = 6;

function Row({
  label,
  children,
  fullWidth = false,
}: {
  label: string;
  children: React.ReactNode;
  /** 横幅いっぱい使う行（原本リンクなど）。グリッドで 2 カラムぶんを占有する */
  fullWidth?: boolean;
}) {
  return (
    <div
      className={`flex gap-3 border-b border-zinc-100 py-1.5 dark:border-zinc-700/60 ${
        fullWidth ? "sm:col-span-2" : ""
      }`}
    >
      <dt className="w-24 shrink-0 text-xs text-zinc-400">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-zinc-700 dark:text-zinc-200">
        {children}
      </dd>
    </div>
  );
}

const DASH = <span className="text-zinc-300 dark:text-zinc-600">—</span>;

export function IssueMeta({
  issue,
  spaceUrl,
}: {
  issue: StoredIssue;
  /** 取り込みプロジェクトのスペース URL。あれば原本（Backlog）リンクを出す */
  spaceUrl?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  // 末尾スラッシュを除いた正規化済みスペース URL（未設定なら原本リンクを出さない）
  const backlogSpaceUrl = (spaceUrl ?? "").replace(/\/+$/, "");

  // 通常項目（折りたたみ対象）。原本リンクは常に最後・全幅で別途出す。
  const rows: React.ReactNode[] = [
    <Row key="status" label="状態">
      <StatusBadge master={issue.status} />
    </Row>,
    <Row key="type" label="種別">
      <StatusBadge master={issue.issueType} />
    </Row>,
    <Row key="assignee" label="担当者">
      {issue.assignee ? <UserLabel user={issue.assignee} /> : DASH}
    </Row>,
    <Row key="priority" label="優先度">
      {issue.priority?.name ?? DASH}
    </Row>,
    <Row key="category" label="カテゴリー">
      {issue.category.length > 0
        ? issue.category.map((c) => c.name).join("、 ")
        : DASH}
    </Row>,
    <Row key="milestone" label="マイルストーン">
      {(issue.milestones ?? []).length > 0
        ? (issue.milestones ?? []).map((m) => m.name).join("、 ")
        : DASH}
    </Row>,
    <Row key="version" label="発生バージョン">
      {(issue.versions ?? []).length > 0
        ? (issue.versions ?? []).map((v) => v.name).join("、 ")
        : DASH}
    </Row>,
    <Row key="resolution" label="完了理由">
      {issue.resolution?.name ?? DASH}
    </Row>,
    <Row key="start" label="開始日">
      {issue.startDate ? formatDate(issue.startDate) : DASH}
    </Row>,
    <Row key="due" label="期限日">
      {issue.dueDate ? formatDate(issue.dueDate) : DASH}
    </Row>,
    <Row key="estimated" label="予定時間">
      {issue.estimatedHours != null ? `${issue.estimatedHours} 時間` : DASH}
    </Row>,
    <Row key="actual" label="実績時間">
      {issue.actualHours != null ? `${issue.actualHours} 時間` : DASH}
    </Row>,
    <Row key="created" label="登録">
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <UserLabel user={issue.createdUser} size={18} />
        <span className="text-xs text-zinc-400 tabular-nums">
          {formatDateTime(issue.created)}
        </span>
      </span>
    </Row>,
    <Row key="updated" label="更新">
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {issue.updatedUser ? (
          <UserLabel user={issue.updatedUser} size={18} />
        ) : (
          DASH
        )}
        <span className="text-xs text-zinc-400 tabular-nums">
          {formatDateTime(issue.updated)}
        </span>
      </span>
    </Row>,
  ];

  // 原本リンクも折りたたみ対象に含める（初期は先頭 6 項目 = 3 段のみ表示）。
  if (backlogSpaceUrl) {
    rows.push(
      <Row key="origin" label="原本" fullWidth>
        <a
          href={`${backlogSpaceUrl}/view/${issue.issueKey}`}
          target="_blank"
          rel="noopener noreferrer"
          // Row の border-b と二重線にならないよう通常時は下線なし・hover でのみ下線
          className="inline-flex items-center gap-1 text-sm text-sky-600 hover:underline dark:text-sky-400"
        >
          Backlog で開く（{issue.issueKey}）
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </Row>,
    );
  }

  const visibleRows = expanded ? rows : rows.slice(0, INITIAL_ROWS);
  const hasMore = rows.length > INITIAL_ROWS;

  return (
    <div className="flex flex-col gap-2">
      {/* 外枠は付けず、行間の border-b だけで区切る（枠下辺と最終行下線の二重線を避ける） */}
      <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">{visibleRows}</dl>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex w-fit items-center gap-1 self-center text-xs text-zinc-500 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          {expanded ? (
            <>
              閉じる
              <ChevronUp className="size-3.5" aria-hidden />
            </>
          ) : (
            <>
              さらに見る
              <ChevronDown className="size-3.5" aria-hidden />
            </>
          )}
        </button>
      )}
    </div>
  );
}
