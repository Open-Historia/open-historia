// With terrain on, MapLibre 5 repeats work whose answer has not changed. None of this changes a pixel:
//
//   coords        every tile of every source asks where it lies on every terrain tile, every frame:
//                 about 3,800 new objects and matrices at 1080p. The answer depends only on the tiles.
//   terrain data  asked per tile, per source and per label within a frame, and the same each time.
//                 Its matrix is handed to the GPU on every draw as 32-bit floats, not 64-bit.
//   drapes        a tile's flat layers are painted to a texture per stack of layers, meant to be kept between frames.
//                 Each stack overwrote the slots of the one before, so every tile was painted again every frame:
//                 three quarters of the GPU's work and half the draw calls, on a map that had not changed.
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

// The layer types MapLibre paints into drapes (render_to_texture.ts LAYERS_TO_TEXTURES).
const DRAPED = new Set(["background", "fill", "line", "raster", "hillshade", "color-relief"]);

// Every stack of every tile on screen, in about the memory MapLibre's 30 slots took at twice the size.
const DRAPE_SLOTS = 64;

// What a drape's pixels hang on besides its sources and the style, which MapLibre watches itself.
// Zoom: every line, and paint that changes with zoom. Bearing: the hillshade's light. Pitch: raster filtering.
// Pixel scale: line widths on the globe. Size: line edges. Panning changes none of these on a flat map.
export const drapeView = (transform) => [
  transform.zoom,
  transform.bearingInRadians,
  transform.pitch,
  transform.getPixelScale?.(),
  transform.width,
  transform.height,
].join();

const rememberDrapes = (painter, tileManager) => {
  const drapes = painter?.renderToTexture;
  const pool = drapes?.pool;
  const prepare = drapes?.prepareForRender;
  const make = pool?._createObject;
  if (typeof prepare !== "function" || typeof make !== "function" || typeof tileManager?.freeRtt !== "function") return;
  if (!Array.isArray(pool._objects) || !Array.isArray(pool._recentlyUsed)) return;

  pool._size = DRAPE_SLOTS;

  // A slot is taken from a drape on screen only when none is left, and then the newest: the oldest loses them all.
  pool.getOrCreateFreeObject = function getOrCreateFreeObject() {
    const onScreen = new Set();
    for (const tile of drapes._renderableTiles) {
      for (const drawn of tile.rtt) {
        if (drawn && this._objects[drawn.id]?.stamp === drawn.stamp) onScreen.add(drawn.id);
      }
    }
    const free = this._recentlyUsed.map((id) => this._objects[id]).filter((slot) => !slot.inUse);
    const spare = free.find((slot) => !onScreen.has(slot.id));
    if (spare) return spare;
    if (this._objects.length < this._size) {
      const slot = this._createObject(this._objects.length);
      this._objects.push(slot);
      return slot;
    }
    if (free.length) return free.at(-1);
    throw new Error("No free RenderPool available, call freeAllObjects() required!");
  };

  // Painting a drape tests no depth and clears its stencil first, so the slots share one: half their memory.
  let depthStencil = null;
  pool._createObject = function _createObject(id) {
    const context = this._context;
    const create = context.createRenderbuffer;
    context.createRenderbuffer = function sharedRenderbuffer(...size) {
      depthStencil ??= create.apply(this, size);
      return depthStencil;
    };
    try {
      return make.call(this, id);
    } finally {
      delete context.createRenderbuffer;
    }
  };

  // A canvas source tells nobody when it takes up its picture: that happens in prepare, while playing or resized.
  // (Its type says "image", as MapLibre makes it from that class.)
  const watched = new WeakSet();
  let pictures = 0;
  const watchPictures = (style) => {
    for (const id in style.tileManagers) {
      const source = style.tileManagers[id].getSource();
      if (!source.canvas || watched.has(source)) continue;
      watched.add(source);
      const take = source.prepare;
      source.prepare = function prepare() {
        if (this._playing || this.canvas?.width !== this.width || this.canvas?.height !== this.height) pictures += 1;
        return take.call(this);
      };
    }
  };

  // While anything is in transition (a picture playing, paint easing) drapes last one frame, and one after it ends.
  let seen = null;
  drapes.prepareForRender = function prepareForRender(style, zoom) {
    watchPictures(style);
    const view = style.hasTransitions() ? null : `${pictures}/${drapeView(painter.transform)}`;
    if (view === null || view !== seen) tileManager.freeRtt();
    seen = view;
    return prepare.call(this, style, zoom);
  };
};

// A tile of a source drawn only over the terrain (units, labels, cities) changes no drape, yet freed the tile's drapes.
const keepDrapesFromOtherTiles = (map, terrainSourceId) => {
  const listener = map._terrainDataCallback;
  const style = map.style;
  if (typeof listener !== "function" || !terrainSourceId || !style?._layers) return;
  const drapedBy = (sourceId) => Object.values(style._layers).some((layer) => layer.source === sourceId && DRAPED.has(layer.type));
  map._terrainDataCallback = (event) => {
    const tile = event.dataType === "source" ? event.tile : null;
    if (tile && event.sourceId !== terrainSourceId && !drapedBy(event.sourceId)) return;
    listener(event);
    // An elevation tile rewrites the borders of its neighbours too, and they are hillshaded in their own drapes.
    if (tile && event.source?.type === "raster-dem") map.terrain?.tileManager.freeRtt();
  };
  style.off("data", listener);
  style.on("data", map._terrainDataCallback);
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
    rememberDrapes(map.painter, terrain.tileManager);
    keepDrapesFromOtherTiles(map, terrain.options?.source);
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
