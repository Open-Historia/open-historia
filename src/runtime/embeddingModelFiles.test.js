import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { EMBEDDING_MODEL } from "./embeddingModels.js";

// The related-events model ships with the game (public/models/all-MiniLM-L6-v2):
// Vite copies public/ into every build, so the desktop app, the Android app and
// the website all carry it, and nothing is downloaded from a model host.

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const modelDir = path.join(repo, "public", "models", EMBEDDING_MODEL.dir);
const ONNX_SHA256 = "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1";

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});

test("the bundled model's files are the pinned ones, byte for byte in size, and the weights by hash", () => {
  let sum = 0;
  for (const [file, bytes] of Object.entries(EMBEDDING_MODEL.files)) {
    const full = path.join(modelDir, file);
    assert.ok(fs.existsSync(full), `public/models/${EMBEDDING_MODEL.dir}/${file} is missing`);
    assert.equal(fs.statSync(full).size, bytes, `${file} is ${bytes} bytes at the pinned revision`);
    sum += bytes;
  }
  assert.equal(sum, EMBEDDING_MODEL.bytes);
  const weights = fs.readFileSync(path.join(modelDir, "onnx/model_quantized.onnx"));
  assert.equal(createHash("sha256").update(weights).digest("hex"), ONNX_SHA256);
  // Its licence goes with it (Apache-2.0).
  assert.match(fs.readFileSync(path.join(modelDir, "LICENSE"), "utf8"), /Apache License\s+Version 2\.0/);
  assert.match(fs.readFileSync(path.join(modelDir, "README.md"), "utf8"), new RegExp(EMBEDDING_MODEL.revision));
});

test("public/ carries exactly this model's weights: no translation model, no other .onnx", () => {
  const onnx = walk(path.join(repo, "public"))
    .filter((file) => /\.onnx(_data)?$/i.test(file))
    .map((file) => path.relative(repo, file).replace(/\\/g, "/"));
  assert.deepEqual(onnx, [`public/models/${EMBEDDING_MODEL.dir}/onnx/model_quantized.onnx`]);
  // Every file fits the website's host (Cloudflare Pages: 25 MiB a file) and GitHub (100 MB).
  for (const file of walk(modelDir)) assert.ok(fs.statSync(file).size < 25 * 1024 * 1024, `${file} is under 25 MiB`);
});

test("no build drops it: the desktop packs dist/ whole, the Android staging keeps models/", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
  assert.ok(pkg.build.files.includes("dist/**"));
  assert.ok(!pkg.build.files.some((pattern) => /models|onnx/.test(pattern)), "electron-builder excludes nothing of the model");
  for (const config of ["electron-builder.beta.yml"]) {
    const text = fs.readFileSync(path.join(repo, config), "utf8");
    assert.match(text, /^\s*- dist\/\*\*$/m, config);
    assert.doesNotMatch(text, /models|onnx/, `${config} excludes nothing of the model`);
  }
  const stage = fs.readFileSync(path.join(repo, "mobile", "scripts", "stage-www.mjs"), "utf8");
  const siteOnly = stage.slice(stage.indexOf("const SITE_ONLY"), stage.indexOf("];", stage.indexOf("const SITE_ONLY")));
  assert.doesNotMatch(siteOnly, /"models"/);
  const vite = fs.readFileSync(path.join(repo, "vite.config.ts"), "utf8");
  assert.doesNotMatch(vite, /models\//, "the build's drop lists leave public/models alone");
});
