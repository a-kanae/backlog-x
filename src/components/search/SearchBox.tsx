"use client";

import { forwardRef } from "react";
import { Search, X } from "lucide-react";

/**
 * 全文検索の入力ボックス（制御コンポーネント）。
 * デバウンスや検索実行は親（プロジェクトページ）が担当し、ここは入力 UI に徹する。
 *
 * 左端に虫眼鏡アイコン。テキストが入力されている間は右端にクリア（×）ボタンを出し、
 * クリックで入力を空にする。
 *
 * キーボードナビ（↑↓ でフォーム⇔結果の往復・← → でカテゴリ移動）は、検索結果を表示している間は
 * ページ全体で効くグローバル操作として親（ProjectWorkspace）の window keydown ハンドラが担う。
 * ここは入力に集中し、ref（input）だけ親へ渡してフォーカス制御に使わせる。
 *
 * autoComplete="off": type="search" はブラウザの入力履歴オートコンプリート候補 UI を
 * 出すことがあり、候補が表示された状態で ↑↓ を押すとブラウザ側 UI が矢印キーを奪って
 * 候補選択に使ってしまい、React の controlled value と食い違って入力値が意図せず変わる
 * ことがある（本コンポーネントの ↑↓ は候補選択ではなく検索結果ナビに使うキーのため、
 * ブラウザ側の候補 UI 自体を出さないようにする）。
 */
export const SearchBox = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }
>(function SearchBox(
  { value, onChange, placeholder = "課題・コメントを全文検索…" },
  ref,
) {
  const hasValue = value !== "";
  return (
    <div className="relative">
      <input
        ref={ref}
        type="search"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 pr-9 pl-9 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-sky-600 focus:ring-1 focus:ring-sky-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 [&::-webkit-search-cancel-button]:hidden"
      />
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400"
        aria-hidden
      />
      {hasValue && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="検索をクリア"
          className="absolute top-1/2 right-2.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
});
