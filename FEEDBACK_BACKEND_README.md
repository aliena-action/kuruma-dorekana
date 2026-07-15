# 感想送信バックエンド・キット

幼児向けWebゲーム「くるまどれかな?」の保護者向け感想フォーム用バックエンド。
Cloudflare Pages Functions で受信・検証し、Cloudflare D1 へ保存する。

既存ゲーム本体とは独立したキットであり、フォームUIは含まない
(既存サイトのフォームから接続する。手順は [INTEGRATION.md](INTEGRATION.md))。

## 構成

```
kuruma-feedback-kit/
├── functions/
│   └── api/
│       └── feedback.js              # POST /api/feedback(検証+D1保存)
├── migrations/
│   └── 0001_create_feedback.sql     # feedback テーブル作成
├── tests/
│   └── feedback.test.js             # node:test による単体テスト
├── API_CONTRACT.md                  # API 入出力仕様
├── INTEGRATION.md                   # 既存サイトへの接続手順
├── PRIVACY_DATA_MAP.md              # 保存する/しないデータの一覧
└── README.md
```

外部依存パッケージなし(`package.json` も不要)。秘密鍵・APIキーは使用しない。

## 主な仕様

- `POST /api/feedback` のみ受け付け(他メソッドは 405、Content-Type 不正は 415)
- 受理フィールドは `independence`(必須)/ `replay_interest`(必須)/
  `age_group` / `help_areas`(複数選択の文字列配列)/ `comment`(最大300文字)の5つだけ
- 未知フィールドは例外なく 400 で拒否
- `submitted_at` はクライアントから受け取らず、D1 の列デフォルトで UTC 自動記録
- D1 への書き込みは `prepare().bind()` のプレースホルダのみ(SQLインジェクション対策)
- 名前・連絡先・User-Agent・IP アドレスは保存しない(詳細は
  [PRIVACY_DATA_MAP.md](PRIVACY_DATA_MAP.md))

## 許可値の管理

選択式4項目の許可値は [functions/api/feedback.js](functions/api/feedback.js) 冒頭の
`ALLOWED_VALUES` で一元管理している。テストもこのオブジェクトを参照する。

**同期が必要な箇所**: `ALLOWED_VALUES` を変更したら、
[migrations/0001_create_feedback.sql](migrations/0001_create_feedback.sql) の
CHECK 制約も必ず合わせて変更すること(`help_areas` のみ SQL 側に CHECK が無く、
API 側だけで検証する)。ドキュメント(API_CONTRACT.md)の許可値表も更新する。

## テスト

Node.js 20.19 以降または 22.7 以降(`package.json` なしで ES モジュール構文を
自動判定できるバージョン)で:

```sh
node --test tests/
```

外部テストライブラリは使用しない(`node:test` と `node:assert/strict` のみ)。
D1 はモックし、バリデーションと HTTP ハンドラの振る舞いを検証する。

実際の Cloudflare 環境での結合確認(`wrangler pages dev` + curl)の手順は
[INTEGRATION.md](INTEGRATION.md) の手順6を参照。

## デプロイ

既存 Pages サイトへ `functions/` をコピーし、D1 作成・バインディング設定・
マイグレーション適用を行う。全手順は [INTEGRATION.md](INTEGRATION.md) を参照。
このキット自体はデプロイや外部接続を行わない。
