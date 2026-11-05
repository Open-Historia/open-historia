/*! Open Historia — the translation model, from the page's side © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The translator's way to the on-device model (translationWorker.js). Loaded by
// a dynamic import from translator.js the first time a language with a model
// has something to translate, so a game played in English or in a language
// without one never loads it.

import { acceptModelOutput, splitForModel, translationModelFor } from "./translationModels.js";

// A loaded model holds a few hundred megabytes. The worker goes a few minutes
// after its last translation; the download stays, only the copy in memory goes.
const IDLE_CLOSE_MS = 3 * 60 * 1000;

let current = null; // { language, worker, listeners, idle }

const close = () => {
  if (!current) return;
  clearTimeout(current.idle);
  current.worker.terminate();
  current = null;
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
    worker.onerror = (event) => {
      for (const listener of [...created.listeners]) listener({ type: "error", message: String(event?.message || "The translation worker stopped.") });
    };
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

const ask = (language, message, answerType) => new Promise((resolve, reject) => {
  const off = listen(language, (reply) => {
    if (reply.type === answerType) {
      off();
      resolve(reply);
    } else if (reply.type === "error") {
      off();
      reject(new Error(reply.message || "The translation model failed."));
    }
  });
  send({ ...message, language });
});

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
export const loadTranslationModel = (language, onProgress) => new Promise((resolve, reject) => {
  if (!translationModelFor(language) || typeof Worker === "undefined") {
    reject(new Error("No translation model for this language."));
    return;
  }
  const off = listen(language, (message) => {
    if (message.type === "progress") onProgress?.({ loaded: message.loaded, total: message.total });
    else if (message.type === "ready") {
      off();
      resolve();
    } else if (message.type === "error") {
      off();
      reject(new Error(message.message || "The translation model did not load."));
    }
  });
  send({ type: "load", language });
});

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
  const reply = await new Promise((resolve, reject) => {
    const off = listen(language, (message) => {
      if (message.type === "result" && message.id === id) {
        off();
        resolve(message);
      } else if (message.type === "error") {
        off();
        reject(new Error(message.message || "The translation model failed."));
      }
    });
    send({ type: "translate", id, language, strings: pieces });
  });
  if (!Array.isArray(reply.outputs)) throw new Error(reply.error || "The translation model failed.");
  let at = 0;
  return splits.map((split) => {
    const answers = split.pieces.map((piece) => acceptModelOutput(piece, reply.outputs[at++]));
    if (!split.pieces.length || answers.some((answer) => answer === null)) return null;
    return split.join(answers);
  });
};
