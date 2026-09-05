"use client";

import { useEffect } from "react";

/**
 * コンテナ内で selector に一致する要素を探し、見つかったら中央へスクロールする。
 * 見つからなければ数フレーム分リトライする（対象は非同期取得・再レンダリング後に現れるため）。
 *
 * requestAnimationFrame は「バックグラウンドタブでは発火しない」ため使わず setTimeout を使う
 * （検索結果を別タブで開く運用では、開いた直後に元タブへ戻るとバックグラウンド化しやすい）。
 *
 * スクロールは必ず behavior:'instant'（＝瞬間移動）で行う。behavior:'smooth' の
 * アニメーションはバックグラウンドタブ（document.visibilityState==='hidden'）では Chrome が
 * フレーム更新を止めてしまい 1px も動かない。検索結果を別タブで開く運用ではまさにその
 * hidden 状態で開かれるため、smooth だと「スクロールしない」不具合になる（実測で確認済み）。
 * instant なら hidden でも一発で確実に中央へ寄る。
 *
 * 見つけた直後に一度寄せたあと、コメントの遅延描画・画像ロードでページ高さが伸びて位置が
 * ずれる場合に備え、短い間隔で数回 instant を再発行して最終位置へ追随する（ずれていなければ
 * 実質何も動かない）。
 * 戻り値は「予約したタイマーを全て止めるキャンセル関数」。呼び出し側の effect クリーンアップで使う。
 */
export function scrollToSelectorWithRetry(
  getContainer: () => HTMLElement | null,
  selector: string,
  onFound?: (el: Element) => void,
  maxTries = 15,
  intervalMs = 60,
): () => void {
  let tries = 0;
  const timers = new Set<number>();
  const schedule = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  // ブラウザは同一 URL のリロードで以前のスクロール位置を復元する（history.scrollRestoration='auto'）。
  // これが我々のスクロールと競合しないよう、案内する間は手動制御にする。
  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }

  // 要素が最終的な中央位置に来るまで数回追随する。初回描画後もページ高さが伸び得るため。
  const centerOnce = (el: Element) =>
    el.scrollIntoView({ behavior: "instant", block: "center" });
  const followUp = (el: Element, remaining: number) => {
    centerOnce(el);
    if (remaining > 0) schedule(() => followUp(el, remaining - 1), 80);
  };

  const attempt = () => {
    const target = getContainer()?.querySelector(selector);
    if (target) {
      onFound?.(target);
      followUp(target, 4);
      return;
    }
    if (tries++ < maxTries) schedule(attempt, intervalMs);
  };
  schedule(attempt, 0);

  return () => {
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
  };
}

/**
 * ハイライト済みの最初の一致（rehypeHighlightTerm が付ける data-highlight-first 要素）まで
 * スクロールする。
 *
 * ハイライト自体は react-markdown の rehype プラグインが AST 段階で <mark> を差し込むので
 * （DOM を後処理しないため再レンダリングで消えない）、この hook は「描画後に最初のマークへ
 * スクロールする」だけを担う。DOM は読むだけで書き換えないので react と衝突しない。
 *
 * 重要: <mark> は「highlightTerm が state に入って再レンダリングされた後」に初めて DOM に現れる。
 * そのため依存に highlightTerm を含め、term が入った後の描画完了を待ってからスクロールする。
 * term が空のまま（初回レンダリング）や enabled=false（コメント本文など）のときは何もしない。
 */
export function useScrollToFirstHighlight(
  containerRef: React.RefObject<HTMLElement | null>,
  /** ハイライト対象か。false のときは何もしない */
  enabled: boolean,
  /** state に入った検索語。空→非空に変わったタイミングでスクロールを走らせる */
  highlightTerm: string,
): void {
  useEffect(() => {
    if (!enabled) return;
    if (highlightTerm.trim() === "") return;
    return scrollToSelectorWithRetry(
      () => containerRef.current,
      "[data-highlight-first]",
    );
  }, [containerRef, enabled, highlightTerm]);
}
