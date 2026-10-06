// Run: node --test src/Editor/cleanupScope.test.js
//
// What a save's border cleanup reads (topologySweep.js, "What a save has to
// look at"): not the stock world's regions that nobody has reshaped, and not
// the regions it has already been over that have not changed since. The pure
// rules are tested as they are; the sweep itself lives in OlMap.jsx, inside
// a component, so it is lifted out as written and run on small maps drawn
// here, in the map's own metres.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import Feature from "ol/Feature.js";
import Polygon from "ol/geom/Polygon.js";
import VectorSource from "ol/source/Vector.js";

import { isStockShape, ownsShape } from "./shapeAuthority.js";
import * as geometry from "./geometry.js";
import * as sweepModule from "./topologySweep.js";

const { describeCleanupProgress, describeCleanupResult, planCleanupScope, shapeStamp, sliverLoser } = sweepModule;

// ---------------------------------------------------------------------------
// The pure rules

test("a shape's stamp changes with any coordinate and with where its rings end", () => {
  const flat = [0, 0, 10, 0, 10, 10, 0, 10, 0, 0];
  const stamp = shapeStamp(flat, [10]);
  assert.equal(shapeStamp(flat.slice(), [10]), stamp, "the same shape, the same stamp");
  const nudged = flat.slice();
  nudged[4] += 1e-9;
  assert.notEqual(shapeStamp(nudged, [10]), stamp, "a nanometre is a change");
  assert.notEqual(shapeStamp([...flat, 0, 0], [10]), stamp);
  assert.notEqual(shapeStamp(flat, [6, 10]), stamp, "the same points in other rings are another shape");
  const swapped = [0, 0, 10, 10, 10, 0, 0, 10, 0, 0];
  assert.notEqual(shapeStamp(swapped, [10]), stamp, "and so are the same points in another order");
});

test("the first sweep of a map whose regions are all its own reads every one", () => {
  const regions = ["a", "b", "c"].map((id, index) => ({ id, extent: [index, 0, index + 1, 1], own: true, stamp: () => assert.fail("nothing is settled yet, so nothing is stamped") }));
  const plan = planCleanupScope(regions, new Map(), { pad: 5 });
  assert.equal(plan.whole, true);
  assert.deepEqual(plan.changed, ["a", "b", "c"]);
});

test("after that a save reads the regions that changed, around where they were and where they are", () => {
  const seen = new Map([
    ["a", { extent: [0, 0, 10, 10], stamp: "s-a" }],
    ["b", { extent: [10, 0, 20, 10], stamp: "s-b" }],
    ["c", { extent: [20, 0, 30, 10], stamp: "s-c" }],
    ["gone", { extent: [50, 50, 60, 60], stamp: "s-gone" }],
  ]);
  const regions = [
    { id: "a", extent: [0, 0, 10, 10], own: true, stamp: () => "s-a" },
    // Reshaped: it stood at 10..20 and stands at 12..25 now.
    { id: "b", extent: [12, 0, 25, 10], own: true, stamp: () => "s-b2" },
    { id: "c", extent: [20, 0, 30, 10], own: true, stamp: () => "s-c" },
    { id: "new", extent: [30, 0, 40, 10], own: true, stamp: () => "s-new" },
  ];
  const plan = planCleanupScope(regions, seen, { pad: 3 });
  assert.equal(plan.whole, false);
  assert.deepEqual(plan.changed, ["b", "new"]);
  assert.deepEqual(plan.hotspots, [
    [7, -3, 28, 13],
    [27, -3, 43, 13],
    // And where the region that is gone used to be: what it left is a gap too.
    [47, 47, 63, 63],
  ]);
});

test("nothing changed and nothing gone is nothing to read", () => {
  const seen = new Map([["a", { extent: [0, 0, 1, 1], stamp: "s" }], ["b", { extent: [1, 0, 2, 1], stamp: "t" }]]);
  const plan = planCleanupScope([
    { id: "a", extent: [0, 0, 1, 1], own: true, stamp: () => "s" },
    { id: "b", extent: [1, 0, 2, 1], own: true, stamp: () => "t" },
  ], seen);
  assert.deepEqual(plan, { changed: [], hotspots: [], whole: false });
});

