/*! Open Historia — an answer that stopped before it was finished: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/unfinishedAnswer.test.js
//
// Read as source, like checksHold.test.js: main.jsx and gameplay.js cannot be
// imported without the whole app. What is pinned is ROUTING, which is where the
// two faults lived:
//   - a stream that closed early came back as an ordinary answer, so the task
//     runner called half a tool call "unparseable JSON" and asked again;
//   - an answer stopped at the provider's output limit was asked for again
//     under the same limit (a player's log: 4,171 characters, then 4,173).
// What the readers and the two sentences themselves do is pinned in
// streamAssembly.test.js and providerErrors.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

const body = (source, start, end) => {
    const from = source.indexOf(start);
    assert.notEqual(from, -1, `${start} not found`);
    const to = source.indexOf(end, from + start.length);
    assert.notEqual(to, -1, `${end} not found after ${start}`);
    return source.slice(from, to);
};

test("every provider's envelope is checked for a stream that closed early, before anything is read out of it", () => {
    const readers = [
        ["readGeminiStreamedResponse(response,", "extractGeminiToolInput(data, tool)"],
        ["readOpenAIStreamedResponse(response,", "extractOpenAIToolInput(data, tool)"],
        ["readAnthropicStreamedResponse(response,", "extractAnthropicToolInput(data, tool)"],
    ];
    for (const [read, extract] of readers) {
        let from = 0;
        let seen = 0;
        for (;;) {
            const at = main.indexOf(read, from);
            if (at === -1) break;
            const used = main.indexOf(extract, at);
            const checked = main.indexOf("refuseCutShortAnswer(data, ", at);
            assert.ok(checked > at && checked < used, `${read} is followed by the check, then ${extract}`);
            seen += 1;
            from = at + read.length;
        }
        assert.ok(seen >= 1, `${read} is still called`);
    }
    // Native Anthropic and the Anthropic-compatible proxy each read their own.
    assert.equal(main.split("readAnthropicStreamedResponse(response,").length - 1, 2);
});

test("a cut-short answer is refused as a closed connection, unless what arrived is still the JSON asked for", () => {
    const refuse = body(main, "const refuseCutShortAnswer = ", "\n};");
    assert.match(refuse, /if \(!data\?\.endedEarly \|\| extractJsonPayload\(text\)\) return;/);
    assert.match(refuse, /throw connectionClosedError\(\);/);
});

test("the chat reader fails a reply whose stream closed without the provider finishing", () => {
    const reader = body(main, "async function streamTextSSE(", "// One incremental text chunk per provider's stream event.");
    assert.match(reader, /if \(payload === "\[DONE\]"\) ended = true;/);
    assert.match(reader, /if \(streamFrameEnds\(json\)\) ended = true;/);
    assert.match(reader, /if \(!ended && !streamError\) throw connectionClosedError\(\);/);
});

test("a buffered body that stops partway is a closed connection too, not 'Unexpected end of JSON input'", () => {
    const read = body(main, "async function readJsonAnswer(", "// The same for a stream.");
    assert.match(read, /if \(isCutShortJson\(text\)\) throw connectionClosedError\(error\);/);
});

test("callAI tells the task runner when the answer it hands back was stopped at the output limit", () => {
    assert.match(main, /onOutputLimit: tellOutputLimit = null,/);
    assert.match(main, /stoppedAtLimit = stoppedAtOutputLimit\(data\);/);
    const told = main.indexOf("tellOutputLimit?.();");
    const returned = main.indexOf("return result;", told);
    assert.ok(told > -1 && returned > told, "told before the answer is handed back");
    assert.match(main.slice(main.lastIndexOf("if (stoppedAtLimit) {", told), told), /logDebugEvent\("ai-call", `\$\{label\}: [^\n]*stopped at its output limit/,
        "and said in the log without detailed mode, where a turn that then falls back is otherwise unexplained");
});

test("the task runner does not ask again for an answer cut at the output limit with nothing usable in it", () => {
    const runner = body(gameplay, "const runJsonTask = async", "\n// When a pass is due");
    assert.match(runner, /onOutputLimit: \(\) => \{ cutAtOutputLimit = true; \},/);
    assert.match(runner, /const unusableCut = cutAtOutputLimit && !parsed;/);
    assert.match(runner, /error: unusableCut \? OUTPUT_LIMIT_MESSAGE : "Response did not contain parseable JSON or tool arguments\." \}/);
    // The flag is per attempt, and the stop comes before the retry is queued.
    const attempt = runner.indexOf("for (let outputAttempt = 1; outputAttempt <= 2; outputAttempt += 1) {");
    const flag = runner.indexOf("let cutAtOutputLimit = false;");
    const stop = runner.indexOf("if (unusableCut) {");
    const retry = runner.indexOf("if (outputAttempt === 1 && !controller.signal.aborted) {");
    assert.ok(attempt > -1 && flag > attempt, "reset for each attempt");
    assert.ok(stop > flag && retry > stop, "stopped before the corrective request is built");
    assert.match(runner.slice(stop, retry), /break;/);
});

test("an answer the salvage can still read keeps today's handling", () => {
    // unusableCut is false once anything parsed, so validation, schema salvage
    // and the corrective retry all run exactly as they did.
    const runner = body(gameplay, "const runJsonTask = async", "\n// When a pass is due");
    const parsed = runner.indexOf("let parsed = response?.toolInput ?? unwrapMimickedToolCall(extractJsonPayload(rawText), tool?.name);");
    const cut = runner.indexOf("const unusableCut = cutAtOutputLimit && !parsed;");
    assert.ok(parsed > -1 && cut > parsed, "judged on what the salvage read, not on the provider's word alone");
});
