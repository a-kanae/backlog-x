// output: 'export' で動的ルートをビルドするためのプレースホルダ。
// 実データの projectId はビルド時に不明 (取り込んだブラウザにしか存在しない) ため、
// 静的シェルを 1 つだけ生成し、実 URL は Firebase の rewrites で動的シェルへ流す。
// 画面のシェル・コンテンツの描画は layout.tsx（ProjectWorkspace）が usePathname で行うため、
// page 自体は何も描画しない（layout を再マウントさせないよう page だけが切り替わる）。
export function generateStaticParams() {
  return [{ projectId: "_" }];
}

export default function ProjectPage() {
  return null;
}
