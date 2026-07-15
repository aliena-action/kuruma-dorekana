// node:test のみ使用(外部テストライブラリなし)
// 実行: node --test tests/
// 要件: Node.js 20.19+ / 22.7+(package.json なしで ES モジュール構文を自動判定するため)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_VALUES,
  COMMENT_MAX_LENGTH,
  MAX_HELP_AREAS,
  validateFeedback,
  onRequest,
} from "../functions/api/feedback.js";

function validBody(overrides = {}) {
  return {
    independence: "some_help",
    replay_interest: "yes",
    age_group: "age_4_5",
    help_areas: ["getting_started", "tapping"],
    comment: "楽しんでいました",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateFeedback: 正常系
// ---------------------------------------------------------------------------

test("全項目ありの正常な入力を受理する", () => {
  const result = validateFeedback(validBody());
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    independence: "some_help",
    replay_interest: "yes",
    age_group: "age_4_5",
    help_areas: ["getting_started", "tapping"],
    comment: "楽しんでいました",
  });
});

test("必須2項目のみでも受理し、任意項目は null になる", () => {
  const result = validateFeedback({ independence: "independent", replay_interest: "no" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    independence: "independent",
    replay_interest: "no",
    age_group: null,
    help_areas: null,
    comment: null,
  });
});

test("すべての許可値の組み合わせを受理する(必須2項目)", () => {
  for (const independence of ALLOWED_VALUES.independence) {
    for (const replay_interest of ALLOWED_VALUES.replay_interest) {
      const result = validateFeedback({ independence, replay_interest });
      assert.equal(result.ok, true, `${independence} / ${replay_interest}`);
    }
  }
});

test("age_group はすべての許可値を受理する", () => {
  for (const age_group of ALLOWED_VALUES.age_group) {
    const result = validateFeedback(validBody({ age_group }));
    assert.equal(result.ok, true, age_group);
    assert.equal(result.data.age_group, age_group);
  }
});

// ---------------------------------------------------------------------------
// validateFeedback: ボディ全体・未知フィールド
// ---------------------------------------------------------------------------

test("オブジェクト以外のボディは拒否する", () => {
  for (const body of [null, [], "text", 42, true]) {
    const result = validateFeedback(body);
    assert.equal(result.ok, false);
    assert.deepEqual(result.fields, ["body"]);
  }
});

