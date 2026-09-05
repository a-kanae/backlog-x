/**
 * Backlog 記法（旧）→ Markdown(GFM) 変換。
 *
 * Backlog 記法専用の JS パーサは存在しないため、描画は react-markdown + remark-gfm に任せ、
 * ここでは「Backlog 記法 → Markdown」のテキスト変換だけを行う（描画ロジックを自前で持たない）。
 * Markdown 記法のプロジェクトはこの変換を通さず、そのまま react-markdown に渡せる。
 *
 * 対応（実データの高頻度記法）:
 *   見出し  *…       → #…
 *   箇条書き - …      → - …（ネスト -- は字下げ）
 *   番号    + …       → 1. …（ネスト ++ は字下げ）
 *   強調    ''…''     → **…**
 *   打消    %%…%%     → ~~…~~
 *   引用    > …        → > …（そのまま）
 *           {quote}…{/quote} → 各行に > を付与
 *   コード  {code}…{/code}   → ``` フェンス
 *   テーブル |a|b|     → GFM テーブル（ヘッダ区切り行を補完）
 *   リンク  [[PROJ-32]]  → 課題内部リンク（後述の独自スキーム）
 *           [[label>url]] / [[url]] → [label](url) / <url>
 *   画像    #image(name) → ![name](添付参照の独自スキーム)（後述）
 *
 * 内部リンクは描画側（BacklogText）で Next の Link に差し替えるため、
 * href を `INTERNAL_ISSUE_SCHEME:keyId` 形式にしておく。
 */

/** 課題内部リンクの独自スキーム。描画側でこれを見て Next Link に差し替える */
export const INTERNAL_ISSUE_SCHEME = "bx-issue";
/** メンションの独自スキーム。描画側でこれを見てメンションチップに差し替える */
export const INTERNAL_MENTION_SCHEME = "bx-mention";
/** 埋め込み画像の独自スキーム。描画側でこれを見て OPFS のバイナリに解決する */
export const INTERNAL_ATTACHMENT_SCHEME = "bx-attachment";

/**
 * リンクの出力スキーム。
 * - "internal": backlog-x 内の描画用。課題リンク `bx-issue:${keyId}`・メンション `bx-mention:${name}`・
 *   埋め込み画像 `bx-attachment:${name}`。BacklogText が Next Link / メンションチップ / OPFS の
 *   objectURL に差し替えるための独自スキーム（既定）。
 * - "neutral":  エクスポート用の中立スキーム。課題リンク `issue:${issueKey}`・
 *   メンション `mention:${name}`・埋め込み画像 `attachment:${name}`。Backlog/backlog-x に依存しない
 *   参照で、取り込み側が自分の URL / users / ストレージに解決する。書き出したデータを
 *   Backlog のホストにも backlog-x の内部 ID にも縛られない形にするため、こちらを使う。
 */
export type LinkScheme = "internal" | "neutral";

export interface ToMarkdownOptions {
  /** このプロジェクトのキー。[[PROJ-32]] の "PROJ" と一致したら内部リンク扱い */
  projectKey?: string;
  /** メンション照合用のユーザー名一覧（@ユーザー名 をメンション化する） */
  mentionNames?: string[];
  /** リンクの出力スキーム（既定 "internal"＝描画用）。エクスポートは "neutral"。 */
  linkScheme?: LinkScheme;
  /**
   * このプロジェクトが属するスペースの URL（例 `https://example.backlog.jp`）。
   *
   * 本文に貼られた**このスペースの課題 URL**（`/view/KEY-123`）を課題リンクに変換するために使う
   * （`internalizeIssueUrl`）。**未指定なら URL は一切変換しない**ので、渡していない呼び出し元の
   * 挙動は変わらない。
   *
   * ⚠️ ホストの一致を必ず見る。実データには**別スペース**（別ドメイン）の課題 URL や Backlog の
   * 製品サイト（`www.backlog.jp`）も混ざっており、それらを自プロジェクトの課題として変換すると
   * 誤ったリンクになる。
   */
  spaceUrl?: string;
}

