# 既存サイトへの接続手順

「くるまどれかな?」の既存 Cloudflare Pages サイトへ、このバックエンドを
組み込む手順。**このキット自体は既存サイトへ接続しない**。以下はすべて、
接続を実施する担当者が既存サイト側のリポジトリ・Cloudflare アカウントで行う作業。

前提: 既存サイトが Cloudflare Pages でデプロイされていること。
API とフォームが同一オリジンになるため、CORS 設定は不要。

## 1. ファイルの配置

既存サイトのリポジトリのルート(Pages のビルド出力ではなくプロジェクトルート)へ、
このキットの `functions/` をそのままコピーする。

```
既存サイト/
├── (既存の HTML / CSS / JS はそのまま)
└── functions/
    └── api/
        └── feedback.js   ← このキットからコピー
```

これだけで `POST /api/feedback` がルーティングされる。既存の HTML・CSS・JS の
編集は不要。

## 2. D1 データベースの作成とマイグレーション

```sh
# データベース作成(名前は例)
npx wrangler d1 create kuruma-feedback

# テーブル作成(本番)
npx wrangler d1 execute kuruma-feedback --remote \
  --file=migrations/0001_create_feedback.sql
```

## 3. D1 バインディングの設定

Pages プロジェクトに、**バインディング名 `DB`** で作成した D1 を紐付ける
(コードは `env.DB` を参照するため、名前は必ず `DB` にする)。

- ダッシュボード: Pages プロジェクト → Settings → Bindings → D1 database →
  Variable name に `DB`、対象に `kuruma-feedback` を指定
- または既存サイトの `wrangler.toml` に追記:

```toml
[[d1_databases]]
binding = "DB"
database_name = "kuruma-feedback"
database_id = "<wrangler d1 create の出力に表示された ID>"
```

`database_id` は秘密情報ではないが、コードへの直書きは不要(設定ファイル/
ダッシュボードのみで完結する)。

## 4. 既存フォームからの送信コード

既存の感想フォームの送信処理から `fetch` で POST する。追加するスニペットの例
(フィールドの値の組み立ては既存フォームの実装に合わせること):

```js
const SENT_KEY = "kuruma_feedback_sent";

async function sendFeedback(payload, submitButton) {
  // 二重送信対策 1: 送信済みなら送らない
  if (localStorage.getItem(SENT_KEY)) {
    return { alreadySent: true };
  }
  // 二重送信対策 2: 送信中はボタンを無効化
  submitButton.disabled = true;
  try {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (res.ok && result.ok) {
      localStorage.setItem(SENT_KEY, "1");
    }
    return result;
  } finally {
    submitButton.disabled = false;
  }
}
```

`payload` は [API_CONTRACT.md](API_CONTRACT.md) の5フィールドのみで構成する。
未回答の任意項目はキー自体を含めない(`null` を送ると 400 になる)。

推奨: フォームの自由記入欄の近くに
「個人情報(お名前・ご連絡先など)は記入しないでください」の注意書きを表示する。

## 5. レート制限(推奨・Cloudflare ダッシュボードでの作業)

サーバーコード側にはレート制限を実装していない。本格的な連続送信対策は
Cloudflare の WAF レート制限ルールで行うことを推奨する:

1. ダッシュボード → 対象ゾーン → Security → WAF → Rate limiting rules
2. ルール例:
   - 対象: `URI Path equals /api/feedback` かつ `Method equals POST`
   - しきい値: 同一 IP から 1分間に 5 リクエスト
   - アクション: Block(期間 1分)

IP の評価は Cloudflare 基盤側で行われ、このキットが IP を D1 へ保存することはない。

## 6. 動作確認(ローカル)

既存サイトのリポジトリで:

```sh
# ローカルD1へテーブル作成
npx wrangler d1 execute kuruma-feedback --local \
  --file=migrations/0001_create_feedback.sql

# ローカル起動(静的ファイルのディレクトリは既存サイトに合わせる)
npx wrangler pages dev . --d1 DB=kuruma-feedback
```

curl での確認例:

```sh
# 201 成功
curl -i -X POST http://localhost:8788/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"independence":"some_help","replay_interest":"yes","help_areas":["tapping"]}'

# 405
curl -i http://localhost:8788/api/feedback

# 415
curl -i -X POST http://localhost:8788/api/feedback \
  -H "Content-Type: text/plain" -d '{}'

# 400(未知フィールド)
curl -i -X POST http://localhost:8788/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"independence":"some_help","replay_interest":"yes","name":"たろう"}'
```

保存内容の確認(UA・IP に相当する値が無いことも見る):

```sh
npx wrangler d1 execute kuruma-feedback --local \
  --command "SELECT * FROM feedback;"
```

## 7. デプロイ

`functions/` を含めて既存サイトを通常どおりデプロイする(Pages の Git 連携なら
push、直接なら `npx wrangler pages deploy`)。デプロイ後、本番 URL に対して
手順6と同じ curl 確認を行う。
