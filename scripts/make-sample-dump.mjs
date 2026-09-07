/**
 * デモ用サンプルアーカイブ（Backlog ダンプ形式）を生成する。
 *
 * 出力: public/sample/backlog-x-demo.json.gz
 *
 * 公開サイトの「サンプルデータで試す」から取り込まれる。Backlog の API を叩かずに
 * 一覧・全文検索・課題詳細・Wiki・記法レンダリングを体験してもらうためのもの。
 *
 * ## なぜ「Backlog ダンプ形式」なのか
 *
 * backlog-x の書き出し形式（ProjectExport）は flexsearch の検索インデックスをバイナリ
 * チャンクで内包するため、スクリプトから組み立てるのが困難。ダンプ形式（= API の生
 * レスポンスそのまま）なら素のオブジェクトで書けて、正規化・索引構築はアプリ本来の
 * 取り込み処理（ingestFromDump）がやってくれる。ファイルも小さい。
 *
 * ## データはすべて架空
 *
 * 人名は定番のプレースホルダ名、メールは RFC 2606 の example.com、スペース URL も
 * 実在しないホスト。実データを匿名化して作るのは変換漏れの事故が怖いので採らない。
 *
 * 使い方: node scripts/make-sample-dump.mjs
 */

import { gzipSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const OUT = "public/sample/backlog-x-demo.json.gz";

const SPACE_URL = "https://example-space.backlog.jp";
const PROJECT_ID = 999001;
const PROJECT_KEY = "SAMPLE";

/** 決定的な擬似乱数（再生成しても同じファイルになるように） */
let seed = 20260907;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));

// --- ユーザー（架空） ---
const rawUsers = [
  { id: 1001, userId: "yamada", name: "山田 太郎", roleType: 1 },
  { id: 1002, userId: "suzuki", name: "鈴木 花子", roleType: 2 },
  { id: 1003, userId: "sato", name: "佐藤 次郎", roleType: 2 },
  { id: 1004, userId: "tanaka", name: "田中 三郎", roleType: 3 },
  { id: 1005, userId: "takahashi", name: "高橋 みどり", roleType: 4 },
];
const user = (u) => ({
  id: u.id,
  userId: u.userId,
  name: u.name,
  roleType: u.roleType,
  lang: "ja",
  mailAddress: `${u.userId}@example.com`,
  nulabAccount: null,
  keyword: u.name,
  lastLoginTime: "2026-08-31T09:12:44Z",
});
const users = rawUsers.map(user);
const anyUser = () => pick(users);

// --- マスタ ---
const statuses = [
  {
    id: 1,
    projectId: PROJECT_ID,
    name: "未対応",
    color: "#ed8077",
    displayOrder: 1000,
  },
  {
    id: 2,
    projectId: PROJECT_ID,
    name: "処理中",
    color: "#4488c5",
    displayOrder: 2000,
  },
  {
    id: 3,
    projectId: PROJECT_ID,
    name: "処理済み",
    color: "#5eb5a6",
    displayOrder: 3000,
  },
  {
    id: 4,
    projectId: PROJECT_ID,
    name: "完了",
    color: "#b0be3c",
    displayOrder: 4000,
  },
];
const issueTypes = [
  {
    id: 101,
    projectId: PROJECT_ID,
    name: "タスク",
    color: "#7ea800",
    displayOrder: 0,
  },
  {
    id: 102,
    projectId: PROJECT_ID,
    name: "バグ",
    color: "#990000",
    displayOrder: 1,
  },
  {
    id: 103,
    projectId: PROJECT_ID,
    name: "要望",
    color: "#2779ca",
    displayOrder: 2,
  },
];
const priorities = [
  { id: 2, name: "高" },
  { id: 3, name: "中" },
  { id: 4, name: "低" },
];
const resolutions = [
  { id: 0, name: "対応済み" },
  { id: 1, name: "対応しない" },
  { id: 2, name: "仕様のため" },
];
const categories = [
  { id: 201, projectId: PROJECT_ID, name: "フロントエンド", displayOrder: 0 },
  { id: 202, projectId: PROJECT_ID, name: "デザイン", displayOrder: 1 },
  { id: 203, projectId: PROJECT_ID, name: "インフラ", displayOrder: 2 },
  { id: 204, projectId: PROJECT_ID, name: "ドキュメント", displayOrder: 3 },
];
const versions = [
  {
    id: 301,
    projectId: PROJECT_ID,
    name: "v1.0 公開",
    description: "コーポレートサイトの公開",
    startDate: "2026-04-01T00:00:00Z",
    releaseDueDate: "2026-06-30T00:00:00Z",
    archived: false,
    displayOrder: 0,
  },
  {
    id: 302,
    projectId: PROJECT_ID,
    name: "v1.1 改善",
    description: "公開後の改善対応",
    startDate: "2026-07-01T00:00:00Z",
    releaseDueDate: "2026-09-30T00:00:00Z",
    archived: false,
    displayOrder: 1,
  },
];

