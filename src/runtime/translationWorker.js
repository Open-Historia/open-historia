/*! Open Historia — the translation model, off the main thread © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Runs one Opus-MT model (translationModels.js) for the translator, through
// Transformers.js on ONNX Runtime's CPU build. The weights come from the model
// host once and stay on the device (modelStore.js: the browser's Cache Storage
// under MODEL_CACHE, which the page's sweep of old caches in assets.js leaves
// alone, or IndexedDB where there is none, as in the Android app); the runtime's
// WebAssembly is part of the build (vite.config.ts), so only the first use
// needs a connection and the text never leaves the device.
//
// Messages in:  { type: "status", language }          → { type: "status", cached }
//               { type: "load", language }            → progress…, then ready | error
//               { type: "translate", id, language, strings } → { type: "result", id, outputs }
//               { type: "forget", language }          → { type: "forgotten" }
// `outputs` has one entry per string: its translation, or "" when the model
// gave none. One worker is one model: the first message names its language.

import ortWasm from "oh-ort-transformers/ort-wasm-simd-threaded.wasm?url";
import { MODEL_FILES, groupByLength, modelFileUrl, translationModelFor } from "./translationModels.js";
import { deleteModelCache, openModelCache } from "./modelStore.js";

// Named here and in assets.js (whose sweep of old caches keeps it), not
// imported: assets.js would bring half the game into this worker.
const MODEL_CACHE = "oh-translation-model-v1";

let entry = null;
let total = 0;
const fixModel = (language) => {
  if (entry) return;
  entry = translationModelFor(language);
  total = entry?.bytes || 0;
};

// Threads need a cross-origin-isolated page, which the game is not; one it is.
const THREADS = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

const post = (message) => self.postMessage(message);

const cached = async () => {
  try {
    if (!entry) return false;
    const cache = await openModelCache(MODEL_CACHE);
    if (!cache) return false;
    for (const file of MODEL_FILES) {
      if (!(await cache.match(modelFileUrl(entry, file)))) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const forget = () => deleteModelCache(MODEL_CACHE);

// A small file of the model, from the cache or else from the model host (then
// kept), under the same key Transformers.js uses: the file's URL.
const readJson = async (file) => {
  const url = modelFileUrl(entry, file);
  const cache = await openModelCache(MODEL_CACHE).catch(() => null);
  let response = await cache?.match(url);
  if (!response) {
    response = await fetch(url);
    if (!response.ok) throw new Error(`${file}: ${response.status}`);
    await cache?.put(url, response.clone()).catch(() => {});
  }
  return response.json();
};

// One language's model on the device at a time: another language's, left by a
// player who switched, is removed once this one has loaded.
const prune = async () => {
  try {
    const cache = await openModelCache(MODEL_CACHE);
    const ours = modelFileUrl(entry, "");
    for (const request of await cache.keys()) {
      if (!request.url.startsWith(ours)) await cache.delete(request);
    }
  } catch {
    // Kept for now; the next load tries again.
  }
};

let loading = null;
let tokenizer = null;
let model = null;
let Tensor = null;
let languageId;

const load = () => {
  if (!loading) {
    loading = (async () => {
      if (!entry) throw new Error("No translation model for this language.");
      const library = await import("@huggingface/transformers");
      const { env, MarianTokenizer, AutoModelForSeq2SeqLM } = library;
      Tensor = library.Tensor;
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      env.cacheKey = MODEL_CACHE;
      // The same store this file reads (modelStore.js), which is not Cache
      // Storage where the page has none.
      const store = await openModelCache(MODEL_CACHE);
      if (!store) throw new Error("This device cannot keep a translation model.");
      env.useCustomCache = true;
      env.customCache = store;
      // The runtime's glue is in the bundle; only its WebAssembly is a file.
      env.backends.onnx.wasm.wasmPaths = { wasm: new URL(ortWasm, self.location.href).href };
      env.backends.onnx.wasm.numThreads = THREADS;
      const loaded = new Map();
      let last = 0;
      const progress_callback = (event) => {
        if (event?.status !== "progress" || !event.file || !Number.isFinite(event.loaded)) return;
        loaded.set(event.file, event.loaded);
        const now = Date.now();
        if (now - last < 250) return;
        last = now;
        let sum = 0;
        for (const value of loaded.values()) sum += value;
        post({ type: "progress", loaded: Math.min(sum, total), total });
      };
      const options = { revision: entry.revision, progress_callback };
      // Not AutoTokenizer.from_pretrained: Transformers.js 4.3.1 first asks the
      // model host whether the "main" revision has a tokenizer_config.json
      // (get_tokenizer_files drops the revision), which is never in the cache,
      // so every load needed a connection and failed without one. The two files
      // are read here, through the same cache, at the pinned revision.
      const [tokenizerJson, tokenizerConfig] = await Promise.all([readJson("tokenizer.json"), readJson("tokenizer_config.json")]);
      tokenizer = new MarianTokenizer(tokenizerJson, tokenizerConfig);
      model = await AutoModelForSeq2SeqLM.from_pretrained(entry.repo, { ...options, device: "wasm", dtype: "q8" });
      languageId = entry.token ? tokenizer.get_vocab().get(entry.token) : undefined;
      prune();
    })()
      .then(() => post({ type: "ready" }))
      .catch((error) => {
        loading = null;
        post({ type: "error", message: String(error?.message || error) });
        throw error;
      });
  }
  return loading;
};

// Transformers.js 4 no longer reads Marian's language token off the front of
// the text (MarianTokenizer._encode_text is never called), so the token's id is
// put in front of the encoded text here.
const encode = (text) => {
  const ids = tokenizer.encode(text);
  return languageId === undefined ? ids : [languageId, ...ids];
};

// One batch of rows, padded to the longest. A row that has finished keeps
// being generated (Transformers.js stops only when every row has), so each
// answer is cut at its first end-of-sentence token, and the budget is bounded
// by the input's length.
const generateRows = async (texts) => {
  const rows = texts.map(encode);
  const width = Math.max(...rows.map((row) => row.length));
  const pad = tokenizer.pad_token_id ?? 0;
  const ids = new BigInt64Array(rows.length * width);
  const mask = new BigInt64Array(rows.length * width);
  rows.forEach((row, r) => {
    for (let c = 0; c < width; c += 1) {
      ids[r * width + c] = BigInt(c < row.length ? row[c] : pad);
      mask[r * width + c] = c < row.length ? 1n : 0n;
    }
  });
  const output = await model.generate({
    inputs: new Tensor("int64", ids, [rows.length, width]),
    attention_mask: new Tensor("int64", mask, [rows.length, width]),
    max_new_tokens: Math.min(512, Math.ceil(width * 2.5) + 8),
    num_beams: 1,
    do_sample: false,
  });
  const eos = Number(model.generation_config?.eos_token_id ?? model.config?.eos_token_id ?? 0);
  return output.tolist().map((row) => {
    const tokens = row.map(Number);
    const end = tokens.indexOf(eos, 1);
    return tokenizer.decode(end === -1 ? tokens : tokens.slice(0, end), { skip_special_tokens: true }).trim();
  });
};

const translate = async (strings) => {
  await load();
  const outputs = new Array(strings.length).fill("");
  for (const group of groupByLength(strings)) {
    try {
      const answers = await generateRows(group.map((index) => strings[index]));
      group.forEach((index, at) => { outputs[index] = answers[at] || ""; });
    } catch {
      // This group is left without answers; the translator sends it to the AI.
    }
  }
  return outputs;
};

// One translation at a time.
let chain = Promise.resolve();

self.onmessage = (event) => {
  const message = event.data || {};
  fixModel(message.language);
  if (message.type === "status") {
    cached().then((value) => post({ type: "status", cached: value }));
  } else if (message.type === "load") {
    load().catch(() => {});
  } else if (message.type === "forget") {
    forget().then(() => post({ type: "forgotten" }));
  } else if (message.type === "translate") {
    const { id, strings } = message;
    chain = chain.then(async () => {
      try {
        post({ type: "result", id, outputs: await translate(Array.isArray(strings) ? strings : []) });
      } catch (error) {
        post({ type: "result", id, outputs: null, error: String(error?.message || error) });
      }
    });
  }
};
