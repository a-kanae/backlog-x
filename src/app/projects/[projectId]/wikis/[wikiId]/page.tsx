// output: 'export' のプレースホルダ。描画は layout.tsx（ProjectWorkspace）が担う。
export function generateStaticParams() {
  return [{ projectId: "_", wikiId: "_" }];
}

export default function WikiPage() {
  return null;
}
