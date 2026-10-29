import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const FORMAT = 1;
export const KIND = "open-historia-native";
export const INSTALLED_MANIFEST = ".oh-native-manifest.json";
export const UPDATER_EXE = "runtime/Open Historia Updater.exe";
export const LARGE_FILE_BYTES = 1024 * 1024;
export const MIN_CHUNK_BYTES = 1024 * 1024;
export const CUT_EVERY_BYTES = 2 * 1024 * 1024;
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const CUT_MASK = CUT_EVERY_BYTES - 1;

export const PACKS = Object.freeze({
  "native/godot": 32,
  "native/sidecar": 16,
  server: 16,
  node_modules: 8,
  public: 16,
  fmg: 4,
  runtime: 2,
  scripts: 1,
  "": 2,
});

export const SOLO = Object.freeze(["native/godot/version.json", ".oh-native-install"]);

const UNTRACKED = [/^\.oh-native-manifest\.json$/i, /^uninstall\.ps1$/i, /^native\/godot\/\.godot\/(?:imported|editor|shader_cache)\//i];

export const isTracked = (relative) => !UNTRACKED.some((pattern) => pattern.test(relative));

export const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const GEAR = (() => {
  const table = new Int32Array(256);
  let state = 0x4f48_6e61;
  for (let index = 0; index < 256; index += 1) {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    table[index] = (mixed ^ (mixed >>> 14)) | 0;
  }
  return table;
})();

export const cutPoints = (buffer) => {
  const points = [];
  const length = buffer.length;
  let start = 0;
  while (start < length) {
    const remaining = length - start;
    if (remaining <= MIN_CHUNK_BYTES) {
      points.push(length);
      break;
    }
    const limit = start + Math.min(remaining, MAX_CHUNK_BYTES);
    let hash = 0;
    let cut = limit;
    for (let index = start + MIN_CHUNK_BYTES - 32; index < limit; index += 1) {
      hash = ((hash << 1) + GEAR[buffer[index]]) | 0;
      if (index >= start + MIN_CHUNK_BYTES && (hash & CUT_MASK) === 0) {
        cut = index + 1;
        break;
      }
    }
    points.push(cut);
    start = cut;
  }
  return points;
};

const fnv1a = (text) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const areaOf = (file) => {
  const parts = file.split("/");
  if (parts.length < 2) return "";
  const two = `${parts[0]}/${parts[1]}`;
  if (parts.length > 2 && Object.hasOwn(PACKS, two)) return two;
  return Object.hasOwn(PACKS, parts[0]) ? parts[0] : "";
};

export const packOf = (file) => {
  if (SOLO.includes(file)) return `solo:${file}`;
  const area = areaOf(file);
  return `${area}/${fnv1a(file) % PACKS[area]}`;
};

export const normalPath = (file) => String(file).replace(/\\/g, "/").replace(/^\.?\//, "");

export const chunkAssetName = (id) => `c-${String(id).slice(0, 40)}.bin`;
export const PLATFORM_PREFIXES = Object.freeze({ macos: "mac-" });
export const MAC_SHELL_KEY = "OHNativeShell";
export const platformPrefix = (platform) => (Object.hasOwn(PLATFORM_PREFIXES, String(platform ?? "")) ? PLATFORM_PREFIXES[platform] : "");
export const manifestAssetName = (hash, platform = "") => `${platformPrefix(platform)}m-${String(hash).slice(0, 40)}.json`;
export const isHash = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

export const macBundleOf = (root) => {
  const match = /^(.*\.app)\/Contents\/Resources\/app\/?$/.exec(path.resolve(String(root ?? "")).split(path.sep).join("/"));
  return match ? match[1].split("/").join(path.sep) : "";
};

export const readMacShell = (app) => {
  try {
    const plist = fs.readFileSync(path.join(app, "Contents", "Info.plist"), "utf8");
    const found = new RegExp(`<key>${MAC_SHELL_KEY}</key>\\s*<string>([^<]*)</string>`).exec(plist);
    return found ? found[1].trim() : "";
  } catch {
    return "";
  }
};

export const wireSize = (manifest, id) => manifest.packed?.[id] ?? manifest.chunks[id];

export const packChunk = (data) => zlib.gzipSync(data, { level: 9 });

export const unpackChunk = (data, manifest, id) => (manifest.packed?.[id] ? zlib.gunzipSync(data, { maxOutputLength: manifest.chunks[id] + 1 }) : data);

export const planPayload = (entries, details = {}) => {
  const files = entries.map((entry) => ({ path: normalPath(entry.path), data: entry.data }));
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  for (let index = 1; index < files.length; index += 1) {
    if (files[index].path.toLowerCase() === files[index - 1].path.toLowerCase()) throw new Error(`the payload lists ${files[index].path} twice`);
  }
  const chunks = new Map();
  const keep = (data) => {
    const id = sha256(data);
    if (!chunks.has(id)) chunks.set(id, data);
    return id;
  };
  const byPath = new Map();
  const packs = new Map();
  for (const file of files) {
    const record = { path: file.path, size: file.data.length, sha256: sha256(file.data), parts: [] };
    byPath.set(file.path, record);
    if (file.data.length >= LARGE_FILE_BYTES) {
      let start = 0;
      for (const end of cutPoints(file.data)) {
        record.parts.push({ chunk: keep(file.data.subarray(start, end)), at: 0, size: end - start });
        start = end;
      }
    } else if (file.data.length > 0) {
      const pack = packOf(file.path);
      if (!packs.has(pack)) packs.set(pack, []);
      packs.get(pack).push(file);
    }
  }
  for (const members of packs.values()) {
    const id = keep(Buffer.concat(members.map((member) => member.data)));
    let at = 0;
    for (const member of members) {
      byPath.get(member.path).parts.push({ chunk: id, at, size: member.data.length });
      at += member.data.length;
    }
  }
  const sizes = {};
  for (const id of [...chunks.keys()].sort()) sizes[id] = chunks.get(id).length;
  return {
    manifest: {
      kind: KIND,
      format: FORMAT,
      ...details,
      bytes: files.reduce((sum, file) => sum + file.data.length, 0),
      files: files.map((file) => byPath.get(file.path)),
      chunks: sizes,
    },
    chunks,
  };
};

export const readManifest = (value) => {
  const fail = (reason) => ({ manifest: null, error: reason });
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("the manifest is not an object");
  if (value.kind !== KIND) return fail("the manifest is not an Open Historia Native manifest");
  if (value.format !== FORMAT) return fail(`the manifest is format ${value.format}, and this app reads format ${FORMAT}`);
  if (!Array.isArray(value.files) || !value.files.length) return fail("the manifest lists no files");
  if (!value.chunks || typeof value.chunks !== "object" || Array.isArray(value.chunks)) return fail("the manifest lists no chunks");
  for (const [id, size] of Object.entries(value.chunks)) {
    if (!isHash(id) || !Number.isSafeInteger(size) || size <= 0) return fail("a chunk is not described");
  }
  if (value.packed !== undefined) {
    if (!value.packed || typeof value.packed !== "object" || Array.isArray(value.packed)) return fail("the packed sizes are not described");
    for (const [id, size] of Object.entries(value.packed)) {
      if (!Object.hasOwn(value.chunks, id) || !Number.isSafeInteger(size) || size <= 0) return fail("a packed chunk is not described");
    }
  }
  const seen = new Set();
  for (const file of value.files) {
    const name = file?.path;
    if (typeof name !== "string" || !name || name !== normalPath(name)) return fail("a file has no usable path");
    if (name.split("/").some((part) => part === "" || part === "." || part === "..") || /^[A-Za-z]:/.test(name) || /[\0<>:"|?*]/.test(name)) {
      return fail(`the path ${name} leaves the app's folder`);
    }
    if (!isTracked(name)) return fail(`the manifest may not write ${name}`);
    const key = name.toLowerCase();
    if (seen.has(key)) return fail(`the manifest lists ${name} twice`);
    seen.add(key);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !isHash(file.sha256) || !Array.isArray(file.parts)) return fail(`${name} is not described`);
    let total = 0;
    for (const part of file.parts) {
      const chunkSize = value.chunks[part?.chunk];
      if (!isHash(part?.chunk) || !Number.isSafeInteger(chunkSize)) return fail(`${name} is made of a chunk the manifest does not list`);
      if (!Number.isSafeInteger(part.at) || !Number.isSafeInteger(part.size) || part.at < 0 || part.size <= 0 || part.at + part.size > chunkSize) {
        return fail(`${name} reads outside one of its chunks`);
      }
      total += part.size;
    }
    if (total !== file.size) return fail(`${name}'s parts do not add up to its size`);
  }
  return { manifest: value, error: "" };
};

export const chunksOfFile = (data) => {
  if (data.length < LARGE_FILE_BYTES) return [];
  const found = [];
  let start = 0;
  for (const end of cutPoints(data)) {
    found.push({ id: sha256(data.subarray(start, end)), offset: start, size: end - start });
    start = end;
  }
  return found;
};

export const listFiles = (root) => {
  const found = [];
  const walk = (folder, prefix) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(folder, entry.name), relative);
      else if (entry.isFile() && isTracked(relative)) found.push(relative);
    }
  };
  walk(root, "");
  return found.sort();
};

