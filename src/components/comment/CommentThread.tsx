"use client";

import { useEffect, useRef, useState } from "react";
import { useDataSource } from "@/lib/datasource/context";
import type {
  AttachmentMeta,
  StoredComment,
  StoredUser,
} from "@/types/entities";
import { parseDetailHash } from "@/lib/routing/params";
import { scrollToSelectorWithRetry } from "@/lib/highlight/useHighlightInContainer";
import { CommentItem } from "./CommentItem";

/**
 * 課題のコメントスレッド。created 昇順（DataSource 側でソート済み）で表示する。
 * 本文も意味のある変更ログも無い「通知のみ」コメントは表示しない（ノイズ除去）。
 */

/** 一度に描画するコメント件数（初期表示・スクロール時の増分）。
 * コメントは課題行より背が高く画像・Markdown を含むため、課題一覧（50）より小さめにする。 */
const PAGE_SIZE = 30;

/**
 * 表示する価値のあるコメントか。
 * 本文あり / 通知以外の変更ログあり / 通知のみ（= 課題作成の「お知らせ」）のいずれか。
 * お知らせも表示することで原本（Backlog）とコメント数を一致させる。
 */
function isMeaningful(comment: StoredComment): boolean {
  const hasContent = comment.content != null && comment.content.trim() !== "";
  const hasChange = comment.changeLog.some((c) => !c.notificationOnly);
  const hasNotification = comment.changeLog.some((c) => c.notificationOnly);
  return hasContent || hasChange || hasNotification;
}

/**
 * ジャンプ対象（URL ハッシュ #comment-<id>）を描画するのに必要な件数。
 * 対象が無ければ 0。対象が後ろにあれば、その対象を含む（PAGE_SIZE 単位で切り上げた）件数。
 * 対象が未描画だとスクロール先が DOM に無くジャンプが空振りするため、初期描画と、
 * 表示中にハッシュが変わったときの両方で、これ以上に描画件数を引き上げる。
 */
function countToShow(
  visible: StoredComment[],
  targetId: number | null,
): number {
  if (targetId == null) return 0;
  const idx = visible.findIndex((c) => c.id === targetId);
  if (idx < 0) return 0;
  return Math.ceil((idx + 1) / PAGE_SIZE) * PAGE_SIZE;
}

