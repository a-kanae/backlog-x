import type { NextConfig } from "next";

// 本番ビルド (next build) のときだけ完全静的化する。
// next dev では output:'export' を外す: export モードだと dev サーバーでも動的ルートが
// generateStaticParams のプレースホルダ ('_') しか受け付けず、実 ID の直アクセスがエラーに
// なるため (本番は Firebase rewrites で '_' シェルへ流す前提)。dev では Next の動的ルートが
// 実 ID をそのまま解決できるようにして、開発時の閲覧・デザイン確認を快適にする。
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  ...(isDev ? {} : { output: "export" }),
  // 開発サーバーを <名前>.localhost で開けるようにする（git worktree で並行開発するとき、worktree ごとに
  // ホスト名を分けて取り込んだデータ（IndexedDB）を混ぜないため）。localhost 以外のホストから
  // dev 用のリソースへのアクセスは既定で弾かれる。
  allowedDevOrigins: ["*.localhost"],
};

export default nextConfig;
