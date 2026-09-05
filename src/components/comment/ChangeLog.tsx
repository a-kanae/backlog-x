import { ArrowRight } from "lucide-react";
import type { StoredChangeLog } from "@/types/entities";

/**
 * コメントに付随する変更ログ（ステータス変更・担当者変更・添付など）をシステムコメントとして整形する。
 *
 * Backlog 記法のフルパースは範囲外。field を人間可読なラベルに直し、
 * 「A → B」の素朴な差分表示にとどめる（アーカイブの可読性が目的）。
 * notification（通知のみ）の変更は意味を持たないので呼び出し側で除外される。
 */

/** Backlog の changeLog.field → 表示ラベル */
const FIELD_LABELS: Record<string, string> = {
  status: "ステータス",
  assignee: "担当者",
  assigner: "担当者", // API の changeLog では担当者変更が "assigner" で来る
  resolution: "完了理由",
  priority: "優先度",
  issueType: "種別",
  milestone: "マイルストーン",
  version: "発生バージョン",
  category: "カテゴリー",
  summary: "件名",
  description: "詳細",
  startDate: "開始日",
  dueDate: "期限日",
  estimatedHours: "予定時間",
  actualHours: "実績時間",
  attachment: "添付ファイル",
  parentIssue: "親課題",
  limitDate: "期限日",
  component: "カテゴリー",
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * 長文フィールド（差分の中身を出さず「変更しました」とだけ表示する）。
 * description/summary は Backlog 記法を含む長文になりがちで、全文差分を出すとログが崩れる。
 * Backlog の更新履歴も詳細変更は中身を出さないのに倣う。
 */
const LONG_TEXT_FIELDS = new Set(["description", "summary"]);

/**
 * 短い値に紛れる Backlog 記法記号を簡易的に剥がしてプレーン化する（ログ可読性のため）。
 * 本文ではないので厳密なパースはせず、囲み記号を外す程度にとどめる。
 */
function plainifyValue(value: string): string {
  return value
    .replace(/''([^']+)''/g, "$1") // 強調
    .replace(/%%([^%]+)%%/g, "$1") // 打消
    .replace(/\[\[([^\]]+)\]\]/g, "$1") // リンク
    .trim();
}

function ChangeRow({ entry }: { entry: StoredChangeLog }) {
  const label = fieldLabel(entry.field);

  // 添付ファイルの追加/削除は値ではなくファイル名で表す
  if (entry.field === "attachment") {
    const name =
      entry.attachmentName ?? entry.newValue ?? entry.originalValue ?? "";
    const added = entry.newValue != null && entry.originalValue == null;
    return (
      <li className="text-xs text-zinc-500">
        {label}を{added ? "追加" : "変更"}:{" "}
        <span className="text-zinc-600 dark:text-zinc-300">{name}</span>
      </li>
    );
  }

  // 長文フィールド（詳細・件名）は中身を出さず「変更しました」だけ
  if (LONG_TEXT_FIELDS.has(entry.field)) {
    return <li className="text-xs text-zinc-500">{label}を変更しました</li>;
  }

  const from = entry.originalValue ? plainifyValue(entry.originalValue) : "";
  const to = entry.newValue != null ? plainifyValue(entry.newValue) : "";

  // 原本（Backlog）に倣い「ラベル: 旧値 → 新値」の形で表示する
  return (
    <li className="text-xs text-zinc-500">
      <span className="text-zinc-500">{label}:</span>{" "}
      {from ? (
        <>
          <span className="text-zinc-400">{from}</span>
          <ArrowRight
            className="mx-1 inline size-3 align-middle text-zinc-400"
            aria-hidden
          />
        </>
      ) : null}
      <span className="text-zinc-600 dark:text-zinc-300">
        {to || "（未設定）"}
      </span>
    </li>
  );
}

export function ChangeLog({ entries }: { entries: StoredChangeLog[] }) {
  // notification 以外の変更（ステータス・担当者など）を通常表示する。
  const changes = entries.filter((e) => !e.notificationOnly);

  // 表示すべき変更が無く notification だけのとき = 課題作成の「お知らせ」。
  // 原本（Backlog）に倣い「お知らせ：課題の追加」を表示する（コメント数・表記を原本と一致させる）。
  const onlyNotification =
    changes.length === 0 && entries.some((e) => e.notificationOnly);

  if (onlyNotification) {
    return (
      <ul className="flex flex-col gap-0.5">
        <li className="text-xs text-zinc-500">お知らせ：課題の追加</li>
      </ul>
    );
  }

  if (changes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5">
      {changes.map((entry, i) => (
        <ChangeRow key={i} entry={entry} />
      ))}
    </ul>
  );
}
