/*! Open Historia — web flag library store © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Browser port of server/flagStore.js. Backs /api/flags* in web mode so the editor's
// "My flags" shelf works identically on the website and the download.
//
// One record per flag in its own `flags` object store — the same shape every other
// collection here uses (scenarios, games, basemapMeta). The `kv` store is for small
// singletons (manifests, ui-settings); a growing library kept there would mean
// rewriting the entire set on every save.
//
// Hash canonicalization must stay identical to server/flagStore.js (sha256 of the
// data URL), or the same flag dedupes on the download and duplicates on the website.

import { STORES, idbGetAll, idbPut, idbDelete } from "./idb.js";

const sha256Hex = async (str) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(str)));
  return Array.from(new Uint8Array(buf)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const slug = (raw, fallback = "flag") =>
  String(raw ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || fallback;

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Newest first, matching the server's [new, ...rest] order so both builds list the
// library the same way.
const listFlags = async () => {
  const all = await idbGetAll(STORES.flags);
  return all.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
};

const createFlag = async (body = {}) => {
  const dataUrl = String(body.dataUrl || "");
  // Same shape check as the server store (server/flagStore.js): a known image
  // type, real base64, and a ceiling — so the two halves of the same feature
  // accept the same things and a flag that saves locally also saves on a server.
  const match = /^data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl);
  if (!match) throw new Error("A flag must be a base64 image data URL.");
  if (!["png", "jpeg", "jpg", "webp", "gif", "svg+xml"].includes(match[1].toLowerCase())) {
    throw new Error(`Unsupported flag image type: ${match[1]}`);
  }
  if (Math.floor((match[2].length * 3) / 4) > 2 * 1024 * 1024) {
    throw new Error("That flag is too large (the limit is 2048 KB).");
  }
  const flags = await listFlags();
  const contentHash = await sha256Hex(dataUrl);
  const existing = flags.find((f) => f.contentHash === contentHash);
  if (existing) return existing;

  const base = slug(body.name || body.code);
  let id = base;
  for (let n = 2; flags.some((f) => f.id === id); n += 1) id = `${base}-${n}`;

  const flag = {
    id,
    name: String(body.name || body.code || "Flag").slice(0, 80),
    code: String(body.code || "").toUpperCase().slice(0, 12),
    author: String(body.author || "").slice(0, 80),
    dataUrl,
    contentHash,
    // See server/flagStore.js — marks a flag installed from the community hub so
    // it isn't re-offered to the hub when a scenario using it is published.
    source: body.source && typeof body.source === "object" ? JSON.parse(JSON.stringify(body.source)) : null,
    createdAt: new Date().toISOString(),
  };
  await idbPut(STORES.flags, flag);
  return flag;
};

const deleteFlag = async (id) => {
  await idbDelete(STORES.flags, String(id ?? ""));
  return { id, deleted: true };
};

// Router entry: /api/flags  and  /api/flags/:id
export const handleFlags = async ({ method, segments, body }) => {
  if (segments.length === 0 && method === "GET") return jsonResponse(await listFlags());
  if (segments.length === 0 && method === "POST") {
    try {
      return jsonResponse(await createFlag(body ?? {}), 201);
    } catch (error) {
      return jsonResponse({ error: error.message }, 400);
    }
  }
  if (segments.length === 1 && method === "DELETE") {
    return jsonResponse(await deleteFlag(decodeURIComponent(segments[0])));
  }
  return jsonResponse({ error: "Unsupported flag request." }, 404);
};
