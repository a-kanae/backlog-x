import { ImportTabs } from "@/components/ingest/ImportTabs";
import { HomeShell } from "@/components/layout/HomeShell";

export default function SetupPage() {
  return (
    <HomeShell>
      {/* 取り込みフォーム・説明は横に間延びさせず読みやすい幅に保つ（ページ枠はシェルで統一）。 */}
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Backlog の課題・コメントをこのブラウザのローカル
          DB（IndexedDB）に取り込みます。
          <span className="font-medium text-emerald-700 dark:text-emerald-400">
            取得したデータは外部に送信されず、検索・閲覧はすべてブラウザ内で完結します。
          </span>
        </p>

        <section className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-6 dark:border-zinc-700/60">
          <ImportTabs />
        </section>
      </div>
    </HomeShell>
  );
}
