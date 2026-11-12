import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import module, { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "package.json"));

export const MODELS_DIR = "models";
export const IDLE_CLOSE_MS = 3 * 60 * 1000;
const SAMPLE_RATE = 16000;

const packageDir = (name) => {
  for (const base of require.resolve.paths(name) ?? []) {
    const dir = path.join(base, name);
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
  }
  return "";
};

export const nativeRuntimeDir = (platform = process.platform, arch = process.arch) => {
  const dir = packageDir("onnxruntime-node");
  return dir ? path.join(dir, "bin", "napi-v6", platform, arch) : "";
};

export const hasNativeRuntime = (platform = process.platform, arch = process.arch) => {
  const dir = nativeRuntimeDir(platform, arch);
  return Boolean(dir) && fs.existsSync(path.join(dir, "onnxruntime_binding.node"));
};

export const runtimeKind = () => (process.env.OH_ORT_WASM !== "1" && hasNativeRuntime() ? "native" : "wasm");

export const threadCount = () => Math.max(1, Math.min(4, Math.floor((os.availableParallelism?.() ?? os.cpus().length) / 2)));

let library = null;

export const loadLibrary = () => {
  if (!library) {
    library = (async () => {
      const kind = runtimeKind();
      const stubs = new Map([["sharp", `data:text/javascript,${encodeURIComponent("export default function sharp() { throw new Error(\"No image library.\"); }")}`]]);
      if (kind === "wasm") {
        const webDir = packageDir("onnxruntime-web");
        if (!webDir) throw new Error("No ONNX runtime for this computer.");
        const webEntry = path.join(webDir, "dist", "ort.node.min.js");
        const ort = require(webEntry);
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.wasmPaths = `${pathToFileURL(path.join(webDir, "dist")).href}/`;
        stubs.set("onnxruntime-node", pathToFileURL(webEntry).href);
      }
      module.registerHooks({
        resolve(specifier, context, nextResolve) {
          const target = stubs.get(specifier);
          if (target) return { url: target, shortCircuit: true, format: target.startsWith("data:") ? "module" : "commonjs" };
          return nextResolve(specifier, context);
        },
      });
      const lib = await import("@huggingface/transformers");
      lib.env.allowRemoteModels = false;
      lib.env.allowLocalModels = true;
      lib.env.useFSCache = false;
      lib.env.useBrowserCache = false;
      return { lib, kind };
    })().catch((error) => {
      library = null;
      throw error;
    });
  }
  return library;
};

const sessionOptions = () => ({ intraOpNumThreads: threadCount(), interOpNumThreads: 1 });

export const modelsRoot = (cacheDir) => path.join(cacheDir, MODELS_DIR);
export const modelDir = (cacheDir, repo) => path.join(modelsRoot(cacheDir), ...String(repo).split("/"));
const revisionFile = (cacheDir, repo) => path.join(modelDir(cacheDir, repo), ".revision");

export const modelCached = (cacheDir, { repo, revision, files }) => {
  try {
    if (fs.readFileSync(revisionFile(cacheDir, repo), "utf8").trim() !== revision) return false;
    return files.every((file) => fs.statSync(path.join(modelDir(cacheDir, repo), file)).size > 0);
  } catch {
    return false;
  }
};

export const forgetModel = (cacheDir, repo) => {
  fs.rmSync(modelDir(cacheDir, repo), { recursive: true, force: true });
};

const fileUrl = (host, repo, revision, file) => `${host}/${repo}/resolve/${revision}/${file}`;

