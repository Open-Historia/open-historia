
/*! Open Historia — the bare map put back under a battlefield, laid on the 3D terrain © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// With 3D terrain on, MapLibre lays its own fills, lines and pictures over the
// hills by drawing them into the terrain's own tiles. A layer that draws itself
// (a "custom" layer) is drawn on the screen instead, where its corners are put,
// and a corner put at height 0 is at the sea's level, under the hills: with
// the map tilted it lies flat, apart from the country round it ("the war
// terrain is not 3d", the owner, 2026-11-09).
//
// The battlefield's ground (frontGroundLayer.js) draws into the terrain's
// tiles as the fills do. The bare map put back under the paint where it cannot
// (frontBasemapLayer.js `put`) is drawn on the screen, since it is made from a
// copy of the screen; it is given the ground's height here:
//
//   - the heights are read from the terrain on a grid over the picture (no
//     finer than the terrain's own heights, at most DRAPE_MAX_STEPS a side),
//     again only when the terrain has more of its heights to give;
//   - the picture's mesh is as fine as the grid, each corner lifted by the
//     height there.
//
// MapLibre takes a height in metres on the globe and on the flat map's own
// scale (the sheet being 1 wide) on the flat map, worked out at the middle of
// the view as the terrain itself is (its camera's pixelsPerMeter):
// liftToMetres makes the flat map's matrix take metres too.
//
// Nothing here is done while the terrain is off: the layer draws as it did.
// The pure parts load in plain Node.

export const EARTH_RADIUS_M = 6371008.8;
// The most cells the grid has a side: the heights are read again when the
// terrain loads more of them, a few times at most, so the reading is kept short.
export const DRAPE_MAX_STEPS = 64;
// Read again no more often than this, while the terrain's heights come in.
export const HEIGHTS_THROTTLE_MS = 400;

const TWO_PI = Math.PI * 2;

export const lngOfX = (x) => x * 360 - 180;
export const latOfY = (y) => (360 / Math.PI) * Math.atan(Math.exp((1 - 2 * y) * Math.PI)) - 90;

// How long a metre is on the flat map's sheet at a latitude.
export const sheetPerMetre = (lat) => 1 / (TWO_PI * EARTH_RADIUS_M * Math.max(1e-6, Math.cos((Number(lat) || 0) * Math.PI / 180)));

// A matrix that takes a height on the sheet's scale, made to take metres: its
// third column scaled. In place.
export const liftMatrixZ = (matrix, perMetre) => {
  for (let index = 8; index < 12; index += 1) matrix[index] *= perMetre;
  return matrix;
};

// The two matrices a custom layer projects with (its main one and the one the
// globe turns from), made in place to take heights in metres. The globe's own
// takes metres already (MapLibre's GLOBE_RADIUS); the flat map's does not.
// `variantName` is the projection MapLibre is drawing ("globe" or "mercator").
export const liftToMetres = (main, fallback, variantName, lat) => {
  const perMetre = sheetPerMetre(lat);
  if (variantName !== "globe") liftMatrixZ(main, perMetre);
  liftMatrixZ(fallback, perMetre);
};

// What the map's 3D terrain gives, or null when it is off:
//   key     changes when the heights would (another source, exaggeration)
//   cell    one of its finest heights' width on the sheet
//   sample  (lng, lat) -> metres above the sea, exaggerated as drawn
export const terrainOf = (map) => {
  let spec = null;
  try {
    spec = map?.getTerrain?.() ?? null;
  } catch {
    return null;
  }
  const terrain = map?.terrain;
  if (!spec || typeof terrain?.getElevationForLngLatZoom !== "function") return null;
  // (The terrain is asked with the map's own LngLat: it wraps it and reads its tile.)
  const LngLat = map.getCenter?.()?.constructor;
  if (typeof LngLat !== "function") return null;
  let source = null;
  try {
    source = map.getSource?.(spec.source) ?? null;
  } catch { /* no source to read: the defaults */ }
  const maxzoom = Number.isFinite(source?.maxzoom) ? source.maxzoom : 14;
  const tileSize = Number(source?.tileSize) > 0 ? Number(source.tileSize) : 512;
  // Its finest tiles: the terrain asks for a zoom this much over its source's.
  const deltaZoom = Number.isFinite(terrain.tileManager?.deltaZoom) ? terrain.tileManager.deltaZoom : 0;
  const zoom = Math.max(0, Math.min(22, Math.round(maxzoom + deltaZoom)));
  const exaggeration = Number.isFinite(terrain.exaggeration) ? terrain.exaggeration : Number(spec.exaggeration ?? 1);
  return {
    key: `${spec.source}|${exaggeration}`,
    cell: 1 / (2 ** maxzoom * tileSize),
    sample: (lng, lat) => terrain.getElevationForLngLatZoom(new LngLat(lng, lat), zoom),
  };
};

