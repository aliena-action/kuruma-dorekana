(() => {
  "use strict";

  const ENDPOINT = "/api/play-session";
  const SESSION_KEY = "kurumaAnonymousPlaySessionV1";
  const STARTED_KEY = "kurumaGameStartedBefore";
  const LAST_START_KEY = "kurumaLastGameStartDate";
  const CLIENT_VERSION = "analytics-v1";
  const SOURCE_CODES = new Set(["x", "instagram", "facebook", "card", "direct_share", "support"]);
  const script = document.currentScript;
  const page = script?.dataset.page === "support" ? "support" : "game";
  const params = new URLSearchParams(location.search);
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) || location.hostname.endsWith(".local");
  const querySource = SOURCE_CODES.has(params.get("src")) ? params.get("src") : "unknown";
  const queryIsTest = params.get("analytics_test") === "1" || params.has("debug") || localHost || navigator.webdriver === true;

  function enableAnyOrientationGame() {
    if (page !== "game") return;

    const style = document.createElement("style");
    style.textContent = ".rotate{display:none!important}@media(orientation:portrait){.app{filter:none!important}}";
    document.head.appendChild(style);

    const activate = () => {
      try {
        if (typeof window.openingIsPortrait === "function") window.openingIsPortrait = () => false;
        if (typeof window.handleOpeningOrientation === "function") window.handleOpeningOrientation();
        if (typeof window.requestPlayStageLayout === "function") window.requestPlayStageLayout();
      } catch {}
    };

    const activateAfterLoad = () => {
      activate();
      setTimeout(activate, 150);
      setTimeout(activate, 500);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", activateAfterLoad, { once: true });
    } else {
      activateAfterLoad();
    }
    window.addEventListener("pageshow", activateAfterLoad);
    window.addEventListener("orientationchange", activateAfterLoad);
  }

  enableAnyOrientationGame();

  function freshState() {
    return {
      session_id: crypto.randomUUID(),
      support_viewed: false,
      support_play_clicked: false,
      game_page_opened: false,
      game_started: false,
      first_choice_tapped: false,
      correct_tap_count: 0,
      wrong_tap_count: 0,
      completed_round_count: 0,
      rare_car_shown_count: 0,
      rare_car_interaction_count: 0,
      visible_play_ms: 0,
      interaction_span_ms: 0,
      return_status: null,
      return_interval_bucket: null,
      source_code: querySource,
      is_test: queryIsTest,
      client_version: CLIENT_VERSION,
    };
  }

  function validStoredState(value) {
    return value && typeof value === "object" && /^[0-9a-f-]{36}$/i.test(value.session_id || "");
  }

  let state = freshState();
  try {
    const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (validStoredState(stored)) state = { ...state, ...stored };
  } catch {}
  state.is_test = Boolean(state.is_test || queryIsTest);
  if (state.source_code === "unknown" && querySource !== "unknown") state.source_code = querySource;
  state.client_version = CLIENT_VERSION;

  let visibleStartedAt = null;
  let firstInteractionAt = null;
  let lastInteractionAt = null;
  let debounceTimer = null;
  let checkpointTimer = null;

  function saveState() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch {}
  }

  function updateVisibleTime() {
    if (visibleStartedAt === null || !state.game_started) return;
    const now = performance.now();
    const elapsed = Math.max(0, Math.round(now - visibleStartedAt));
    state.visible_play_ms = Math.min(86400000, state.visible_play_ms + elapsed);
    visibleStartedAt = document.visibilityState === "visible" ? now : null;
  }

  function payload() {
    updateVisibleTime();
    saveState();
    return JSON.stringify(state);
  }

  function fallbackFetch(body, keepalive) {
    try {
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive,
        credentials: "same-origin",
      }).catch(() => {});
    } catch {}
  }

  function flush({ beacon = false } = {}) {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    const body = payload();
    if (beacon && typeof navigator.sendBeacon === "function") {
      try {
        if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
      } catch {}
    }
    fallbackFetch(body, beacon);
  }

  function scheduleFlush() {
    saveState();
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => flush(), 1200);
  }

  function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function returnClassification() {
    try {
      const hadStarted = localStorage.getItem(STARTED_KEY) === "1";
      const previousDate = localStorage.getItem(LAST_START_KEY);
      const today = localDateString();
      localStorage.setItem(STARTED_KEY, "1");
      localStorage.setItem(LAST_START_KEY, today);
      if (!hadStarted) return { status: "first_time", bucket: "first_time" };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(previousDate || "")) {
        return { status: "returning", bucket: "unknown" };
      }
      const elapsedDays = Math.max(
        0,
        Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${previousDate}T00:00:00Z`)) / 86400000)
      );
      const bucket = elapsedDays === 0 ? "same_day" : elapsedDays <= 7 ? "1_7_days" : elapsedDays <= 30 ? "8_30_days" : "31_plus_days";
      return { status: "returning", bucket };
    } catch {
      return { status: null, bucket: "unknown" };
    }
  }

  function supportViewed() {
    state.support_viewed = true;
    flush();
  }

  function supportPlayClicked() {
    state.support_play_clicked = true;
    if (state.source_code === "unknown") state.source_code = "support";
    flush({ beacon: true });
  }

  function gamePageOpened() {
    state.game_page_opened = true;
    flush();
  }

  function gameStarted() {
    if (!state.game_started) {
      const classification = returnClassification();
      state.return_status = classification.status;
      state.return_interval_bucket = classification.bucket;
      state.game_started = true;
    }
    if (document.visibilityState === "visible" && visibleStartedAt === null) visibleStartedAt = performance.now();
    if (checkpointTimer === null) checkpointTimer = setInterval(() => flush(), 60000);
    flush();
  }

  function choiceTapped({ result = null, rare = false } = {}) {
    const now = performance.now();
    const wasFirstChoice = !state.first_choice_tapped;
    if (wasFirstChoice) {
      state.first_choice_tapped = true;
      firstInteractionAt = now;
    }
    if (firstInteractionAt === null) firstInteractionAt = now;
    lastInteractionAt = now;
    state.interaction_span_ms = Math.min(86400000, Math.max(0, Math.round(lastInteractionAt - firstInteractionAt)));
    if (result === "correct") state.correct_tap_count = Math.min(10000, state.correct_tap_count + 1);
    if (result === "wrong") state.wrong_tap_count = Math.min(10000, state.wrong_tap_count + 1);
    if (rare) state.rare_car_interaction_count = Math.min(2000, state.rare_car_interaction_count + 1);
    if (wasFirstChoice) flush();
    else scheduleFlush();
  }

  function roundCompleted() {
    state.completed_round_count = Math.min(5000, state.completed_round_count + 1);
    scheduleFlush();
  }

  function rareShown() {
    state.rare_car_shown_count = Math.min(2000, state.rare_car_shown_count + 1);
    scheduleFlush();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      updateVisibleTime();
      visibleStartedAt = null;
      flush({ beacon: true });
    } else if (state.game_started) {
      visibleStartedAt = performance.now();
    }
  });
  window.addEventListener("pagehide", () => flush({ beacon: true }));

  window.KurumaAnalytics = Object.freeze({
    supportViewed,
    supportPlayClicked,
    gamePageOpened,
    gameStarted,
    choiceTapped,
    roundCompleted,
    rareShown,
    flush,
    snapshot: () => ({ ...state }),
  });

  if (page === "support") {
    supportViewed();
    const attachPlayLink = () => document.getElementById("playLink")?.addEventListener("click", supportPlayClicked, { capture: true });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attachPlayLink, { once: true });
    else attachPlayLink();
  } else {
    gamePageOpened();
  }
})();
