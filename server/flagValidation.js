/*! Open Historia — what counts as a flag © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Shared by the desktop flag library (server/flagStore.js) and the website's and
// Android app's (src/runtime/web/flagStore.js), so the builds agree on what a
// valid flag is. Pure and import-free: the web build bundles it.
//
// A flag is a 256px PNG — tens of kilobytes. The only check used to be that the
// string starts with "data:image/", which let anything up to the 64 MB body
// limit into a library that is read and rewritten on every flag operation, so a
// few oversized entries slow down every request that touches it. Pin the shape
// instead: a known image type, real base64, and a sane ceiling.

export const FLAG_IMAGE_TYPES = new Set(["png", "jpeg", "jpg", "webp", "gif", "svg+xml"]);
export const MAX_FLAG_BYTES = 2 * 1024 * 1024;
const DATA_URL_PATTERN = /^data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i;

export const validateFlagDataUrl = (dataUrl) => {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) throw new Error("A flag must be a base64 image data URL.");
  if (!FLAG_IMAGE_TYPES.has(match[1].toLowerCase())) {
    throw new Error(`Unsupported flag image type: ${match[1]}`);
  }
  // base64 is 4 chars per 3 bytes; compare decoded size against the cap.
  const bytes = Math.floor((match[2].length * 3) / 4);
  if (bytes > MAX_FLAG_BYTES) {
    throw new Error(`That flag is too large (${Math.round(bytes / 1024)} KB; the limit is ${MAX_FLAG_BYTES / 1024} KB).`);
  }
};