/** 正規表現の特殊文字をエスケープ */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 課題リンクの href を生成する。
 * - internal: `bx-issue:${keyId}`（描画側が Next Link に差し替える）
 * - neutral:  `issue:${projectKey}-${keyId}`（= issueKey。取り込み側が解決する中立参照）
 *   projectKey が無いと issueKey を組めないので、その場合は internal 相当（keyId）にフォールバック。
 */
function issueHref(
  keyId: string,
  scheme: LinkScheme,
  projectKey: string | undefined,
): string {
  if (scheme === "neutral") {
    return projectKey ? `issue:${projectKey}-${keyId}` : `issue:${keyId}`;
  }
  return `${INTERNAL_ISSUE_SCHEME}:${keyId}`;
}

/**
 * Backlog の課題 URL のパス（`/view/<KEY>-<番号>`）。任意で `#comment-<id>` のアンカーが付く。
 * 実データの内訳は `/view/KEY-N#comment-<id>` が最多で、次に `/view/KEY-N`。
 */
const ISSUE_URL_PATH = /^\/view\/([A-Za-z0-9_]+)-(\d+)$/;
/** 課題 URL のコメントアンカー（`#comment-<Backlog のコメント id>`）。 */
const COMMENT_ANCHOR = /^#comment-(\d+)$/;

/**
 * 本文に貼られた「このスペース・このプロジェクトの課題 URL」を課題リンクへ変換する。
 *
 * ## なぜ変換するのか
 *
 * Backlog 記法の変換では素の URL は退避してそのまま残していた（`autoLinkIssueKeys` の stash）。
 * その結果、本文の課題参照が **Backlog のホストを指す外部リンクとして残り、Backlog を解約すると
 * 死ぬ**。実データでは本文中の Backlog URL 2,024 件のうち **1,633 件（81%）が課題 URL**
 * （うち 1,405 件はコメントアンカー付き）で、これらはアーカイブの中にすべて対応する
 * 課題・コメントが存在する。参照先が手元にあるのに外部リンクのままにする理由がない。
 *
 * ## 変換しないもの（誤リンクを作らないための条件）
 *
 * - **ホストが違う URL**: 実データには別スペース（別ドメイン）の課題 URL や Backlog の製品サイト
 *   （`www.backlog.jp`）が混ざる。別スペースの `KEY-123` は自分の課題ではない。
 * - **プロジェクトキーが違う URL**: 同じスペースでも別プロジェクトの課題は手元に無い。
 * - **課題以外**（`/wiki/...` `/alias/wiki/...` `/settings/...` `/file/...` 等）: Wiki は対応
 *   付けられる余地があるが中立スキームが無いので今回は対象外（残件）。
 * - **`spaceUrl` / `projectKey` が未指定**のとき（判定材料が無いので触らない）。
 *
 * @returns 変換後のリンク（`[ラベル](href)` の材料）。対象外なら null。
 */
function internalizeIssueUrl(
  url: string,
  scheme: LinkScheme,
  projectKey: string | undefined,
  spaceUrl: string | undefined,
): { href: string; label: string } | null {
  if (!spaceUrl || !projectKey) return null;
  let target: URL;
  let space: URL;
  try {
    target = new URL(url);
    // spaceUrl はスキーム無し（"example.backlog.jp"）でも保存されうるので補う。
    space = new URL(
      /^https?:\/\//i.test(spaceUrl) ? spaceUrl : `https://${spaceUrl}`,
    );
  } catch {
    return null; // URL として解釈できない（本文中の省略表記など）
  }
  if (target.host !== space.host) return null;

  const pathMatch = target.pathname.match(ISSUE_URL_PATH);
  if (!pathMatch) return null;
  const [, key, keyId] = pathMatch;
  if (key !== projectKey) return null;

  // アンカーは「コメントへのリンク」だけ引き継ぐ。想定外のアンカーは落として課題を指す
  // （壊れたアンカーを持ち込むより、課題に飛べるほうが良い）。
  let anchor = "";
  if (target.hash !== "") {
    const anchorMatch = target.hash.match(COMMENT_ANCHOR);
    // internal（backlog-x 表示）: 要素 id は `comment-<Backlog のコメント id>` なのでそのまま。
    // neutral（エクスポート）: 取り込み側が自分の参照形式へ解決する。
    if (anchorMatch) anchor = `#comment-${anchorMatch[1]}`;
  }

  return {
    href: `${issueHref(keyId, scheme, projectKey)}${anchor}`,
    // ラベルは課題キー。元の URL をラベルに使うと Backlog のホストが本文に残り続けるうえ、
    // 素の課題キー（`autoLinkIssueKeys`）や `[[KEY-123]]` の変換結果と表記が揃わない。
    label: `${projectKey}-${keyId}`,
  };
}

