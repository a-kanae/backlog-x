@AGENTS.md

# backlog-x 開発ルール

backlog-x は **Backlog のアーカイブビューア（読み取り専用・純クライアント・OSS）**。
プロダクトの全体像・アーキテクチャ・使い方は [README.md](README.md) を参照。

## このプロジェクトの鉄則

1. **読み取り専用**: Backlog データへの書き込み（課題／コメントの作成・編集・削除）は実装しない。アーカイブの正確性（投稿者名義・日時の改変なし）を壊さないこと。`createdUser` / `created` / `updated` は必ず保持する。
2. **公式 API 経由のみ**: データ取得は公式 Backlog API だけ。スクレイピング／クローリングはしない。レート制限は適応スロットリングで遵守する（`src/lib/backlog-api/client.ts`）。
3. **データを外部に出さない（最重要）**: backlog-x の存在意義は「利用者のデータが利用者の手元から出ない」こと。**次の変更は、たとえ利便性が上がっても入れない。**
   - アクセス解析・エラー収集・テレメトリ（Google Analytics / Sentry / PostHog 等）の導入
   - Backlog 以外の外部ホストへの通信（CDN からのフォント・スクリプト読み込みを含む）
   - API キー・課題データ・検索クエリをサーバーへ送る処理
   - この制約は `firebase.json` の CSP（`connect-src` を self と Backlog ドメインに限定）で技術的にも担保している。**外部ホストが必要になったら、まず「本当に必要か」を疑う**。CSP を緩めるのは README の安全性の説明を弱めることと同義。
4. **API キーを永続化しない**: キーはメモリ上に留める。URL クエリに載るため、ログ・例外メッセージに含めないこと。
5. **汎用設計**: 特定のスペース／プロジェクトをハードコードしない。コメントや UI の例示には架空のキー（`PROJ` 等）とドメイン（`example.backlog.jp`）を使う。実在の組織名・プロジェクトキーを書かない。
6. **README は利用者向けの正本**: 機能を追加・変更したら README の該当箇所（特に「送信しないもの／送信されるもの」「できること／できないこと」）を必ず更新する。実装と説明が食い違うと、このツールの信頼性そのものが崩れる。

## 機微ファイル（絶対にコミットしない）

`.gitignore` で除外済み。コード・ログ・コミットに混入させない。

- Backlog API キー（`backlog_api_key` 等）
- Firebase サービスアカウント / Admin SDK 鍵（`*serviceAccount*.json`, `firebase-adminsdk-*.json`, `*-key.json`）
- `tmp/` 配下（作業用一時ファイル・取得した実データ）
- 取り込んだ課題・コメントの実データ（`public/` に置かない）

## TypeScript コーディングルール

- **`any` / `unknown` の使用は原則禁止**。外部 API・グローバルオブジェクトで型が曖昧な場合は、Backlog API レスポンスのインターフェース等を自前で具体的に定義する（`src/types/backlog.ts`）。
- 厳格な型付けを維持する（課題／コメント／ユーザー／添付メタはすべて型を定義して扱う）。

## データの流れ（境界を壊さないための地図）

```
Backlog API → src/lib/backlog-api/  (取得・レート制限)
            → src/lib/ingest/       (正規化・保存・エクスポート)
            → IndexedDB / OPFS      (src/lib/db, src/lib/storage)
            → src/lib/datasource/   (ビューア層への境界)
            → src/components/       (UI)
```

- ビューア層は `src/types/backlog.ts`（API レスポンス型）を直接参照しない。境界は `datasource`。
- 検索索引の構築は Web Worker で行う（`src/lib/search/`）。UI を固めないため。

## Next.js について

このリポジトリの Next.js は**訓練データと異なる破壊的変更を含むバージョン**。
**コードを書く前に `node_modules/next/dist/docs/` の該当ガイドを必ず読む**（冒頭 `@AGENTS.md` の指示）。記憶ベースで書かない。

静的エクスポート（`output: 'export'`）との両立には固有の制約がある。詳細は [README.md の「動的ルートについて」](README.md#動的ルートについてホスティング選択の注意)。

- 動的ルートの `page.tsx` はサーバーコンポーネントの薄いラッパーにし、`generateStaticParams` でプレースホルダを返す（`'use client'` から `generateStaticParams` は export できない）。
- クライアント側では `useParams()` を使わず `usePathname()` から実 URL を自前パースする（`src/lib/routing/params.ts`）。
