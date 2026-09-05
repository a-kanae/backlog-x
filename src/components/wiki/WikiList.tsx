"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { StoredWiki } from "@/types/entities";
import { useDataSource } from "@/lib/datasource/context";
import { UserLabel } from "@/components/ui/UserLabel";

const PAGE_SIZE = 100;

/**
 * Wiki 一覧。更新日降順でページング取得し、各行から Wiki 詳細へリンクする。
 */
export function WikiList({ projectId }: { projectId: number }) {
  const ds = useDataSource();
  const [items, setItems] = useState<StoredWiki[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // setState は .then（非同期コールバック）内で呼ぶ（effect 直下の同期 setState を避ける）。
    // projectId 変更は別ページ遷移＝再マウントなので初期 state（loading=true）で足りる。
    let cancelled = false;
    ds.listWikis({ projectId, offset: 0, limit: PAGE_SIZE }).then((page) => {
      if (cancelled) return;
      setItems(page.items);
      setTotal(page.total);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [ds, projectId]);

  if (loading) {
    return <p className="text-sm text-zinc-400">読み込み中…</p>;
  }
  if (total === 0) {
    return (
      <p className="text-sm text-zinc-500">
        このプロジェクトには Wiki がありません。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-zinc-500">
        {total.toLocaleString()} 件
        {items.length < total && `（${items.length} 件表示中）`}
      </p>
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700/60 dark:bg-zinc-900/40">
        {items.map((w) => (
          <Link
            key={w.id}
            href={`/projects/${projectId}/wikis/${w.id}`}
            // 一覧に最大 199 件並ぶため、自動 prefetch による大量の RSC キャッシュが
            // 左右キーでの兄弟ルート遷移と衝突し Hydration エラーを起こすため無効化。
            prefetch={false}
            className="flex flex-col gap-1 border-b border-zinc-100 px-4 py-3 transition-colors last:border-b-0 hover:bg-zinc-50 dark:border-zinc-700/60 dark:hover:bg-zinc-800"
          >
            <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {w.name}
            </span>
            <span className="flex items-center gap-2 text-xs text-zinc-400">
              <UserLabel user={w.updatedUser ?? w.createdUser} size={16} />
              <span>更新: {formatDate(w.updated)}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
