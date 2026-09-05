"use client";

/**
 * アプリのトップレベルのシェル（プロジェクト一覧 / 新規インポートで共有）。
 *
 * ロゴ + アプリ名のタイトル段の下に「プロジェクト」「新規インポート」のタブを置き、
 * コンテンツエリア（children）に各画面を出す。タブは Link 遷移で、active 判定は
 * usePathname で行う（/=プロジェクト, /setup=新規インポート）。URL は従来どおり維持。
 *
 * タブの見た目はプロジェクト画面（ProjectWorkspace）のコンテンツカテゴリと揃えた
 * 丸ピル（active = sky-600 塗り）。ページ枠は他画面と同じ max-w-[1536px]。
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BacklogXLogo } from "@/components/ui/BacklogXLogo";

const TABS: { href: string; label: string }[] = [
  { href: "/", label: "プロジェクト" },
  { href: "/setup", label: "新規インポート" },
];

export function HomeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  // /setup 配下なら「新規インポート」、それ以外（/）は「プロジェクト」を active に。
  const activeHref = pathname.startsWith("/setup") ? "/setup" : "/";

  return (
    <main className="mx-auto flex min-h-full w-full max-w-[1536px] flex-col gap-5 px-6 py-10">
      <header className="flex items-center gap-3">
        {/* トップ階層なのでロゴはリンクにせずブランドマークとして置く */}
        <BacklogXLogo size={44} className="shrink-0 rounded-xl" />
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">backlog-x</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Backlog のアーカイブビューア（読み取り専用）
          </p>
        </div>
      </header>

      <nav className="flex items-center gap-1 text-sm">
        {TABS.map((t) => {
          const active = t.href === activeHref;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={
                active
                  ? "rounded-full bg-sky-600 px-3 py-1 font-medium text-white"
                  : "rounded-full px-3 py-1 text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div className="min-w-0">{children}</div>
    </main>
  );
}
