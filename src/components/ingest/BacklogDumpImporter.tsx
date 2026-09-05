"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BacklogDump } from "@/types/dump";
import { parseDumpFile } from "@/lib/ingest/backlogDump";
import {
  ingestFromDump,
  type IngestProgress,
  type IngestResult,
} from "@/lib/ingest/seed";
import { importAttachmentsZip } from "@/lib/ingest/projectArchive";
import { invalidateSearchIndex } from "@/lib/search/searcher";

type Status = "idle" | "running" | "done" | "error";

/**
 * Backlog ダンプ（API の生レスポンス）を取り込む UI。
 *
 * 「Backlog API から」タブで保存したダンプ（backlog-raw-<KEY>.json.gz）と、あれば添付
 * （backlog-raw-<KEY>-attachments.zip）をまとめて選択する。取り込み処理は API 直接取り込みと
 * **同じ ingestFromDump**（→ persistArchive）なので、API 経由と結果が一致する。
 *
 * 取り込む種類はダンプ取得時の選択（dump.selection）をそのまま使う。ダンプに含まれていない
 * 種類を後から ON にすると既存データを空で上書きしてしまうため、ここでは選択させない。
 */
export function BacklogDumpImporter() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [dump, setDump] = useState<BacklogDump | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [attachmentCount, setAttachmentCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    // 同じファイルを連続選択できるよう input をリセット
    e.target.value = "";
    if (files.length === 0) return;

    setError(null);
    setDump(null);
    setResult(null);
    setAttachmentCount(null);
    setProgress(null);
    setStatus("running");
    try {
      const gzFile = files.find((f) => f.name.endsWith(".gz"));
      const zipFile = files.find((f) => f.name.endsWith(".zip"));
      if (!gzFile) {
        throw new Error("Backlog ダンプ本体（.json.gz）が選択されていません");
      }

      const parsed = await parseDumpFile(gzFile);
      setDump(parsed);

      // 添付は先に OPFS へ展開する（添付メタは課題側に入るので順序はどちらでもよいが、
      // 取り込み完了＝閲覧可能の状態にするため本体より前に置く）。
      if (zipFile) {
        setProgress({
          phase: "fetching-attachments",
          current: 0,
          message: "添付ファイルを展開中…",
        });
        const count = await importAttachmentsZip(
          parsed.project.id,
          zipFile,
          (done, total) =>
            setProgress({
              phase: "fetching-attachments",
              current: done,
              total,
              message: "添付ファイルを展開中…",
            }),
        );
        setAttachmentCount(count);
      }

      const res = await ingestFromDump(parsed, setProgress);
      invalidateSearchIndex(res.projectId);
      setResult(res);
      setStatus("done");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "取り込み中にエラーが発生しました",
      );
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="inline-flex w-fit cursor-pointer items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
        {status === "running" ? "取り込み中…" : "ダンプファイルを選択"}
        <input
          type="file"
          accept=".gz,.zip,application/gzip,application/zip"
          multiple
          onChange={handleFile}
          disabled={status === "running"}
          className="hidden"
        />
      </label>

      {dump && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {dump.project.name}
          <span className="ml-1.5 font-mono">{dump.project.projectKey}</span> ／
          取得日時 {new Date(dump.dumpedAt).toLocaleString()} ／ 課題{" "}
          {dump.rawIssues.length.toLocaleString()} ・ コメント{" "}
          {dump.rawComments.length.toLocaleString()} ・ Wiki{" "}
          {dump.rawWikis.length.toLocaleString()} ・ ドキュメント{" "}
          {dump.rawDocuments.length.toLocaleString()}
        </p>
      )}

      {progress && status === "running" && (
        <p className="text-sm text-zinc-600 tabular-nums dark:text-zinc-400">
          {progress.message}
          {progress.total
            ? `（${progress.current.toLocaleString()} / ${progress.total.toLocaleString()}）`
            : ""}
        </p>
      )}

      {status === "done" && result && (
        <div className="flex flex-col gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          <p className="font-medium">
            取り込みが完了しました（{result.projectKey}）
          </p>
          <ul className="list-inside list-disc">
            <li>課題: {result.issueCount.toLocaleString()} 件</li>
            <li>コメント: {result.commentCount.toLocaleString()} 件</li>
            <li>Wiki: {result.wikiCount.toLocaleString()} 件</li>
            <li>ドキュメント: {result.documentCount.toLocaleString()} 件</li>
            <li>アイコン: {result.iconCount.toLocaleString()} 件</li>
            {result.memberCount > 0 && (
              <li>メンバー: {result.memberCount.toLocaleString()} 名</li>
            )}
            {attachmentCount != null && (
              <li>
                添付ファイル本体: {attachmentCount.toLocaleString()} 件（OPFS
                に保存）
              </li>
            )}
            <li>
              検索インデックス: {result.searchDocCount.toLocaleString()}{" "}
              件を索引
            </li>
          </ul>
          <button
            type="button"
            onClick={() => router.push(`/projects/${result.projectId}`)}
            className="inline-flex w-fit items-center rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-600"
          >
            課題一覧を開く
          </button>
        </div>
      )}

      {status === "error" && error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
