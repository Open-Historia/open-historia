/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Reads the background under a stretch of the map, as RGBA pixels on an extent,
// for Fit to background (fitToImage.js buildLandField). Two kinds of background have pixels to read:
//   { kind: "image", url, extent }      a picture laid on an extent of EPSG:3857
//                                       (the map's own picture, the reference image)
//   { kind: "tiles", template, maxZoom } a basemap of XYZ tiles ({z}, {x}, {y})
// A drawn (vector) basemap has none and is not offered. What goes wrong is
// thrown as an Error with a `code` the inspector words: "unreadable" (it did not
// load), "closed" (its server keeps its colours from the page), "outside" (the
// regions are not over it).

import { MAX_REACH } from "./fitToImage.js";

const HALF_WORLD = 20037508.342789244;
// The most pixels a stretch is read at; a bigger stretch is read coarser.
const MAX_PIXELS = 2_500_000;
const MAX_TILES = 64;

const failure = (code) => Object.assign(new Error(code), { code });

const loadImage = (url) => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => resolve(image);
  image.onerror = () => reject(failure("unreadable"));
  image.src = url;
});

const pixelsOf = (canvas) => {
  try {
    return canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    throw failure("closed");
  }
};

// The box around `extent` that a fit reads, at `resolution` map units to the
// pixel: room for the farthest reach, and beyond it the land and sea away from
// the borders that the fit learns their colours from (buildLandField).
const grow = (extent, resolution) => {
  const margin = 3 * MAX_REACH * resolution;
  return [extent[0] - margin, extent[1] - margin, extent[2] + margin, extent[3] + margin];
};

const readImage = async ({ url, extent: imageExtent }, extent) => {
  const image = await loadImage(url);
  const [minX, minY, maxX, maxY] = imageExtent;
  const native = (maxX - minX) / image.naturalWidth;
  const nativeY = (maxY - minY) / image.naturalHeight;
  let box = grow(extent, native);
  const fit = Math.sqrt(((box[2] - box[0]) / native) * ((box[3] - box[1]) / nativeY) / MAX_PIXELS);
  const coarse = Math.max(1, fit);
  box = grow(extent, native * coarse);
  box = [Math.max(box[0], minX), Math.max(box[1], minY), Math.min(box[2], maxX), Math.min(box[3], maxY)];
  if (!(box[2] > box[0] && box[3] > box[1])) throw failure("outside");
  const sx = (box[0] - minX) / native;
  const sy = (maxY - box[3]) / nativeY;
  const sw = (box[2] - box[0]) / native;
  const sh = (box[3] - box[1]) / nativeY;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(3, Math.round(sw / coarse));
  canvas.height = Math.max(3, Math.round(sh / coarse));
  canvas.getContext("2d").drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return { rgba: pixelsOf(canvas), width: canvas.width, height: canvas.height, extent: box };
};

const readTiles = async ({ template, maxZoom = 19 }, extent) => {
  const tileSpan = (z) => (2 * HALF_WORLD) / 2 ** z;
  let z = Math.min(maxZoom, 22);
  const range = (zoom) => {
    const span = tileSpan(zoom);
    const box = grow(extent, span / 256);
    const clamp = (v) => Math.max(0, Math.min(2 ** zoom - 1, v));
    return {
      x0: clamp(Math.floor((box[0] + HALF_WORLD) / span)),
      x1: clamp(Math.floor((box[2] + HALF_WORLD) / span)),
      y0: clamp(Math.floor((HALF_WORLD - box[3]) / span)),
      y1: clamp(Math.floor((HALF_WORLD - box[1]) / span)),
    };
  };
  let r = range(z);
  while (z > 0 && ((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > MAX_TILES || (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) * 65536 > MAX_PIXELS)) {
    z -= 1;
    r = range(z);
  }
  const columns = r.x1 - r.x0 + 1;
  const rows = r.y1 - r.y0 + 1;
  const canvas = document.createElement("canvas");
  canvas.width = columns * 256;
  canvas.height = rows * 256;
  const context = canvas.getContext("2d");
  const jobs = [];
  for (let x = r.x0; x <= r.x1; x += 1) {
    for (let y = r.y0; y <= r.y1; y += 1) {
      const url = template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
      jobs.push(loadImage(url).then((image) => context.drawImage(image, (x - r.x0) * 256, (y - r.y0) * 256, 256, 256), () => null));
    }
  }
  await Promise.all(jobs);
  const span = tileSpan(z);
  const box = [r.x0 * span - HALF_WORLD, HALF_WORLD - (r.y1 + 1) * span, (r.x1 + 1) * span - HALF_WORLD, HALF_WORLD - r.y0 * span];
  return { rgba: pixelsOf(canvas), width: canvas.width, height: canvas.height, extent: box };
};

// The pixels of `background` around `extent` (EPSG:3857): { rgba, width, height,
// extent }, the extent the pixels cover, with room for the farthest reach.
export const readBackgroundPixels = (background, extent) => (background.kind === "tiles" ? readTiles(background, extent) : readImage(background, extent));
