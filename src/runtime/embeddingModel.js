/*! Open Historia — the related-events model, from the page's side © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The page's way to the on-device embedding model (embeddingWorker.js), as
// translationModel.js is the translator's. Loaded by a dynamic import the first
// time Find related past events needs it, so a player who never turns it on
// never loads it.

import { EMBEDDING_MODEL, splitVectors } from "./embeddingModels.js";

// A loaded model holds a few tens of megabytes. The worker goes some minutes
// after its last use; the download stays, only the copy in memory goes, and the
// next use loads it again from the device (well under a second).
const IDLE_CLOSE_MS = 10 * 60 * 1000;

let current = null; // { worker, listeners, idle, ready }

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
    const created = { worker, listeners: new Set(), idle: null, ready: false };
    worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === "ready") created.ready = true;
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

const available = () => typeof Worker !== "undefined";

// Whether the model is loaded in memory now: a search made then answers in
// milliseconds.
export const embeddingModelLoaded = () => Boolean(current?.ready);

// Whether this device already has the model's files.
export const embeddingModelCached = () => new Promise((resolve) => {
  if (!available()) {
    resolve(false);
    return;
  }
  const off = listen((reply) => {
    if (reply.type === "status" || reply.type === "error") {
      off();
      resolve(Boolean(reply.cached));
    }
  });
  send({ type: "status" });
});

// Downloads (once) and loads the model. `onProgress({ loaded, total })` while
// it downloads.
export const loadEmbeddingModel = (onProgress) => new Promise((resolve, reject) => {
  if (!available()) {
    reject(new Error("This device cannot run the related-events model."));
    return;
  }
  if (current?.ready) {
    resolve();
    return;
  }
  const off = listen((message) => {
    if (message.type === "progress") onProgress?.({ loaded: message.loaded, total: message.total || EMBEDDING_MODEL.bytes });
    else if (message.type === "ready") {
      off();
      resolve();
    } else if (message.type === "error") {
      off();
      reject(new Error(message.message || "The related-events model did not load."));
    }
  });
  send({ type: "load" });
});

let nextId = 0;

// One vector (Float32Array, length one) per text. Loads the model first if it
// is not loaded: from the device, or downloaded again should its copy have
// gone (the player said yes to it when turning the setting on).
export const embedTexts = async (texts) => {
  if (!available()) throw new Error("This device cannot run the related-events model.");
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
    send({ type: "embed", id, texts });
  });
  if (!(reply.vectors instanceof Float32Array)) throw new Error(reply.error || "The related-events model failed.");
  return splitVectors(reply.vectors, reply.dims || EMBEDDING_MODEL.dims);
};

// Removes the downloaded model from this device.
export const forgetEmbeddingModel = async () => {
  if (!available()) return;
  try {
    await new Promise((resolve) => {
      const off = listen((message) => {
        if (message.type === "forgotten" || message.type === "error") {
          off();
          resolve();
        }
      });
      send({ type: "forget" });
    });
  } finally {
    close();
  }
};