test("未知フィールドは拒否し、フィールド名を返す", () => {
  const result = validateFeedback(validBody({ name: "たろう", email: "a@example.com" }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.fields.sort(), ["email", "name"]);
});

test("submitted_at をクライアントが送った場合は未知フィールドとして拒否する", () => {
  const result = validateFeedback(validBody({ submitted_at: "2026-07-15T00:00:00Z" }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.fields, ["submitted_at"]);
});

test("旧仕様の単数形 help_area は未知フィールドとして拒否する", () => {
  const body = validBody();
  delete body.help_areas;
  body.help_area = "tapping";
  const result = validateFeedback(body);
  assert.equal(result.ok, false);
  assert.deepEqual(result.fields, ["help_area"]);
});

// ---------------------------------------------------------------------------
// validateFeedback: 必須項目
// ---------------------------------------------------------------------------

test("independence 欠落は拒否する", () => {
  const body = validBody();
  delete body.independence;
  const result = validateFeedback(body);
  assert.equal(result.ok, false);
  assert.deepEqual(result.fields, ["independence"]);
});

test("replay_interest 欠落は拒否する", () => {
  const body = validBody();
  delete body.replay_interest;
  const result = validateFeedback(body);
  assert.equal(result.ok, false);
  assert.deepEqual(result.fields, ["replay_interest"]);
});

test("必須項目の許可値外・型違いは拒否する", () => {
  for (const bad of ["ひとりで", "INDEPENDENT", "", null, 1, ["independent"]]) {
    const result = validateFeedback(validBody({ independence: bad }));
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.deepEqual(result.fields, ["independence"]);
  }
  for (const bad of ["はい", "YES", "", null, true]) {
    const result = validateFeedback(validBody({ replay_interest: bad }));
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.deepEqual(result.fields, ["replay_interest"]);
  }
});

test("複数の入力エラーはまとめて報告する", () => {
  const result = validateFeedback({ independence: "bad", replay_interest: "bad" });
  assert.equal(result.ok, false);
  assert.deepEqual(result.fields.sort(), ["independence", "replay_interest"]);
});

// ---------------------------------------------------------------------------
// validateFeedback: age_group(任意)
// ---------------------------------------------------------------------------

test("age_group の許可値外・型違い・null は拒否する(未回答はフィールド省略)", () => {
  for (const bad of ["age_0_1", "2〜3歳", "", null, 3]) {
    const result = validateFeedback(validBody({ age_group: bad }));
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.deepEqual(result.fields, ["age_group"]);
  }
});

// ---------------------------------------------------------------------------
// validateFeedback: help_areas(任意・複数選択)
// ---------------------------------------------------------------------------

test("help_areas の空配列は未回答(null)として受理する", () => {
  const result = validateFeedback(validBody({ help_areas: [] }));
  assert.equal(result.ok, true);
  assert.equal(result.data.help_areas, null);
});

test("help_areas は許可値5件すべてを一度に受理する", () => {
  const all = [...ALLOWED_VALUES.help_areas];
  assert.equal(all.length, MAX_HELP_AREAS);
  const result = validateFeedback(validBody({ help_areas: all }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.help_areas, all);
});

test("help_areas の配列以外は拒否する", () => {
  for (const bad of ["tapping", { 0: "tapping" }, null, 1]) {
    const result = validateFeedback(validBody({ help_areas: bad }));
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.deepEqual(result.fields, ["help_areas"]);
  }
});

test("help_areas の6件以上は拒否する", () => {
  const six = [...ALLOWED_VALUES.help_areas, "getting_started"];
  assert.equal(six.length, MAX_HELP_AREAS + 1);
  const result = validateFeedback(validBody({ help_areas: six }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.fields, ["help_areas"]);
});

test("help_areas の重複は拒否する", () => {
  const result = validateFeedback(validBody({ help_areas: ["tapping", "tapping"] }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.fields, ["help_areas"]);
});

test("help_areas の許可値外・文字列以外の要素は拒否する", () => {
  for (const bad of [["cooking"], ["tapping", "TAPPING"], [1], [null], ["tapping", 2]]) {
    const result = validateFeedback(validBody({ help_areas: bad }));
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.deepEqual(result.fields, ["help_areas"]);
  }
});

// ---------------------------------------------------------------------------
// validateFeedback: comment(任意・最大300文字)
// ---------------------------------------------------------------------------

test("comment は300文字ちょうどを受理し、301文字を拒否する", () => {
  const ok300 = validateFeedback(validBody({ comment: "あ".repeat(COMMENT_MAX_LENGTH) }));
  assert.equal(ok300.ok, true);
  assert.equal(ok300.data.comment.length, COMMENT_MAX_LENGTH);

  const ng301 = validateFeedback(validBody({ comment: "あ".repeat(COMMENT_MAX_LENGTH + 1) }));
  assert.equal(ng301.ok, false);
  assert.deepEqual(ng301.fields, ["comment"]);
});

test("comment の文字列以外は拒否する", () => {
  for (const bad of [1, null, ["comment"], { text: "a" }]) {
    const result = validateFeedback(validBody({ comment: bad }));
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.deepEqual(result.fields, ["comment"]);
  }
});

test("comment の空文字・空白のみは未回答(null)として受理する", () => {
  for (const empty of ["", "   ", "\n\t "]) {
    const result = validateFeedback(validBody({ comment: empty }));
    assert.equal(result.ok, true, JSON.stringify(empty));
    assert.equal(result.data.comment, null);
  }
});

test("comment の改行・タブ以外の制御文字は除去する", () => {
  const result = validateFeedback(validBody({ comment: "a\u0000b\u001Fc\nd" }));
  assert.equal(result.ok, true);
  assert.equal(result.data.comment, "abc\nd");
});

// ---------------------------------------------------------------------------
// onRequest: HTTPハンドラ(D1はモック)
// ---------------------------------------------------------------------------

function mockEnv({ fail = false } = {}) {
  const calls = [];
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              async run() {
                if (fail) throw new Error("d1 unavailable");
                calls.push({ sql, values });
                return { success: true };
              },
            };
          },
        };
      },
    },
  };
  return { env, calls };
}

