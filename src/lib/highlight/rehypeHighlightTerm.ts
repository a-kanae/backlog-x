import type { Root, RootContent, Element, ElementContent } from "hast";
import type { Plugin } from "unified";

/**
 * react-markdown（rehype）のレンダリング段階で、本文中の検索語を <mark> に変換するプラグイン。
 *
 * 検索結果から詳細（課題・Wiki・ドキュメント）を開いたとき、どこがヒットしたかを見せるための
 * ハイライト。DOM を後処理で書き換えると react-markdown の再レンダリングで消えてしまうため、
 * rehype の AST（hast）段階でテキストノードを分割し <mark> 要素を差し込む（＝ react が管理する
 * 正規の要素になるので消えない）。
 *
 * - 大文字小文字を区別しない部分一致（日本語もそのまま部分一致で機能する）。
 * - 既存の <code>/<pre> 内はハイライトしない（コード中の文字列を光らせても嬉しくないため）。
 * - 最初の一致には data-highlight-first 属性を付け、呼び出し側がスクロール先を特定できるようにする。
 *
 * これは unified の「Plugin（attacher）」。unified は配列/タプルの要素を attacher とみなし、
 * freeze 時に `attacher.call(self, ...options)` で一度呼んで、その戻り値（Transformer）を
 * `transformers.use(...)` に登録する（node_modules/unified/lib/index.js:636-639）。
 * したがってこの関数は「term を第1引数に取り、Transformer `(tree) => void` を返す」形にし、
 * 呼び出し側は `[[rehypeHighlightTerm, term]]` のタプルで渡すこと（呼び出し済みの戻り値を
 * 配列に直接入れると、unified が Transformer を attacher と誤認し tree===undefined で実行され、
 * transformer が一切登録されず <mark> が出ない）。
 *
 * term が空なら何もしない Transformer を返す。
 */
export const rehypeHighlightTerm: Plugin<[string], Root> = (term: string) => {
  const needle = term.trim().toLowerCase();

  return (tree: Root) => {
    if (needle === "") return;
    const state = { firstMarked: false };
    // Root / Element どちらも children を持つので、その配列を term 分割済みの配列に置き換える。
    tree.children = processChildren(tree.children, false, needle, term, state);
  };
};

/** children 配列を走査し、text ノードは <mark> 分割、element は再帰する。 */
function processChildren<T extends RootContent | ElementContent>(
  children: T[],
  insideCode: boolean,
  needle: string,
  original: string,
  state: { firstMarked: boolean },
): T[] {
  if (!Array.isArray(children)) return children;
  const out: T[] = [];
  for (const child of children) {
    if (child.type === "text" && !insideCode) {
      // text ノードは Root/Element どちらの children にも入れられるので T として安全。
      out.push(...(splitText(child.value, needle, original, state) as T[]));
    } else {
      if (child.type === "element" && Array.isArray(child.children)) {
        const isCode = child.tagName === "code" || child.tagName === "pre";
        child.children = processChildren(
          child.children,
          insideCode || isCode,
          needle,
          original,
          state,
        );
      }
      out.push(child);
    }
  }
  return out;
}

/**
 * テキスト値を term 一致箇所で分割し、[text, <mark>, text, ...] の hast ノード配列にする。
 * 最初の一致にだけ data-highlight-first を付ける（スクロール先の特定用）。
 */
function splitText(
  text: string,
  needle: string,
  original: string,
  state: { firstMarked: boolean },
): ElementContent[] {
  const lower = text.toLowerCase();
  if (!lower.includes(needle)) return [{ type: "text", value: text }];

  const out: ElementContent[] = [];
  let cursor = 0;
  let idx = lower.indexOf(needle, cursor);
  while (idx !== -1) {
    if (idx > cursor) {
      out.push({ type: "text", value: text.slice(cursor, idx) });
    }
    const isFirst = !state.firstMarked;
    state.firstMarked = true;
    const mark: Element = {
      type: "element",
      tagName: "mark",
      properties: {
        className: ["rounded", "bg-yellow-200", "dark:bg-yellow-500/40"],
        ...(isFirst ? { "data-highlight-first": "true" } : {}),
      },
      children: [
        { type: "text", value: text.slice(idx, idx + original.length) },
      ],
    };
    out.push(mark);
    cursor = idx + original.length;
    idx = lower.indexOf(needle, cursor);
  }
  if (cursor < text.length) {
    out.push({ type: "text", value: text.slice(cursor) });
  }
  return out;
}