export function CommentThread({
  projectId,
  issueId,
  projectKey,
  spaceUrl,
  users = [],
  attachments = [],
}: {
  projectId: number;
  issueId: number;
  projectKey?: string;
  /** スペース URL。コメント本文中の課題 URL を手元の課題へのリンクにする（BacklogText に渡す） */
  spaceUrl?: string;
  users?: StoredUser[];
  /**
   * この課題の添付メタ。コメント本文の #image(name) を解決するために渡す
   * （Backlog はコメントに添付した画像も課題の添付一覧に載せるので、課題単位で足りる）。
   */
  attachments?: AttachmentMeta[];
}) {
  const ds = useDataSource();
  const [comments, setComments] = useState<StoredComment[] | null>(null);
  // ジャンプ対象のコメント ID（URL ハッシュ #comment-<id>）。マウント時に読み、以後は hashchange で
  // 追従する。同じ課題の本文・コメントの中にあるコメントへのリンク（BacklogText）は、Next の Link
  // に任せず navigateToHash（pushState ＋ hashchange を自分で投げる）で開くので、ここで拾える。
  const [targetId, setTargetId] = useState<number | null>(
    () => parseDetailHash().commentId,
  );
  useEffect(() => {
    const onHashChange = () => setTargetId(parseDetailHash().commentId);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  // 強調しているコメント ID（ジャンプが済んだもの）。別のコメントへ移ると置き換わり、前の枠は消える
  const [highlightId, setHighlightId] = useState<number | null>(null);
  // 段階描画で「今表示している件数」。コメントが多い課題（791 件など）で全件を一度に
  // DOM へ出すと重いため、visible の先頭 visibleCount 件だけ描画し sentinel で増やす。
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    let cancelled = false;
    ds.listComments(projectId, issueId).then((list) => {
      if (!cancelled) setComments(list);
    });
    return () => {
      cancelled = true;
    };
  }, [ds, projectId, issueId]);

  const visible = comments === null ? [] : comments.filter(isMeaningful);

  // 描画件数の調整（レンダー中に setState する公式パターン。同期エフェクト内 setState
  // （set-state-in-effect）を避ける。IssueList と同じ流儀）。
  // - コメントが読み込まれた（＝別の課題に差し替わった）瞬間: PAGE_SIZE に初期化
  // - ジャンプ対象（targetId）が変わった瞬間（hashchange）: 今の件数を基準にする
  // どちらも、対象が基準より後ろにあればその対象を含むところまで引き上げる（未描画だと
  // スクロール先が DOM に無く scrollToSelectorWithRetry が空振りするため）。
  // 読み進めで増えた分は、対象が変わっても減らさない。
  const [rendered, setRendered] = useState<{
    comments: StoredComment[] | null;
    targetId: number | null;
  }>({ comments: null, targetId });
  if (
    comments !== null &&
    (rendered.comments !== comments || rendered.targetId !== targetId)
  ) {
    const base = rendered.comments !== comments ? PAGE_SIZE : visibleCount;
    setRendered({ comments, targetId });
    const next = Math.max(base, countToShow(visible, targetId));
    if (next !== visibleCount) setVisibleCount(next);
    // ハッシュが外れたら（対象が無くなったら）強調も消す
    if (targetId == null && highlightId != null) setHighlightId(null);
  }

  // URL ハッシュ #comment-<id> の対象コメントへスクロール + 枠ハイライト（検索結果からの遷移）。
  // 枠ハイライトは消さずに残す（どれがヒットしたコメントか常に分かるように）。
  // 検索結果を別タブで開く運用ではタブがバックグラウンド化しやすく rAF が発火しないため、
  // setTimeout ベースの共通ヘルパ（scrollToSelectorWithRetry）でリトライしつつスクロールする。
  // 非同期境界（setTimeout）の中で setState するので set-state-in-effect には当たらない。
  //
  // 依存に visibleCount を含める: 対象が countToShow で初期描画に含まれていても、
  // 段階描画のリセット（レンダー中 setVisibleCount）と effect 実行の順序次第で、effect が
  // 走った時点でまだ対象が DOM に無いことがある（実測でハイライトが付かない症状を確認）。
  // visibleCount の変化でも再評価すれば、対象が描画され次第フックできる。ただし読み進めで
  // visibleCount が増えるたびに再スクロールして対象位置へ引き戻すのは困るので、今の対象を
  // ハイライト済みなら（highlightId === targetId）発火しないようガードする。
  // 対象が変わると（hashchange）ガードが外れて新しい対象へジャンプし、highlightId が
  // 置き換わるので前の枠は消える。
  useEffect(() => {
    if (comments === null) return;
    if (targetId == null) return;
    if (highlightId === targetId) return; // 今の対象へはジャンプ済み
    return scrollToSelectorWithRetry(
      () => document.body,
      `#comment-${targetId}`,
      () => setHighlightId(targetId),
    );
  }, [comments, visibleCount, highlightId, targetId]);

  // 「もっと読む」sentinel。残りがある間だけ DOM に置き、near になったら PAGE_SIZE ずつ増やす。
  // ユーザーが下へ読み進め、sentinel（描画済みコメントの末尾）が画面下端 + 余白に入ったら
  // 次の 30 件を描画する標準的な無限スクロール。
  //
  // 検知は IntersectionObserver + scroll/resize イベントの併用。単体ではどちらも穴がある:
  // - observer 単体: 「交差状態が変化した瞬間」しか発火しない。コメントは 1 件が背高で、初期
  //   30 件でも sentinel が最初から画面内に見えると、初回報告後は可視のまま留まり再発火せず
  //   止まる（実測）。
  // - scroll 単体: 30 件描画で既にページ最下部（これ以上スクロールできない位置）に sentinel が
  //   見えていると、scrollBy しても scroll イベントが発火せず詰まる（実測。最終ページで起きる）。
  // 併用すると、observer が「初回可視・交差変化」を、scroll が「読み進め中の追従」を担い互いの
  // 穴を埋める。どちらの起点でも共通の maybeLoadMore を呼ぶ。increment 後に再レンダーで effect が
  // 貼り直され（visibleCount を依存に含む）初回チェックが走るので、near が続く限り継ぎ足せる。
  // setState は observer/scroll/resize という外部イベント起点でのみ呼ぶので set-state-in-effect
  // には当たらない。
  const hasMore = visible.length > visibleCount;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const maybeLoadMore = () => {
      const r = el.getBoundingClientRect();
      if (r.top <= window.innerHeight + 600) {
        setVisibleCount((prev) =>
          prev < visible.length ? prev + PAGE_SIZE : prev,
        );
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) maybeLoadMore();
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    window.addEventListener("scroll", maybeLoadMore, { passive: true });
    window.addEventListener("resize", maybeLoadMore, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", maybeLoadMore);
      window.removeEventListener("resize", maybeLoadMore);
    };
    // hasMore / visibleCount の変化で貼り直し（sentinel の出現・移動に追従）。visible.length は
    // maybeLoadMore のクロージャが最新の総数を参照できるよう依存に含める。
  }, [hasMore, visible.length, visibleCount]);

  if (comments === null) {
    return (
      <div className="py-4 text-sm text-zinc-400">コメントを読み込み中…</div>
    );
  }

  const shown = visible.slice(0, visibleCount);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-zinc-500">
        コメント（{visible.length}）
      </h2>
      {visible.length === 0 ? (
        <p className="py-2 text-sm text-zinc-400">コメントはありません。</p>
      ) : (
        <div className="flex flex-col">
          {shown.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              highlighted={c.id === highlightId}
              projectId={projectId}
              projectKey={projectKey}
              spaceUrl={spaceUrl}
              users={users}
              attachments={attachments}
            />
          ))}
        </div>
      )}

      {/* 無限スクロールの監視点。まだ残りがある間だけ置く */}
      {hasMore && (
        <div
          ref={sentinelRef}
          className="py-4 text-center text-xs text-zinc-400"
        >
          スクロールで続きを読み込み（残り
          {(visible.length - visibleCount).toLocaleString()} 件）
        </div>
      )}
    </section>
  );
}