const breather = (sliceMs = 25) => {
  let since = Date.now();
  return async () => {
    if (Date.now() - since < sliceMs) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
    since = Date.now();
  };
};

export const readInstalledManifest = (root) => {
  try {
    return readManifest(JSON.parse(fs.readFileSync(path.join(root, INSTALLED_MANIFEST), "utf8"))).manifest;
  } catch {
    return null;
  }
};

export const indexInstalled = async (root, { manifest = readInstalledManifest(root), onFile = null } = {}) => {
  const files = new Map();
  const chunks = new Map();
  const breathe = breather();
  if (manifest) {
    for (let index = 0; index < manifest.files.length; index += 1) {
      await breathe();
      const entry = manifest.files[index];
      const file = path.join(root, ...entry.path.split("/"));
      let size = -1;
      try {
        size = fs.statSync(file).size;
      } catch {
        size = -1;
      }
      if (size !== entry.size) continue;
      files.set(entry.path.toLowerCase(), { path: entry.path, sha256: entry.sha256, file });
      const whole = entry.size >= LARGE_FILE_BYTES && entry.parts.every((part) => part.at === 0 && part.size === manifest.chunks[part.chunk]);
      if (whole) {
        let offset = 0;
        for (const part of entry.parts) {
          if (!chunks.has(part.chunk)) chunks.set(part.chunk, { file, offset, size: part.size });
          offset += part.size;
        }
      }
      onFile?.(index + 1, manifest.files.length);
    }
    return { files, chunks, manifest, hashed: false };
  }
  const names = fs.existsSync(root) ? listFiles(root) : [];
  for (let index = 0; index < names.length; index += 1) {
    await breathe();
    const relative = names[index];
    const file = path.join(root, ...relative.split("/"));
    let data;
    try {
      data = fs.readFileSync(file);
    } catch {
      continue;
    }
    files.set(relative.toLowerCase(), { path: relative, sha256: sha256(data), file });
    for (const chunk of chunksOfFile(data)) {
      if (!chunks.has(chunk.id)) chunks.set(chunk.id, { file, offset: chunk.offset, size: chunk.size });
    }
    onFile?.(index + 1, names.length);
  }
  return { files, chunks, manifest: null, hashed: true };
};

