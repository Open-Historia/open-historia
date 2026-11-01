/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Fit to background: pulls the coasts of the selected regions onto the shore a
// background picture shows (a coastline drawn on a fantasy map, the shore of the
// basemap). The picture is read once into a land field: how much each pixel's
// colour is a land colour, learnt from the map itself (the colours found inside
// its land regions against those found outside them), so a fantasy map's green
// and sand are land and its blues are sea, whatever they are. Each coastal chain
// is then cut into points a pixel or two apart, every point looks along the
// border's normal, as far as the reach, for the sharpest change from land to
// sea, the moves are smoothed so the line does not zigzag, and the points a
// straight run does not need are dropped. A river, a shelf of deeper sea, relief
// shading or lettering is no change from land to sea, so none of them pulls.
//
// Only coasts move: an edge one region alone has, or one between land and water
// regions. A border between two land regions stays where it is, and the points
// where a coast meets such a border stay put too, so the borders still meet.
//
// Pure (no canvas): OlMap reads the picture's pixels and hands them here.

import { douglasPeucker } from "ol/geom/flat/simplify.js";
import { reshapeShared } from "./simplifyRegions.js";

// The farthest a border may move, in pixels of the land field.
export const MAX_REACH = 40;
const SPACING = 1.5;
const STEP = 0.5;
const KEEP_WITHIN = 0.4;
// Either side of a point, SIDE pixels are looked at, one apart, to tell land from
// sea there; their median, so a river or a line thinner than half of them is no
// shore. And the least change of landness (0 to 1) that counts as a shore.
const SIDE = 5;
const MIN_SHORE = 0.25;

const polygonsOf = (geometry) => {
  const type = geometry?.getType?.();
  if (type === "Polygon") return [geometry.getCoordinates()];
  if (type === "MultiPolygon") return geometry.getCoordinates();
  return [];
};

// Which pixels (their centres) lie inside the geometries, as a 0/1 mask.
const maskOf = (geometries, width, height, toPixel) => {
  const mask = new Uint8Array(width * height);
  for (const geometry of geometries) {
    for (const polygon of polygonsOf(geometry)) {
      const rows = new Map();
      for (const ring of polygon) {
        for (let i = 1; i < ring.length; i += 1) {
          const [x1, y1] = toPixel(ring[i - 1]);
          const [x2, y2] = toPixel(ring[i]);
          if (y1 === y2) continue;
          const from = Math.max(0, Math.ceil(Math.min(y1, y2) - 0.5));
          const to = Math.min(height - 1, Math.ceil(Math.max(y1, y2) - 0.5) - 1);
          for (let row = from; row <= to; row += 1) {
            const y = row + 0.5;
            const x = x1 + ((x2 - x1) * (y - y1)) / (y2 - y1);
            const list = rows.get(row);
            if (list) list.push(x);
            else rows.set(row, [x]);
          }
        }
      }
      for (const [row, xs] of rows) {
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const start = Math.max(0, Math.ceil(xs[k] - 0.5));
          const end = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
          for (let x = start; x <= end; x += 1) mask[row * width + x] = 1;
        }
      }
    }
  }
  return mask;
};

// How far each pixel is from the nearest pixel on the other side of the mask,
// in pixels (a chamfer pass each way, 3-4 weights).
const distanceToEdge = (mask, width, height) => {
  const far = 1e9;
  const distance = new Float32Array(width * height);
  for (let i = 0; i < distance.length; i += 1) distance[i] = far;
  const relax = (at, from, cost) => {
    if (mask[from] !== mask[at]) distance[at] = Math.min(distance[at], cost === 3 ? 1.5 : 2);
    else distance[at] = Math.min(distance[at], distance[from] + cost / 3);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      if (x > 0) relax(at, at - 1, 3);
      if (y > 0) {
        relax(at, at - width, 3);
        if (x > 0) relax(at, at - width - 1, 4);
        if (x < width - 1) relax(at, at - width + 1, 4);
      }
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const at = y * width + x;
      if (x < width - 1) relax(at, at + 1, 3);
      if (y < height - 1) {
        relax(at, at + width, 3);
        if (x < width - 1) relax(at, at + width + 1, 4);
        if (x > 0) relax(at, at + width - 1, 4);
      }
    }
  }
  return distance;
};

