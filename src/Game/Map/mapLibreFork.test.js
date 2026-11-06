// The game's MapLibre (vendor/maplibre-gl) against what it replaced, where that can be tested without a GPU.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { GeoJSONVT as UpstreamTiles } from "@maplibre/geojson-vt";
import { shippedFile, shippedLibrary } from "./shippedMapLibre.js";

const vendored = (file) => fileURLToPath(new URL(`../../../vendor/maplibre-gl/src/${file}`, import.meta.url));

// TypeScript with extensionless imports: bundled so Node can load it.
const load = async (file) => {
  const { outputFiles } = await build({ entryPoints: [vendored(file)], bundle: true, format: "esm", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
};

// Several modules in one bundle, for code that compares classes across them.
const loadTogether = async (contents) => {
  const { outputFiles } = await build({ stdin: { contents, resolveDir: vendored(""), loader: "ts" }, bundle: true, format: "esm", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
};

const ring = (x, y, size, points) => {
  const out = [];
  for (let index = 0; index < points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const wobble = 1 + 0.2 * Math.sin(angle * 7);
    out.push([x + Math.cos(angle) * size * wobble, y + Math.sin(angle) * size * wobble]);
  }
  out.push(out[0]);
  return out;
};

const world = () => ({
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { id: "a", name: "A" }, geometry: { type: "Polygon", coordinates: [ring(10, 45, 12, 400), ring(10, 45, 3, 60).reverse()] } },
    { type: "Feature", properties: { id: "b" }, geometry: { type: "MultiPolygon", coordinates: [[ring(-60, -10, 20, 500)], [ring(120, 30, 8, 200)]] } },
    { type: "Feature", properties: { id: "c" }, geometry: { type: "LineString", coordinates: ring(40, 10, 15, 120) } },
    { type: "Feature", properties: { id: "d" }, geometry: { type: "Point", coordinates: [12.5, 41.9] } },
    { type: "Feature", properties: { id: "e" }, geometry: { type: "MultiPoint", coordinates: [[2, 48], [13, 52], [13, 52]] } },
    { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: [ring(-100, 40, 5, 40), ring(-90, 40, 5, 40)] } },
  ],
});

const upstreamTiles = (data, options) => new UpstreamTiles(data, options);

const OPTIONS = { buffer: 2048, tolerance: 0.016, extent: 8192, maxZoom: 18, lineMetrics: false, generateId: false, promoteId: "id" };

const sameTile = (before, after, where) => {
  assert.equal(Boolean(after), Boolean(before), where);
  if (!before) return;
  assert.equal(after.numPoints, before.numPoints, where);
  assert.equal(after.numSimplified, before.numSimplified, where);
  assert.equal(after.features.length, before.features.length, where);
  before.features.forEach((feature, index) => {
    const other = after.features[index];
    assert.equal(other.type, feature.type, where);
    assert.equal("id" in other, "id" in feature, where);
    assert.equal(other.id, feature.id, where);
    assert.deepEqual(other.tags, feature.tags, where);
    // As text: the library's rounding can give -0, and a typed array keeps 0, the same place on the tile.
    assert.equal(JSON.stringify(other.geometry), JSON.stringify(feature.geometry), where);
  });
};

const everyTile = (zooms, visit) => {
  for (const z of zooms) {
    const tiles = 1 << z;
    for (let x = 0; x < tiles; x += 1) for (let y = 0; y < tiles; y += 1) visit(z, x, y);
  }
};

test("the game's tiles are the published library's, tile for tile", async () => {
  const { GeoJSONVT } = await load("geojson-vt/index.ts");
  const before = upstreamTiles(world(), OPTIONS);
  const after = new GeoJSONVT(world(), OPTIONS);
  everyTile([0, 1, 2, 3, 4, 5, 6], (z, x, y) => sameTile(before.getTile(z, x, y), after.getTile(z, x, y), `${z}/${x}/${y}`));
});

test("a tile given back comes back the same, however little is kept", async () => {
  const { GeoJSONVT } = await load("geojson-vt/index.ts");
  const before = upstreamTiles(world(), OPTIONS);
  const after = new GeoJSONVT(world(), { ...OPTIONS, drilledMaxPoints: 50 });
  // Twice, and from the deepest up, so tiles are asked for again after their parents are gone.
  for (let round = 0; round < 2; round += 1) {
    everyTile([7, 6, 5, 4], (z, x, y) => sameTile(before.getTile(z, x, y), after.getTile(z, x, y), `round ${round} ${z}/${x}/${y}`));
  }
  assert.ok(Object.keys(after.tileIndex.tiles).length < Object.keys(before.tileIndex.tiles).length / 2, "tiles were given back");
});

test("an index updated in place serves the published library's tiles, before and after tiles are given back", async () => {
  const { GeoJSONVT } = await load("geojson-vt/index.ts");
  const options = { ...OPTIONS, updateable: true };
  const moved = { type: "Feature", id: "a", properties: { id: "a", name: "moved" }, geometry: { type: "Polygon", coordinates: [ring(20, 40, 9, 300)] } };
  const diff = { update: [{ id: "a", newGeometry: moved.geometry, addOrUpdateProperties: [{ key: "name", value: "moved" }] }], remove: ["d"] };
  const before = new UpstreamTiles(world(), options);
  const after = new GeoJSONVT(world(), { ...options, drilledMaxPoints: 200 });
  // Tiles are cut before the update too, so the update has drilled tiles to throw out.
  everyTile([3, 4, 5], (z, x, y) => sameTile(before.getTile(z, x, y), after.getTile(z, x, y), `before ${z}/${x}/${y}`));
  before.updateData(diff);
  after.updateData(diff);
  // An empty tile the library kept and no tile at all are the same thing to MapLibre: nothing to draw.
  const drawn = (tile) => (tile?.features.length ? tile : null);
  everyTile([5, 4, 3, 2, 1, 0], (z, x, y) => sameTile(drawn(before.getTile(z, x, y)), drawn(after.getTile(z, x, y)), `after ${z}/${x}/${y}`));
});

test("a tile asked for is served even when it alone is over the limit", async () => {
  const { GeoJSONVT } = await load("geojson-vt/index.ts");
  const after = new GeoJSONVT(world(), { ...OPTIONS, drilledMaxPoints: 0 });
  const before = upstreamTiles(world(), OPTIONS);
  sameTile(before.getTile(6, 33, 22), after.getTile(6, 33, 22), "6/33/22");
});

test("a feature's points that do not fit 16 bits keep their value", async () => {
  const { CompactFeature } = await load("geojson-vt/compact.ts");
  const far = new CompactFeature(2, null, [[10, 10, 11, 11]], 1, 0, 0, 8192);
  assert.ok(far.coords instanceof Int32Array);
  assert.deepEqual(far.geometry, [[[81920, 81920], [90112, 90112]]]);
  const near = new CompactFeature(3, null, [[0.1, 0.1, 0.2, 0.2], []], 1, 0, 0, 8192);
  assert.ok(near.coords instanceof Int16Array);
  assert.deepEqual(near.geometry, [[[819, 819], [1638, 1638]], []], "an empty ring stays");
  assert.deepEqual(new CompactFeature(1, null, [[0.1, 0.1, 0.2, 0.2]], 1, 0, 0, 8192).geometry, [[819, 819], [1638, 1638]]);
});

test("the tiles' signature moves when what is drawn could change", async () => {
  const { InViewTiles } = await load("tile/tile_manager_in_view_tiles.ts");
  const tile = (key) => ({ tileID: { key, unwrapTo: () => ({ key: `${key}'` }), wrap: 0 }, state: "loading", dataRevision: 0, holdingForSymbolFade: () => false });
  const tiles = new InViewTiles();
  const first = tile("a");
  tiles.setTile("a", first);
  const seen = new Set([tiles.signature()]);
  const moved = (label) => {
    const now = tiles.signature();
    assert.ok(!seen.has(now), label);
    seen.add(now);
  };
  assert.ok(seen.has(tiles.signature()), "and stands still when nothing did");
  first.state = "loaded";
  moved("a state");
  first.dataRevision += 1;
  moved("new data");
  first.holdingForSymbolFade = () => true;
  moved("held for its symbols");
  tiles.setTile("b", tile("b"));
  moved("a tile came");
  tiles.deleteTileById("b");
  moved("a tile went");
  tiles.handleWrapJump(1);
  moved("the world wrapped");
});

test("a list of tiles is replaced, never edited, so a loop over one can remove tiles", async () => {
  const { InViewTiles } = await load("tile/tile_manager_in_view_tiles.ts");
  const tiles = new InViewTiles();
  tiles.setTile("a", { state: "loaded", tileID: { key: "a" } });
  tiles.setTile("b", { state: "loaded", tileID: { key: "b" } });
  const ids = tiles.getAllIds();
  assert.equal(tiles.getAllIds(), ids, "kept while nothing changes");
  tiles.deleteTileById("a");
  assert.deepEqual(ids, ["a", "b"]);
  assert.deepEqual(tiles.getAllIds(), ["b"]);
});

// A tile is drawn at other zooms than it was built for, so a value that only some zooms need is still kept.
test("a value per vertex is left out only where no zoom and no program reads it", async () => {
  const { createStyleLayer, ProgramConfiguration, EvaluationParameters } = await loadTogether(`
    export {createStyleLayer} from "./style/create_style_layer.ts";
    export {ProgramConfiguration} from "./data/program_configuration.ts";
    export {EvaluationParameters} from "./style/evaluation_parameters.ts";
  `);
  const kept = (type, paint, property) => {
    const layer = createStyleLayer({ id: "a", type, source: "s", paint }, {});
    layer.recalculate(new EvaluationParameters(5), []);
    return property in new ProgramConfiguration(layer, 5, () => true).binders;
  };
  const width = ["get", "width"];
  assert.equal(kept("line", { "line-width": width }, "line-floorwidth"), false);
  assert.equal(kept("line", { "line-width": width, "line-dasharray": [1, 1] }, "line-floorwidth"), true);
  assert.equal(kept("line", { "line-width": width, "line-pattern": ["step", ["zoom"], "", 6, "a"] }, "line-floorwidth"), true);
  const colour = ["get", "colour"];
  assert.equal(kept("fill", { "fill-color": colour, "fill-antialias": false }, "fill-outline-color"), false);
  assert.equal(kept("fill", { "fill-color": colour }, "fill-outline-color"), true);
  assert.equal(kept("fill", { "fill-color": colour, "fill-antialias": ["step", ["zoom"], false, 6, true] }, "fill-outline-color"), true);
  assert.match(shippedFile("style/style.ts"), /setPaintProperty\(name, value, options\) \|\| name === 'fill-antialias'/);
});

test("premultiplied pixels are the plain sum's, at every alpha", async () => {
  const { premultiplyAlpha } = await load("util/image.ts");
  const pixels = [];
  for (let alpha = 0; alpha < 256; alpha += 1) for (const value of [0, 1, 127, 128, 254, 255]) pixels.push(value, 255 - value, value >> 1, alpha);
  const plain = pixels.map((value, index) => (index % 4 === 3 ? value : Math.round((value * pixels[index - (index % 4) + 3]) / 255)));
  assert.deepEqual([...premultiplyAlpha(new Uint8Array(pixels))], plain);
});

// Only the translucent pass, and the offscreen one for a layer with a prerender, reach the layer.
test("a custom layer's projection data is made once a frame, and only for a pass that draws", () => {
  const draw = shippedFile("webgl/draw/draw_custom.ts");
  assert.ok(draw.indexOf("!implementation.prerender : pass !== 'translucent') return") < draw.indexOf("getProjectionDataForCustomLayer"));
  assert.match(draw, /frameRenderContext\.customLayerProjectionData \?\?= transform\.getProjectionDataForCustomLayer/);
});

test("nothing imports the published tile index, and the fork's build settings are in place", () => {
  assert.equal(/^import .*from '@maplibre\/geojson-vt'/m.test(shippedLibrary()), false);
  const config = JSON.parse(fs.readFileSync(new URL("../../../vendor/maplibre-gl/tsconfig.json", import.meta.url), "utf8"));
  assert.equal(config.compilerOptions.useDefineForClassFields, false);
  const vite = fs.readFileSync(new URL("../../../vite.config.ts", import.meta.url), "utf8");
  assert.ok(vite.includes("vendor/maplibre-gl/entry.js"));
});

// Masks kept from source to source are only right while whatever else writes to the stencil says so.
test("whatever writes to the stencil in MapLibre clears the masks", () => {
  const frame = shippedFile("render/frame_render_context.ts");
  assert.ok(shippedFile("webgl/render_to_texture.ts").includes("frameRenderContext.invalidateTileClippingMasks();"));
  for (const method of ["clearStencil(): void {", "stencilModeFor3D(): StencilMode {"]) {
    const start = frame.indexOf(method);
    assert.ok(start > 0, method);
    assert.ok(frame.slice(start, start + 300).includes("this.currentStencilSource = undefined;"), method);
  }
});

test("no custom layer of this game writes to the stencil", () => {
  for (const file of ["./frontBasemapLayer.js", "./frontGroundLayer.js", "./strikeCustomLayer.js", "./vnext/ownershipFloodCustomLayer.js", "./labels/polityTextCustomLayer.js"]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.equal(/stencil(Op|Func|Mask)|STENCIL_BUFFER_BIT/.test(source), false, file);
  }
});

// mix(a, b, 0) is not a when b overflows: another tile's texture on that unit gave dark specks near the poles.
test("a raster reads its second texture only while it fades", () => {
  const shader = shippedFile("shaders/glsl/raster.fragment.glsl.g.ts");
  const branch = shader.indexOf("if (u_fade_t > 0.0)");
  assert.ok(branch > 0);
  assert.ok(shader.indexOf("texture(u_image1") > branch);
});

test("nothing is left on the terrain's texture units unseen", () => {
  const draw = shippedFile("webgl/program.ts");
  assert.match(draw, /if \(depthChanged \|\| demChanged\) context\.activeTexture\.set\(gl\.TEXTURE0\);/);
  assert.match(shippedFile("webgl/context.ts"), /setDirty\(\): void \{\n\s+this\.terrainDepthTexture = null;\n\s+this\.terrainTexture = null;/);
  const terrain = shippedFile("render/terrain.ts");
  assert.match(terrain, /sourceTile\.needsTerrainPrepare\)\) this\._onDemUnit\(/);
});

test("placement is paced only where every frame was a full placement", () => {
  const style = shippedFile("style/style.ts");
  assert.match(style, /PLACEMENT_PACE_MS = 100/);
  assert.match(style, /fadeDuration === 0 && !forceFullPlacement && !this\._layerOrderChanged/);
  assert.match(style, /!this\._placementInputsChanged\(transform, showCollisionBoxes, crossSourceCollisions\)\) return false/);
});