/**
 * 埋め込み画像（`#image(name)`）の href を生成する（値は encodeURIComponent 済みの添付ファイル名）。
 *
 * Backlog の `#image` は**添付ファイル名**でしか参照しないので、id ではなく名前で持つ。
 * - internal: `bx-attachment:${name}`（BacklogText が OPFS のバイナリを objectURL に解決する）
 * - neutral:  `attachment:${name}`（取り込み側が自分のストレージ URL へ変換する）
 */
function attachmentHref(encodedName: string, scheme: LinkScheme): string {
  const prefix =
    scheme === "neutral" ? "attachment" : INTERNAL_ATTACHMENT_SCHEME;
  return `${prefix}:${encodedName}`;
}

/** メンションの href を生成する（値は encodeURIComponent 済みの名前）。 */
function mentionHref(encodedName: string, scheme: LinkScheme): string {
  const prefix = scheme === "neutral" ? "mention" : INTERNAL_MENTION_SCHEME;
  return `${prefix}:${encodedName}`;
}

/**
 * 本文中の「@ユーザー名」をメンションリンク（独自スキーム）に変換する。
 * メールアドレス（name@domain）の @ を誤検出しないよう、@ の直前が行頭/空白/区切りのときだけ対象。
 * 長い名前を優先（"西川 歩" を "西川" より先に）して最長一致させる。
 */
function convertMentions(
  line: string,
  mentionNames: string[],
  scheme: LinkScheme,
): string {
  if (mentionNames.length === 0) return line;
  const sorted = [...mentionNames].sort((a, b) => b.length - a.length);
  let s = line;
  for (const name of sorted) {
    if (!name) continue;
    // 直前が行頭 or 空白系 or 区切り文字のときの @名前 だけをメンション化。
    // 名前に空白を含むと Markdown のリンク URL が途切れるため encodeURIComponent する。
    const re = new RegExp(
      `(^|[\\s（(、。|>])@${escapeRegExp(name)}(?![^\\s（(、。|]*@)`,
      "g",
    );
    const encoded = encodeURIComponent(name);
    s = s.replace(
      re,
      (_m, pre: string) => `${pre}[@${name}](${mentionHref(encoded, scheme)})`,
    );
  }
  return s;
}

/** CRLF / CR を LF に正規化 */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * 行をまたぐ強調 ''…'' / 打消 %%…%% を **…** / ~~…~~ に変換する（行分割前の前処理）。
 *
 * convertInline は 1 行内でしか処理しないため、行をまたぐ強調はここで先に解決する。
 * 実描画スタック（react-markdown + remark-gfm + remark-breaks）で検証済みの前提:
 *   - `**foo\nbar**`（単一改行またぎ）は strong として描画される（改行は <br>）。
 *   - `**foo\n\nbar**`（空行＝段落またぎ）は強調にならない → 空行をまたぐ範囲は変換しない。
 *   - 引用 `> **foo\n> bar**` も強調になる → 引用は特別扱い不要（各行 > 始まりのまま ** を入れればよい）。
 *
 * 注意:
 *   - {code}…{/code} 内は変換しない（コード内の '' は空文字リテラル等）。先に退避する。
 *   - 中身の先頭末尾の空白（改行含む）は trim し、中間の改行は保持する（GFM は ** x ** が効かない）。
 */