test("a stock region nobody has reshaped is never read as changed, and never stamped", () => {
  const stock = (id, x) => ({ id, extent: [x, 0, x + 1, 1], own: false, stamp: () => assert.fail("a stock region is not hashed") });
  // First sight of a world nobody has reshaped: nothing to read at all.
  assert.deepEqual(planCleanupScope([stock("AFG.1_1", 0), stock("AFG.2_1", 1)], new Map()), { changed: [], hotspots: [], whole: false });
  // One of them reshaped: it is the map's own now, and where it used to stand
  // is known from when it came onto the map.
  const seen = new Map([["AFG.1_1", { extent: [0, 0, 1, 1], stamp: null }], ["AFG.2_1", { extent: [1, 0, 2, 1], stamp: null }]]);
  const plan = planCleanupScope([
    { id: "AFG.1_1", extent: [0, 0, 0.5, 1], own: true, stamp: () => "x" },
    stock("AFG.2_1", 1),
  ], seen, { pad: 1 });
  assert.deepEqual(plan, { changed: ["AFG.1_1"], hotspots: [[-1, -1, 2, 2]], whole: false });
});

test("a region no finished sweep has been over is read again", () => {
  const seen = new Map([["a", { extent: [0, 0, 1, 1], stamp: null }], ["b", { extent: [1, 0, 2, 1], stamp: "t" }]]);
  const plan = planCleanupScope([
    { id: "a", extent: [0, 0, 1, 1], own: true, stamp: () => assert.fail("unsettled: read without asking") },
    { id: "b", extent: [1, 0, 2, 1], own: true, stamp: () => "t" },
  ], seen);
  assert.deepEqual(plan.changed, ["a"]);
});

test("beside a stock region the map's own region is the one trimmed; between two of its own, the smaller", () => {
  assert.equal(sliverLoser({ aOwn: true, bOwn: false, aArea: 100, bArea: 1 }), "a", "whichever is larger");
  assert.equal(sliverLoser({ aOwn: false, bOwn: true, aArea: 1, bArea: 100 }), "b");
  assert.equal(sliverLoser({ aOwn: true, bOwn: true, aArea: 100, bArea: 1 }), "b");
  assert.equal(sliverLoser({ aOwn: true, bOwn: true, aArea: 1, bArea: 100 }), "a");
  assert.equal(sliverLoser({ aOwn: true, bOwn: true, aArea: 5, bArea: 5 }), "b", "a tie goes as it always did: the first keeps it");
  assert.equal(sliverLoser({ aOwn: false, bOwn: false, aArea: 1, bArea: 2 }), null, "between two stock regions it is the stock world's");
});

test("a stock shape is a region of the stock world that nothing marks as reshaped", () => {
  assert.equal(isStockShape({ id: "DEU.2_1" }), true);
  // Told by the id being the stock world's, not by what it looks like:
  // sixteen regions of Ghana have no dot, and two regions have no name at all.
  for (const id of ["GHA13_2", "NA", "?"]) assert.equal(isStockShape({ id }), true, id);
  assert.equal(isStockShape({ id: "ZZZ.9_9" }), false, "a GADM-looking id the stock world does not have");
  assert.equal(isStockShape({ id: "2415" }), false, "the built-in map's regions are its own");
  assert.equal(isStockShape({ id: "reg_k3j2" }), false, "drawn in the editor");
  // And by the marks the game reads (regionDisplayMesh.js isExplicitAuthoredGeometry).
  assert.equal(isStockShape({ id: "DEU.2_1", edited: true }), false);
  assert.equal(isStockShape({ id: "DEU.2_1", authored: true }), false);
  assert.equal(isStockShape({ id: "DEU.2_1", geometrySource: "Authored" }), false);
  assert.equal(isStockShape({ id: "DEU.2_1", mergedFrom: ["DEU.2_1", "DEU.3_1"] }), false);
  // Another table can be asked (a test's).
  assert.equal(isStockShape({ id: "x" }, new Set(["x"])), true);
});

test("the editor and the game agree on which regions are authored", async () => {
  const { isExplicitAuthoredGeometry } = await import("../Game/Map/vnext/regionDisplayMesh.js");
  const cases = [
    { id: "DEU.2_1" },
    { id: "DEU.2_1", edited: true },
    { id: "DEU.2_1", authored: true },
    { id: "DEU.2_1", geometrySource: "authored" },
    { id: "reg_ab12" },
    { id: "GHA13_2" },
  ];
  for (const props of cases) {
    const authored = isExplicitAuthoredGeometry({ type: "Feature", properties: props });
    assert.equal(!isStockShape(props), authored, JSON.stringify(props));
  }
});

