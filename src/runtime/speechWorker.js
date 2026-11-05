/*! Open Historia — the on-device speech model, off the main thread © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Runs Whisper base through Transformers.js for the Advisor's microphone
// (speechInput.js). Each reading takes seconds of the CPU, which would hold the
// page up, so it lives here.
//
// The weights come from the model host once and stay in the browser's Cache
// API; the ONNX Runtime it runs on is part of the build (vite.config.ts), so
// the audio and the runtime never leave the device and only the first use
// needs a connection.
//
// Messages in:  { type: "status" }                         → { type: "status", cached }
//               { type: "load" }                           → progress…, then ready | error
//               { type: "transcribe", id, audio, language } → { type: "text", id, text }

import whisperOrtWasm from "oh-ort-transformers/ort-wasm-simd-threaded.wasm?url";
import { ON_DEVICE_MODELS, SPEECH_ENGINES, modelBytes } from "./speechEngines.js";

const MODEL = ON_DEVICE_MODELS[SPEECH_ENGINES.WHISPER];
const TOTAL = modelBytes(SPEECH_ENGINES.WHISPER);
const SAMPLE_RATE = 16000;

// Threads need a cross-origin-isolated page, which the game is not (its map
// tiles and flags come from other hosts); one thread it is.
const THREADS = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

let loading = null;
let recognise = null;

const post = (message) => self.postMessage(message);

// Progress over the whole model, from the per-file reports Transformers.js gives.
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

// Is the model already here? Read straight from Transformers.js's cache, so a
// player who cleared site data is asked again rather than surprised by the
// download. Its key is the file's URL on the model host.
const fileUrl = (file) => `https://huggingface.co/${MODEL.repo}/resolve/${MODEL.revision}/${file}`;

const cached = async () => {
  try {
    if (typeof caches === "undefined") return false;
    const cache = await caches.open("transformers-cache");
    for (const file of Object.keys(MODEL.files)) {
      if (!(await cache.match(fileUrl(file)))) return false;
    }
    return true;
  } catch {
    return false;
  }
};

// The longest reading Whisper's decoder may write for a stretch of audio. Its
// window holds 448 tokens; a reading that runs away (Whisper repeating itself
// over noise) would otherwise write all of them, a few seconds of decoding on
// one thread, after the player has finished. Speech in any of the game's
// languages stays well under 25 tokens a second.
const maxTokensFor = (samples) => Math.min(440, 32 + Math.ceil((samples / SAMPLE_RATE) * 25));

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
  // The page hands over pieces of a turn cut at pauses, none longer than
  // Whisper's 30-second window (speechOnDevice.js), so each is one pass of the
  // encoder and none needs the pipeline's overlapping chunks. The language is
  // the player's, given to the decoder rather than guessed from the audio.
  return async (audio, language) => {
    const long = audio.length > 30 * SAMPLE_RATE;
    const result = await asr(audio, {
      language: language || null,
      task: "transcribe",
      return_timestamps: false,
      ...(long ? { chunk_length_s: 30, stride_length_s: 5 } : { max_new_tokens: maxTokensFor(audio.length) }),
    });
    return String((Array.isArray(result) ? result[0]?.text : result?.text) || "").trim();
  };
};

const load = () => {
  if (!loading) {
    loading = loadWhisper()
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

// Readings run one at a time; the page sends the next piece only once the last
// has come back (speechOnDevice.js), so the queue never grows.
let chain = Promise.resolve();

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === "status") {
    cached().then((value) => post({ type: "status", cached: value }));
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
