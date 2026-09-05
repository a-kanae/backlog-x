/**
 * Wiki ページ一覧ツリーの構築。
 *
 * Backlog の Wiki は「ページ名の `/` 区切り」で階層を表す慣習があり（例
 * "01.月別リリース内容/2026年/06月"）、本家のサイドバー「ページ一覧」もこの命名から
 * ツリーを生成している。ここでも同じく `name` を `/` で分割して階層ツリーを組む。
 *
 * 中間パス自体が実ページのこともある（"01.月別リリース内容" が実 Wiki で、かつ
 * "01.月別リリース内容/2026年" という子も持つ）。そのため各ノードは「実ページか否か
 * （wikiId の有無）」と「子ノード」を両方持てる形にする。実体の無い純粋なフォルダ
 * （例 "2020年"）は wikiId を持たず展開トグルのみになる。
 */

import type { WikiHeading } from "@/types/entities";

/** ツリーの 1 ノード */
export interface WikiTreeNode {
  /** このノードのラベル（パスの最後のセグメント。例 "06月"） */
  label: string;
  /** ルートからのフルパス（例 "01.月別リリース内容/2026年/06月"）。展開状態のキーに使う */
  path: string;
  /** 実ページならその Wiki id。純粋なフォルダ（実体なし）なら null */
  wikiId: number | null;
  /** 子ノード（ラベル昇順） */
  children: WikiTreeNode[];
}

/** ツリー構築の内部用（children を Map で持ち、最後に配列化する） */
interface MutableNode {
  label: string;
  path: string;
  wikiId: number | null;
  children: Map<string, MutableNode>;
}

function makeNode(label: string, path: string): MutableNode {
  return { label, path, wikiId: null, children: new Map() };
}

/**
 * Wiki 見出し配列からページ一覧ツリーを構築する。
 *
 * - `name` を `/` で分割し、セグメントごとにノードを掘る（無ければ作る）。
 * - 末端セグメントのノードに wikiId を設定する（そのパスが実ページ）。
 * - 同名パスが複数あっても 1 ノードに統合する（実運用では一意のはずだが、念のため
 *   後勝ちにせず最初に見つけた id を採用＝決定的にする）。
 */
export function buildWikiTree(headings: WikiHeading[]): WikiTreeNode[] {
  const roots = new Map<string, MutableNode>();

  // パスのセグメント前後の空白は表示揺れの原因になるため trim する（"2026年 / 06月" 等の保険）。
  const splitName = (name: string): string[] =>
    name
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  for (const h of headings) {
    const segments = splitName(h.name);
    if (segments.length === 0) continue;

    let level = roots;
    let parentPath = "";
    let node: MutableNode | undefined;
    for (const seg of segments) {
      const path = parentPath ? `${parentPath}/${seg}` : seg;
      let next = level.get(seg);
      if (!next) {
        next = makeNode(seg, path);
        level.set(seg, next);
      }
      node = next;
      level = next.children;
      parentPath = path;
    }
    // 末端ノード = 実ページ。既に id があれば最初のものを優先（決定的）。
    if (node && node.wikiId === null) node.wikiId = h.id;
  }

  return sortLevel(roots);
}

/** Map の階層を再帰的に配列化し、各レベルをラベル昇順（ロケール考慮）でソートする */
function sortLevel(level: Map<string, MutableNode>): WikiTreeNode[] {
  return [...level.values()]
    .sort((a, b) => a.label.localeCompare(b.label, "ja"))
    .map((n) => ({
      label: n.label,
      path: n.path,
      wikiId: n.wikiId,
      children: sortLevel(n.children),
    }));
}

/**
 * 指定した Wiki id を「初期表示で開いておくべきパス」の一覧を返す。
 *
 * - 祖先フォルダはすべて開く（現在ページが見えるように）。
 * - 現在ページ自身が子を持つ親ページなら、その子ツリーも見えるよう自身のパスも開く（要望②）。
 *   例: "06.新カートシステム"（実ページ＋子あり）を開いたら、その配下の子ページが展開される。
 *   葉ページ（子なし）の場合は自身のパスは含めない（開く子が無いため）。
 */
export function ancestorPathsOf(
  tree: WikiTreeNode[],
  wikiId: number,
): string[] {
  const result: string[] = [];
  const walk = (nodes: WikiTreeNode[], ancestors: string[]): boolean => {
    for (const n of nodes) {
      if (n.wikiId === wikiId) {
        result.push(...ancestors);
        // 現在ページ自身が子を持つなら、その子を見せるため自身も開く。
        if (n.children.length > 0) result.push(n.path);
        return true;
      }
      if (n.children.length > 0 && walk(n.children, [...ancestors, n.path])) {
        return true;
      }
    }
    return false;
  };
  walk(tree, []);
  return result;
}
