/*! Open Historia — diagnostics log tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/debugLog.test.js
//
// A fake localStorage is installed BEFORE the module is imported, because the
// module reads storage at import-adjacent times (restore on capture install,
// secret lookup on every entry) and the whole point of several of these tests
// is that the stored API keys are found and redacted.

import test, { mock } from "node:test";
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
    buildIncidentReport,
    buildLoggingFile,
    clearDebugLog,
    debugLogFilename,
    getDebugLogBytes,
    getDebugLogEntries,
    getLoggingFileEntries,
    installDebugLogCapture,
    isDebugLogEnabled,
    isDebugLogVerbose,
    localClock,
    logDebugEvent,
    logSettingChange,
    redactSecrets,
    registerSettingsSnapshot,
    setDebugLogContext,
    setDebugLogEnabled,
    setDebugLogVerbose,
    utcOffsetLabel,
    withConsoleCaptureMuted,
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
        language: "",
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

test("R2b a key kept only inside a saved Connection or profile is redacted too", () => {
    reset();
    // Connections (Game/AI/providerConfig.js) keep their keys inside one JSON
    // list, not under a *_api_key setting, and so did the profiles before them.
    store.set("ai_connections", JSON.stringify([
        { id: "c1", provider: "openai-compatible", name: "Home", apiKey: "hunter3hunter3", endpoint: "http://x" },
        { id: "c2", provider: "gemini", name: "Main", apiKey: "" },
    ]));
    store.set("ai_provider_presets", JSON.stringify([
        { id: "p1", provider: "openai-compatible", name: "Mine", settings: { apiKey: "profilekey-plain", endpoint: "http://y" } },
    ]));
    logDebugEvent("ai", "Authorization failed for hunter3hunter3 and profilekey-plain");
    const raw = JSON.stringify(getDebugLogEntries());
    assert.equal(raw.includes("hunter3hunter3"), false);
    assert.equal(raw.includes("profilekey-plain"), false);
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
    for (let index = 0; index < 5500; index += 1) logDebugEvent("turn", `entry ${index}`);
    const list = getDebugLogEntries();
    assert.equal(list.length, 5000);
    assert.equal(list[list.length - 1].message, "entry 5499");
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

test("S7 turning it off also asks the server to clear the Desktop log", () => {
    reset();
    const calls = mock.method(globalThis, "fetch", async () => new Response("{}"));
    try {
        setDebugLogEnabled(false);
        assert.deepEqual(calls.mock.calls.map(({ arguments: [url, init] }) => [url, init?.method]), [["/api/log", "DELETE"]]);
        // Turning it back on clears nothing.
        setDebugLogEnabled(true);
        assert.equal(calls.mock.callCount(), 1);
    } finally {
        calls.mock.restore();
    }
});

test("S8 a refused or failed clear never breaks the switch", async () => {
    reset();
    const refused = mock.method(globalThis, "fetch", async () => new Response("{}", { status: 403 }));
    try {
        assert.doesNotThrow(() => setDebugLogEnabled(false));
        assert.equal(isDebugLogEnabled(), false);
    } finally {
        refused.mock.restore();
    }
    setDebugLogEnabled(true);
    const failing = mock.method(globalThis, "fetch", () => { throw new TypeError("no fetch here"); });
    try {
        assert.doesNotThrow(() => setDebugLogEnabled(false));
    } finally {
        failing.mock.restore();
    }
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

// One budget for both modes, 1 MB — the size of the Logging file itself. The
// modes differ in what they record, not in how much of it they keep; a normal
// log simply reaches much further back. The old normal budget is kept here to
// show the normal log now holds more than it.
const OLD_NORMAL_BUDGET = 192 * 1024;
const VERBOSE_BUDGET = 1024 * 1024;

test("B1 a big log drops its OLDEST entries and keeps the newest", () => {
    reset();
    // ~1 KB per entry, 2000 of them: ~2 MB, past the detailed budget, and under
    // the 5000-entry ceiling so it is the SIZE cap being tested here.
    setDebugLogVerbose(true);
    for (let index = 0; index < 2000; index += 1) logDebugEvent("ai", `entry ${index}`, "y".repeat(1000));
    const list = getDebugLogEntries();
    assert.ok(list.length < 2000, `expected trimming, kept ${list.length}`);
    assert.equal(list.at(-1).message, "entry 1999");
    assert.ok(!list.some((entry) => entry.message === "entry 0"), "the oldest entry should have gone first");
});

test("B2 trimming holds the buffer under the size budget", () => {
    reset();
    setDebugLogVerbose(true);
    for (let index = 0; index < 4000; index += 1) logDebugEvent("ai", `entry ${index}`, "z".repeat(500));
    assert.ok(getDebugLogBytes() <= VERBOSE_BUDGET, `buffer was ${getDebugLogBytes()} chars`);
});

test("B3 the report says entries were dropped rather than leaving a silent gap", () => {
    reset();
    setDebugLogVerbose(true);
    for (let index = 0; index < 2000; index += 1) logDebugEvent("ai", `entry ${index}`, "y".repeat(1000));
    assert.match(buildDebugLogReport(), /older entries were dropped to stay inside that budget/);
});

test("B3b a normal-mode log keeps the same 1 MB as a detailed one", () => {
    reset();
    // ~300 KB of normal entries (details clipped to 600): past the old 192 KB
    // normal budget, well inside the shared one.
    for (let index = 0; index < 400; index += 1) logDebugEvent("ai", `entry ${index}`, "y".repeat(1000));
    assert.ok(getDebugLogBytes() > OLD_NORMAL_BUDGET,
        `expected a normal log to be allowed past ${OLD_NORMAL_BUDGET} chars, held ${getDebugLogBytes()}`);
    assert.ok(getDebugLogEntries().some((entry) => entry.message === "entry 0"),
        "nothing should have been dropped yet at ~300 KB");
});

test("B3c leaving detailed mode keeps everything that was collected", () => {
    reset();
    setDebugLogVerbose(true);
    for (let index = 0; index < 400; index += 1) logDebugEvent("ai", `entry ${index}`, "y".repeat(1000));
    const before = getDebugLogEntries().length;
    // Same budget either side of the switch, so switching throws nothing away.
    setDebugLogVerbose(false);
    assert.equal(getDebugLogEntries().length, before + 1, "only the 'turned off' note is added");
    assert.ok(getDebugLogBytes() <= VERBOSE_BUDGET);
});

test("B4 a normal-mode log stays under the entry ceiling", () => {
    reset();
    for (let index = 0; index < 5200; index += 1) logDebugEvent("turn", `entry ${index}`);
    assert.equal(getDebugLogEntries().length, 5000);
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

// ---- Group I: an incident attached to the saved log ------------------------

const fallbackIncident = (rawResponse = "{\"events\": [") => ({
    kind: "turn-fallback",
    title: "AI turn fell back",
    fields: [
        ["Failure reason", "JSON did not parse"],
        ["Requested range", "1914-06-01 -> 1914-07-01"],
        ["Round", "4"],
        ["AI model", "gemini-3.5-flash-lite"],
        ["Player's queued actions this round", ["- Mobilise the army"]],
        ["Raw model response", rawResponse],
    ],
});

test("I1 the incident sits between the header and the log", () => {
    reset();
    logDebugEvent("turn", "Jump started");
    const report = buildDebugLogReport({ incident: fallbackIncident() });
    const header = report.indexOf("OPEN HISTORIA — DIAGNOSTICS LOG");
    const incident = report.indexOf("-- Reported problem: AI turn fell back --");
    const log = report.indexOf("-- Log (oldest first) --");
    assert.ok(header < incident && incident < log);
    assert.match(report, /Failure reason: JSON did not parse/);
    assert.match(report, /Player's queued actions this round:\n {2}- Mobilise the army/);
    assert.ok(report.indexOf("Jump started") > log);
});

test("I2 fields the header already states are not repeated, fields that differ are", () => {
    reset();
    setDebugLogContext({ round: "4", model: "gemini-3.5-pro" });
    const report = buildDebugLogReport({ incident: fallbackIncident() });
    const incidentBlock = report.slice(report.indexOf("-- Reported problem"), report.indexOf("-- Log (oldest first) --"));
    // Same round as the header: dropped. A different model: kept, because it
    // says the failure happened on a model the player has since moved off.
    assert.equal(/^Round:/m.test(incidentBlock), false);
    assert.match(incidentBlock, /AI model: gemini-3\.5-flash-lite/);
    assert.match(report, /^Round: 4$/m);
});

test("I3 the raw response is attached whole, not clipped like a log entry", () => {
    reset();
    const raw = `{"events": [${"x".repeat(5000)}`;
    assert.ok(buildDebugLogReport({ incident: fallbackIncident(raw) }).includes(raw));
});

test("I4 an incident is redacted like everything else", () => {
    reset();
    store.set("openai_api_key", "sk-proj-incidentkey1234567");
    const report = buildDebugLogReport({ incident: fallbackIncident("error for sk-proj-incidentkey1234567") });
    assert.equal(report.includes("sk-proj-incidentkey1234567"), false);
});

test("I5 with logging off the saved file says why the log is empty", () => {
    reset();
    setDebugLogEnabled(false);
    const report = buildDebugLogReport({ incident: fallbackIncident() });
    assert.match(report, /Failure reason: JSON did not parse/);
    assert.match(report, /logging is turned off in Settings → Diagnostics/);
});

test("I6 the copied incident report carries the context and every field", () => {
    reset();
    setDebugLogContext({ round: "4", model: "gemini-3.5-flash-lite", provider: "Gemini", playerCountry: "France" });
    const report = buildIncidentReport(fallbackIncident());
    assert.match(report, /^OPEN HISTORIA — AI TURN FELL BACK$/m);
    assert.match(report, /AI provider: Gemini/);
    assert.match(report, /Player polity: France/);
    // No header to deduplicate against, so the round stays.
    assert.match(report, /^Round: 4$/m);
    assert.match(report, /Raw model response: \{"events": \[/);
    assert.equal(buildIncidentReport(null), "");
});

// ---- Group D: the Desktop log merged into the Logging file -----------------
//
// The page's clock is mocked so page entries and Desktop log entries can be
// interleaved at known times: the Desktop log is written by other processes, and
// the only thing tying the two together is the timestamp.

const T0 = Date.parse("2026-09-12T10:00:00.000Z");
const at = (seconds) => new Date(T0 + seconds * 1000).toISOString();

const withClock = (run) => {
    mock.timers.enable({ apis: ["Date"], now: T0 });
    try {
        return run();
    } finally {
        mock.timers.reset();
    }
};

// A page entry at `seconds` past T0.
const pageEntryAt = (seconds, category, message, detail) => {
    mock.timers.setTime(T0 + seconds * 1000);
    logDebugEvent(category, message, detail);
};

const desktopEntry = (seconds, source, event, message, data) => ({
    at: at(seconds), level: "error", source, event, message, ...(data === undefined ? {} : { data }),
});

const logSection = (report) => report.slice(report.indexOf("-- Log (oldest first) --"));

test("D1 Desktop log entries are merged into the file in time order, labelled by source", () => {
    reset();
    const report = withClock(() => {
        pageEntryAt(0, "game", "Loaded save");
        pageEntryAt(20, "turn", "Jump started");
        return buildDebugLogReport({
            desktop: {
                status: "included",
                entries: [
                    desktopEntry(30, "main", "updater", "Update download failed"),
                    desktopEntry(10, "server", "http.500", "Could not write world.json"),
                ],
            },
        });
    });
    const log = logSection(report);
    const order = ["Loaded save", "Could not write world.json", "Jump started", "Update download failed"]
        .map((message) => log.indexOf(message));
    assert.ok(order.every((index) => index > 0), `every entry is in the log: ${order}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, "entries are in time order");
    assert.match(log, /\[server\] http\.500: Could not write world\.json/);
    assert.match(log, /\[desktop app\] updater: Update download failed/);
});

test("D2 only Desktop log entries inside the page log's span get in", () => {
    reset();
    const report = withClock(() => {
        pageEntryAt(100, "game", "Loaded save");
        return buildDebugLogReport({
            desktop: {
                status: "included",
                entries: [
                    desktopEntry(50, "server", "http.500", "Before the log begins"),
                    desktopEntry(150, "server", "http.500", "Inside the span"),
                ],
            },
        });
    });
    assert.equal(report.includes("Before the log begins"), false);
    assert.equal(report.includes("Inside the span"), true);
});

test("D3 page copies and AI prompts that older builds wrote to the Desktop log never get in", () => {
    reset();
    const report = withClock(() => {
        pageEntryAt(0, "game", "Loaded save");
        return buildDebugLogReport({
            desktop: {
                status: "included",
                entries: [
                    desktopEntry(10, "client", "debug.turn", "A page entry copied by an older build"),
                    desktopEntry(20, "ai", "ai.request", "world-simulation attempt 1", "{\"systemPrompt\":\"...\"}"),
                    desktopEntry(30, "main", "main.bootFailed", "Port in use"),
                ],
            },
        });
    });
    assert.equal(report.includes("copied by an older build"), false);
    assert.equal(report.includes("world-simulation attempt 1"), false);
    assert.equal(report.includes("Port in use"), true);
});

test("D4 a storm of identical Desktop log entries folds into one line", () => {
    reset();
    const report = withClock(() => {
        pageEntryAt(0, "game", "Loaded save");
        const storm = Array.from({ length: 30 }, (_, index) =>
            desktopEntry(1 + index, "server", "http.404", "Flag not found"));
        return buildDebugLogReport({ desktop: { status: "included", entries: storm } });
    });
    assert.equal(logSection(report).split("Flag not found").length - 1, 1);
    // The stamps are this computer's clock (K1 below), so the expected time is too.
    assert.ok(report.includes(`Flag not found (×30, last ${localClock(new Date(T0 + 30_000).toISOString())})`), report);
});

test("D5 an oversized Desktop log entry is trimmed like a page entry", () => {
    reset();
    const report = withClock(() => {
        pageEntryAt(0, "game", "Loaded save");
        return buildDebugLogReport({
            desktop: {
                status: "included",
                entries: [desktopEntry(5, "server", "http.500", "Stack follows", `{"stack":"${"s".repeat(50_000)}"}`)],
            },
        });
    });
    const detailLine = logSection(report).split("\n").find((line) => line.includes("sss"));
    assert.ok(detailLine.length < 1000, `detail was ${detailLine.length} chars`);
    assert.match(detailLine, /\+\d+ chars\)$/);
});

test("D6 keys inside Desktop log entries are redacted, stored and shaped alike", () => {
    reset();
    store.set("openai_compatible_api_key", "hunter2hunter2");
    const report = withClock(() => {
        pageEntryAt(0, "game", "Loaded save");
        return buildDebugLogReport({
            desktop: {
                status: "included",
                entries: [
                    desktopEntry(5, "server", "http.401", "Relay refused hunter2hunter2"),
                    desktopEntry(6, "main", "updater", "Token ghp_abcdefghijklmnopqrstuvwxyz rejected", "{\"key\":\"sk-abcdefghijklmnopqrst\"}"),
                ],
            },
        });
    });
    for (const secret of ["hunter2hunter2", "ghp_abcdefghijklmnopqrstuvwxyz", "sk-abcdefghijklmnopqrst"]) {
        assert.equal(report.includes(secret), false, secret);
    }
});

test("D7 the player's home folder becomes ~ on Windows, macOS and Linux", () => {
    reset();
    const report = withClock(() => {
        // A page entry can quote a server error, so the page's own entries are
        // covered too.
        pageEntryAt(0, "api", "PUT failed: EPERM, open 'C:\\Users\\Jane Doe\\AppData\\Roaming\\open-historia\\x.json'");
        return buildDebugLogReport({
            desktop: {
                status: "included",
                entries: [
                    // As the store holds it: `data` is JSON text, so a Windows
                    // path's backslashes arrive doubled.
                    desktopEntry(5, "server", "http.500", "boom", "{\"stack\":\"at C:\\\\Users\\\\jdoe\\\\AppData\\\\Local\\\\server.js:1\"}"),
                    desktopEntry(6, "main", "main.bootFailed", "ENOENT /Users/jane/Library/Application Support/open-historia"),
                    desktopEntry(7, "main", "main.bootFailed", "ENOENT /home/jane/.config/open-historia"),
                ],
            },
        });
    });
    for (const name of ["Jane Doe", "jdoe", "/Users/jane", "/home/jane"]) {
        assert.equal(report.includes(name), false, name);
    }
    assert.match(report, /~\\AppData\\Roaming\\open-historia/);
    assert.match(report, /~\/Library\/Application Support/);
    assert.match(report, /~\/\.config\/open-historia/);
});

test("D8 the log stays within 1 MB, dropping the oldest entries and saying how many; the reported problem comes on top", () => {
    reset();
    const LOG_LIMIT = 1024 * 1024;
    const report = withClock(() => {
        setDebugLogVerbose(true);
        // A full detailed buffer, then a Desktop log and a big reported problem
        // on top of it: together well past what the file may hold.
        for (let index = 0; index < 1200; index += 1) pageEntryAt(index, "ai", `page ${index}`, "p".repeat(1000));
        const desktopEntries = Array.from({ length: 150 }, (_, index) =>
            desktopEntry(1200 + index, "server", "http.500", `desktop ${index}`, "d".repeat(1000)));
        return buildDebugLogReport({
            desktop: { status: "included", entries: desktopEntries },
            incident: fallbackIncident("r".repeat(100_000)),
        });
    });
    const withoutProblem = report.replace("r".repeat(100_000), "");
    assert.ok(withoutProblem.length <= LOG_LIMIT, `everything but the reported problem was ${withoutProblem.length} chars`);
    assert.ok(report.length > LOG_LIMIT, "the reported problem is not squeezed into the log's 1 MB");
    assert.match(report, /desktop 149\b/, "the newest entry is kept");
    assert.ok(report.includes("r".repeat(100_000)), "the reported problem is kept whole");
    const kept = getDebugLogEntries().map((entry) => entry.message).filter((message) => report.includes(`] ${message}\n`));
    assert.ok(kept.length < getDebugLogEntries().length, "some page entries had to go");
    assert.equal(kept.includes(getDebugLogEntries()[0].message), false, "the oldest go first");
    assert.equal(kept.includes(getDebugLogEntries().at(-1).message), true);
    assert.match(report, /NOTE: \d+ older entries were left out to keep this log within 1 MB/);
});

test("D15 a reported problem over 1 MB is kept whole while the file stays within 2 MB", () => {
    reset();
    logDebugEvent("turn", "Jump started");
    const raw = `{"events": [${"q".repeat(1_500_000)}`;
    const report = buildDebugLogReport({ incident: fallbackIncident(raw) });
    assert.ok(report.includes(raw), "nothing of the problem is cut");
    assert.ok(report.length <= 2 * 1024 * 1024, `file was ${report.length} chars`);
    assert.match(report, /Jump started/);
});

test("D16 past 2 MB the reported problem is cut in the middle, keeping its start and end, and says so", () => {
    reset();
    logDebugEvent("turn", "Jump started");
    const raw = `START${"q".repeat(3_000_000)}END`;
    const report = buildDebugLogReport({ incident: fallbackIncident(raw) });
    assert.ok(report.length <= 2 * 1024 * 1024, `file was ${report.length} chars`);
    assert.match(report, /Raw model response: STARTq/);
    assert.match(report, /qEND/);
    assert.match(report, /\[… \d+ characters of the reported problem cut here to keep this file within 2 MB …\]/);
    assert.match(report, /Jump started/, "the log is kept");
});

test("D14 an entry logged as a problem shows under problems only, whatever its category", () => {
    reset();
    logDebugEvent("ai", "Task \"world-simulation\" failed: timed out", undefined, { problem: true });
    logDebugEvent("ai", "Task \"world-simulation\" started.");
    const shown = getLoggingFileEntries({});
    assert.deepEqual(shown.map((entry) => [entry.message.slice(0, 30), entry.problem]), [
        ["Task \"world-simulation\" starte", false],
        ["Task \"world-simulation\" failed", true],
    ]);
});

test("D9 the header says whether the Desktop log was included, unavailable or absent", () => {
    reset();
    withClock(() => {
        pageEntryAt(0, "game", "Loaded save");
        const included = buildDebugLogReport({
            desktop: { status: "included", entries: [desktopEntry(5, "server", "http.500", "a"), desktopEntry(6, "main", "updater", "b")] },
        });
        assert.match(included, /^Desktop log: included \(2 entries from the desktop app and server\)$/m);
        assert.match(buildDebugLogReport({ desktop: { status: "unavailable", entries: [] } }),
            /^Desktop log: unavailable — the local server did not answer/m);
        assert.match(buildDebugLogReport({ desktop: { status: "none", entries: [] } }),
            /^Desktop log: none on this platform$/m);
    });
});

test("D10 building the file asks the server for the Desktop log from the span's start", async () => {
    reset();
    logDebugEvent("game", "Loaded save");
    const spanStart = getDebugLogEntries()[0].at;
    const requested = [];
    const fetchImpl = async (url) => {
        requested.push(url);
        return new Response(JSON.stringify({ entries: [{ at: new Date().toISOString(), level: "error", source: "server", event: "http.500", message: "Disk full" }] }));
    };
    const report = await buildLoggingFile({ fetchImpl });
    assert.deepEqual(requested, [`/api/log?since=${encodeURIComponent(spanStart)}`]);
    assert.match(report, /\[server\] http\.500: Disk full/);
    assert.match(report, /^Desktop log: included \(1 entry from the desktop app and server\)$/m);
});

test("D11 a dead or silent server still gives a file, marked unavailable", async () => {
    reset();
    logDebugEvent("game", "Loaded save");
    const dead = await buildLoggingFile({ fetchImpl: async () => { throw new TypeError("fetch failed"); } });
    assert.match(dead, /^Desktop log: unavailable/m);
    assert.match(dead, /Loaded save/);
    const failing = await buildLoggingFile({ fetchImpl: async () => new Response("{}", { status: 500 }) });
    assert.match(failing, /^Desktop log: unavailable/m);
    const silent = await buildLoggingFile({ fetchImpl: () => new Promise(() => {}), timeoutMs: 20 });
    assert.match(silent, /^Desktop log: unavailable/m);
});

test("D12 a 404 means this platform has no Desktop log", async () => {
    reset();
    logDebugEvent("game", "Loaded save");
    const report = await buildLoggingFile({ fetchImpl: async () => new Response("{}", { status: 404 }) });
    assert.match(report, /^Desktop log: none on this platform$/m);
});

test("D13 View log shows the entries the file holds, newest first, with the problems marked", () => {
    reset();
    const desktop = {
        status: "included",
        entries: [
            desktopEntry(5, "server", "http.500", "Disk full"),
            { ...desktopEntry(15, "main", "updater", "Checking for update"), level: "info" },
        ],
    };
    const shown = withClock(() => {
        pageEntryAt(0, "game", "Loaded save");
        pageEntryAt(10, "warn", "Tile host slow");
        pageEntryAt(20, "crash", "Render crash caught by the error boundary.");
        return getLoggingFileEntries({ desktop });
    });
    assert.deepEqual(shown.map((entry) => [entry.message, entry.problem]), [
        ["Render crash caught by the error boundary.", true],
        ["updater: Checking for update", false],
        ["Tile host slow", true],
        ["http.500: Disk full", true],
        ["Loaded save", false],
    ]);
    assert.equal(shown.find((entry) => entry.message.includes("Disk full")).category, "server");
});

// ---- Group G: game settings in the Logging file -----------------------------

test("G1 the file lists every setting's value as it was saved, by section", () => {
    reset();
    logDebugEvent("turn", "Jump started");
    const report = buildDebugLogReport({
        settings: [
            { section: "Map", items: [["Hide country labels", "on"], ["Basemap", "scenario default"]] },
            { section: "AI", items: [["Model", "gemini-3.5-flash-lite"], ["API key", "set"]] },
        ],
    });
    const block = report.slice(report.indexOf("-- Settings when this file was saved --"), report.indexOf("-- Log (oldest first) --"));
    assert.match(block, /^Map:\n {2}Hide country labels: on\n {2}Basemap: scenario default$/m);
    assert.match(block, /^AI:\n {2}Model: gemini-3\.5-flash-lite\n {2}API key: set$/m);
});

test("G2 building the file reads every registered setting at that moment, and one that fails does not stop it", async () => {
    reset();
    let font = "Georgia";
    const off = [
        registerSettingsSnapshot("Map", () => [["Label font", font]]),
        registerSettingsSnapshot("Network", async () => [["Let other devices connect", "on"]]),
        registerSettingsSnapshot("Broken", () => { throw new Error("storage blocked"); }),
        // A section with nothing to say on this platform (the web build has no
        // server to share) is left out rather than printed empty.
        registerSettingsSnapshot("Nothing here", () => null),
    ];
    try {
        font = "Times New Roman";
        const report = await buildLoggingFile({ fetchImpl: async () => new Response("{}", { status: 404 }) });
        assert.match(report, /^ {2}Label font: Times New Roman$/m, "read when the file is built, not when registered");
        assert.match(report, /^ {2}Let other devices connect: on$/m);
        assert.match(report, /^Broken:\n {2}\(could not be read: storage blocked\)$/m);
        assert.equal(report.includes("Nothing here"), false);
    } finally {
        off.forEach((unregister) => unregister());
    }
});

test("G3 a setting's value is redacted like everything else", () => {
    reset();
    store.set("openai_compatible_api_key", "hunter2hunter2");
    const report = buildDebugLogReport({ settings: [{ section: "AI", items: [["Endpoint", "http://u:hunter2hunter2@gateway.local"]] }] });
    assert.equal(report.includes("hunter2hunter2"), false);
});

test("G4 a change is logged in words: switches turn on or off, values are set", () => {
    reset();
    logSettingChange("3D Globe", true);
    logSettingChange("Record AI telemetry", false);
    logSettingChange("Basemap", "World Imagery");
    assert.deepEqual(getDebugLogEntries().map((entry) => [entry.category, entry.message]), [
        ["setting", "3D Globe turned on."],
        ["setting", "Record AI telemetry turned off."],
        ["setting", "Basemap set to World Imagery."],
    ]);
});

test("G5 a typed setting is logged once it settles, not once per keystroke", () => {
    reset();
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
        for (const typed of ["T", "Ti", "Times", "Times New", "Times New Roman"]) {
            logSettingChange("Label font", typed, { settle: true });
            mock.timers.tick(200);
        }
        assert.equal(getDebugLogEntries().length, 0, "nothing while the player is still typing");
        mock.timers.tick(2000);
    } finally {
        mock.timers.reset();
    }
    assert.deepEqual(getDebugLogEntries().map((entry) => entry.message), ["Label font set to Times New Roman."]);
});

test("M1 a console line written under a mute is not captured a second time", () => {
    reset();
    installDebugLogCapture();
    // The originals still run; keep this test's lines out of the test output.
    const quiet = mock.method(process.stderr, "write", () => true);
    try {
        withConsoleCaptureMuted(() => console.error("Render crash caught by ErrorBoundary:", "boom"));
        console.error("An ordinary failure");
    } finally {
        quiet.mock.restore();
    }
    assert.deepEqual(getDebugLogEntries().map((entry) => entry.message), ["An ordinary failure"]);
});

test("I7 the filename says what the log was saved for", () => {
    assert.match(debugLogFilename("turn-fallback"), /^open-historia-log-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-turn-fallback\.txt$/);
    assert.match(debugLogFilename(), /^open-historia-log-[\dT-]+\.txt$/);
    assert.match(debugLogFilename("Advisor error!"), /-advisor-error\.txt$/);
});

// ---- The file's clock -------------------------------------------------------
// A player's report printed its line stamps in UTC beside the game's own
// "is busy; skipped until 23:26" in local time, so a ten-minute pause read as
// two hours and ten minutes. The stamps are local now, and the header says the
// offset.

const clockOf = (iso) => {
    const at = new Date(iso);
    return [at.getHours(), at.getMinutes(), at.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
};

test("K1 line stamps are this computer's local time, and the header says which offset that is", () => {
    reset();
    logDebugEvent("turn", "a stamped line");
    const entry = getDebugLogEntries().at(-1);
    const report = buildDebugLogReport();
    assert.ok(report.includes(`[${clockOf(entry.at)}] [turn] a stamped line`), "the line carries the local time of day");
    assert.match(report, /^Clock: the times below are this computer's local time \(UTC[+-]\d\d:\d\d\)/m);
    assert.equal(localClock("2026-09-22T21:16:38.000Z"), clockOf("2026-09-22T21:16:38.000Z"));
    assert.equal(localClock("not a time"), "");
    assert.equal(localClock(undefined), "");
});

test("K2 the offset is written the way a person reads it", () => {
    const at = (minutes) => ({ getTimezoneOffset: () => minutes });
    assert.equal(utcOffsetLabel(at(-120)), "UTC+02:00", "two hours east");
    assert.equal(utcOffsetLabel(at(240)), "UTC-04:00", "four hours west");
    assert.equal(utcOffsetLabel(at(0)), "UTC+00:00");
    assert.equal(utcOffsetLabel(at(-330)), "UTC+05:30", "and half hours");
});