export const downloadModel = async (cacheDir, { host = "https://huggingface.co", repo, revision, files, sizes = {}, total = 0, urlOf = null }, { onProgress, signal, fetcher = globalThis.fetch } = {}) => {
  if (modelCached(cacheDir, { repo, revision, files })) return false;
  const dir = modelDir(cacheDir, repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(revisionFile(cacheDir, repo), { force: true });
  const whole = total || Object.values(sizes).reduce((sum, bytes) => sum + Number(bytes || 0), 0);
  const done = new Map();
  let last = 0;
  const report = (force = false) => {
    let sum = 0;
    for (const value of done.values()) sum += value;
    const now = Date.now();
    if (!force && now - last < 250) return;
    last = now;
    onProgress?.({ loaded: Math.min(sum, whole || sum), total: whole || sum });
  };
  for (const file of files) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const response = await fetcher(urlOf ? urlOf(file) : fileUrl(host, repo, revision, file), { signal });
    if (!response.ok || !response.body) throw new Error(`${file}: ${response.status}`);
    const part = `${target}.part`;
    const out = fs.createWriteStream(part);
    let bytes = 0;
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        done.set(file, bytes);
        if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
        report();
      }
      await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
    } catch (error) {
      out.destroy();
      fs.rmSync(part, { force: true });
      throw error;
    }
    fs.renameSync(part, target);
  }
  fs.writeFileSync(revisionFile(cacheDir, repo), `${revision}\n`);
  report(true);
  return true;
};

const readJson = (cacheDir, repo, file) => JSON.parse(fs.readFileSync(path.join(modelDir(cacheDir, repo), file), "utf8"));

const idleCloser = (close) => {
  let timer = null;
  return {
    touch() {
      clearTimeout(timer);
      timer = setTimeout(close, IDLE_CLOSE_MS);
      timer.unref?.();
    },
    stop() {
      clearTimeout(timer);
      timer = null;
    },
  };
};

