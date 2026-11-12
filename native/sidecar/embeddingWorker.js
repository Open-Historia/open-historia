import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EMBEDDING_MODEL, embedWith } from "../../src/runtime/embeddingModels.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sidecarDir = path.resolve(here, "..", "..");

const embeddingModelsRoot = () => path.resolve(sidecarDir, "..", "..", "public", "models");

const post = (message, transfer) => self.postMessage(message, transfer || []);

const readJson = (root, file) => JSON.parse(fs.readFileSync(path.join(root, EMBEDDING_MODEL.dir, file), "utf8"));

let loading = null;
let loaded = null;

const load = () => {
  if (!loading) {
    loading = (async () => {
      const root = embeddingModelsRoot();
      const onDevice = await import(pathToFileURL(path.join(sidecarDir, "onDevice.mjs")).href);
      const { lib } = await onDevice.loadLibrary();
      lib.env.localModelPath = `${root}${path.sep}`;
      const tokenizer = new lib.BertTokenizer(readJson(root, "tokenizer.json"), readJson(root, "tokenizer_config.json"));
      const model = await lib.AutoModel.from_pretrained(EMBEDDING_MODEL.dir, {
        local_files_only: true,
        dtype: "q8",
        session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
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

let chain = Promise.resolve();

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== "embed") return;
  const { id } = message;
  const texts = Array.isArray(message.texts) ? message.texts.map((text) => String(text ?? "")) : [];
  const maxTokens = Number.isInteger(message.maxTokens) && message.maxTokens > 0 ? Math.min(message.maxTokens, EMBEDDING_MODEL.maxSequence) : EMBEDDING_MODEL.maxTokens;
  chain = chain.then(async () => {
    try {
      await load();
      const vectors = await embedWith(loaded, texts, { maxTokens });
      post({ type: "result", id, vectors, dims: EMBEDDING_MODEL.dims }, [vectors.buffer]);
    } catch (error) {
      post({ type: "result", id, vectors: null, error: String(error?.message || error) });
    }
  });
};
