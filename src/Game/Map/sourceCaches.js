// MapLibre works out each source on its own, every frame, though a game has some 25 sources and their answers are shared.
// None of this changes a pixel; what each keeps is exactly what it would work out again.
//
//   tile zoom    with terrain on, 30 powers and cosines per tile visited, the same for every source of a tile size.
//   tile boxes   each tile's bounding box, its elevation looked up, the same for every source.
//   tile state   a tile back from the cache read every feature again to apply their state, changed or not.
//
// Each is skipped if MapLibre no longer has what it relies on (sourceCaches.test.js names them).

// The level of detail MapLibre gives a source of its own accord. It keeps that function to itself, and
// makes the same one from these numbers (covering_tiles.ts).
const MAX_ZOOM_LEVELS_ON_SCREEN = 9.314;
const TILE_COUNT_MAX_MIN_RATIO = 3;

// The answer hangs only on the arguments. In one update of the sources three of them are the camera's, and
// tiles of the same size at the same distance share one. Numbers for keys: making them text cost what this saved.
export const sharedTileZoom = (calculate) => {
  const known = new Map();
  let height = NaN;
  let center = NaN;
  let view = NaN;
  const share = (zoom, toTile, toTileZ, toCenter, fov) => {
    if (toTileZ !== height || toCenter !== center || fov !== view) {
      known.clear();
      height = toTileZ;
      center = toCenter;
      view = fov;
    }
    let atZoom = known.get(zoom);
    if (!atZoom) {
      atZoom = new Map();
      known.set(zoom, atZoom);
    }
    let answer = atZoom.get(toTile);
    if (answer === undefined) {
      answer = calculate(zoom, toTile, toTileZ, toCenter, fov);
      atZoom.set(toTile, answer);
    }
    return answer;
  };
  share.forget = () => known.clear();
  return share;
};

// A tile's place as one number, exact up to here; beyond it a box is simply worked out.
const MAX_KEYED_ZOOM = 20;
const MAX_KEYED_WRAP = 32;
export const tileBoxKey = (tileID, wrap) => {
  if (tileID.z > MAX_KEYED_ZOOM || Math.abs(wrap) >= MAX_KEYED_WRAP) return null;
  return ((tileID.y * 2 ** tileID.z + tileID.x) * 32 + tileID.z) * 64 + wrap + MAX_KEYED_WRAP;
};

// Boxes are kept only while every source is being updated in turn: nothing can move or load in between.
const shareBoxes = (provider, sweep) => {
  const work = provider.getTileBoundingVolume;
  provider.getTileBoundingVolume = function getTileBoundingVolume(tileID, wrap, elevation, options) {
    const key = sweep.running && options?.terrain ? tileBoxKey(tileID, wrap) : null;
    if (key === null) return work.call(this, tileID, wrap, elevation, options);
    let box = sweep.boxes.get(key);
    if (!box) {
      box = work.call(this, tileID, wrap, elevation, options);
      sweep.boxes.set(key, box);
    }
    return box;
  };
};

// A reload makes new buckets, and a change of state a new revision; with neither, the tile is as it was left.
const applyStateOnce = (state) => {
  const work = state?.initializeTileState;
  if (typeof work !== "function" || typeof state.revision !== "number") return;
  const applied = new WeakMap();
  state.initializeTileState = function initializeTileState(tile, painter) {
    const last = applied.get(tile);
    if (last?.revision === this.revision && last.buckets === tile.buckets) return;
    work.call(this, tile, painter);
    applied.set(tile, { revision: this.revision, buckets: tile.buckets });
  };
};

const tuneStyle = (map, style, sweep, providers) => {
  const updateAll = style._updateSources;
  if (typeof updateAll !== "function" || !style.tileManagers) return;
  const managers = new WeakSet();
  let tileZoom = null;

  const makeTileZoom = (sourceId, source) => {
    if (tileZoom || typeof map.setSourceTileLodParams !== "function") return;
    map.setSourceTileLodParams(MAX_ZOOM_LEVELS_ON_SCREEN, TILE_COUNT_MAX_MIN_RATIO, sourceId);
    if (typeof source.calculateTileZoom === "function") tileZoom = sharedTileZoom(source.calculateTileZoom);
  };

  style._updateSources = function _updateSources(transform) {
    const provider = transform.getCoveringTilesDetailsProvider?.();
    if (typeof provider?.getTileBoundingVolume === "function" && !providers.has(provider)) {
      providers.add(provider);
      shareBoxes(provider, sweep);
    }
    for (const id in this.tileManagers) {
      const manager = this.tileManagers[id];
      if (!managers.has(manager)) {
        managers.add(manager);
        applyStateOnce(manager.getState?.());
      }
      const source = manager.getSource();
      makeTileZoom(id, source);
      if (tileZoom) source.calculateTileZoom = tileZoom;
    }
    sweep.boxes.clear();
    tileZoom?.forget();
    sweep.running = true;
    try {
      return updateAll.call(this, transform);
    } finally {
      sweep.running = false;
    }
  };
};

// Put on each map instance; a new style has new sources.
export const attachSourceCaches = (map) => {
  const styles = new WeakSet();
  // One for the map: the camera's provider outlives a rebuilt style, and is wrapped once.
  const providers = new WeakSet();
  const sweep = { running: false, boxes: new Map() };
  const tune = () => {
    const { style } = map;
    if (!style || styles.has(style)) return;
    styles.add(style);
    tuneStyle(map, style, sweep, providers);
  };
  tune();
  map.on("style.load", tune);
  return () => map.off("style.load", tune);
};
