"use strict";

const { parentPort } = require("node:worker_threads");
const zlib = require("node:zlib");

const TILE_PX = 512;
const SAMPLES = 4;

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  varint() {
    let result = 0;
    let mul = 1;
    let byte = 0;
    do {
      byte = this.buf[this.pos];
      this.pos += 1;
      result += (byte & 0x7f) * mul;
      mul *= 128;
    } while (byte & 0x80);
    return result;
  }

  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`unknown wire type ${wire}`);
  }

  bytes() {
    const length = this.varint();
    const out = this.buf.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }

  string() {
    return Buffer.from(this.bytes()).toString("utf8");
  }

  packed() {
    const end = this.varint() + this.pos;
    const out = [];
    while (this.pos < end) out.push(this.varint());
    return out;
  }
}

const zigzag = (n) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

const decodeValue = (buf) => {
  const r = new Reader(buf);
  let value = null;
  while (r.pos < buf.length) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 1) value = r.string();
    else if (field === 2) {
      value = r.view.getFloat32(r.pos, true);
      r.pos += 4;
    } else if (field === 3) {
      value = r.view.getFloat64(r.pos, true);
      r.pos += 8;
    } else if (field === 4) {
      const raw = r.varint();
      value = raw >= 2 ** 63 ? raw - 2 ** 64 : raw;
    } else if (field === 5) value = r.varint();
    else if (field === 6) value = zigzag(r.varint());
    else if (field === 7) value = r.varint() !== 0;
    else r.skip(wire);
  }
  return value;
};

const decodeLayer = (buf) => {
  const r = new Reader(buf);
  const layer = { name: "", extent: 4096, keys: [], values: [], features: [] };
  while (r.pos < buf.length) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 1) layer.name = r.string();
    else if (field === 2) {
      const fb = r.bytes();
      const fr = new Reader(fb);
      const feature = { id: null, tags: [], type: 0, geometry: [] };
      while (fr.pos < fb.length) {
        const ftag = fr.varint();
        const ffield = Math.floor(ftag / 8);
        const fwire = ftag % 8;
        if (ffield === 1) feature.id = fr.varint();
        else if (ffield === 2) feature.tags = fr.packed();
        else if (ffield === 3) feature.type = fr.varint();
        else if (ffield === 4) feature.geometry = fr.packed();
        else fr.skip(fwire);
      }
      layer.features.push(feature);
    } else if (field === 3) layer.keys.push(r.string());
    else if (field === 4) layer.values.push(decodeValue(r.bytes()));
    else if (field === 5) layer.extent = r.varint();
    else r.skip(wire);
  }
  return layer;
};

const decodeTile = (buf) => {
  const r = new Reader(buf);
  const layers = {};
  while (r.pos < buf.length) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 3 && wire === 2) {
      const layer = decodeLayer(r.bytes());
      layers[layer.name] = layer;
    } else r.skip(wire);
  }
  return layers;
};

const propertiesOf = (layer, feature) => {
  const props = {};
  for (let i = 0; i + 1 < feature.tags.length; i += 2) props[layer.keys[feature.tags[i]]] = layer.values[feature.tags[i + 1]];
  return props;
};

const geometryOf = (feature, scale) => {
  const parts = [];
  let current = null;
  let x = 0;
  let y = 0;
  const g = feature.geometry;
  let i = 0;
  while (i < g.length) {
    const command = g[i] & 0x7;
    const count = Math.floor(g[i] / 8);
    i += 1;
    if (command === 1 || command === 2) {
      for (let c = 0; c < count; c += 1) {
        x += zigzag(g[i]);
        y += zigzag(g[i + 1]);
        i += 2;
        if (command === 1) {
          current = [];
          parts.push(current);
        }
        current.push([x * scale, y * scale]);
      }
    } else if (command === 7) {
      if (current && current.length) current.push([current[0][0], current[0][1]]);
    } else break;
  }
  return parts;
};

const TYPE_NAMES = ["Unknown", "Point", "LineString", "Polygon"];

const compare = (a, b) => (a === b ? 0 : a < b ? -1 : 1);

