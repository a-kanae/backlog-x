#!/usr/bin/env node
/**
 * kuromoji の辞書（形態素解析に必須）を node_modules から public/dict へコピーする。
 *
 * 辞書は ~17MB のバイナリで、リポジトリには含めない（gitignore）。npm install の postinstall で
 * 自動コピーし、クローン → npm install だけで検索が動くようにする。
 * Next.js は public/ の実ファイルを配信するため、シンボリックリンクではなく実コピーにする
 * （symlink は build / 本番配信 / Windows で不安定なため）。
 */
import { cp, mkdir, readdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "kuromoji", "dict");
const dest = join(root, "public", "dict");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(src))) {
    // kuromoji 未インストール時は何もしない（依存導入前の install などで壊さない）
    console.warn(
      "[copy-dict] kuromoji の辞書が見つかりません。スキップします:",
      src,
    );
    return;
  }
  // 既にコピー済み（ファイルがある）ならスキップ
  if (await exists(dest)) {
    const files = await readdir(dest);
    if (files.some((f) => f.endsWith(".dat.gz"))) {
      console.log("[copy-dict] public/dict は既に存在します。スキップします。");
      return;
    }
  }
  await mkdir(dest, { recursive: true });
  await cp(src, dest, { recursive: true });
  console.log("[copy-dict] 辞書を public/dict にコピーしました。");
}

main().catch((err) => {
  // postinstall を失敗させない（検索を使わない用途もあるため警告に留める）
  console.warn(
    "[copy-dict] 辞書コピーに失敗しました（検索機能には辞書が必要です）:",
    err.message,
  );
});
