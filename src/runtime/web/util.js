/*! Open Historia — web-mode store utilities © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Shared helpers for the web-mode store handlers. Mirrors the small utilities in
// server/libraryStore.js / mapEditorStore.js / basemapStore.js so the browser
// port produces byte-compatible ids, hashes and response envelopes.

export const cloneJson = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // Fall through for values structuredClone can't handle (e.g. functions).
    }
  }
  return JSON.parse(JSON.stringify(value));
};

export const nowIso = () => new Date().toISOString();

// Matches normalizeId in server/libraryStore.js:316 (prefix form) and
// mapEditorStore.js:38 (48-char slug). `maxLen` defaults to unlimited to match
// the library store; pass 48 for the map editor.
export const normalizeId = (value, prefix = "item", maxLen = 0) => {
  let slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (maxLen > 0) slug = slug.slice(0, maxLen);
  if (!slug) return `${prefix}-${Date.now().toString(36)}`;
  return slug;
};

// Append -2, -3, … until `exists(id)` is false. `exists` is async.
export const ensureUniqueId = async (requestedId, exists) => {
  let candidate = requestedId;
  let suffix = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await exists(candidate)) {
    candidate = `${requestedId}-${suffix}`;
    suffix += 1;
  }
  return candidate;
};

// SHA-256 hex of a string — identical to sha256Hex in basemapLibrary.js:43 and
// hashPayload in basemapStore.js so local + community dedup stays consistent.
export const sha256Hex = async (str) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(str)));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

// --- Response builders (return real Response objects the intercepted fetch
// hands back to the unchanged client code) ---

export const jsonResponse = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });

export const errorResponse = (message, status = 400) =>
  jsonResponse({ error: String(message ?? "Request failed") }, status);

// Serve bytes with HTTP Range support, mirroring streamBinaryFile
// (server/server.js:122) + parseByteRange (server/security.js:59) so the
// PMTiles protocol and <img>/range consumers behave the same as against the
// real server.
export const binaryResponse = (bytes, contentType, rangeHeader) => {
  const buffer = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  const total = buffer.byteLength;
  const baseHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Type": contentType || "application/octet-stream",
  };

  if (!rangeHeader) {
    return new Response(buffer, { status: 200, headers: { ...baseHeaders, "Content-Length": String(total) } });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!match) {
    return new Response(buffer, { status: 200, headers: { ...baseHeaders, "Content-Length": String(total) } });
  }

  const hasStart = match[1] !== "";
  const hasEnd = match[2] !== "";
  let start;
  let end;
  if (!hasStart) {
    // Suffix range: last N bytes.
    const suffix = hasEnd ? Number(match[2]) : 0;
    if (!suffix) return unsatisfiable(total);
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = hasEnd ? Math.min(Number(match[2]), total - 1) : total - 1;
  }

  if (!Number.isFinite(start) || start >= total || start > end) {
    return unsatisfiable(total);
  }

  const slice = buffer.slice(start, end + 1);
  return new Response(slice, {
    status: 206,
    headers: {
      ...baseHeaders,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${total}`,
    },
  });
};

const unsatisfiable = (total) =>
  new Response(null, {
    status: 416,
    headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${total}`, "Cache-Control": "no-store" },
  });

// colors/geojson may be stored as a parsed object (seed/export) OR as the raw
// uploaded text (server stores upload bytes verbatim and never validates). These
// normalize both, mirroring the server's readJsonFile (parse-with-fallback) and
// byte-faithful streaming.
export const parseJsonValue = (value, fallback) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value === undefined ? fallback : value;
};

export const serializeJsonValue = (value) => (typeof value === "string" ? value : JSON.stringify(value));

export const base64ToBytes = (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export const bytesToBase64 = (bytes) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
};