test("the note says nothing when no shape had changed, and counts the regions it read", () => {
  assert.equal(describeCleanupResult({ scope: "none", changed: false, regionCount: 3662 }), "");
  assert.equal(
    describeCleanupResult({ scope: "changed", changed: false, regionCount: 3662, checkedRegions: 7, parts: 1 }),
    "Borders checked: no cracks or slivers between 2 m and 1.5 km across 7 regions.",
  );
  // A sweep of the whole map reads as it always did.
  assert.equal(
    describeCleanupResult({ scope: "whole", changed: false, regionCount: 4848, checkedRegions: 4848, parts: 1 }),
    "Borders checked: no cracks or slivers between 2 m and 1.5 km across 4,848 regions.",
  );
  const first = describeCleanupProgress({ phase: "gaps", pass: 1, regionCount: 3662, passRegions: 7, chunkIndex: 0, chunkCount: 1 });
  assert.match(first.detail, /^7 regions around what has changed · /);
  const later = describeCleanupProgress({ phase: "gaps", pass: 2, regionCount: 3662, passRegions: 5, chunkIndex: 0, chunkCount: 1 });
  assert.match(later.detail, /^5 regions around the last repairs · /);
});

// ---------------------------------------------------------------------------
// The sweep itself, lifted out of OlMap.jsx as it is written there.