export const createTranslationRunner = ({ cacheDir, models }) => {
  let current = null;
  let chain = Promise.resolve();

  const close = async () => {
    const loaded = current;
    current = null;
    idle.stop();
    try {
      await (await loaded?.ready)?.model?.dispose?.();
    } catch {
      return;
    }
  };
  const idle = idleCloser(() => void close());

  const prune = (keep) => {
    for (const entry of Object.values(models.TRANSLATION_MODELS)) {
      if (entry.repo !== keep) forgetModel(cacheDir, entry.repo);
    }
  };

  const filesOf = (entry) => ({ repo: entry.repo, revision: entry.revision, files: [...models.MODEL_FILES] });

  const cached = (code) => {
    const entry = models.translationModelFor(code);
    return Boolean(entry) && modelCached(cacheDir, filesOf(entry));
  };

  const download = async (code, onProgress) => {
    const entry = models.translationModelFor(code);
    if (!entry) throw new Error("No translation model for this language.");
    await downloadModel(cacheDir, { host: models.MODEL_HOST, ...filesOf(entry), total: entry.bytes, urlOf: (file) => models.modelFileUrl(entry, file) }, { onProgress });
  };

  const load = (code) => {
    const entry = models.translationModelFor(code);
    if (!entry) return Promise.reject(new Error("No translation model for this language."));
    if (current?.code === code) {
      idle.touch();
      return current.ready;
    }
    void close();
    const loading = {
      code,
      ready: (async () => {
        const { lib } = await loadLibrary();
        lib.env.localModelPath = `${modelsRoot(cacheDir)}${path.sep}`;
        const tokenizer = new lib.MarianTokenizer(readJson(cacheDir, entry.repo, "tokenizer.json"), readJson(cacheDir, entry.repo, "tokenizer_config.json"));
        const model = await lib.AutoModelForSeq2SeqLM.from_pretrained(entry.repo, { dtype: "q8", local_files_only: true, session_options: sessionOptions() });
        const languageId = entry.token ? tokenizer.get_vocab().get(entry.token) : undefined;
        prune(entry.repo);
        return { lib, tokenizer, model, languageId };
      })(),
    };
    loading.ready.catch(() => {
      if (current === loading) current = null;
    });
    current = loading;
    idle.touch();
    return loading.ready;
  };

  const generateRows = async ({ lib, tokenizer, model, languageId }, texts) => {
    const rows = texts.map((text) => {
      const ids = tokenizer.encode(text);
      return languageId === undefined ? ids : [languageId, ...ids];
    });
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
      inputs: new lib.Tensor("int64", ids, [rows.length, width]),
      attention_mask: new lib.Tensor("int64", mask, [rows.length, width]),
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

  const translatePieces = async (code, strings) => {
    const loaded = await load(code);
    const outputs = new Array(strings.length).fill("");
    for (const group of models.groupByLength(strings)) {
      try {
        const answers = await generateRows(loaded, group.map((index) => strings[index]));
        group.forEach((index, at) => {
          outputs[index] = answers[at] || "";
        });
      } catch {
        continue;
      }
    }
    idle.touch();
    return outputs;
  };

  const translate = (code, strings) => {
    const run = chain.then(async () => {
      const splits = strings.map((text) => models.splitForModel(text));
      const pieces = splits.flatMap((split) => split.pieces);
      const outputs = pieces.length ? await translatePieces(code, pieces) : [];
      let at = 0;
      return splits.map((split) => {
        const answers = split.pieces.map((piece) => models.acceptModelOutput(piece, outputs[at++]));
        if (!split.pieces.length || answers.some((answer) => answer === null)) return null;
        return split.join(answers);
      });
    });
    chain = run.catch(() => {});
    return run;
  };

  const forget = async (code) => {
    const entry = models.translationModelFor(code);
    if (current?.code === code) await close();
    if (entry) forgetModel(cacheDir, entry.repo);
  };

  return { cached, download, load, translate, forget, close, loadedCode: () => current?.code ?? "" };
};

export const createWhisperRunner = ({ cacheDir, engines }) => {
  const MODEL = engines.ON_DEVICE_MODELS[engines.SPEECH_ENGINES.WHISPER];
  const spec = { repo: MODEL.repo, revision: MODEL.revision, files: Object.keys(MODEL.files) };
  let loading = null;
  let chain = Promise.resolve();

  const close = async () => {
    const loaded = loading;
    loading = null;
    idle.stop();
    try {
      await (await loaded)?.model?.dispose?.();
    } catch {
      return;
    }
  };
  const idle = idleCloser(() => void close());

  const cached = () => modelCached(cacheDir, spec);

  const download = (onProgress) => downloadModel(cacheDir, { ...spec, sizes: MODEL.files }, { onProgress });

  const maxTokensFor = (samples) => Math.min(440, 32 + Math.ceil((samples / SAMPLE_RATE) * 25));

  const load = () => {
    if (!loading) {
      loading = (async () => {
        const { lib } = await loadLibrary();
        lib.env.localModelPath = `${modelsRoot(cacheDir)}${path.sep}`;
        const preprocessorConfig = readJson(cacheDir, MODEL.repo, "preprocessor_config.json");
        const tokenizer = new lib.WhisperTokenizer(readJson(cacheDir, MODEL.repo, "tokenizer.json"), readJson(cacheDir, MODEL.repo, "tokenizer_config.json"));
        const processor = new lib.WhisperProcessor(preprocessorConfig, { tokenizer, feature_extractor: new lib.WhisperFeatureExtractor(preprocessorConfig) });
        const model = await lib.AutoModelForSpeechSeq2Seq.from_pretrained(MODEL.repo, {
          dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
          local_files_only: true,
          session_options: sessionOptions(),
        });
        const asr = new lib.AutomaticSpeechRecognitionPipeline({ task: "automatic-speech-recognition", model, tokenizer, processor });
        return { asr, model };
      })();
      loading.catch(() => {
        loading = null;
      });
    }
    idle.touch();
    return loading;
  };

  const transcribe = (audio, language) => {
    const run = chain.then(async () => {
      const { asr } = await load();
      const long = audio.length > 30 * SAMPLE_RATE;
      const result = await asr(audio, {
        language: language || null,
        task: "transcribe",
        return_timestamps: false,
        ...(long ? { chunk_length_s: 30, stride_length_s: 5 } : { max_new_tokens: maxTokensFor(audio.length) }),
      });
      idle.touch();
      return String((Array.isArray(result) ? result[0]?.text : result?.text) || "").trim();
    });
    chain = run.catch(() => {});
    return run;
  };

  const forget = async () => {
    await close();
    forgetModel(cacheDir, MODEL.repo);
  };

  return { cached, download, load, transcribe, forget, close, loaded: () => Boolean(loading) };
};

const standInFiles = (cacheDir, { repo, revision, files }, onProgress, total) => new Promise((resolve) => {
  if (modelCached(cacheDir, { repo, revision, files })) {
    resolve(false);
    return;
  }
  const dir = modelDir(cacheDir, repo);
  let step = 0;
  const tick = () => {
    step += 1;
    onProgress?.({ loaded: Math.round((total * step) / 5), total });
    if (step < 5) {
      setTimeout(tick, 120);
      return;
    }
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), "{}");
    }
    fs.writeFileSync(revisionFile(cacheDir, repo), `${revision}\n`);
    resolve(true);
  };
  onProgress?.({ loaded: 0, total });
  setTimeout(tick, 120);
});

