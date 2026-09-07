"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseDumpFile } from "@/lib/ingest/backlogDump";
import { ingestFromDump, type IngestProgress } from "@/lib/ingest/seed";
import { invalidateSearchIndex } from "@/lib/search/searcher";

/**
 * 同梱のサンプルアーカイブをワンクリックで取り込むボタン。
 *
 * Backlog のアカウントも API キーも持たない人に、一覧・全文検索・課題詳細・Wiki・記法
 * レンダリングをそのまま触ってもらうための入口。ファイル選択の手順を踏ませない。
 *
 * 中身は `scripts/make-sample-dump.mjs` が生成する Backlog ダンプ（= API のレスポンス
 * 原本と同じ形）で、取り込みは通常の `ingestFromDump` に流す。つまり**アプリ本来の
 * 取り込み経路をそのまま通る**ので、サンプル専用の抜け道を作らずに済む。
 *
 * 取得先は同一オリジンの静的アセットなので、CSP（connect-src 'self'）のままで通る。
 * データはすべて架空（人名はプレースホルダ・メールは example.com）。
 */

/** 同梱サンプルの場所（public/sample/ 配下の静的アセット） */
const SAMPLE_URL = "/sample/backlog-x-demo.json.gz";

type Status = "idle" | "running" | "error";

export function SampleDataButton() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setProgress(null);
    setStatus("running");
    try {
      const res = await fetch(SAMPLE_URL, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(
          `サンプルデータを取得できませんでした（HTTP ${res.status}）`,
        );
      }
      const dump = await parseDumpFile(await res.blob());
      const result = await ingestFromDump(dump, setProgress);
      invalidateSearchIndex(result.projectId);
      // 取り込めたらそのまま中身を見せる（デモなので確認ダイアログを挟まない）
      router.push(`/projects/${result.projectId}`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "サンプルデータの取り込みに失敗しました",
      );
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "running"}
        className="inline-flex w-fit items-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        {status === "running" ? "読み込み中…" : "サンプルデータで試す"}
      </button>

      {status === "running" && progress && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {progress.message}
        </p>
      )}

      {status === "error" && error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
