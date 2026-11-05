/*! Open Historia — portions (Diagnostics log and Desktop log guards) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Guards that keep the two logs from growing back into one another.
//
// Run: node --test src/runtime/diagnosticsLogGuard.test.js
//
// The page keeps the Diagnostics log (debugLog.js) and never writes to the
// Desktop log; the desktop app and the server write the Desktop log, and the
// Logging file merges the two. Before that, the page copied every entry into the
// Desktop log and the AI layer wrote whole system prompts there regardless of
// the player's switches. These read the source as text, like the turn-ordering
// guards, because the thing to protect is an absence.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const SRC = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");

const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) return item.name === "generated" ? [] : sourceFiles(full);
    return /\.(jsx?|mjs)$/.test(item.name) && !/\.test\.js$/.test(item.name) ? [full] : [];
});

const files = sourceFiles(SRC).map((file) => ({ file: path.relative(SRC, file).replace(/\\/g, "/"), text: fs.readFileSync(file, "utf8") }));

test("the page's old sender to the Desktop log is gone", () => {
    assert.equal(fs.existsSync(path.join(SRC, "runtime", "logClient.js")), false);
    const importers = files.filter(({ text }) => /logClient(\.js)?["']/.test(text)).map(({ file }) => file);
    assert.deepEqual(importers, [], "nothing may import the page-to-server log sender");
});

test("only the Diagnostics log talks to the log endpoint, and only to read or clear it", () => {
    const callers = files.filter(({ text }) => text.includes("/api/log")).map(({ file }) => file);
    assert.deepEqual(callers, ["runtime/debugLog.js"]);
    const debugLog = files.find(({ file }) => file === "runtime/debugLog.js").text;
    assert.equal(/method:\s*["']POST["']/.test(debugLog), false, "the page must never write into the Desktop log");
});

test("Settings says honestly what turning Logging off leaves behind", () => {
    const settings = files.find(({ file }) => file === "Game/GameUI/settings.jsx").text;
    assert.match(settings, /Off: nothing is recorded and the log on this device is deleted\. The desktop app still notes its own start-up and server errors, which never include your campaign\./);
});

test("the log is looked at in Settings, not in Cheats", () => {
    const cheats = files.find(({ file }) => file === "Game/GameUI/cheats.jsx").text;
    assert.equal(/Diagnostics Log/.test(cheats), false);
    const settings = files.find(({ file }) => file === "Game/GameUI/settings.jsx").text;
    assert.match(settings, /getLoggingFileEntries/, "View log shows the same entries the file holds");
});

test("React's own report of a caught crash is kept out of the log, so a crash appears once", () => {
    // React 19 console.errors every error a boundary catches, before
    // componentDidCatch runs; the console capture would record that as a second
    // entry beside the boundary's own crash entry.
    const main = files.find(({ file }) => file === "main.jsx").text;
    assert.match(main, /onCaughtError[\s\S]{0,300}withConsoleCaptureMuted/);
});

test("the prompt fingerprint is only recorded in detailed mode", () => {
    const gameplay = files.find(({ file }) => file === "Game/AI/gameplay.js").text;
    const at = gameplay.indexOf("buildPromptFingerprint({");
    assert.notEqual(at, -1, "the fingerprint call has moved; this guard needs updating");
    assert.match(gameplay.slice(Math.max(0, at - 400), at), /if \(isDebugLogVerbose\(\)\) \{\s*logDebugEvent\(/,
        "hashing a jump's prompt is not free, and nothing reads the result outside detailed mode");
    assert.match(gameplay.slice(at, at + 400), /\{ verbose: true \}/);
});

test("a failed AI task is logged as a problem", () => {
    const gameplay = files.find(({ file }) => file === "Game/AI/gameplay.js").text;
    assert.match(gameplay, /logDebugEvent\("ai", `Task "\$\{taskKey\}" failed[^\n]*\{ problem: true \}\);/);
});

test("every switch in the Settings panel is in the Logging file's settings snapshot", () => {
    // A setting added to the panel and forgotten here would be the one a report
    // could not answer "was it on?" for.
    const settings = files.find(({ file }) => file === "Game/GameUI/settings.jsx").text;
    const snapshot = files.find(({ file }) => file === "runtime/settingsLog.js")?.text ?? "";
    const toggles = [...settings.matchAll(/<Toggle[\s\S]{0,40}?label="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(toggles.length >= 15, `found only ${toggles.length} toggles; this guard needs updating`);
    const missing = [...new Set(toggles)].filter((label) => !snapshot.includes(`"${label}"`));
    assert.deepEqual(missing, []);
    for (const label of ["UI language", "AI chat language", "Basemap", "Label font", "Model", "Structured output", "Custom parameters", "API key"]) {
        assert.ok(snapshot.includes(`"${label}"`), `${label} is missing from the snapshot`);
    }
});

test("keys kept inside saved Connections are searched for like any other stored key", () => {
    // Connections (Game/AI/providerConfig.js) keep every key inside one stored
    // list, ai_connections, where the *_api_key suffix search cannot see them.
    // debugLog.test.js R2b proves the redaction; this pins that the two names
    // still agree, so renaming the list cannot quietly let keys into a report.
    const providerConfig = files.find(({ file }) => file === "Game/AI/providerConfig.js").text;
    const debugLog = files.find(({ file }) => file === "runtime/debugLog.js").text;
    const listKey = /const CONNECTIONS_KEY = "([^"]+)"/.exec(providerConfig)?.[1];
    assert.ok(listKey, "the Connections storage key has moved; this guard needs updating");
    // The names of the stored lists that are opened for apiKey fields.
    const scanned = /const SECRET_LIST_NAME = \/\(([^)]*)\)\$\/i;/.exec(debugLog)?.[1] ?? "";
    assert.ok(scanned.split("|").some((suffix) => suffix && listKey.endsWith(suffix)), `debugLog.js does not scan "${listKey}" for keys`);
});

test("the settings snapshot is registered at boot, not only when Settings is opened", () => {
    const main = files.find(({ file }) => file === "main.jsx").text;
    assert.match(main, /import "\.\/runtime\/settingsLog\.js";/);
});

test("the AI layer never logs a whole system prompt", () => {
    const gameplay = files.find(({ file }) => file === "Game/AI/gameplay.js").text;
    assert.equal(gameplay.includes("logAi("), false);
    // The fingerprint is handed the prompt to measure, and that is the one place
    // it may go.
    const calls = gameplay.split("logDebugEvent(").slice(1)
        .map((rest) => rest.slice(0, rest.indexOf(");")).replace(/buildPromptFingerprint\(\{[\s\S]*?\}\)/g, ""));
    const leaking = calls.filter((call) => /\bsystemPrompt\b(?!\.length)/.test(call));
    assert.deepEqual(leaking, [], "a log entry may carry the prompt's size or fingerprint, never the prompt");
});
