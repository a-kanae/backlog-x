#!/usr/bin/env node
/**
 * ユーザーアイコンを Backlog API から取得し、backlog-x にインポートできる .json.gz を書き出す。
 *
 * なぜ CLI が要るか:
 *   Nulab アカウント連携ユーザーのアイコンは /users/:id/icon が apps.nulab.com へ 302
 *   リダイレクトし、そのリダイレクト先は CORS ヘッダを返さない。そのためブラウザの取り込みでは
 *   一部ユーザーのアイコンしか取得できない。Node（CLI）は CORS の制約を受けないので全ユーザーぶん
 *   取得できる。これは「アイコンを全員ぶん揃えたい管理者向けの初回オプション手順」。
 *
 * 取得したファイルは backlog-x の「ファイルからインポート」で読み込める（userIcons に追加保存）。
 * 課題インポートの前後どちらでも・単独でも実行できる（projectId 非依存）。
 *
 * 使い方:
 *   BACKLOG_API_KEY=xxxx node scripts/fetch-icons.mjs \
 *     --space https://example.backlog.jp --project PROJ --out backlog-x-PROJ-icons.json.gz
 *
 * 引数:
 *   --space   スペース URL（必須。例 https://example.backlog.jp）
 *   --project 対象プロジェクトのキー（任意。指定するとそのプロジェクトの参加メンバーのみ。
 *             省略すると自分が見える全ユーザー /users）
 *   --out     出力ファイル名（任意。既定 backlog-x-icons.json.gz）
 *   API キーは環境変数 BACKLOG_API_KEY で渡す（コマンドライン引数に書かない＝履歴に残さない）。
 */

import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const SPACE = (arg("space") || "").replace(/\/+$/, "");
const PROJECT = arg("project");
const OUT = arg("out") || "backlog-x-icons.json.gz";
const KEY = process.env.BACKLOG_API_KEY;

if (!SPACE || !KEY) {
  console.error(
    "使い方: BACKLOG_API_KEY=xxxx node scripts/fetch-icons.mjs --space https://example.backlog.jp [--project PROJ] [--out file.json.gz]",
  );
  process.exit(1);
}

const api = async (path) => {
  const url = `${SPACE}/api/v2${path}${path.includes("?") ? "&" : "?"}apiKey=${KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
};

// 対象ユーザー一覧（プロジェクト指定があればその参加メンバー、無ければ全ユーザー）
async function listUsers() {
  if (PROJECT) {
    // projectKey から projectId を引く
    const proj = await api(`/projects/${PROJECT}`);
    return api(`/projects/${proj.id}/users`);
  }
  return api("/users");
}

// アイコン取得（Node なので CORS 無関係。302 も follow して取れる）
async function fetchIcon(userId) {
  const url = `${SPACE}/api/v2/users/${userId}/icon?apiKey=${KEY}`;
  const res = await fetch(url); // Node の fetch は既定でリダイレクトを follow する
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) return null;
  const contentType =
    res.headers.get("content-type") || "application/octet-stream";
  return { base64: buf.toString("base64"), contentType };
}

const users = await listUsers();
console.log(`対象ユーザー: ${users.length} 人`);

const icons = [];
let ok = 0;
for (const u of users) {
  const got = await fetchIcon(u.id);
  if (got) {
    icons.push({
      userId: u.id,
      base64: got.base64,
      contentType: got.contentType,
    });
    ok++;
  }
  process.stdout.write(`\r  取得 ${ok}/${users.length}  `);
}
console.log("");

const payload = {
  format: "backlog-x-icons",
  version: 1,
  exportedAt: new Date().toISOString(),
  icons,
};

const gz = gzipSync(Buffer.from(JSON.stringify(payload)));
writeFileSync(OUT, gz);
console.log(
  `書き出し: ${OUT}（アイコン ${icons.length} 件 / ${(gz.length / 1024).toFixed(1)} KB）`,
);
console.log(
  "backlog-x の「ファイルからインポート」でこのファイルを選ぶとアイコンが追加されます。",
);
