// output: 'export' のプレースホルダ。描画は layout.tsx（ProjectWorkspace）が担う。
export function generateStaticParams() {
  return [{ projectId: "_", documentId: "_" }];
}

export default function DocumentPage() {
  return null;
}
