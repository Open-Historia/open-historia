/*!
 * Open Historia Scenario Workshop — Province raster vectorizer
 * User-supplied local files are processed in-browser.
 *
 * The important topology rule is simple: every imported province is traced from
 * the SAME raster pixel lattice. Shared borders therefore start life with exact
 * shared coordinates instead of two independently hand-traced approximations.
 */

const MAX_PIXELS = 30000000;
const MAX_REGIONS = 25000;

const clampLat = (value) => Math.max(-85.05112878, Math.min(85.05112878, Number(value)));

const colorHex = (color) => `#${Number(color >>> 0).toString(16).padStart(6, "0").toUpperCase()}`;

const parseHoi4Definition = (text) => {
  const byColor = new Map();
  if (!text) return byColor;
  const lines = String(text).replace(/\r/g, "").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(";").map((x) => x.trim());
    if (parts.length < 4) continue;
    const id = Number.parseInt(parts[0], 10);
    const r = Number.parseInt(parts[1], 10);
    const g = Number.parseInt(parts[2], 10);
    const b = Number.parseInt(parts[3], 10);
    if (![id, r, g, b].every(Number.isFinite)) continue;
    const color = ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
    byColor.set(color, {
      id,
      type: String(parts[4] || "").toLowerCase(),
      coastal: String(parts[5] || "").toLowerCase(),
      terrain: String(parts[6] || ""),
      continent: String(parts[7] || ""),
    });
  }
  return byColor;
};

const decodeBmpColors = (buffer) => {
  const view = new DataView(buffer);
  if (view.byteLength < 54 || view.getUint8(0) !== 0x42 || view.getUint8(1) !== 0x4d) {
    throw new Error("Not a supported BMP file.");
  }
  const pixelOffset = view.getUint32(10, true);
  const width = view.getInt32(18, true);
  const signedHeight = view.getInt32(22, true);
  const height = Math.abs(signedHeight);
  const bpp = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  if (!width || !height || width < 0) throw new Error("Invalid BMP dimensions.");
  if (compression !== 0) throw new Error("Compressed BMP is not supported yet. Save/export it as uncompressed 24-bit or 32-bit BMP.");
  if (bpp !== 24 && bpp !== 32) throw new Error(`Unsupported BMP depth: ${bpp}-bit. Use 24-bit or 32-bit BMP.`);
  const pixels = width * height;
  if (pixels > MAX_PIXELS) throw new Error(`Raster is too large (${pixels.toLocaleString()} pixels). Current safety cap is ${MAX_PIXELS.toLocaleString()}.`);

  const rowStride = Math.floor((bpp * width + 31) / 32) * 4;
  const bytesPerPixel = bpp / 8;
  const topDown = signedHeight < 0;
  const colors = new Int32Array(pixels);

  for (let y = 0; y < height; y += 1) {
    const srcY = topDown ? y : height - 1 - y;
    const row = pixelOffset + srcY * rowStride;
    const dstRow = y * width;
    for (let x = 0; x < width; x += 1) {
      const off = row + x * bytesPerPixel;
      const b = view.getUint8(off);
      const g = view.getUint8(off + 1);
      const r = view.getUint8(off + 2);
      const a = bpp === 32 ? view.getUint8(off + 3) : 255;
      colors[dstRow + x] = a === 0 ? -1 : ((r << 16) | (g << 8) | b);
    }
  }
  return { width, height, colors };
};

const decodeBrowserImageColors = async (buffer, mime) => {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
    throw new Error("This browser cannot decode this raster in the importer worker. BMP is supported directly; otherwise try PNG in a Chromium/Electron build.");
  }
  const blob = new Blob([buffer], { type: mime || "application/octet-stream" });
  const bitmap = await createImageBitmap(blob);
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    const pixels = width * height;
    if (pixels > MAX_PIXELS) throw new Error(`Raster is too large (${pixels.toLocaleString()} pixels). Current safety cap is ${MAX_PIXELS.toLocaleString()}.`);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const colors = new Int32Array(pixels);
    for (let i = 0, p = 0; i < pixels; i += 1, p += 4) {
      const a = rgba[p + 3];
      colors[i] = a === 0 ? -1 : ((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]);
    }
    return { width, height, colors };
  } finally {
    bitmap.close?.();
  }
};