function convertMultilineEmphasis(text: string): string {
  // 1) {code}…{/code} を NUL 区切りのプレースホルダに退避（本文に出ない文字で衝突回避）
  const stash: string[] = [];
  let s = text.replace(/\{code\}[\s\S]*?\{\/code\}/gi, (m) => {
    stash.push(m);
    return `@@bxcode${stash.length - 1}@@`;
  });

  // 2) 空行(\n\n)をまたがない ''…'' → **…**（改行保持・中身 trim）
  s = s.replace(/''((?:(?!\n\n)[\s\S])*?)''/g, (m, t: string) => {
    const inner = t.trim();
    return inner ? `**${inner}**` : m;
  });

  // 3) 同様に %%…%% → ~~…~~
  s = s.replace(/%%((?:(?!\n\n)[\s\S])*?)%%/g, (m, t: string) => {
    const inner = t.trim();
    return inner ? `~~${inner}~~` : m;
  });

  // 4) {code} を復元
  return s.replace(/@@bxcode(\d+)@@/g, (_m, i: string) => stash[Number(i)]);
}

/** インライン記法の変換（行内テキストに対して適用） */
function convertInline(line: string, opts: ToMarkdownOptions): string {
  const { projectKey, mentionNames } = opts;
  const scheme: LinkScheme = opts.linkScheme ?? "internal";
  let s = line;

  // メンション @ユーザー名 を最初に処理（他の変換に巻き込まれないよう先に独自リンク化）
  if (mentionNames && mentionNames.length > 0) {
    s = convertMentions(s, mentionNames, scheme);
  }

  // [[...]] リンク（先に処理）。Backlog 記法のラベル区切りは「:」（例 [[ラベル:URL]]）。
  // URL 自体に "https:" の : を含むため、最初の : で割るのではなく URL の開始位置で割る。
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
    const raw = String(inner).trim();

    // URL を含む場合: URL 開始（https?://）の手前までをラベルとみなす
    const urlMatch = raw.match(/https?:\/\/\S+/);
    if (urlMatch && urlMatch.index !== undefined) {
      const url = urlMatch[0];
      // URL 直前の区切り（: または >）とラベルを取り出す
      const label = raw
        .slice(0, urlMatch.index)
        .replace(/[:>]\s*$/, "")
        .trim();
      if (!label) {
        // ラベルなし [[https://...]] は自動リンク
        return `<${url}>`;
      }
      return `[${label}](${url})`;
    }

    // [[PROJ-123]] 課題キー → 内部リンク
    const issueMatch = raw.match(/^([A-Za-z0-9_]+)-(\d+)$/);
    if (issueMatch) {
      const [, key, num] = issueMatch;
      if (!projectKey || key === projectKey) {
        return `[${raw}](${issueHref(num, scheme, projectKey)})`;
      }
      return raw; // 別プロジェクトのキーは現状リンクにできない
    }

    // [[ラベル:課題キー]] 等、URL でない : 区切り（稀）。ラベル>キー も一応拾う
    const sep = raw.search(/[:>]/);
    if (sep >= 0) {
      const label = raw.slice(0, sep).trim();
      const target = raw.slice(sep + 1).trim();
      const im = target.match(/^([A-Za-z0-9_]+)-(\d+)$/);
      if (im && (!projectKey || im[1] === projectKey)) {
        return `[${label}](${issueHref(im[2], scheme, projectKey)})`;
      }
    }

    // それ以外はそのままテキスト
    return raw;
  });

  // #image(name) → 画像リンク（添付ファイル名で参照する独自スキーム）
  s = s.replace(/#image\(([^)]*)\)/gi, (_m, name: string) => {
    const trimmed = String(name).trim();
    if (trimmed === "") return "";
    // alt に ] や改行が入るとリンク構文が壊れるのでエスケープ（表示は元の名前のまま）。
    const alt = trimmed.replace(/[[\]]/g, "\\$&");
    return `![${alt}](${attachmentHref(encodeURIComponent(trimmed), scheme)})`;
  });

  // 強調 ''…'' → **…**（** より先に '' を処理）
  // GFM は記号の内側に空白があると効かない（** text ** は強調にならない）ので中身を trim。
  s = s.replace(/''([^']+)''/g, (_m, t: string) => {
    const inner = t.trim();
    return inner ? `**${inner}**` : t;
  });

  // 打消 %%…%% → ~~…~~（同上、内側の空白を trim。元データは "%% text %%" のように空白を含む）
  s = s.replace(/%%([^%]+)%%/g, (_m, t: string) => {
    const inner = t.trim();
    return inner ? `~~${inner}~~` : t;
  });

  // 素の課題キー（例 "PROJ-4470"）を内部リンク化（自プロジェクトのキーのみ・誤検出回避）。
  // この時点で既に [[PROJ-32]] は [PROJ-32](bx-issue:32) になっているため、生成済みの
  // Markdown リンク/自動リンクの中を二重変換しないよう、リンク構文を一時退避してから処理する。
  if (projectKey) {
    s = autoLinkIssueKeys(s, projectKey, scheme, opts.spaceUrl);
  }

  return s;
}