const evalFilter = (filter, props, type, id) => {
  if (!Array.isArray(filter) || !filter.length) return true;
  const op = filter[0];
  const value = (key) => (key === "$type" ? TYPE_NAMES[type] : key === "$id" ? id : props[key]);
  switch (op) {
    case "all": return filter.slice(1).every((f) => evalFilter(f, props, type, id));
    case "any": return filter.slice(1).some((f) => evalFilter(f, props, type, id));
    case "none": return !filter.slice(1).some((f) => evalFilter(f, props, type, id));
    case "==": return value(filter[1]) === filter[2];
    case "!=": return value(filter[1]) !== filter[2];
    case ">": return value(filter[1]) !== undefined && compare(value(filter[1]), filter[2]) > 0;
    case ">=": return value(filter[1]) !== undefined && compare(value(filter[1]), filter[2]) >= 0;
    case "<": return value(filter[1]) !== undefined && compare(value(filter[1]), filter[2]) < 0;
    case "<=": return value(filter[1]) !== undefined && compare(value(filter[1]), filter[2]) <= 0;
    case "in": return filter.slice(2).includes(value(filter[1]));
    case "!in": return !filter.slice(2).includes(value(filter[1]));
    case "has": return value(filter[1]) !== undefined;
    case "!has": return value(filter[1]) === undefined;
    default: return true;
  }
};

const parseColor = (text) => {
  if (Array.isArray(text)) return text;
  const s = String(text ?? "").trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = hex.split("").map((c) => c + c).join("");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return [r, g, b, a];
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(",").map((p) => parseFloat(p));
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  m = s.match(/^hsla?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(",").map((p) => parseFloat(p));
    const h = (((parts[0] % 360) + 360) % 360) / 360;
    const sat = parts[1] / 100;
    const l = parts[2] / 100;
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
    const p = 2 * l - q;
    const hue = (t) => {
      let u = t;
      if (u < 0) u += 1;
      if (u > 1) u -= 1;
      if (u < 1 / 6) return p + (q - p) * 6 * u;
      if (u < 1 / 2) return q;
      if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
      return p;
    };
    return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255, parts.length > 3 ? parts[3] : 1];
  }
  return null;
};

const isColorString = (v) => typeof v === "string" && parseColor(v) !== null;

const interpolate = (a, b, t) => {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * t;
  if (isColorString(a) && isColorString(b)) {
    const ca = parseColor(a);
    const cb = parseColor(b);
    return ca.map((v, i) => v + (cb[i] - v) * t);
  }
  return t < 1 ? a : b;
};

const factor = (input, base, lower, upper) => {
  const span = upper - lower;
  const progress = input - lower;
  if (span === 0) return 0;
  if (base === 1) return progress / span;
  return (base ** progress - 1) / (base ** span - 1);
};

const evalFunction = (fn, zoom, props) => {
  const stops = fn.stops;
  const input = fn.property !== undefined ? props[fn.property] : zoom;
  const interpolatable = typeof stops[0][1] === "number" || isColorString(stops[0][1]);
  const type = fn.type || (fn.property !== undefined && !interpolatable ? "categorical" : interpolatable ? "exponential" : "interval");
  if (type === "identity") return input === undefined ? fn.default : input;
  if (type === "categorical") {
    for (const [key, out] of stops) if (key === input) return out;
    return fn.default;
  }
  if (typeof input !== "number") return fn.default ?? stops[0][1];
  if (type === "interval") {
    let out = stops[0][1];
    for (const [key, value] of stops) if (input >= key) out = value;
    return out;
  }
  if (input <= stops[0][0]) return stops[0][1];
  if (input >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i + 1 < stops.length; i += 1) {
    const [z0, v0] = stops[i];
    const [z1, v1] = stops[i + 1];
    if (input >= z0 && input <= z1) return interpolate(v0, v1, factor(input, fn.base ?? 1, z0, z1));
  }
  return stops[stops.length - 1][1];
};

const evalValue = (value, zoom, props) => {
  if (value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.stops)) return evalFunction(value, zoom, props);
  if (Array.isArray(value) && value[0] === "*" && value.length === 3) {
    const a = evalValue(value[1], zoom, props);
    const b = evalValue(value[2], zoom, props);
    return Number(a) * Number(b);
  }
  return value;
};

const colorOf = (value) => {
  if (Array.isArray(value) && value.length >= 3 && typeof value[0] === "number") return value;
  return parseColor(value);
};

class Canvas {
  constructor(size) {
    this.size = size;
    this.rgba = new Float32Array(size * size * 4);
    this.coverage = new Float32Array(size * size);
    this.used = false;
    this.dirty = null;
  }

  mark(x0, y0, x1, y1) {
    const d = this.dirty;
    if (!d) this.dirty = [x0, y0, x1, y1];
    else {
      d[0] = Math.min(d[0], x0);
      d[1] = Math.min(d[1], y0);
      d[2] = Math.max(d[2], x1);
      d[3] = Math.max(d[3], y1);
    }
  }