// --- 課題のタイトル（架空のコーポレートサイト制作プロジェクト） ---
const summaries = [
  "トップページのファーストビューを差し替える",
  "スマートフォンでナビゲーションが開かない",
  "お問い合わせフォームの必須チェックが効いていない",
  "会社概要ページのレスポンシブ対応",
  "採用情報の一覧をカード型レイアウトに変更",
  "画像の遅延読み込みを導入する",
  "IE 相当の古いブラウザ向けの注意文を削除",
  "フッターのリンク切れを修正",
  "サイトマップ XML を自動生成する",
  "OG 画像がシェア時に表示されない",
  "ニュース一覧のページネーションを実装",
  "問い合わせ完了ページの文言を見直す",
  "アクセス解析タグの設置",
  "フォント読み込みで表示崩れが起きる",
  "見出しの文字サイズを整理する",
  "実績紹介ページの追加",
  "プライバシーポリシーの改訂を反映",
  "404 ページのデザイン",
  "ステージング環境の Basic 認証を設定",
  "画像を WebP に変換して軽量化",
  "ヘッダーのロゴが縦に潰れる",
  "リンクのホバー状態が分かりにくい",
  "パンくずリストを全ページに追加",
  "SSL 証明書の自動更新を確認",
  "デプロイ手順をドキュメント化",
  "問い合わせメールが迷惑メールに入る",
  "多言語対応の方針を決める",
  "アクセシビリティのコントラスト比を改善",
  "サービス紹介の図版を作成",
  "スクロール追従ボタンが本文と重なる",
  "表示速度の計測結果をまとめる",
  "フォームの入力補助（autocomplete）を設定",
  "テーブルが狭い画面で見切れる",
  "動画埋め込みの縦横比を固定する",
  "リダイレクト設定の棚卸し",
  "問い合わせ種別のプルダウンを追加",
  "ファビコンを差し替える",
  "印刷用スタイルの調整",
  "検索フォームで日本語が文字化けする",
  "コンテンツの校正指摘を反映",
  "外部リンクに別タブ属性を付ける",
  "スライダーの自動再生を止める",
  "ページ内アンカーの位置がずれる",
  "画像の alt 属性を全点入れる",
  "問い合わせ完了後の離脱率を確認",
  "ダークモードの検討",
  "バックアップの取得頻度を見直す",
  "フォームの送信ボタンが二重に押せる",
  "サイト内検索の導入を検討",
  "更新作業の権限を整理する",
  "会社沿革の表組みを作り直す",
  "スマートフォンで表が横スクロールしない",
  "問い合わせの自動返信文を用意",
  "リンクの下線をデザインに合わせる",
  "納品前のブラウザ確認",
  "公開後のリリースノートをまとめる",
  "問い合わせフォームに確認画面を追加",
  "トップの読み込み待ち時間を短縮",
  "見出しタグの階層を修正",
  "デザインカンプとの差分を確認",
];

// --- 本文・コメントのテンプレート（Backlog 記法を混ぜる） ---
// 同じ文が何度も並ぶと「作り物」に見えてデモとして弱いので、テンプレート自体を多めに
// 用意し、さらにページ名・端末名・数値を差し込んで表面を散らす。1 つの課題の中では
// テンプレートを重複させない（shuffle して順に使う）。
const pages = [
  "トップページ",
  "会社概要ページ",
  "サービス紹介ページ",
  "採用情報ページ",
  "お問い合わせページ",
  "実績紹介ページ",
];
const devices = [
  "iPhone 15 / iOS Safari",
  "Pixel 8 / Android Chrome",
  "iPad Air / iOS Safari",
  "Windows 11 / Chrome",
  "macOS / Safari",
];
const names = () => pick(rawUsers).name;

