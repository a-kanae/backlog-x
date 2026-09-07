"use client";

import { useState } from "react";
import { deleteProject } from "@/lib/ingest/projectArchive";
import { invalidateSearchIndex } from "@/lib/search/searcher";

/**
 * プロジェクト 1 件分の取り込み済みデータを削除するボタン。
 *
 * 取り込んだデータを消す手段がアプリ内に無いと、「ブラウザのサイトデータを消してくれ」と
 * 案内するしかなくなる（他のサイトの保存データまで巻き込む説明になってしまう）。
 * サンプルデータを試した人が元に戻せるようにするためにも必要。
 *
 * ## window.confirm を使わない理由
 *
 * ネイティブのモーダルはページの JS を止めるため、自動操作（テストやエージェント）から
 * 触ったときにセッションごと固まる。確認は同じ行に出すインライン UI で行う。
 * 破壊的操作なので 1 クリックでは実行せず、必ず 2 段階にする。
 */
export function DeleteProjectButton({
  projectId,
  projectKey,
  onDeleted,
}: {
  projectId: number;
  projectKey: string;
  onDeleted: (projectId: number) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "confirming" | "deleting">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    setPhase("deleting");
    try {
      await deleteProject(projectId);
      // 検索インスタンスのキャッシュも捨てる（消したプロジェクトの索引が残らないように）
      invalidateSearchIndex(projectId);
      onDeleted(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
      setPhase("idle");
    }
  }

  if (phase === "confirming") {
    return (
      <span className="inline-flex shrink-0 items-center gap-2 text-xs">
        <span className="text-zinc-600 dark:text-zinc-400">
          {projectKey} のデータを削除しますか？
        </span>
        <button
          type="button"
          onClick={handleDelete}
          className="shrink-0 rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-700 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
        >
          削除する
        </button>
        <button
          type="button"
          onClick={() => setPhase("idle")}
          className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          やめる
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setPhase("confirming")}
        disabled={phase === "deleting"}
        className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
      >
        {phase === "deleting" ? "削除中…" : "削除"}
      </button>
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </span>
  );
}