  fillRings(rings) {
    const size = this.size;
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const ring of rings) {
      for (const [x, y] of ring) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    const row0 = Math.max(0, Math.floor(minY));
    const row1 = Math.min(size - 1, Math.ceil(maxY));
    if (row1 < row0 || maxX < 0 || minX > size) return;
    const edges = [];
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i += 1) {
        const a = ring[i - 1];
        const b = ring[i];
        if (a[1] === b[1]) continue;
        edges.push(a[0], a[1], b[0], b[1]);
      }
    }
    const crossings = [];
    const rowCover = new Float32Array(size);
    this.mark(Math.max(0, Math.floor(minX)), row0, Math.min(size - 1, Math.ceil(maxX)), row1);
    for (let y = row0; y <= row1; y += 1) {
      let touched = false;
      for (let s = 0; s < SAMPLES; s += 1) {
        const sy = y + (s + 0.5) / SAMPLES;
        crossings.length = 0;
        for (let e = 0; e < edges.length; e += 4) {
          const ay = edges[e + 1];
          const by = edges[e + 3];
          if ((ay > sy) === (by > sy)) continue;
          const ax = edges[e];
          const bx = edges[e + 2];
          crossings.push(ax + ((sy - ay) * (bx - ax)) / (by - ay));
        }
        if (crossings.length < 2) continue;
        crossings.sort((a, b) => a - b);
        for (let k = 0; k + 1 < crossings.length; k += 2) {
          const x0 = Math.max(0, crossings[k]);
          const x1 = Math.min(size, crossings[k + 1]);
          if (x1 <= x0) continue;
          const c0 = Math.floor(x0);
          const c1 = Math.min(size - 1, Math.ceil(x1) - 1);
          for (let x = c0; x <= c1; x += 1) {
            const left = Math.max(x0, x);
            const right = Math.min(x1, x + 1);
            if (right > left) {
              rowCover[x] += (right - left) / SAMPLES;
              touched = true;
            }
          }
        }
      }
      if (!touched) continue;
      const base = y * size;
      for (let x = 0; x < size; x += 1) {
        const c = rowCover[x];
        if (c > 0) {
          const v = c > 1 ? 1 : c;
          if (v > this.coverage[base + x]) this.coverage[base + x] = v;
          rowCover[x] = 0;
        }
      }
    }
  }

  strokeSegment(ax, ay, bx, by, half, blur) {
    const size = this.size;
    const reach = half + 0.5 + blur;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx) + reach));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - reach));
    const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by) + reach));
    if (x1 < x0 || y1 < y0) return;
    this.mark(x0, y0, x1, y1);
    const dx = bx - ax;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy;
    const soft = blur + 1;
    for (let y = y0; y <= y1; y += 1) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x += 1) {
        const px = x + 0.5;
        let t = length2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / length2 : 0;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const qx = ax + dx * t - px;
        const qy = ay + dy * t - py;
        const d = Math.sqrt(qx * qx + qy * qy);
        const c = (half + 0.5 - d) / soft;
        if (c <= 0) continue;
        const v = c > 1 ? 1 : c;
        const index = y * size + x;
        if (v > this.coverage[index]) this.coverage[index] = v;
      }
    }
  }

  composite(color, opacity) {
    const d = this.dirty;
    if (!d) return;
    const size = this.size;
    const r = color[0] / 255;
    const g = color[1] / 255;
    const b = color[2] / 255;
    const alpha = (color[3] ?? 1) * opacity;
    for (let y = d[1]; y <= d[3]; y += 1) {
      for (let x = d[0]; x <= d[2]; x += 1) {
        const index = y * size + x;
        const c = this.coverage[index];
        if (c <= 0) continue;
        this.coverage[index] = 0;
        const a = c * alpha;
        if (a <= 0) continue;
        const o = index * 4;
        const keep = 1 - a;
        this.rgba[o] = r * a + this.rgba[o] * keep;
        this.rgba[o + 1] = g * a + this.rgba[o + 1] * keep;
        this.rgba[o + 2] = b * a + this.rgba[o + 2] * keep;
        this.rgba[o + 3] = a + this.rgba[o + 3] * keep;
        this.used = true;
      }
    }
    this.dirty = null;
  }

  png() {
    if (!this.used) return null;
    const size = this.size;
    const rows = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y += 1) {
      const line = y * (size * 4 + 1);
      rows[line] = 0;
      for (let x = 0; x < size; x += 1) {
        const o = (y * size + x) * 4;
        const a = this.rgba[o + 3];
        const p = line + 1 + x * 4;
        if (a <= 0) continue;
        rows[p] = Math.round(Math.min(1, this.rgba[o] / a) * 255);
        rows[p + 1] = Math.round(Math.min(1, this.rgba[o + 1] / a) * 255);
        rows[p + 2] = Math.round(Math.min(1, this.rgba[o + 2] / a) * 255);
        rows[p + 3] = Math.round(Math.min(1, a) * 255);
      }
    }
    return encodePng(size, size, rows);
  }
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const encodePng = (width, height, rows) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const dashed = (line, pattern, width) => {
  if (!Array.isArray(pattern) || pattern.length < 2) return [line];
  const lengths = pattern.map((v) => Math.max(0, Number(v) || 0) * Math.max(width, 1));
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= 0) return [line];
  const out = [];
  let phase = 0;
  let index = 0;
  let remaining = lengths[0];
  let current = [line[0]];
  for (let i = 1; i < line.length; i += 1) {
    let [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    let segment = Math.hypot(bx - ax, by - ay);
    while (segment > 0) {
      const step = Math.min(segment, remaining);
      const t = step / segment;
      const nx = ax + (bx - ax) * t;
      const ny = ay + (by - ay) * t;
      if (index % 2 === 0) current.push([nx, ny]);
      segment -= step;
      remaining -= step;
      ax = nx;
      ay = ny;
      if (remaining <= 1e-9) {
        if (index % 2 === 0 && current.length > 1) out.push(current);
        index = (index + 1) % lengths.length;
        remaining = lengths[index];
        current = index % 2 === 0 ? [[ax, ay]] : [];
      }
    }
    phase += 1;
  }
  if (index % 2 === 0 && current.length > 1) out.push(current);
  return out;
};

