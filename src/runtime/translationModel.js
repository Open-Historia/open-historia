/*! Open Historia — the translation model, from the page's side © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The translator's way to the on-device model (translationWorker.js). Loaded by
// a dynamic import from translator.js the first time a language with a model
// has something to translate, so a game played in English or in a language
// without one never loads it.

import { acceptModelOutput, splitForModel, translationModelFor } from "./translationModels.js";

// A loaded model holds a few hundred megabytes. The worker goes a few minutes
// after its last translation; the download stays, only the copy in memory goes.
const IDLE_CLOSE_MS = 3 * 60 * 1000;

// Every request ends: answered, failed, or given up on once the worker has
// said nothing at all for this long (a download reports its progress every
// quarter second, and a batch of strings takes seconds). A worker that never
// started, or stopped, answered nothing before, and the translator waited on
// it for good with "Translating to …" on the screen (a player's report,
// Arabic, 2026-11-09).
export const WORKER_SILENCE_MS = 3 * 60 * 1000;

let current = null; // { language, worker, listeners, idle }

// The worker goes; whatever was still waiting on it is told so, rather than
// waiting for an answer that cannot come.
const close = (reason = "The translation worker was closed.") => {
  if (!current) return;
  const entry = current;
  current = null;
  clearTimeout(entry.idle);
  entry.worker.terminate();
  for (const listener of [...entry.listeners]) listener({ type: "error", message: reason });
  entry.listeners.clear();
};

const workerFor = (language) => {
  if (current && current.language !== language) close();
  if (!current) {
    // Written out in full, as Vite only bundles a worker from this exact form.
    const worker = new Worker(new URL("./translationWorker.js", import.meta.url), { type: "module", name: "openhistoria-translation" });
    const created = { language, worker, listeners: new Set(), idle: null };
    worker.onmessage = (event) => {
      for (const listener of [...created.listeners]) listener(event.data || {});
    };
    // A worker that could not start, or failed, answers nothing more: closed,
    // so the next request starts another rather than waiting on this one.
    const failed = (event) => {
      if (current === created) close(String(event?.message || "The translation worker stopped."));
    };
    worker.onerror = failed;
    worker.onmessageerror = failed;
    current = created;
  }
  clearTimeout(current.idle);
  current.idle = null;
  return current;
};

const listen = (language, listener) => {
  const entry = workerFor(language);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size || current !== entry) return;
    clearTimeout(entry.idle);
    entry.idle = setTimeout(() => {
      if (current === entry && !entry.listeners.size) close();
    }, IDLE_CLOSE_MS);
  };
};

const send = (message) => current?.worker.postMessage(message);

// One request to the worker. `take(reply)` returns the answer once it has come
// (anything but undefined); an error, the worker going, or WORKER_SILENCE_MS
// without a word from it rejects.
const request = (language, message, take) => new Promise((resolve, reject) => {
  let timer = null;
  let entry = null;
  let off = () => {};
  const end = (settle, value) => {
    clearTimeout(timer);
    off();
    settle(value);
  };
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      end(reject, new Error("The translation model stopped answering."));
      if (current === entry) close("The translation model stopped answering.");
    }, WORKER_SILENCE_MS);
  };
  off = listen(language, (reply) => {
    arm();
    if (reply.type === "error") {
      end(reject, new Error(reply.message || "The translation model failed."));
      return;
    }
    const answer = take(reply);
    if (answer !== undefined) end(resolve, answer);
  });
  entry = current;
  arm();
  try {
    send({ ...message, language });
  } catch (error) {
    end(reject, error);
  }
});

const ask = (language, message, answerType) => request(language, message, (reply) => (reply.type === answerType ? reply : undefined));

// Whether this device already has the model, read from the cache it is kept in.
export const translationModelCached = async (language) => {
  if (!translationModelFor(language) || typeof Worker === "undefined") return false;
  try {
    return Boolean((await ask(language, { type: "status" }, "status")).cached);
  } catch {
    return false;
  }
};

// Downloads (once) and loads the model. `onProgress({ loaded, total })` while
// it downloads.
export const loadTranslationModel = async (language, onProgress) => {
  if (!translationModelFor(language) || typeof Worker === "undefined") {
    throw new Error("No translation model for this language.");
  }
  await request(language, { type: "load" }, (message) => {
    if (message.type === "progress") onProgress?.({ loaded: message.loaded, total: message.total });
    return message.type === "ready" ? true : undefined;
  });
};

// Removes the downloaded model from this device.
export const forgetTranslationModel = async (language) => {
  if (!translationModelFor(language) || typeof Worker === "undefined") return;
  try {
    await ask(language, { type: "forget" }, "forgotten");
  } finally {
    close();
  }
};

let nextId = 0;

// The model's translation of each string, or null where it gave none that
// passes acceptModelOutput (that string stays English). Long strings are sent
// as their lines and sentences (splitForModel) and put back together.
export const translateWithModel = async (language, strings) => {
  const splits = strings.map((text) => splitForModel(text));
  const pieces = splits.flatMap((split) => split.pieces);
  nextId += 1;
  const id = nextId;
  const reply = await request(language, { type: "translate", id, strings: pieces },
    (message) => (message.type === "result" && message.id === id ? message : undefined));
  if (!Array.isArray(reply.outputs)) throw new Error(reply.error || "The translation model failed.");
  let at = 0;
  return splits.map((split) => {
    const answers = split.pieces.map((piece) => acceptModelOutput(piece, reply.outputs[at++]));
    if (!split.pieces.length || answers.some((answer) => answer === null)) return null;
    return split.join(answers);
  });
};
