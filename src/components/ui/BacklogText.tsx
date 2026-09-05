"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { AttachmentMeta, StoredUser } from "@/types/entities";
import { rehypeHighlightTerm } from "@/lib/highlight/rehypeHighlightTerm";
import { readHighlightTerm } from "@/lib/routing/params";
import { useScrollToFirstHighlight } from "@/lib/highlight/useHighlightInContainer";
import {
  backlogToMarkdown,
  INTERNAL_ATTACHMENT_SCHEME,
  INTERNAL_ISSUE_SCHEME,
  INTERNAL_MENTION_SCHEME,
} from "@/lib/backlog-notation/toMarkdown";
import { MentionChip } from "./MentionChip";
import { EmbeddedImage } from "./EmbeddedImage";

/**
 * Backlog 記法（旧）の本文を描画する。
 *
 * Backlog 記法 → Markdown に変換し、react-markdown + remark-gfm で描画する。
 * react-markdown は生 HTML を無効化（デフォルト）するため dangerouslySetInnerHTML 不要・XSS 安全。
 * 課題内部リンク（bx-issue:keyId）は Next の Link に、メンション（bx-mention:名前）は MentionChip に、
 * 埋め込み画像（bx-attachment:添付ファイル名）は OPFS のバイナリを objectURL にした img に、
 * 外部リンクは別タブに差し替える。
 *
 * 将来 Markdown 記法のプロジェクトに対応する際は、変換を通さず raw をそのまま渡せばよい
 * （textFormattingRule で分岐）。
 */
export function BacklogText({
  text,
  projectId,
  projectKey,
  users = [],
  attachments = [],
  highlight = false,
}: {
  text: string;
  projectId: number;
  projectKey?: string;
  /** メンション @ユーザー名 の照合・アイコン解決に使う取り込み済みユーザー */
  users?: StoredUser[];
  /** 本文中の #image(name) を解決するための添付メタ（その課題のもの） */
  attachments?: AttachmentMeta[];
  /** 検索結果から開いたとき、URL ハッシュ #q= の語を本文中でハイライトするか */
  highlight?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // highlight のときだけ URL ハッシュ #q= の語を rehype プラグインでハイライトする
  // （コメント本文などは false で無効）。プラグインは AST 段階で <mark> を差し込むので
  // 再レンダリングでも消えない。描画後に最初の一致へスクロールするのは hook が担う。
  //
  // 検索語はマウント後に読む（static export のハイドレーション初回は window が無く
  // readHighlightTerm() が空になり得るため、レンダリング中でなく effect で読んで再描画させる）。
  const [highlightTerm, setHighlightTerm] = useState("");
  useEffect(() => {
    if (!highlight) return;
    // 非同期境界（setTimeout）の中で読むことで、ハイドレーション後の実 URL から確実に読みつつ
    // effect 直下の同期 setState（set-state-in-effect）を避ける。requestAnimationFrame は
    // バックグラウンドタブで発火しないため setTimeout を使う。
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

  const mentionNames = users.map((u) => u.name);
  const userByName = new Map(users.map((u) => [u.name, u]));
  const markdown = backlogToMarkdown(text, { projectKey, mentionNames });

  const components: Components = {
    // 埋め込み画像（bx-attachment:添付ファイル名）→ OPFS のバイナリを objectURL で表示。
    // 本体が無ければ EmbeddedImage 側で従来のプレースホルダに落ちる。
    img({ src, alt }) {
      const url = typeof src === "string" ? src : "";
      if (url.startsWith(`${INTERNAL_ATTACHMENT_SCHEME}:`)) {
        const name = decodeURIComponent(
          url.slice(INTERNAL_ATTACHMENT_SCHEME.length + 1),
        );
        return (
          <EmbeddedImage
            projectId={projectId}
            name={name}
            attachments={attachments}
          />
        );
      }
      if (url === "") return null;
      // Backlog 記法から出てくる画像は #image だけなので通常ここには来ないが、
      // 将来 Markdown 記法プロジェクトを通したときのために素の img も描いておく。
      // ⚠️ `loading="lazy"` は付けない: 幅・高さが事前に分からない本文画像だと高さが潰れ、
      // Chrome の遅延読み込みが発火しないまま高さも増えないデッドロックになる（別プロジェクトの
      // Markdown 描画で実測・2026-08-25）。
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt ?? ""}
          className="my-2 max-h-[30rem] max-w-full rounded-lg border border-zinc-200 dark:border-zinc-700/60"
        />
      );
    },
    a({ href, children }) {
      const url = href ?? "";
      // メンション（bx-mention:名前）→ MentionChip
      if (url.startsWith(`${INTERNAL_MENTION_SCHEME}:`)) {
        const name = decodeURIComponent(
          url.slice(INTERNAL_MENTION_SCHEME.length + 1),
        );
        return <MentionChip name={name} user={userByName.get(name) ?? null} />;
      }
      // 課題内部リンク（bx-issue:keyId）→ アプリ内遷移
      if (url.startsWith(`${INTERNAL_ISSUE_SCHEME}:`)) {
        const keyId = url.slice(INTERNAL_ISSUE_SCHEME.length + 1);
        return (
          <Link
            href={`/projects/${projectId}/issues/${keyId}`}
            className="text-sky-600 underline hover:text-sky-700 dark:text-sky-400"
          >
            {children}
          </Link>
        );
      }
      // 外部リンクは別タブ・noopener
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-600 underline hover:text-sky-700 dark:text-sky-400"
        >
          {children}
        </a>
      );
    },
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
      // フェンス（ブロック）は className に language-* が付く場合があるが、ここではインライン/ブロック共通で扱う
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

  // react-markdown は既定で未知スキームの URL を空にサニタイズする（bx-issue:/bx-mention: が消える）。
  // 独自スキームと安全なスキーム（http/https/mailto）だけ通し、javascript: 等は空にする（XSS 防止）。
  const urlTransform = (url: string): string => {
    if (
      url.startsWith(`${INTERNAL_ISSUE_SCHEME}:`) ||
      url.startsWith(`${INTERNAL_MENTION_SCHEME}:`) ||
      url.startsWith(`${INTERNAL_ATTACHMENT_SCHEME}:`) ||
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
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
