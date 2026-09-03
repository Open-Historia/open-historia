/*! Open Historia — portions (region seed coarsening tests) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Runs in a BARE CHECKOUT (no node_modules): regionSeedCore.js is import-free on
// purpose, because it also has to run inside a Worker. Keep it that way.
import test from "node:test";
import assert from "node:assert/strict";

import {
  COARSE_MIN_SPAN_DEG,
  COARSE_TOLERANCE_DEG,
  coarsenGeometry,
  emptyRegionSeed,
  indexRegionFeatureCollection,
  simplifyRing,
} from "./regionSeedCore.js";

// A closed square ring, `span` degrees on a side, with `extra` collinear points
// inserted along the bottom edge — those are exactly what simplification should
// remove, because dropping them changes the shape not at all.
const square = (span, extra = 0) => {
  const bottom = [[0, 0]];
  for (let i = 1; i <= extra; i += 1) bottom.push([(span * i) / (extra + 1), 0]);
  return [...bottom, [span, 0], [span, span], [0, span], [0, 0]];
};

test("simplifyRing drops collinear points and keeps the ring closed", () => {
  const ring = square(1, 50);
  const out = simplifyRing(ring, COARSE_TOLERANCE_DEG * COARSE_TOLERANCE_DEG);
  assert.equal(ring.length, 55);
  assert.equal(out.length, 5, "a square is four corners plus the repeated first point");
  assert.deepEqual(out[0], out[out.length - 1], "ring must stay closed");
});

test("simplifyRing keeps detail that is larger than the tolerance", () => {
  // A spike one degree tall, far above a 0.01 band, must survive.
  const ring = [[0, 0], [1, 0], [2, 1], [3, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
  const out = simplifyRing(ring, COARSE_TOLERANCE_DEG * COARSE_TOLERANCE_DEG);
  assert.ok(out.some(([x, y]) => x === 2 && y === 1), "the spike is real geometry, not noise");
});

test("simplifyRing leaves a ring too short to simplify alone", () => {
  const triangle = [[0, 0], [1, 0], [0, 1], [0, 0]];
  assert.deepEqual(simplifyRing(triangle, 1), triangle);
});

test("a hole too small to see is dropped, its shell is kept", () => {
  const tiny = COARSE_MIN_SPAN_DEG / 10;
  const geometry = { type: "Polygon", coordinates: [square(5), square(tiny)] };
  const out = coarsenGeometry(geometry);
  assert.equal(out.coordinates.length, 1, "the sub-pixel hole goes, the shell stays");
});

test("a lone speck keeps its shell rather than vanishing", () => {
  // Same invariant as the archipelago case below: every plain GADM region the
  // tiles paint needs geometry here, however small, or it disappears across the
  // crossfade band. What it loses is its holes and its detail, not its existence.
  const tiny = COARSE_MIN_SPAN_DEG / 10;
  const out = coarsenGeometry({ type: "Polygon", coordinates: [square(tiny), square(tiny / 4)] });
  assert.ok(out, "the region still paints");
  assert.equal(out.coordinates.length, 1, "the hole inside a speck is not worth carrying");
});

test("a MultiPolygon keeps the parts still worth drawing and drops the rest", () => {
  const tiny = COARSE_MIN_SPAN_DEG / 10;
  const out = coarsenGeometry({
    type: "MultiPolygon",
    coordinates: [[square(5)], [square(tiny)], [square(8)]],
  });
  assert.equal(out.type, "MultiPolygon");
  assert.equal(out.coordinates.length, 2, "the mainland and the big island, not the rock");
});

test("a region of nothing but specks still gets geometry, so the crossfade has no hole", () => {
  // The Pukapuka case: atolls scattered across ~2.8 degrees, every individual
  // ring far below the span threshold. Dropping them all made a region 182px
  // wide at z5.5 vanish for a whole zoom band, because the tiles have faded out
  // there and the far tier is what should be painting it.
  const tiny = COARSE_MIN_SPAN_DEG / 10;
  const scattered = {
    type: "MultiPolygon",
    coordinates: [[square(tiny)], [square(tiny).map(([x, y]) => [x + 2.8, y])], [square(tiny).map(([x, y]) => [x, y + 1.4])]],
  };
  const out = coarsenGeometry(scattered);
  assert.ok(out, "a region the tiles paint must have far-tier geometry too");
  assert.equal(out.type, "Polygon", "one speck stands in for the archipelago");
  assert.ok(out.coordinates[0].length >= 4, "and it is still a fillable ring");
});

test("geometry with no usable ring at all is still null", () => {
  assert.equal(coarsenGeometry({ type: "Polygon", coordinates: [] }), null);
  assert.equal(coarsenGeometry({ type: "MultiPolygon", coordinates: [] }), null);
  assert.equal(coarsenGeometry({ type: "Polygon", coordinates: [[[0, 0], [1, 1]]] }), null);
});

test("non-polygon geometry is ignored rather than throwing", () => {
  assert.equal(coarsenGeometry({ type: "Point", coordinates: [0, 0] }), null);
  assert.equal(coarsenGeometry(null), null);
  assert.equal(coarsenGeometry(undefined), null);
});

// ---- the index itself -------------------------------------------------------

const feature = (id, opts = {}) => ({
  type: "Feature",
  properties: { id, owner: opts.owner ?? "", gid0: opts.gid0 ?? "", name: opts.name ?? "", ...(opts.edited ? { edited: true } : {}) },
  geometry: { type: "Polygon", coordinates: [square(opts.span ?? 5, 40)] },
});

test("plain GADM regions go to the far tier, drawn and reshaped ones do not", () => {
  const seed = indexRegionFeatureCollection({
    type: "FeatureCollection",
    features: [feature("USA.1_1"), feature("USA.2_1", { edited: true }), feature("reg_fmg_7")],
  });
  assert.deepEqual(seed.coarseFC.features.map((f) => f.properties.id), ["USA.1_1"]);
  assert.deepEqual(seed.authoredFC.features.map((f) => f.properties.id).sort(), ["USA.2_1", "reg_fmg_7"].sort());
  // Painting a reshaped region twice at 0.72 would darken it.
  const authored = new Set(seed.authoredFC.features.map((f) => f.properties.id));
  assert.ok(seed.coarseFC.features.every((f) => !authored.has(f.properties.id)));
});

test("the far tier carries only an id, so nothing baked in can go stale", () => {
  const seed = indexRegionFeatureCollection({
    type: "FeatureCollection",
    features: [feature("USA.1_1", { owner: "United States", name: "Alabama", gid0: "USA" })],
  });
  assert.deepEqual(Object.keys(seed.coarseFC.features[0].properties), ["id"]);
  // The full record still reaches the main thread through propsById.
  assert.equal(seed.propsById.get("USA.1_1").owner, "United States");
  assert.equal(seed.ownersById.get("USA.1_1"), "United States");
});

test("the far tier's geometry really is coarser than the source", () => {
  const source = { type: "FeatureCollection", features: [feature("USA.1_1", { span: 5 })] };
  const before = source.features[0].geometry.coordinates[0].length;
  const seed = indexRegionFeatureCollection(source);
  const after = seed.coarseFC.features[0].geometry.coordinates[0].length;
  assert.ok(after < before, `expected fewer than ${before} points, got ${after}`);
  assert.equal(after, 5, "the 40 inserted collinear points all go: a square is 4 corners plus closure");
});

test("hasDrawn and hasGadm are independent, and both are true on a hybrid map", () => {
  const hybrid = indexRegionFeatureCollection({
    type: "FeatureCollection",
    features: [feature("USA.1_1"), feature("reg_fmg_7")],
  });
  assert.equal(hybrid.hasDrawn, true);
  assert.equal(hybrid.hasGadm, true);

  const drawnOnly = indexRegionFeatureCollection({ type: "FeatureCollection", features: [feature("reg_fmg_7")] });
  assert.equal(drawnOnly.hasDrawn, true);
  assert.equal(drawnOnly.hasGadm, false);
  assert.equal(drawnOnly.coarseFC.features.length, 0, "no stock base means nothing for the far tier to paint");
});

test("a feature with no id is skipped entirely", () => {
  const seed = indexRegionFeatureCollection({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [square(5)] } }],
  });
  assert.equal(seed.propsById.size, 0);
  assert.equal(seed.coarseFC.features.length, 0);
});

test("an empty seed has every key the map reads, so nothing has to null-check", () => {
  const seed = emptyRegionSeed();
  assert.deepEqual(seed.coarseFC, { type: "FeatureCollection", features: [] });
  assert.deepEqual(seed.authoredFC, { type: "FeatureCollection", features: [] });
  assert.equal(seed.hasDrawn, false);
  assert.equal(seed.hasGadm, false);
  assert.equal(seed.ownersById.size, 0);
});

test("coarsening options are overridable, so the thresholds are not baked in", () => {
  const source = { type: "FeatureCollection", features: [feature("USA.1_1", { span: 5 })] };
  const coarse = indexRegionFeatureCollection(source, { toleranceDeg: 2, minSpanDeg: 0 });
  const fine = indexRegionFeatureCollection(source, { toleranceDeg: 0, minSpanDeg: 0 });
  const count = (s) => s.coarseFC.features[0].geometry.coordinates[0].length;
  assert.ok(count(coarse) < count(fine), "a wider band must keep fewer points");
});