/** 配列を決定的にシャッフルして返す（同じ seed なら毎回同じ順） */
const shuffled = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const descTemplates = [
  (s) =>
    `* 概要\n${s}。\n\n* 対象\n- ${pick(pages)}\n- ${pick(pages)}\n\n* 確認環境\n- ${pick(devices)}\n\n担当は @${names()} さんにお願いします。`,
  (s) =>
    `${s}ための対応です。\n\n- [ ] 現状の確認\n- [ ] 修正\n- [ ] ${pick(pages)}での動作確認\n\n''着手は次のスプリントから''。`,
  (s) =>
    `${s}。\n\n|項目|内容|h\n|対象|${pick(pages)}|\n|環境|${pick(devices)}|\n|再現率|${pick(["100%", "たまに発生", "初回表示のみ"])}|\n\n関連: ${PROJECT_KEY}-${int(1, 60)}`,
  (s) =>
    `${s}という指摘をいただきました。\n\n1. 該当箇所を特定する\n2. 影響範囲を洗い出す\n3. 修正して確認する\n\n詳細は Wiki の「開発ガイド」を参照。`,
  (s) =>
    `${s}。\n\n${pick(devices)} で確認したところ、レイアウトが崩れていました。\n\n{quote}\n${pick(pages)}をスマートフォンで開くと、文字が重なって読めません。\n{/quote}`,
  (s) =>
    `${s}。\n\n再現手順:\n\n1. ${pick(pages)}を開く\n2. 画面幅を ${pick([320, 375, 414, 768])}px まで狭める\n3. 表示が崩れる\n\n@${names()} さん、確認をお願いします。`,
  (s) =>
    `${s}。\n\n作業メモ:\n\n{code}\nnpm ci\nnpm run build\nnpm run start\n{/code}\n\nビルド結果に差分が出ないことを確認してから反映します。`,
  (s) =>
    `${s}。\n\n* 背景\n${pick(pages)}の改修にあわせて発生した課題です。\n\n* 方針\n影響が小さいので、''先に修正して後から共有''します。`,
  (s) =>
    `${s}。\n\n計測結果:\n\n|指標|変更前|変更後|h\n|表示までの時間|${(rnd() * 2 + 1.5).toFixed(1)}s|${(rnd() * 1 + 0.6).toFixed(1)}s|\n|画像の合計サイズ|${int(800, 2400)}KB|${int(120, 600)}KB|`,
  (s) =>
    `${s}。\n\n仕様の確認が必要なため、いったん保留にしています。判断が出たら着手します。\n\n- 確認先: ${pick(pages)}の担当\n- 期限: 未定`,
];

