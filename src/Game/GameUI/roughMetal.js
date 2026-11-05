/*! Open Historia — a plate of rough steel, and the rivets that hold it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The war room is plated in steel that has seen use: dark, unevenly worn,
// grained, streaked the way it was rolled, pitted, and scratched. The owner
// asked for this look for the war room; every other surface of the interface
// is a flat colour.
//
// Like the war room's button (brushedMetal.js) it is worked out a pixel at a
// time and nothing here is drawn by the browser: each pixel's shade is the sum
// of a few kinds of unevenness, the same every time. The plate is a TILE: what
// leaves it on one edge comes back on the other, so it can be laid side by
// side over a panel of any size with no seam.

// A number from 0 up to 1 for two whole numbers, the same on every machine.
const hash = (x, y, seed) => {
  let value = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
};

const clamp = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const ease = (t) => t * t * (3 - 2 * t);

// Unevenness that changes slowly: a number from 0 to 1 at a place on a lattice
// `cols` by `rows` across the tile, blended between the lattice's corners, and
// wrapping at the tile's edges.
const drift = (u, v, cols, rows, seed) => {
  const x = u * cols;
  const y = v * rows;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = ease(x - x0);
  const ty = ease(y - y0);
  const at = (cx, cy) => hash(((cx % cols) + cols) % cols, ((cy % rows) + rows) % rows, seed);
  const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
  const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
};

// The plate as pixels: `size` across and down, red, green, blue and how solid
// (all of it), a byte each.
//   base   the colour of the steel, [red, green, blue] 0-255
//   wear   how rough: 1 is the war room's plate, 0 a clean sheet
export const roughMetalPixels = (size, { base = [50, 53, 58], wear = 1, seed = 5 } = {}) => {
  const light = new Float32Array(size * size).fill(1);
  const wrap = (value) => ((Math.round(value) % size) + size) % size;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const u = col / size;
      const v = row / size;
      // The grain of the metal, a pixel at a time.
      const grain = (hash(col, row, seed) - 0.5) * 0.11;
      // Worn unevenly: broad patches, and smaller ones within them.
      const patches = (drift(u, v, 3, 3, seed + 1) - 0.5) * 0.27 + (drift(u, v, 9, 9, seed + 2) - 0.5) * 0.14;
      // Rolled one way: long faint streaks along it.
      const streaks = (drift(u, v, 2, 72, seed + 3) - 0.5) * 0.13;
      light[row * size + col] += (grain + patches + streaks) * wear;
    }
  }
  // Pits: small dark hollows, each with a brighter lip where the light catches its far edge.
  const pits = Math.round((size * size) / 1500 * wear);
  for (let pit = 0; pit < pits; pit += 1) {
    const cx = hash(pit, 1, seed + 11) * size;
    const cy = hash(pit, 2, seed + 11) * size;
    const radius = 0.8 + hash(pit, 3, seed + 11) * 1.9;
    const depth = 0.16 + hash(pit, 4, seed + 11) * 0.22;
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const out = Math.sqrt(dx * dx + dy * dy);
        const at = wrap(cy + dy) * size + wrap(cx + dx);
        if (out <= radius) light[at] -= depth * (1 - out / (radius + 0.5));
        else if (out <= radius + 1.1 && dx + dy > 0) light[at] += 0.07;
      }
    }
  }
  // Scratches: thin bright lines, most of them nearly along the roll, each
  // with the dark of its own shadow under it.
  const scratches = Math.round(17 * wear);
  for (let scratch = 0; scratch < scratches; scratch += 1) {
    let x = hash(scratch, 1, seed + 23) * size;
    let y = hash(scratch, 2, seed + 23) * size;
    const steep = hash(scratch, 3, seed + 23) > 0.75;
    const turn = (hash(scratch, 4, seed + 23) - 0.5) * (steep ? 2.4 : 0.5);
    const length = size * (0.12 + hash(scratch, 5, seed + 23) * (steep ? 0.3 : 0.75));
    const bright = 0.14 + hash(scratch, 6, seed + 23) * 0.2;
    const stepX = Math.cos(turn) * 0.5;
    const stepY = Math.sin(turn) * 0.5;
    for (let walked = 0; walked < length; walked += 0.5) {
      // It fades in and out at its ends, and wavers a little on the way.
      const fade = Math.min(1, walked / 6, (length - walked) / 6);
      const waver = 0.7 + hash(Math.floor(walked / 3), scratch, seed + 29) * 0.3;
      light[wrap(y) * size + wrap(x)] += bright * fade * waver * 0.5;
      light[wrap(y + 1) * size + wrap(x)] -= bright * fade * 0.28;
      x += stepX;
      y += stepY;
    }
  }
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let index = 0; index < size * size; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) pixels[index * 4 + channel] = Math.round(clamp((base[channel] * light[index]) / 255) * 255);
    pixels[index * 4 + 3] = 255;
  }
  return pixels;
};

// A rivet: a small dome of steel lit from the upper left, in a dark ring where
// it sits in the plate. `size` across; clear outside its ring.
export const rivetPixels = (size, { base = [132, 138, 146] } = {}) => {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const middle = size / 2;
  const radius = size / 2 - 1;
  const dome = radius * 0.78;
  // Where the light comes from: up, left, and toward the eye.
  const lx = -0.5;
  const ly = -0.62;
  const lz = 0.6;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const dx = col + 0.5 - middle;
      const dy = row + 0.5 - middle;
      const out = Math.sqrt(dx * dx + dy * dy);
      if (out > radius) continue;
      const at = (row * size + col) * 4;
      let lightness;
      if (out > dome) {
        // The ring it sits in: dark, darker on the side away from the light.
        lightness = 0.2 + ((-dx * lx - dy * ly) / radius) * -0.08;
      } else {
        const nx = dx / dome;
        const ny = dy / dome;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const lit = Math.max(0, nx * lx + ny * ly + nz * lz);
        // A dull dome with one small bright spot.
        lightness = 0.34 + lit * 0.72 + (lit > 0.93 ? (lit - 0.93) * 4.5 : 0);
      }
      for (let channel = 0; channel < 3; channel += 1) pixels[at + channel] = Math.round(clamp((base[channel] * lightness) / 255) * 255);
      pixels[at + 3] = Math.round(clamp(radius - out) * 255);
    }
  }
  return pixels;
};

// The same as pictures a stylesheet can use, each made once.
const made = new Map();
const pictureOf = (key, size, pixelsOf) => {
  if (typeof document === "undefined") return "";
  if (made.has(key)) return made.get(key);
  let url = "";
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    const image = context.createImageData(size, size);
    image.data.set(pixelsOf());
    context.putImageData(image, 0, 0);
    url = canvas.toDataURL("image/png");
  } catch {
    // No canvas (a test, a very old browser): the panel keeps its flat colour.
    url = "";
  }
  made.set(key, url);
  return url;
};

export const roughMetalUrl = (size = 256, options = {}) => pictureOf(`plate|${size}|${JSON.stringify(options)}`, size, () => roughMetalPixels(size, options));
export const rivetUrl = (size = 28, options = {}) => pictureOf(`rivet|${size}|${JSON.stringify(options)}`, size, () => rivetPixels(size, options));
