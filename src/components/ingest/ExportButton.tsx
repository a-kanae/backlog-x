"use client";

import { useState } from "react";
import {
  exportProject,
  gzipJson,
  exportAttachmentsZip,
} from "@/lib/ingest/projectArchive";
import { downloadBlob } from "@/lib/download";

/**
 * プロジェクトのアーカイブを gzip 圧縮した 1 ファイル（.json.gz）としてダウンロードするボタン。
 * 検索インデックスも含むため、受け取った人はインポートするだけで再構築なしに検索・閲覧できる。
 * JSON はテキストなので gzip が非常によく効く（実測でおよそ 1/5〜1/7 になる）。
 *
 * 添付バイナリが OPFS に保存されている場合は、続けて添付 zip（backlog-x-<KEY>-attachments.zip）も
 * ダウンロードする（テキストと添付は容量差が大きいため別ファイルに分ける）。
 */
export function ExportButton({
  projectId,
  projectKey,
}: {
  projectId: number;
  projectKey: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setError(null);
    setBusy(true);
    try {
      // 1) テキストアーカイブ（課題・コメント・検索インデックス等）を gzip で
      const data = await exportProject(projectId);
      const json = JSON.stringify(data);
      downloadBlob(await gzipJson(json), `backlog-x-${projectKey}.json.gz`);

      // 2) 添付バイナリが OPFS にあれば、続けて zip でも書き出す（無ければ何もしない）
      const attachmentsZip = await exportAttachmentsZip(projectId);
      if (attachmentsZip) {
        downloadBlob(attachmentsZip, `backlog-x-${projectKey}-attachments.zip`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "エクスポートに失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleExport}
        disabled={busy}
        title="このプロジェクトを 1 ファイルに書き出して共有できます"
        className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
      >
        {busy ? "書き出し中…" : "エクスポート"}
      </button>
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </span>
  );
}
