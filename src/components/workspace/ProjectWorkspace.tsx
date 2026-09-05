"use client";

/**
 * プロジェクトの統一ワークスペース。
 *
 * /projects/:id 配下（課題・Wiki・ドキュメントの一覧/詳細）を 1 つのコンポーネントに集約する。
 * ヘッダー（タイトル）・検索フォーム・コンテンツカテゴリ（課題/Wiki/ドキュメント）は常駐し、
 * URL に応じてコンテンツエリアの中身だけ差し替える。
 *
 * この static export 構成では全ルートが 1 枚の静的シェルに焼かれ、実 URL は usePathname を
 * パースして解決している（@/lib/routing/params）。本コンポーネントは遷移をまたいで再マウント
 * されないため、検索ワード・選択カテゴリ・Wiki ツリー展開などの状態が useState のまま保持される。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { useDataSource } from "@/lib/datasource/context";
import { ProjectIcon } from "@/components/ui/ProjectIcon";
import { useWorkspace, type ContentCategory } from "@/lib/routing/params";
import type { ProjectMeta } from "@/types/entities";
import type {
  FilterOptions,
  IssueFilter,
  IssueSort,
  SortOrder,
} from "@/lib/datasource/types";
import type { SearchHit } from "@/lib/search/types";
import { IssueList } from "@/components/issue/IssueList";
import {
  IssueFilterBar,
  doneStatusIds,
  type StatusPreset,
} from "@/components/issue/IssueFilterBar";
import { SearchBox } from "@/components/search/SearchBox";
import {
  SearchResults,
  hitHref,
  type SearchResultsHandle,
} from "@/components/search/SearchResults";
import { WikiSidebar } from "@/components/wiki/WikiSidebar";
import {
  IssueDetailView,
  WikiHomeView,
  WikiListView,
  WikiDetailView,
  DocumentListView,
  DocumentDetailView,
} from "./WorkspaceContent";

/** カテゴリタブの定義（順序＝表示順） */
const CATEGORIES: {
  key: ContentCategory;
  label: string;
  href: (pid: number) => string;
}[] = [
  { key: "issue", label: "課題", href: (pid) => `/projects/${pid}` },
  { key: "wiki", label: "Wiki", href: (pid) => `/projects/${pid}/wikis` },
  {
    key: "document",
    label: "ドキュメント",
    href: (pid) => `/projects/${pid}/documents`,
  },
];