// The box round a mesh's corners on the sheet: [left, top, right, bottom].
export const meshBounds = (positions, stride = 2) => {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let at = 0; at + 1 < (positions?.length ?? 0); at += stride) {
    const x = positions[at];
    const y = positions[at + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  return left <= right && top <= bottom ? [left, top, right, bottom] : null;
};

// The grid the heights are read on, over a box on the sheet: its cells about
// square, none narrower than `minCell`, at most `max` a side.
export const drapeGrid = (bounds, { max = DRAPE_MAX_STEPS, minCell = 0 } = {}) => {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return null;
  const [left, top, right, bottom] = bounds;
  const width = right - left;
  const height = bottom - top;
  if (!(width > 0) || !(height > 0)) return null;
  const cell = Math.max(Math.max(width, height) / max, Number(minCell) || 0);
  const nx = Math.max(1, Math.min(max, Math.ceil(width / cell - 1e-9)));
  const ny = Math.max(1, Math.min(max, Math.ceil(height / cell - 1e-9)));
  return Object.freeze({ left, top, right, bottom, nx, ny });
};

export const gridX = (grid, column) => grid.left + ((grid.right - grid.left) * column) / grid.nx;
export const gridY = (grid, row) => grid.top + ((grid.bottom - grid.top) * row) / grid.ny;

// The height at each of the grid's corners, row by row from the top.
export const gridHeights = (grid, sample) => {
  const columns = grid.nx + 1;
  const out = new Float32Array(columns * (grid.ny + 1));
  for (let row = 0; row <= grid.ny; row += 1) {
    const lat = latOfY(gridY(grid, row));
    for (let column = 0; column < columns; column += 1) {
      let height = 0;
      try {
        height = Number(sample(lngOfX(gridX(grid, column)), lat));
      } catch { /* not there to read: the sea's level */ }
      out[row * columns + column] = Number.isFinite(height) ? height : 0;
    }
  }
  return out;
};

// The height at a point on the sheet, read between the grid's corners.
export const heightAt = (grid, heights, x, y) => {
  const fx = ((x - grid.left) / (grid.right - grid.left)) * grid.nx;
  const fy = ((y - grid.top) / (grid.bottom - grid.top)) * grid.ny;
  const column = Math.max(0, Math.min(grid.nx - 1, Math.floor(fx)));
  const row = Math.max(0, Math.min(grid.ny - 1, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - column));
  const ty = Math.max(0, Math.min(1, fy - row));
  const columns = grid.nx + 1;
  const at = row * columns + column;
  const top = heights[at] * (1 - tx) + heights[at + 1] * tx;
  const below = heights[at + columns] * (1 - tx) + heights[at + columns + 1] * tx;
  return top * (1 - ty) + below * ty;
};

// Each corner's height, from corners `stride` numbers apart (x and y first).
export const vertexHeights = (positions, grid, heights, stride = 2) => {
  const count = Math.floor((positions?.length ?? 0) / stride);
  const out = new Float32Array(count);
  for (let corner = 0; corner < count; corner += 1) {
    out[corner] = heightAt(grid, heights, positions[corner * stride], positions[corner * stride + 1]);
  }
  return out;
};

// The heights a layer draws with, kept for each thing it draws (`key`) and
// read again only when the terrain has more to give, and then no more often
// than `throttleMs`: heights(key, bounds) is { grid, heights, version } while
// the terrain is on, null while it is off. `version` changes whenever the
// heights do. `keep(keys)` lets go of the others.
export const createTerrainHeights = (map, { throttleMs = HEIGHTS_THROTTLE_MS, now = () => Date.now(), read = terrainOf, maxSteps = DRAPE_MAX_STEPS } = {}) => {
  let revision = 0;
  let timer = null;
  let versions = 0;
  const cache = new Map();
  // More of the terrain's heights have come, or the terrain is another.
  const onChange = (event) => {
    if (event?.type === "terrain") {
      revision += 1;
      return;
    }
    if (!event?.tile || !event.sourceId) return;
    let source = null;
    try {
      source = map?.getTerrain?.()?.source ?? null;
    } catch { /* no terrain */ }
    if (source && event.sourceId === source) revision += 1;
  };
  map?.on?.("terrain", onChange);
  map?.on?.("sourcedata", onChange);
  const later = (wait) => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      map?.triggerRepaint?.();
    }, Math.max(0, wait));
  };
  return {
    terrain: () => read(map),
    heights(key, bounds, terrain = read(map)) {
      if (!terrain) return null;
      const boundsKey = `${terrain.key}|${bounds?.join?.(",")}`;
      let entry = cache.get(key);
      const time = now();
      if (!entry || entry.boundsKey !== boundsKey) {
        const grid = drapeGrid(bounds, { max: maxSteps, minCell: terrain.cell });
        if (!grid) return null;
        entry = { boundsKey, grid, heights: gridHeights(grid, terrain.sample), revision, at: time, version: (versions += 1) };
        cache.set(key, entry);
        return entry;
      }
      if (entry.revision !== revision) {
        if (time - entry.at >= throttleMs) {
          entry.heights = gridHeights(entry.grid, terrain.sample);
          entry.revision = revision;
          entry.at = time;
          entry.version = (versions += 1);
        } else {
          // The map may be still by then: it is asked to draw again once the wait is over.
          later(entry.at + throttleMs - time);
        }
      }
      return entry;
    },
    keep(keys) {
      for (const key of [...cache.keys()]) if (!keys.has(key)) cache.delete(key);
    },
    dispose() {
      map?.off?.("terrain", onChange);
      map?.off?.("sourcedata", onChange);
      if (timer) clearTimeout(timer);
      timer = null;
      cache.clear();
    },
  };
};
