// With terrain on, MapLibre 5 repeats work whose answer has not changed. None of this changes a pixel:
//
//   coords        every tile of every source asks where it lies on every terrain tile, every frame:
//                 about 3,800 new objects and matrices at 1080p. The answer depends only on the tiles.
//   terrain data  asked per tile, per source and per label within a frame, and the same each time.
//                 Its matrix is handed to the GPU on every draw as 32-bit floats, not 64-bit.
//
// Each is skipped if MapLibre no longer has what it relies on (terrainCaches.test.js names them).

const rememberCoords = (manager) => {
  const work = manager?.getTerrainCoords;
  if (typeof work !== "function" || !Array.isArray(manager._renderableTilesKeys)) return;
  let keys = null;
  let signature = "";
  let known = new Map();
  manager.getTerrainCoords = function getTerrainCoords(tileID, ranges) {
    if (ranges) return work.call(this, tileID, ranges);
    if (this._renderableTilesKeys !== keys) {
      keys = this._renderableTilesKeys;
      const now = keys.join();
      if (now !== signature) {
        signature = now;
        known = new Map();
      }
    }
    let coords = known.get(tileID.key);
    if (!coords) {
      coords = work.call(this, tileID);
      known.set(tileID.key, coords);
    }
    return coords;
  };
};

// Chrome copies a matrix that is not a Float32Array into WebGL one number at a time.
// Only swapped when every number is the same, so elevation read on the CPU is too.
export const asFloat32Matrix = (matrix) => {
  if (!matrix || typeof matrix !== "object" || matrix instanceof Float32Array || matrix.length !== 16) return matrix;
  const copy = new Float32Array(matrix);
  for (let index = 0; index < 16; index += 1) {
    if (copy[index] !== matrix[index]) return matrix;
  }
  return copy;
};

const rememberData = (terrain, known) => {
  const work = terrain?.getTerrainData;
  if (typeof work !== "function") return;
  terrain.getTerrainData = function getTerrainData(tileID) {
    let data = known.get(tileID.key);
    if (!data) {
      data = work.call(this, tileID);
      if (data?.u_terrain_matrix) data.u_terrain_matrix = asFloat32Matrix(data.u_terrain_matrix);
      known.set(tileID.key, data);
    }
    return data;
  };
};

// Put on each map instance; a new terrain (terrain turned off and on) is tuned again.
export const attachTerrainCaches = (map) => {
  const data = new Map();
  let tuned = null;
  const tune = () => {
    const terrain = map.terrain ?? null;
    data.clear();
    if (!terrain || terrain === tuned) return;
    tuned = terrain;
    rememberCoords(terrain.tileManager);
    rememberData(terrain, data);
  };
  const forget = () => data.clear();
  tune();
  map.on("terrain", tune);
  map.on("render", forget);
  map.on("sourcedata", forget);
  return () => {
    map.off("terrain", tune);
    map.off("render", forget);
    map.off("sourcedata", forget);
  };
};
