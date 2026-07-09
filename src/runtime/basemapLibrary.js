/*! Open Historia — basemap library client © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Client for the server-side basemap library ("Your basemaps"). Kept free of any
// OpenLayers/MapLibre deps so it stays light; the editor converts a library
// basemap's payload into the map layer it needs. Thumbnails are generated small
// so the picker can show many previews without lag.

const API = "/api/basemaps";

export const listBasemaps = async () => {
  try {
    const r = await fetch(API);
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
};

export const getBasemapPayload = async (id) => {
  const r = await fetch(`${API}/${encodeURIComponent(id)}/payload`);
  if (!r.ok) throw new Error(`Basemap payload ${id}: HTTP ${r.status}`);
  return r.json();
};

export const createBasemap = async (body) => {
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Save basemap failed: HTTP ${r.status}`);
  return r.json();
};

export const deleteBasemap = async (id) => {
  const r = await fetch(`${API}/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`Delete basemap failed: HTTP ${r.status}`);
  return r.json();
};

// SHA-256 hex of a string — the basemap's content hash, used to dedupe identical
// uploads locally and (later) to reference a matching community basemap.
export const sha256Hex = async (str) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(str)));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

// Downscale an image data URL to a small JPEG thumbnail (low-res preview so the
// picker can render lots of them cheaply). Returns null on failure.
export const makeImageThumbnail = (dataUrl, maxDim = 200) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
      try {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.7));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });

// Render a small preview of a vector basemap by painting each feature with its own
// `fill` colour (the biome map) over a sea background. Lets vector basemaps show a
// real thumbnail in the picker instead of a blank card. Returns a JPEG data URL, or
// null on failure. Pure canvas — no map library needed.
export const makeVectorThumbnail = (geojson, maxDim = 220) => {
  try {
    const feats = geojson?.features || [];
    if (!feats.length) return null;
    const eachRings = (geom, fn) => {
      if (!geom) return;
      if (geom.type === "Polygon") fn(geom.coordinates);
      else if (geom.type === "MultiPolygon") geom.coordinates.forEach(fn);
    };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of feats) eachRings(f.geometry, (rings) => {
      for (const ring of rings) for (const [x, y] of ring) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    });
    if (!Number.isFinite(minX)) return null;
    const w = maxX - minX || 1, h = maxY - minY || 1;
    const scale = Math.min(maxDim / w, maxDim / h);
    const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0b1a2b";
    ctx.fillRect(0, 0, cw, ch);
    const px = (x) => (x - minX) * scale;
    const py = (y) => ch - (y - minY) * scale; // flip Y so north is up
    for (const f of feats) {
      ctx.fillStyle = f.properties?.fill || "#33435c";
      ctx.beginPath();
      eachRings(f.geometry, (rings) => {
        for (const ring of rings) {
          ring.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
          ctx.closePath();
        }
      });
      ctx.fill("evenodd");
    }
    return canvas.toDataURL("image/jpeg", 0.75);
  } catch {
    return null;
  }
};

// Persist a normalized background into the library. `normalized` is
// { kind:"image", dataUrl, aspect } or { kind:"vector", geojson }. Returns the
// stored basemap metadata (deduped server-side by content hash).
export const addBackgroundToLibrary = async (normalized, name, extra = {}) => {
  if (!normalized) return null;
  if (normalized.kind === "image" && normalized.dataUrl) {
    const [thumbnail, contentHash] = await Promise.all([
      makeImageThumbnail(normalized.dataUrl),
      sha256Hex(normalized.dataUrl),
    ]);
    return createBasemap({
      name,
      kind: "image",
      aspect: normalized.aspect || null,
      thumbnail,
      contentHash,
      payload: { dataUrl: normalized.dataUrl },
      ...extra,
    });
  }
  if (normalized.kind === "vector" && normalized.geojson) {
    const thumbnail = makeVectorThumbnail(normalized.geojson);
    const contentHash = await sha256Hex(JSON.stringify(normalized.geojson));
    return createBasemap({
      name,
      kind: "vector",
      thumbnail,
      contentHash,
      payload: { geojson: normalized.geojson },
      ...extra,
    });
  }
  return null;
};
