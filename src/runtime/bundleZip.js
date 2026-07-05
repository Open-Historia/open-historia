/*! Open Historia — zip bundle helpers © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Thin wrappers over JSZip for the community hub's "one file to upload" bundles.
// A scenario that carries a custom basemap ships as a single .zip (scenario JSON +
// the raw basemap image + a small preview) instead of one bloated base64 JSON, so
// the author drags a single file into the hub post and the image travels as real
// bytes rather than a ~33%-larger data URL.

import JSZip from "jszip";

// Build a .zip Blob from a { path: data } map. String entries are DEFLATE-compressed
// (JSON/GeoJSON shrink a lot); binary entries (already-compressed PNG/JPEG) are STOREd
// so we don't waste CPU re-compressing them for near-zero gain. null/undefined skipped.
export const zipBundle = async (files) => {
  const zip = new JSZip();
  for (const [path, data] of Object.entries(files || {})) {
    if (data == null) continue;
    const isBinary = data instanceof Uint8Array || data instanceof ArrayBuffer;
    zip.file(path, data, { compression: isBinary ? "STORE" : "DEFLATE" });
  }
  return zip.generateAsync({ type: "blob" });
};

// Load a .zip (ArrayBuffer / Uint8Array / Blob) and return typed accessors. Each
// getter returns null when the entry is absent so callers can probe optional files.
export const unzipBundle = async (input) => {
  const zip = await JSZip.loadAsync(input);
  const entry = (p) => zip.file(p);
  return {
    has: (p) => Boolean(entry(p)),
    names: () => Object.keys(zip.files).filter((n) => !zip.files[n].dir),
    text: async (p) => (entry(p) ? entry(p).async("string") : null),
    base64: async (p) => (entry(p) ? entry(p).async("base64") : null),
    bytes: async (p) => (entry(p) ? entry(p).async("uint8array") : null),
  };
};

// A .zip always starts with the local-file-header magic "PK\x03\x04". Used to tell a
// zip bundle from a JSON bundle when the URL/extension is ambiguous.
export const looksLikeZip = (bytes) => {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
};
