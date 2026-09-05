"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { WikiHeading } from "@/types/entities";
import { useDataSource } from "@/lib/datasource/context";
import {
  buildWikiTree,
  ancestorPathsOf,
  type WikiTreeNode,
} from "@/lib/wiki/tree";

/**
 * Wiki 画面の右サイドバー（Backlog 本家の「タグ一覧」「ページ一覧」を再現）。
 *
 * - ページ一覧: name の "/" 区切りから階層ツリーを組み、展開トグル + 現在ページのハイライト。
 *   初期表示では現在ページまでの祖先パスだけ開いた状態にする（本家と同じ挙動）。
 * - タグ一覧: 全 Wiki の tags を集計してタグ別件数を出す（0 件なら「タグがまだつけられていません。」）。
 *
 * データ取得は軽量見出し（listWikiHeadings）のみ。本文 content は読まない。
 */
export function WikiSidebar({
  projectId,
  currentWikiId,
}: {
  projectId: number;
  /** 現在表示中の Wiki id（一覧ページなど未選択時は undefined） */
  currentWikiId?: number;
}) {
  const ds = useDataSource();
  const [headings, setHeadings] = useState<WikiHeading[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    ds.listWikiHeadings(projectId).then((h) => {
      if (!cancelled) setHeadings(h);
    });
    return () => {
      cancelled = true;
    };
  }, [ds, projectId]);

  const tree = useMemo(
    () => (headings ? buildWikiTree(headings) : []),
    [headings],
  );

  // タグ集計（name でまとめ、件数降順 → 名前昇順）
  const tagCounts = useMemo(() => {
    if (!headings) return [];
    const map = new Map<string, number>();
    for (const h of headings) {
      for (const t of h.tags) map.set(t.name, (map.get(t.name) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"));
  }, [headings]);

  return (
    <aside className="flex w-full flex-col gap-5 lg:w-72">
      <TagSection
        tagCount={headings ? tagCounts.length : null}
        tags={tagCounts}
      />
      <PageSection
        tree={tree}
        total={headings?.length ?? null}
        projectId={projectId}
        currentWikiId={currentWikiId}
      />
    </aside>
  );
}

function SectionTitle({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: number | null;
}) {
  return (
    <h2 className="flex items-baseline gap-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
      {children}
      {count != null && (
        <span className="text-xs font-normal text-zinc-400">({count})</span>
      )}
    </h2>
  );
}

function TagSection({
  tagCount,
  tags,
}: {
  tagCount: number | null;
  tags: { name: string; count: number }[];
}) {
  return (
    <section className="flex flex-col gap-2">
      <SectionTitle count={tagCount}>タグ一覧</SectionTitle>
      <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700/60">
        {tagCount === null ? (
          <p className="text-xs text-zinc-400">読み込み中…</p>
        ) : tags.length === 0 ? (
          <p className="text-xs text-zinc-500">
            タグがまだつけられていません。
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <li
                key={t.name}
                className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              >
                <span>{t.name}</span>
                <span className="text-zinc-400">{t.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PageSection({
  tree,
  total,
  projectId,
  currentWikiId,
}: {
  tree: WikiTreeNode[];
  total: number | null;
  projectId: number;
  currentWikiId?: number;
}) {
  // 初期展開: 現在ページまでの祖先パス（ツリー・現在ページから導出。state にしない）。
  // effect 内の同期 setState を避けるため、初期状態は useMemo で求め、ユーザーの手動
  // トグルだけを overrides（path → 開いているか）に重ねる。
  const initialOpen = useMemo(() => {
    if (tree.length === 0 || currentWikiId == null) return new Set<string>();
    return new Set(ancestorPathsOf(tree, currentWikiId));
  }, [tree, currentWikiId]);

  // ユーザーが手動で開閉したパスの上書き。未操作のパスは initialOpen に従う。
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());

  const isExpanded = (path: string): boolean => {
    const o = overrides.get(path);
    return o === undefined ? initialOpen.has(path) : o;
  };

  const toggle = (path: string) => {
    const current = isExpanded(path);
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(path, !current);
      return next;
    });
  };

  // 「実ページかつ子あり」の親リンクをクリックしたとき、遷移と同時にそのノードを開く（要望②）。
  // toggle と違い常に開く方向にだけ倒す（既に開いていれば維持）。
  const expand = (path: string) => {
    setOverrides((prev) => {
      if (prev.get(path) === true) return prev;
      const next = new Map(prev);
      next.set(path, true);
      return next;
    });
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <SectionTitle count={total}>ページ一覧</SectionTitle>
        <Link
          href={`/projects/${projectId}/wikis/list`}
          className="shrink-0 text-xs text-sky-700 hover:underline dark:text-sky-400"
        >
          更新順で一覧
        </Link>
      </div>
      <div className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-700/60">
        {total === null ? (
          <p className="px-1 py-0.5 text-xs text-zinc-400">読み込み中…</p>
        ) : tree.length === 0 ? (
          <p className="px-1 py-0.5 text-xs text-zinc-500">
            Wiki がありません。
          </p>
        ) : (
          <ul className="flex flex-col">
            {tree.map((node) => (
              <WikiTreeItem
                key={node.path}
                node={node}
                depth={0}
                projectId={projectId}
                currentWikiId={currentWikiId}
                isExpanded={isExpanded}
                onToggle={toggle}
                onExpand={expand}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function WikiTreeItem({
  node,
  depth,
  projectId,
  currentWikiId,
  isExpanded,
  onToggle,
  onExpand,
}: {
  node: WikiTreeNode;
  depth: number;
  projectId: number;
  currentWikiId?: number;
  isExpanded: (path: string) => boolean;
  onToggle: (path: string) => void;
  onExpand: (path: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = isExpanded(node.path);
  const isCurrent = node.wikiId != null && node.wikiId === currentWikiId;
  // 階層の字下げ。トグル無しの葉でも三角ぶん（16px）を空けて縦線を揃える。
  const indentPx = depth * 14;

  const label = node.label;
  const labelClass = isCurrent
    ? "font-medium text-zinc-900 dark:text-zinc-50"
    : node.wikiId != null
      ? "text-sky-700 hover:underline dark:text-sky-400"
      : "text-zinc-600 dark:text-zinc-300";

  return (
    <li>
      <div
        className={`flex items-center gap-0.5 rounded px-1 py-1 text-sm ${
          isCurrent ? "bg-zinc-100 dark:bg-zinc-800" : ""
        }`}
        style={{ paddingLeft: `${indentPx + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.path)}
            aria-label={isOpen ? "折りたたむ" : "展開する"}
            className="flex h-4 w-4 shrink-0 items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <span
              className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
            >
              ▸
            </span>
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" aria-hidden />
        )}
        {node.wikiId != null ? (
          <Link
            href={`/projects/${projectId}/wikis/${node.wikiId}`}
            // 親が実ページかつ子を持つ場合、遷移と同時にこのノードを展開する（要望②）。
            onClick={() => hasChildren && onExpand(node.path)}
            // サイドバーは Wiki カテゴリを開いている間ずっと表示され続け、ツリーが
            // 最大 199 件のノードを持つ。自動 prefetch による大量の RSC キャッシュが
            // 兄弟ルート（/wikis 一覧）への遷移と衝突し Hydration エラーを起こすため無効化。
            prefetch={false}
            className={`min-w-0 flex-1 truncate ${labelClass}`}
            title={label}
          >
            {label}
          </Link>
        ) : (
          // 実体の無いフォルダ: ラベルクリックでも開閉できるようにする
          <button
            type="button"
            onClick={() => hasChildren && onToggle(node.path)}
            className={`min-w-0 flex-1 truncate text-left ${labelClass}`}
            title={label}
          >
            {label}
          </button>
        )}
      </div>
      {hasChildren && isOpen && (
        <ul className="flex flex-col">
          {node.children.map((child) => (
            <WikiTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              projectId={projectId}
              currentWikiId={currentWikiId}
              isExpanded={isExpanded}
              onToggle={onToggle}
              onExpand={onExpand}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
