"use client";

import { useEffect, useRef, useState } from "react";
import { useDataSource } from "@/lib/datasource/context";
import type { StoredIssue } from "@/types/entities";
import type { IssueFilter, IssueSort, SortOrder } from "@/lib/datasource/types";
import { IssueListRow } from "./IssueListRow";

const PAGE_SIZE = 50;

export interface IssueListProps {
  projectId: number;
  filter: IssueFilter;
  sort: IssueSort;
  order: SortOrder;
}

interface LoadState {
  items: StoredIssue[];
  total: number;
  /** 読み込み済み件数（次に読む offset） */
  loaded: number;
  /** これ以上読むページが無いか */
  allLoaded: boolean;
  /** 読みたいページ数。sentinel 可視で +1 し、effect が不足分を読む */
  wantPages: number;
}

const INITIAL: LoadState = {
  items: [],
  total: 0,
  loaded: 0,
  allLoaded: false,
  wantPages: 1,
};

/** フィルタ・ソートを安定したキー文字列にする（変化検知用） */
function queryKey(
  projectId: number,
  filter: IssueFilter,
  sort: IssueSort,
  order: SortOrder,
): string {
  return JSON.stringify({ projectId, filter, sort, order });
}

export function IssueList({ projectId, filter, sort, order }: IssueListProps) {
  const ds = useDataSource();
  const [state, setState] = useState<LoadState>(INITIAL);

  const key = queryKey(projectId, filter, sort, order);

  // 条件が変わった瞬間にレンダー中リセットする（effect での同期 setState を避ける公式パターン）。
  const [renderedKey, setRenderedKey] = useState(key);
  if (renderedKey !== key) {
    setRenderedKey(key);
    setState(INITIAL);
  }

  // 読み込んだページ数（= loaded / PAGE_SIZE を端数込みで管理）。
  // 「あと 1 ページ読むべきか」は loadedPages < wantPages で判定する。
  const loadedPages = Math.ceil(state.loaded / PAGE_SIZE);
  const needMore = !state.allLoaded && loadedPages < state.wantPages;

  // 不足ページを読む。発火条件は key（リセット後の初回）と「読むべき状態か」。
  // setState は .then 内（非同期）でのみ呼ぶので set-state-in-effect に当たらない。
  useEffect(() => {
    // 初回（loaded=0）か、wantPages に満たないとき読む
    if (state.loaded > 0 && !needMore) return;
    let cancelled = false;
    const offset = state.loaded;
    ds.listIssues({
      projectId,
      offset,
      limit: PAGE_SIZE,
      filter,
      sort,
      order,
    }).then((result) => {
      if (cancelled) return;
      setState((prev) => {
        // key が変わってリセットされた後の古い結果なら破棄（offset 不整合で検出）
        if (offset !== prev.loaded) return prev;
        const items =
          offset === 0 ? result.items : [...prev.items, ...result.items];
        return {
          ...prev,
          items,
          total: result.total,
          loaded: offset + result.items.length,
          allLoaded: items.length >= result.total || result.items.length === 0,
        };
      });
    });
    return () => {
      cancelled = true;
    };
    // key（条件）・state.loaded・needMore の変化で再評価する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, key, state.loaded, needMore]);

  // 「もっと読む」を要求する最新関数を ref に同期し、observer から stale 無しで呼ぶ。
  // observer 自体は一度だけ生成し、sentinel の出現/消滅に追従させる。
  const requestMoreRef = useRef<() => void>(() => {});
  useEffect(() => {
    requestMoreRef.current = () => {
      // 読み込み中（loadedPages < wantPages）や完了時は増やさない
      if (state.allLoaded) return;
      if (loadedPages < state.wantPages) return;
      setState((prev) => ({ ...prev, wantPages: prev.wantPages + 1 }));
    };
  }, [state.allLoaded, state.wantPages, loadedPages]);

  const hasItems = state.items.length > 0;
  // sentinel が DOM に出ている条件（下の JSX と一致させる）
  const sentinelMounted = !state.allLoaded && hasItems;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) requestMoreRef.current();
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // sentinel の出現/消滅に追従して貼り直す
  }, [sentinelMounted]);

  const { items, total, allLoaded } = state;
  const loading = needMore || (state.loaded === 0 && !allLoaded);
  const initialLoading = loading && items.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-zinc-500">
        <span className="tabular-nums">{total.toLocaleString()} 件</span>
        {items.length < total && (
          <span className="ml-1 text-zinc-400">
            （{items.length.toLocaleString()} 件表示中）
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700/60 dark:bg-zinc-900/40">
        {/* 列見出し行（IssueListRow と同じ列幅・並びに揃える） */}
        {!initialLoading && items.length > 0 && (
          <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-medium text-zinc-400 dark:border-zinc-700/60 dark:bg-zinc-800/40">
            <span className="w-16 shrink-0 text-center">キー</span>
            <span className="w-20 shrink-0 text-center">状態</span>
            <span className="hidden w-16 shrink-0 text-center sm:block">
              種別
            </span>
            <span className="min-w-0 flex-1 text-center">件名</span>
            <span className="hidden w-32 shrink-0 text-center lg:block">
              担当者
            </span>
            <span className="hidden w-32 shrink-0 text-center md:block">
              {sort === "created" ? "登録日" : "更新日"}
            </span>
          </div>
        )}
        {initialLoading ? (
          <div className="px-3 py-8 text-center text-sm text-zinc-400">
            読み込み中…
          </div>
        ) : items.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-zinc-400">
            条件に一致する課題がありません
          </div>
        ) : (
          items.map((issue) => (
            <IssueListRow key={issue.id} issue={issue} sort={sort} />
          ))
        )}
      </div>

      {/* 無限スクロールの監視点。まだ残りがある間だけ置く */}
      {sentinelMounted && (
        <div
          ref={sentinelRef}
          className="py-4 text-center text-xs text-zinc-400"
        >
          {loading ? "読み込み中…" : "スクロールで続きを読み込み"}
        </div>
      )}
    </div>
  );
}
