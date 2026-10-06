/*! Open Historia — the skip's progress row shows that its request is alive: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/skipProgressRow.test.js
//
// A player cancelled seven skips that were each still being answered, because
// for minutes the row showed a spinner and one unchanging line. The row now
// carries the time since the skip started and what the open request is doing.
// What the request path reports, and when, is pinned in
// AI/requestActivity.test.js and AI/streamAssembly.test.js. Here:
//   - the four sentences are exactly the ones the language packs carry, and
//     are read out of the source as fixed strings, never as a pattern;
//   - the clock is the skip's and ticks inside the row;
//   - every transport reports to it;
//   - a cancelled turn's log line says what the request had received.
// time.jsx and main.jsx are read as source: they cannot be imported without
// the whole app.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { extractFromSource } from "../../../scripts/i18n/extractStrings.mjs";

const time = fs.readFileSync(new URL("./time.jsx", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../AI/main.jsx", import.meta.url), "utf8");

const slice = (source, start, end) => {
    const from = source.indexOf(start);
    assert.notEqual(from, -1, `${start} not found`);
    const to = source.indexOf(end, from + start.length);
    assert.notEqual(to, -1, `${end} not found after ${start}`);
    return source.slice(from, to);
};

const SENTENCES = [
    "Waiting for the model to answer…",
    "The model is thinking…",
    "The model is writing its answer…",
    "Still working: a slow model can take several minutes. The request is still open.",
];

test("the row's four sentences are fixed strings, read out of the source exactly as the packs carry them", () => {
    const { exact, patterns, error } = extractFromSource(time, "src/Game/GameUI/time.jsx", { messages: true });
    assert.equal(error, undefined);
    for (const sentence of SENTENCES) assert.ok(exact.has(sentence), `${sentence} is in the catalog`);
    // The elapsed time changes every second: it must never be part of a string
    // a language pack would have to match (a pattern), nor sit beside one.
    const built = [...patterns.keys()].filter((pattern) => SENTENCES.some((sentence) => pattern.includes(sentence.slice(0, 18))) || /\{\{clock\}\}/.test(pattern));
    assert.deepEqual(built, []);
});

test("which sentence is shown follows what the open request is doing, and nothing is shown when none is open", () => {
    const text = slice(time, "const REQUEST_STATE_TEXT = Object.freeze({", "});");
    assert.match(text, /\[REQUEST_STATE\.waiting\]: "Waiting for the model to answer…",/);
    assert.match(text, /\[REQUEST_STATE\.thinking\]: "The model is thinking…",/);
    assert.match(text, /\[REQUEST_STATE\.writing\]: "The model is writing its answer…",/);
    const status = slice(time, "const RequestStatus = (", "// What the skip is doing, and the way out.");
    assert.match(status, /=> \(request \? \(/, "no request open: no second line");
    assert.match(status, /\) : null\);/);
    assert.match(status, /<span>\{REQUEST_STATE_TEXT\[request\.state\]/, "each sentence in an element of its own");
    assert.match(status, /\{request\.stillWorking && \(/, "the minute is counted on the request, by requestActivity.js");
    assert.match(status, /<span>Still working: a slow model can take several minutes\. The request is still open\.<\/span>/);
});

test("the clock is the skip's own start time, drawn in an element of its own that is never translated", () => {
    const clock = slice(time, "const SkipClock = (", "// The second line:");
    assert.match(clock, /<span data-no-translate className="oh-skip-clock" data-clock=\{clock\}/);
    assert.equal(/>\s*\{clock\}\s*</.test(clock), false, "not written as text: a text change every second has the translator re-read the page");
    assert.match(time, /\.oh-skip-clock::after \{\s*content: attr\(data-clock\);/);
    // Since the skip started, not since the row was mounted: the widget keeps the
    // time and hands it to the row in both panels.
    assert.match(time, /const \[progressStartedAt, setProgressStartedAt\] = useState\(0\);/);
    assert.equal(time.split("setProgressStartedAt(startedAt);").length - 1, 2, "set when a skip starts and when a held turn's retry does");
    assert.match(time, /\{isLoading && <SkipProgressRow label=\{progressLabel\} onCancel=\{onCancel\} startedAt=\{progressStartedAt\} \/>\}/);
    assert.match(time, /progress=\{skipInFlight \? \{ label: jumpProgress, onCancel: cancelJump, startedAt: progressStartedAt \} : null\}/);
    assert.match(time, /<SkipProgressRow label=\{progress\.label\} onCancel=\{progress\.onCancel\} startedAt=\{progress\.startedAt\} \/>/);
    const hook = slice(time, "const useSkipProgress = (startedAt) => {", "// The clock itself.");
    assert.match(hook, /clock: startedAt > 0 \? formatElapsed\(reading\.at - startedAt\) : "",/);
});

test("the ticking state lives in the row, so a tick does not re-render the panel around it", () => {
    const hook = slice(time, "const useSkipProgress = (startedAt) => {", "// The clock itself.");
    assert.match(hook, /const \[reading, setReading\] = useState\(/);
    assert.match(hook, /const tick = setInterval\(read, 1000\);/);
    assert.match(hook, /const unsubscribe = requestActivity\.subscribe\(read\);/);
    assert.match(hook, /clearInterval\(tick\);\s*unsubscribe\(\);/);
    // Used by the row and by a held retry's line, and by nothing above them.
    const users = [...time.matchAll(/const (\w+) = \([^)]*\) => \{\s*const \{ clock, request \} = useSkipProgress\(startedAt\);/g)].map((match) => match[1]);
    assert.deepEqual(users.sort(), ["HeldRetryStatus", "SkipProgressRow"]);
    assert.equal(time.split("useSkipProgress(").length - 1, 2, "called by those two and nowhere else");
    const widget = time.slice(time.indexOf("const DateWidget = ({"));
    assert.equal(/requestActivity\.subscribe|setInterval\(/.test(widget), false, "the widget itself neither ticks nor listens");
});

test("on a narrow screen the label gives way: Cancel and the spinner keep their size", () => {
    const row = slice(time, "const SkipProgressRow = ({ label, onCancel, startedAt = 0 }) => {", "// A HELD turn, not a failed one");
    assert.match(row, /<span style=\{\{ minWidth: 0, overflowWrap: "anywhere" \}\}>\s*<span>\{label \|\| "Simulating…"\}<\/span>\s*<SkipClock /,
        "the label may shrink and wrap, with the clock running on after it");
    assert.match(row, /<span style=\{\{ display: "inline-flex", flexShrink: 0 \}\}><SpinnerRing size=\{15\} \/><\/span>/);
    const cancel = row.slice(row.indexOf("onClick={onCancel}"), row.indexOf("Cancel\r\n") > -1 ? row.indexOf("Cancel\r\n") : row.indexOf("Cancel\n"));
    assert.match(cancel, /flexShrink: 0,/);
    assert.equal(/flexWrap/.test(row), false, "one row: Cancel is never pushed onto a line of its own or off the end");
    assert.match(row, /<RequestStatus request=\{request\} style=\{\{[^}]*textAlign: "center"[^}]*\}\} \/>/);
});

test("a held turn's retry says the same two things under its buttons", () => {
    const status = slice(time, "const HeldRetryStatus = ({ startedAt }) => {", "const HeldTurnNotice = (");
    assert.match(status, /<SkipClock clock=\{clock\} \/>\s*<RequestStatus request=\{request\}/);
    assert.match(time, /\{isRetrying && <HeldRetryStatus startedAt=\{retryStartedAt\} \/>\}/);
    assert.match(time, /retryStartedAt=\{progressStartedAt\}/);
});

test("every transport says when a request goes out and what its stream carries", () => {
    // Gemini (its chat stream and its tool stream), the OpenAI-style caller
    // (OpenAI, and every compatible or local endpoint, direct, relayed or
    // native), Anthropic, and the Anthropic-compatible proxy.
    const fetches = [...main.matchAll(/onRequestStart\?\.\(\);\s*const response = await (fetch|providerFetch)\(/g)].map((match) => match[1]);
    assert.deepEqual(fetches, ["fetch", "fetch", "providerFetch", "fetch", "providerFetch"]);
    for (const reader of ["readGeminiStreamedResponse", "readOpenAIStreamedResponse", "readAnthropicStreamedResponse"]) {
        const calls = main.split(`${reader}(response, onActivity, onToolStream, onStreamContent)`).length - 1;
        assert.equal(calls, reader === "readAnthropicStreamedResponse" ? 2 : 1, reader);
        assert.equal(main.split(`${reader}(response,`).length - 1, calls, `${reader} is never called without it`);
    }
});

test("callAI opens, feeds and closes the request the row reads, for gameplay calls only", () => {
    const call = main.slice(main.indexOf("export async function callAI("), main.indexOf("let promptPack = "));
    assert.match(call, /const live = languageMode === "ui" \? requestActivity\.track\(\{ label: logLabel, taskKey: providerOpts\.taskKey \}\) : null;/,
        "an advisor reply or a translation beside a skip is not what the row is waiting for");
    assert.match(call, /onRequestStart: \(\) => live\?\.sent\(\),/);
    assert.match(call, /onStreamContent: \(delta\) => live\?\.received\(delta\),/);
    // Over when refused (the wait for a retry is not an open request), when the
    // answer has been read, and whatever else happens when the call ends.
    assert.match(call, /if \(!\(status >= 200 && status < 300\)\) live\?\.done\(\);/);
    assert.match(call, /onUsage: \(data\) => \{\s*live\?\.done\(\);/);
    assert.match(call, /\} finally \{\s*live\?\.done\(\);\s*requestScope\.finish\(\);\s*\}/);
});

test("a cancelled turn's log line says how far in it was and what the open request had received", () => {
    const cancel = slice(time, "const cancelJump = useCallback(() => {", "}, []);");
    const seen = cancel.indexOf("cancelledRequestRef.current = requestActivity.current();");
    const aborted = cancel.indexOf("jumpAbortRef.current.abort(");
    assert.ok(seen > -1 && aborted > seen, "read before the abort: once it has unwound, the request is closed");
    assert.match(time, /logDebugEvent\("turn", `Turn cancelled by the player\$\{describeCancelPoint\(Date\.now\(\) - startedAt, cancelledRequestRef\.current\)\}\.`\);/);
    assert.match(time, /logDebugEvent\("turn", `Retry of the held turn \(\$\{kind\}\) cancelled\$\{describeCancelPoint\(Date\.now\(\) - startedAt, cancelledRequestRef\.current\)\}; the turn is still held\.`\);/);
    // A snapshot from an earlier cancel is never reported for a later one.
    assert.equal(time.split("cancelledRequestRef.current = undefined;").length - 1, 2);
});
