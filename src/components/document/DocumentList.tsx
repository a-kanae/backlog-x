"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { StoredDocument } from "@/types/entities";
import { useDataSource } from "@/lib/datasource/context";
import { UserLabel } from "@/components/ui/UserLabel";

/** ツリー表示用に、親→子の深さを計算して並べ替えた行 */
interface FlatRow {
  doc: StoredDocument;
  depth: number;
}

/**
 * childDocumentIds からツリー順（親→子・深さ付き）の行配列を作る。
 * ルート = どの childDocumentIds にも含まれないドキュメント。循環や欠落 ID にも耐えるよう
 * 訪問済みを記録し、未訪問のものは最後にフラットに足す。
 */
function buildTree(docs: StoredDocument[]): FlatRow[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const childIds = new Set<string>();
  for (const d of docs) for (const c of d.childDocumentIds) childIds.add(c);
  const roots = docs.filter((d) => !childIds.has(d.id));

  const rows: FlatRow[] = [];
  const visited = new Set<string>();
  const walk = (doc: StoredDocument, depth: number) => {
    if (visited.has(doc.id)) return;
    visited.add(doc.id);
    rows.push({ doc, depth });
    for (const cid of doc.childDocumentIds) {
      const child = byId.get(cid);
      if (child) walk(child, depth + 1);
    }
  };
  for (const r of roots) walk(r, 0);
  // ツリーから漏れたもの（循環等）はフラットに追加
  for (const d of docs) if (!visited.has(d.id)) rows.push({ doc: d, depth: 0 });
  return rows;
}

/**
 * ドキュメント一覧。ツリー階層（childDocumentIds）をインデントで表現し、各行から詳細へリンクする。
 */
export function DocumentList({ projectId }: { projectId: number }) {
  const ds = useDataSource();
  const [rows, setRows] = useState<FlatRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // setState は .then（非同期コールバック）内で呼ぶ（effect 直下の同期 setState を避ける）。
    // projectId 変更は別ページ遷移＝再マウントなので初期 state（loading=true）で足りる。
    let cancelled = false;
    ds.listDocuments(projectId).then((docs) => {
      if (cancelled) return;
      setRows(buildTree(docs));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [ds, projectId]);

  if (loading) {
    return <p className="text-sm text-zinc-400">読み込み中…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        このプロジェクトにはドキュメントがありません。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-zinc-500">{rows.length.toLocaleString()} 件</p>
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700/60 dark:bg-zinc-900/40">
        {rows.map(({ doc, depth }) => (
          <Link
            key={doc.id}
            href={`/projects/${projectId}/documents/${doc.id}`}
            // 一覧の件数が増えても大量の同時 prefetch による RSC キャッシュ競合を
            // 避けるため無効化（IssueListRow.tsx 参照）。
            prefetch={false}
            className="flex flex-col gap-1 border-b border-zinc-100 px-4 py-3 transition-colors last:border-b-0 hover:bg-zinc-50 dark:border-zinc-700/60 dark:hover:bg-zinc-800"
            style={{ paddingLeft: `${16 + depth * 20}px` }}
          >
            <span className="flex items-center gap-1.5 truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {doc.emoji && <span aria-hidden>{doc.emoji}</span>}
              <span className="truncate">{doc.title || "(無題)"}</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-zinc-400">
              <UserLabel user={doc.updatedUser ?? doc.createdUser} size={16} />
              <span>更新: {formatDate(doc.updated)}</span>
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