const OL_MAP = fs.readFileSync(new URL("./OlMap.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const liftSweep = (source) => {
  const from = OL_MAP.indexOf("const expandExtent = (extent, pad) =>");
  const to = OL_MAP.indexOf("const summarize = (f) =>");
  assert.ok(from >= 0 && to > from, "the sweep's markers are in OlMap.jsx");
  const commands = [];
  const layer = { changed() {} };
  const bindings = {
    regionSource: source,
    regionLayer: layer,
    labelLayer: layer,
    topologyLayer: layer,
    topologySource: { clear() {}, addFeature() {} },
    topologyAnalysisRef: { current: null },
    analyzeTopologyRef: { current: null },
    notifyRegions() {},
    pushCmd: (command) => commands.push(command),
    Feature,
    ...geometry,
    ...sweepModule,
    // Nothing to repaint here.
    yieldToBrowser: async () => {},
  };
  const names = Object.keys(bindings);
  const build = new Function(...names, `${OL_MAP.slice(from, to)}\nreturn { repairTopologyEverywhere, borderCleanupPending };`);
  return { ...build(...names.map((name) => bindings[name])), commands };
};

const KM = 1000;
// A polygon from its corners, closed here.
const shape = (...points) => new Polygon([[...points, points[0]]]);
const box = (x0, y0, x1, y1) => shape([x0, y0], [x1, y0], [x1, y1], [x0, y1]);
const region = (id, geom, props = {}) => {
  const feature = new Feature({ geometry: geom, id, typeId: "land", ...props });
  feature.setId(id);
  return feature;
};
const mapOf = (features) => {
  const source = new VectorSource({ wrapX: false });
  source.addFeatures(features);
  return source;
};
const areaOf = (source, id) => geometry.planarGeometryArea(source.getFeatureById(id).getGeometry());
const stampOf = (source, id) => shapeStamp(source.getFeatureById(id).getGeometry().getFlatCoordinates());
const near = (actual, expected, slack = 1) => assert.ok(Math.abs(actual - expected) <= slack, `${actual} is not within ${slack} of ${expected}`);

// A world map: four stock regions and one drawn in the editor.
//
//   200 km  +-----------+------+
//           |    own    |  S3  |      own overlaps S3 by a 300 m strip, and
//           |           |      |      has a 400 m notch on S1's side (a crack
//   100 km  +---[ ]-----+-[ ]--+----+ between them); S3 has one on S2's side.
//           |    S1     ][  S2      | S4
//           |           |           |      S2 has a 400 m notch on S1's side,
//        0  +-----------+-----------+----+ and S4 overlaps S2 by 300 m.
//           0        100 km      200 km
const worldMap = () => mapOf([
  region("AFG.1_1", box(0, 0, 100 * KM, 100 * KM)),
  region("AFG.2_1", shape([100 * KM, 0], [200 * KM, 0], [200 * KM, 100 * KM], [100 * KM, 100 * KM], [100 * KM, 60 * KM], [100 * KM + 400, 60 * KM], [100 * KM + 400, 40 * KM], [100 * KM, 40 * KM])),
  region("AFG.3_1", shape([100 * KM - 300, 100 * KM], [101 * KM, 100 * KM], [101 * KM, 100 * KM + 400], [102 * KM, 100 * KM + 400], [102 * KM, 100 * KM], [150 * KM, 100 * KM], [150 * KM, 200 * KM], [100 * KM - 300, 200 * KM])),
  region("AFG.4_1", box(200 * KM - 300, 0, 300 * KM, 100 * KM)),
  region("reg_1", shape([0, 100 * KM], [40 * KM, 100 * KM], [40 * KM, 100 * KM + 400], [60 * KM, 100 * KM + 400], [60 * KM, 100 * KM], [100 * KM, 100 * KM], [100 * KM, 200 * KM], [0, 200 * KM])),
]);
// (Ids the stock world really has: that is how a stock region is told.)
const STOCK = ["AFG.1_1", "AFG.2_1", "AFG.3_1", "AFG.4_1"];

test("a world map nobody has reshaped is not swept at all", async () => {
  const source = worldMap();
  source.removeFeature(source.getFeatureById("reg_1"));
  const sweep = liftSweep(source);
  const before = STOCK.map((id) => stampOf(source, id));
  assert.equal(sweep.borderCleanupPending({ ownsShape }), false, "no loading screen goes up");
  const result = await sweep.repairTopologyEverywhere({ ownsShape });
  assert.equal(result.scope, "none");
  assert.equal(result.changed, false);
  assert.equal(result.passes, 0);
  assert.deepEqual(STOCK.map((id) => stampOf(source, id)), before, "the crack and the sliver between stock regions are the stock world's own");
  assert.equal(sweep.commands.length, 0, "and there is nothing to undo");
  // Told nothing about whose the shapes are, it reads every region, as it always did.
  assert.equal(liftSweep(worldMap()).borderCleanupPending(), true);
});

test("a region drawn on a world map is repaired against its stock neighbours, and they are never changed", async () => {
  const source = worldMap();
  const sweep = liftSweep(source);
  const stockBefore = STOCK.map((id) => stampOf(source, id));
  const ownBefore = areaOf(source, "reg_1");
  assert.equal(sweep.borderCleanupPending({ ownsShape }), true);

  const result = await sweep.repairTopologyEverywhere({ ownsShape });
  assert.equal(result.scope, "changed");
  assert.equal(result.checkedRegions, 4, "the drawn region and the three whose boxes reach it; not the one 100 km off");
  assert.equal(result.gaps, 1, "the crack between it and S1");
  assert.equal(result.overlaps, 1, "the sliver it shares with S3");
  assert.equal(result.affectedRegions, 1);
  assert.equal(result.stopped, "");
  // The crack went into the drawn region and the sliver came off it, though it
  // is the larger of the two: 20 km x 400 m gained, 100 km x 300 m lost.
  near(areaOf(source, "reg_1"), ownBefore + 20 * KM * 400 - 100 * KM * 300);
  assert.deepEqual(STOCK.map((id) => stampOf(source, id)), stockBefore, "no stock region moved");
  for (const id of STOCK) assert.equal(source.getFeatureById(id).get("edited"), undefined, `${id} is still the stock world's shape`);
  // The crack between S2 and S3 lies inside the place looked at, and is left:
  // neither region on its rim is the map's own.
  assert.equal(geometry.enclosedGapGeoms(["AFG.2_1", "AFG.3_1"].map((id) => source.getFeatureById(id).getGeometry()), { maxWidth: 1500 }).length, 1);
  assert.equal(sweep.commands.length, 1, "one undo step");

  // Saved again with nothing reshaped: nothing to read.
  assert.equal(sweep.borderCleanupPending({ ownsShape }), false);
  const again = await sweep.repairTopologyEverywhere({ ownsShape });
  assert.equal(again.scope, "none");
  assert.equal(sweep.commands.length, 1);
});

test("a stock region the author reshapes becomes the map's own, and is read with what it left behind", async () => {
  const source = worldMap();
  const sweep = liftSweep(source);
  await sweep.repairTopologyEverywhere({ ownsShape });
  // S1 is pulled back from its bottom edge, as a tool would do it: a new
  // shape, and the mark the game reads to draw it from the map's own file.
  const s1 = source.getFeatureById("AFG.1_1");
  s1.setGeometry(box(0, 5 * KM, 100 * KM, 100 * KM));
  s1.set("edited", true);
  assert.equal(sweep.borderCleanupPending({ ownsShape }), true);
  const s2Before = stampOf(source, "AFG.2_1");
  const result = await sweep.repairTopologyEverywhere({ ownsShape });
  assert.equal(result.scope, "changed");
  // The crack between S1 and S2 was the stock world's while both were stock. One of
  // the two is the map's own now, so it is filled, into that one.
  assert.equal(result.gaps, 1);
  near(areaOf(source, "AFG.1_1"), 100 * KM * 95 * KM + 20 * KM * 400);
  assert.equal(stampOf(source, "AFG.2_1"), s2Before);
  assert.equal(source.getFeatureById("AFG.2_1").get("edited"), undefined);
  assert.equal((await sweep.repairTopologyEverywhere({ ownsShape })).scope, "none");
});

test("water inside a stock region is the stock world's too: not filled, and not said to have been left alone", async () => {
  // A lake 800 m wide and 10 km long, a kilometre inside the border.
  const withLake = (x0, x1) => new Polygon([
    [[x0, 0], [x1, 0], [x1, 50 * KM], [x0, 50 * KM], [x0, 0]],
    [[x0 + 1 * KM, 20 * KM], [x0 + 1 * KM, 30 * KM], [x0 + 1 * KM + 800, 30 * KM], [x0 + 1 * KM + 800, 20 * KM], [x0 + 1 * KM, 20 * KM]],
  ]);
  // The lake is in the stock region, beside one drawn in the editor.
  const stockLake = mapOf([region("reg_1", box(0, 0, 50 * KM, 50 * KM)), region("AFG.1_1", withLake(50 * KM, 100 * KM))]);
  const first = await liftSweep(stockLake).repairTopologyEverywhere({ ownsShape });
  assert.equal(first.scope, "changed");
  assert.equal(first.checkedRegions, 2);
  assert.equal(first.gaps, 0);
  assert.equal(first.holesLeftAlone, 0, "it is not this map's to judge");
  // The same lake in the drawn region is the map's own water: left open, and said so.
  const ownLake = mapOf([region("reg_1", withLake(0, 50 * KM)), region("AFG.1_1", box(50 * KM, 0, 100 * KM, 50 * KM))]);
  const second = await liftSweep(ownLake).repairTopologyEverywhere({ ownsShape });
  assert.equal(second.gaps, 0);
  assert.equal(second.holesLeftAlone, 1);
});

// A map whose regions are all its own, like the built-in one.
//
//   150 km  +-----------------------+
//           |          top          |
//   100 km  +----------+-+----------+
//           |    a     |n|    d     |     n is a strip 1 km wide.
//        0  +----------+-+----------+          +------+
//           |         under         |          | far  |   an island of its
//   -50 km  +-----------------------+          +------+   own, 200 km off.
const ownMap = () => mapOf([
  region("1", box(0, 0, 100 * KM, 100 * KM)),
  region("2", box(100 * KM, 0, 101 * KM, 100 * KM)),
  region("3", box(101 * KM, 0, 200 * KM, 100 * KM)),
  region("4", box(0, 100 * KM, 200 * KM, 150 * KM)),
  region("5", box(0, -50 * KM, 200 * KM, 0)),
  region("6", box(400 * KM, -50 * KM, 500 * KM, 0)),
]);

test("a map whose regions are all its own is swept whole the first time, and then only where it changed", async () => {
  const source = ownMap();
  // A sliver to find: region 3 reaches 300 m into region 4.
  source.getFeatureById("3").setGeometry(box(101 * KM, 0, 200 * KM, 100 * KM + 300));
  const sweep = liftSweep(source);
  const first = await sweep.repairTopologyEverywhere({ ownsShape });
  assert.equal(first.scope, "whole");
  assert.equal(first.checkedRegions, 6);
  assert.equal(first.overlaps, 1);
  assert.equal((await sweep.repairTopologyEverywhere({ ownsShape })).scope, "none", "a second save with nothing reshaped");

  // Region 1 gets a notch on region 4's side: a crack, 400 m wide.
  source.getFeatureById("1").setGeometry(shape([0, 0], [100 * KM, 0], [100 * KM, 100 * KM], [60 * KM, 100 * KM], [60 * KM, 100 * KM - 400], [40 * KM, 100 * KM - 400], [40 * KM, 100 * KM], [0, 100 * KM]));
  const second = await sweep.repairTopologyEverywhere({ ownsShape });
  assert.equal(second.scope, "changed");
  assert.equal(second.gaps, 1);
  assert.equal(second.checkedRegions, 5, "region 1 and the regions whose boxes reach it; not the island");
  assert.equal((await sweep.repairTopologyEverywhere({ ownsShape })).scope, "none");
});

test("where a region was deleted is looked at too: the strip it leaves is a crack", async () => {
  const source = ownMap();
  const sweep = liftSweep(source);
  const first = await sweep.repairTopologyEverywhere({ ownsShape });
  assert.equal(first.scope, "whole");
  assert.equal(first.changed, false);
  const total = () => ["1", "3"].reduce((sum, id) => sum + areaOf(source, id), 0);
  const before = total();
  source.removeFeature(source.getFeatureById("2"));
  assert.equal(sweep.borderCleanupPending({ ownsShape }), true);
  const result = await sweep.repairTopologyEverywhere({ ownsShape });
  assert.equal(result.scope, "changed");
  assert.equal(result.gaps, 1, "1 km wide, with regions on both sides");
  near(total(), before + 1 * KM * 100 * KM);
  assert.equal((await sweep.repairTopologyEverywhere({ ownsShape })).scope, "none");
});

test("a sweep that is stopped settles nothing: the next save reads the same regions again", async () => {
  const source = ownMap();
  source.getFeatureById("3").setGeometry(box(101 * KM, 0, 200 * KM, 100 * KM + 300));
  const sweep = liftSweep(source);
  const stopped = await sweep.repairTopologyEverywhere({ ownsShape, stopRequested: () => true });
  assert.equal(stopped.stopped, "user");
  assert.equal(sweep.borderCleanupPending({ ownsShape }), true);
  const next = await sweep.repairTopologyEverywhere({ ownsShape });
  assert.equal(next.scope, "whole");
  assert.equal(next.overlaps, 1);
});

test("a map loaded in place of another starts from nothing", async () => {
  const source = ownMap();
  const sweep = liftSweep(source);
  await sweep.repairTopologyEverywhere({ ownsShape });
  assert.equal(sweep.borderCleanupPending({ ownsShape }), false);
  // The editor clears the map and adds the next one's regions (OlMap.jsx loadRegions).
  const next = ownMap().getFeatures();
  source.clear();
  source.addFeatures(next);
  assert.equal(sweep.borderCleanupPending({ ownsShape }), true);
  assert.equal((await sweep.repairTopologyEverywhere({ ownsShape })).scope, "whole");
});

// ---------------------------------------------------------------------------
// The wiring

test("the save asks first, and hands the sweep the test for whose a shape is", () => {
  const editor = fs.readFileSync(new URL("./MapEditor.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const clean = editor.slice(editor.indexOf("const cleanBorders = async"), editor.indexOf("const persistScenario = async"));
  assert.ok(editor.includes('import { ownsShape } from "./shapeAuthority.js";'));
  assert.match(clean, /if \(api\.borderCleanupPending && !api\.borderCleanupPending\(\{ ownsShape \}\)\) return \[\];/, "nothing to read: no screen, no note");
  assert.ok(clean.indexOf("borderCleanupPending") < clean.indexOf("setBorderCleanup({ phase: \"gaps\""), "asked before the screen goes up");
  assert.match(clean, /stopRequested: \(\) => cleanupStopRef\.current,\n\s+ownsShape,/);
  assert.ok(OL_MAP.includes("      repairTopologyEverywhere,\n      // Whether it would have anything to look at (asked before its screen goes up).\n      borderCleanupPending,"));
  // Only a sweep that ran to its end settles what the next save compares with.
  assert.ok(OL_MAP.includes("if (!stopped) settleCleanup(feats, owns, unsettled);"));
});
