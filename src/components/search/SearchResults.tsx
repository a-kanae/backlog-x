"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import Link from "next/link";
import type { SearchHit } from "@/lib/search/types";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatDateTime } from "@/lib/format";

/**
 * 全文検索の結果一覧。課題・コメント・Wiki・ドキュメントのヒットを区別して表示し、
 * それぞれの詳細ページへリンクする。コメントヒットは `#comment-<commentId>` のハッシュを付け、
 * 詳細ページで該当コメント位置へスクロール + ハイライトさせる。
 *
 * キーボード操作は「検索結果を表示している間はページ全体で効くグローバル操作」として
 * ProjectWorkspace 側の window keydown ハンドラが一元管理する（↑↓ でフォーム⇔結果の往復と
 * 結果内移動、← → でカテゴリ移動、Enter で別タブ表示）。このコンポーネントは
 * 「選択位置の表示（リング）」と「任意の行へ実フォーカスを移す手段（focusRow）」の提供に徹する。
 *
 * - selectedIndex: いま選択中の行。active のときリング＋実フォーカス対象になる。
 * - active: 実フォーカスが結果リスト上にある論理状態。false のとき（フォーム側にいる等）は
 *   リングを出すが実フォーカスは奪わない（マウント直後にフォームのタイプを妨げないため）。
 * - onSelect: マウスで行にフォーカス/ホバー移動したとき選択位置を親へ通知する。
 * ref 経由で focusRow(i) を公開し、親のグローバルハンドラが実フォーカスを移すのに使う。
 */

/** 親のグローバルキーハンドラから任意の結果行へ実フォーカスを移すためのハンドル。 */
export interface SearchResultsHandle {
  /** i 番目の結果行に実フォーカスを当て、画面内へスクロールする。 */
  focusRow: (i: number) => void;
}

/**
 * SearchHit のリンク先 URL を組み立てる。kind ごとに遷移先を出し分ける。
 *
 * - 課題本体 / Wiki / ドキュメント: 本文ハイライト用に検索ワードを `#q=<ワード>` で載せる。
 * - コメントヒット: 従来どおり `#comment-<id>` だけ（該当コメント枠へジャンプ + 枠ハイライト）。
 *   コメントには `#q=` を付けない。付けると (1) CommentThread の `#comment-<id>` 完全一致判定が
 *   崩れてジャンプが効かない (2) 課題の本文まで意図せずハイライトされる、ため。
 */
export function hitHref(
  projectId: number,
  hit: SearchHit,
  query: string,
): string {
  const q = query.trim();
  const qHash = q === "" ? "" : `#q=${encodeURIComponent(q)}`;

  if (hit.kind === "wiki" && hit.wikiId != null) {
    return `/projects/${projectId}/wikis/${hit.wikiId}${qHash}`;
  }
  if (hit.kind === "document" && hit.documentId != null) {
    return `/projects/${projectId}/documents/${hit.documentId}${qHash}`;
  }
  const base = `/projects/${projectId}/issues/${hit.keyId}`;
  if (hit.kind === "comment" && hit.id.startsWith("c:")) {
    // コメントは該当枠へのジャンプのみ（本文ハイライトはしない）。
    return `${base}#comment-${hit.id.slice(2)}`;
  }
  return `${base}${qHash}`;
}

/** kind ごとのバッジ表示（ラベル + 色） */
const KIND_BADGE: Record<
  SearchHit["kind"],
  { label: string; className: string }
