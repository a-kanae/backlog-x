"use client";

/**
 * 統一ワークスペースのコンテンツエリアに描画する各サブビュー。
 *
 * ヘッダー・検索・カテゴリは ProjectWorkspace 側に常駐し、ここは「課題一覧 / 課題詳細 /
 * Wiki 詳細 / ドキュメント一覧 / ドキュメント詳細」など、URL に応じて差し替わる中身だけを担う。
 * データ取得は各詳細ビューが内包する（従来の *PageClient のロジックを流用）。
 */

import { useEffect, useState } from "react";
import { useDataSource } from "@/lib/datasource/context";
import type { StoredIssue, StoredWiki, StoredDocument } from "@/types/entities";
import { IssueDetail } from "@/components/issue/IssueDetail";
import { WikiList } from "@/components/wiki/WikiList";
import { WikiDetail } from "@/components/wiki/WikiDetail";
import { DocumentList } from "@/components/document/DocumentList";
import { DocumentDetail } from "@/components/document/DocumentDetail";

/** Backlog の Wiki トップページの慣習的な名前。 */
const WIKI_HOME_NAME = "Home";

/** 詳細取得の三状態（undefined=読み込み中 / null=見つからない / 値=取得済み） */
type Loadable<T> = T | null | undefined;

function Loading() {
  return <p className="text-sm text-zinc-400">読み込み中…</p>;
}

/** 課題詳細（keyId からデータ取得）。 */
export function IssueDetailView({
  projectId,
  keyId,
}: {
  projectId: number;
  keyId: number;
}) {
  const ds = useDataSource();
  const [issue, setIssue] = useState<Loadable<StoredIssue>>(undefined);

  // ID 変更時の「読み込み中へ戻す」は、呼び出し側で key={keyId} を付けて再マウントさせる
  // ことで初期 state（undefined）から始める（effect 内の同期 setState を避ける）。
  useEffect(() => {
    let cancelled = false;
    ds.getIssueByKeyId(projectId, keyId).then((found) => {
      if (!cancelled) setIssue(found ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [ds, projectId, keyId]);

  if (issue === undefined) return <Loading />;
  if (issue === null)
    return (
      <p className="text-sm text-zinc-500">この課題は見つかりませんでした。</p>
    );
  return <IssueDetail issue={issue} />;
}

/** Wiki 一覧（更新順）。 */
export function WikiListView({ projectId }: { projectId: number }) {
  return <WikiList projectId={projectId} />;
}

/**
 * Wiki の既定表示（本家 Backlog と同じく Home ページ）。
 * name が "Home" の Wiki があればその本文を表示し、無ければ更新順一覧にフォールバックする。
 */
export function WikiHomeView({ projectId }: { projectId: number }) {
  const ds = useDataSource();
  const [home, setHome] = useState<Loadable<StoredWiki>>(undefined);

  useEffect(() => {
    let cancelled = false;
    ds.getWikiByName(projectId, WIKI_HOME_NAME).then((found) => {
      if (!cancelled) setHome(found ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [ds, projectId]);

  if (home === undefined) return <Loading />;
  // Home ページが無いプロジェクトでは一覧をそのまま既定表示にする（OSS 汎用）。
  if (home === null) return <WikiList projectId={projectId} />;
  // 一覧への導線は右サイドバー（ページ一覧セクション）に集約しているため、ここには置かない。
  return <WikiDetail wiki={home} />;
}

/** Wiki 詳細（wikiId からデータ取得）。 */
export function WikiDetailView({
  projectId,
  wikiId,
}: {
  projectId: number;
  wikiId: number;
}) {
  const ds = useDataSource();
  const [wiki, setWiki] = useState<Loadable<StoredWiki>>(undefined);

  // ID 変更時は呼び出し側の key={wikiId} で再マウントして初期 state から始める。
  useEffect(() => {
    let cancelled = false;
    ds.getWikiById(projectId, wikiId).then((found) => {
      if (!cancelled) setWiki(found ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [ds, projectId, wikiId]);

  if (wiki === undefined) return <Loading />;
  if (wiki === null)
    return (
      <p className="text-sm text-zinc-500">
        この Wiki は見つかりませんでした。
      </p>
    );
  return <WikiDetail wiki={wiki} />;
}

/** ドキュメント一覧。 */
export function DocumentListView({ projectId }: { projectId: number }) {
  return <DocumentList projectId={projectId} />;
}

/** ドキュメント詳細（documentId からデータ取得）。 */
export function DocumentDetailView({
  projectId,
  documentId,
}: {
  projectId: number;
  documentId: string;
}) {
  const ds = useDataSource();
  const [doc, setDoc] = useState<Loadable<StoredDocument>>(undefined);

  // ID 変更時は呼び出し側の key={documentId} で再マウントして初期 state から始める。
  useEffect(() => {
    let cancelled = false;
    ds.getDocumentById(projectId, documentId).then((found) => {
      if (!cancelled) setDoc(found ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [ds, projectId, documentId]);

  if (doc === undefined) return <Loading />;
  if (doc === null) {
    return (
      <p className="text-sm text-zinc-500">
        このドキュメントは見つかりませんでした。
      </p>
    );
  }
  return <DocumentDetail document={doc} />;
}
