"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  importProject,
  gunzipToJson,
  importAttachmentsZip,
  readZipProjectId,
  isIconsExport,
  importIcons,
  type ImportProgress,
  type ImportResult,
} from "@/lib/ingest/projectArchive";
import { invalidateSearchIndex } from "@/lib/search/searcher";

type Status = "idle" | "running" | "done" | "error";

/**
 * 書き出しファイルをインポートする UI。
 *
 * 別メンバーが書き出した backlog-x のアーカイブを取り込む。テキスト（.json.gz）と添付（.zip）を
 * まとめて選択でき、拡張子で振り分ける。検索インデックスもテキスト側に含まれるため、インポート後
 * すぐ検索・閲覧できる（再構築なし）。添付 zip は projectId を内包するので単体でも保存先が分かる。
 */
export function FileImporter() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [attachmentCount, setAttachmentCount] = useState<number | null>(null);
  const [iconCount, setIconCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    // 同じファイルを連続選択できるよう input をリセット
    e.target.value = "";
    if (files.length === 0) return;

    setError(null);
    setResult(null);
    setAttachmentCount(null);
    setIconCount(null);
    setProgress(null);
    setStatus("running");
    try {
      // .gz は「アーカイブ本体」か「アイコン単体」のどちらか。中身の format で振り分ける。
      const gzFiles = files.filter((f) => f.name.endsWith(".gz"));
      const zipFile = files.find((f) => f.name.endsWith(".zip"));

      let importedProjectId: number | null = null;

      for (const gz of gzFiles) {
        const text = await gunzipToJson(gz);
        const parsed: unknown = JSON.parse(text);
        if (isIconsExport(parsed)) {
          // アイコン単体ファイル: userIcons に追加（projectId 非依存・後追い可）
          setProgress({
            phase: "storing-rest",
            message: "アイコンを取り込み中…",
          });
          const n = await importIcons(parsed);
          setIconCount(n);
        } else {
          // アーカイブ本体（課題・コメント・検索インデックス等）
          const res = await importProject(parsed, setProgress);
          invalidateSearchIndex(res.projectId);
          importedProjectId = res.projectId;
          setResult(res);
        }
      }

      // 添付 zip があれば OPFS に展開（projectId は zip 内 manifest 由来、無ければ直近取り込み先）
      if (zipFile) {
        setProgress({
          phase: "storing-rest",
          message: "添付ファイルを展開中…",
        });
        const pid = importedProjectId ?? (await readZipProjectId(zipFile));
        if (pid != null) {
          const count = await importAttachmentsZip(pid, zipFile);
          setAttachmentCount(count);
        } else {
          throw new Error(
            "添付 zip の保存先プロジェクトが特定できませんでした",
          );
        }
      }

      if (gzFiles.length === 0 && !zipFile) {
        throw new Error(
          "対応するファイル（.json.gz / .zip）が選択されていません",
        );
      }
      setStatus("done");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "インポート中にエラーが発生しました",
      );
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="inline-flex w-fit cursor-pointer items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
        {status === "running" ? "インポート中…" : "ファイルを選択"}
        <input
          type="file"
          accept=".gz,.zip,application/gzip,application/zip"
          multiple
          onChange={handleFile}
          disabled={status === "running"}
          className="hidden"
        />
      </label>

      {progress && status === "running" && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {progress.message}
        </p>
      )}

      {status === "done" &&
        (result || attachmentCount != null || iconCount != null) && (
          <div className="flex flex-col gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            <p className="font-medium">
              インポートが完了しました{result ? `（${result.projectKey}）` : ""}
            </p>
            <ul className="list-inside list-disc">
              {result && <li>課題: {result.issueCount.toLocaleString()} 件</li>}
              {result && (
                <li>コメント: {result.commentCount.toLocaleString()} 件</li>
              )}
              {result && (
                <li>添付メタ: {result.attachmentCount.toLocaleString()} 件</li>
              )}
              {result && (
                <li>アイコン: {result.iconCount.toLocaleString()} 件</li>
              )}
              {result && result.memberCount > 0 && (
                <li>メンバー: {result.memberCount.toLocaleString()} 名</li>
              )}
              {result && (
                <li>
                  検索インデックス: {result.searchChunkCount.toLocaleString()}{" "}
                  チャンク
                </li>
              )}
              {attachmentCount != null && (
                <li>
                  添付ファイル本体: {attachmentCount.toLocaleString()} 件（OPFS
                  に保存）
                </li>
              )}
              {iconCount != null && (
                <li>
                  アイコン（追加取り込み）: {iconCount.toLocaleString()} 件
                </li>
              )}
            </ul>
            <button
              type="button"
              onClick={() =>
                router.push(result ? `/projects/${result.projectId}` : "/")
              }
              className="inline-flex w-fit items-center rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-600"
            >
              {result ? "課題一覧を開く" : "トップへ"}
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
