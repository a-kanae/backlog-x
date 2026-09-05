"use client";

/**
 * static export + 動的ルートのフォールバック構成で使うルートパラメータ解決。
 *
 * Next.js App Router を `output: 'export'` でビルドすると、動的ルート ([projectId] 等) の
 * params はビルド時の generateStaticParams の値 (プレースホルダ '_') が焼き込まれ、
 * クライアントで `use(params)` / `useParams()` を呼んでも **実 URL の値ではなく '_' が返る**
 * (Next.js 公式既知の制約: "output: export does not support useParams() on client")。
 *
 * そのため実 URL の値は `usePathname()` (= 実際のロケーション) から自前でパースする。
 * Firebase Hosting 側の rewrites で実 URL を動的シェル HTML にマップし、ここで値を読む。
 *
 * 対象パス:
 *   /projects/:projectId
 *   /projects/:projectId/issues/:keyId
 *   /projects/:projectId/wikis/:wikiId       （wikiId は数値）
 *   /projects/:projectId/documents/:documentId （documentId は 32 文字の文字列）
 */

import { usePathname } from "next/navigation";

export interface ProjectRouteParams {
  projectId: number | null;
}

export interface IssueRouteParams {
  projectId: number | null;
  keyId: number | null;
}

export interface WikiRouteParams {
  projectId: number | null;
  wikiId: number | null;
}

export interface DocumentRouteParams {
  projectId: number | null;
  /** ドキュメント ID は 32 文字の文字列なので数値化しない */
  documentId: string | null;
}

/** "/projects/123" → 123。数値化できなければ null。 */
export function parseProjectId(pathname: string): number | null {
  const m = pathname.match(/^\/projects\/([^/]+)/);
  if (!m) return null;
  return toId(decodeURIComponent(m[1]));
}

/** "/projects/123/issues/456" → { 123, 456 }。 */
export function parseIssueRoute(pathname: string): IssueRouteParams {
  const m = pathname.match(/^\/projects\/([^/]+)\/issues\/([^/]+)/);
  if (!m) return { projectId: null, keyId: null };
  return {
    projectId: toId(decodeURIComponent(m[1])),
    keyId: toId(decodeURIComponent(m[2])),
  };
}

/** "/projects/123/wikis/456" → { 123, 456 }。wikiId は数値。 */
export function parseWikiRoute(pathname: string): WikiRouteParams {
  const m = pathname.match(/^\/projects\/([^/]+)\/wikis\/([^/]+)/);
  if (!m) return { projectId: null, wikiId: null };
  return {
    projectId: toId(decodeURIComponent(m[1])),
    wikiId: toId(decodeURIComponent(m[2])),
  };
}

/** "/projects/123/documents/abc..." → { 123, "abc..." }。documentId は文字列のまま。 */
export function parseDocumentRoute(pathname: string): DocumentRouteParams {
  const m = pathname.match(/^\/projects\/([^/]+)\/documents\/([^/]+)/);
  if (!m) return { projectId: null, documentId: null };
  return {
    projectId: toId(decodeURIComponent(m[1])),
    documentId: toStrId(decodeURIComponent(m[2])),
  };
}

/** 詳細ページの URL ハッシュから読み取る「ヒット案内」の指示。 */
export interface DetailHash {
  /** #comment-<id> のコメント ID（コメントヒット＝該当コメント枠へジャンプ）。無ければ null */
  commentId: number | null;
  /** #q=<語> の検索語（本文ヒット＝本文をハイライト＋スクロール）。無ければ空文字 */
  highlightTerm: string;
}

/**
 * 詳細ページ（課題・Wiki・ドキュメント）の URL ハッシュを解釈する唯一の関数。
 *
 * 検索結果から詳細を別タブで開くとき、「何を案内すべきか」をハッシュで渡す:
 *   #comment-<id> … コメントヒット。該当コメント枠へジャンプ＋枠ハイライト（本文は光らせない）。
 *   #q=<語>       … 本文（課題/Wiki/ドキュメント）ヒット。本文中の語をハイライト＋先頭一致へスクロール。
 * この 2 つは検索側で排他に付与される（SearchResults.hitHref）。ここでは両方を一度に読めるよう
 * `&` 区切りでパースし、完全一致正規表現の脆さ（`&` が付くと壊れる）を避ける。
 *
 * static export でも window.location.hash から読めるので useSearchParams（Suspense 必須）は不要。
 * SSR/prerender 時は window が無いので既定値（commentId=null / term=''）を返す。
 */
export function parseDetailHash(): DetailHash {
  const empty: DetailHash = { commentId: null, highlightTerm: "" };
  if (typeof window === "undefined") return empty;
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "") return empty;
  const result: DetailHash = { commentId: null, highlightTerm: "" };
  for (const part of hash.split("&")) {
    const cm = part.match(/^comment-(\d+)$/);
    if (cm) {
      result.commentId = Number(cm[1]);
      continue;
    }
    if (part.startsWith("q=")) {
      try {
        result.highlightTerm = decodeURIComponent(part.slice(2));
      } catch {
        result.highlightTerm = "";
      }
    }
  }
  return result;
}