const commentTemplates = [
  () =>
    `確認しました。修正して push しています。${pick(pages)}で見え方を確認してください。`,
  () =>
    `こちらの環境（${pick(devices)}）では再現しませんでした。使っている端末を教えていただけますか。`,
  () => `対応方針を変更します。レスポンシブの指定を見直したほうが早そうです。`,
  () => `ステージングに反映しました。${pick(pages)}の確認をお願いします。`,
  () => `ありがとうございます。${pick(devices)} で表示が直っていました。`,
  () => `デザイン側の確認が必要なので、いったん保留にします。`,
  () => `${PROJECT_KEY}-${int(1, 60)} と同じ原因でした。合わせて対応します。`,
  () => `文言を修正しました。細かい表記は校正で拾ってもらう想定です。`,
  () =>
    `検索したところ、同じ書き方が他に ${int(2, 8)} 箇所ありました。まとめて直します。`,
  () => `リリース後に様子を見て、問題なければクローズします。`,
  () => `実装方針の相談です。@${names()} さん、見ていただけますか。`,
  () => `ログインが必要なページでも同じ現象が出ています。`,
  () =>
    `画像を軽量化したところ、表示までの時間が ${(rnd() * 1.5 + 0.5).toFixed(1)} 秒ほど短くなりました。`,
  () => `仕様のため対応しない方針になりました。理由を Wiki に追記しています。`,
  () =>
    `手順をまとめました。\n{code}\ngit switch -c fix/layout\nnpm run lint\n{/code}`,
  () => `${pick(devices)} で確認しました。問題ありません。`,
  () => `対応済みです。差分は小さいので、レビューは軽めで大丈夫です。`,
  () => `想定より影響範囲が広かったので、${pick(pages)}は次の対応に回します。`,
  () => `原因が分かりました。読み込み順の問題でした。`,
  () => `${int(2, 5)} 箇所を直して確認できました。残りは別課題に切り出します。`,
  () => `いったん元の状態に戻しました。改めて方針を決めてから進めます。`,
  () =>
    `表示崩れは直りましたが、${pick(pages)}で余白が広くなっています。調整します。`,
  () => `確認ありがとうございます。クローズします。`,
  () => `優先度を下げます。公開後に改めて検討しましょう。`,
  () => `@${names()} さんの指摘どおり、指定が重複していました。整理しました。`,
  () =>
    `{quote}\n${pick(pages)}だけ直っていないようです。\n{/quote}\n見落としていました。修正します。`,
  () =>
    `画面幅 ${pick([320, 375, 414, 768])}px でも崩れないことを確認しました。`,
  () =>
    `検証用に環境を用意しました。手順は Wiki の「リリース手順」にあります。`,
  () => `再現しました。${pick(devices)} 固有の挙動のようです。`,
  () => `別の課題として切り出しました。こちらはクローズします。`,
];

/**
 * 1 件目の課題に入れる本文。Backlog 記法をひととおり含めて、記法レンダリングが
 * どう見えるかを 1 ページで確認できるようにする。
 */
const SHOWCASE_DESCRIPTION = [
  "* 概要",
  "トップページのファーストビューを差し替えます。あわせて画像の書き出し設定も見直します。",
  "",
  "** 対象ページ",
  "- トップページ",
  "- サービス紹介ページ",
  "-- 下層のタブも含む",
  "",
  "** チェックリスト",
  "- [x] デザインカンプの受領",
  "- [ ] 画像の書き出し",
  "- [ ] 実装",
  "- [ ] 表示確認",
  "",
  "** 対応環境",
  "|端末|ブラウザ|状態|h",
  "|iPhone 15|iOS Safari|確認済み|",
  "|Pixel 8|Android Chrome|未確認|",
  "|Windows 11|Chrome|確認済み|",
  "",
  "** 差し替え手順",
  "{code}",
  "npm ci",
  "npm run build",
  "npm run start",
  "{/code}",
  "",
  "** 依頼元のコメント",
  "{quote}",
  "写真の主題が中央からずれて見えるので、トリミングを調整してほしいです。",
  "{/quote}",
  "",
  "'' 太字の指定 '' と、取り消し線の %%古い指定%% も使えます。",
  "",
  "関連する課題は SAMPLE-4 と SAMPLE-15 です。担当は @山田 太郎 さんです。",
].join("\n");