export const readSlice = (file, offset, size) => {
  const data = Buffer.alloc(size);
  const handle = fs.openSync(file, "r");
  try {
    let read = 0;
    while (read < size) {
      const got = fs.readSync(handle, data, read, size - read, offset + read);
      if (got <= 0) break;
      read += got;
    }
    if (read !== size) throw new Error(`${file} is shorter than it was a moment ago`);
  } finally {
    fs.closeSync(handle);
  }
  return data;
};

export const planUpdate = (manifest, installed = {}) => {
  const haveFiles = installed.files instanceof Map ? installed.files : new Map();
  const haveChunks = installed.chunks instanceof Map ? installed.chunks : new Map();
  const keep = [];
  const build = [];
  const fetch = new Set();
  let reusedBytes = 0;
  const wanted = new Set();
  for (const file of manifest.files) {
    wanted.add(file.path.toLowerCase());
    const have = haveFiles.get(file.path.toLowerCase());
    if (have && have.sha256 === file.sha256 && have.path === file.path) {
      keep.push(file.path);
      reusedBytes += file.size;
      continue;
    }
    const parts = file.parts.map((part) => {
      const source = part.at === 0 && part.size === manifest.chunks[part.chunk] ? haveChunks.get(part.chunk) ?? null : null;
      if (source) reusedBytes += part.size;
      else fetch.add(part.chunk);
      return { ...part, local: source };
    });
    build.push({ path: file.path, size: file.size, sha256: file.sha256, parts });
  }
  const remove = installed.manifest ? installed.manifest.files.map((file) => file.path).filter((name) => !wanted.has(name.toLowerCase())) : [];
  const list = [...fetch].sort();
  return {
    keep,
    build,
    remove,
    fetch: list,
    fetchBytes: list.reduce((sum, id) => sum + wireSize(manifest, id), 0),
    reusedBytes,
    totalBytes: manifest.files.reduce((sum, file) => sum + file.size, 0),
  };
};