const lineCenter = (line) => {
  let total = 0;
  for (let i = 1; i < line.length; i += 1) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  if (total <= 0) return { point: line[0], angle: 0, length: 0 };
  let walked = 0;
  for (let i = 1; i < line.length; i += 1) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const step = Math.hypot(bx - ax, by - ay);
    if (walked + step >= total / 2) {
      const t = step > 0 ? (total / 2 - walked) / step : 0;
      let angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      return { point: [ax + (bx - ax) * t, ay + (by - ay) * t], angle, length: total };
    }
    walked += step;
  }
  return { point: line[line.length - 1], angle: 0, length: total };
};

const fieldText = (template, props) => String(template ?? "").replace(/\{\s*([^}]+?)\s*\}/g, (_, key) => (props[key] === undefined || props[key] === null ? "" : String(props[key]))).trim();

let styleLayers = [];

const render = ({ z, x, y, pbf }) => {
  const tile = decodeTile(new Uint8Array(pbf));
  const zoom = z;
  const fills = new Canvas(TILE_PX);
  const lines = new Canvas(TILE_PX);
  const labels = [];
  const n = 2 ** z;
  for (let index = 0; index < styleLayers.length; index += 1) {
    const layer = styleLayers[index];
    if (layer.layout?.visibility === "none") continue;
    if (layer.minzoom !== undefined && zoom < layer.minzoom) continue;
    if (layer.maxzoom !== undefined && zoom >= layer.maxzoom) continue;
    const source = tile[layer["source-layer"]];
    if (!source) continue;
    const scale = TILE_PX / source.extent;
    if (layer.type === "fill") {
      const paint = layer.paint ?? {};
      if (paint["fill-pattern"] !== undefined || paint["fill-color"] === undefined) continue;
      let painted = false;
      let color = null;
      let opacity = 1;
      for (const feature of source.features) {
        if (feature.type !== 3) continue;
        const props = propertiesOf(source, feature);
        if (!evalFilter(layer.filter, props, feature.type, feature.id)) continue;
        if (!color) {
          color = colorOf(evalValue(paint["fill-color"], zoom, props));
          opacity = Number(evalValue(paint["fill-opacity"] ?? 1, zoom, props));
        }
        fills.fillRings(geometryOf(feature, scale));
        painted = true;
      }
      if (painted && color) fills.composite(color, Number.isFinite(opacity) ? opacity : 1);
    } else if (layer.type === "line") {
      const paint = layer.paint ?? {};
      if (paint["line-pattern"] !== undefined) continue;
      let painted = false;
      let color = null;
      let opacity = 1;
      for (const feature of source.features) {
        if (feature.type !== 2 && feature.type !== 3) continue;
        const props = propertiesOf(source, feature);
        if (!evalFilter(layer.filter, props, feature.type, feature.id)) continue;
        const width = Number(evalValue(paint["line-width"] ?? 1, zoom, props)) || 0;
        if (width <= 0) continue;
        if (!color) {
          color = colorOf(evalValue(paint["line-color"] ?? "#000000", zoom, props));
          opacity = Number(evalValue(paint["line-opacity"] ?? 1, zoom, props));
        }
        const blur = Number(evalValue(paint["line-blur"] ?? 0, zoom, props)) || 0;
        const pattern = evalValue(paint["line-dasharray"], zoom, props);
        for (const part of geometryOf(feature, scale)) {
          for (const piece of dashed(part, pattern, width)) {
            for (let i = 1; i < piece.length; i += 1) lines.strokeSegment(piece[i - 1][0], piece[i - 1][1], piece[i][0], piece[i][1], width / 2, blur);
          }
        }
        painted = true;
      }
      if (painted && color) lines.composite(color, Number.isFinite(opacity) ? opacity : 1);
    } else if (layer.type === "symbol") {
      const layout = layer.layout ?? {};
      const paint = layer.paint ?? {};
      if (!layout["text-field"]) continue;
      const placement = evalValue(layout["symbol-placement"] ?? "point", zoom, {});
      for (const feature of source.features) {
        const props = propertiesOf(source, feature);
        if (!evalFilter(layer.filter, props, feature.type, feature.id)) continue;
        const text = fieldText(evalValue(layout["text-field"], zoom, props), props);
        if (!text) continue;
        const parts = geometryOf(feature, 1 / source.extent);
        if (!parts.length || !parts[0].length) continue;
        let at = parts[0][0];
        let angle = 0;
        if (placement === "line" || placement === "line-center") {
          if (feature.type !== 2) continue;
          let best = null;
          for (const part of parts) {
            const center = lineCenter(part);
            if (!best || center.length > best.length) best = center;
          }
          at = best.point;
          angle = best.angle;
        }
        const mx = (x + at[0]) / n;
        const my = (y + at[1]) / n;
        if (at[0] < 0 || at[0] >= 1 || at[1] < 0 || at[1] >= 1) continue;
        const lon = mx * 360 - 180;
        const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
        const font = evalValue(layout["text-font"] ?? ["Noto Sans Regular"], zoom, props);
        labels.push({
          lon,
          lat,
          angle,
          line: placement === "line" || placement === "line-center",
          text,
          size: Number(evalValue(layout["text-size"] ?? 16, zoom, props)) || 16,
          font: Array.isArray(font) ? String(font[0] ?? "") : String(font ?? ""),
          color: colorOf(evalValue(paint["text-color"] ?? "#000000", zoom, props)),
          halo: colorOf(evalValue(paint["text-halo-color"] ?? "rgba(0,0,0,0)", zoom, props)),
          haloWidth: Number(evalValue(paint["text-halo-width"] ?? 0, zoom, props)) || 0,
          opacity: Number(evalValue(paint["text-opacity"] ?? 1, zoom, props)),
          transform: String(evalValue(layout["text-transform"] ?? "none", zoom, props)),
          spacing: Number(evalValue(layout["text-letter-spacing"] ?? 0, zoom, props)) || 0,
          maxWidth: Number(evalValue(layout["text-max-width"] ?? 10, zoom, props)) || 10,
          lineHeight: Number(evalValue(layout["text-line-height"] ?? 1.2, zoom, props)) || 1.2,
          offset: evalValue(layout["text-offset"] ?? [0, 0], zoom, props),
          anchor: String(evalValue(layout["text-anchor"] ?? "center", zoom, props)),
          padding: Number(evalValue(layout["text-padding"] ?? 2, zoom, props)) || 0,
          overlap: Boolean(evalValue(layout["text-allow-overlap"] ?? false, zoom, props)),
          priority: index,
          minzoom: layer.minzoom ?? 0,
          maxzoom: layer.maxzoom ?? 24,
        });
      }
    }
  }
  return { fills: fills.png(), lines: lines.png(), labels };
};

parentPort.on("message", (message) => {
  if (message?.type === "style") {
    styleLayers = Array.isArray(message.layers) ? message.layers : [];
    return;
  }
  if (message?.type !== "tile") return;
  try {
    const result = render(message);
    const transfer = [];
    const fills = result.fills ? new Uint8Array(result.fills) : null;
    const lines = result.lines ? new Uint8Array(result.lines) : null;
    if (fills) transfer.push(fills.buffer);
    if (lines) transfer.push(lines.buffer);
    parentPort.postMessage({ id: message.id, fills, lines, labels: result.labels }, transfer);
  } catch (error) {
    parentPort.postMessage({ id: message.id, error: String(error?.message ?? error) });
  }
});