/**
 * 行内の素の課題キー（`PROJECTKEY-数字`）を内部リンクに変換する。projectKey 一致のみ対象。
 * 既存の Markdown リンク `[..](..)` / 自動リンク `<..>` の内側は変換しない（プレースホルダ退避）。
 * 前後がキー文字（英数字・ハイフン）でない、独立した語のときだけマッチさせる。
 */
function autoLinkIssueKeys(
  line: string,
  projectKey: string,
  scheme: LinkScheme,
  spaceUrl?: string,
): string {
  // 1. 既存のリンク構文（[label](url) / <url>）と素の URL（http(s)://…）をトークンに退避する。
  //    トークンは通常テキストに出現しない形（@@bxlink0@@）にして、本文と衝突せず復元できるようにする。
  //    素の URL も退避しないと、URL 内に現れる課題キー（例 `.../view/PROJ-4449#comment-…`）が
  //    「独立した課題キー」と誤判定されてリンク化され、URL が分断される（実データで発生）。
  //    URL は Markdown リンクより先に食わないよう、[label](url) / <url> を先に並べる。
  //
  //    **退避する時点で、このスペース・このプロジェクトの課題 URL は課題リンクに差し替える**
  //    （internalizeIssueUrl）。差し替え後の値を退避するので、2. の素のキー変換に二重で拾われる
  //    こともない。spaceUrl が無ければ差し替えは起きず、従来どおりの退避になる。
  const stash: string[] = [];
  const stashed = line.replace(
    /\[[^\]]*\]\([^)]*\)|<[^>]+>|https?:\/\/[^\s<>()]+/g,
    (m) => {
      stash.push(internalizeLinkToken(m, scheme, projectKey, spaceUrl));
      return `@@bxlink${stash.length - 1}@@`;
    },
  );

  // 2. 素の課題キーをリンク化。前後が英数字/アンダースコア/ハイフンでない独立した PROJ-数字 のみ。
  const re = new RegExp(
    `(^|[^0-9A-Za-z_-])(${escapeRegExp(projectKey)}-(\\d+))(?![0-9A-Za-z_-])`,
    "g",
  );
  const linked = stashed.replace(
    re,
    (_m, pre: string, full: string, num: string) =>
      `${pre}[${full}](${issueHref(num, scheme, projectKey)})`,
  );

  // 3. 退避したリンクを戻す
  return linked.replace(
    /@@bxlink(\d+)@@/g,
    (_m, idx: string) => stash[Number(idx)],
  );
}

/**
 * 退避対象のトークン 1 つ（`[label](url)` / `<url>` / 素の URL）について、中に入っている URL が
 * このプロジェクトの課題 URL なら課題リンクへ差し替える。対象外はそのまま返す。
 *
 * ラベルの扱い:
 * - `[label](url)` は**ラベルを保つ**（書き手が付けた説明を捨てない）。
 * - `<url>` / 素の URL はラベルが無いので**課題キー**（`KEY-123`）を表示にする。元の URL を
 *   ラベルにすると Backlog のホストが本文に残り、他の課題リンクと表記も揃わない。
 */
