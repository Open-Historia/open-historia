/*! Open Historia — the Advisor's microphone on an on-device model © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Whisper in a worker (speechWorker.js), fed by the microphone
// (speechCapture.js) a piece at a time (speechPieces.js). Reached only through
// speechInput.js's dynamic import, which the Android build strips: the phone
// uses its own recogniser, and the worker, its runtime and its WebAssembly stay
// out of the APK.

import { ON_DEVICE_MODELS, whisperLanguage } from "./speechEngines.js";
import { createEnergyVad, createSilenceWatch, rmsLevel } from "./speechSilence.js";
import { createPieceCutter, createPieceReader } from "./speechPieces.js";
import { openMicrophone } from "./speechCapture.js";

const speechError = (code, cause) => Object.assign(new Error(code), { code, cause });

// One worker per engine, kept while it is used and closed a few minutes after:
// a loaded model holds a few hundred megabytes, which a player who spoke once
// an hour ago should not be paying for. The download stays; only the copy in
// memory goes.
const IDLE_CLOSE_MS = 3 * 60 * 1000;
const workers = new Map();
const readyEngines = new Set();

const workerFor = (engine) => {
  let entry = workers.get(engine);
  if (!entry) {
    // Written out in full, as Vite only bundles a worker from this exact form.
    const worker = new Worker(new URL("./speechWorker.js", import.meta.url), { type: "module", name: `openhistoria-speech-${engine}` });
    const created = { worker, listeners: new Set(), idle: null };
    worker.onmessage = (event) => {
      for (const listener of [...created.listeners]) listener(event.data || {});
    };
    worker.onerror = (event) => {
      for (const listener of [...created.listeners]) listener({ type: "error", message: String(event?.message || "The speech worker stopped.") });
    };
    workers.set(engine, created);
    entry = created;
  }
  clearTimeout(entry.idle);
  entry.idle = null;
  return entry;
};

const listen = (engine, listener) => {
  const entry = workerFor(engine);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size) return;
    clearTimeout(entry.idle);
    entry.idle = setTimeout(() => {
      if (entry.listeners.size || workers.get(engine) !== entry) return;
      entry.worker.terminate();
      workers.delete(engine);
      readyEngines.delete(engine);
    }, IDLE_CLOSE_MS);
  };
};

const send = (engine, message, transfer) => workers.get(engine)?.worker.postMessage(message, transfer || []);

const downloadedEngines = new Set();

export const modelReady = (engine) => {
  if (!ON_DEVICE_MODELS[engine]) return Promise.resolve(true);
  if (downloadedEngines.has(engine)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const off = listen(engine, (message) => {
      if (message.type !== "status") return;
      off();
      if (message.cached) downloadedEngines.add(engine);
      resolve(Boolean(message.cached));
    });
    send(engine, { type: "status" });
  });
};

export const downloadModel = (engine, onProgress) => new Promise((resolve, reject) => {
  const off = listen(engine, (message) => {
    if (message.type === "progress") onProgress?.({ loaded: message.loaded, total: message.total });
    else if (message.type === "ready") {
      off();
      readyEngines.add(engine);
      downloadedEngines.add(engine);
      resolve();
    } else if (message.type === "error") {
      off();
      reject(speechError("model", message.message));
    }
  });
  send(engine, { type: "load" });
});

export const startOnDevice = ({ engine, language, onPartial, onFinal, onState, onError }) => {
  const vad = createEnergyVad();
  const pending = new Map();
  const whisperCode = whisperLanguage(language);
  let mic = null;
  let active = true;
  let finishing = false;
  let nextId = 0;

  const answerAll = () => {
    for (const resolve of pending.values()) resolve({ text: "" });
    pending.clear();
  };

  const off = listen(engine, (message) => {
    if (message.type === "text") {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve?.(message);
    } else if (message.type === "ready") {
      readyEngines.add(engine);
      downloadedEngines.add(engine);
      if (active && !finishing) onState?.("listening");
    } else if (message.type === "error") {
      answerAll();
      fail(speechError("model", message.message));
    }
  });

  const reader = createPieceReader({
    read: (audio) => new Promise((resolve) => {
      nextId += 1;
      pending.set(nextId, (message) => resolve(String(message?.text || "").trim()));
      send(engine, { type: "transcribe", id: nextId, audio, language: whisperCode }, [audio.buffer]);
    }),
    onText: (text) => {
      if (active) onPartial?.(text);
    },
  });
  const cutter = createPieceCutter({ onPiece: (audio) => reader.add(audio) });

  const watch = createSilenceWatch({ onVerdict: (verdict) => finish(verdict === "send") });

  const closeMic = () => {
    active = false;
    watch.stop();
    mic?.close();
    mic = null;
  };

  const finish = async (sendIt) => {
    if (finishing) return;
    finishing = true;
    const spoke = watch.spoke;
    closeMic();
    if (!spoke) {
      off();
      onFinal?.("", { send: false });
      return;
    }
    onState?.("finishing");
    cutter.flush();
    const final = await reader.done();
    off();
    onFinal?.(final, { send: Boolean(sendIt && final) });
  };

  const fail = (error) => {
    if (finishing) return;
    finishing = true;
    closeMic();
    off();
    onFinal?.(reader.text, { send: false });
    onError?.(error);
  };

  const onBlock = (block) => {
    if (!active) return;
    const speech = vad(rmsLevel(block));
    if (speech) watch.heard();
    cutter.hear(block, speech);
  };

  // Loading from storage takes a few seconds; the microphone opens meanwhile,
  // so what the player says while it loads is heard and read once it is up.
  onState?.(readyEngines.has(engine) ? "listening" : "loading");
  if (!readyEngines.has(engine)) send(engine, { type: "load" });
  openMicrophone({ onBlock })
    .then((opened) => {
      if (active) mic = opened;
      else opened.close();
    })
    .catch((error) => {
      const refused = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      fail(speechError(refused ? "permission" : "failed", error));
    });

  return { stop: () => finish(false) };
};