export function ProjectWorkspace(props: { children?: React.ReactNode }) {
  // children（配下 page の出力）は使わない。コンテンツの出し分けはこのシェルが
  // usePathname（useWorkspace）から判定して描画する。children は layout 経由で
  // 渡ってくるが、各 page.tsx は null を返すため実質空。
  void props.children;
  const { projectId, view } = useWorkspace();
  const ds = useDataSource();
  const router = useRouter();

  const [project, setProject] = useState<ProjectMeta | null | undefined>(
    undefined,
  );
  const [options, setOptions] = useState<FilterOptions | null>(null);

  // 課題一覧の絞り込み・ソート（カテゴリ間で保持されるよう、ここに持つ）
  const [statusPreset, setStatusPreset] = useState<StatusPreset>("all");
  const [filter, setFilter] = useState<IssueFilter>({});
  const [sort, setSort] = useState<IssueSort>("updated");
  const [order, setOrder] = useState<SortOrder>("desc");

  // 全文検索の状態（ワークスペースに常駐させ、カテゴリで絞り込む）
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchGenRef = useRef(0);
  // 課題カテゴリの検索結果からコメントヒットを除外する（課題タブでのみ意味を持つ）。
  const [issueOnly, setIssueOnly] = useState(false);

  // 検索ボックス ⇔ 検索結果のキーボード操作に使う。
  const searchBoxRef = useRef<HTMLInputElement>(null);
  const searchResultsRef = useRef<SearchResultsHandle>(null);
  // 検索結果のキーボードナビ状態（結果表示中はページ全体で効くグローバル操作）。
  // selectedIndex: 選択中の行（リング表示）。inResults: 実フォーカスが結果リスト上にある論理状態。
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inResults, setInResults] = useState(false);

  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    ds.getProject(projectId).then((p) => {
      if (!cancelled) setProject(p ?? null);
    });
    ds.getFilterOptions(projectId).then((o) => {
      if (!cancelled) setOptions(o);
    });
    return () => {
      cancelled = true;
    };
  }, [ds, projectId]);

  // 入力をデバウンス（300ms）
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  // カテゴリ → 検索対象の kind（課題タブはコメントも含む）。
  // 検索インデックス自体を kind ごとに分けているため（searcher.ts 参照）、ここで絞った
  // kinds を検索側に渡すと、そのカテゴリだけで limit 件を確保できる（多数派カテゴリに
  // 少数派が押し出されない）。
  const searchKinds = useMemo<SearchHit["kind"][]>(() => {
    if (view.category === "issue") return ["issue", "comment"];
    if (view.category === "wiki") return ["wiki"];
    return ["document"];
  }, [view.category]);

  // デバウンス後のクエリ・カテゴリで検索。レース対策に世代番号で後着を破棄。
  useEffect(() => {
    if (projectId === null) return;
    const q = debouncedQuery.trim();
    if (q === "") return;
    const generation = ++searchGenRef.current;
    const isLatest = () => generation === searchGenRef.current;
    Promise.resolve()
      .then(() => {
        if (isLatest()) setSearching(true);
        // limit はカテゴリ内で確保する件数。カテゴリごとに独立したインデックスを
        // 検索するので、他カテゴリのヒット数に関わらずこの件数を確保できる。
        return ds.search(projectId, q, 500, searchKinds);
      })
      .then((result) => {
        if (!isLatest()) return;
        setHits(result);
        setSearching(false);
      });
  }, [ds, projectId, debouncedQuery, searchKinds]);

  const effectiveFilter = useMemo<IssueFilter>(() => {
    const base: IssueFilter = { ...filter };
    if (statusPreset === "all") {
      delete base.statusId;
      delete base.excludeStatusIds;
    } else if (statusPreset === "incomplete") {
      delete base.statusId;
      base.excludeStatusIds = doneStatusIds(options);
    } else {
      base.statusId = statusPreset;
      delete base.excludeStatusIds;
    }
    return base;
  }, [filter, statusPreset, options]);

  const isSearchMode = debouncedQuery.trim() !== "";
  const category = view.category;

  // hits は既に searchKinds（カテゴリ）で絞り込み済み（ds.search 呼び出し時に指定）。
  // カテゴリ切替時は debouncedQuery|category が変わって検索 effect が再実行され、
  // 新カテゴリの hits に置き換わる。課題カテゴリで issueOnly が有効なときだけ、
  // 取得済みの hits からコメントヒットをその場で除外する（再検索は不要）。
  const filteredHits = useMemo(() => {
    if (category === "issue" && issueOnly) {
      return hits.filter((h) => h.kind === "issue");
    }
    return hits;
  }, [hits, category, issueOnly]);

  // 表示中の結果セット（クエリ・カテゴリで変わる）が変化したら選択を先頭へ戻す。
  // カテゴリを ← → で切り替えると中身が入れ替わるので、そのたび先頭にリセットする。
  // 併せて、結果リストに居た（inResults）状態でカテゴリを切り替えたときは、URL 遷移で
  // 実フォーカスが外れるため、新しい結果の先頭行へフォーカスを寄せ直す（← → を続けて押せる）。
  const resultsKey = `${debouncedQuery}|${category}|${filteredHits.length}`;
  useEffect(() => {
    // 非同期境界（setTimeout）に逃がして、effect 直下の同期 setState（cascading renders を招く
    // react-hooks/set-state-in-effect）を避ける。新しい ResultList のマウント後に実フォーカスを
    // 移す意味でも次フレーム実行が都合よい。
    const id = window.setTimeout(() => {
      setSelectedIndex(0);
      // 結果リストに居た（inResults）状態でカテゴリを切り替えたときは URL 遷移で実フォーカスが
      // 外れるため、新しい結果の先頭行へ寄せ直す（← → を続けて押せるように）。
      if (inResults && filteredHits.length > 0)
        searchResultsRef.current?.focusRow(0);
    }, 0);
    return () => window.clearTimeout(id);
    // inResults の依存は意図的に外す（切替時点の値で一度だけ判断すればよく、
    // inResults 変化のたびに先頭へ飛ばしたくないため）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsKey]);

  // 隣のカテゴリへ移動する（← 前 / → 次）。両端では循環せず端で止まる。
  const moveCategory = useCallback(
    (dir: -1 | 1) => {
      if (projectId === null) return;
      const idx = CATEGORIES.findIndex((c) => c.key === category);
      const next = idx + dir;
      if (next < 0 || next >= CATEGORIES.length) return;
      router.push(CATEGORIES[next].href(projectId));
    },
    [projectId, category, router],
  );

  // 検索している間はページ全体で効くキーボードナビ（結果 0 件のカテゴリでも動く）。
  //   ↑↓ … フォーム ⇔ 結果 の往復＋結果内の移動（フォーカス位置に限らずどこでも。結果 0 件では無反応）
  //   ← → … 課題/Wiki/ドキュメントのカテゴリ移動。結果ナビに入っている（inResults）間だけ効き、
  //          0 件カテゴリでも隣へ通り抜けられる。フォーム入力中の ← → はテキストのカーソル移動を
  //          邪魔しないよう素通りする。
  //   Enter … 結果リスト上のとき選択中のヒットを別タブで開く
  // フォームの入力中でも ↑↓ は横取りする（テキスト編集には使わないキーなので害がない）。
  useEffect(() => {
    if (!isSearchMode) return;
    const handler = (e: KeyboardEvent) => {
      // IME 変換中（日本語入力の確定前）はナビゲーションしない。
      if (e.isComposing) return;
      const onSearchBox = document.activeElement === searchBoxRef.current;
      const count = filteredHits.length;

      // 実フォーカスの移動（focusRow 相当）は SearchResults 側の effect が
      // selectedIndex / active を見て追従するので、ここでは状態更新だけを行う。
      // updater 内で focus() 等の副作用を呼ぶと、focus→onFocus→onSelect の再帰と
      // Strict Mode の updater 二重実行が絡み、1 キーで 2 つ進む不具合になる（実際に
      // 別タブを開いて戻った直後＝リンクからフォーカスが外れた状態で顕在化した）。
      if (e.key === "ArrowDown") {
        if (count === 0) return; // 結果が無ければ ↓ は無反応（← → でのカテゴリ移動に委ねる）
        e.preventDefault();
        if (!inResults) {
          // フォーム側（or どこか）→ 結果の先頭へ入る。
          setInResults(true);
          setSelectedIndex(0);
          return;
        }
        setSelectedIndex((i) => Math.min(i + 1, count - 1));
      } else if (e.key === "ArrowUp") {
        if (!inResults) return; // フォーム側で ↑ は無反応
        e.preventDefault();
        // 先頭で ↑ ならフォームへ戻す。それ以外は 1 つ上へ。
        if (selectedIndex === 0) {
          setInResults(false);
          searchBoxRef.current?.focus();
        } else {
          setSelectedIndex((i) => Math.max(i - 1, 0));
        }
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // フォーム入力中はカーソル移動を優先（素通り）。結果ナビに入っているときだけカテゴリ移動。
        // 0 件カテゴリでも inResults は維持されるので、隣のカテゴリへ通り抜けられる。
        if (onSearchBox || !inResults) return;
        e.preventDefault();
        moveCategory(e.key === "ArrowLeft" ? -1 : 1);
      } else if (e.key === "Enter") {
        if (!inResults) return;
        const hit = filteredHits[selectedIndex];
        if (!hit) return;
        e.preventDefault();
        window.open(
          hitHref(projectId ?? 0, hit, debouncedQuery),
          "_blank",
          "noopener,noreferrer",
        );
      } else if (e.key === "Escape") {
        // 検索ワードをリセットし、結果一覧を閉じる。query を空にすると debouncedQuery も空になり
        // isSearchMode=false → SearchResults 非表示 + このハンドラ自身も解除される。
        // 選択状態も戻し、フォーカスは検索ボックスに残す（次の入力をすぐ始められるように）。
        e.preventDefault();
        setQuery("");
        setInResults(false);
        setSelectedIndex(0);
        searchBoxRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    isSearchMode,
    inResults,
    filteredHits,
    selectedIndex,
    debouncedQuery,
    projectId,
    moveCategory,
  ]);

  if (projectId === null) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-[1536px] flex-col gap-6 px-6 py-10">
        <p className="text-sm text-zinc-400">読み込み中…</p>
      </main>
    );
  }

  // Wiki カテゴリのときだけ右サイドバー（ページ一覧ツリー）。詳細表示なら現在 Wiki を伝える。
  const showWikiSidebar = category === "wiki";
  const currentWikiId =
    view.category === "wiki" && view.mode === "detail"
      ? view.wikiId
      : undefined;

  return (
    <main className="mx-auto flex min-h-full w-full max-w-[1536px] flex-col gap-5 px-6 py-10">
      {/* タイトル行: 左にプロジェクトアイコン（プロジェクトトップへのリンク）+ プロジェクト名。
          右に「プロジェクト一覧」への導線（backlog-x ロゴは置かない＝プロジェクトアイコンと
          並ぶと紛らわしいため）。 */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {project && (
            <Link
              href={`/projects/${project.projectId}`}
              aria-label={`${project.name} のトップへ`}
              title={`${project.name} のトップへ`}
              className="shrink-0 rounded-lg transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              <ProjectIcon
                projectId={project.projectId}
                projectKey={project.projectKey}
                size={36}
                className="block"
              />
            </Link>
          )}
          <h1 className="flex min-w-0 items-baseline gap-1 text-2xl font-semibold tracking-tight">
            <span className="truncate">
              {project ? project.name : project === null ? "プロジェクト" : "…"}
            </span>
            {project && (
              <>
                <span className="font-normal text-zinc-300 dark:text-zinc-600">
                  ｜
                </span>
                <span className="font-mono text-zinc-400">
                  {project.projectKey}
                </span>
              </>
            )}
          </h1>
        </div>

        {/* プロジェクト一覧への導線（右寄せ） */}
        <Link
          href="/"
          title="プロジェクト一覧へ"
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <LayoutGrid size={16} className="shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">プロジェクト一覧</span>
        </Link>
      </div>

      {project === null ? (
        <p className="text-sm text-zinc-500">
          このプロジェクトのデータが見つかりません。
          <Link href="/setup" className="ml-1 underline">
            取り込み
          </Link>
          を行ってください。
        </p>
      ) : (
        <>
          {/* 検索フォーム（全カテゴリ共通・常駐）。キーボードナビはページ全体の
              グローバルハンドラ（下記 useEffect）が担うので、ここは入力 UI に徹する。 */}
          <SearchBox ref={searchBoxRef} value={query} onChange={setQuery} />

          {/* コンテンツカテゴリ。どの種類があるかを必ず見せるため、件数 0 でも全タブを常時表示する。
              Wiki/ドキュメントは件数（0 含む）を併記、課題は件数を一覧側で出すので併記しない。 */}
          <nav className="flex items-center gap-1 text-sm">
            {CATEGORIES.map((c) => {
              const count =
                c.key === "wiki"
                  ? (project?.wikiCount ?? 0)
                  : c.key === "document"
                    ? (project?.documentCount ?? 0)
                    : null;
              const active = c.key === category;
              return (
                <Link
                  key={c.key}
                  href={c.href(projectId)}
                  className={
                    active
                      ? "rounded-full bg-sky-600 px-3 py-1 font-medium text-white"
                      : "rounded-full px-3 py-1 text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }
                >
                  {c.label}
                  {count != null && (
                    <span
                      className={
                        active ? "ml-1 text-sky-100" : "ml-1 text-zinc-400"
                      }
                    >
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* コンテンツエリア（＋ Wiki 時のみ右サイドバー） */}
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              {isSearchMode ? (
                <div className="flex flex-col gap-3">
                  {category === "issue" && (
                    <label className="flex w-fit items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={issueOnly}
                        onChange={(e) => setIssueOnly(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-zinc-300 text-sky-600 focus:ring-sky-600 dark:border-zinc-600"
                      />
                      課題のみ表示
                    </label>
                  )}
                  <SearchResults
                    ref={searchResultsRef}
                    projectId={projectId}
                    hits={filteredHits}
                    loading={searching}
                    query={debouncedQuery}
                    selectedIndex={selectedIndex}
                    active={inResults}
                    onSelect={(i) => {
                      // マウスで行にフォーカス/ホバー選択したら、結果に入った状態にする。
                      setSelectedIndex(i);
                      setInResults(true);
                    }}
                  />
                </div>
              ) : (
                <ContentView
                  projectId={projectId}
                  view={view}
                  options={options}
                  statusPreset={statusPreset}
                  onStatusPreset={setStatusPreset}
                  filter={filter}
                  onFilter={setFilter}
                  sort={sort}
                  order={order}
                  onSort={(s, o) => {
                    setSort(s);
                    setOrder(o);
                  }}
                  effectiveFilter={effectiveFilter}
                />
              )}
            </div>
            {showWikiSidebar && (
              <WikiSidebar
                projectId={projectId}
                currentWikiId={currentWikiId}
              />
            )}
          </div>
        </>
      )}
    </main>
  );
}

/** URL 解決結果（view）に応じてコンテンツエリアの中身を描画する。 */
function ContentView({
  projectId,
  view,
  options,
  statusPreset,
  onStatusPreset,
  filter,
  onFilter,
  sort,
  order,
  onSort,
  effectiveFilter,
}: {
  projectId: number;
  view: ReturnType<typeof useWorkspace>["view"];
  options: FilterOptions | null;
  statusPreset: StatusPreset;
  onStatusPreset: (p: StatusPreset) => void;
  filter: IssueFilter;
  onFilter: (f: IssueFilter) => void;
  sort: IssueSort;
  order: SortOrder;
  onSort: (s: IssueSort, o: SortOrder) => void;
  effectiveFilter: IssueFilter;
}) {
  if (view.category === "issue") {
    if (view.mode === "detail") {
      // key で ID 変更時に再マウント（詳細ビューが初期 state=読み込み中から始まる）
      return (
        <IssueDetailView
          key={view.keyId}
          projectId={projectId}
          keyId={view.keyId}
        />
      );
    }
    return (
      <div className="flex flex-col gap-6">
        <IssueFilterBar
          options={options}
          statusPreset={statusPreset}
          onStatusPreset={onStatusPreset}
          filter={filter}
          onFilter={onFilter}
          sort={sort}
          order={order}
          onSort={onSort}
        />
        <IssueList
          projectId={projectId}
          filter={effectiveFilter}
          sort={sort}
          order={order}
        />
      </div>
    );
  }
  if (view.category === "wiki") {
    if (view.mode === "detail") {
      return (
        <WikiDetailView
          key={view.wikiId}
          projectId={projectId}
          wikiId={view.wikiId}
        />
      );
    }
    if (view.mode === "list") {
      return <WikiListView projectId={projectId} />;
    }
    // home（既定）: Home ページを表示（無ければ WikiHomeView 内で一覧にフォールバック）
    return <WikiHomeView projectId={projectId} />;
  }
  // document
  if (view.mode === "detail") {
    return (
      <DocumentDetailView
        key={view.documentId}
        projectId={projectId}
        documentId={view.documentId}
      />
    );
  }
  return <DocumentListView projectId={projectId} />;
}
