"use client";

import { useState } from "react";
import {
  getIssuesByProject,
  getCommentsByProject,
  getWikisByProject,
  getDocumentsByProject,
} from "@/lib/db/repositories";
import { rebuildSearchIndex } from "@/lib/search/rebuild";
import { invalidateSearchIndex } from "@/lib/search/searcher";

/** 完了メッセージをボタンラベルに出しておく時間（ms） */
const DONE_LABEL_MS = 2000;

/**
 * 実データ（課題・コメント・Wiki・ドキュメント）は変えず、検索インデックスだけを
 * IndexedDB の既存データから再構築するボタン。
 *
 * 検索インデックスの内部形式（flexsearch の設定・チャンク分割方法など）を変更した
 * リリースの後、ユーザーがデータの再取り込み（API/ファイル）をしなくても済むようにする
 * ためのもの。実データはそのままに、rebuildSearchIndex だけを叩けば新形式に更新できる。
 *
 * 進捗・完了・エラーはすべてボタンのラベル自体を差し替えて表示する（別要素で出すと
 * 隣に並ぶボタンとの縦位置がずれて見えるため、レイアウトを動かさない一本化にした）。
 */
export function RebuildIndexButton({ projectId }: { projectId: number }) {
  const [label, setLabel] = useState("検索インデックス再構築");
  const [busy, setBusy] = useState(false);
  const [isError, setIsError] = useState(false);

  async function handleRebuild() {
    setIsError(false);
    setBusy(true);
    setLabel("再構築中…");
    try {
      const [issues, comments, wikis, documents] = await Promise.all([
        getIssuesByProject(projectId),
        getCommentsByProject(projectId),
        getWikisByProject(projectId),
        getDocumentsByProject(projectId),
      ]);
      await rebuildSearchIndex(
        projectId,
        { issues, comments, wikis, documents },
        (done, total) => {
          const pct = total > 0 ? Math.floor((done / total) * 100) : 0;
          setLabel(`再構築中… ${pct}%`);
        },
      );
      invalidateSearchIndex(projectId);
      setLabel("完了しました");
      setTimeout(() => {
        setLabel("検索インデックス再構築");
      }, DONE_LABEL_MS);
    } catch (e) {
      setIsError(true);
      setLabel(e instanceof Error ? e.message : "再構築に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleRebuild}
      disabled={busy}
      title="実データはそのままに、検索インデックスだけをこのブラウザ内で再構築します"
      // 最長ラベル「検索インデックス再構築」がちょうど収まる幅で固定し、進捗のパーセント
      // 表示（8% → 95% のような桁数変化）でボタン自体の横幅がガタつかないようにする。
      // whitespace-nowrap で折り返しを禁止し、tabular-nums で数字を等幅にする。
      className={`inline-flex w-[10.0rem] shrink-0 items-center justify-center rounded-md border px-2.5 py-1 text-xs whitespace-nowrap tabular-nums transition-colors disabled:opacity-50 ${
        isError
          ? "border-red-300 text-red-600 dark:border-red-700 dark:text-red-400"
          : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );
}
