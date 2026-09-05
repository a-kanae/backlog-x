"use client";

import { useState } from "react";
import { ApiImporter } from "./ApiImporter";
import { BacklogDumpImporter } from "./BacklogDumpImporter";
import { FileImporter } from "./FileImporter";

type Tab = "api" | "backlog-dump" | "archive";

const TABS: { id: Tab; label: string }[] = [
  { id: "api", label: "Backlog API から" },
  { id: "backlog-dump", label: "Backlog ダンプから" },
  { id: "archive", label: "backlog-x ダンプから" },
];

/**
 * 取り込み方式の切り替え（3 通り）。
 * - **Backlog API から**: 管理者がキー入力で Backlog から取得（初回の取り込み）。
 * - **Backlog ダンプから**: Backlog API のレスポンス原本（backlog-raw-*.json.gz）を取り込む。
 *   API を叩かずに再取り込みでき、API キーを持たないメンバーにも配れる。
 * - **backlog-x ダンプから**: backlog-x が正規化・索引済みのアーカイブ（backlog-x-*.json.gz）を
 *   取り込む（共有）。検索インデックス同梱なので取り込み後すぐ検索できる。
 */
export function ImportTabs() {
  const [tab, setTab] = useState<Tab>("api");

  return (
    <div className="flex flex-col gap-5">
      {/* タブはアプリ共通の丸ピル（active = sky-600 塗り）に揃える */}
      <div className="flex items-center gap-1 text-sm">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              tab === id
                ? "rounded-full bg-sky-600 px-3 py-1 font-medium text-white"
                : "rounded-full px-3 py-1 text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "api" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            管理者の API キーを入力すると、ブラウザが直接 Backlog API
            を叩いて課題・コメント・ アイコンを取得し、このブラウザのローカル DB
            に取り込みます。
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              スペース URL・API
              キー・取得データはこのブラウザの外には一切送信されません。
            </span>
          </p>
          <ApiImporter />
        </div>
      ) : tab === "backlog-dump" ? (
        <div className="flex flex-col gap-3">
          <div className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            <p>
              <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                Backlog ダンプ
              </strong>
              （Backlog API のレスポンス原本）を取り込みます。「Backlog API
              から」タブで 取得したときに保存されるファイルです。Backlog API
              を叩かないので、同じデータを何度でも取り込めます（API
              キーも不要です）。
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              <li className="flex gap-2">
                <span className="shrink-0 text-zinc-400">・</span>
                <span>
                  <code className="whitespace-nowrap">
                    backlog-raw-&lt;プロジェクト&gt;.json.gz
                  </code>{" "}
                  … ダンプ本体（課題・コメント・Wiki・ドキュメントの原本）
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 text-zinc-400">・</span>
                <span>
                  <code className="whitespace-nowrap">
                    backlog-raw-&lt;プロジェクト&gt;-attachments.zip
                  </code>{" "}
                  … 添付ファイル本体（あれば本体と一緒に選択可）
                </span>
              </li>
            </ul>
            <p className="mt-2">
              取り込む種類はダンプを取得したときの選択（課題・コメント・Wiki
              等）に従います。正規化・検索インデックスの構築はここで行うため、
              「backlog-x ダンプから」より少し時間がかかります。
            </p>
          </div>
          <BacklogDumpImporter />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            <p>
              別のメンバーが書き出した{" "}
              <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                backlog-x ダンプ
              </strong>
              （backlog-x
              が正規化・索引済みのアーカイブ）を選択してインポートします。検索インデックスも
              含まれるため、取り込み後すぐに検索・閲覧できます。
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              <li className="flex gap-2">
                <span className="shrink-0 text-zinc-400">・</span>
                <span>
                  <code className="whitespace-nowrap">
                    backlog-x-&lt;プロジェクト&gt;.json.gz
                  </code>{" "}
                  … アーカイブ本体（課題・コメント・Wiki 等）
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 text-zinc-400">・</span>
                <span>
                  <code className="whitespace-nowrap">.zip</code> …
                  添付ファイル本体（あれば本体と一緒に選択可）
                </span>
              </li>
            </ul>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs leading-6 text-zinc-600 dark:border-zinc-700/60 dark:bg-zinc-800/40 dark:text-zinc-400">
            <p className="font-medium text-zinc-700 dark:text-zinc-300">
              アイコン補完ファイル（
              <code className="whitespace-nowrap">
                backlog-x-&lt;プロジェクト&gt;-icons.json.gz
              </code>
              ）もここから取り込めます
            </p>
            <p className="mt-1">
              Nulab
              アカウント連携ユーザーのアイコンはブラウザの制約で取得できません。CLI
              で全員分を書き出したこのファイルを取り込むと、欠けていたアイコンが補われます。
            </p>
            <ul className="mt-1 flex flex-col gap-0.5 text-zinc-500 dark:text-zinc-500">
              <li>
                ・ユーザーアイコンにのみ追加され、課題・コメントは変更しません
              </li>
              <li>・アーカイブ本体の前後どちらでも・単独でも取り込めます</li>
            </ul>
            <details className="mt-2">
              <summary className="cursor-pointer font-medium text-zinc-700 select-none dark:text-zinc-300">
                アイコン補完ファイルの作り方（CLI）
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                <p>
                  リポジトリのルートで以下を実行します（Node が必要）。API
                  キーは環境変数で渡し、コマンド履歴に残さないようにします。
                  <code className="whitespace-nowrap">--project</code>{" "}
                  を省略すると自分が見える全ユーザーが対象になります。
                </p>
                <pre className="overflow-x-auto rounded bg-zinc-100 p-2 font-mono text-[11px] leading-5 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                  {`BACKLOG_API_KEY=xxxx node scripts/fetch-icons.mjs \\
  --space https://example.backlog.jp \\
  --project PROJ \\
  --out backlog-x-PROJ-icons.json.gz`}
                </pre>
                <p>
                  出力された{" "}
                  <code className="whitespace-nowrap">
                    backlog-x-PROJ-icons.json.gz
                  </code>{" "}
                  をこの画面で選択して取り込みます。
                </p>
              </div>
            </details>
          </div>
          <FileImporter />
        </div>
      )}
    </div>
  );
}
