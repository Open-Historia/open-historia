/*! Open Historia — the map's weather and ice, drawn as tiles © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The small pictures the map repeats over an area to say what is there
// (fill-pattern): the cracks in ice and each kind of weather. Each is drawn here pixel by
// pixel in flat colours, with no fade anywhere, and wraps at its edges, so the
// tiles meet without a seam.
//
// THE WEATHER is a speckle, as frost is ("I like how frost looks, the other
// effects look bad", then "make the frost better tho. make it less
// repetitive. make it procedural": the owner, 2026-10-14). Each weather is
// three tiles of prime sizes laid one over another (WEATHER_LAYERS), so that
// what they make together repeats only every few million pixels and no repeat
// can be seen; on each the marks gather and thin out by a smooth noise that
// wraps with the tile, so the speckle lies in drifts and clear patches as frost
// does on a pane. Each weather has its own marks: frost a fine icy speckle,
// snow soft flakes, a blizzard many more, rain fine slanting drops, a storm
// more and darker, fog a fine grey haze, mud brown clots, heat a few warm
// motes. None of it moves.
//
// ICE is a light tint the basemap shows through (ICE_TINT, IceLayers.jsx) with
// cracks over it ("also make the crack visuals in frozen water procedural.
// also, the frozen water doesnt show the basemap behind it, it should"): the
// cracks are wandering, branching lines on clear tiles of two prime sizes laid
// one over the other (ICE_LAYERS), so they do not repeat to the eye either.
//
// The map draws at one pixel to a pixel (World.jsx pixelRatio), so these are
// added at a pixel ratio of 1: a line a pixel wide stays one.
//
// Pure: { width, height, data } a picture, as map.addImage takes it.

// The three tiles of a weather, and the two of the ice's cracks, each a prime number of pixels across.
export const WEATHER_LAYERS = Object.freeze([97, 131, 173]);
export const ICE_LAYERS = Object.freeze([181, 241]);

// The ice's colour, laid thin under its cracks so the map shows through it.
export const ICE_TINT = "#dcecf8";
// A tile on the map: the first "oh-weather-frost", the others "-b" and "-c" after it.
const layerSuffix = (layer) => (layer > 0 ? `-${"abc"[layer]}` : "");
export const weatherImageId = (state, layer = 0) => `oh-weather-${state}${layerSuffix(layer)}`;
export const iceImageId = (layer = 0) => `oh-ice${layerSuffix(layer)}`;
export const ICE_IMAGE = iceImageId(0);
export const WEATHER_DRAWN = Object.freeze(["rain", "storm", "snow", "blizzard", "fog", "mud", "heat", "frost"]);

const picture = (width, height = width) => ({ width, height, data: new Uint8Array(width * height * 4) });
const wrap = (value, size) => ((value % size) + size) % size;

// One pixel set to a colour, wherever it falls: off one edge is on the other.
const plot = (image, x, y, colour) => {
  const at = (wrap(Math.round(y), image.height) * image.width + wrap(Math.round(x), image.width)) * 4;
  image.data[at] = colour[0];
  image.data[at + 1] = colour[1];
  image.data[at + 2] = colour[2];
  image.data[at + 3] = colour[3];
};

// A line a pixel wide (Bresenham's), wrapping as plot does.
const line = (image, fromX, fromY, toX, toY, colour) => {
  let x = Math.round(fromX);
  let y = Math.round(fromY);
  const endX = Math.round(toX);
  const endY = Math.round(toY);
  const dx = Math.abs(endX - x);
  const dy = -Math.abs(endY - y);
  const stepX = x < endX ? 1 : -1;
  const stepY = y < endY ? 1 : -1;
  let error = dx + dy;
  for (let guard = 0; guard < 4096; guard += 1) {
    plot(image, x, y, colour);
    if (x === endX && y === endY) break;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += stepX;
    }
    if (twice <= dx) {
      error += dx;
      y += stepY;
    }
  }
};

// A filled ellipse round (x, y), wrapping.
const blot = (image, x, y, radiusX, radiusY, colour) => {
  for (let dy = -Math.ceil(radiusY); dy <= Math.ceil(radiusY); dy += 1) {
    for (let dx = -Math.ceil(radiusX); dx <= Math.ceil(radiusX); dx += 1) {
      if ((dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY) <= 1) plot(image, x + dx, y + dy, colour);
    }
  }
};

// The same marks every time: a small seeded generator (mulberry32), so a
// picture is the same on every map and in every test.
const marks = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

// A number for a name, to seed its marks by (FNV-1a).
const seedOf = (text) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

// A smooth noise from 0 to 1 that wraps with its tile: `cells` values across
// and down, eased from one to the next.
const noiseOf = (seed, size, cells) => {
  const next = marks(seed);
  const lattice = Float32Array.from({ length: cells * cells }, () => next());
  const ease = (t) => t * t * (3 - 2 * t);
  const at = (i, j) => lattice[wrap(j, cells) * cells + wrap(i, cells)];
  return (x, y) => {
    const u = (x / size) * cells;
    const v = (y / size) * cells;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fx = ease(u - i);
    const fy = ease(v - j);
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return top + (bottom - top) * fy;
  };
};

// ---- the weather -----------------------------------------------------------------------

// What each weather's speckle is: its colour and how opaque, how many marks a
// thousand pixels its three tiles bring together, how strongly the noise
// gathers them into drifts (0 evenly, 1 into drifts with bare ground between),
// and the mark each one is.
export const SPECKLES = Object.freeze({
  frost: Object.freeze({ colour: [226, 240, 255], alpha: 235, per: 11, gather: 0.8, mark: "frost" }),
  snow: Object.freeze({ colour: [248, 251, 255], alpha: 240, per: 6, gather: 0.7, mark: "flake" }),
  blizzard: Object.freeze({ colour: [242, 246, 252], alpha: 245, per: 17, gather: 0.45, mark: "flake" }),
  rain: Object.freeze({ colour: [176, 202, 232], alpha: 215, per: 7, gather: 0.7, mark: "drop" }),
  storm: Object.freeze({ colour: [128, 152, 188], alpha: 235, per: 15, gather: 0.55, mark: "drop" }),
  fog: Object.freeze({ colour: [214, 219, 226], alpha: 150, per: 30, gather: 1, mark: "haze" }),
  mud: Object.freeze({ colour: [112, 80, 46], alpha: 215, per: 6, gather: 1, mark: "clot" }),
  heat: Object.freeze({ colour: [255, 214, 146], alpha: 190, per: 3, gather: 0.6, mark: "mote" }),
});

// One mark at (x, y), in a colour already varied.
const MARKS = {
  // A grain of ice, now and then with two more under it, as frost forms.
  frost: (image, x, y, colour, next) => {
    plot(image, x, y, colour);
    if (next() < 0.25) {
      plot(image, x + 1, y + 1, colour);
      plot(image, x - 1, y + 1, colour);
    }
  },
  // A flake: a dot, or a dot with four arms.
  flake: (image, x, y, colour, next) => {
    plot(image, x, y, colour);
    if (next() < 0.55) {
      plot(image, x - 1, y, colour);
      plot(image, x + 1, y, colour);
      plot(image, x, y - 1, colour);
      plot(image, x, y + 1, colour);
    }
  },
  // A drop, three pixels falling aslant down and to the left.
  drop: (image, x, y, colour) => line(image, x, y, x - 1, y + 2, colour),
  // A grain of haze, fainter or less faint.
  haze: (image, x, y, colour, next) => plot(image, x, y, [colour[0], colour[1], colour[2], Math.round(colour[3] * (0.55 + 0.45 * next()))]),
  // A clot of mud, a pixel or two across.
  clot: (image, x, y, colour, next) => blot(image, x, y, 1 + next(), 0.8 + next() * 0.8, colour),
  // A warm mote, a pixel or two along.
  mote: (image, x, y, colour, next) => {
    plot(image, x, y, colour);
    if (next() < 0.5) plot(image, x + 1, y, colour);
  },
};

// One of a weather's three tiles (layer 0, 1 or 2), or null for weather that
// draws nothing (clear) or that is not weather. The same every time.
export const weatherPattern = (state, layer = 0) => {
  const recipe = Object.hasOwn(SPECKLES, state) ? SPECKLES[state] : null;
  const size = WEATHER_LAYERS[layer];
  if (!recipe || !size) return null;
  const image = picture(size);
  const next = marks(seedOf(`${state}|${layer}`));
  // Two noises, broad drifts and smaller ones, that wrap with the tile.
  const broad = noiseOf(seedOf(`${state}|${layer}|broad`), size, 3 + layer);
  const fine = noiseOf(seedOf(`${state}|${layer}|fine`), size, 7 + 2 * layer);
  const chance = recipe.per / 1000 / WEATHER_LAYERS.length;
  const mark = MARKS[recipe.mark];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const lay = 0.65 * broad(x, y) + 0.35 * fine(x, y);
      const weight = Math.max(0, 1 + recipe.gather * (2 * lay - 1) * 1.4);
      if (next() >= chance * weight) continue;
      // Each mark a little brighter or darker, a little more or less opaque.
      const light = 0.88 + next() * 0.18;
      const colour = [
        Math.min(255, Math.round(recipe.colour[0] * light)),
        Math.min(255, Math.round(recipe.colour[1] * light)),
        Math.min(255, Math.round(recipe.colour[2] * light)),
        Math.round(recipe.alpha * (0.75 + next() * 0.25)),
      ];
      mark(image, x, y, colour, next);
    }
  }
  return image;
};

// ---- the ice ---------------------------------------------------------------------------

const CRACK = [92, 132, 172, 235];
const HAIRLINE = [146, 182, 214, 190];
const GLINT = [248, 252, 255, 225];

// One wandering crack from (x, y): legs of a few pixels, each turned a little
// from the last, a hairline branching off now and then, and those branching again.
const crack = (image, next, x, y, heading, legs, colour, depth) => {
  let atX = x;
  let atY = y;
  let way = heading;
  for (let leg = 0; leg < legs; leg += 1) {
    const length = 5 + next() * 14;
    way += (next() - 0.5) * 1.1;
    const toX = atX + Math.cos(way) * length;
    const toY = atY + Math.sin(way) * length;
    line(image, atX, atY, toX, toY, colour);
    if (depth < 2 && next() < 0.4) {
      const side = way + (next() < 0.5 ? -1 : 1) * (0.5 + next() * 0.8);
      crack(image, next, toX, toY, side, 1 + Math.floor(next() * 3), HAIRLINE, depth + 1);
    }
    atX = toX;
    atY = toY;
  }
};

// One of the ice's two tiles of cracks (layer 0 or 1), clear between them, so
// the tint and the map under it show. The same every time.
export const icePattern = (layer = 0) => {
  const size = ICE_LAYERS[layer];
  if (!size) return null;
  const image = picture(size);
  const next = marks(seedOf(`ice|${layer}`));
  const where = noiseOf(seedOf(`ice|${layer}|where`), size, 3);
  // The cracks start where the noise says the ice is under most strain, so they gather.
  const cracks = Math.round((size * size) / 7000);
  for (let made = 0, tries = 0; made < cracks && tries < cracks * 40; tries += 1) {
    const x = next() * size;
    const y = next() * size;
    if (next() > where(x, y) * 1.4) continue;
    crack(image, next, x, y, next() * 2 * Math.PI, 4 + Math.floor(next() * 6), CRACK, 0);
    made += 1;
  }
  const glints = Math.round((size * size) / 2500);
  for (let glint = 0; glint < glints; glint += 1) {
    const x = next() * size;
    const y = next() * size;
    line(image, x, y, x + 1 + Math.floor(next() * 3), y, GLINT);
  }
  return image;
};
