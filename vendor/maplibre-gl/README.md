# The game's own MapLibre

This folder is MapLibre GL JS 6.16.0, compiled from its own TypeScript as part of the game's build, with the changes listed below. `vite.config.ts` points `maplibre-gl` here (`entry.js`). The game imports it as it would the package.

The npm package stays in `package.json`: its stylesheet and types are used, its dependencies are what this code imports, and it is what an upgrade is compared against.

Why a copy and not patches on `node_modules`: the published bundle is minified, and a `postinstall` patch is skipped by `npm ci --ignore-scripts`, which some of our builds use. A folder of source builds the same everywhere, and worker code can only be changed this way.

## What is here

| Path | What |
|---|---|
| `src/` | MapLibre's `src/` at 6.16.0, without tests, benches, `util/test/`, `.glsl` (the generated `.g.ts` shaders are what it imports) or CSS |
| `src/geojson-vt/` | `@maplibre/geojson-vt` 6.3.0, changed (below) |
| `src/util/pbf.js`, `src/util/tinyqueue.js` | pbf 5.1.2 and tinyqueue 3.0.0. The repo's top level has older ones, which the game's scripts use |
| `entry.js` | Sets the worker's URL |
| `tsconfig.json` | `useDefineForClassFields: false`, as the published bundle behaves. `true` would reset fields subclasses declare |

The worker is built by Vite from `src/source/worker.ts` as a module worker, like the game's other workers.

## What is changed, and why

Measured on the Modern Day 2026 save at 1888x917. Every change is byte-identical on screen at fixed cameras unless it says otherwise.

### Memory

| Change | Where | Effect |
|---|---|---|
| **Tiles kept as typed arrays.** A point was an array of its own, for every tile ever asked for. Now 4 bytes a point, rounded exactly as before | `geojson-vt/compact.ts`, `geojson-vt/tile-index.ts` | With the two below: the regions worker from about 700 MB to about 190 MB |
| **Tiles cut on demand can be given back.** The index is built eagerly to z3, not z5, and deeper tiles are forgotten, least recently asked for first, past 3 million points. Every tile above keeps its source, so a tile comes back identical | `geojson-vt/tile-index.ts` `forget`, `drilledMaxPoints`, `geojsonvt.ts` `indexMaxZoom` | Memory no longer grows as the player looks around. Building the index is faster too |
| **A file loaded from a URL is not posted back to the page.** It froze the page while a game opened | `source/geojson_worker_source.ts`, `source/geojson_source.ts` | `getData()` and `updateData()` do not work on a URL source; `getData()` says so. Nothing in the game calls them on one |
| **`line-floorwidth` not stored for plain lines.** Only the dash and pattern programs read it | `data/program_configuration.ts` `isUnreadPaint` | One array a vertex less, on CPU and GPU |
| **`fill-outline-color` not stored with `fill-antialias` off.** Unset, it falls back to a data-driven `fill-color`, so removing it from a layer does nothing | `data/program_configuration.ts` `isUnreadPaint` | The same |
| **No outline index with `fill-antialias` off** | `data/bucket/fill_bucket.ts` | About a quarter off the GPU memory of the region tiles, with the two above |

These three read the style's values as written, not as evaluated, because a tile is drawn at other zooms than the one it was built for. They rest on tiles being rebuilt when those values change: `line-dasharray` and `line-pattern` already do that, and `style/style.ts` `setPaintProperty` does it for `fill-antialias`.

### Frame time

| Change | Where | Effect |
|---|---|---|
| **Placement is skipped when nothing it reads changed, and paced while the camera moves.** With `fadeDuration` 0 every frame was a full placement, past the check MapLibre already has (`_placementInputsChanged`). Now none with a still camera, and at most every `PLACEMENT_PACE_MS` (100) while moving, unless a tile with symbols came, went or took new data. Another frame is always asked for, so the last placement always runs | `style/style.ts` `_updatePlacement` | The largest item of a frame, about 27%, down to about 8%. **Not byte-identical while moving**: a label can appear or go up to 100 ms later. At rest it is the same |
| **One walk of the tile tree for each kind of source** | `style/style.ts` `_updateSources`, `tile/tile_manager.ts` `_coveringTiles` | 24 sources used to walk it each |
| **Symbol layers sorted by source once a sweep**, for `_updateMaxContentElevation` | `style/style.ts`, `tile/tile_manager.ts` | New in 6.x: each source went through all 82 layers, every frame |
| **Retained tiles are not worked out again** when the same tiles are wanted of the same tiles in the same state | `tile/tile_manager.ts` `update`, `tile/tile_manager_in_view_tiles.ts` `signature` | |
| **Tile lists kept between frames** while nothing changed | `tile/tile_manager.ts` `getRenderOrder`, `render/painter.ts` | So nothing may edit them: `stencilConfigForOverlap` sorts a copy. A tile keeps a clone of its id, as walks are shared |
| **Clipping masks kept from source to source** on the same tiles and target | `render/frame_render_context.ts` `renderTileClippingMasks` | Half of all draws on a flat map. Whatever else writes to the stencil clears `currentStencilSource` |
| **`getTerrainCoords` kept until the terrain tiles change, `getTerrainData` kept for a frame** | `tile/terrain_tile_manager.ts`, `render/terrain.ts` | |
| **A uniform buffer for each tile's terrain data**, as 6.x gave projection data. One buffer was rewritten, and reallocated, between most draws | `webgl/terrain_uniform_buffer.ts`, `webgl/program.ts` | |
| **A tile's state is not copied to find there is nothing to apply**, and the copy is shared by the tiles that arrive until it changes | `source/source_state.ts` `initializeTileState` | |
| **GeoJSON goes to the worker as it is**: `serialize` walked every update in script before `postMessage` copied it anyway | `util/web_worker_transfer.ts` `markPlainData`, `source/geojson_source.ts` | About 6% of the main thread during a battle replay |
| **`calculateTileMatrix` writes its matrix directly** | `geo/projection/mercator_utils.ts` | Number for number what identity, translate and scale made |
| **Each source's tiles by terrain tile are kept** while neither set of tiles changes, as is the list `prepareForRender` started from | `webgl/render_to_texture.ts` `_coordsOnTerrain`, `tile/terrain_tile_manager.ts` `coordsRevision` | About 2% of a frame with terrain |
| **Premultiplying skips clear and solid pixels**, the same bytes. A tile's image atlas goes through this as the tile arrives | `util/image.ts` | About 1%, all of it on the frames tiles land in |
| **A custom layer's projection data is made once a frame, and not for a pass it does not draw in.** It was made for every layer in every pass | `webgl/draw/draw_custom.ts` | Shared: a layer must not write to it |

