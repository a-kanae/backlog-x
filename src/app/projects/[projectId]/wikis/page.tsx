// output: 'export' のプレースホルダ。描画は layout.tsx（ProjectWorkspace）が担う。
export function generateStaticParams() {
  return [{ projectId: "_" }];
}

export default function WikiListPage() {
  return null;
}
