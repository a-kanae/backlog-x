"use client";

/**
 * 課題一覧の絞り込みバー。
 *
 * Backlog の検索画面（状態・種別・カテゴリー・担当者の絞り込み + ソート）を参考にしつつ、
 * UI は模倣せず独自デザイン（zinc ニュートラル + sky アクセント）にする。
 *
 * - 状態: 「すべて / 未完了 / 各ステータス」のトグルチップ（よく使う「未完了」を一発で）
 * - カテゴリー / 担当者: セレクトボックス（選択肢が多いので畳む）
 * - ソート: フィールド（更新日 / 登録日 / キー）× 並び順（新しい / 古い）
 *
 * 種別は絞り込み対象にせず、一覧行にバッジ表示するだけにしている（要望による）。
 *
 * 選択肢（options）は DataSource.getFilterOptions から渡される。null の間は描画を抑える。
 */

import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import type {
  FilterOptions,
  IssueFilter,
  IssueSort,
  SortOrder,
} from "@/lib/datasource/types";

/** 完了扱いするステータス名。Backlog の標準では「完了」 */
const DONE_STATUS_NAME = "完了";

/**
 * 状態フィルタのプリセット。
 * - 'all': 全件
 * - 'incomplete': 完了以外
 * - number: そのステータス id のみ
 */
export type StatusPreset = "all" | "incomplete" | number;

export interface IssueFilterBarProps {
  options: FilterOptions | null;
  statusPreset: StatusPreset;
  onStatusPreset: (preset: StatusPreset) => void;
  filter: IssueFilter;
  onFilter: (filter: IssueFilter) => void;
  sort: IssueSort;
  order: SortOrder;
  onSort: (sort: IssueSort, order: SortOrder) => void;
}

/** 並び替えの対象フィールド。クリックで選択、選択中の再クリックで昇順/降順をトグルする */
const SORT_FIELDS: { value: IssueSort; label: string }[] = [
  { value: "updated", label: "更新日" },
  { value: "created", label: "登録日" },
  { value: "keyId", label: "キー" },
];

const chipBase =
  "rounded-full px-3 py-1 text-xs font-medium transition-colors border";
const chipActive = "border-sky-600 bg-sky-600 text-white";
const chipIdle =
  "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600";

// ネイティブのプルダウン矢印は枠の右端に張り付いて窮屈なので、appearance-none で消し、
// 自前の ChevronDown を右端から少し内側（余白付き）に重ねる。
const selectClass =
  "appearance-none rounded-md border border-zinc-300 bg-white py-1 pl-2.5 pr-8 text-sm text-zinc-700 focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";

/** プルダウンの矢印に右余白を持たせた select ラッパー */
function Select({
  value,
  onChange,
  children,
}: {
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <span className="relative inline-flex items-center">
      <select value={value} onChange={onChange} className={selectClass}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 size-3.5 text-zinc-400"
        aria-hidden
      />
    </span>
  );
}

/** select の value（空文字 = 未選択）を number | undefined に変換 */
function parseSelect(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}

export function IssueFilterBar({
  options,
  statusPreset,
  onStatusPreset,
  filter,
  onFilter,
  sort,
  order,
  onSort,
}: IssueFilterBarProps) {
  if (!options) {
    return (
      <div className="h-9 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
    );
  }

  const hasCategories = options.categories.length > 0;
  const hasMilestones = options.milestones.length > 0;
  const hasVersions = options.versions.length > 0;

  return (
    // 状態トグルチップ段と、その下のフィルタ select 段の上下間隔を少しゆとりを持たせる（gap-4）。
    <div className="flex flex-col gap-4">
      {/* 状態トグルチップ */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onStatusPreset("all")}
          className={`${chipBase} ${statusPreset === "all" ? chipActive : chipIdle}`}
        >
          すべて
        </button>
        <button
          type="button"
          onClick={() => onStatusPreset("incomplete")}
          className={`${chipBase} ${statusPreset === "incomplete" ? chipActive : chipIdle}`}
        >
          未完了
        </button>
        {options.statuses.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onStatusPreset(s.id)}
            className={`${chipBase} ${
              statusPreset === s.id ? chipActive : chipIdle
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>

      {/* カテゴリー / マイルストーン / 発生バージョン / 担当者 / ソート
          （種別は絞り込み対象外。一覧行にバッジ表示のみ）。
          各フィルタが窮屈に見えないよう横方向の間隔を広め（gap-x-4）に取る。 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {hasCategories && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            カテゴリー
            <Select
              value={filter.categoryId ?? ""}
              onChange={(e) =>
                onFilter({ ...filter, categoryId: parseSelect(e.target.value) })
              }
            >
              <option value="">すべて</option>
              {options.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
        )}

        {hasMilestones && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            マイルストーン
            <Select
              value={filter.milestoneId ?? ""}
              onChange={(e) =>
                onFilter({
                  ...filter,
                  milestoneId: parseSelect(e.target.value),
                })
              }
            >
              <option value="">すべて</option>
              {options.milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </label>
        )}

        {hasVersions && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            発生バージョン
            <Select
              value={filter.versionId ?? ""}
              onChange={(e) =>
                onFilter({ ...filter, versionId: parseSelect(e.target.value) })
              }
            >
              <option value="">すべて</option>
              {options.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </label>
        )}

        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          担当者
          <Select
            value={filter.assigneeId ?? ""}
            onChange={(e) =>
              onFilter({ ...filter, assigneeId: parseSelect(e.target.value) })
            }
          >
            <option value="">すべて</option>
            {options.assignees.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </label>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-zinc-500">並び替え</span>
          {SORT_FIELDS.map((f) => {
            const active = sort === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => {
                  // 選択中フィールドの再クリックで昇順/降順をトグル。別フィールドは降順から開始
                  if (active)
                    onSort(f.value, order === "desc" ? "asc" : "desc");
                  else onSort(f.value, "desc");
                }}
                className={`${chipBase} inline-flex items-center gap-1 ${active ? chipActive : chipIdle}`}
                aria-pressed={active}
              >
                {f.label}
                {active &&
                  (order === "desc" ? (
                    <ArrowDown className="size-3" aria-label="降順" />
                  ) : (
                    <ArrowUp className="size-3" aria-label="昇順" />
                  ))}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * StatusPreset + 既存フィルタから DataSource に渡す IssueFilter を組み立てる。
 * - 'all': statusId なし
 * - 'incomplete': 完了ステータスを除く（呼び出し側で除外できないため、ここでは statusId を立てず、
 *   IssueList 側で「完了 id を除外」する。詳細は IssueList の resolveStatusFilter を参照）
 * - number: その statusId を立てる
 *
 * incomplete は単一 statusId では表せない（IN クエリが要る）。よって「完了 id 集合」を返し、
 * 呼び出し側でフィルタ後に除外させる。ここでは完了ステータスの id 一覧を計算するヘルパのみ提供。
 */
export function doneStatusIds(options: FilterOptions | null): number[] {
  if (!options) return [];
  return options.statuses
    .filter((s) => s.name === DONE_STATUS_NAME)
    .map((s) => s.id);
}
