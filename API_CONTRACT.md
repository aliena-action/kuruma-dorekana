# API仕様 — 感想送信エンドポイント

「くるまどれかな?」保護者向け感想フォームのバックエンドAPI仕様。

## エンドポイント

```
POST /api/feedback
Content-Type: application/json
```

- **POST 以外のメソッドは 405** を返す
- **`Content-Type: application/json` 以外は 415** を返す(`; charset=utf-8` 付きは可)
- **リクエストボディは最大 4KB**(超過は 400)

## リクエストフィールド

受理するフィールドは以下の**5つだけ**。これ以外のキーが1つでも含まれる場合、
リクエスト全体を 400 で拒否する(`submitted_at` や旧仕様の `help_area`(単数形)も同様)。

| フィールド | 必須 | 型 | 内容 |
|---|---|---|---|
| `independence` | 必須 | string | 子どもがどの程度ひとりで遊べたか |
| `replay_interest` | 必須 | string | また遊びたそうだったか |
| `age_group` | 任意 | string | 年齢区分 |
| `help_areas` | 任意 | string[] | 保護者が手伝った部分(複数選択) |
| `comment` | 任意 | string | 自由記入(最大300文字) |

**任意項目の未回答は、フィールド自体を省略する**(`null` や空文字を送ると 400。
例外として `help_areas` の空配列 `[]` は未回答として受理する)。

### 許可値

内部値と日本語表示文の対応。内部値の正本はコード側の
[`ALLOWED_VALUES`](functions/api/feedback.js) にある。

#### `independence`(必須)

| 内部値 | 表示文 |
|---|---|
| `independent` | ひとりで遊べた |
| `some_help` | 少し手伝った |
| `much_help` | かなり手伝った |

#### `replay_interest`(必須)

| 内部値 | 表示文 |
|---|---|
| `yes` | はい |
| `unsure` | どちらともいえない |
| `no` | いいえ |

#### `age_group`(任意)

| 内部値 | 表示文 |
|---|---|
| `age_2_3` | 2〜3歳 |
| `age_4_5` | 4〜5歳 |
| `age_6_plus` | 6歳以上 |

#### `help_areas`(任意・複数選択)

| 内部値 | 表示文 |
|---|---|
| `getting_started` | 始め方 |
| `finding_same_car` | 同じ車を見つける |
| `tapping` | タップ操作 |
| `waiting` | 待ち時間 |
| `other` | その他 |

`help_areas` のバリデーション規則:

- 配列以外は 400
- 最大5件(6件以上は 400)
- 各要素は上記許可値の文字列に完全一致(それ以外は 400)
- 同じ値の重複は 400
- 並び順に意味はない(送信順のまま保存される)

### `comment` の扱い

- 文字列以外は 400
- 前後の空白は除去(トリム)
- 改行・復帰・タブ以外の制御文字は除去
- 除去・トリム後に**300文字**(コードポイント単位)を超える場合は 400
- トリム後に空になった場合は未回答(null)として扱う

### `submitted_at` について

送信日時はクライアントから**一切受け取らない**。D1 側の列デフォルト
(`strftime('%Y-%m-%dT%H:%M:%fZ','now')`)で UTC の ISO 8601 形式が自動記録される。
クライアントが `submitted_at` を送った場合は未知フィールドとして 400 になる。

## リクエスト例

```json
{
  "independence": "some_help",
  "replay_interest": "yes",
  "age_group": "age_4_5",
  "help_areas": ["getting_started", "tapping"],
  "comment": "楽しんでいました"
}
```

最小(必須のみ):

```json
{
  "independence": "independent",
  "replay_interest": "yes"
}
```

## レスポンス仕様

すべて JSON(`Content-Type: application/json; charset=utf-8`)。

| 状況 | ステータス | ボディ |
|---|---|---|
| 成功 | 201 | `{"ok":true}` |
| POST 以外 | 405 | `{"ok":false,"error":"method_not_allowed"}`(`Allow: POST` ヘッダー付き) |
| Content-Type 不正 | 415 | `{"ok":false,"error":"unsupported_content_type"}` |
| 入力エラー | 400 | `{"ok":false,"error":"validation_failed","fields":["independence"]}` |
| D1 障害等 | 500 | `{"ok":false,"error":"server_error"}` |

- 400 の `fields` は問題のあったフィールド名の配列。未知フィールドの場合はそのキー名、
  ボディ全体の問題(JSON 解析失敗・サイズ超過・オブジェクト以外)の場合は `["body"]`
- 送信された値そのものはレスポンスにエコーバックしない
- 500 の内部エラー詳細はレスポンスに含めない(サーバーログのみ)
- 成功時に挿入行の ID は返さない
