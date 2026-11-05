/*! Open Historia — the steel of the vault door © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The metal the vault door (VaultDoor.jsx) is made of. The owner, on seeing
// the door drawn in flat colour (2026-10-13): "looks good, but give the metal
// texture".
//
// Two pictures of brushed steel, MADE here pixel by pixel when the door is
// first shown, not shipped as files: a round one, brushed in circles the way
// a lathe leaves a face (for the door and its wheel), and a square one,
// brushed straight across, that repeats (for the wall the door is set in).
// They are pictures of a material, as the logo in the hub is a picture: the
// interface's surfaces stay flat, and nothing here is one colour fading into
// another across a panel.
//
// The numbers are kept dark and a little blue, so the door sits in the grey
// of the rest of the interface.

// A small seeded generator (mulberry32): the same door every time.
export const seeded = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// `count` numbers between -1 and 1, each a little like its neighbours: the
// brush leaves lines of every width, not salt and pepper. `wrap` makes the
// last run into the first, for a picture that repeats.
const lines = (count, random, { smooth = 2, wrap = false } = {}) => {
  let values = Float32Array.from({ length: count }, () => random() * 2 - 1);
  for (let pass = 0; pass < smooth; pass += 1) {
    const next = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const before = i > 0 ? values[i - 1] : wrap ? values[count - 1] : values[i];
      const after = i < count - 1 ? values[i + 1] : wrap ? values[0] : values[i];
      next[i] = (before + values[i] * 2 + after) / 4;
    }
    values = next;
  }
  return values;
};

// Steel is not grey: a touch more blue than red.
const steel = (data, at, value) => {
  data[at] = value * 0.93;
  data[at + 1] = value * 0.98;
  data[at + 2] = value * 1.07;
  data[at + 3] = 255;
};

// The round face: `size` pixels square, RGBA. Fine rings from the brush,
// broader bands under them, grain, and the two bright sweeps a turned face
// shows wherever the light catches the rings side on.
export const brushedDisc = (size, { seed = 1921, base = 66 } = {}) => {
  const random = seeded(seed);
  const data = new Uint8ClampedArray(size * size * 4);
  const half = size / 2;
  const reach = Math.ceil(half * Math.SQRT2) + 2;
  const fine = lines(reach * 2, random, { smooth: 1 });
  const broad = lines(Math.ceil(reach / 6) + 2, random, { smooth: 2 });
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - half;
      const dy = y + 0.5 - half;
      const radius = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      // Brightest toward the upper left and the lower right, where the light
      // lies along the rings; a second, weaker pair between them.
      const sweep = Math.cos(2 * (angle + 0.75)) * 0.75 + Math.cos(4 * (angle - 0.3)) * 0.25;
      const band = broad[Math.floor(radius / 6)];
      const value = base
        + fine[Math.floor(radius * 2)] * 13
        + band * 7
        + sweep * (17 + band * 5)
        + (random() * 2 - 1) * 4;
      steel(data, (y * size + x) * 4, value);
    }
  }
  return data;
};

// The wall's plate: `size` pixels square, RGBA, brushed straight across, and
// made to repeat without a seam (every row is one line of the brush from edge
// to edge, and the rows wrap).
export const brushedPlate = (size, { seed = 1927, base = 37 } = {}) => {
  const random = seeded(seed);
  const data = new Uint8ClampedArray(size * size * 4);
  const fine = lines(size, random, { smooth: 1, wrap: true });
  const broad = lines(size, random, { smooth: 6, wrap: true });
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = base + fine[y] * 5 + broad[y] * 9 + (random() * 2 - 1) * 2.5;
      steel(data, (y * size + x) * 4, value);
    }
  }
  return data;
};

// Wear: a few hairline scratches across the brushing, light and dark.
const scratch = (context, size, random, count) => {
  for (let i = 0; i < count; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const angle = random() * Math.PI;
    const length = size * (0.04 + random() * 0.16);
    context.strokeStyle = random() < 0.6 ? `rgba(225, 232, 242, ${0.05 + random() * 0.09})` : `rgba(0, 0, 0, ${0.1 + random() * 0.14})`;
    context.lineWidth = 0.6 + random() * 0.7;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    context.stroke();
  }
};

// The picture as a short address of its own, where the page can make one: it
// is shown in several places, and a long data address would be written out
// (and decoded) in each. Kept for as long as the page lives; there are two.
const address = (dataUrl) => {
  try {
    const bytes = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
    const buffer = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) buffer[i] = bytes.charCodeAt(i);
    return URL.createObjectURL(new Blob([buffer], { type: "image/jpeg" }));
  } catch {
    return dataUrl;
  }
};

const picture = (doc, size, pixels, scratches, seed) => {
  const canvas = doc.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const image = context.createImageData(size, size);
  image.data.set(pixels);
  context.putImageData(image, 0, 0);
  scratch(context, size, seeded(seed), scratches);
  return address(canvas.toDataURL("image/jpeg", 0.86));
};

export const DISC_SIZE = 768;
export const PLATE_SIZE = 256;

// The two pictures, as addresses an <image> or a background can show. Made
// once for the page. Where there is no canvas (a test, a browser that will
// not give one) both are null, and the door is drawn in its flat colours.
let made = null;
export const vaultMetal = (doc = typeof document === "undefined" ? null : document) => {
  if (made) return made;
  let disc = null;
  let plate = null;
  try {
    if (doc) {
      disc = picture(doc, DISC_SIZE, brushedDisc(DISC_SIZE), 26, 7);
      plate = picture(doc, PLATE_SIZE, brushedPlate(PLATE_SIZE), 5, 11);
    }
  } catch {
    disc = null;
    plate = null;
  }
  made = Object.freeze({ disc, plate });
  return made;
};