### GL calls

| Change | Where |
|---|---|
| Uniforms the shader compiled away are not set | `webgl/uniform_binding.ts` |
| A raster's second texture is bound and read only while fading | `webgl/draw/draw_raster.ts`, `shaders/glsl/raster.fragment.glsl.g.ts` |
| The terrain's two textures are bound only when they change. `context.setDirty()` forgets them, as a custom layer might use those units | `webgl/program.ts`, `webgl/context.ts`, `render/terrain.ts` `_onDemUnit` |

**Nothing may be left on the terrain's units unseen.** A texture binds to whatever unit is active when it is made or updated, so `Program.draw` puts the active unit back on 0, and a height tile uploaded in the middle of a draw goes through `_onDemUnit`, which uses unit 3 and forgets what was kept there.

**The raster shader must keep its branch.** `mix(a, b, 0.0)` is `a` only while `b` is finite. Leaving another tile's texture on the second unit and relying on the weight of 0 gave dark specks near the poles: a nearly transparent texel overflows `rgb / a`, and infinity times 0 is not a number. Nine test cameras missed this; use the poles too.

## Looked at and left

Measured with the CPU slowed 4x while zooming, and worth less than carrying them through every upgrade:

- **Program keys.** `getProgram` builds and hashes a string on every draw: about 1%.
- **`getPitchedLabelPlaneMatrix`** for each tile and symbol layer: under 1%.
- **One uniform buffer for all tiles**, bound by range, in place of a `bufferData` a tile: about 0.7%, on a flat map.
- **`style.update` on zoom frames.** Layout and paint are evaluated again for every layer: about 3.5%, but skipping a layer needs to know no transition or zoom expression reads it.

The worst frames of a zoom have no one cause: uploads, placement and drawing the new tiles land together. Spreading uploads over frames is what would help, and it is a bigger change, as drawing assumes a loaded tile is uploaded.

The game's own labels (`polityTextCustomLayer.js`) are a draw and a texture each, about 30% of GL calls with terrain on, but about 1% of main-thread time.

## What 6.x already fixed

These were found on 5.19 and need nothing here: typed views keeping uploaded arrays in memory, buffers bound again on every cached vertex array, the terrain `coords` pass, drapes that did not last between frames, and `bindAttribLocation`.

Do not bring back removing repeated points from polygons in tiles. It looks free and is not: `subdivideFill` already merges them, so no vertex is saved, and repeats are what start earcut's collinear filtering, so triangles go up 18%.

## Upgrading

1. Bump `maplibre-gl` in `package.json` and install.
2. Copy its `src/` over a scratch copy of this folder's `src/`, leaving out `*.test.ts`, `*.bench.ts`, `*.glsl`, `*.md`, `css/` and `util/test/`.
3. Check every item above against the new source: upstream may have done it, or changed what it stands on. To see this folder's changes, compare it with the current package's `src/`.
4. A build from source takes dependencies from this repo, not what the published bundle was built with. Check that the unchanged copy matches the bundle byte for byte before editing: an earcut version moved thousands of pixels once.
5. Compare fixed cameras byte for byte against a build of the published package, with a noise floor of two runs of it. `docs/game-map.md` says how.
6. Do the same at a still camera, after each thing that can change what placement decides: a symbol layer's visibility, filter, layout, zoom range and `text-translate`, its order, feature state, `setData`, `updateData`, global state, padding, and terrain on and off. Placement is skipped when `_updatePlacement` sees no reason to run, so anything new it reads has to reach `_placementInputsChanged` or the tiles' signature. Compare how many labels are placed too: it is steadier than pixels.

`src/Game/Map/mapLibreFork.test.js` holds what can be tested in Node.

## Licences

MapLibre GL JS is BSD-3-Clause (`LICENSE.txt`). `src/geojson-vt/` is ISC (`src/geojson-vt/LICENSE`), pbf is BSD-3-Clause (`src/util/pbf.LICENSE`) and tinyqueue is ISC (`src/util/tinyqueue.LICENSE`).