const decodeRaster = async (buffer, name, mime) => {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".bmp") || String(mime || "").toLowerCase().includes("bmp")) {
    return decodeBmpColors(buffer);
  }
  return decodeBrowserImageColors(buffer, mime);
};

const edgeDir = (a, b, stride) => {
  const ax = a % stride;
  const ay = Math.floor(a / stride);
  const bx = b % stride;
  const by = Math.floor(b / stride);
  if (bx > ax) return 0; // east
  if (by > ay) return 1; // south
  if (bx < ax) return 2; // west
  return 3; // north
};

const pickOutgoing = (entry, start, prevDir, stride) => {
  if (typeof entry === "number") return { next: entry, rest: null };
  if (!Array.isArray(entry) || !entry.length) return { next: null, rest: null };
  if (entry.length === 1) return { next: entry[0], rest: null };
  const preference = [1, 0, 3, 2]; // right, straight, left, reverse
  let bestIndex = 0;
  let bestRank = 99;
  for (let i = 0; i < entry.length; i += 1) {
    const dir = edgeDir(start, entry[i], stride);
    const turn = (dir - prevDir + 4) % 4;
    const rank = preference.indexOf(turn);
    if (rank >= 0 && rank < bestRank) {
      bestRank = rank;
      bestIndex = i;
    }
  }
  const next = entry[bestIndex];
  const rest = entry.length === 2 ? entry[1 - bestIndex] : entry.filter((_, i) => i !== bestIndex);
  return { next, rest };
};

const removeCollinear = (ring) => {
  if (!ring || ring.length < 5) return ring;
  const pts = ring.slice(0, -1);
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i += 1) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const bcx = c[0] - b[0];
    const bcy = c[1] - b[1];
    if (abx * bcy - aby * bcx === 0 && abx * bcx + aby * bcy >= 0) continue;
    out.push(b);
  }
  if (out.length < 3) return ring;
  out.push(out[0].slice());
  return out;
};

const signedArea = (ring) => {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
};

const traceComponentRings = (starts, ends, width) => {
  const stride = width + 1;
  const outgoing = new Map();
  for (let i = 0; i < starts.length; i += 1) {
    const s = starts[i];
    const e = ends[i];
    const cur = outgoing.get(s);
    if (cur === undefined) outgoing.set(s, e);
    else if (typeof cur === "number") outgoing.set(s, [cur, e]);
    else cur.push(e);
  }

  const decode = (key) => [key % stride, Math.floor(key / stride)];
  const rings = [];
  let guardAll = starts.length * 2 + 100;

  while (outgoing.size && guardAll-- > 0) {
    const first = outgoing.entries().next().value;
    if (!first) break;
    const start = first[0];
    const firstPick = pickOutgoing(first[1], start, 0, stride);
    const firstEnd = firstPick.next;
    if (firstEnd == null) {
      outgoing.delete(start);
      continue;
    }
    if (firstPick.rest == null) outgoing.delete(start);
    else outgoing.set(start, firstPick.rest);

    const keys = [start, firstEnd];
    let prev = start;
    let cur = firstEnd;
    let prevDir = edgeDir(prev, cur, stride);
    let guard = starts.length + 10;

    while (cur !== start && guard-- > 0) {
      const entry = outgoing.get(cur);
      if (entry === undefined) break;
      const picked = pickOutgoing(entry, cur, prevDir, stride);
      if (picked.next == null) break;
      if (picked.rest == null) outgoing.delete(cur);
      else outgoing.set(cur, picked.rest);
      prev = cur;
      cur = picked.next;
      prevDir = edgeDir(prev, cur, stride);
      keys.push(cur);
    }

    if (cur !== start || keys.length < 4) continue;
    let ring = keys.map(decode);
    ring = removeCollinear(ring);
    if (ring.length >= 4 && Math.abs(signedArea(ring)) >= 0.5) rings.push(ring);
  }
  return rings;
};

const pointInRing = (point, ring) => {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const hit = ((a[1] > y) !== (b[1] > y)) &&
      (x < ((b[0] - a[0]) * (y - a[1])) / ((b[1] - a[1]) || 1e-12) + a[0]);
    if (hit) inside = !inside;
  }
  return inside;
};

