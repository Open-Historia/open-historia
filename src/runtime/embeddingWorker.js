/*! Open Historia — the related-events model, off the main thread © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Runs the sentence-embedding model (embeddingModels.js) for Find related past
// events, through Transformers.js on ONNX Runtime's CPU build, as the
// translator's worker runs its model (translationWorker.js). The weights come
// from the model host once and stay on the device (modelStore.js: Cache
// Storage under EMBEDDING_MODEL_CACHE, or IndexedDB where there is none, as in
// the Android app); the runtime's WebAssembly is part of the build
// (vite.config.ts). The text never leaves the device.
//
// Messages in:  { type: "status" }             → { type: "status", cached }
//               { type: "load" }               → progress…, then ready | error
//               { type: "embed", id, texts }   → { type: "result", id, vectors, dims } (vectors: one Float32Array, row after row)
//               { type: "forget" }             → { type: "forgotten" }

import ortWasm from "oh-ort-transformers/ort-wasm-simd-threaded.wasm?url";
import { EMBEDDING_MODEL, EMBEDDING_MODEL_CACHE, EMBEDDING_MODEL_HOST, embedWith, embeddingFileUrl } from "./embeddingModels.js";
import { deleteModelCache, openModelCache } from "./modelStore.js";

const TOTAL = EMBEDDING_MODEL.bytes;

// Threads need a cross-origin-isolated page, which the game is not; one it is.
const THREADS = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

const post = (message, transfer) => self.postMessage(message, transfer || []);

const cached = async () => {
  try {
    const cache = await openModelCache(EMBEDDING_MODEL_CACHE);
    if (!cache) return false;
    for (const file of Object.keys(EMBEDDING_MODEL.files)) {
      if (!(await cache.match(embeddingFileUrl(file)))) return false;
    }
    return true;
  } catch {
    return false;
  }
};

// A small file of the model, from the cache or else from the model host (then
// kept), under the key Transformers.js uses: the file's URL at the pinned
// revision.
const readJson = async (file) => {
  const url = embeddingFileUrl(file);
  const cache = await openModelCache(EMBEDDING_MODEL_CACHE).catch(() => null);
  let response = await cache?.match(url);
  if (!response) {
    response = await fetch(url);
    if (!response.ok) throw new Error(`${file}: ${response.status}`);
    await cache?.put(url, response.clone()).catch(() => {});
  }
  return response.json();
};

let loading = null;
let loaded = null; // { tokenizer, model }

const load = () => {
  if (!loading) {
    loading = (async () => {
      const library = await import("@huggingface/transformers");
      const { env, BertTokenizer, AutoModel } = library;
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      env.cacheKey = EMBEDDING_MODEL_CACHE;
      const store = await openModelCache(EMBEDDING_MODEL_CACHE);
      if (!store) throw new Error("This device cannot keep the related-events model.");
      env.useCustomCache = true;
      env.customCache = store;
      // The runtime's glue is in the bundle; only its WebAssembly is a file.
      env.backends.onnx.wasm.wasmPaths = { wasm: new URL(ortWasm, self.location.href).href };
      env.backends.onnx.wasm.numThreads = THREADS;
      env.remoteHost = `${EMBEDDING_MODEL_HOST}/`;
      env.remotePathTemplate = "{model}/resolve/{revision}/";
      const sizes = new Map();
      let last = 0;
      const progress_callback = (event) => {
        if (event?.status !== "progress" || !event.file || !Number.isFinite(event.loaded)) return;
        sizes.set(event.file, event.loaded);
        const now = Date.now();
        if (now - last < 250) return;
        last = now;
        let sum = 0;
        for (const value of sizes.values()) sum += value;
        post({ type: "progress", loaded: Math.min(sum, TOTAL), total: TOTAL });
      };
      // Not AutoTokenizer.from_pretrained: Transformers.js 4.3.1 asks the model
      // host about the "main" revision for it (translationWorker.js says why),
      // so the two files are read here, through the same cache, at the pinned
      // revision.
      const [tokenizerJson, tokenizerConfig] = await Promise.all([readJson("tokenizer.json"), readJson("tokenizer_config.json")]);
      const tokenizer = new BertTokenizer(tokenizerJson, tokenizerConfig);
      const model = await AutoModel.from_pretrained(EMBEDDING_MODEL.repo, {
        revision: EMBEDDING_MODEL.revision,
        progress_callback,
        device: "wasm",
        dtype: "q8",
      });
      loaded = { tokenizer, model };
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

// One embedding at a time; a batch is small (the page sends a handful).
let chain = Promise.resolve();

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === "status") {
    cached().then((value) => post({ type: "status", cached: value }));
  } else if (message.type === "load") {
    load().catch(() => {});
  } else if (message.type === "forget") {
    deleteModelCache(EMBEDDING_MODEL_CACHE).then(() => post({ type: "forgotten" }));
  } else if (message.type === "embed") {
    const { id } = message;
    const texts = Array.isArray(message.texts) ? message.texts.map((text) => String(text ?? "")) : [];
    chain = chain.then(async () => {
      try {
        await load();
        const vectors = await embedWith(loaded, texts);
        post({ type: "result", id, vectors, dims: EMBEDDING_MODEL.dims }, [vectors.buffer]);
      } catch (error) {
        post({ type: "result", id, vectors: null, error: String(error?.message || error) });
      }
    });
  }
};
