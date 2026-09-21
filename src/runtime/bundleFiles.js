/*! Open Historia — a scenario bundle's heavy assets as real zip entries © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A scenario bundle is one JSON document carrying every asset inside it. That is
// the right shape for a single file the hub can host, and the wrong one inside a
// .zip: the geometry sits as a JSON string that DEFLATE compresses badly through
// all the escaping, and a custom tile archive sits as base64, which DEFLATE can
// barely help at all. So a zip export lifts the heavy assets out into real
// entries — text DEFLATEd, binaries STOREd (bundleZip.js) — and leaves a pointer
// behind. Import puts them back before the bundle reaches the importer, which
// never learns this happened.
//
// Measured on a real hub map: 18.1 MB as one JSON document, 17.1 MB of that the
// base64 of a 12.8 MB regions.geojson. The same map zipped this way is ~3 MB.
//
// The plain .json bundle is untouched by all of this: every bundle already
// shared is still a valid one, and a bundle this module splits is only ever seen
// inside a zip we wrote ourselves.

// Below this an asset stays inline: a handful of small descriptors are not worth
// a zip entry each, and the small ones are already JSON that DEFLATEs with the
// rest of the document.
const LIFT_THRESHOLD_BYTES = 64 * 1024;

const ASSET_DIR = "assets/";

// Base64 in chunks. The obvious one-string loop is what a 100 MB tile archive
// dies on, and a bundle carrying its own tiles is exactly the case this exists
// for.
const CHUNK = 0x8000;
const bytesToBase64 = (bytes) => {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let at = 0; at < array.length; at += CHUNK) {
    binary += String.fromCharCode.apply(null, array.subarray(at, at + CHUNK));
  }
  return btoa(binary);
};

const base64ToBytes = (value) => {
  const binary = atob(String(value ?? ""));
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
};

// What an embedded asset weighs inside the document, near enough to decide
// whether it earns an entry of its own.
const payloadBytes = (descriptor) => {
  const { data } = descriptor ?? {};
  if (typeof data === "string") return data.length;
  if (data && typeof data === "object") {
    // Cheap for the small ones, and the big ones only have to clear a threshold.
    try {
      return JSON.stringify(data).length;
    } catch {
      return LIFT_THRESHOLD_BYTES + 1;
    }
  }
  return 0;
};

const entryPath = (taken, key, fileName) => {
  const base = `${ASSET_DIR}${String(fileName || key).replace(/[^\w.@-]+/g, "-")}`;
  if (!taken.has(base)) return base;
  return `${ASSET_DIR}${key}/${String(fileName || key).replace(/[^\w.@-]+/g, "-")}`;
};

// Lift every heavy embedded asset out of `bundle` into files. Returns the bundle
// to write as scenario.json (a shallow copy — the caller's is untouched) and the
// { path: data } map to hand zipBundle. Assets already split out another way (a
// community basemap travelling as a real image) are simply not there to lift.
export const splitBundleFiles = (bundle) => {
  const assets = bundle?.assets && typeof bundle.assets === "object" ? bundle.assets : null;
  if (!assets) return { bundle, files: {} };

  const files = {};
  const taken = new Set();
  const nextAssets = {};
  for (const [key, descriptor] of Object.entries(assets)) {
    if (descriptor?.mode !== "embedded" || payloadBytes(descriptor) < LIFT_THRESHOLD_BYTES) {
      nextAssets[key] = descriptor;
      continue;
    }
    const path = entryPath(taken, key, descriptor.fileName);
    taken.add(path);
    const { data, encoding, ...rest } = descriptor;
    if (encoding === "base64" && typeof data === "string") {
      files[path] = base64ToBytes(data);
      nextAssets[key] = { ...rest, file: path, format: "base64", mode: "file" };
    } else if (typeof data === "string") {
      files[path] = data;
      nextAssets[key] = { ...rest, file: path, format: "text", mode: "file" };
    } else {
      files[path] = JSON.stringify(data);
      nextAssets[key] = { ...rest, file: path, format: "json", mode: "file" };
    }
  }

  return { bundle: { ...bundle, assets: nextAssets }, files };
};

// Put lifted assets back, so what the importer sees is an ordinary self-contained
// bundle. `zip` is an unzipBundle() handle. A missing entry is left as a default
// slot rather than an empty asset: half a map is worse than an honest gap.
export const restoreBundleFiles = async (bundle, zip) => {
  const assets = bundle?.assets && typeof bundle.assets === "object" ? bundle.assets : null;
  if (!assets || !zip) return bundle;

  const nextAssets = {};
  for (const [key, descriptor] of Object.entries(assets)) {
    if (descriptor?.mode !== "file" || !descriptor.file) {
      nextAssets[key] = descriptor;
      continue;
    }
    const { file, format, ...rest } = descriptor;
    if (!zip.has(file)) {
      nextAssets[key] = { ...rest, mode: "default" };
      continue;
    }
    if (format === "base64") {
      nextAssets[key] = { ...rest, data: bytesToBase64(await zip.bytes(file)), encoding: "base64", mode: "embedded" };
    } else if (format === "text") {
      nextAssets[key] = { ...rest, data: await zip.text(file), mode: "embedded" };
    } else {
      nextAssets[key] = { ...rest, data: JSON.parse(await zip.text(file)), mode: "embedded" };
    }
  }

  return { ...bundle, assets: nextAssets };
};

// Whether a bundle read out of a zip is carrying pointers at all. Callers that
// import from other places (a .json file, the hub's JSON asset) can skip the
// restore entirely.
export const hasBundleFiles = (bundle) =>
  Object.values(bundle?.assets ?? {}).some((descriptor) => descriptor?.mode === "file");