const classifyComponentPolygons = (rings) => {
  if (!rings.length) return [];
  const rows = rings.map((ring) => ({ ring, area: signedArea(ring) }));
  let outers = rows.filter((r) => r.area > 0);
  let holes = rows.filter((r) => r.area < 0);

  // Extremely pathological diagonal-touch cases can reverse all loops. Recover
  // by treating the largest loop as an outer ring instead of dropping a province.
  if (!outers.length) {
    const largest = rows.slice().sort((a, b) => Math.abs(b.area) - Math.abs(a.area))[0];
    outers = [largest];
    holes = rows.filter((r) => r !== largest);
  }

  const polygons = outers.map((row) => ({ outer: row.ring, holes: [] }));
  for (const hole of holes) {
    const probe = hole.ring[0];
    let target = null;
    let targetArea = Infinity;
    for (const poly of polygons) {
      const area = Math.abs(signedArea(poly.outer));
      if (area < targetArea && pointInRing(probe, poly.outer)) {
        target = poly;
        targetArea = area;
      }
    }
    if (target) target.holes.push(hole.ring);
  }
  return polygons.map((p) => [p.outer, ...p.holes]);
};

const mapRing = (ring, width, height, bounds) => {
  const west = Number(bounds.west);
  const east = Number(bounds.east);
  const north = clampLat(bounds.north);
  const south = clampLat(bounds.south);
  return ring.map(([x, y]) => [
    west + (x / width) * (east - west),
    north - (y / height) * (north - south),
  ]);
};

