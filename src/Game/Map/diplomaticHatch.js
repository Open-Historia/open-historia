/*! Open Historia — the diplomatic map's hatching © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The hatching the diplomatic map lays over land (runtime/diplomaticViews.js
// hatchOf): thin lines on a clear ground, so the country's colour shows
// between them. A pattern's image id spells its look ("oh-hatch-diag-246_241_227"),
// so the missing-image resolver can draw any of them again when the style asks,
// as the disputed stripes do (Nations.jsx), the globe toggle and a lost WebGL
// context included.

import { HATCH_COLORS, hexToRgb } from "../../runtime/diplomaticPalette.js";

export const HATCH_PREFIX = "oh-hatch-";
const HATCH_SIZE = 12;
const HATCH_LINE = 2;
const STYLES = new Set(["diag", "back", "cross"]);

// Which way each marking runs.
export const HATCH_STYLE = Object.freeze({
  ceasefire: "diag",
  puppet: "back",
  occupied: "cross",
  candidate: "diag",
  suspended: "back",
});

export const hatchImageId = (kind) => {
  const rgb = hexToRgb(HATCH_COLORS[kind]);
  const style = HATCH_STYLE[kind];
  return rgb && style ? `${HATCH_PREFIX}${style}-${rgb.join("_")}` : null;
};

export const parseHatchImageId = (id) => {
  if (typeof id !== "string" || !id.startsWith(HATCH_PREFIX)) return null;
  const [style, rgbText] = id.slice(HATCH_PREFIX.length).split("-");
  const rgb = String(rgbText ?? "").split("_").map(Number);
  if (!STYLES.has(style) || rgb.length !== 3 || !rgb.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return null;
  return { style, rgb };
};

// Lines at 45 degrees that tile seamlessly: a pixel is on a line when (x + y),
// or (x - y) the other way, falls in the first HATCH_LINE of each period.
export const buildHatchImage = ({ style, rgb }) => {
  const size = HATCH_SIZE;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const forward = ((x + y) % size) < HATCH_LINE;
      const backward = ((((x - y) % size) + size) % size) < HATCH_LINE;
      const on = style === "diag" ? forward : style === "back" ? backward : forward || backward;
      const at = (y * size + x) * 4;
      data[at] = rgb[0];
      data[at + 1] = rgb[1];
      data[at + 2] = rgb[2];
      data[at + 3] = on ? 220 : 0;
    }
  }
  return { width: size, height: size, data };
};

// The hatch layer's fill-pattern: each marking's image by the area's name
// (vnext/groupAreas.js names an area's features `group`).
export const hatchPatternExpression = () => {
  const kinds = Object.keys(HATCH_STYLE);
  return ["match", ["get", "group"], ...kinds.flatMap((kind) => [kind, hatchImageId(kind)]), hatchImageId("ceasefire")];
};
