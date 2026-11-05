/*! Open Historia — the on-device speech models, off the main thread © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Runs one on-device recogniser for the Advisor's microphone (speechInput.js):
// Parakeet TDT 0.6B v3 through parakeet.js, or Whisper base through
// Transformers.js. A model the size of Parakeet's would hold the page up for
// seconds per transcription, so it lives here.
//
// The weights come from the model host once and stay in the browser's storage
// (parakeet.js keeps them in IndexedDB, Transformers.js in the Cache API); the
// ONNX Runtime each one runs on is part of the build (vite.config.ts), so the
// audio and the runtime never leave the device and only the first use needs a
// connection.
//
// Messages in:  { type: "status" }                       → { type: "status", cached }
//               { type: "load" }                         → progress…, then ready | error
//               { type: "transcribe", id, audio, language } → { type: "text", id, text }
// Every message names its engine; the first one fixes it, so one worker is one
// model.

import parakeetOrtWasm from "oh-ort-parakeet/ort-wasm-simd-threaded.wasm?url";
import whisperOrtWasm from "oh-ort-whisper/ort-wasm-simd-threaded.wasm?url";
import { ON_DEVICE_MODELS, SPEECH_ENGINES, modelBytes } from "./speechEngines.js";

let engine = null;
let MODEL = null;
let TOTAL = 0;
const fixEngine = (name) => {
  if (engine) return;
  engine = name === SPEECH_ENGINES.WHISPER ? SPEECH_ENGINES.WHISPER : SPEECH_ENGINES.PARAKEET;
  MODEL = ON_DEVICE_MODELS[engine];
  TOTAL = modelBytes(engine);
};

// Threads need a cross-origin-isolated page, which the game is not (its map
// tiles and flags come from other hosts); one thread it is.
const THREADS = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

let loading = null;
let recognise = null;

const post = (message) => self.postMessage(message);

// Progress over the whole model, from the per-file reports both libraries give.
const progressTracker = () => {
  const loaded = new Map();
  let last = 0;
  return (file, bytes) => {
    if (!file || !Number.isFinite(bytes)) return;
    loaded.set(file, bytes);
    let sum = 0;
    for (const value of loaded.values()) sum += value;
    const now = Date.now();
    if (now - last < 250) return;
    last = now;
    post({ type: "progress", loaded: Math.min(sum, TOTAL), total: TOTAL });
  };
};

// ---------------------------------------------------------------------------
// Is the model already here? Read straight from each library's storage, so a
// player who cleared site data is asked again rather than surprised by 670 MB.

const PARAKEET_DB = "parakeet-cache-db";
const PARAKEET_STORE = "file-store";
// parakeet.js's own cache key (src/hub.js getModelFile).
const parakeetKey = (file) => `hf-${MODEL.repo}-${MODEL.revision}--${file}`;

const parakeetCached = () => new Promise((resolve) => {
  let request;
  try {
    request = indexedDB.open(PARAKEET_DB, 1);
  } catch {
    resolve(false);
    return;
  }
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(PARAKEET_STORE)) db.createObjectStore(PARAKEET_STORE);
  };
  request.onerror = () => resolve(false);
  request.onsuccess = () => {
    const db = request.result;
    try {
      const store = db.transaction([PARAKEET_STORE], "readonly").objectStore(PARAKEET_STORE);
      const files = Object.keys(MODEL.files);
      let found = 0;
      let answered = false;
      const answer = (value) => {
        if (answered) return;
        answered = true;
        db.close();
        resolve(value);
      };
      for (const file of files) {
        const get = store.getKey(parakeetKey(file));
        get.onsuccess = () => {
          if (get.result === undefined) answer(false);
          else if (++found === files.length) answer(true);
        };
        get.onerror = () => answer(false);
      }
    } catch {
      db.close();
      resolve(false);
    }
  };
});

// Transformers.js's Cache API key is the file's URL on the model host.
const whisperUrl = (file) => `https://huggingface.co/${MODEL.repo}/resolve/${MODEL.revision}/${file}`;

const whisperCached = async () => {
  try {
    if (typeof caches === "undefined") return false;
    const cache = await caches.open("transformers-cache");
    for (const file of Object.keys(MODEL.files)) {
      if (!(await cache.match(whisperUrl(file)))) return false;
    }
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Loading.

const loadParakeet = async () => {
  // The same module instance parakeet.js imports (vite.config.ts points both at
  // the CPU build), so the runtime it creates reads the build's own WebAssembly
  // instead of the CDN parakeet.js would otherwise fill in.
  const ortModule = await import("onnxruntime-web");
  const ort = ortModule.default || ortModule;
  ort.env.wasm.wasmPaths = { wasm: new URL(parakeetOrtWasm, self.location.href).href };
  ort.env.wasm.numThreads = THREADS;
  const { fromHub } = await import("parakeet.js");
  const report = progressTracker();
  const model = await fromHub("parakeet-tdt-0.6b-v3", {
    revision: MODEL.revision,
    backend: "wasm",
    encoderQuant: "int8",
    decoderQuant: "int8",
    preprocessorBackend: "js",
    cpuThreads: THREADS,
    progress: ({ file, loaded }) => report(file, loaded),
  });
  // Parakeet finds the language itself; it only has to be one it speaks, which
  // speechEngines.js made sure of before choosing it.
  return async (audio) => {
    const result = await model.transcribe(audio, 16000, { enableProfiling: false });
    return String(result?.utterance_text || "");
  };
};

const loadWhisper = async () => {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  // Its runtime's glue is inside the bundle; only the WebAssembly is a file.
  env.backends.onnx.wasm.wasmPaths = { wasm: new URL(whisperOrtWasm, self.location.href).href };
  env.backends.onnx.wasm.numThreads = THREADS;
  const report = progressTracker();
  const asr = await pipeline("automatic-speech-recognition", MODEL.repo, {
    revision: MODEL.revision,
    device: "wasm",
    dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
    progress_callback: (event) => {
      if (event?.status === "progress") report(event.file, event.loaded);
    },
  });
  return async (audio, language) => {
    const result = await asr(audio, {
      language: language || null,
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    return String((Array.isArray(result) ? result[0]?.text : result?.text) || "").trim();
  };
};

const load = () => {
  if (!loading) {
    loading = (engine === SPEECH_ENGINES.WHISPER ? loadWhisper() : loadParakeet())
      .then((fn) => {
        recognise = fn;
        post({ type: "ready" });
      })
      .catch((error) => {
        loading = null;
        post({ type: "error", message: String(error?.message || error) });
      });
  }
  return loading;
};

// Transcriptions run one at a time: a partial asked for while one is running
// is dropped by the page (speechInput.js), so the queue never grows.
let chain = Promise.resolve();

self.onmessage = (event) => {
  const message = event.data || {};
  fixEngine(message.engine);
  if (message.type === "status") {
    (engine === SPEECH_ENGINES.WHISPER ? whisperCached() : parakeetCached())
      .then((cached) => post({ type: "status", cached }));
    return;
  }
  if (message.type === "load") {
    load();
    return;
  }
  if (message.type === "transcribe") {
    const { id, audio, language } = message;
    chain = chain.then(async () => {
      try {
        await load();
        if (!recognise) throw new Error("The speech model did not load.");
        const text = await recognise(audio, language);
        post({ type: "text", id, text });
      } catch (error) {
        post({ type: "text", id, text: "", error: String(error?.message || error) });
      }
    });
  }
};
