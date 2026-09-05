// output: 'export' のプレースホルダ。描画は layout.tsx（ProjectWorkspace）が担う。
export function generateStaticParams() {
  return [{ projectId: "_", keyId: "_" }];
}

export default function IssuePage() {
  return null;
}
