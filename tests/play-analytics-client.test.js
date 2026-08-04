import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../assets/play-analytics.js", import.meta.url), "utf8");

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function clientContext({ page = "game", search = "?analytics_test=1", fetchFails = false, local = storage() } = {}) {
  let now = 0;
  const documentListeners = new Map();
  const windowListeners = new Map();
  const requests = [];
  const document = {
    currentScript: { dataset: { page } },
    readyState: "complete",
    visibilityState: "visible",
    addEventListener(name, handler) { documentListeners.set(name, handler); },
    getElementById() { return null; },
  };
  const window = {
    addEventListener(name, handler) { windowListeners.set(name, handler); },
  };
  const context = {
    window,
    document,
    location: { search, hostname: "example.com" },
    navigator: { webdriver: false },
    sessionStorage: storage(),
    localStorage: local,
    crypto: webcrypto,
    URLSearchParams,
    Blob,
    performance: { now: () => now },
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      if (fetchFails) throw new Error("offline");
      return new Response(null, { status: 204 });
    },
    Response,
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  };
  window.window = window;
  Object.assign(window, context);
  vm.runInNewContext(source, context);
  return {
    analytics: window.KurumaAnalytics,
    document,
    documentListeners,
    windowListeners,
    requests,
    advance(ms) { now += ms; },
  };
}

test("game_started前とvisibility hidden中を表示時間へ加算しない", () => {
  const client = clientContext();
  client.advance(5000);
  client.analytics.flush();
  assert.equal(client.analytics.snapshot().visible_play_ms, 0);

  client.analytics.gameStarted();
  client.advance(4000);
  client.analytics.flush();
  assert.equal(client.analytics.snapshot().visible_play_ms, 4000);

  client.document.visibilityState = "hidden";
  client.documentListeners.get("visibilitychange")();
  client.advance(10000);
  client.analytics.flush();
  assert.equal(client.analytics.snapshot().visible_play_ms, 4000);
});

test("最初の選択、正誤累計、操作間隔、完了問題を記録する", () => {
  const client = clientContext();
  client.analytics.gameStarted();
  client.advance(1000);
  client.analytics.choiceTapped({ result: "wrong" });
  client.advance(2500);
  client.analytics.choiceTapped({ result: "correct" });
  client.analytics.roundCompleted();
  const state = client.analytics.snapshot();
  assert.equal(state.first_choice_tapped, true);
  assert.equal(state.wrong_tap_count, 1);
  assert.equal(state.correct_tap_count, 1);
  assert.equal(state.interaction_span_ms, 2500);
  assert.equal(state.completed_round_count, 1);
  assert.equal(state.is_test, true);
});

test("初回利用と再利用を端末内の日付だけから分類する", () => {
  const local = storage();
  const first = clientContext({ search: "", local });
  first.analytics.gameStarted();
  assert.equal(first.analytics.snapshot().return_status, "first_time");
  assert.equal(first.analytics.snapshot().return_interval_bucket, "first_time");

  const second = clientContext({ search: "", local });
  second.analytics.gameStarted();
  assert.equal(second.analytics.snapshot().return_status, "returning");
  assert.equal(second.analytics.snapshot().return_interval_bucket, "same_day");
});

test("計測送信が失敗してもゲーム側のフックは例外を出さない", () => {
  const client = clientContext({ fetchFails: true });
  client.analytics.gameStarted();
  assert.doesNotThrow(() => {
    client.analytics.choiceTapped({ result: "wrong" });
    client.analytics.roundCompleted();
    client.analytics.rareShown();
  });
});