// The middle of a colour bin (16 steps a channel).
const binColour = (bin) => [((bin >> 8) << 4) + 8, (((bin >> 4) & 15) << 4) + 8, ((bin & 15) << 4) + 8];

// A colour as a fit compares colours: brightness, red against green, and yellow
// against blue, the brightness counting a quarter. Shallows are a paler blue
// than the deep sea but still blue, and so nearer it than the sand.
const toCompare = ([r, g, b]) => [0.25 * ((r + g + b) / 3), r - g, (r + g) / 2 - b];

// A land field: { width, height, extent: [minX, minY, maxX, maxY], land }, with
// pixel (0, 0) at the top left (minX, maxY), as an ImageStatic lays a picture.
// `land` holds, for each pixel, how much its colour is one found inside the land
// regions (`landGeometries`) rather than outside them: 1 land, 0 sea. Null when
// the picture shows no land or no sea to learn from.
export const buildLandField = (rgba, width, height, extent, landGeometries) => {
  const [minX, minY, maxX, maxY] = extent;
  const toPixel = ([x, y]) => [((x - minX) / (maxX - minX)) * width, ((maxY - y) / (maxY - minY)) * height];
  const mask = maskOf(landGeometries, width, height, toPixel);
  const distance = distanceToEdge(mask, width, height);
  const size = width * height;
  const binOf = new Uint16Array(size);
  for (let i = 0; i < size; i += 1) {
    const at = i * 4;
    const alpha = rgba[at + 3] / 255;
    binOf[i] = ((rgba[at] * alpha) >> 4) * 256 + ((rgba[at + 1] * alpha) >> 4) * 16 + ((rgba[at + 2] * alpha) >> 4);
  }
  // Colours in 16 steps a channel: how often each is seen inside and outside,
  // away from the borders, since a border drawn off the shore has sea inside it
  // or land outside it there. Nearer the borders only when a region is too small.
  const inside = new Float64Array(4096);
  const outside = new Float64Array(4096);
  let insideTotal = 0;
  let outsideTotal = 0;
  for (const away of [MAX_REACH, MAX_REACH / 2, MAX_REACH / 4, 0]) {
    inside.fill(0);
    outside.fill(0);
    insideTotal = 0;
    outsideTotal = 0;
    for (let i = 0; i < size; i += 1) {
      if (distance[i] < away) continue;
      if (mask[i]) {
        inside[binOf[i]] += 1;
        insideTotal += 1;
      } else {
        outside[binOf[i]] += 1;
        outsideTotal += 1;
      }
    }
    if (insideTotal >= 64 && outsideTotal >= 64) break;
  }
  if (!insideTotal || !outsideTotal) return null;
  // The picture's colours parted in two by colour alone (two-means, from the
  // colours inside and outside), then each part called land as much as its
  // colours were seen inside. Counting colour by colour would not do: where a
  // border was drawn far out to sea, the pale shallows by the shore lie well
  // inside it, and would be learnt as land. Parted by colour, the shallows go
  // with the deep sea, blue with blue.
  const all = new Float64Array(4096);
  for (let i = 0; i < size; i += 1) all[binOf[i]] += 1;
  const bins = [];
  for (let bin = 0; bin < 4096; bin += 1) if (all[bin]) bins.push({ bin, colour: toCompare(binColour(bin)), weight: all[bin] });
  const meanOf = (counts, total) => {
    const mean = [0, 0, 0];
    for (const { bin, colour } of bins) for (let c = 0; c < 3; c += 1) mean[c] += (counts[bin] * colour[c]) / total;
    return mean;
  };
  const apart = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const centres = [meanOf(inside, insideTotal), meanOf(outside, outsideTotal)];
  const part = new Uint8Array(4096);
  for (let round = 0; round < 12; round += 1) {
    const sums = [[0, 0, 0, 0], [0, 0, 0, 0]];
    for (const { bin, colour, weight } of bins) {
      const k = apart(colour, centres[0]) <= apart(colour, centres[1]) ? 0 : 1;
      part[bin] = k;
      for (let c = 0; c < 3; c += 1) sums[k][c] += weight * colour[c];
      sums[k][3] += weight;
    }
    for (let k = 0; k < 2; k += 1) if (sums[k][3]) centres[k] = sums[k].slice(0, 3).map((v) => v / sums[k][3]);
  }
  const shares = [[0, 0], [0, 0]];
  for (const { bin } of bins) {
    shares[part[bin]][0] += inside[bin] / insideTotal;
    shares[part[bin]][1] += outside[bin] / outsideTotal;
  }
  const partLand = shares.map(([a, b]) => (a + b ? a / (a + b) : 0.5));
  if (Math.abs(partLand[0] - partLand[1]) < 0.2) return null;
  // A colour between the two parts (the soft edge of a shore) is between them.
  const spread = Math.max(1, apart(centres[0], centres[1]) / 8);
  const landness = new Float32Array(4096);
  for (const { bin, colour } of bins) {
    const lean = Math.max(-30, Math.min(30, (apart(colour, centres[1]) - apart(colour, centres[0])) / spread));
    const first = 1 / (1 + Math.exp(-lean));
    landness[bin] = first * partLand[0] + (1 - first) * partLand[1];
  }
  const land = new Float32Array(size);
  for (let i = 0; i < size; i += 1) land[i] = landness[binOf[i]];
  return { width, height, extent, land };
};