> = {
  issue: {
    label: "課題",
    className: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  },
  comment: {
    label: "コメント",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  wiki: {
    label: "Wiki",
    className:
      "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  },
  document: {
    label: "ドキュメント",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
};
export const SearchResults = forwardRef<
  SearchResultsHandle,
  {
    projectId: number;
    hits: SearchHit[];
    loading: boolean;
    query: string;
    /** いま選択中の行（リング表示の対象） */
    selectedIndex: number;
    /** 実フォーカスが結果リスト上にある論理状態か */
    active: boolean;
    /** マウス操作で行が選択されたとき親へ通知（選択位置＋結果へ入った状態にする） */
    onSelect: (i: number) => void;
  }
>(function SearchResults(
  { projectId, hits, loading, query, selectedIndex, active, onSelect },
  ref,
) {
  if (loading) {
    return (
      <div className="px-3 py-8 text-center text-sm text-zinc-400">検索中…</div>
    );
  }
  if (query.trim() === "") return null;
  if (hits.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-sm text-zinc-400">
        「{query}」に一致する課題・コメント・Wiki・ドキュメントはありません
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2 text-sm text-zinc-500">
        <span>
          <span className="tabular-nums">{hits.length.toLocaleString()}</span>{" "}
          件ヒット
        </span>
        <span className="text-xs text-zinc-400">
          （↑↓ で移動・← → でカテゴリ切替・Enter で別タブ表示・Esc でクリア）
        </span>
      </div>
      <ResultList
        ref={ref}
        projectId={projectId}
        hits={hits}
        query={query}
        selectedIndex={selectedIndex}
        active={active}
        onSelect={onSelect}
      />
    </div>
  );
});

/**
 * 検索結果リスト本体。選択位置の表示（リング）と、任意の行へ実フォーカスを移す手段の提供に徹する。
 * キーボード操作そのもの（↑↓ ← → Enter）は親（ProjectWorkspace）の window keydown ハンドラが担う。
 *
 * 実フォーカスはマウント時には当てない（検索ボックスのタイプを妨げないため）。active が true の
 * ときだけ selectedIndex の行に実フォーカスを寄せ、false のときはリング表示のみ（実フォーカスは
 * フォーム側に残す）。マウスで行にフォーカスが移ったら onSelect で親へ通知する。
 */
const ResultList = forwardRef<
  SearchResultsHandle,
  {
    projectId: number;
    hits: SearchHit[];
    query: string;
    selectedIndex: number;
    active: boolean;
    onSelect: (i: number) => void;
  }
>(function ResultList(
  { projectId, hits, query, selectedIndex, active, onSelect },
  ref,
) {
  const rowRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  // 親のグローバルハンドラから任意の行へ実フォーカスを移すためのハンドル。
  useImperativeHandle(ref, () => ({
    focusRow: (i: number) => {
      const el = rowRefs.current[i];
      if (!el) return;
      el.focus();
      el.scrollIntoView({ block: "nearest" });
    },
  }));

  // active かつ selectedIndex の行に実フォーカスがまだ無ければ寄せる（画面内スクロールも）。
  // 実フォーカスの副作用をこの effect に集約し、レンダリング中や setState updater 内では動かさない。
  useEffect(() => {
    if (!active) return;
    const el = rowRefs.current[selectedIndex];
    if (!el) return;
    if (document.activeElement === el) return;
    el.focus();
    el.scrollIntoView({ block: "nearest" });
  }, [active, selectedIndex]);

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700/60 dark:bg-zinc-900/40">
      {hits.map((hit, i) => (
        <Link
          key={hit.id}
          ref={(el) => {
            rowRefs.current[i] = el;
          }}
          href={hitHref(projectId, hit, query)}
          // 検索結果は別タブで開く（結果一覧を残したまま複数の課題を見比べる運用のため）
          target="_blank"
          rel="noopener noreferrer"
          // 一覧に最大 500 件並ぶため、自動 prefetch による大量の RSC キャッシュが
          // 左右キーでの兄弟ルート遷移と衝突し Hydration エラーを起こすため無効化。
          prefetch={false}
          onFocus={() => onSelect(i)}
          className={`flex flex-col gap-1 border-b border-zinc-100 px-4 py-3 transition-colors last:border-b-0 hover:bg-zinc-50 focus:outline-none dark:border-zinc-700/60 dark:hover:bg-zinc-800 ${
            i === selectedIndex
              ? "bg-sky-50 ring-2 ring-sky-600 ring-inset dark:bg-sky-950/40"
              : ""
          }`}
        >
          <span className="flex items-center gap-2">
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${KIND_BADGE[hit.kind].className}`}
            >
              {KIND_BADGE[hit.kind].label}
            </span>
            {(hit.kind === "issue" || hit.kind === "comment") && (
              <span className="font-mono text-xs text-zinc-400">
                #{hit.keyId}
              </span>
            )}
            {hit.kind === "issue" && hit.status && (
              <span className="shrink-0">
                <StatusBadge master={hit.status} />
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {hit.summary || "(件名なし)"}
            </span>
            {hit.updated && (
              <span className="shrink-0 text-xs text-zinc-400 tabular-nums">
                {formatDateTime(hit.updated)}
              </span>
            )}
          </span>
          {hit.snippet && (
            <span className="line-clamp-2 pl-1 text-xs text-zinc-500 dark:text-zinc-400">
              {hit.snippet}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
});
