/*! Open Historia — the Advisor's microphone through the system's recogniser: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/speechInput.system.test.js
//
// speechInput.js's system turn against a stand-in for the game's server
// (POST /api/desktop/speech/listen answering JSON lines): what is heard goes
// in the box, a failure before listening hands the press to Whisper with the
// reason, a microphone the system refused is the permission error, and a
// build without the program is not asked again.

import test from "node:test";
import assert from "node:assert/strict";

const ELECTRON_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Electron/37.2.0 Safari/537.36";
Object.defineProperty(globalThis, "navigator", { value: { userAgent: ELECTRON_WINDOWS }, configurable: true, writable: true });

const { SPEECH_ENGINES, speechEngineFor, startSpeech } = await import("./speechInput.js");

// A server whose answer the test writes line by line.
const fakeServer = () => {
  const requests = [];
  let stream = null;
  let aborted = false;
  const encoder = new TextEncoder();
  globalThis.fetch = async (url, options) => {
    requests.push({ url, method: options.method, body: JSON.parse(options.body) });
    options.signal.addEventListener("abort", () => {
      aborted = true;
      try { stream.error(Object.assign(new Error("aborted"), { name: "AbortError" })); } catch { /* closed */ }
    });
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({ start(controller) { stream = controller; } }),
    };
  };
  return {
    requests,
    get aborted() { return aborted; },
    send: (...events) => stream.enqueue(encoder.encode(events.map((event) => `${JSON.stringify(event)}\n`).join(""))),
    close: () => stream.close(),
  };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const turn = (language = "en") => {
  const seen = { partials: [], finals: [], states: [], errors: [] };
  const session = startSpeech({
    language,
    onPartial: (text) => seen.partials.push(text),
    onFinal: (text, { send }) => seen.finals.push({ text, send }),
    onState: (state) => seen.states.push(state),
    onError: (error) => seen.errors.push(error),
  });
  return { seen, session };
};

test("the desktop app on Windows asks the system's recogniser first", () => {
  assert.equal(speechEngineFor("en"), SPEECH_ENGINES.SYSTEM);
});

test("what the system hears goes in the box, phrase by phrase, and a stop keeps it unsent", async () => {
  const server = fakeServer();
  const { seen, session } = turn("fr");
  await settle();
  assert.deepEqual(server.requests, [{ url: "/api/desktop/speech/listen", method: "POST", body: { language: "fr-FR" } }]);
  server.send({ type: "ready", language: "fr-FR" });
  await settle();
  assert.deepEqual(seen.states, ["listening"]);
  server.send({ type: "partial", text: "Mobilisez" }, { type: "partial", text: "Mobilisez l'armée" }, { type: "final", text: "Mobilisez l'armée." });
  server.send({ type: "partial", text: "Maintenant" });
  await settle();
  assert.deepEqual(seen.partials, ["Mobilisez", "Mobilisez l'armée", "Mobilisez l'armée.", "Mobilisez l'armée. Maintenant"]);
  session.stop();
  await settle();
  assert.deepEqual(seen.finals, [{ text: "Mobilisez l'armée. Maintenant", send: false }]);
  assert.equal(server.aborted, true, "stopping lets go of the request, which stops the program");
  assert.deepEqual(seen.errors, []);
});

test("Windows' online speech recognition switched off: the press goes on with Whisper, saying why", async () => {
  const server = fakeServer();
  const { seen } = turn();
  await settle();
  server.send({ type: "error", code: "privacy", message: "0x80045509" }, { type: "end" });
  server.close();
  await settle();
  assert.deepEqual(seen.finals, [{ text: "", send: false }]);
  assert.equal(seen.errors.length, 1);
  assert.equal(seen.errors[0].code, "system");
  assert.equal(seen.errors[0].fallback, "privacy");
  // Tried again on the next press: the player may have switched it on.
  assert.equal(speechEngineFor("en"), SPEECH_ENGINES.SYSTEM);
});

test("macOS refusing, a missing language, or a failure part way with nothing heard all fall back", async () => {
  for (const [events, reason] of [
    [[{ type: "error", code: "denied" }, { type: "end" }], "denied"],
    [[{ type: "error", code: "language" }, { type: "end" }], "language"],
    [[{ type: "ready" }, { type: "error", code: "network" }, { type: "end" }], "failed"],
    [[{ type: "end" }], "failed"],
  ]) {
    const server = fakeServer();
    const { seen } = turn();
    await settle();
    server.send(...events);
    server.close();
    await settle();
    assert.equal(seen.errors[0]?.code, "system", reason);
    assert.equal(seen.errors[0]?.fallback, reason);
  }
});

test("a failure after the player spoke keeps the words and does not fall back", async () => {
  const server = fakeServer();
  const { seen } = turn();
  await settle();
  server.send({ type: "ready" }, { type: "partial", text: "Send the fleet" }, { type: "error", code: "network" }, { type: "end" });
  server.close();
  await settle();
  assert.deepEqual(seen.finals, [{ text: "Send the fleet", send: false }]);
  assert.equal(seen.errors[0].code, "failed");
});

test("a microphone the system refused is the permission error, not a fallback", async () => {
  const server = fakeServer();
  const { seen } = turn();
  await settle();
  server.send({ type: "error", code: "microphone" }, { type: "end" });
  server.close();
  await settle();
  assert.equal(seen.errors[0].code, "permission");
});

test("a build without the program is not asked again this session", async () => {
  const server = fakeServer();
  const { seen } = turn();
  await settle();
  server.send({ type: "error", code: "unavailable" }, { type: "end" });
  server.close();
  await settle();
  assert.equal(seen.errors[0].fallback, "absent");
  assert.notEqual(speechEngineFor("en"), SPEECH_ENGINES.SYSTEM);
});
