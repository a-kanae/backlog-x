import type { NamedColorMaster } from "@/types/entities";

/**
 * ステータス・課題種別のバッジ。Backlog のマスタが持つ color をそのまま使い、
 * 独自デザインの角丸ピルで表示する（Backlog の UI を模倣しない）。
 */
export function StatusBadge({ master }: { master: NamedColorMaster }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: master.color }}
    >
      {master.name}
    </span>
  );
}