// The field at a point of pixel space, where pixel i spans i to i + 1.
const sample = (field, px, py) => {
  const { width, height, land } = field;
  const x = Math.max(0, Math.min(width - 1.001, px - 0.5));
  const y = Math.max(0, Math.min(height - 1.001, py - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = y0 * width + x0;
  const right = x0 + 1 < width ? 1 : 0;
  const down = y0 + 1 < height ? width : 0;
  return (land[at] * (1 - fx) + land[at + right] * fx) * (1 - fy) + (land[at + down] * (1 - fx) + land[at + down + right] * fx) * fy;
};

// Points a straight cut of `spacing` apart along the chain, its own points kept.
const densify = (points, spacing) => {
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    const steps = Math.min(4096, Math.floor(Math.hypot(x2 - x1, y2 - y1) / spacing));
    for (let k = 1; k < steps; k += 1) out.push([x1 + ((x2 - x1) * k) / steps, y1 + ((y2 - y1) * k) / steps]);
    out.push(points[i]);
  }
  return out;
};

const smooth = (values, fixed, radius, pick) => {
  const n = values.length;
  const out = new Float64Array(n);
  const window = [];
  for (let i = 0; i < n; i += 1) {
    if (fixed(i)) {
      out[i] = 0;
      continue;
    }
    window.length = 0;
    for (let k = -radius; k <= radius; k += 1) {
      const j = i + k;
      if (j >= 0 && j < n) window.push(fixed(j) ? 0 : values[j]);
    }
    out[i] = pick(window);
  }
  return out;
};
const median = (list) => list.slice().sort((a, b) => a - b)[list.length >> 1];
const mean = (list) => list.reduce((sum, v) => sum + v, 0) / list.length;

// How far along (nx, ny) from (x, y), in pixels and within `reach`, the shore
// nearest the point lies, or 0 when there is none.
const shoreOffset = (field, x, y, nx, ny, reach) => {
  // The landness along the line, every STEP.
  const count = Math.round((2 * (reach + SIDE)) / STEP) + 1;
  const profile = new Float64Array(count);
  for (let k = 0; k < count; k += 1) {
    const t = -reach - SIDE + k * STEP;
    profile[k] = sample(field, x + nx * t, y + ny * t);
  }
  const side = Math.round(SIDE / STEP);
  const pixel = Math.round(1 / STEP);
  const before = new Float64Array(SIDE);
  const after = new Float64Array(SIDE);
  let best = 0;
  let bestScore = 0;
  let bestShore = 0;
  for (let k = side; k + side < count; k += 1) {
    const t = -reach - SIDE + k * STEP;
    for (let j = 0; j < SIDE; j += 1) {
      before[j] = profile[k - 1 - j * pixel];
      after[j] = profile[k + 1 + j * pixel];
    }
    let sum = 0;
    for (let j = 0; j < SIDE; j += 1) sum += before[j] - after[j];
    const shore = Math.abs(before.sort()[SIDE >> 1] - after.sort()[SIDE >> 1]);
    // The medians hold level for a pixel or two about the shore; the means
    // peak on it, and say where on that level it is.
    const score = (0.75 * shore + 0.25 * Math.abs(sum / SIDE)) * (1 - 0.5 * (t / reach) ** 2);
    if (score > bestScore) {
      bestScore = score;
      best = t;
      bestShore = shore;
    }
  }
  return bestShore >= MIN_SHORE ? best : 0;
};

// One pass: each point's move along its normal to the shore in reach. Near a
// chain's two ends, which stay, the moves taper off over the reach, so the line
// does not spike out from them.
const pull = (points, field, reach, closed) => {
  const n = points.length;
  const span = closed ? n - 1 : n;
  const fixed = (i) => !closed && (i === 0 || i === n - 1);
  const at = (i) => points[closed ? ((i % span) + span) % span : Math.max(0, Math.min(n - 1, i))];
  const offsets = new Float64Array(n);
  const normals = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const [ax, ay] = at(i - 2);
    const [bx, by] = at(i + 2);
    const length = Math.hypot(bx - ax, by - ay) || 1;
    normals[i] = [-(by - ay) / length, (bx - ax) / length];
    if (!fixed(i)) offsets[i] = shoreOffset(field, points[i][0], points[i][1], normals[i][0], normals[i][1], reach);
  }
  if (closed) offsets[n - 1] = offsets[0];
  const settled = smooth(smooth(offsets, fixed, 3, median), fixed, 2, mean);
  if (closed) settled[n - 1] = settled[0];
  else {
    const along = new Float64Array(n);
    for (let i = 1; i < n; i += 1) along[i] = along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    for (let i = 0; i < n; i += 1) settled[i] *= Math.min(1, Math.min(along[i], along[n - 1] - along[i]) / reach);
  }
  return points.map(([x, y], i) => [x + normals[i][0] * settled[i], y + normals[i][1] * settled[i]]);
};