function postRequest(body, contentType = "application/json") {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("POST 以外は 405 を返す", async () => {
  const { env } = mockEnv();
  for (const method of ["GET", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH"]) {
    const request = new Request("http://localhost/api/feedback", { method });
    const res = await onRequest({ request, env });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("Allow"), "POST");
    if (method !== "HEAD") {
      assert.deepEqual(await res.json(), { ok: false, error: "method_not_allowed" });
    }
  }
});

test("Content-Type が application/json 以外は 415 を返す", async () => {
  const { env } = mockEnv();
  for (const contentType of ["text/plain", "application/x-www-form-urlencoded", ""]) {
    const res = await onRequest({ request: postRequest(validBody(), contentType), env });
    assert.equal(res.status, 415, contentType);
    assert.deepEqual(await res.json(), { ok: false, error: "unsupported_content_type" });
  }
});

test("Content-Type の charset 付きは受理する", async () => {
  const { env, calls } = mockEnv();
  const res = await onRequest({
    request: postRequest(validBody(), "application/json; charset=utf-8"),
    env,
  });
  assert.equal(res.status, 201);
  assert.equal(calls.length, 1);
});

test("壊れた JSON は 400 を返す", async () => {
  const { env, calls } = mockEnv();
  const res = await onRequest({ request: postRequest("{not json"), env });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, error: "validation_failed", fields: ["body"] });
  assert.equal(calls.length, 0);
});

test("4KB を超えるボディは 400 を返す", async () => {
  const { env, calls } = mockEnv();
  const res = await onRequest({
    request: postRequest(validBody({ comment: "a".repeat(5000) })),
    env,
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, error: "validation_failed", fields: ["body"] });
  assert.equal(calls.length, 0);
});

test("入力エラーは 400 と fields を返し、DB へは書き込まない", async () => {
  const { env, calls } = mockEnv();
  const res = await onRequest({ request: postRequest(validBody({ extra: 1 })), env });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, error: "validation_failed", fields: ["extra"] });
  assert.equal(calls.length, 0);
});

test("正常な POST は 201 を返し、プレースホルダで1行挿入する", async () => {
  const { env, calls } = mockEnv();
  const res = await onRequest({ request: postRequest(validBody()), env });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { ok: true });

  assert.equal(calls.length, 1);
  const { sql, values } = calls[0];
  assert.match(sql, /INSERT INTO feedback/);
  assert.match(sql, /\?1.*\?2.*\?3.*\?4.*\?5/s); // プレースホルダ使用(文字列連結でない)
  assert.ok(!sql.includes("submitted_at")); // 送信日時は D1 の DEFAULT に任せる
  assert.deepEqual(values, [
    "some_help",
    "yes",
    "age_4_5",
    '["getting_started","tapping"]', // JSON配列文字列として保存
    "楽しんでいました",
  ]);
});

test("任意項目省略時は null をバインドする", async () => {
  const { env, calls } = mockEnv();
  const res = await onRequest({
    request: postRequest({ independence: "much_help", replay_interest: "unsure" }),
    env,
  });
  assert.equal(res.status, 201);
  assert.deepEqual(calls[0].values, ["much_help", "unsure", null, null, null]);
});

test("D1 障害時は 500 を返し、詳細をレスポンスに含めない", async (t) => {
  t.mock.method(console, "error", () => {}); // エラーログ出力を抑止
  const { env } = mockEnv({ fail: true });
  const res = await onRequest({ request: postRequest(validBody()), env });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, error: "server_error" });
});
