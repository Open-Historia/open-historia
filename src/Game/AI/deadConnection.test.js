/*! Open Historia — a dead connection is not a busy provider: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/deadConnection.test.js
//
// From a player's log. Their local model server went down mid-answer:
//
//   [ai-call] task "jumpForward": call FAILED after 88.7s.  TypeError: network error
//   [warn] task "jumpForward" — (no response body — … usually means the provider
//          URL, API key or model name is wrong …)
//   [server] http.502:  (ECONNREFUSED) (×6)
//   [warn] OpenAI Compatible is busy. Retrying in 15s... (attempt 1/3) (×2)
//   [ai] Task "projects" failed: OpenAI Compatible is busy right now. Try again in a moment.
//
// Nothing there was busy and nothing was misconfigured. What each failure is
// (a wording, a relay's mark) is pinned in providerErrors.test.js,
// relayResponse.test.js and server/relay.test.js; this pins what the game then
// DOES with it. The Fallback
// list is driven for real (fallbackRunner.js is import-free); main.jsx,
// gameplay.js and time.jsx are read as source, since they cannot be imported
// without the whole app.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createMemoryStateStore, entryStatus, runWithFallback } from "./fallbackRunner.js";
import {
    CONNECTION_CLOSED_MESSAGE,
    asUnreachable,
    classifyProviderFailure,
    isUnreachableFailure,
    shouldRetryProviderFailure,
    unreachableServerError,
} from "./providerErrors.js";
import { CONNECTION_CLOSED_RESPONSE, NO_RESPONSE_BODY_NOTE, isNoResponseNote } from "./simulationStatus.js";

const main = fs.readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const time = fs.readFileSync(new URL("../GameUI/time.jsx", import.meta.url), "utf8");

const entry = (id) => ({ id, provider: "openai-compatible", label: id });

// One call down the list, the way callAI makes it: whatever an attempt throws
// goes through asUnreachable first.
const callDownTheList = async (entries, store, script) => {
    const tried = [];
    const marks = [];
    try {
        const outcome = await runWithFallback({
            entries,
            store,
            now: () => 1000,
            attempt: async (candidate) => {
                tried.push(candidate.id);
                try {
                    return await script[candidate.id]();
                } catch (error) {
                    throw asUnreachable(error, null);
                }
            },
            onMark: ({ entry: marked, failure }) => marks.push([marked.id, failure.reason]),
        });
        return { answer: outcome.result, by: outcome.entry.id, tried, marks };
    } catch (error) {
        return { error, tried, marks };
    }
};

test("a connection that breaks mid-answer moves the call to the next entry, which answers", async () => {
    const store = createMemoryStateStore();
    const outcome = await callDownTheList([entry("koboldcpp"), entry("backup")], store, {
        koboldcpp: async () => { throw new TypeError("network error"); },
        backup: async () => "a real turn",
    });
    assert.equal(outcome.answer, "a real turn", "it used to fail here, and the skip went to canned events");
    assert.deepEqual(outcome.tried, ["koboldcpp", "backup"]);
    assert.deepEqual(outcome.marks, [["koboldcpp", "could not be reached"]]);
    assert.equal(entryStatus(store.get("koboldcpp"), 1000).status, "busy", "skipped for a minute, then tried again");
});

test("with nothing to fall back to, it fails once, at once, with the sentence that says what happened", async () => {
    const store = createMemoryStateStore();
    const outcome = await callDownTheList([entry("koboldcpp")], store, {
        koboldcpp: async () => { throw new TypeError("network error"); },
    });
    assert.deepEqual(outcome.tried, ["koboldcpp"], "asked once: no retry is added");
    assert.equal(outcome.error.message, CONNECTION_CLOSED_MESSAGE);
    assert.equal(isUnreachableFailure(outcome.error.providerFailure), true);
    assert.equal(outcome.error.providerFailure.midAnswer, true);
});

test("the relay's 502 for a server that is not running is thrown as that before anything reads its status", () => {
    // Where the relay's answer comes back, for every caller alike: the chat
    // request of either compatible provider, and the model list.
    const from = main.indexOf("const relayFetch = async (");
    const relayed = main.slice(from, main.indexOf("const directFetch = ", from));
    const marked = relayed.indexOf("if (isRelayUnreachable(response)) {");
    const handedBack = relayed.indexOf("return withRelayCutoffHint(response, signal);");
    assert.ok(marked > -1 && handedBack > marked, "checked before the response is handed to a caller");
    assert.match(relayed.slice(marked, handedBack),
        /throw unreachableServerError\(endpointOrigin\(url\), relayUnreachableReason\(await readErrorPayload\(response\)\)\);/,
        "named by the address that was tried, with the socket's code for why");
    assert.equal(main.split('fetch("/api/ai/relay"').length - 1, 1, "the one place the relay is asked");
});

test("a server the relay could not reach moves the call to the next entry, or fails once with the sentence that names it", async () => {
    const down = () => { throw unreachableServerError("http://localhost:5001", "ECONNREFUSED"); };

    const store = createMemoryStateStore();
    const moved = await callDownTheList([entry("koboldcpp"), entry("backup")], store, { koboldcpp: down, backup: async () => "a real turn" });
    assert.equal(moved.answer, "a real turn");
    assert.deepEqual(moved.marks, [["koboldcpp", "could not be reached"]]);
    assert.equal(entryStatus(store.get("koboldcpp"), 1000).status, "busy", "skipped for a minute, then tried again");

    const alone = await callDownTheList([entry("koboldcpp")], createMemoryStateStore(), { koboldcpp: down });
    assert.deepEqual(alone.tried, ["koboldcpp"], "asked once: no waiting, no second request");
    assert.equal(alone.error.message,
        "http://localhost:5001 could not be reached (ECONNREFUSED). Check that the AI server is running and that its address in Settings → AI is right.");
    assert.equal(isUnreachableFailure(alone.error.providerFailure), true);
    assert.equal(alone.error.providerFailure.midAnswer, undefined, "it never answered at all: the report does not say it broke mid-answer");
});

test("a relayed 502 that is read by its body is still not a busy provider", () => {
    // The second line: anything that reads the relay's JSON without its header
    // (classifyProviderFailure) comes to the same failure, and is not waited on.
    const payload = { error: "connect ECONNREFUSED 127.0.0.1:5001", code: "ECONNREFUSED", unreachable: true };
    const failure = classifyProviderFailure({ status: 502, payload });
    assert.equal(isUnreachableFailure(failure), true);
    // The last entry of the list kept its three attempts and their 15 s waits
    // for anything "busy"; this is the decision that ends them.
    assert.equal(shouldRetryProviderFailure({ failure, attempt: 1, retries: 3, canFallBack: false, rateLimitPolicy: "wait" }), false);

    // And that decision is the one the provider path acts on, before it sleeps.
    const from = main.indexOf("async function retryOrFailByStatus(");
    const retry = main.slice(from, main.indexOf("async function streamTextSSE(", from));
    const decided = retry.indexOf("if (!shouldRetryProviderFailure({ failure, attempt, retries, canFallBack, rateLimitPolicy })");
    const slept = retry.indexOf("await sleep(wait, signal);");
    assert.ok(decided > -1 && slept > decided, "thrown before any wait");
    assert.match(retry, /const failure = classifyProviderFailure\(\{ status: response\.status, payload \}\);/);
});

test("every provider call's failure goes through asUnreachable on its way to the Fallback list", () => {
    assert.match(main, /\.catch\(\(error\) => \{ rememberContextWindow\(entry, error\); throw asUnreachable\(error, providerOpts\.signal\); \}\)/);
    assert.match(main, /default: return isUnreachableFailure\(failure\) \? "could not be reached" : "is busy";/,
        "and the notice names the entry as one that could not be reached");
});

test("a model server that is down when its models are listed is not marked Unusable", () => {
    const from = main.indexOf("async function resolveConfiguredModel(");
    const resolve = main.slice(from, main.indexOf("async function listServedModelIds(", from));
    assert.match(resolve, /classifyProviderFailure\(\{ status: response\.status, payload \}\)/);
    // The relay's own error (relayFetch) is handed on as it is: it says the
    // server could not be reached and where, and "enter a model manually"
    // would send the player to the wrong setting.
    const handedOn = resolve.indexOf("if (isUnreachableFailure(error?.providerFailure)) throw error;");
    const reworded = resolve.indexOf("`Could not auto-detect a model for ${providerLabel}. Enter a model manually in **settings**.`");
    assert.ok(handedOn > -1 && reworded > handedOn);
    // A browser that could not connect at all is the same failure, never Unusable.
    assert.match(resolve, /isUnreachableError\(error\)\s*\? \{ \.\.\.UNREACHABLE_FAILURE \}\s*: \{ kind: "unusable", reason: "no model found on the server" \}/);
});

test("a fallback's report blames the connection when it was the connection", () => {
    assert.equal(isNoResponseNote(NO_RESPONSE_BODY_NOTE), true);
    assert.equal(isNoResponseNote(CONNECTION_CLOSED_RESPONSE), true);
    assert.equal(isNoResponseNote("{\"events\":[]}"), false);
    assert.equal(isNoResponseNote(""), false);
    assert.doesNotMatch(CONNECTION_CLOSED_RESPONSE, /is wrong/, "it does not send the reader to the provider settings");
    assert.match(CONNECTION_CLOSED_RESPONSE, /connection closed or broke/);

    const from = gameplay.indexOf("const runJsonTask = async");
    const runner = gameplay.slice(from, gameplay.indexOf("// When a pass is due", from));
    assert.match(runner, /if \(actualError\?\.providerFailure\?\.midAnswer\) connectionClosedMidAnswer = true;/);
    assert.match(runner, /: connectionClosedMidAnswer \? CONNECTION_CLOSED_RESPONSE : NO_RESPONSE_BODY_NOTE\);/);
    // The saved report labels either note "Model response", never "Raw model
    // response that was rejected".
    assert.match(time, /isNoResponseNote\(record\.rawResponse\)\s*\? "Model response"/);
});