// The point where segments ab and cd cross, or null.
const crossing = ([ax, ay], [bx, by], [cx, cy], [dx, dy]) => {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  if (!(d1 * d2 < 0 && d3 * d4 < 0)) return null;
  const t = d1 / (d1 - d2);
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
};

// The line with each small loop it makes cut off where it crosses itself: where
// neighbouring points found the shore a little apart round a sharp bend.
const LOOP = 48;
const unloop = (points) => {
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    out.push(points[i]);
    const last = out.length - 1;
    if (last < 2) continue;
    // Does the newest segment cross one of the last few before it?
    for (let j = last - 2; j >= Math.max(0, last - LOOP); j -= 1) {
      const meet = crossing(out[j], out[j + 1], out[last - 1], out[last]);
      if (!meet) continue;
      out.length = j + 1;
      out.push(meet, points[i]);
      break;
    }
  }
  return out;
};

// A chain's new points, in map units. Its two ends are its own (shared with the
// borders it meets) unless it is a whole ring.
export const fitChain = (points, field, { reach, closed = false }) => {
  if (points.length < 2 || !(reach > 0)) return points;
  const [minX, , maxX, maxY] = field.extent;
  const scale = (maxX - minX) / field.width;
  const scaleY = (maxY - field.extent[1]) / field.height;
  const toPixel = ([x, y]) => [(x - minX) / scale, (maxY - y) / scaleY];
  let line = densify(points.map(toPixel), SPACING);
  line = pull(line, field, reach, closed);
  line = pull(line, field, Math.min(reach, 3), closed);
  line = unloop(line);
  const flat = line.flat();
  const kept = [];
  const end = douglasPeucker(flat, 0, flat.length, 2, KEEP_WITHIN * KEEP_WITHIN, kept, 0);
  const out = [];
  for (let i = 0; i < end; i += 2) out.push([minX + kept[i] * scale, maxY - kept[i + 1] * scaleY]);
  if (closed) out[out.length - 1] = out[0];
  else {
    out[0] = points[0];
    out[out.length - 1] = points[points.length - 1];
  }
  return out.length >= 2 ? out : points;
};

