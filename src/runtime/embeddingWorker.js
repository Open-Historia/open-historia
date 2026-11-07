/*! Open Historia — the related-events model, off the main thread © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Runs the sentence-embedding model (embeddingModels.js) for related past
// events, through Transformers.js on ONNX Runtime's CPU build, as the
// translator's worker runs its model (translationWorker.js). The model ships
// with the game (public/models/all-MiniLM-L6-v2) and is read from the game's
// own address: the desktop's local server, the Android app's files, the
// website's own origin. Nothing is fetched from a model host; the runtime's
// WebAssembly is part of the build (vite.config.ts). The text never leaves the
// device.
//
// Messages in:  { type: "embed", id, texts }   → (ready | error, the first time), then
//                                                { type: "result", id, vectors, dims } (vectors: one Float32Array, row after row)

import ortWasm from "oh-ort-transformers/ort-wasm-simd-threaded.wasm?url";
import { EMBEDDING_MODEL, embedWith, embeddingFileUrl, embeddingModelRoot } from "./embeddingModels.js";

// The build's base path ("/", or "/play/" on the website), so the files are
// found beside index.html wherever the game is served from.
const BASE = import.meta.env?.BASE_URL ?? "/";
const ORIGIN = self.location.origin;

// Threads need a cross-origin-isolated page, which the game is not; one it is.
const THREADS = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

const post = (message, transfer) => self.postMessage(message, transfer || []);

// A small file of the model, from the game's own files.
const readJson = async (file) => {
  const response = await fetch(embeddingFileUrl(file, { base: BASE, origin: ORIGIN }));
  if (!response.ok) throw new Error(`${file}: ${response.status}`);
  return response.json();
};

let loading = null;
let loaded = null; // { tokenizer, model }

const load = () => {
  if (!loading) {
    loading = (async () => {
      const library = await import("@huggingface/transformers");
      const { env, BertTokenizer, AutoModel } = library;
      // Only the game's own files: no model host, and no second copy in a cache
      // (the files are on the device already; the website's stay in the
      // browser's own cache).
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = embeddingModelRoot(BASE, ORIGIN);
      env.useBrowserCache = false;
      env.useCustomCache = false;
      // The runtime's glue is in the bundle; only its WebAssembly is a file.
      env.backends.onnx.wasm.wasmPaths = { wasm: new URL(ortWasm, self.location.href).href };
      env.backends.onnx.wasm.numThreads = THREADS;
      // The tokenizer from its two files, read here as the translator's worker
      // reads its own (translationWorker.js).
      const [tokenizerJson, tokenizerConfig] = await Promise.all([readJson("tokenizer.json"), readJson("tokenizer_config.json")]);
      const tokenizer = new BertTokenizer(tokenizerJson, tokenizerConfig);
      const model = await AutoModel.from_pretrained(EMBEDDING_MODEL.dir, {
        local_files_only: true,
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
  if (message.type === "embed") {
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
