/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// A basemap picture redrawn in another projection, so it goes with its map
// when the Workshop converts one world projection to another
// (MapEditor convertProjection). The regions, cities and units are moved by
// arithmetic; a picture has to be drawn again: for every pixel of the new
// sheet, the spot of the old sheet that shows the same place on the globe is
// looked up and its colour taken (between four pixels, so nothing turns
// blocky). A spot of the new sheet that is not on the globe, the corners of a
// Robinson or Mollweide map, is left empty.
//
// Freeform needs none of this: there the picture is only laid on other bounds.

import { boundsOnPlane, convertPlane, planeOnMap, sheetAspect, sheetBounds, sheetHalf } from "../../server/mapProjection.js";

// The widest a redrawn picture may be. A picture is kept at its own width up
// to this; the work is one lookup per pixel.
export const MAX_REDRAWN_WIDTH = 4096;

// The size the new picture is drawn at: as wide as the old one (within the
// cap), and as tall as the new sheet's shape makes it.
export const redrawnSize = (sourceWidth, to) => {
  const width = Math.max(64, Math.min(MAX_REDRAWN_WIDTH, Math.round(Number(sourceWidth) || 0)));
  return { width, height: Math.max(32, Math.round(width / sheetAspect(to))) };
};

// The pixels, without a canvas: `source` is { width, height, data } as
// getImageData gives it, laid on `bounds` of a map in projection `from`.
// Answers the same shape for the sheet of `to`. Kept apart from the canvas so
// it can be tested.
export const reprojectPixels = (source, { from, to, bounds = null, width, height }) => {
  const out = new Uint8ClampedArray(width * height * 4);
  const { hx, hy } = sheetHalf(to);
  const box = boundsOnPlane(bounds ?? sheetBounds(from));
  const spanX = box.east - box.west;
  const spanY = box.north - box.south;
  const { width: sw, height: sh, data } = source;
  for (let row = 0; row < height; row += 1) {
    const Y = hy - ((row + 0.5) / height) * 2 * hy;
    for (let column = 0; column < width; column += 1) {
      const X = ((column + 0.5) / width) * 2 * hx - hx;
      if (!planeOnMap(to, X, Y)) continue;
      const [oldX, oldY] = convertPlane(to, from, X, Y);
      // Where that spot is in the old picture, in pixels.
      const px = ((oldX - box.west) / spanX) * sw - 0.5;
      const py = ((box.north - oldY) / spanY) * sh - 0.5;
      if (px < -0.5 || py < -0.5 || px > sw - 0.5 || py > sh - 0.5) continue;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(px)));
      const y0 = Math.max(0, Math.min(sh - 1, Math.floor(py)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, px - x0));
      const fy = Math.max(0, Math.min(1, py - y0));
      const a = (y0 * sw + x0) * 4;
      const b = (y0 * sw + x1) * 4;
      const c = (y1 * sw + x0) * 4;
      const d = (y1 * sw + x1) * 4;
      const at = (row * width + column) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = data[a + channel] + (data[b + channel] - data[a + channel]) * fx;
        const bottom = data[c + channel] + (data[d + channel] - data[c + channel]) * fx;
        out[at + channel] = top + (bottom - top) * fy;
      }
    }
  }
  return { width, height, data: out };
};

const loadImage = (dataUrl) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error("The basemap picture could not be read."));
  image.src = dataUrl;
});

// The picture redrawn: { dataUrl, aspect, bounds } for the sheet of `to`. A
// JPEG stays a JPEG (its empty corners black, as a JPEG has no transparency);
// anything else is written as PNG, which keeps them clear.
export const reprojectPicture = async ({ dataUrl, from, to, bounds = null }) => {
  const image = await loadImage(dataUrl);
  const sw = image.naturalWidth || image.width;
  const sh = image.naturalHeight || image.height;
  if (!sw || !sh) throw new Error("The basemap picture has no size.");
  const read = document.createElement("canvas");
  read.width = sw;
  read.height = sh;
  const readContext = read.getContext("2d", { willReadFrequently: true });
  readContext.drawImage(image, 0, 0);
  const source = readContext.getImageData(0, 0, sw, sh);
  const { width, height } = redrawnSize(sw, to);
  const pixels = reprojectPixels(source, { from, to, bounds, width, height });
  const write = document.createElement("canvas");
  write.width = width;
  write.height = height;
  const writeContext = write.getContext("2d");
  const jpeg = /^data:image\/jpe?g/i.test(dataUrl);
  if (jpeg) {
    writeContext.fillStyle = "#000";
    writeContext.fillRect(0, 0, width, height);
    // Drawn over the black through a second canvas, so empty pixels stay black.
    const layer = document.createElement("canvas");
    layer.width = width;
    layer.height = height;
    layer.getContext("2d").putImageData(new ImageData(pixels.data, width, height), 0, 0);
    writeContext.drawImage(layer, 0, 0);
  } else {
    writeContext.putImageData(new ImageData(pixels.data, width, height), 0, 0);
  }
  return {
    dataUrl: jpeg ? write.toDataURL("image/jpeg", 0.92) : write.toDataURL("image/png"),
    aspect: width / height,
    bounds: sheetBounds(to),
  };
};