const iso = (y, m, d, h, mi) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00Z`;

// --- 課題・コメントを生成 ---
const rawIssues = [];
const rawComments = [];
let commentId = 500000;

summaries.forEach((summary, i) => {
  const keyId = i + 1;
  const createdUser = anyUser();
  const status = pick(statuses);
  const month = int(4, 9);
  const day = int(1, 27);
  const created = iso(2026, month, day, int(9, 18), int(0, 59));
  const updated = iso(
    2026,
    month,
    Math.min(day + int(0, 3), 28),
    int(9, 18),
    int(0, 59),
  );
  const isClosed = status.id === 4;

  rawIssues.push({
    id: 900000 + keyId,
    projectId: PROJECT_ID,
    issueKey: `${PROJECT_KEY}-${keyId}`,
    keyId,
    issueType: pick(issueTypes),
    summary,
    // 1 件目は Backlog 記法を一通り含める（記法レンダリングをすぐ確認できるように）
    description:
      keyId === 1 ? SHOWCASE_DESCRIPTION : pick(descTemplates)(summary),
    resolution: isClosed ? pick(resolutions) : null,
    priority: pick(priorities),
    status,
    assignee: rnd() < 0.8 ? anyUser() : null,
    category: rnd() < 0.7 ? [pick(categories)] : [],
    versions: rnd() < 0.5 ? [pick(versions)] : [],
    milestone: rnd() < 0.5 ? [pick(versions)] : [],
    startDate: rnd() < 0.4 ? created : null,
    dueDate: rnd() < 0.5 ? iso(2026, Math.min(month + 1, 12), day, 0, 0) : null,
    estimatedHours: rnd() < 0.3 ? int(1, 16) : null,
    actualHours: rnd() < 0.2 ? int(1, 20) : null,
    parentIssueId: null,
    createdUser,
    created,
    updatedUser: anyUser(),
    updated,
    customFields: [],
    // 添付バイナリを同梱しないので、添付メタも空にする（DL できないものを見せない）
    attachments: [],
    sharedFiles: [],
    externalFileLinks: [],
    stars: [],
  });

  // コメント（一部は本文なしの変更履歴のみ = 正規化の境界を含める）
  // 先頭の数件は必ずコメントを付ける（記事のスクリーンショットや最初に開く課題が
  // 「コメントなし」だとデモとして弱いため）。テンプレートは 1 課題内で重複させない。
  const n = keyId <= 5 ? int(4, 7) : int(0, 7);
  const bag = shuffled(commentTemplates);
  for (let c = 0; c < n; c++) {
    const changeOnly = rnd() < 0.15;
    rawComments.push({
      id: ++commentId,
      projectId: PROJECT_ID,
      issueId: 900000 + keyId,
      content: changeOnly ? null : bag[c % bag.length](),
      changeLog: changeOnly
        ? [
            {
              field: "status",
              newValue: pick(statuses).name,
              originalValue: "未対応",
              attachmentInfo: null,
              attributeInfo: null,
              notificationInfo: null,
            },
          ]
        : null,
      createdUser: anyUser(),
      created: iso(2026, month, Math.min(day + c, 28), int(9, 19), int(0, 59)),
      updated: iso(2026, month, Math.min(day + c, 28), int(9, 19), int(0, 59)),
      stars: [],
      notifications: [],
    });
  }
});

// --- Wiki ---
const rawWikis = [
  {
    name: "Home",
    content: `* ${PROJECT_KEY} プロジェクト\n\nこのプロジェクトは backlog-x のデモ用に作られた''架空''のプロジェクトです。実在の企業・人物とは関係ありません。\n\n- [[開発ガイド]]\n- [[リリース手順]]\n- [[用語集]]`,
  },
  {
    name: "開発ガイド",
    content: `* 開発環境\n\n{code}\nnpm ci\nnpm run dev\n{/code}\n\n* コーディング規約\n\n- インデントは半角スペース 2\n- コミットメッセージは日本語で書く\n- レスポンシブは 375px / 768px / 1280px で確認する\n\n* レビュー\n\nプルリクエストは必ず 1 人以上のレビューを通します。`,
  },
  {
    name: "リリース手順",
    content: `* 手順\n\n1. ステージングで確認する\n2. リリースノートを書く\n3. 本番へデプロイする\n4. 表示を確認する\n\n|環境|URL|h\n|ステージング|（省略）|\n|本番|（省略）|\n\n{quote}\n金曜日の夕方のリリースは避けること。\n{/quote}`,
  },
  {
    name: "用語集",
    content: `|用語|意味|h\n|FV|ファーストビュー。ページを開いて最初に見える範囲|\n|カンプ|デザインの完成見本|\n|LCP|表示速度の指標のひとつ|`,
  },
  {
    name: "議事録/2026-06-15 定例",
    content: `* 参加者\n\n- 山田 太郎\n- 鈴木 花子\n- 佐藤 次郎\n\n* 決定事項\n\n- 公開日は 6/30 を目標にする\n- 多言語対応は次のフェーズに回す\n\n* 次回までの宿題\n\n@佐藤 次郎 さん: 表示速度の計測結果をまとめる（${PROJECT_KEY}-31）`,
  },
  { name: "空ページの例", content: null },
].map((w, i) => ({
  id: 700000 + i,
  projectId: PROJECT_ID,
  name: w.name,
  content: w.content,
  tags: [],
  attachments: [],
  sharedFiles: [],
  stars: [],
  createdUser: users[0],
  created: iso(2026, 4, 2 + i, 10, 0),
  updatedUser: users[1],
  updated: iso(2026, 7, 10 + i, 15, 30),
}));

// --- ドキュメント（本文は標準 Markdown） ---
const rawDocuments = [
  {
    id: "d0000000000000000000000000000001",
    projectId: PROJECT_ID,
    title: "サイト構成案",
    plain:
      "# サイト構成案\n\n## 全体構成\n\n- トップ\n- 会社概要\n- サービス紹介\n- 実績紹介\n- 採用情報\n- お問い合わせ\n\n## 方針\n\nスマートフォンからの閲覧が中心なので、レスポンシブを前提に設計する。\n表示速度を優先し、画像は WebP に変換して配信する。",
    json: null,
    emoji: "🗂",
    statusId: null,
    tags: [],
    childDocumentIds: ["d0000000000000000000000000000002"],
    attachments: [],
    createdUser: users[1],
    created: iso(2026, 4, 5, 11, 20),
    updatedUser: users[1],
    updated: iso(2026, 5, 20, 16, 45),
  },
  {
    id: "d0000000000000000000000000000002",
    projectId: PROJECT_ID,
    title: "お問い合わせフォームの仕様",
    plain:
      "# お問い合わせフォームの仕様\n\n## 入力項目\n\n| 項目 | 必須 | 備考 |\n|------|------|------|\n| お名前 | ○ | |\n| メールアドレス | ○ | 形式チェックあり |\n| 種別 | ○ | プルダウン |\n| 本文 | ○ | 2000 文字まで |\n\n## 送信後\n\n確認画面を経由して送信し、完了ページへ遷移する。自動返信メールを送る。",
    json: null,
    emoji: "📝",
    statusId: null,
    tags: [],
    childDocumentIds: [],
    attachments: [],
    createdUser: users[2],
    created: iso(2026, 4, 12, 9, 5),
    updatedUser: users[0],
    updated: iso(2026, 6, 1, 13, 10),
  },
];

// --- ダンプ本体 ---
const dump = {
  format: "backlog-x-raw-dump",
  version: 2,
  dumpedAt: new Date("2026-09-07T00:00:00Z").toISOString(),
  spaceUrl: SPACE_URL,
  project: {
    id: PROJECT_ID,
    projectKey: PROJECT_KEY,
    name: "サンプルプロジェクト（デモ用）",
    chartEnabled: true,
    subtaskingEnabled: false,
    projectLeaderCanEditProjectLeader: false,
    textFormattingRule: "backlog",
    archived: false,
    displayOrder: 0,
  },
  selection: {
    issues: true,
    comments: true,
    // 添付バイナリは同梱しない（zip を配らないため）
    attachments: false,
    wikis: true,
    documents: true,
  },
  masters: {
    statuses,
    issueTypes,
    categories,
    versions,
    priorities,
    resolutions,
  },
  rawIssues,
  rawComments,
  rawWikis,
  rawDocuments,
  members: rawUsers.map((u) => ({
    projectId: PROJECT_ID,
    userId: u.id,
    roleType: u.roleType,
  })),
  memberUsers: rawUsers.map((u) => ({
    id: u.id,
    name: u.name,
    userId: u.userId,
    mailAddress: `${u.userId}@example.com`,
  })),
  // アイコン画像は同梱しない（イニシャル表示になる）
  userIcons: [],
  projectIcon: null,
};

const json = JSON.stringify(dump);
const gz = gzipSync(Buffer.from(json, "utf8"), { level: 9 });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, gz);

console.log(
  [
    `出力: ${OUT}`,
    `課題: ${rawIssues.length} 件`,
    `コメント: ${rawComments.length} 件`,
    `Wiki: ${rawWikis.length} 件`,
    `ドキュメント: ${rawDocuments.length} 件`,
    `JSON: ${(json.length / 1024).toFixed(1)} KB → gzip: ${(gz.length / 1024).toFixed(1)} KB`,
  ].join("\n"),
);