export const createStandInTranslationRunner = ({ cacheDir, models }) => {
  let loadedCode = "";
  const spec = (entry) => ({ repo: entry.repo, revision: entry.revision, files: [...models.MODEL_FILES] });
  const cached = (code) => {
    const entry = models.translationModelFor(code);
    return Boolean(entry) && modelCached(cacheDir, spec(entry));
  };
  return {
    cached,
    download: async (code, onProgress) => {
      const entry = models.translationModelFor(code);
      if (!entry) throw new Error("No translation model for this language.");
      await standInFiles(cacheDir, spec(entry), onProgress, entry.bytes);
    },
    load: async (code) => {
      if (!cached(code)) throw new Error("The translation model is not on this device.");
      loadedCode = code;
    },
    translate: async (code, strings) => {
      if (!cached(code)) throw new Error("The translation model is not on this device.");
      const tag = String(code).toUpperCase();
      return strings.map((text) => {
        const split = models.splitForModel(text);
        const answers = split.pieces.map((piece) => models.acceptModelOutput(piece, `${tag}·${piece}`));
        if (!split.pieces.length || answers.some((answer) => answer === null)) return null;
        return split.join(answers);
      });
    },
    forget: async (code) => {
      const entry = models.translationModelFor(code);
      if (entry) forgetModel(cacheDir, entry.repo);
      if (loadedCode === code) loadedCode = "";
    },
    close: async () => {
      loadedCode = "";
    },
    loadedCode: () => loadedCode,
  };
};

export const STAND_IN_HEARD = "Hold the northern line";

export const createStandInWhisperRunner = ({ cacheDir, engines }) => {
  const MODEL = engines.ON_DEVICE_MODELS[engines.SPEECH_ENGINES.WHISPER];
  const spec = { repo: MODEL.repo, revision: MODEL.revision, files: Object.keys(MODEL.files) };
  let loaded = false;
  return {
    cached: () => modelCached(cacheDir, spec),
    download: (onProgress) => standInFiles(cacheDir, spec, onProgress, Object.values(MODEL.files).reduce((sum, bytes) => sum + bytes, 0)),
    load: async () => {
      if (!modelCached(cacheDir, spec)) throw new Error("The speech model is not on this device.");
      await new Promise((resolve) => setTimeout(resolve, 150));
      loaded = true;
    },
    transcribe: async (audio) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return audio.length ? STAND_IN_HEARD : "";
    },
    forget: async () => {
      loaded = false;
      forgetModel(cacheDir, spec.repo);
    },
    close: async () => {
      loaded = false;
    },
    loaded: () => loaded,
  };
};

const runners = new Map();

const standInOnDevice = (standIn) => standIn && process.env.OH_ONDEVICE_REAL !== "1";

export const translationRunnerFor = ({ cacheDir, models, standIn = false }) => {
  const key = `translation|${cacheDir}`;
  if (!runners.has(key)) runners.set(key, standInOnDevice(standIn) ? createStandInTranslationRunner({ cacheDir, models }) : createTranslationRunner({ cacheDir, models }));
  return runners.get(key);
};

export const whisperRunnerFor = ({ cacheDir, engines, standIn = false }) => {
  const key = `whisper|${cacheDir}`;
  if (!runners.has(key)) runners.set(key, standInOnDevice(standIn) ? createStandInWhisperRunner({ cacheDir, engines }) : createWhisperRunner({ cacheDir, engines }));
  return runners.get(key);
};
