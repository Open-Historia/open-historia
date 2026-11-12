import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sidecar = path.resolve(here, "..");
const repo = path.resolve(sidecar, "..", "..");
const pack = await import(pathToFileURL(path.join(repo, "native", "onDevicePack.mjs")).href);
const onDevice = await import(pathToFileURL(path.join(sidecar, "onDevice.mjs")).href);
const models = await import(pathToFileURL(path.join(repo, "src", "runtime", "translationModels.js")).href);
const engines = await import(pathToFileURL(path.join(repo, "src", "runtime", "speechEngines.js")).href);

const touch = (file) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x");
};

const fakeModules = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-ondevice-"));
  for (const [platform, arch] of [["win32", "x64"], ["win32", "arm64"], ["darwin", "arm64"], ["linux", "x64"], ["linux", "arm64"]]) {
    touch(path.join(dir, "onnxruntime-node", "bin", "napi-v6", platform, arch, "onnxruntime_binding.node"));
  }
  touch(path.join(dir, "onnxruntime-node", "bin", "napi-v6", "linux", "x64", "libonnxruntime_providers_cuda.so"));
  for (const file of ["ort.node.min.js", "ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs", "ort.all.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) touch(path.join(dir, "onnxruntime-web", "dist", file));
  touch(path.join(dir, "onnxruntime-web", "package.json"));
  for (const file of ["transformers.node.mjs", "transformers.node.cjs", "transformers.web.js", "transformers.min.js"]) touch(path.join(dir, "@huggingface", "transformers", "dist", file));
  touch(path.join(dir, "sharp", "package.json"));
  touch(path.join(dir, "@img", "sharp-win32-x64", "lib.node"));
  return dir;
};

test("the Windows package keeps only its own ONNX runtime and drops the image library", () => {
  const dir = fakeModules();
  const result = pack.pruneOnDeviceRuntime(dir, { platform: "win32", arches: ["x64"] });
  assert.deepEqual(result.native, ["x64"]);
  assert.deepEqual(fs.readdirSync(path.join(dir, "onnxruntime-node", "bin", "napi-v6")), ["win32"]);
  assert.deepEqual(fs.readdirSync(path.join(dir, "onnxruntime-node", "bin", "napi-v6", "win32")), ["x64"]);
  assert.equal(fs.existsSync(path.join(dir, "onnxruntime-web")), false);
  assert.equal(fs.existsSync(path.join(dir, "sharp")), false);
  assert.equal(fs.existsSync(path.join(dir, "@img")), false);
  assert.deepEqual(fs.readdirSync(path.join(dir, "@huggingface", "transformers", "dist")).sort(), ["transformers.node.cjs", "transformers.node.mjs"]);
});

test("the Mac package runs arm64 natively and Intel on the WebAssembly runtime", () => {
  const dir = fakeModules();
  const result = pack.pruneOnDeviceRuntime(dir, { platform: "darwin", arches: ["arm64", "x64"] });
  assert.deepEqual(result.native, ["arm64"]);
  assert.deepEqual(result.wasm, ["x64"]);
  assert.deepEqual(fs.readdirSync(path.join(dir, "onnxruntime-web", "dist")).sort(), ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm", "ort.node.min.js"]);
});

test("the Linux package drops the CUDA providers", () => {
  const dir = fakeModules();
  pack.pruneOnDeviceRuntime(dir, { platform: "linux", arches: ["x64"] });
  assert.deepEqual(fs.readdirSync(path.join(dir, "onnxruntime-node", "bin", "napi-v6", "linux", "x64")), ["onnxruntime_binding.node"]);
});

test("models go to the app's own cache folder and count as there only when complete", async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-models-"));
  const runner = onDevice.createStandInTranslationRunner({ cacheDir, models });
  assert.equal(runner.cached("fi"), false);
  const seen = [];
  await runner.download("fi", (step) => seen.push(step));
  assert.equal(runner.cached("fi"), true);
  assert.ok(fs.existsSync(path.join(cacheDir, "models", "Xenova", "opus-mt-en-fi", "onnx", "encoder_model_quantized.onnx")));
  assert.equal(seen.at(-1).loaded, seen.at(-1).total);
  fs.writeFileSync(path.join(cacheDir, "models", "Xenova", "opus-mt-en-fi", ".revision"), "another\n");
  assert.equal(runner.cached("fi"), false);
  const whisper = onDevice.createStandInWhisperRunner({ cacheDir, engines });
  await whisper.download();
  assert.equal(whisper.cached(), true);
  await whisper.forget();
  assert.equal(whisper.cached(), false);
});

test("models converted for the game download from the scenario repository, Xenova's from Hugging Face", async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-mirror-"));
  const asked = [];
  const fetcher = async (url) => {
    asked.push(url);
    return { ok: true, body: [Buffer.from("{}")] };
  };
  for (const code of ["lv", "fi"]) {
    const entry = models.translationModelFor(code);
    await onDevice.downloadModel(cacheDir, { host: models.MODEL_HOST, repo: entry.repo, revision: entry.revision, files: [...models.MODEL_FILES], total: entry.bytes, urlOf: (file) => models.modelFileUrl(entry, file) }, { fetcher });
  }
  assert.equal(asked.length, models.MODEL_FILES.length * 2);
  assert.equal(asked[0], `https://raw.githubusercontent.com/Open-Historia/Open-historia-scenarios/${models.MIRROR.commit}/models/opus-mt-en-bat/${models.MODEL_FILES[0]}`);
  assert.ok(asked.at(-1).startsWith("https://huggingface.co/Xenova/opus-mt-en-fi/resolve/"));
  const runner = onDevice.createStandInTranslationRunner({ cacheDir, models });
  assert.equal(runner.cached("lv"), true);
  assert.equal(runner.cached("lt"), true, "Latvian and Lithuanian share one download");
  assert.equal(runner.cached("fi"), true);
});
