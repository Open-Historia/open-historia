/*! Open Historia — tests for a time skip's opening read ahead © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/skipWarmUp.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    MIN_OPENING_CHARS,
    SKIP_OPENING_KEY,
    createServerReadings,
    createSkipOpeningMemory,
    openingFromRequest,
    shouldWarmUp,
    warmUpBody,
} from "./skipWarmUp.js";
import { MAP_SETTING_KEYS } from "../../runtime/mapSettings.js";

const rules = "The scenario's rules. ".repeat(400);
const system = `${rules}[This month] The harvest failed.`;
const tools = [{ type: "function", function: { name: "submit_jump_result", parameters: { type: "object" } } }];
const body = {
    model: "local-27b",
    stream: true,
    messages: [{ role: "system", content: system }, { role: "user", content: "Skip a month." }],
    max_tokens: 9000,
    temperature: 0.3,
    tools,
    tool_choice: "required",
};
const endpoint = "http://127.0.0.1:11434/v1";
const opening = openingFromRequest({ body, staticPrefixEnd: rules.length, endpoint, campaign: "oh-abc-skip" });

const fakeStorage = () => {
    const kept = new Map();
    return {
        kept,
        getItem: (key) => (kept.has(key) ? kept.get(key) : null),
        setItem: (key, value) => { kept.set(key, String(value)); },
        removeItem: (key) => { kept.delete(key); },
    };
};

test("a skip's opening is its request without the messages and the answer's limits, and the system prompt up to its boundary", () => {
    assert.equal(opening.prefix, rules);
    assert.equal(opening.endpoint, endpoint);
    assert.equal(opening.campaign, "oh-abc-skip");
    assert.deepEqual(opening.request, { model: "local-27b", temperature: 0.3, tools, tool_choice: "required" });
    // Nothing worth keeping: no boundary, a boundary at the end, a short part, no system prompt first.
    assert.equal(openingFromRequest({ body, staticPrefixEnd: null, endpoint }), null);
    assert.equal(openingFromRequest({ body, staticPrefixEnd: system.length, endpoint }), null);
    assert.equal(openingFromRequest({ body, staticPrefixEnd: MIN_OPENING_CHARS - 1, endpoint }), null);
    assert.equal(openingFromRequest({ body: { ...body, messages: [{ role: "user", content: system }] }, staticPrefixEnd: rules.length, endpoint }), null);
    assert.equal(openingFromRequest({ body: null, staticPrefixEnd: rules.length }), null);
});

// What a server can reuse is decided from the first token: the functions and settings must be the skip's own.
test("the warm-up is the skip's own request cut short: the same functions and settings, the opening, one token of answer", () => {
    const warm = warmUpBody(opening);
    assert.deepEqual(warm.tools, tools);
    assert.equal(warm.tool_choice, "required");
    assert.equal(warm.model, "local-27b");
    assert.equal(warm.temperature, 0.3);
    assert.deepEqual(warm.messages, [{ role: "system", content: rules }, { role: "user", content: "." }]);
    assert.equal(warm.max_tokens, 1);
    assert.equal(warm.stream, false);
    assert.equal(system.startsWith(warm.messages[0].content), true, "the skip's system prompt opens with what was read");
});

test("the last opening is kept across sessions, and the same one again is no news", () => {
    const storage = fakeStorage();
    const memory = createSkipOpeningMemory(storage);
    assert.equal(memory.get(), null);
    assert.equal(memory.set(opening), true);
    assert.equal(memory.set({ ...opening, request: { ...opening.request } }), false, "the same opening");
    assert.deepEqual(createSkipOpeningMemory(storage).get(), opening, "read back by the next session");
    assert.equal(memory.set({ ...opening, prefix: `${rules}A new chapter of the story so far. ` }), true);
    assert.equal(memory.set(null), false);
    // Too large for the browser's storage: kept for the session, and the stored one is forgotten.
    const small = createSkipOpeningMemory(storage, { maxChars: 100 });
    assert.equal(small.set({ ...opening, campaign: "oh-other-skip" }), true);
    assert.equal(small.get().campaign, "oh-other-skip");
    assert.equal(storage.kept.has(SKIP_OPENING_KEY), false);
    // Something else under the key, or a storage that refuses: nothing kept, nothing thrown.
    assert.equal(createSkipOpeningMemory({ getItem: () => "{not json", setItem: () => {}, removeItem: () => {} }).get(), null);
    const refusing = createSkipOpeningMemory({ getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => {} });
    assert.equal(refusing.set(opening), true);
    assert.equal(refusing.get(), opening);
});

test("a warm-up is due only with the setting on, an opening for this campaign, an idle game and a server that did not just read a skip", () => {
    const due = { enabled: true, opening, campaign: "oh-abc-skip", busy: false, lastRead: "" };
    assert.equal(shouldWarmUp(due), true, "the first skip of a session");
    assert.equal(shouldWarmUp({ ...due, lastRead: "other" }), true, "another task had the server");
    assert.equal(shouldWarmUp({ ...due, lastRead: "skip" }), false, "the server has it read");
    assert.equal(shouldWarmUp({ ...due, enabled: false }), false);
    assert.equal(shouldWarmUp({ ...due, busy: true }), false);
    assert.equal(shouldWarmUp({ ...due, opening: null }), false);
    assert.equal(shouldWarmUp({ ...due, campaign: "oh-xyz-skip" }), false, "another campaign's opening is not this one's");
    assert.equal(shouldWarmUp({ ...due, campaign: "" }), true, "no campaign named: the opening kept is the best there is");
    const readings = createServerReadings();
    assert.equal(readings.last(endpoint), "");
    readings.note(endpoint, "skip");
    assert.equal(readings.last(endpoint), "skip");
    readings.note(endpoint, "advisor");
    assert.equal(readings.last(endpoint), "other");
});

// ---- The wiring, read as source ---------------------------------------------------

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const main = read("./main.jsx");

test("the setting is off unless switched on, and nothing is kept or sent without it", () => {
    assert.equal(MAP_SETTING_KEYS.skipWarmUp, "ai_skip_warm_up");
    assert.match(main, /if \(skip && !answerOnly && getMapSetting\(MAP_SETTING_KEYS\.skipWarmUp\)\) \{/);
    assert.match(main, /enabled: getMapSetting\(MAP_SETTING_KEYS\.skipWarmUp\),/);
});

test("only a local server is warmed, a real request drops a warm-up on its way, and the key is never kept with the opening", () => {
    const note = main.slice(main.indexOf("const noteLocalRequest = "), main.indexOf("const sendWarmUp = "));
    assert.ok(note.indexOf("if (!endpointIsLocal(address)) return body;") < note.indexOf("dropWarmUp();"));
    assert.ok(note.indexOf("dropWarmUp();") < note.indexOf("skipOpenings.set(opening)"));
    const send = main.slice(main.indexOf("const sendWarmUp = "), main.indexOf("export const warmSkipOpening = "));
    assert.match(send, /if \(!ready \|\| !endpointIsLocal\(opening\.endpoint\)\) return;/);
    assert.match(send, /const key = String\(entry\.apiKey \?\? ""\)\.trim\(\);/);
    assert.equal(JSON.stringify(opening).includes("Authorization"), false);
    // A retry of failed events, or the round that must answer, is not what the next skip opens with.
    assert.match(main, /answerOnly: requireOutputTool \|\| !opensLikeNextSkip,/);
    assert.match(readFileSync(new URL("./gameplay.js", import.meta.url), "utf8"), /\.\.\.\(context\.amend \? \{ opensLikeNextSkip: false \} : \{\}\),/);
    // Every request to a chat-completions server passes the note; another task's asks for a warm-up, which waits for an idle game.
    assert.match(main, /payload: noteLocalRequest\(\{\n\s+model,/);
    assert.match(note, /if \(!skip\) warmSkipOpening\(\);/);
    assert.match(send, /if \(getActiveAiRequestCount\(\) > 0\) \{\n\s+warmSkipOpening\(\);\n\s+return;/);
});