export const confirmLocalParts = (plan, manifest) => {
  const fetch = new Set(plan.fetch);
  const checked = new Map();
  for (const file of plan.build) {
    for (const part of file.parts) {
      if (!part.local) continue;
      if (!checked.has(part.chunk)) {
        let ok = false;
        try {
          ok = sha256(readSlice(part.local.file, part.local.offset, part.local.size)) === part.chunk;
        } catch {
          ok = false;
        }
        checked.set(part.chunk, ok);
      }
      if (!checked.get(part.chunk)) {
        part.local = null;
        fetch.add(part.chunk);
      }
    }
  }
  const list = [...fetch].sort();
  return { ...plan, fetch: list, fetchBytes: list.reduce((sum, id) => sum + wireSize(manifest, id), 0) };
};

export const stageEntries = (root) => listFiles(root).map((relative) => ({ path: relative, data: fs.readFileSync(path.join(root, ...relative.split("/"))) }));

export const writeRelease = ({ stage, out, details = {}, reuse = null }) => {
  const { manifest, chunks } = planPayload(stageEntries(stage), details);
  const assets = new Map();
  const packed = {};
  for (const id of Object.keys(manifest.chunks)) {
    const raw = chunks.get(id);
    const squeezed = packChunk(raw);
    if (squeezed.length < raw.length * 0.97) {
      assets.set(id, squeezed);
      packed[id] = squeezed.length;
    } else {
      assets.set(id, raw);
    }
  }
  manifest.packed = packed;
  const manifestText = JSON.stringify(manifest);
  const manifestHash = sha256(Buffer.from(manifestText, "utf8"));
  fs.mkdirSync(out, { recursive: true });
  let written = 0;
  for (const [id, data] of assets) {
    const file = path.join(out, chunkAssetName(id));
    if (fs.existsSync(file) && fs.statSync(file).size === data.length) continue;
    fs.writeFileSync(file, data);
    written += 1;
  }
  const manifestName = manifestAssetName(manifestHash, details.platform);
  fs.writeFileSync(path.join(out, manifestName), manifestText);
  fs.writeFileSync(path.join(stage, INSTALLED_MANIFEST), manifestText);
  const had = reuse ? new Set(Object.keys(reuse.chunks ?? {})) : null;
  const fresh = had ? [...chunks.keys()].filter((id) => !had.has(id)) : [...chunks.keys()];
  const chunkBytes = [...chunks.values()].reduce((sum, data) => sum + data.length, 0);
  return {
    manifest,
    manifestName,
    manifestSize: Buffer.byteLength(manifestText, "utf8"),
    manifestSha256: manifestHash,
    chunkCount: chunks.size,
    chunkBytes,
    written,
    freshChunks: fresh.length,
    freshBytes: fresh.reduce((sum, id) => sum + assets.get(id).length, 0),
    assetBytes: [...assets.values()].reduce((sum, data) => sum + data.length, 0),
  };
};

export const feedChunks = (release, base) => ({
  format: FORMAT,
  base,
  manifest: { name: release.manifestName, size: release.manifestSize, sha256: release.manifestSha256 },
  bytes: release.manifest.bytes,
  files: release.manifest.files.length,
  count: release.chunkCount,
});
