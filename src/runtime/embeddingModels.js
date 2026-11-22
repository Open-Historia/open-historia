/*! Open Historia — the on-device model that finds related past events © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Related past events, always on: each event of a game is turned into a vector
// by a small sentence-embedding model on this device, and a time skip is shown
// the past events nearest to what is happening now (Game/AI/relatedEvents.js).
// The model ships with the game (public/models/all-MiniLM-L6-v2): it is read
// from the game's own files, never downloaded from a model host, and the
// events never leave the device for it.
//
// The model is all-MiniLM-L6-v2 (Microsoft's MiniLM, fine-tuned for sentence
// similarity by the sentence-transformers project; Apache-2.0), in the ONNX
// copy Transformers.js publishes (huggingface.co/Xenova/all-MiniLM-L6-v2),
// int8: 24 MB in all. Google's EmbeddingGemma-300m runs on the same
// Transformers.js (4.3.1) but its smallest ONNX download is 219 MB (q4 weights
// and a 20 MB tokenizer; 331 MB at q8), about 14 times the model to run on a
// phone's CPU for every event, under the Gemma terms rather than an open
// licence (tested 2026-11-07).
//
// Pure: the worker (embeddingWorker.js), the page's side (embeddingModel.js)
// and the tests call it.

export const EMBEDDING_MODEL = Object.freeze({
  // Where the files came from: the model host's repository at this revision
  // (public/models/all-MiniLM-L6-v2/README.md). It names the model in
  // EMBEDDING_MODEL_ID; nothing is fetched from there.
  repo: "Xenova/all-MiniLM-L6-v2",
  revision: "751bff37182d3f1213fa05d7196b954e230abad9",
  // The folder under public/models/ the game carries the files in.
  dir: "all-MiniLM-L6-v2",
  // The files Transformers.js reads, with their sizes at the pinned revision;
  // `bytes` is their sum. A test holds the copies in public/ to them.
  files: Object.freeze({
    "config.json": 650,
    "tokenizer.json": 711661,
    "tokenizer_config.json": 366,
    "onnx/model_quantized.onnx": 22972370,
  }),
  bytes: 23685047,
  dims: 384,
  // Word pieces read of one text: the title and the start of the description.
  // The model was trained on pieces of 128; longer ones cost a phone time (the
  // work grows faster than the length) and add little to what an event is about.
  maxTokens: 128,
  // The most word pieces the model was tuned to read (sentence-transformers'
  // max_seq_length for it): what a chunk of an older conversation is read to.
  maxSequence: 256,
});

// A chunk of an archived conversation (Game/AI/chatArchive.js), about 800
// characters, is about 200 word pieces: read whole, to the model's tuned length.
export const CHAT_CHUNK_MAX_TOKENS = EMBEDDING_MODEL.maxSequence;

// The folder the game serves its models from: public/models/ in the source,
// models/ beside index.html in every build (the desktop's local server, the
// Android app's www/, the website's /play/). `base` is the build's base path
// (import.meta.env.BASE_URL), `origin` the page's or the worker's origin.
export const embeddingModelRoot = (base = "/", origin = "") => {
  const path = `${String(base || "/").replace(/\/?$/, "/")}models/`;
  return origin ? new URL(path, origin).href : path;
};

// One of the model's files, as the game serves it.
export const embeddingFileUrl = (file, { base = "/", origin = "" } = {}, model = EMBEDDING_MODEL) =>
  `${embeddingModelRoot(base, origin)}${model.dir}/${file}`;

// The store an older version kept the model in, downloaded from Hugging Face
// once the player had said yes (modelStore.js: Cache Storage, or IndexedDB in
// the Android app). Deleted once (relatedEventsSearch.js).
export const OLD_EMBEDDING_MODEL_CACHE = "oh-embed-model-v1";

// Which model made a vector: a vector of another is not compared with it.
export const EMBEDDING_MODEL_ID = `${EMBEDDING_MODEL.repo}@${EMBEDDING_MODEL.revision.slice(0, 12)}`;

// ---------------------------------------------------------------------------
// What is embedded of an event, and the hash that says it changed.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// The title and the description, as the player reads them.
export const eventEmbeddingText = (event) => {
  const title = clean(event?.title);
  const description = clean(event?.description);
  return title && description ? `${title}. ${description}` : title || description;
};

// FNV-1a over the text and the model: a changed event, or a new model, is
// embedded again. Not a security hash; a collision costs one stale vector.
export const contentHash = (text, modelId = EMBEDDING_MODEL_ID) => {
  let hash = 0x811c9dc5;
  const value = `${modelId}\n${text}`;
  for (let at = 0; at < value.length; at += 1) {
    hash ^= value.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

// ---------------------------------------------------------------------------
// From the model's output to one vector per text.

// The mean of each row's token vectors, padding left out, scaled to length
// one: sentence-transformers' pooling for this model. `hidden` is the
// last_hidden_state's data ([rows, tokens, dims], flat), `mask` the attention
// mask ([rows, tokens], flat, 1 or 0, numbers or bigints).
export const meanPoolNormalize = (hidden, mask, rows, tokens, dims) => {
  const out = new Float32Array(rows * dims);
  for (let row = 0; row < rows; row += 1) {
    let count = 0;
    const base = row * dims;
    for (let token = 0; token < tokens; token += 1) {
      if (!Number(mask[row * tokens + token])) continue;
      count += 1;
      const from = (row * tokens + token) * dims;
      for (let d = 0; d < dims; d += 1) out[base + d] += hidden[from + d];
    }
    let norm = 0;
    for (let d = 0; d < dims; d += 1) {
      out[base + d] /= count || 1;
      norm += out[base + d] * out[base + d];
    }
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < dims; d += 1) out[base + d] /= norm;
  }
  return out;
};

// Split a flat Float32Array into one vector per text.
export const splitVectors = (flat, dims) => {
  const list = [];
  for (let at = 0; at + dims <= flat.length; at += dims) list.push(flat.slice(at, at + dims));
  return list;
};

// Both vectors are of length one, so the dot product is the cosine.
export const cosine = (a, b) => {
  if (!a || !b || a.length !== b.length) return 0;
  let sum = 0;
  for (let at = 0; at < a.length; at += 1) sum += a[at] * b[at];
  return sum;
};

// The model's output for `texts` (one vector after another), from a loaded
// tokenizer and model: what the worker runs, and what the trials in Node run
// (the same code). One text a run: on ONNX Runtime's WebAssembly a batch padded
// to its longest text was slower than the texts one by one (Chrome, 2026-11-07:
// 74 ms an event alone, 81 in fours, 96 in sixteens).
export const embedWith = async ({ tokenizer, model }, texts, { maxTokens = EMBEDDING_MODEL.maxTokens } = {}) => {
  const out = new Float32Array(texts.length * EMBEDDING_MODEL.dims);
  for (let at = 0; at < texts.length; at += 1) {
    const inputs = tokenizer([texts[at]], { padding: true, truncation: true, max_length: maxTokens });
    const output = await model(inputs);
    const hidden = output.last_hidden_state;
    const [rows, tokens, dims] = hidden.dims;
    if (dims !== EMBEDDING_MODEL.dims) throw new Error(`The model gave ${dims} dimensions, not ${EMBEDDING_MODEL.dims}.`);
    out.set(meanPoolNormalize(hidden.data, inputs.attention_mask.data, rows, tokens, dims), at * dims);
  }
  return out;
};