// Whether a closed ring of [x, y] (its last point not repeated) crosses itself,
// found on a grid so a ring of many thousand points is checked at once.
export const ringCrossesItself = (points) => {
  const n = points.length;
  if (n < 4) return false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let length = 0;
  for (let i = 0; i < n; i += 1) {
    const [x, y] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    length += Math.hypot(x2 - x, y2 - y);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const cell = Math.max((length / n) * 2, (maxX - minX + maxY - minY) / 4096, 1e-9);
  const grid = new Map();
  const crosses = (i, j) => {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % n];
    const [cx, cy] = points[j];
    const [dx, dy] = points[(j + 1) % n];
    const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  for (let i = 0; i < n; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % n];
    const x0 = Math.floor((Math.min(ax, bx) - minX) / cell);
    const x1 = Math.floor((Math.max(ax, bx) - minX) / cell);
    const y0 = Math.floor((Math.min(ay, by) - minY) / cell);
    const y1 = Math.floor((Math.max(ay, by) - minY) / cell);
    for (let gx = x0; gx <= x1; gx += 1) {
      for (let gy = y0; gy <= y1; gy += 1) {
        const key = gx * 1048576 + gy;
        const list = grid.get(key);
        if (!list) {
          grid.set(key, [i]);
          continue;
        }
        for (const j of list) {
          const neighbours = Math.abs(i - j) <= 1 || (i === n - 1 && j === 0) || (j === n - 1 && i === 0);
          if (!neighbours && crosses(i, j)) return true;
        }
        list.push(i);
      }
    }
  }
  return false;
};

// The geometries with their coasts fitted to `field` (buildLandField).
// `selected[i]` marks the regions being fitted, `water[i]` the water regions
// among them and around them; an edge moves when a selected region has it and it
// is a coast. A ring the fit would make cross itself is fitted again with less
// reach, and keeps its old line if that does not do either.
export const fitToImage = (geometries, { field, reach, selected, water = [] }) => reshapeShared(geometries, {
  changes: (owners) => {
    if (!owners.some((owner) => selected[owner])) return false;
    if (owners.length === 1) return true;
    return owners.some((owner) => water[owner]) && owners.some((owner) => !water[owner]);
  },
  reshape: (chain, xs, ys, { closed, attempt }) => fitChain(chain.map((at) => [xs[at], ys[at]]), field, { reach: reach * 0.7 ** attempt, closed }),
  validRing: (points) => !ringCrossesItself(points),
  attempts: 4,
  // Where a coast meets a border between two land regions, that point slides
  // along the border onto the shore, inland no further than the border's first
  // point, so the border is not folded back on itself.
  moveJunction: (x, y, dx, dy, length) => {
    const [minX, minY, maxX, maxY] = field.extent;
    const scale = (maxX - minX) / field.width;
    const scaleY = (maxY - minY) / field.height;
    const nx = dx / scale;
    const ny = -dy / scaleY;
    const unit = Math.hypot(nx, ny);
    if (!unit) return null;
    let t = shoreOffset(field, (x - minX) / scale, (maxY - y) / scaleY, nx / unit, ny / unit, reach);
    if (!t) return null;
    const pixels = length * unit;
    t = Math.min(t, 0.9 * pixels);
    return [x + (dx * t) / unit, y + (dy * t) / unit];
  },
});
