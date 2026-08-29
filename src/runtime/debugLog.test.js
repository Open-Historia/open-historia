/*! Open Historia — diagnostics log tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/runtime/debugLog.test.js
//
// A fake localStorage is installed BEFORE the module is imported, because the
// module reads storage at import-adjacent times (restore on capture install,
// secret lookup on every entry) and the whole point of several of these tests
// is that the stored API keys are found and redacted.

import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
    get length() { return store.size; },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
};

const {
    buildDebugLogReport,
    clearDebugLog,
    getDebugLogBytes,
    getDebugLogEntries,
    isDebugLogEnabled,
    isDebugLogVerbose,
    logDebugEvent,
    redactSecrets,
    setDebugLogContext,
    setDebugLogEnabled,
    setDebugLogVerbose,
} = await import("./debugLog.js");

const reset = () => {
    store.clear();
    // Back to shipped defaults: on, not detailed. Set before the clear so the
    // clear itself is not swallowed by a disabled log.
    setDebugLogEnabled(true);
    setDebugLogVerbose(false);
    // Silent, because clearDebugLog's player-facing path leaves a "cleared"
    // note behind and every test below counts entries.
    clearDebugLog({ silent: true });
    setDebugLogContext({
        build: "", gameName: "", gameId: "", scenario: "", playerCountry: "",
        gameDate: "", round: "", difficulty: "", provider: "", model: "",
        unitSystem: "", language: "",
    });
};

// ---- Group R: redaction -----------------------------------------------------

test("R1 a stored provider key is redacted wherever it appears", () => {
    reset();
    store.set("gemini_api_key", "AIzaTOTALLYREALKEY123456");
    assert.equal(
        redactSecrets("request to https://x/y?key=AIzaTOTALLYREALKEY123456 failed").includes("AIzaTOTALLYREALKEY123456"),
        false,
    );
});

test("R2 a stored key for a gateway is redacted even though it looks like nothing", () => {
    reset();
    // The case no regex can catch: a self-hosted gateway key that is just a word.
    store.set("openai_compatible_api_key", "hunter2hunter2");
    const out = redactSecrets("Authorization failed for hunter2hunter2");
    assert.equal(out.includes("hunter2hunter2"), false);
    assert.equal(out.includes("[redacted API key]"), true);
});

test("R3 a very short stored value is NOT treated as a key", () => {
    reset();
    // Guard against redacting half the log because some key held "1".
    store.set("some_token", "7");
    assert.equal(redactSecrets("round 7 of 7"), "round 7 of 7");
});

test("R4 sk- / AIza / hf_ shaped keys are redacted with nothing in storage", () => {
    reset();
    for (const secret of ["sk-abcdefghijklmnop", "sk-ant-api03-abcdefghijkl", "AIzaSyABCDEFGHIJKLMNOPQRSTU", "hf_abcdefghijklmnop"]) {
        assert.equal(redactSecrets(`key ${secret} rejected`).includes(secret), false, secret);
    }
});

test("R5 an Authorization header is redacted", () => {
    reset();
    assert.equal(redactSecrets("sent Bearer abc123def456ghi").includes("abc123def456ghi"), false);
});

test("R6 key=… and \"api_key\": \"…\" in a dumped object are redacted", () => {
    reset();
    assert.equal(redactSecrets('{"api_key":"zzzzzzzzzzzz"}').includes("zzzzzzzzzzzz"), false);
    assert.equal(redactSecrets("https://host/v1?api-key=zzzzzzzzzzzz").includes("zzzzzzzzzzzz"), false);
});

test("R7 credentials in a URL's userinfo are redacted, host is kept", () => {
    reset();
    const out = redactSecrets("connecting to http://bob:s3cr3t@gateway.local:8080/v1");
    assert.equal(out.includes("s3cr3t"), false);
    assert.equal(out.includes("gateway.local:8080"), true, "the host is diagnostic and must survive");
});

test("R8 a JWT is redacted", () => {
    reset();
    assert.equal(
        redactSecrets("cookie eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcd").includes("eyJzdWIiOiIxMjMifQ"),
        false,
    );
});

test("R9 ordinary text is left completely alone", () => {
    reset();
    const text = "Turn 12 finished: 4 events, 2 region transfers, France -> Spain";
    assert.equal(redactSecrets(text), text);
});

test("R10 redaction happens on the way IN, so the buffer never holds a key", () => {
    reset();
    store.set("openai_api_key", "sk-abcdefghijklmnopqrst");
    logDebugEvent("ai", "request failed", { url: "https://api.openai.com", key: "sk-abcdefghijklmnopqrst" });
    const raw = JSON.stringify(getDebugLogEntries());
    assert.equal(raw.includes("sk-abcdefghijklmnopqrst"), false);
});

// ---- Group L: the buffer ----------------------------------------------------

test("L1 entries are recorded in order with category and message", () => {
    reset();
    logDebugEvent("game", "Loaded save");
    logDebugEvent("turn", "Jump started");
    const list = getDebugLogEntries();
    assert.deepEqual(list.map((e) => e.message), ["Loaded save", "Jump started"]);
    assert.deepEqual(list.map((e) => e.category), ["game", "turn"]);
});

test("L2 an Error detail keeps name, message and the throwing frame", () => {
    reset();
    logDebugEvent("error", "Save failed", new TypeError("x is not a function"));
    const [entry] = getDebugLogEntries();
    assert.match(entry.detail, /^TypeError: x is not a function/);
});

test("L3 an object detail is JSON, a circular one does not throw", () => {
    reset();
    logDebugEvent("ai", "context", { provider: "gemini", round: 3 });
    assert.equal(getDebugLogEntries()[0].detail, '{"provider":"gemini","round":3}');
    const circular = { name: "loop" };
    circular.self = circular;
    assert.doesNotThrow(() => logDebugEvent("ai", "circular", circular));
});

test("L4 an enormous detail is truncated rather than filling the buffer", () => {
    reset();
    logDebugEvent("ai", "raw response", "x".repeat(50_000));
    const [entry] = getDebugLogEntries();
    assert.ok(entry.detail.length < 1000, `detail was ${entry.detail.length} chars`);
    assert.match(entry.detail, /\+\d+ chars\)$/);
});

test("L5 the buffer is capped and keeps the newest entries", () => {
    reset();
    for (let index = 0; index < 500; index += 1) logDebugEvent("turn", `entry ${index}`);
    const list = getDebugLogEntries();
    assert.equal(list.length, 400);
    assert.equal(list[list.length - 1].message, "entry 499");
});

test("L6 the in-game date is stamped per entry, not only in the header", () => {
    reset();
    setDebugLogContext({ gameDate: "1936-03-07" });
    logDebugEvent("turn", "before");
    setDebugLogContext({ gameDate: "1936-04-01" });
    logDebugEvent("turn", "after");
    assert.deepEqual(getDebugLogEntries().map((e) => e.gameDate), ["1936-03-07", "1936-04-01"]);
});

test("L7 clearing empties the buffer and says so", () => {
    reset();
    logDebugEvent("turn", "something");
    clearDebugLog();
    const list = getDebugLogEntries();
    assert.equal(list.length, 1);
    assert.match(list[0].message, /cleared by the player/);
});

// ---- Group C: repeat collapsing ---------------------------------------------

test("C1 an identical entry bumps a counter instead of appending", () => {
    reset();
    for (let index = 0; index < 40; index += 1) logDebugEvent("error", "Failed to fetch tile");
    const list = getDebugLogEntries();
    assert.equal(list.length, 1);
    assert.equal(list[0].repeat, 40);
});

test("C2 an interleaved storm collapses to one entry per distinct message", () => {
    reset();
    // The real shape of a dead basemap host: two different errors alternating,
    // which consecutive-only matching would fail to collapse at all.
    for (let index = 0; index < 30; index += 1) {
        logDebugEvent("error", "AJAXError: Failed to fetch");
        logDebugEvent("error", "TypeError: Failed to fetch");
    }
    assert.equal(getDebugLogEntries().length, 2);
});

test("C3 a storm does not evict the gameplay entries around it", () => {
    reset();
    logDebugEvent("game", "Loaded save");
    for (let index = 0; index < 2000; index += 1) logDebugEvent("error", "Failed to fetch tile");
    logDebugEvent("turn", "Jump started");
    const messages = getDebugLogEntries().map((entry) => entry.message);
    assert.deepEqual(messages, ["Loaded save", "Failed to fetch tile", "Jump started"]);
});

test("C4 entries that differ in detail are kept apart", () => {
    reset();
    logDebugEvent("api", "PUT /api/games/x failed", "HTTP 500");
    logDebugEvent("api", "PUT /api/games/x failed", "HTTP 409");
    assert.equal(getDebugLogEntries().length, 2);
});

test("C5 a repeat is shown with its count and last time, a single entry is not", () => {
    reset();
    logDebugEvent("error", "Failed to fetch tile");
    logDebugEvent("error", "Failed to fetch tile");
    logDebugEvent("turn", "Jump started");
    const report = buildDebugLogReport();
    assert.match(report, /Failed to fetch tile \(×2, last \d{2}:\d{2}:\d{2}\)/);
    assert.match(report, /\[turn\] Jump started$/m);
});

// ---- Group S: the on/off switch ---------------------------------------------

test("S1 logging is ON with nothing stored — the shipped default", () => {
    reset();
    assert.equal(isDebugLogEnabled(), true);
    logDebugEvent("turn", "recorded");
    assert.equal(getDebugLogEntries().length, 1);
});

test("S2 turning it off stops recording", () => {
    reset();
    setDebugLogEnabled(false);
    logDebugEvent("turn", "should not be recorded");
    logDebugEvent("error", "nor this");
    assert.equal(getDebugLogEntries().length, 0);
});

test("S3 turning it off clears what was already collected, storage included", () => {
    reset();
    logDebugEvent("turn", "collected before");
    logDebugEvent("turn", "and this");
    setDebugLogEnabled(false);
    assert.equal(getDebugLogEntries().length, 0);
    assert.equal(getDebugLogBytes(), 0);
    assert.equal(store.get("oh_debug_log_v1"), undefined);
});

test("S4 the OFF choice is written to storage so it survives a restart", () => {
    reset();
    setDebugLogEnabled(false);
    // What a fresh launch would read back.
    assert.equal(store.get("oh_debug_log_enabled"), "0");
});

test("S5 turning it back on records again and says so", () => {
    reset();
    setDebugLogEnabled(false);
    setDebugLogEnabled(true);
    logDebugEvent("turn", "after");
    const messages = getDebugLogEntries().map((entry) => entry.message);
    assert.deepEqual(messages, ["Diagnostics logging turned on.", "after"]);
});

test("S6 setting it to the value it already has is a no-op", () => {
    reset();
    logDebugEvent("turn", "kept");
    setDebugLogEnabled(true);
    assert.deepEqual(getDebugLogEntries().map((entry) => entry.message), ["kept"]);
});

// ---- Group V: detailed logging ----------------------------------------------

test("V1 detailed logging is OFF by default and verbose entries are dropped", () => {
    reset();
    assert.equal(isDebugLogVerbose(), false);
    logDebugEvent("ai", "detail only", undefined, { verbose: true });
    logDebugEvent("turn", "always");
    assert.deepEqual(getDebugLogEntries().map((entry) => entry.message), ["always"]);
});

test("V2 turning it on lets verbose entries through", () => {
    reset();
    setDebugLogVerbose(true);
    logDebugEvent("ai", "detail only", undefined, { verbose: true });
    const messages = getDebugLogEntries().map((entry) => entry.message);
    assert.ok(messages.includes("detail only"));
});

test("V3 the ON choice is written to storage so it survives a restart", () => {
    reset();
    setDebugLogVerbose(true);
    assert.equal(store.get("oh_debug_log_verbose"), "1");
});

test("V4 details are truncated far less in detailed mode", () => {
    reset();
    logDebugEvent("ai", "raw", "x".repeat(50_000));
    const plain = getDebugLogEntries()[0].detail.length;
    setDebugLogVerbose(true);
    logDebugEvent("ai", "raw again", "x".repeat(50_000));
    const detailed = getDebugLogEntries().at(-1).detail.length;
    assert.ok(detailed > plain * 5, `plain ${plain} vs detailed ${detailed}`);
});

test("V5 an error keeps one frame normally and a real stack in detailed mode", () => {
    reset();
    const error = new Error("boom");
    error.stack = ["Error: boom", "  at a (f.js:1:1)", "  at b (f.js:2:2)", "  at c (f.js:3:3)"].join("\n");
    logDebugEvent("error", "plain", error);
    assert.equal(getDebugLogEntries()[0].detail.includes("at c"), false);
    setDebugLogVerbose(true);
    logDebugEvent("error", "detailed", error);
    assert.equal(getDebugLogEntries().at(-1).detail.includes("at c"), true);
});

test("V6 a disabled log ignores verbose entries too", () => {
    reset();
    setDebugLogVerbose(true);
    setDebugLogEnabled(false);
    logDebugEvent("ai", "detail only", undefined, { verbose: true });
    assert.equal(getDebugLogEntries().length, 0);
});

test("V7 the report states which mode produced it", () => {
    reset();
    logDebugEvent("turn", "x");
    assert.match(buildDebugLogReport(), /Detailed logging: off/);
    setDebugLogVerbose(true);
    assert.match(buildDebugLogReport(), /Detailed logging: ON/);
});

// ---- Group B: the size budget -----------------------------------------------

test("B1 a big log drops its OLDEST entries and keeps the newest", () => {
    reset();
    // ~1 KB per entry, 400 of them: well past the 192 KB budget in detailed mode
    // where the entry ceiling is not what bites first.
    setDebugLogVerbose(true);
    for (let index = 0; index < 400; index += 1) logDebugEvent("ai", `entry ${index}`, "y".repeat(1000));
    const list = getDebugLogEntries();
    assert.ok(list.length < 400, `expected trimming, kept ${list.length}`);
    assert.equal(list.at(-1).message, "entry 399");
    assert.ok(!list.some((entry) => entry.message === "entry 0"), "the oldest entry should have gone first");
});

test("B2 trimming holds the buffer under the size budget", () => {
    reset();
    setDebugLogVerbose(true);
    for (let index = 0; index < 2000; index += 1) logDebugEvent("ai", `entry ${index}`, "z".repeat(500));
    assert.ok(getDebugLogBytes() <= 192 * 1024, `buffer was ${getDebugLogBytes()} chars`);
});

test("B3 the report says entries were dropped rather than leaving a silent gap", () => {
    reset();
    setDebugLogVerbose(true);
    for (let index = 0; index < 500; index += 1) logDebugEvent("ai", `entry ${index}`, "y".repeat(1000));
    assert.match(buildDebugLogReport(), /older entries were dropped to stay inside that budget/);
});

test("B4 a normal-mode log stays under the entry ceiling", () => {
    reset();
    for (let index = 0; index < 900; index += 1) logDebugEvent("turn", `entry ${index}`);
    assert.equal(getDebugLogEntries().length, 400);
});

test("B5 the size is reported in the header", () => {
    reset();
    logDebugEvent("turn", "x");
    assert.match(buildDebugLogReport(), /Entries: 1 \(<1 KB of a \d+ KB budget\)/);
});

// ---- Group P: the report ----------------------------------------------------

test("P1 the report carries the campaign context a bug report needs", () => {
    reset();
    setDebugLogContext({
        build: "beta 1.2.3",
        gameName: "My Campaign",
        provider: "gemini",
        model: "gemini-3.5-flash-lite",
        playerCountry: "France",
    });
    logDebugEvent("turn", "Jump finished");
    const report = buildDebugLogReport();
    assert.match(report, /OPEN HISTORIA — DIAGNOSTICS LOG/);
    assert.match(report, /Build: beta 1\.2\.3/);
    assert.match(report, /Game: My Campaign/);
    assert.match(report, /AI provider: gemini/);
    assert.match(report, /AI model: gemini-3\.5-flash-lite/);
    assert.match(report, /Jump finished/);
});

test("P2 the report never contains a stored key, even via the context", () => {
    reset();
    store.set("anthropic_api_key", "sk-ant-shouldnotappear12345");
    // The worst case: something puts the key in the context by mistake.
    setDebugLogContext({ model: "claude-haiku-4-5 (sk-ant-shouldnotappear12345)" });
    logDebugEvent("ai", "call failed with sk-ant-shouldnotappear12345");
    assert.equal(buildDebugLogReport().includes("sk-ant-shouldnotappear12345"), false);
});

test("P3 an empty log still produces a usable report, not a blank paste", () => {
    reset();
    assert.match(buildDebugLogReport(), /\(empty — nothing has been logged yet this session\)/);
});

test("P4 absent context lines are omitted rather than printed empty", () => {
    reset();
    logDebugEvent("app", "hello");
    const report = buildDebugLogReport();
    assert.equal(/^Scenario:\s*$/m.test(report), false);
});
