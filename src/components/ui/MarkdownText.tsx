"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { rehypeHighlightTerm } from "@/lib/highlight/rehypeHighlightTerm";
import { readHighlightTerm } from "@/lib/routing/params";
import { useScrollToFirstHighlight } from "@/lib/highlight/useHighlightInContainer";

/**
 * 標準 Markdown 記法の本文を描画する。
 *
 * Backlog の新しいドキュメント機能の本文（`plain`）は標準 Markdown（ATX 見出し・GFM の
 * テーブル/取り消し線・インラインコード等）なので、Backlog 記法変換（BacklogText）は通さず
 * そのまま react-markdown + remark-gfm で描画する。react-markdown は生 HTML を無効化
 * （デフォルト）するため dangerouslySetInnerHTML 不要・XSS 安全。
 *
 * 見出し・リスト・コード・テーブル等のスタイルは Wiki（BacklogText）と揃えている。
 * ドキュメントには課題内部リンク・メンションの独自スキームが無いため、リンクは通常の
 * 外部リンク（別タブ）として扱う。
 */
export function MarkdownText({
  text,
  highlight = false,
}: {
  text: string;
  highlight?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // highlight のときだけ URL ハッシュ #q= の語を rehype プラグインでハイライトする。
  // 検索語はマウント後に読む（ハイドレーション初回は window が無く空になり得るため）。
  const [highlightTerm, setHighlightTerm] = useState("");
  useEffect(() => {
    if (!highlight) return;
    // 非同期境界（setTimeout）の中で読み、effect 直下の同期 setState を避ける。
    // rAF はバックグラウンドタブで発火しないため setTimeout を使う。
    const id = window.setTimeout(
      () => setHighlightTerm(readHighlightTerm()),
      0,
    );
    return () => window.clearTimeout(id);
  }, [highlight]);
  // unified の Plugin(attacher) はタプル [plugin, ...params] で渡す。呼び出し済みの
  // 戻り値（Transformer）を配列に直接入れると unified が attacher と誤認して tree===undefined
  // で実行され、<mark> が出ない（unified/lib/index.js:636-639）。
  const rehypePlugins = useMemo<PluggableList>(
    () =>
      highlightTerm.trim() === "" ? [] : [[rehypeHighlightTerm, highlightTerm]],
    [highlightTerm],
  );
  useScrollToFirstHighlight(containerRef, highlight, highlightTerm);

  if (!text || text.trim() === "") return null;

  const components: Components = {
    a: ({ href, children }) => (
      <a
        href={href ?? ""}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sky-600 underline hover:text-sky-700 dark:text-sky-400"
      >
        {children}
      </a>
    ),
    h1: ({ children }) => (
      <h1 className="mt-5 mb-4 border-b border-zinc-200 pb-1 text-lg font-bold dark:border-zinc-700">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-5 mb-4 border-b border-zinc-200 pb-1 text-base font-bold dark:border-zinc-700">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-4 mb-1 text-sm font-bold">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="mt-4 mb-1 text-sm font-semibold">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="mt-4 mb-1 text-sm font-semibold">{children}</h5>
    ),
    h6: ({ children }) => (
      <h6 className="mt-4 mb-1 text-sm font-semibold">{children}</h6>
    ),
    p: ({ children }) => <p className="my-1.5">{children}</p>,
    ul: ({ children }) => <ul className="my-1.5 list-disc pl-5">{children}</ul>,
    ol: ({ children }) => (
      <ol className="my-1.5 list-decimal pl-5">{children}</ol>
    ),
    li: ({ children }) => <li className="my-0.5">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-zinc-300 pl-3 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
        {children}
      </blockquote>
    ),
    code: ({ className, children }) => {
      const isBlock =
        String(className ?? "").includes("language-") ||
        String(children).includes("\n");
      if (isBlock) {
        return (
          <code className="block overflow-x-auto rounded bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-800">
            {children}
          </code>
        );
      }
      return (
        <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs dark:bg-zinc-800">
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre className="my-2 overflow-x-auto">{children}</pre>
    ),
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto">
        <table className="border-collapse text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-zinc-300 bg-zinc-100 px-2 py-1 text-left font-semibold dark:border-zinc-600 dark:bg-zinc-800">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-zinc-300 px-2 py-1 dark:border-zinc-600">
        {children}
      </td>
    ),
    strong: ({ children }) => <strong className="font-bold">{children}</strong>,
    del: ({ children }) => (
      <del className="text-zinc-400 line-through">{children}</del>
    ),
    hr: () => <hr className="my-3 border-zinc-200 dark:border-zinc-700" />,
  };

  // 安全なスキームだけ通す（javascript: 等は空にして XSS 防止）。
  const urlTransform = (url: string): string => {
    if (
      /^(https?:|mailto:|tel:)/i.test(url) ||
      url.startsWith("#") ||
      url.startsWith("/")
    ) {
      return url;
    }
    return "";
  };

  return (
    <div
      ref={containerRef}
      className="text-sm leading-relaxed break-words text-zinc-700 dark:text-zinc-300"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={rehypePlugins}
        urlTransform={urlTransform}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
