/*! Open Historia — the season's tint as map tiles © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The season's picture (seasonTint.js) given to the map as ordinary raster
// tiles, cut from it as the map asks for them, instead of one picture laid
// over the whole world. "antartica has this strange bug where there are
// triangles cut out of the climate zones" (the owner, 2026-11-03): with 3D
// terrain on, MapLibre draws a world-sized picture again inside each terrain
// tile, and near the picture's far edge (85° S, Antarctica) the corners it
// works out for it overflow, so half of a tile's square was left undrawn.
// Tiles are draped on the terrain like the basemap's.
//
// One picture at a time: SeasonLayers.jsx hands each one in as it is drawn,
// with a new number, and names that number in its tiles' address
// (ohtint://<number>/{z}/{x}/{y}), so a new picture is new tiles.

import { MERCATOR_TOP_LAT } from "./seasonTint.js";

export const SEASON_TINT_PROTOCOL = "ohtint";
export const SEASON_TINT_TILE_SIZE = 256;

const RAD = Math.PI / 180;
// The same Mercator measure seasonTint.js lays its rows by: 180 at the Mercator map's edge.
const planeY = (lat) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-89.99, Math.min(89.99, Number(lat) || 0)) * RAD) / 2)) / RAD;

// The part of a picture `width` × `height` reaching to `topLat` (north and
// south) that the map's tile z/x/y covers, in its pixels.
export const tintTileRect = ({ z, x, y, width, height, topLat = MERCATOR_TOP_LAT }) => {
  const tiles = 2 ** z;
  const top = planeY(topLat);
  const rowOf = (row) => ((top - 180 * (1 - (2 * row) / tiles)) / (2 * top)) * height;
  const sx = (x / tiles) * width;
  const sy = rowOf(y);
  return { sx, sy, sw: width / tiles, sh: rowOf(y + 1) - sy };
};

let picture = null;

// The picture the tiles are now cut from: { canvas, topLat }. Returns its number.
export const setSeasonTintPicture = (canvas, topLat = MERCATOR_TOP_LAT) => {
  picture = { canvas, topLat, number: (picture?.number ?? 0) + 1 };
  return picture.number;
};

// MapLibre's "ohtint" protocol (registered by mapLibreSetup.js).
export const seasonTintTileLoader = async (params) => {
  const match = /^ohtint:\/\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(String(params?.url ?? ""));
  if (!match) throw new Error(`Bad season tint tile URL: ${params?.url}`);
  const [z, x, y] = [Number(match[2]), Number(match[3]), Number(match[4])];
  const size = SEASON_TINT_TILE_SIZE;
  const tile = typeof OffscreenCanvas === "function"
    ? new OffscreenCanvas(size, size)
    : Object.assign(document.createElement("canvas"), { width: size, height: size });
  const context = tile.getContext("2d");
  if (picture?.canvas && context) {
    const { sx, sy, sw, sh } = tintTileRect({ z, x, y, width: picture.canvas.width, height: picture.canvas.height, topLat: picture.topLat });
    context.imageSmoothingEnabled = true;
    context.drawImage(picture.canvas, sx, sy, sw, sh, 0, 0, size, size);
  }
  const blob = tile.convertToBlob
    ? await tile.convertToBlob({ type: "image/png" })
    : await new Promise((resolve) => tile.toBlob(resolve, "image/png"));
  return { data: await blob.arrayBuffer() };
};