/** 本文ハイライト用の検索語だけを読む薄いラッパ（parseDetailHash().highlightTerm）。 */
export function readHighlightTerm(): string {
  return parseDetailHash().highlightTerm;
}

/** プレースホルダ '_' や非数値は null に倒す。 */
function toId(raw: string): number | null {
  if (raw === "_" || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** 文字列 ID 用。プレースホルダ '_' / 空文字は null に倒す（数値化はしない）。 */
function toStrId(raw: string): string | null {
  if (raw === "_" || raw === "") return null;
  return raw;
}

/** プロジェクト詳細ページ用フック。 */
export function useProjectRouteParams(): ProjectRouteParams {
  const pathname = usePathname();
  return { projectId: parseProjectId(pathname ?? "") };
}

/** 課題詳細ページ用フック。 */
export function useIssueRouteParams(): IssueRouteParams {
  const pathname = usePathname();
  return parseIssueRoute(pathname ?? "");
}

/** Wiki 詳細ページ用フック。 */
export function useWikiRouteParams(): WikiRouteParams {
  const pathname = usePathname();
  return parseWikiRoute(pathname ?? "");
}

/** ドキュメント詳細ページ用フック。 */
export function useDocumentRouteParams(): DocumentRouteParams {
  const pathname = usePathname();
  return parseDocumentRoute(pathname ?? "");
}

/**
 * 統一ワークスペース（ProjectWorkspace）が「いま何を表示すべきか」を表す解決済みビュー。
 *
 * /projects/:id 配下の URL を 1 つに集約し、ヘッダー・検索・カテゴリは据え置きで
 * コンテンツエリアの中身だけ差し替えるため、URL から「カテゴリ（課題/Wiki/ドキュメント）」と
 * 「一覧 or 詳細」と「対象 ID」をまとめて判定する。
 */
export type ContentCategory = "issue" | "wiki" | "document";

export type WorkspaceView =
  | { category: "issue"; mode: "list" }
  | { category: "issue"; mode: "detail"; keyId: number }
  // Wiki は既定で Home ページ（本家 Backlog と同じ）を表示する 'home' と、
  // 更新順の一覧を表示する 'list'、個別ページの 'detail' の 3 モード。
  | { category: "wiki"; mode: "home" }
  | { category: "wiki"; mode: "list" }
  | { category: "wiki"; mode: "detail"; wikiId: number }
  | { category: "document"; mode: "list" }
  | { category: "document"; mode: "detail"; documentId: string };

export interface ResolvedWorkspace {
  projectId: number | null;
  view: WorkspaceView;
}

/**
 * /projects/:id 配下の pathname を解決する。
 * 既定（/projects/:id のみ）は課題一覧。サブパス（/wikis, /wikis/:id, /documents, …）で分岐。
 */
export function resolveWorkspace(pathname: string): ResolvedWorkspace {
  const projectId = parseProjectId(pathname);

  // 詳細パスを優先判定（より具体的なパターンから）
  const issue = pathname.match(/^\/projects\/[^/]+\/issues\/([^/]+)/);
  if (issue) {
    const keyId = toId(decodeURIComponent(issue[1]));
    if (keyId !== null)
      return { projectId, view: { category: "issue", mode: "detail", keyId } };
  }
  const wiki = pathname.match(/^\/projects\/[^/]+\/wikis\/([^/]+)/);
  if (wiki) {
    const seg = decodeURIComponent(wiki[1]);
    // /wikis/list は更新順一覧の専用パス。数値 ID は個別ページ。
    if (seg === "list")
      return { projectId, view: { category: "wiki", mode: "list" } };
    const wikiId = toId(seg);
    if (wikiId !== null)
      return { projectId, view: { category: "wiki", mode: "detail", wikiId } };
    // それ以外（プレースホルダ '_' 等）は Home 既定に倒す。
    return { projectId, view: { category: "wiki", mode: "home" } };
  }
  if (/^\/projects\/[^/]+\/wikis\/?$/.test(pathname)) {
    // /wikis は本家 Backlog と同じく Home ページを既定表示。
    return { projectId, view: { category: "wiki", mode: "home" } };
  }
  const doc = pathname.match(/^\/projects\/[^/]+\/documents\/([^/]+)/);
  if (doc) {
    const documentId = toStrId(decodeURIComponent(doc[1]));
    if (documentId !== null) {
      return {
        projectId,
        view: { category: "document", mode: "detail", documentId },
      };
    }
    return { projectId, view: { category: "document", mode: "list" } };
  }
  if (/^\/projects\/[^/]+\/documents\/?$/.test(pathname)) {
    return { projectId, view: { category: "document", mode: "list" } };
  }
  // 既定は課題一覧（/projects/:id）
  return { projectId, view: { category: "issue", mode: "list" } };
}

/** ワークスペースのビュー解決フック。 */
export function useWorkspace(): ResolvedWorkspace {
  const pathname = usePathname();
  return resolveWorkspace(pathname ?? "");
}