export const vectorizeColorGrid = (width, height, colors, options = {}, progress = () => {}) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Invalid raster dimensions.");
  }
  const count = width * height;
  if (!colors || colors.length !== count) throw new Error("Raster pixel buffer does not match its dimensions.");

  const definition = parseHoi4Definition(options.definitionText || "");
  const landOnly = Boolean(options.landOnly && definition.size);
  const ignoreBlack = options.ignoreBlack !== false;
  const minPixels = Math.max(1, Number.parseInt(options.minPixels || 1, 10) || 1);
  const bounds = {
    west: Number(options.bounds?.west ?? -180),
    east: Number(options.bounds?.east ?? 180),
    north: Number(options.bounds?.north ?? 85.05112878),
    south: Number(options.bounds?.south ?? -85.05112878),
  };
  if (![bounds.west, bounds.east, bounds.north, bounds.south].every(Number.isFinite)) {
    throw new Error("Import bounds must be numeric.");
  }
  if (!(bounds.east > bounds.west) || !(bounds.north > bounds.south)) {
    throw new Error("Import bounds are inverted.");
  }

  const included = (color) => {
    if (color < 0) return false;
    if (ignoreBlack && color === 0) return false;
    if (!landOnly) return true;
    const meta = definition.get(color);
    return Boolean(meta && meta.type === "land");
  };

  const visited = new Uint8Array(count);
  const polygonsByColor = new Map();
  const pixelCountByColor = new Map();
  let components = 0;
  let scanned = 0;
  let nextProgress = 0.04;

  const vertexStride = width + 1;
  const key = (x, y) => y * vertexStride + x;
  const addEdge = (starts, ends, sx, sy, ex, ey) => {
    starts.push(key(sx, sy));
    ends.push(key(ex, ey));
  };

  for (let seed = 0; seed < count; seed += 1) {
    if (visited[seed]) continue;
    const color = colors[seed];
    if (!included(color)) {
      visited[seed] = 1;
      scanned += 1;
      continue;
    }

    visited[seed] = 1;
    const queue = [seed];
    let head = 0;
    let pixelsInComponent = 0;
    const starts = [];
    const ends = [];

    while (head < queue.length) {
      const idx = queue[head++];
      pixelsInComponent += 1;
      scanned += 1;
      const x = idx % width;
      const y = Math.floor(idx / width);

      const top = y > 0 ? idx - width : -1;
      const right = x + 1 < width ? idx + 1 : -1;
      const bottom = y + 1 < height ? idx + width : -1;
      const left = x > 0 ? idx - 1 : -1;

      if (top < 0 || colors[top] !== color) addEdge(starts, ends, x, y, x + 1, y);
      else if (!visited[top]) { visited[top] = 1; queue.push(top); }

      if (right < 0 || colors[right] !== color) addEdge(starts, ends, x + 1, y, x + 1, y + 1);
      else if (!visited[right]) { visited[right] = 1; queue.push(right); }

      if (bottom < 0 || colors[bottom] !== color) addEdge(starts, ends, x + 1, y + 1, x, y + 1);
      else if (!visited[bottom]) { visited[bottom] = 1; queue.push(bottom); }

      if (left < 0 || colors[left] !== color) addEdge(starts, ends, x, y + 1, x, y);
      else if (!visited[left]) { visited[left] = 1; queue.push(left); }
    }

    pixelCountByColor.set(color, (pixelCountByColor.get(color) || 0) + pixelsInComponent);
    if (pixelsInComponent >= minPixels) {
      const rings = traceComponentRings(starts, ends, width);
      const polygons = classifyComponentPolygons(rings);
      if (polygons.length) {
        const cur = polygonsByColor.get(color) || [];
        cur.push(...polygons);
        polygonsByColor.set(color, cur);
        components += 1;
      }
    }

    const ratio = scanned / count;
    if (ratio >= nextProgress) {
      progress(Math.min(0.94, ratio * 0.94), `Tracing provinces… ${Math.round(ratio * 100)}%`);
      nextProgress += 0.04;
    }
  }

  if (polygonsByColor.size > MAX_REGIONS) {
    throw new Error(`Importer found ${polygonsByColor.size.toLocaleString()} unique province colors. Safety cap is ${MAX_REGIONS.toLocaleString()}.`);
  }

  progress(0.96, "Building GeoJSON…");
  const features = [];
  const usedIds = new Set();

  for (const [color, polys] of polygonsByColor.entries()) {
    const totalPixels = pixelCountByColor.get(color) || 0;
    if (totalPixels < minPixels) continue;
    const meta = definition.get(color) || null;
    const sourceId = meta?.id ?? colorHex(color).slice(1);
    let id = meta?.id != null ? `imp-${meta.id}` : `imp-rgb-${colorHex(color).slice(1)}`;
    let suffix = 2;
    const base = id;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    usedIds.add(id);

    const coordinates = polys.map((poly) => poly.map((ring) => mapRing(ring, width, height, bounds)));
    const geometry = coordinates.length === 1
      ? { type: "Polygon", coordinates: coordinates[0] }
      : { type: "MultiPolygon", coordinates };

    const sourceType = meta?.type || "";
    const props = {
      name: meta?.id != null ? `Province ${meta.id}` : `Province ${colorHex(color)}`,
      owner: null,
      typeId: sourceType && sourceType !== "land" ? "water" : "land",
      country: "",
      claimants: null,
      sourceProvinceId: sourceId,
      sourceColor: colorHex(color),
      sourceType,
      sourceCoastal: meta?.coastal || "",
      sourceTerrain: meta?.terrain || "",
      sourceContinent: meta?.continent || "",
      sourcePixels: totalPixels,
    };
    features.push({ type: "Feature", id, properties: props, geometry });
  }

  progress(1, `Ready: ${features.length.toLocaleString()} regions`);
  return {
    type: "FeatureCollection",
    features,
    importStats: {
      width,
      height,
      pixels: count,
      regions: features.length,
      components,
      definitionRows: definition.size,
      landOnly,
      bounds,
    },
  };
};

const handleVectorize = async (payload) => {
  const { buffer, name, mime, options } = payload;
  const { width, height, colors } = await decodeRaster(buffer, name, mime);
  const result = vectorizeColorGrid(
    width,
    height,
    colors,
    options,
    (fraction, message) => self.postMessage({ type: "progress", fraction, message }),
  );
  return result;
};

if (typeof self !== "undefined") {
  self.onmessage = async (event) => {
    const msg = event.data || {};
    if (msg.type !== "vectorize") return;
    try {
      self.postMessage({ type: "progress", fraction: 0.01, message: "Decoding raster…" });
      const result = await handleVectorize(msg);
      self.postMessage({ type: "done", result });
    } catch (error) {
      self.postMessage({ type: "error", message: error?.message || String(error) });
    }
  };
}
