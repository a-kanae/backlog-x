"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BacklogProject } from "@/types/backlog";
import type { BacklogDump } from "@/types/dump";
import {
  ingestFromApi,
  listProjectsFromApi,
  type IngestProgress,
  type IngestResult,
  type IngestSelection,
} from "@/lib/ingest/seed";
import {
  serializeDump,
  dumpFileName,
  dumpAttachmentsFileName,
} from "@/lib/ingest/backlogDump";
import { exportAttachmentsZip } from "@/lib/ingest/projectArchive";
import { downloadBlob } from "@/lib/download";
import { invalidateSearchIndex } from "@/lib/search/searcher";

type Phase =
  "input" | "connecting" | "projects" | "importing" | "done" | "error";

/**
 * Backlog API から直接取り込む UI。
 *
 * キー入力 → 接続（プロジェクト一覧取得）→ 取り込み対象を選んで実行（全件 or 個別）。
 * API キーは React state にだけ保持し、localStorage/sessionStorage には残さない（セッション限り）。
 * CORS 検証済みのためブラウザが直接 Backlog API を叩く（proxy 不要）。
 */
export function ApiImporter() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("input");
  const [spaceUrl, setSpaceUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [projects, setProjects] = useState<BacklogProject[]>([]);
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [importingId, setImportingId] = useState<number | null>(null);
  const [results, setResults] = useState<IngestResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  // 取得した生データを Backlog ダンプとして保存するか（既定 ON）。
  // API を叩くのは 1 回で済ませ、再取り込み・不具合の再現はダンプから行えるようにするため。
  const [saveDump, setSaveDump] = useState(true);
  const [savedDumpFiles, setSavedDumpFiles] = useState<string[]>([]);
  // 取り込む種類の選択。既定は「課題・コメント・Wiki・ドキュメント ON、添付 OFF」
  // （従来の「添付なしフル取り込み」と等価）。
  const [selection, setSelection] = useState<IngestSelection>({
    issues: true,
    comments: true,
    attachments: false,
    wikis: true,
    documents: true,
  });

  // 課題 OFF にしたらコメント・添付（課題従属）も強制 OFF にする。
  function toggleIssues(checked: boolean) {
    setSelection((s) => ({
      ...s,
      issues: checked,
      comments: checked ? s.comments : false,
      attachments: checked ? s.attachments : false,
    }));
  }

  async function handleConnect() {
    setError(null);
    if (!spaceUrl.trim() || !apiKey.trim()) {
      setError("スペース URL と API キーを入力してください");
      return;
    }
    setPhase("connecting");
    try {
      const list = await listProjectsFromApi(spaceUrl, apiKey);
      // 課題のあるプロジェクトを上に出すため displayOrder で並べる
      const sorted = [...list].sort((a, b) => a.displayOrder - b.displayOrder);
      setProjects(sorted);
      setPhase("projects");
    } catch (e) {
      setError(e instanceof Error ? e.message : "接続に失敗しました");
      setPhase("error");
    }
  }

  /**
   * 取得した生データを Backlog ダンプ（.json.gz）としてダウンロードする。
   * 添付を取得した場合は添付 zip も落とす（backlog-x の書き出しと同じ 2 ファイル構成）。
   *
   * これは取り込みに入る**前**に呼ばれるので、取り込みが失敗してもダンプは手元に残る
   * （＝失敗の調査で Backlog API を叩き直さなくて済む）。
   */
  async function handleRawFetched(dump: BacklogDump): Promise<void> {
    const key = dump.project.projectKey;
    const names: string[] = [];

    downloadBlob(await serializeDump(dump), dumpFileName(key));
    names.push(dumpFileName(key));

    // 添付は JSON に埋めず zip で別に落とす（OPFS に保存済みのものを束ねるだけ）
    if (dump.selection.issues && dump.selection.attachments) {
      const zipBlob = await exportAttachmentsZip(dump.project.id);
      if (zipBlob) {
        downloadBlob(zipBlob, dumpAttachmentsFileName(key));
        names.push(dumpAttachmentsFileName(key));
      }
    }
    setSavedDumpFiles((prev) => [...prev, ...names]);
  }

  /** 1 プロジェクトを取り込む（内部利用。results に追記する） */
  async function importOne(project: BacklogProject): Promise<void> {
    setImportingId(project.id);
    setProgress(null);
    const res = await ingestFromApi(
      spaceUrl,
      apiKey,
      project,
      selection,
      setProgress,
      saveDump ? handleRawFetched : undefined,
    );
    invalidateSearchIndex(res.projectId);
    setResults((prev) => [
      ...prev.filter((r) => r.projectId !== res.projectId),
      res,
    ]);
  }

  /** トップレベルの 3 種（課題・Wiki・ドキュメント）が全 OFF なら「何も取り込まない」 */
  function nothingSelected(): boolean {
    return !selection.issues && !selection.wikis && !selection.documents;
  }

  async function handleImportOne(project: BacklogProject) {
    setError(null);
    if (nothingSelected()) {
      setError("取り込む種類を 1 つ以上選んでください");
      return;
    }
    setSavedDumpFiles([]);
    setPhase("importing");
    try {
      await importOne(project);
      setPhase("done");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "取り込み中にエラーが発生しました",
      );
      setPhase("error");
    } finally {
      setImportingId(null);
    }
  }

  async function handleImportAll() {
    setError(null);
    if (nothingSelected()) {
      setError("取り込む種類を 1 つ以上選んでください");
      return;
    }
    setSavedDumpFiles([]);
    setPhase("importing");
    try {
      for (const project of projects) {
        await importOne(project);
      }
      setPhase("done");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "取り込み中にエラーが発生しました",
      );
      setPhase("error");
    } finally {
      setImportingId(null);
    }
  }

  // --- 入力フォーム ---
  if (
    phase === "input" ||
    phase === "connecting" ||
    (phase === "error" && projects.length === 0)
  ) {
    return (
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            スペース URL
          </span>
          <input
            type="text"
            value={spaceUrl}
            onChange={(e) => setSpaceUrl(e.target.value)}
            placeholder="例: https://example.backlog.jp"
            disabled={phase === "connecting"}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            API キー
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="管理者の API キー"
            autoComplete="off"
            disabled={phase === "connecting"}
            className="rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900"
          />
          <span className="text-xs text-zinc-500">
            キーはこのブラウザのメモリ上にだけ保持され、保存・送信されません（タブを閉じると消えます）。
          </span>
        </label>
        <button
          type="button"
          onClick={handleConnect}
          disabled={phase === "connecting"}
          className="inline-flex w-fit items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {phase === "connecting"
            ? "接続中…"
            : "接続してプロジェクト一覧を取得"}
        </button>
        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </div>
        )}
      </div>
    );
  }

  // --- プロジェクト選択 / 取り込み進捗 ---
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          取り込むプロジェクトを選んでください（{projects.length} 件）
        </p>
        <button
          type="button"
          onClick={handleImportAll}
          disabled={phase === "importing"}
          className="inline-flex items-center rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          すべて取り込む
        </button>
      </div>

      {/* 取り込む種類の選択。課題（親）／コメント・添付（課題従属）／Wiki／ドキュメント。 */}
      <fieldset className="flex flex-col gap-1.5 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
        <legend className="px-1 text-xs text-zinc-500">取り込む種類</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selection.issues}
            onChange={(e) => toggleIssues(e.target.checked)}
            disabled={phase === "importing"}
          />
          <span className="text-zinc-700 dark:text-zinc-200">課題</span>
        </label>
        <label
          className={`flex items-center gap-2 pl-6 ${selection.issues ? "" : "opacity-50"}`}
        >
          <input
            type="checkbox"
            checked={selection.comments}
            onChange={(e) =>
              setSelection((s) => ({ ...s, comments: e.target.checked }))
            }
            disabled={phase === "importing" || !selection.issues}
          />
          <span className="text-zinc-700 dark:text-zinc-200">└ コメント</span>
        </label>
        <label
          className={`flex items-start gap-2 pl-6 ${selection.issues ? "" : "opacity-50"}`}
        >
          <input
            type="checkbox"
            checked={selection.attachments}
            onChange={(e) =>
              setSelection((s) => ({ ...s, attachments: e.target.checked }))
            }
            disabled={phase === "importing" || !selection.issues}
            className="mt-0.5"
          />
          <span className="flex flex-col">
            <span className="text-zinc-700 dark:text-zinc-200">
              └ 添付ファイル
            </span>
            <span className="text-xs text-zinc-500">
              添付ファイルの本体もダウンロードして保存します（オフラインでも閲覧・DL
              できるようになります）。容量が大きく取り込みに時間がかかります。
            </span>
          </span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selection.wikis}
            onChange={(e) =>
              setSelection((s) => ({ ...s, wikis: e.target.checked }))
            }
            disabled={phase === "importing"}
          />
          <span className="text-zinc-700 dark:text-zinc-200">Wiki</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selection.documents}
            onChange={(e) =>
              setSelection((s) => ({ ...s, documents: e.target.checked }))
            }
            disabled={phase === "importing"}
          />
          <span className="text-zinc-700 dark:text-zinc-200">ドキュメント</span>
        </label>
      </fieldset>

      {/* 取得した生データ（Backlog API のレスポンス原本）をファイルに残すか。
          残しておけば、再取り込みや取り込み不具合の調査で API を叩き直さずに済む。 */}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={saveDump}
          onChange={(e) => setSaveDump(e.target.checked)}
          disabled={phase === "importing"}
          className="mt-0.5"
        />
        <span className="flex flex-col">
          <span className="text-zinc-700 dark:text-zinc-200">
            取得した生データを Backlog ダンプとして保存する
          </span>
          <span className="text-xs text-zinc-500">
            取得直後に{" "}
            <code className="whitespace-nowrap">
              backlog-raw-&lt;プロジェクト&gt;.json.gz
            </code>{" "}
            をダウンロードします。「Backlog
            ダンプから」タブで取り込めるので、次回以降は Backlog API
            を叩かずに再取り込みできます。
          </span>
        </span>
      </label>

      {savedDumpFiles.length > 0 && (
        <div className="rounded-md border border-sky-300 bg-sky-50 p-3 text-xs leading-6 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200">
          <p className="font-medium">Backlog ダンプを保存しました</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {savedDumpFiles.map((name) => (
              <li key={name}>
                ・<code className="whitespace-nowrap">{name}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
        {projects.map((project) => {
          const imported = results.find((r) => r.projectId === project.id);
          const isImporting = importingId === project.id;
          return (
            <li
              key={project.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {project.name}
                  <span className="ml-1.5 font-mono text-xs text-zinc-500">
                    {project.projectKey}
                  </span>
                  {project.archived && (
                    <span className="ml-1.5 rounded bg-zinc-200 px-1 text-[10px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                      アーカイブ済み
                    </span>
                  )}
                </span>
                {imported && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">
                    取り込み済み（課題 {imported.issueCount.toLocaleString()} /
                    コメント {imported.commentCount.toLocaleString()} / Wiki{" "}
                    {imported.wikiCount.toLocaleString()} / ドキュメント{" "}
                    {imported.documentCount.toLocaleString()} / メンバー{" "}
                    {imported.memberCount.toLocaleString()}）
                  </span>
                )}
                {isImporting && progress && (
                  <span className="text-xs text-zinc-500 tabular-nums">
                    {progress.message}
                    {progress.total
                      ? `（${progress.current.toLocaleString()} / ${progress.total.toLocaleString()}）`
                      : ""}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleImportOne(project)}
                disabled={phase === "importing"}
                className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
              >
                {isImporting
                  ? "取り込み中…"
                  : imported
                    ? "再取り込み"
                    : "取り込む"}
              </button>
            </li>
          );
        })}
      </ul>

      {phase === "importing" && progress?.phase === "building-index" && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          ※ 検索インデックスはバックグラウンド（Web
          Worker）で構築しています。画面は操作できます。
        </p>
      )}

      {results.length > 0 && phase === "done" && (
        <div className="flex flex-col gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          <p className="font-medium">
            取り込みが完了しました（{results.length} プロジェクト）
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="inline-flex w-fit items-center rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-600"
          >
            プロジェクト一覧を開く
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
