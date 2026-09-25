/*! Open Historia — Fallback list rule tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/fallbackRunner.test.js
//
// The Fallback list's rules (docs/world-state.md, "AI access"; ADR 0001):
// every call starts at the top and moves down only when an entry cannot answer.
// A short mark — busy, rate limited — says what a row shows, never where a call
// begins: it is worth one fast refusal to find out it has cleared. A Spent one
// does move the start, because its reset is hours away, but it only sinks to
// the back: the call still reaches it when nothing else has answered.
// fallbackRunner.js is import-free, so these drive it with a fake attempt and a
// fake clock — no network, no storage.
import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryStateStore, describeUnavailable, entryStatus, fallbackAvailability, runWithFallback } from "./fallbackRunner.js";

const entry = (id, provider = "gemini") => ({ id, provider, label: id });

// An attempt that answers or fails per entry, and records what was tried.
const scripted = (script) => {
    const tried = [];
    const attempt = async (e, context) => {
        tried.push(e.id);
        const step = script[e.id];
        const outcome = typeof step === "function" ? step(context) : step;
        if (outcome instanceof Error) throw outcome;
        return outcome ?? `answer from ${e.id}`;
    };
    return { attempt, tried };
};

// What a provider throws: the error carries how the failure was classified
// (providerErrors.js classifyProviderFailure).
const fail = (kind, extra = {}) => Object.assign(new Error(`${kind} failure`), {
    providerFailure: { kind, reason: extra.reason ?? kind, ...extra },
});

test("the top entry answers, so nothing else is tried", async () => {
    const { attempt, tried } = scripted({});
    const outcome = await runWithFallback({
        entries: [entry("a"), entry("b")],
        store: createMemoryStateStore(),
        now: () => 0,
        attempt,
    });
    assert.equal(outcome.result, "answer from a");
    assert.equal(outcome.entry.id, "a");
    assert.deepEqual(tried, ["a"]);
});

test("a Spent entry moves the call down, and is not asked again while the mark holds", async () => {
    const store = createMemoryStateStore();
    const entries = [entry("a"), entry("b")];
    const first = scripted({ a: fail("spent") });
    const outcome = await runWithFallback({ entries, store, now: () => 0, attempt: first.attempt });
    assert.equal(outcome.entry.id, "b");
    assert.deepEqual(first.tried, ["a", "b"]);
    assert.ok(store.get("a").spentUntil > 0, "the mark is kept: the Settings row says so");

    // The provider said the allowance is gone until a reset hours away. Asking
    // again on every call of every turn buys nothing but the refusal's latency.
    const second = scripted({});
    await runWithFallback({ entries, store, now: () => 1000, attempt: second.attempt });
    assert.deepEqual(second.tried, ["b"], "the call goes straight to the entry that can answer");

    // Once the mark expires it is back at the top on its own, unmarked.
    const afterReset = scripted({});
    await runWithFallback({ entries, store, now: () => store.get("a").spentUntil + 1, attempt: afterReset.attempt });
    assert.deepEqual(afterReset.tried, ["a"]);
});

test("a Spent entry is still tried when everything above it has failed", async () => {
    const store = createMemoryStateStore({ a: { spentUntil: 60_000 } });
    const entries = [entry("a"), entry("b")];

    // Being wrong about a reset must never be what fails a turn: `a` is last,
    // not gone, so a busy backup hands the call back to it.
    const { attempt, tried } = scripted({ b: fail("busy") });
    const outcome = await runWithFallback({ entries, store, now: () => 0, attempt });
    assert.deepEqual(tried, ["b", "a"], "the presumed-out entry is the last resort, not a lost one");
    assert.equal(outcome.entry.id, "a");
});

// Google resets the free tier at midnight Pacific time. The expected instants
// are worked out by hand: PST is UTC-8, PDT is UTC-7, and in 2026 the clocks go
// forward at 2am on Sunday 8 March.
test("a Spent Gemini entry comes back at the next midnight Pacific, across the daylight-saving change", async () => {
    const cases = [
        // Sat 7 Mar, 22:00 PST -> Sun 8 Mar, 00:00 PST
        ["2026-03-08T06:00:00Z", "2026-03-08T08:00:00Z"],
        // Sun 8 Mar, 13:00 PDT -> Mon 9 Mar, 00:00 PDT
        ["2026-03-08T20:00:00Z", "2026-03-09T07:00:00Z"],
        // Wed 1 Jul, 05:00 PDT -> Thu 2 Jul, 00:00 PDT
        ["2026-07-01T12:00:00Z", "2026-07-02T07:00:00Z"],
        // Sat 31 Oct, 23:30 PDT -> Sun 1 Nov, 00:00 PDT (the clocks go back at 2am, after it)
        ["2026-11-01T06:30:00Z", "2026-11-01T07:00:00Z"],
    ];
    for (const [nowIso, resetIso] of cases) {
        const store = createMemoryStateStore();
        const at = Date.parse(nowIso);
        await runWithFallback({ entries: [entry("a"), entry("b")], store, now: () => at, attempt: scripted({ a: fail("spent") }).attempt });
        assert.equal(new Date(store.get("a").spentUntil).toISOString(), new Date(resetIso).toISOString(), nowIso);
    }
});

test("an Unusable entry moves the call down, and says what went wrong", async () => {
    const store = createMemoryStateStore();
    const entries = [entry("a"), entry("b")];
    await runWithFallback({ entries, store, now: () => 0, attempt: scripted({ a: fail("unusable", { reason: "key rejected (401)" }) }).attempt });
    assert.equal(store.get("a").unusable, "key rejected (401)");

    const aWeekLater = scripted({});
    await runWithFallback({ entries, store, now: () => 7 * 24 * 60 * 60 * 1000, attempt: aWeekLater.attempt });
    assert.deepEqual(aWeekLater.tried, ["a"], "a key the player has since fixed answers again on its own");
});

test("a busy entry is marked for one minute, waits at the back until then, and is tried first again after", async () => {
    const store = createMemoryStateStore();
    const entries = [entry("a"), entry("b")];
    await runWithFallback({ entries, store, now: () => 0, attempt: scripted({ a: fail("busy") }).attempt });
    assert.deepEqual(store.get("a"), { skipUntil: 60_000, skipReason: "busy" }, "the row says busy for one minute");

    // A 503 is the provider saying it is overloaded, and a night's log showed
    // the refusals coming 10-70 s apart when asked again within the minute: so
    // the next call starts on the backup, and the busy one is reached only if
    // nothing else answers.
    const soon = scripted({});
    await runWithFallback({ entries, store, now: () => 1000, attempt: soon.attempt });
    assert.deepEqual(soon.tried, ["b"], "the backup answers; the busy entry is not asked");
    assert.deepEqual(store.get("a"), { skipUntil: 60_000, skipReason: "busy" }, "and its mark stands");

    // Nothing else answering, the busy entry is still tried rather than dropped.
    const alone = scripted({ b: fail("unusable", { reason: "model not found (404)" }) });
    await runWithFallback({ entries, store, now: () => 2000, attempt: alone.attempt });
    assert.deepEqual(alone.tried, ["b", "a"], "busy comes after everything that might answer, never out of the order");

    // A minute on, the strongest model is asked first again.
    const later = scripted({});
    await runWithFallback({ entries, store, now: () => 60_001, attempt: later.attempt });
    assert.deepEqual(later.tried, ["a"]);
    assert.deepEqual(store.get("a"), { lastAnsweredAt: 60_001 }, "it answered, so the mark is gone");
});

test("Rate limited on 'wait' fails as it always did, without falling back", async () => {
    const store = createMemoryStateStore();
    const { attempt, tried } = scripted({ a: fail("rateLimited", { waitMs: 35_000 }) });
    await assert.rejects(
        runWithFallback({ entries: [entry("a"), entry("b")], store, now: () => 0, rateLimitPolicy: "wait", attempt }),
        /rateLimited failure/,
    );
    assert.deepEqual(tried, ["a"], "the provider already waited; the backups' allowance is left alone");
    assert.equal(store.get("a"), undefined, "a pause is not a mark");
});

test("Rate limited on 'next' (the default) hands the call on, and is marked for as long as the provider asked", async () => {
    const entries = [entry("a"), entry("b")];
    for (const [waitMs, skipMs] of [[35_000, 35_000], [null, 60_000]]) {
        const store = createMemoryStateStore();
        const first = scripted({ a: fail("rateLimited", { waitMs }) });
        const outcome = await runWithFallback({ entries, store, now: () => 0, attempt: first.attempt });
        assert.equal(outcome.entry.id, "b");
        assert.deepEqual(store.get("a"), { skipUntil: skipMs, skipReason: "rate limited" });

        // A per-minute limit is over within the minute, so the call after it
        // goes back to the top rather than staying on the backup.
        const next = scripted({});
        await runWithFallback({ entries, store, now: () => 2000, attempt: next.attempt });
        assert.deepEqual(next.tried, ["a"], `marked until ${skipMs}ms, but never passed over`);
    }
});

test("busy and Spent marks move an entry back; Unusable and rate limited keep their place", async () => {
    const store = createMemoryStateStore();
    const entries = [entry("a"), entry("b"), entry("c"), entry("d")];
    await runWithFallback({
        entries, store, now: () => 0,
        attempt: scripted({
            a: fail("busy"),
            b: fail("spent"),
            c: fail("unusable", { reason: "model not found (404)" }),
        }).attempt,
    });

    // `c` may have caught the provider in a bad moment, so it is asked again
    // where it stands. `a` sits out its minute behind everything that
    // might answer, and `b` — which said its allowance is gone until a reset —
    // behind that.
    const retry = scripted({ c: fail("unusable", { reason: "model not found (404)" }) });
    const outcome = await runWithFallback({ entries, store, now: () => 10_000, attempt: retry.attempt });
    assert.deepEqual(retry.tried, ["c", "d"], "neither the busy nor the Spent entry is asked while another can answer");
    assert.equal(outcome.entry.id, "d");

    // With nothing else left, the order behind them holds: busy first, Spent last.
    const nothingElse = scripted({ c: fail("unusable", { reason: "model not found (404)" }), d: fail("unusable", { reason: "gone" }), a: fail("busy") });
    const last = await runWithFallback({ entries, store, now: () => 20_000, attempt: nothingElse.attempt });
    assert.deepEqual(nothingElse.tried, ["c", "d", "a", "b"]);
    assert.equal(last.entry.id, "b", "the Spent entry is the last hope, and it answered");
});

test("nothing is asked past the entry that answers, so a full list costs one request", async () => {
    // The failure this fixes: four Spent models refused before the fifth
    // answered, on every call of every turn.
    const store = createMemoryStateStore({
        a: { spentUntil: 60_000 }, b: { spentUntil: 60_000 }, c: { spentUntil: 60_000 }, d: { spentUntil: 60_000 },
    });
    const entries = ["a", "b", "c", "d", "e"].map((id) => entry(id));
    const { attempt, tried } = scripted({});
    const outcome = await runWithFallback({ entries, store, now: () => 0, attempt });
    assert.deepEqual(tried, ["e"]);
    assert.equal(outcome.entry.id, "e");
});

test("a failure that says nothing about the entry fails the call, as it always did", async () => {
    const store = createMemoryStateStore();
    const { attempt, tried } = scripted({ a: fail("other") });
    await assert.rejects(runWithFallback({ entries: [entry("a"), entry("b")], store, now: () => 0, attempt }), /other failure/);
    assert.deepEqual(tried, ["a"]);
    assert.equal(store.get("a"), undefined);

    // An error with no classification at all (a bug, a parse failure) likewise.
    const plain = scripted({ a: new Error("boom") });
    await assert.rejects(runWithFallback({ entries: [entry("a"), entry("b")], store, now: () => 0, attempt: plain.attempt }), /boom/);
    assert.deepEqual(plain.tried, ["a"]);
});

test("the provider is told whether there is anything left to fall back to", async () => {
    const seen = {};
    const attempt = async (e, context) => {
        seen[e.id] = context.canFallBack;
        if (e.id !== "c") throw fail("spent");
        return "ok";
    };
    await runWithFallback({ entries: [entry("a"), entry("b"), entry("c")], store: createMemoryStateStore(), now: () => 0, attempt });
    assert.deepEqual(seen, { a: true, b: true, c: false }, "the last one keeps its full retries");
});

test("a streamed reply never falls back once part of it has been shown", async () => {
    const shown = [];
    const { attempt, tried } = scripted({
        a: (context) => {
            context.onChunk("Half a ", "Half a ");
            return fail("busy");
        },
    });
    await assert.rejects(runWithFallback({
        entries: [entry("a"), entry("b")],
        store: createMemoryStateStore(),
        now: () => 0,
        onChunk: (delta) => shown.push(delta),
        attempt,
    }), /busy failure/);
    assert.deepEqual(shown, ["Half a "], "the chunk still reached the player");
    assert.deepEqual(tried, ["a"], "a different model restarting the reply would read as a glitch");
});

test("a streamed reply that fails before any of it arrives falls back", async () => {
    const { attempt, tried } = scripted({ a: fail("busy") });
    const outcome = await runWithFallback({
        entries: [entry("a"), entry("b")],
        store: createMemoryStateStore(),
        now: () => 0,
        onChunk: () => {},
        attempt,
    });
    assert.equal(outcome.entry.id, "b");
    assert.deepEqual(tried, ["a", "b"]);
});

test("a task's own pick is tried first, then the list from the top", async () => {
    const entries = [entry("strong"), entry("mid"), entry("lite")];
    const pickAnswers = scripted({});
    const outcome = await runWithFallback({ entries, preferredEntryId: "lite", store: createMemoryStateStore(), now: () => 0, attempt: pickAnswers.attempt });
    assert.equal(outcome.entry.id, "lite");
    assert.deepEqual(pickAnswers.tried, ["lite"]);

    const pickSpent = scripted({ lite: fail("spent") });
    await runWithFallback({ entries, preferredEntryId: "lite", store: createMemoryStateStore(), now: () => 0, attempt: pickSpent.attempt });
    assert.deepEqual(pickSpent.tried, ["lite", "strong"], "never tried twice, and the list starts from the top");

    // A pick that names an entry no longer in the list is ignored.
    const stale = scripted({});
    await runWithFallback({ entries, preferredEntryId: "deleted", store: createMemoryStateStore(), now: () => 0, attempt: stale.attempt });
    assert.deepEqual(stale.tried, ["strong"]);
});

test("when every entry is Spent, the call says which comes back first, and when", async () => {
    const store = createMemoryStateStore();
    const entries = [entry("gem"), entry("oai", "openai")];
    const at = Date.parse("2026-07-01T12:00:00Z");
    const error = await runWithFallback({
        entries, store, now: () => at,
        attempt: scripted({ gem: fail("spent"), oai: fail("spent") }).attempt,
        formatTime: (ms) => new Date(ms).toISOString(),
    }).catch((caught) => caught);
    // The OpenAI entry is back in an hour; Gemini not until midnight Pacific.
    assert.equal(error.fallbackUnavailable.nextResetAt, at + 60 * 60 * 1000);
    assert.equal(error.fallbackUnavailable.nextEntry.id, "oai");
    assert.equal(error.message, "Every model in your Fallback list has used its allowance for now. The first back is oai, at 2026-07-01T13:00:00.000Z.");

    // What the time-skip gate asks before starting a turn.
    assert.deepEqual(fallbackAvailability({ entries, store, now: () => at }), {
        canAnswer: false, nextResetAt: at + 60 * 60 * 1000, nextEntry: entries[1],
    });
    assert.equal(fallbackAvailability({ entries, store, now: () => at + 60 * 60 * 1000 }).canAnswer, true);

    // The next call asks them both again, and when they fail the same way it
    // says the same thing, from the newer guess.
    const again = scripted({ gem: fail("spent"), oai: fail("spent") });
    const second = await runWithFallback({ entries, store, now: () => at + 1000, attempt: again.attempt, formatTime: String }).catch((caught) => caught);
    assert.deepEqual(again.tried, ["gem", "oai"]);
    assert.equal(second.fallbackUnavailable.nextResetAt, at + 1000 + 60 * 60 * 1000);
});

test("when no entry can ever answer, the call says what is wrong with the first", async () => {
    const store = createMemoryStateStore();
    const error = await runWithFallback({
        entries: [entry("a"), entry("b")], store, now: () => 0,
        attempt: scripted({ a: fail("unusable", { reason: "key rejected (401)" }), b: fail("unusable", { reason: "model not found (404)" }) }).attempt,
    }).catch((caught) => caught);
    assert.equal(error.message, "No model in your Fallback list can answer. a: key rejected (401). Fix it in Settings → AI.");
    assert.equal(error.fallbackUnavailable.nextResetAt, null);
    // The time-skip gate says the same thing before a turn is started.
    assert.equal(describeUnavailable({ entries: [entry("a"), entry("b")], store, now: () => 0 }), error.message);
});

test("a switch is still announced when the call that found it then fails", async () => {
    const switches = [];
    await assert.rejects(runWithFallback({
        entries: [entry("a"), entry("b")],
        store: createMemoryStateStore(),
        now: () => 0,
        attempt: scripted({ a: fail("spent"), b: fail("other") }).attempt,
        onSwitch: ({ skipped, to }) => switches.push({ from: skipped.map(({ entry: e }) => e.id), to: to?.id ?? null }),
    }), /other failure/);
    assert.deepEqual(switches, [{ from: ["a"], to: null }], "later calls go to b, so the player must hear about a now");
});

test("an empty list can never answer", () => {
    assert.deepEqual(fallbackAvailability({ entries: [], store: createMemoryStateStore(), now: () => 0 }), {
        canAnswer: false, nextResetAt: null, nextEntry: null,
    });
});

test("the player is told once per switch, however many calls follow it", async () => {
    const store = createMemoryStateStore();
    const entries = [entry("a"), entry("b")];
    const switches = [];
    const onSwitch = (details) => switches.push({ from: details.skipped.map(({ entry: e, failure }) => `${e.id}:${failure.kind}`), to: details.to.id });

    // Two calls of one turn in flight together, both reaching "a" before
    // either learns it is Spent.
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const attempt = async (e) => {
        if (e.id === "a") { await gate; throw fail("spent"); }
        return "ok";
    };
    const both = Promise.all([
        runWithFallback({ entries, store, now: () => 0, attempt, onSwitch }),
        runWithFallback({ entries, store, now: () => 0, attempt, onSwitch }),
    ]);
    release();
    await both;
    // And the rest of the turn, which tries "a" again each time and finds it
    // Spent each time: already marked, so the player hears it once.
    for (let call = 0; call < 5; call += 1) await runWithFallback({ entries, store, now: () => 0, attempt, onSwitch });

    assert.deepEqual(switches, [{ from: ["a:spent"], to: "b" }]);
});

test("every mark is reported, for the Diagnostics log", async () => {
    const marks = [];
    await runWithFallback({
        entries: [entry("a"), entry("b"), entry("c")],
        store: createMemoryStateStore(),
        now: () => 0,
        attempt: scripted({ a: fail("unusable", { reason: "key rejected (401)" }), b: fail("busy") }).attempt,
        onMark: ({ entry: e, state }) => marks.push([e.id, state]),
    });
    assert.deepEqual(marks, [
        ["a", { unusable: "key rejected (401)" }],
        ["b", { skipUntil: 60_000, skipReason: "busy" }],
    ]);
});

// ADR 0001: fallback, never rotation.
test("calls never spread across entries while the top one can answer", async () => {
    const store = createMemoryStateStore();
    const { attempt, tried } = scripted({});
    for (let call = 0; call < 20; call += 1) {
        await runWithFallback({ entries: [entry("a"), entry("b"), entry("c")], store, now: () => call * 1000, attempt });
    }
    assert.deepEqual([...new Set(tried)], ["a"]);
});

test("each row says whether its entry is ready, Spent, Unusable or busy, and when it last answered", async () => {
    const store = createMemoryStateStore();
    const entries = [entry("a"), entry("b", "openai"), entry("c"), entry("d")];
    await runWithFallback({
        entries, store, now: () => 1000,
        attempt: scripted({ a: fail("unusable", { reason: "key rejected (401)" }), b: fail("spent"), c: fail("busy") }).attempt,
    });
    const at = 2000;
    assert.deepEqual(entryStatus(store.get("a"), at), { status: "unusable", reason: "key rejected (401)", until: null, lastAnsweredAt: null });
    assert.deepEqual(entryStatus(store.get("b"), at), { status: "spent", reason: "", until: 1000 + 60 * 60 * 1000, lastAnsweredAt: null });
    assert.deepEqual(entryStatus(store.get("c"), at), { status: "busy", reason: "busy", until: 61_000, lastAnsweredAt: null });
    assert.deepEqual(entryStatus(store.get("d"), at), { status: "ready", reason: "", until: null, lastAnsweredAt: 1000 });
    assert.deepEqual(entryStatus(undefined, at), { status: "ready", reason: "", until: null, lastAnsweredAt: null });
    // A mark that has run out reads as ready again.
    assert.equal(entryStatus(store.get("c"), 61_000).status, "ready");
});

test("a Spent entry on another provider is marked for an hour", async () => {
    const store = createMemoryStateStore();
    const entries = [entry("a", "openai"), entry("b")];
    await runWithFallback({ entries, store, now: () => 0, attempt: scripted({ a: fail("spent") }).attempt });
    assert.equal(store.get("a").spentUntil, 60 * 60 * 1000, "OpenAI does not say when it resets");

    // Until then the row says Spent, the gate before a time skip counts it as
    // unable to answer, and calls go round it. It is reached again only as a
    // last resort — and a try that finds it still spent puts the guess an hour
    // further out.
    assert.equal(entryStatus(store.get("a"), 59 * 60 * 1000).status, "spent");
    const lastResort = scripted({ a: fail("spent"), b: fail("busy") });
    await runWithFallback({ entries, store, now: () => 59 * 60 * 1000, attempt: lastResort.attempt }).catch(() => {});
    assert.deepEqual(lastResort.tried, ["b", "a"], "the backup first, then the guess");
    assert.equal(store.get("a").spentUntil, 119 * 60 * 1000);

    // Past the new guess it is back at the top, and answering clears the mark.
    const back = scripted({});
    await runWithFallback({ entries, store, now: () => 120 * 60 * 1000, attempt: back.attempt });
    assert.deepEqual(back.tried, ["a"]);
    assert.equal(entryStatus(store.get("a"), 120 * 60 * 1000).status, "ready");
});

// --- the context preflight (contextWindow.js) ---

test("an entry the request cannot fit is passed over without a request, and is not marked", async () => {
    const store = createMemoryStateStore();
    const entries = [entry("small", "openai"), entry("big")];
    const { attempt, tried } = scripted({});
    const marks = [];
    const outcome = await runWithFallback({
        entries, store, now: () => 0, attempt,
        canAttempt: (candidate) => (candidate.id === "small" ? "this request is about 47K tokens and the model's window is 33K" : ""),
        onMark: (mark) => marks.push(mark),
    });
    assert.equal(outcome.entry.id, "big");
    assert.deepEqual(tried, ["big"], "nothing was sent to the small model");
    assert.equal(entryStatus(store.get("small"), 1).status, "ready", "the entry is fine; the request was the problem");
    assert.equal(marks.length, 1);
    assert.equal(marks[0].failure.kind, "tooBig");
    assert.equal(marks[0].state, null);
});

test("when no entry can fit the request, the call fails before anything is sent", async () => {
    const { attempt, tried } = scripted({});
    const switches = [];
    await assert.rejects(
        runWithFallback({
            entries: [entry("a", "openai"), entry("b", "openai")],
            store: createMemoryStateStore(), now: () => 0, attempt,
            canAttempt: () => "too big",
            tooBigError: (refused) => new Error(`nothing fits: ${refused.map((r) => r.entry.id).join(",")}`),
            onSwitch: (detail) => switches.push(detail),
        }),
        /nothing fits: a,b/,
    );
    assert.deepEqual(tried, [], "not one request was spent");
    assert.equal(switches.length, 1);
    assert.equal(switches[0].to, null);
});

test("a model that refuses the request as too big is passed over for the next entry, with the entry left unmarked", async () => {
    const store = createMemoryStateStore();
    const entries = [entry("small", "openai"), entry("big")];
    const { attempt, tried } = scripted({ small: fail("tooBig", { reason: "maximum context length is 32768 tokens" }) });
    const outcome = await runWithFallback({ entries, store, now: () => 0, attempt });
    assert.equal(outcome.entry.id, "big");
    assert.deepEqual(tried, ["small", "big"]);
    assert.equal(entryStatus(store.get("small"), 1).status, "ready");
});

test("a request every model refused as too big fails with the last model's own words", async () => {
    const { attempt } = scripted({ a: fail("tooBig", { reason: "too big for a" }), b: fail("tooBig", { reason: "too big for b" }) });
    await assert.rejects(
        runWithFallback({ entries: [entry("a", "openai"), entry("b", "openai")], store: createMemoryStateStore(), now: () => 0, attempt }),
        /tooBig failure/,
    );
});
