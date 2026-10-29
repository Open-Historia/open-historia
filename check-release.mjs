import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const update = await import(pathToFileURL(path.join(here, "sidecar", "handlers", "update.mjs")).href);
const kit = await import(pathToFileURL(path.join(here, "sidecar", "updateChunks.mjs")).href);

const ASSET_LIMIT = 950;
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const fail = (problems) => {
  for (const problem of problems) process.stderr.write(`check-release: ${problem}\n`);
  process.exit(1);
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const readAssets = (file) => {
  if (!file || file === "none" || !fs.existsSync(file)) return new Map();
  const raw = readJson(file);
  const list = Array.isArray(raw) ? raw : raw.assets ?? [];
  return new Map(list.map((asset) => [String(asset.name), Number(asset.size)]));
};

const load = (out) => {
  const problems = [];
  const feedFile = path.join(out, update.NATIVE_MANIFEST_NAME);
  const exe = path.join(out, update.NATIVE_SETUP_NAME);
  if (!fs.existsSync(feedFile)) fail([`missing ${feedFile}`]);
  if (!fs.existsSync(exe)) fail([`missing ${exe}`]);
  const raw = readJson(feedFile);
  const feed = update.parseManifest(raw);
  if (!feed) fail([`${feedFile} is not a feed the app can read`]);
  if (feed.url !== update.NATIVE_SETUP_URL) problems.push(`url ${feed.url} is not ${update.NATIVE_SETUP_URL}`);
  if (!/^\d{14}$/.test(feed.build)) problems.push(`build ${feed.build} is not a UTC stamp`);
  const size = fs.statSync(exe).size;
  if (feed.size !== size) problems.push(`size ${feed.size} is not the installer's ${size}`);
  if (feed.sha256 !== sha256(exe)) problems.push("sha256 is not the installer's");
  if (!feed.chunks) problems.push("the feed carries no chunks block, so every update would be the full installer");
  const chunkDir = path.join(out, "chunks");
  const wanted = new Map();
  let manifest = null;
  if (feed.chunks) {
    if (feed.chunks.base !== update.NATIVE_CHUNKS_BASE) problems.push(`chunks.base ${feed.chunks.base} is not ${update.NATIVE_CHUNKS_BASE}`);
    const named = feed.chunks.manifest;
    const manifestFile = path.join(chunkDir, named.name);
    if (!fs.existsSync(manifestFile)) problems.push(`missing the file list ${manifestFile}`);
    else {
      if (fs.statSync(manifestFile).size !== named.size || sha256(manifestFile) !== named.sha256) problems.push(`${named.name} is not the file list the feed names`);
      const read = kit.readManifest(readJson(manifestFile));
      if (!read.manifest) problems.push(`${named.name}: ${read.error}`);
      manifest = read.manifest;
      if (manifest && String(manifest.build) !== feed.build) problems.push(`${named.name} describes build ${manifest.build}, the feed ${feed.build}`);
      wanted.set(named.name, named.size);
    }
    if (manifest) {
      for (const id of Object.keys(manifest.chunks)) {
        const name = kit.chunkAssetName(id);
        const file = path.join(chunkDir, name);
        const size = kit.wireSize(manifest, id);
        wanted.set(name, size);
        if (!fs.existsSync(file)) problems.push(`missing chunk ${name}`);
        else if (fs.statSync(file).size !== size) problems.push(`chunk ${name} is ${fs.statSync(file).size} bytes, the file list says ${size}`);
      }
      const installed = path.join(out, "stage", kit.INSTALLED_MANIFEST);
      if (fs.existsSync(installed) && sha256(installed) !== named.sha256) problems.push("the staged app carries another file list than the feed names");
    }
  }
  return { feed, raw, exe, size, chunkDir, wanted, manifest, problems };
};

const [mode, outArg, ...rest] = process.argv.slice(2);
const out = path.resolve(outArg || "");
const release = load(out);

if (mode === "local") {
  if (release.problems.length) fail(release.problems);
  const { feed, wanted } = release;
  const chunkBytes = [...wanted.values()].reduce((sum, size) => sum + size, 0);
  console.log(`${update.NATIVE_MANIFEST_NAME}: ${feed.version} build ${feed.build} (${feed.commit || "no commit"}), installer ${megabytes(feed.size)}, sha256 ${feed.sha256}`);
  console.log(`chunks: ${wanted.size - 1} pieces and the file list ${feed.chunks.manifest.name}, ${megabytes(chunkBytes)} in all`);
} else if (mode === "plan") {
  if (release.problems.length) fail(release.problems);
  const remote = readAssets(rest[0]);
  const missing = [];
  const wrong = [];
  for (const [name, size] of release.wanted) {
    if (!remote.has(name)) missing.push(name);
    else if (remote.get(name) !== size) wrong.push(`${name} is ${remote.get(name)} bytes on the release, ${size} here`);
  }
  if (wrong.length) fail(wrong);
  const after = new Set([...remote.keys(), ...missing]).size;
  if (after > ASSET_LIMIT) fail([`the chunk release would hold ${after} files, over ${ASSET_LIMIT}; prune it before publishing`]);
  const bytes = missing.reduce((sum, name) => sum + release.wanted.get(name), 0);
  process.stderr.write(`${missing.length} of ${release.wanted.size} chunk files to upload (${megabytes(bytes)}); ${release.wanted.size - missing.length} are on the release already; it will hold ${after} files\n`);
  const listFile = rest[1];
  const ordered = [...missing.filter((name) => name.startsWith("c-")), ...missing.filter((name) => !name.startsWith("c-"))];
  if (listFile) fs.writeFileSync(listFile, ordered.map((name) => path.join(release.chunkDir, name)).join("\n") + (ordered.length ? "\n" : ""));
} else if (mode === "remote-chunks") {
  const remote = readAssets(rest[0]);
  const problems = [];
  for (const [name, size] of release.wanted) {
    if (!remote.has(name)) problems.push(`${name} is not on the chunk release`);
    else if (remote.get(name) !== size) problems.push(`${name} is ${remote.get(name)} bytes on the chunk release, ${size} here`);
  }
  if (problems.length) fail(problems.slice(0, 20).concat(problems.length > 20 ? [`and ${problems.length - 20} more`] : []));
  console.log(`every one of the ${release.wanted.size} chunk files the feed needs is on the chunk release`);
} else if (mode === "remote-installer") {
  const remote = readAssets(rest[0]);
  if (remote.get(update.NATIVE_SETUP_NAME) !== release.size) fail([`${update.NATIVE_SETUP_NAME} on the release is ${remote.get(update.NATIVE_SETUP_NAME) ?? "missing"}, here ${release.size} bytes`]);
  console.log(`${update.NATIVE_SETUP_NAME} on the release is ${release.size} bytes, as the feed says`);
} else if (mode === "live") {
  const [liveFeed, liveManifest] = rest;
  const live = update.parseManifest(readJson(liveFeed));
  const problems = [];
  if (!live) problems.push("the live feed cannot be read by the app");
  else {
    for (const key of ["build", "sha256", "size", "url"]) if (live[key] !== release.feed[key]) problems.push(`the live feed's ${key} is ${live[key]}, here ${release.feed[key]}`);
    if (JSON.stringify(live.chunks) !== JSON.stringify(release.feed.chunks)) problems.push("the live feed's chunks block is not the one published");
  }
  if (liveManifest) {
    const named = release.feed.chunks.manifest;
    if (!fs.existsSync(liveManifest) || fs.statSync(liveManifest).size !== named.size || sha256(liveManifest) !== named.sha256) problems.push(`the live ${named.name} is not the file list the feed names`);
  }
  if (problems.length) fail(problems);
  console.log(`the live feed names build ${release.feed.build}, and its file list downloads intact`);
} else {
  fail([`usage: node native/check-release.mjs local|plan|remote-chunks|remote-installer|live <out> [...]`]);
}
