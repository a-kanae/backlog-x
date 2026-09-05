"use client";

/**
 * 統一ワークスペースの初回描画をハイドレーション後まで遅らせるゲート。
 *
 * ## なぜ必要か
 *
 * static export では動的ルートの静的シェルを 1 枚だけ生成するため、ビルド時の pathname は
 * プレースホルダ（`/projects/_/issues/_` 等）になる。ProjectWorkspace は実 URL を
 * `usePathname` からパースしてビューを決める（`resolveWorkspace`）が、プレースホルダの
 * `_` は ID として解釈できず null に倒れるため、**ビルド時とクライアントで別のビューが
 * 解決される**:
 *
 * - ビルド時 `/projects/_/issues/_` → keyId が null → 課題一覧
 * - クライアント `/projects/123/issues/456` → keyId=456 → 課題詳細
 *
 * その結果まったく別の DOM ツリーになり、React がハイドレーション不一致
 * （error #418）を報告してツリーを丸ごと再生成していた。表示自体は最終的に正しくなるが、
 * コンソールにエラーが残り、初回描画がやり直しになる。
 *
 * ## 解決
 *
 * マウント前は必ず同じプレースホルダを描画してサーバー HTML と一致させ、マウント後に
 * 実 URL で解決する。ProjectWorkspace 側は一切変更しない（多数の hook を持ち、条件付き
 * early return を入れると hooks のルールに触れるため）。
 *
 * マウント判定には `useSyncExternalStore` を使う。`useEffect` で `setState` する定石は
 * React 19 の `react-hooks/set-state-in-effect` に触れるうえ、この API は
 * **サーバーとクライアントで異なるスナップショットを返す**ことがまさに用途なので素直に書ける
 * （`getServerSnapshot` はビルド時とハイドレーション中に使われ、その後 `getSnapshot` に
 * 切り替わる）。
 *
 * このゲート自身は初回に一度だけ false → true になるので、以降の遷移では ProjectWorkspace は
 * 再マウントされない。検索ワード・選択カテゴリ・Wiki ツリーの展開状態が遷移をまたいで
 * 保持される既存の設計はそのまま保たれる。
 */

import { useSyncExternalStore } from "react";
import { ProjectWorkspace } from "./ProjectWorkspace";

/** 値が変化しないので購読は何もしない（解除関数だけ返す）。 */
const subscribe = () => () => {};

export function ProjectWorkspaceGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true, // クライアント（ハイドレーション後）
    () => false, // ビルド時 / ハイドレーション中
  );

  if (!mounted) {
    return <p className="text-sm text-zinc-400">読み込み中…</p>;
  }

  return <ProjectWorkspace>{children}</ProjectWorkspace>;
}
