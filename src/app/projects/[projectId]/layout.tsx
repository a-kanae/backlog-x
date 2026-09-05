import { ProjectWorkspaceGate } from "@/components/workspace/ProjectWorkspaceGate";

/**
 * /projects/:id 配下（課題・Wiki・ドキュメントの一覧/詳細）で共有するレイアウト。
 *
 * Next.js のレイアウトは配下の page が切り替わっても再マウントされない
 * （docs: "Layouts do not rerender on navigation"）。そのため統一ワークスペースの
 * シェル（ヘッダー・検索・カテゴリ・コンテンツ・Wiki サイドバー）をここに置くことで、
 * カテゴリ間を遷移しても検索ワードや Wiki ツリーの展開状態が保持される。
 *
 * コンテンツの出し分けはシェル（ProjectWorkspace）が usePathname から判定して行うため、
 * 配下の page.tsx は何も描画しない（children は使わない）。それでも static export の
 * ルート生成のために各 page.tsx と generateStaticParams は必要。
 *
 * シェルは ProjectWorkspaceGate 経由で描画する。ビルド時の pathname はプレースホルダなので
 * 解決されるビューがクライアントと食い違い、ハイドレーション不一致になるため（詳細は
 * ProjectWorkspaceGate のコメント）。
 */
export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ProjectWorkspaceGate>{children}</ProjectWorkspaceGate>;
}
