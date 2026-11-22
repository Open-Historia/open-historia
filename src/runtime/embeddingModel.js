/*! Open Historia — the related-events model, from the page's side © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The page's way to the on-device embedding model (embeddingWorker.js), as
// translationModel.js is the translator's. Loaded by a dynamic import the first
// time related past events need it (Game/AI/relatedEventsSearch.js), so a
// session that never reaches a game never loads it.

import { EMBEDDING_MODEL, splitVectors } from "./embeddingModels.js";

// A loaded model holds a few tens of megabytes. The worker goes some minutes
// after its last use; the next use loads it again from the game's own files
// (well under a second).
const IDLE_CLOSE_MS = 10 * 60 * 1000;

let current = null; // { worker, listeners, idle }

const close = () => {
  if (!current) return;
  clearTimeout(current.idle);
  current.worker.terminate();
  current = null;
};

const workerEntry = () => {
  if (!current) {
    // Written out in full, as Vite only bundles a worker from this exact form.
    const worker = new Worker(new URL("./embeddingWorker.js", import.meta.url), { type: "module", name: "openhistoria-embedding" });
    const created = { worker, listeners: new Set(), idle: null };
    worker.onmessage = (event) => {
      const message = event.data || {};
      for (const listener of [...created.listeners]) listener(message);
    };
    worker.onerror = (event) => {
      for (const listener of [...created.listeners]) listener({ type: "error", message: String(event?.message || "The embedding worker stopped.") });
    };
    current = created;
  }
  clearTimeout(current.idle);
  current.idle = null;
  return current;
};

const listen = (listener) => {
  const entry = workerEntry();
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

let nextId = 0;

// One vector (Float32Array, length one) per text. Loads the model first if it
// is not loaded. `maxTokens`: how many word pieces of each text are read (an
// event's default; a chunk of an older conversation's is CHAT_CHUNK_MAX_TOKENS).
export const embedTexts = async (texts, { maxTokens = 0 } = {}) => {
  if (typeof Worker === "undefined") throw new Error("This device cannot run the related-events model.");
  if (!texts.length) return [];
  nextId += 1;
  const id = nextId;
  const reply = await new Promise((resolve, reject) => {
    const off = listen((message) => {
      if (message.type === "result" && message.id === id) {
        off();
        resolve(message);
      } else if (message.type === "error") {
        off();
        reject(new Error(message.message || "The related-events model failed."));
      }
    });
    send({ type: "embed", id, texts, ...(maxTokens ? { maxTokens } : {}) });
  });
  if (!(reply.vectors instanceof Float32Array)) throw new Error(reply.error || "The related-events model failed.");
  return splitVectors(reply.vectors, reply.dims || EMBEDDING_MODEL.dims);
};