function internalizeLinkToken(
  token: string,
  scheme: LinkScheme,
  projectKey: string,
  spaceUrl?: string,
): string {
  if (!spaceUrl) return token;

  // [label](url) 形式
  const md = token.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
  if (md) {
    const [, label, url] = md;
    const conv = internalizeIssueUrl(url.trim(), scheme, projectKey, spaceUrl);
    return conv ? `[${label}](${conv.href})` : token;
  }

  // <url> 形式（自動リンク）
  const auto = token.match(/^<(.+)>$/);
  if (auto) {
    const conv = internalizeIssueUrl(
      auto[1].trim(),
      scheme,
      projectKey,
      spaceUrl,
    );
    return conv ? `[${conv.label}](${conv.href})` : token;
  }

  // 素の URL
  const conv = internalizeIssueUrl(token, scheme, projectKey, spaceUrl);
  return conv ? `[${conv.label}](${conv.href})` : token;
}

/** 1 行が Backlog テーブル行か（|...| で囲まれている） */
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.length > 1;
}

/** Backlog テーブル行をセル配列に分解。先頭セルの "|h" 等のヘッダ印は落とす */
function parseTableRow(line: string): { cells: string[]; header: boolean } {
  const t = line.trim().replace(/^\|/, "").replace(/\|h?$/i, "");
  const cells = t.split("|");
  // Backlog はセル末尾に "h" を付けるとヘッダ。行全体がヘッダかを末尾印で判定
  const header = /\|h\s*$/i.test(line.trim());
  return { cells: cells.map((c) => c.trim()), header };
}

export function backlogToMarkdown(
  input: string,
  options: ToMarkdownOptions = {},
): string {
  const opts = options;
  // 行分割の前に、行をまたぐ強調 ''…'' / 打消 %%…%% を先に **…** / ~~…~~ へ変換する
  // （convertInline は 1 行内でしか処理できないため）。
  const text = convertMultilineEmphasis(normalizeNewlines(input));
  const lines = text.split("\n");
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // --- コードブロック {code} … {/code} ---
    if (/^\s*\{code\}/i.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*\{\/code\}/i.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // {/code} を飛ばす
      out.push("```");
      out.push(...body);
      out.push("```");
      continue;
    }

    // --- 引用ブロック {quote} … {/quote} ---
    if (/^\s*\{quote\}/i.test(line)) {
      i++;
      while (i < lines.length && !/^\s*\{\/quote\}/i.test(lines[i])) {
        out.push(`> ${convertInline(lines[i], opts)}`);
        i++;
      }
      i++; // {/quote}
      continue;
    }

    // --- テーブル（連続する |...| 行）---
    if (isTableRow(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      const parsed = tableLines.map(parseTableRow);
      const colCount = Math.max(...parsed.map((r) => r.cells.length));
      // GFM テーブルはヘッダ必須。先頭行をヘッダとして扱い区切り行を補う
      const headerCells = parsed[0].cells;
      out.push(
        `| ${headerCells.map((c) => convertInline(c, opts)).join(" | ")} |`,
      );
      out.push(`| ${Array(colCount).fill("---").join(" | ")} |`);
      for (let r = 1; r < parsed.length; r++) {
        out.push(
          `| ${parsed[r].cells.map((c) => convertInline(c, opts)).join(" | ")} |`,
        );
      }
      out.push(""); // テーブル後に空行
      continue;
    }

    // --- 見出し * / ** / *** （行頭。ただし箇条書きの - と衝突しないよう * のみ）---
    const heading = line.match(/^(\*{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`${"#".repeat(level)} ${convertInline(heading[2], opts)}`);
      i++;
      continue;
    }

    // --- 箇条書き - / -- / --- （ネストは字下げ）---
    const ul = line.match(/^(-+)\s+(.*)$/);
    if (ul) {
      const depth = ul[1].length - 1;
      out.push(`${"  ".repeat(depth)}- ${convertInline(ul[2], opts)}`);
      i++;
      continue;
    }

    // --- 番号リスト + / ++ ---
    const ol = line.match(/^(\++)\s+(.*)$/);
    if (ol) {
      const depth = ol[1].length - 1;
      out.push(`${"  ".repeat(depth)}1. ${convertInline(ol[2], opts)}`);
      i++;
      continue;
    }

    // --- 行頭引用 > ---
    if (/^>\s?/.test(line)) {
      out.push(`> ${convertInline(line.replace(/^>\s?/, ""), opts)}`);
      i++;
      continue;
    }

    // --- 通常行（段落）---
    out.push(convertInline(line, opts));
    i++;
  }

  return out.join("\n");
}
