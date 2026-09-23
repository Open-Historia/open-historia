// Run: node --test src/Editor/topologySweep.test.js
//
// The save-time border cleanup reads the holes of one union of every region,
// built in stages. These pin that the grid groups every region exactly once,
// that the staged union finds exactly what one direct union finds — including
// a crack sitting on a chunk boundary that no single chunk encloses — and what
// the loading screen says at each phase.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import GeoJSON from "ol/format/GeoJSON.js";
import Polygon from "ol/geom/Polygon.js";
import VectorSource from "ol/source/Vector.js";

import { enclosedGapGeoms, enclosedGapsOfUnion, overlapGeoms, unionAllGeoms } from "./geometry.js";
import {
  BORDER_CLEANUP,
  bucketRegions,
  chunkIndexFor,
  describeCleanupProgress,
  describeCleanupResult,
  findEnclosedGaps,
  hotspotsOf,
  mergeWithinBudget,
  planTopologyChunks,
  splitByVertexBudget,
  touchesHotspot,
  vertexCountOf,
  yieldToBrowser,
} from "./topologySweep.js";

// A 4×4 grid of 1 km squares in a planar (metre) frame with two defects:
// square (1,1) is 20 m short on its east side — a 20 m crack enclosed by its
// four neighbours, lying exactly on the 2×2 chunk boundary at x=2000 — and
// square (2,2) reaches 30 m west into (1,2), a thin overlap.
const square = (column, row, { eastInset = 0, westOverhang = 0 } = {}) => {
  const x0 = column * 1000 - westOverhang;
  const x1 = (column + 1) * 1000 - eastInset;
  const y0 = row * 1000;
  const y1 = (row + 1) * 1000;
  return new Polygon([[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]);
};
const grid = [];
for (let column = 0; column < 4; column += 1) {
  for (let row = 0; row < 4; row += 1) {
    grid.push({
      id: `${column},${row}`,
      geom: square(column, row, {
        eastInset: column === 1 && row === 1 ? 20 : 0,
        westOverhang: column === 2 && row === 2 ? 30 : 0,
      }),
    });
  }
}
const key = (gap) => `${gap.geom.getExtent().map((v) => Math.round(v)).join(",")}:${Math.round(gap.area)}`;

test("the grid groups every region exactly once by the centre of its extent", () => {
  const plan = planTopologyChunks([0, 0, 4000, 4000], 16, { targetRegionsPerChunk: 4 });
  assert.equal(plan.cells, 2, "16 regions at 4 per chunk → a 2×2 grid");
  assert.equal(chunkIndexFor(plan, [0, 0, 1000, 1000]), 0);
  assert.equal(chunkIndexFor(plan, [3000, 3000, 4000, 4000]), 3);
  assert.equal(chunkIndexFor(plan, [1000, 0, 3000, 1000]), 2, "a region straddling cells goes with its centre (column 1, row 0)");
  assert.equal(chunkIndexFor(plan, [-500, -500, 4500, 4500]), 3, "beyond the edge is clamped");
  const buckets = bucketRegions(plan, grid, (region) => region.geom.getExtent());
  assert.equal(buckets.length, 4);
  assert.equal(buckets.flat().length, grid.length, "every region lands in exactly one bucket");
  assert.equal(new Set(buckets.flat()).size, grid.length);
  assert.equal(planTopologyChunks([0, 0, 100, 100], 10).cells, 1, "a small map is one chunk");
  assert.equal(planTopologyChunks([0, 0, 100, 100], 4848).cells, 5, "the stock world is a 5×5 grid at 300 regions per chunk");
  assert.equal(planTopologyChunks([0, 0, 100, 100], 25000).cells, 10, "a 25,000-region import is a 10×10 grid");
  assert.equal(planTopologyChunks(null, 10), null);
  assert.equal(planTopologyChunks([0, 0, 1, 1], 0), null);
  assert.deepEqual(bucketRegions(null, grid, () => [0, 0, 0, 0]).length, 1, "no plan → one bucket of everything");
  assert.equal(chunkIndexFor(planTopologyChunks([5, 5, 5, 5], 3), [5, 5, 5, 5]), 0, "a zero-size map does not divide by zero");
});

test("the staged union finds exactly what one direct union finds, including a crack on a chunk boundary that no single chunk encloses", () => {
  const direct = enclosedGapGeoms(grid.map((region) => region.geom), { maxWidth: 500 });
  assert.equal(direct.length, 1);
  assert.ok(direct[0].width > 19 && direct[0].width < 21, `the crack is ~20 m wide, got ${direct[0].width}`);

  const plan = planTopologyChunks([0, 0, 4000, 4000], grid.length, { targetRegionsPerChunk: 4 });
  const buckets = bucketRegions(plan, grid, (region) => region.geom.getExtent());
  const partials = buckets.map((bucket) => unionAllGeoms(bucket.map((region) => region.geom)));
  for (const partial of partials) {
    assert.equal(enclosedGapsOfUnion(partial, { maxWidth: 500 }).length, 0, "no chunk on its own encloses the crack");
  }
  const staged = enclosedGapsOfUnion(unionAllGeoms(partials), { maxWidth: 500 });
  assert.deepEqual(staged.map(key), direct.map(key), "the union of the chunk unions has the same holes as one union of everything");
  assert.equal(enclosedGapsOfUnion(null).length, 0);
});

test("overlaps are a pairwise check that does not depend on chunks", () => {
  const a = grid.find((region) => region.id === "1,2").geom;
  const b = grid.find((region) => region.id === "2,2").geom;
  const pieces = overlapGeoms(a, b, { maxWidth: 500 });
  assert.equal(pieces.length, 1);
  assert.ok(pieces[0].width > 28 && pieces[0].width < 31, `the sliver is ~30 m wide, got ${pieces[0].width}`);
  assert.equal(overlapGeoms(a, b, { maxWidth: 10 }).length, 0, "wider than the tolerance is left alone");
  assert.equal(overlapGeoms(a, b, { maxWidth: 500, minWidth: 31 }).length, 0, "narrower than the floor is left alone");
  assert.equal(overlapGeoms(a, b, { maxWidth: 500, minWidth: 2 }).length, 1, "the sweep's 2 m floor keeps a real sliver");
});

test("the save-time floor ignores cracks too narrow to be anything but rounding noise", () => {
  const geoms = grid.map((region) => region.geom);
  assert.equal(enclosedGapGeoms(geoms, { maxWidth: 500, minWidth: 25 }).length, 0, "a 20 m crack is below a 25 m floor");
  assert.equal(enclosedGapGeoms(geoms, { maxWidth: 500, minWidth: BORDER_CLEANUP.minWidth }).length, 1, "and above the sweep's 2 m floor");
  assert.ok(BORDER_CLEANUP.minWidth >= 1 && BORDER_CLEANUP.minWidth < 10, "the floor is about the size of the save's coordinate rounding");
});

test("the loading screen reports each phase in plain words with a bar that only moves forward", () => {
  const gaps = describeCleanupProgress({ phase: "gaps", regionCount: 4848, chunkIndex: 3, chunkCount: 25, pass: 1 });
  assert.match(gaps.headline, /^looking for cracks between regions/);
  const second = describeCleanupProgress({ phase: "gaps", regionCount: 4848, chunkIndex: 3, chunkCount: 25, pass: 2, maxPasses: 3 });
  assert.match(second.headline, /^Pass 2 of up to 3, checking the repairs left nothing behind — looking for cracks/);
  assert.match(gaps.detail, /4,848 regions · merging chunk 4 of 25/);
  const merging = describeCleanupProgress({ phase: "gaps", regionCount: 4848, chunkIndex: 25, chunkCount: 25 });
  assert.match(merging.detail, /merging 25 chunks into one map and reading every enclosed gap/);
  const overlaps = describeCleanupProgress({ phase: "overlaps", regionCount: 4848, regionsChecked: 2400, overlapsFound: 1, gapsFound: 12 });
  assert.match(overlaps.detail, /2,400 of 4,848 regions checked · 1 sliver so far · 12 cracks found/);
  const apply = describeCleanupProgress({ phase: "apply", repairsDone: 40, repairCount: 353, gapsFilled: 12, overlapsTrimmed: 28 });
  assert.match(apply.detail, /40 of 353 repairs this pass · 12 cracks filled, 28 slivers trimmed so far/);
  const save = describeCleanupProgress({ phase: "save", result: { changed: true, gaps: 12, overlaps: 41, affectedRegions: 48, regionCount: 4848, passes: 2 } });
  assert.equal(save.headline, "saving the map into the scenario");
  assert.equal(save.detail, "Borders cleaned in 2 passes: 12 cracks filled and 41 slivers trimmed across 48 regions.");
  assert.ok(gaps.fraction < merging.fraction && merging.fraction <= overlaps.fraction && overlaps.fraction < apply.fraction && apply.fraction < save.fraction);
  assert.ok(describeCleanupProgress({ phase: "gaps", regionCount: 10, chunkIndex: 0, chunkCount: 0 }).fraction >= 0);
  assert.equal(describeCleanupProgress(null).fraction, 0);
  assert.equal(describeCleanupProgress({ phase: "apply", repairCount: 0 }).headline, "nothing to repair");
});

test("the note after a save says what changed, that nothing did, or that the cleanup was skipped", () => {
  assert.equal(
    describeCleanupResult({ changed: false, regionCount: 4848 }),
    `Borders checked: no cracks or slivers between ${BORDER_CLEANUP.minWidth} m and ${BORDER_CLEANUP.maxWidth} m across 4,848 regions.`,
  );
  assert.equal(describeCleanupResult({ changed: true, gaps: 1, overlaps: 2, affectedRegions: 3, passes: 1 }), "Borders cleaned: 1 crack filled and 2 slivers trimmed across 3 regions.");
  assert.equal(describeCleanupResult({ changed: true, gaps: 98, overlaps: 57, affectedRegions: 140, passes: 2 }), "Borders cleaned in 2 passes: 98 cracks filled and 57 slivers trimmed across 140 regions.");
  assert.match(describeCleanupResult(null, "boom"), /^Border cleanup was skipped \(boom\); the map was saved as it is\.$/);
  assert.equal(describeCleanupResult(null), "");
});

test("yielding resolves on its own (a macrotask here, a frame plus a macrotask in a browser)", async () => {
  const started = Date.now();
  await yieldToBrowser();
  assert.ok(Date.now() - started < 1000);
});

// The budget. polygon-clipping refuses any call past 1,000,000 queued segment
// endpoints, and says so only after spending close to a gigabyte building the
// queue; on a detailed map the old whole-map union was such a call, and on a
// machine with less memory that was enough to kill the page mid-save.
const spyUnion = (budget) => {
  const calls = [];
  const union = (geoms) => {
    const vertices = geoms.reduce((sum, geom) => sum + vertexCountOf(geom), 0);
    calls.push(vertices);
    assert.ok(vertices <= budget, `a union was handed ${vertices} vertices, over the ${budget} budget`);
    return unionAllGeoms(geoms);
  };
  return { union, calls };
};
const noWait = async () => {};

test("vertices are counted from the geometry itself", () => {
  assert.equal(vertexCountOf(square(0, 0)), 5, "a square ring is five points, closing point included");
  assert.equal(vertexCountOf(null), 0);
  assert.equal(vertexCountOf({}), 0);
  assert.ok(BORDER_CLEANUP.maxUnionVertices >= 100000 && BORDER_CLEANUP.maxUnionVertices <= 400000, "well under polygon-clipping's ~500,000-segment ceiling");
});

test("a bucket too heavy for one union is split into compact pieces that each fit", () => {
  const verticesOf = (region) => vertexCountOf(region.geom);
  const extentOf = (region) => region.geom.getExtent();
  const pieces = splitByVertexBudget(grid, { verticesOf, extentOf, budget: 20 });
  assert.equal(pieces.flat().length, grid.length, "every region is in exactly one piece");
  assert.equal(new Set(pieces.flat()).size, grid.length);
  for (const piece of pieces) {
    assert.ok(piece.reduce((sum, region) => sum + verticesOf(region), 0) <= 20, "each piece fits the budget");
    const xs = piece.map((region) => extentOf(region)[0]);
    const ys = piece.map((region) => extentOf(region)[1]);
    assert.ok(Math.max(...xs) - Math.min(...xs) < 1100 && Math.max(...ys) - Math.min(...ys) < 1100, "a piece is a 2x2 patch of neighbours, not a scatter (square 2,2 reaches 30 m west)");
  }
  assert.deepEqual(splitByVertexBudget(grid, { verticesOf, extentOf, budget: 1000 }), [grid], "a bucket that fits stays whole");
  const heavy = { geom: square(0, 0) };
  assert.deepEqual(splitByVertexBudget([heavy], { verticesOf, extentOf, budget: 2 }), [[heavy]], "a single region over the budget is a piece of its own");
  assert.deepEqual(splitByVertexBudget([], { verticesOf, extentOf, budget: 2 }), []);
});

test("merging stays within the budget: one union when it fits, pairs of neighbours when it does not", async () => {
  const geoms = grid.map((region) => region.geom);
  const whole = spyUnion(1000);
  const one = await mergeWithinBudget(geoms, { union: whole.union, budget: 1000 });
  assert.equal(one.length, 1);
  assert.equal(whole.calls.length, 1, "everything fits: the one call the sweep always made");
  assert.deepEqual(enclosedGapsOfUnion(one[0], { maxWidth: 500 }).map(key), enclosedGapGeoms(geoms, { maxWidth: 500 }).map(key));

  const tight = spyUnion(12);
  const parts = await mergeWithinBudget(geoms, { union: tight.union, budget: 12, between: noWait });
  assert.ok(parts.length > 1, "a budget too small for the whole map leaves it in parts");
  assert.ok(tight.calls.length > 0 && tight.calls.every((vertices) => vertices <= 12));
  assert.deepEqual(await mergeWithinBudget([], { union: tight.union }), []);
});

test("read in parts, a hole that another part's region fills is not a crack", async () => {
  // A 1 km square with a 40 m slot through it, and a region that exactly fills
  // the slot: one union of both has no hole at all. Split into two parts, the
  // square's union alone shows the slot as a 37.5 m "crack" that must not be
  // filled, because the enclave's own region is under it.
  const host = new Polygon([
    [[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0]],
    [[400, 200], [400, 800], [440, 800], [440, 200], [400, 200]],
  ]);
  const enclave = new Polygon([[[400, 200], [440, 200], [440, 800], [400, 800], [400, 200]]]);
  const regions = [{ geom: host }, { geom: enclave }];
  const options = {
    plan: null,
    geometryOf: (region) => region.geom,
    gapsOf: enclosedGapsOfUnion,
    isCovered: (point) => regions.some((region) => region.geom.intersectsCoordinate(point)),
    between: noWait,
  };
  const together = await findEnclosedGaps(regions, { ...options, union: unionAllGeoms });
  assert.equal(together.parts, 1);
  assert.equal(together.holes.length, 0, "one union of both has nothing to fill");

  const split = await findEnclosedGaps(regions, { ...options, union: spyUnion(12).union, budget: 12 });
  assert.equal(split.parts, 2, "10 + 5 vertices do not fit a budget of 12, so the two stay apart");
  assert.equal(split.holes.length, 0, "the slot is under the enclave, so it is dropped");
  const unguarded = await findEnclosedGaps(regions, { ...options, union: unionAllGeoms, budget: 12, isCovered: () => false });
  assert.equal(unguarded.holes.length, 1, "without the check the enclave would read as a crack");
  assert.ok(unguarded.holes[0].width > 30 && unguarded.holes[0].width < 45);
});

test("the gap search on the grid finds the crack on the chunk boundary, and never invents one in parts", async () => {
  const options = {
    plan: planTopologyChunks([0, 0, 4000, 4000], grid.length, { targetRegionsPerChunk: 4 }),
    geometryOf: (region) => region.geom,
    gapsOf: enclosedGapsOfUnion,
    isCovered: (point) => grid.some((region) => region.geom.intersectsCoordinate(point)),
    maxWidth: 500,
    minWidth: 0,
    between: noWait,
  };
  const direct = enclosedGapGeoms(grid.map((region) => region.geom), { maxWidth: 500 }).map(key);
  let chunks = 0;
  let done = 0;
  const whole = await findEnclosedGaps(grid, { ...options, union: unionAllGeoms, onChunks: (n) => { chunks = n; }, onChunk: (i) => { done = i; } });
  assert.equal(whole.parts, 1);
  assert.deepEqual(whole.holes.map(key), direct, "the same crack as one union of everything");
  assert.equal(chunks, 4);
  assert.equal(done, 4, "progress reaches the last chunk");
  for (const budget of [6, 12, 30]) {
    const found = await findEnclosedGaps(grid, { ...options, union: spyUnion(budget).union, budget });
    for (const hole of found.holes) assert.ok(direct.includes(key(hole)), `budget ${budget} found a hole one union does not have`);
  }
});

test("the built-in map: exactly the gaps the one-union sweep found, and within a small budget nothing false and no call over it", async () => {
  const text = fs.readFileSync(new URL("../../server/seed/default/regions.geojson", import.meta.url), "utf8");
  const features = new GeoJSON().readFeatures(JSON.parse(text), { featureProjection: "EPSG:3857" }).filter((f) => f.getGeometry());
  const source = new VectorSource({ features });
  const plan = planTopologyChunks(source.getExtent(), features.length);
  const tolerances = { maxWidth: BORDER_CLEANUP.maxWidth, minWidth: BORDER_CLEANUP.minWidth };
  // The sweep as it was: one union per chunk, then one union of the chunk results.
  const partials = bucketRegions(plan, features, (f) => f.getGeometry().getExtent())
    .map((bucket) => unionAllGeoms(bucket.map((f) => f.getGeometry())))
    .filter(Boolean);
  const before = enclosedGapsOfUnion(unionAllGeoms(partials), tolerances).map(key);
  assert.ok(before.length > 50, `the stock map has its known cracks (${before.length})`);
  const options = {
    plan,
    geometryOf: (f) => f.getGeometry(),
    gapsOf: enclosedGapsOfUnion,
    isCovered: (point) => source.getFeaturesAtCoordinate(point).length > 0,
    ...tolerances,
    between: noWait,
  };
  const now = await findEnclosedGaps(features, { ...options, union: spyUnion(BORDER_CLEANUP.maxUnionVertices).union });
  assert.equal(now.parts, 1, "236,003 vertices fit the budget: one union, as always");
  assert.deepEqual(now.holes.map(key), before, "and the very same cracks, crack by crack");

  const tight = spyUnion(20000);
  const parts = await findEnclosedGaps(features, { ...options, union: tight.union, budget: 20000 });
  assert.ok(parts.parts > 1, `a 20,000-vertex budget reads the map in parts (${parts.parts})`);
  assert.ok(Math.max(...tight.calls) <= 20000);
  assert.ok(parts.holes.length > 0, "most cracks lie inside one part and are still found");
  for (const hole of parts.holes) assert.ok(before.includes(key(hole)), "a crack found in parts is one the whole map has");
});

test("the Workshop's save runs this search, with the budget on overlaps and gap targets too", () => {
  const olMap = fs.readFileSync(new URL("./OlMap.jsx", import.meta.url), "utf8");
  const sweep = olMap.slice(olMap.indexOf("const repairTopologyEverywhere = async"), olMap.indexOf("const summarize = (f) =>"));
  assert.ok(sweep.includes("await findEnclosedGaps(passFeats, {"), "the save-time sweep uses the budgeted gap search");
  assert.ok(!sweep.includes("unionAllGeoms(partials)"), "no unbounded union of every chunk result is left");
  assert.ok(sweep.includes("maxPairVertices: BORDER_CLEANUP.maxUnionVertices"), "overlap pairs are budgeted");
  assert.ok(sweep.includes("maxTargetVertices: BORDER_CLEANUP.maxUnionVertices"), "gap targets are budgeted");
  assert.ok(sweep.includes("parts,") && sweep.includes("skippedPairs,"), "the result says what a detailed map could only be checked as");
  // Time: the search stops on the budget or on "Save now", a follow-up pass
  // looks only around the last repairs, cracks are filled per target in one
  // union, and an error keeps the repairs already made.
  assert.ok(sweep.includes("stopRequested?.()") && sweep.includes("BORDER_CLEANUP.maxMillis"), "the search stops on request and on the budget");
  assert.ok(sweep.includes("shouldStop,") && sweep.includes("partial: local,"), "the gap search is told to stop and that it reads a part");
  assert.ok(sweep.includes("hotspotsOf(applied, width * BORDER_CLEANUP.hotspotPad)") && sweep.includes("touchesHotspot(hole.geom.getExtent(), hotspots)"), "follow-up passes are local");
  assert.ok(sweep.includes("fillGaps(targetId, items, edit.remember)") && sweep.includes("BORDER_CLEANUP.maxApplyMillis"), "fills are batched per target and the apply has its own cap");
  assert.ok(sweep.includes("stopped = \"error\";") && sweep.includes("finishTopologyEdit(edit)"), "an error ends the search but keeps and finishes the edit");
  const mapEditor = fs.readFileSync(new URL("./MapEditor.jsx", import.meta.url), "utf8");
  assert.ok(mapEditor.includes("stopRequested: () => cleanupStopRef.current") && mapEditor.includes("<BorderCleanupOverlay state={borderCleanup} onStop="), "the loading screen's Save now reaches the sweep");
});

// Time. A map with one 41,000-vertex sea zone held the old sweep for tens of
// minutes: every region was checked against the whole coastline, then all of
// it twice more, with no limit at all. Now the search stops at
// BORDER_CLEANUP.maxMillis or on "Save now", a follow-up pass looks only
// around the last pass's repairs, and the note says what happened.
test("the budget and the hotspot padding are sane", () => {
  assert.ok(BORDER_CLEANUP.maxMillis >= 30_000 && BORDER_CLEANUP.maxMillis <= 120_000, "a save waits well under two minutes for the search");
  assert.ok(BORDER_CLEANUP.maxApplyMillis > BORDER_CLEANUP.maxMillis, "what was found is applied past the search's own budget");
  assert.ok(BORDER_CLEANUP.hotspotPad >= 1);
});

test("a stop ends the gap search at the next union with no holes at all, and stops the merging too", async () => {
  const options = {
    plan: planTopologyChunks([0, 0, 4000, 4000], grid.length, { targetRegionsPerChunk: 4 }),
    geometryOf: (region) => region.geom,
    gapsOf: enclosedGapsOfUnion,
    between: noWait,
  };
  let calls = 0;
  const union = (geoms) => {
    calls += 1;
    return unionAllGeoms(geoms);
  };
  const stoppedEarly = await findEnclosedGaps(grid, { ...options, union, shouldStop: () => calls >= 2 });
  assert.equal(stoppedEarly.stopped, true);
  assert.deepEqual(stoppedEarly.holes, [], "the holes of a partial union are not trusted");
  assert.equal(calls, 2, "no union after the stop");
  calls = 0;
  const never = await findEnclosedGaps(grid, { ...options, union, shouldStop: () => false });
  assert.equal(never.stopped, false);
  assert.equal(never.holes.length, 1);
  const stopMerge = await mergeWithinBudget(grid.map((region) => region.geom), { union, budget: 12, between: noWait, shouldStop: () => true });
  assert.equal(stopMerge.length, grid.length, "nothing is merged once told to stop");
});

test("a follow-up pass reads a part of the map: a hole under another region is dropped even in one piece", async () => {
  const host = new Polygon([
    [[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0]],
    [[400, 200], [400, 800], [440, 800], [440, 200], [400, 200]],
  ]);
  const enclave = new Polygon([[[400, 200], [440, 200], [440, 800], [400, 800], [400, 200]]]);
  const options = {
    plan: null,
    geometryOf: (region) => region.geom,
    union: unionAllGeoms,
    gapsOf: enclosedGapsOfUnion,
    isCovered: (point) => enclave.intersectsCoordinate(point),
    between: noWait,
  };
  const whole = await findEnclosedGaps([{ geom: host }], options);
  assert.equal(whole.holes.length, 1, "read as the whole map in one piece, the slot is a crack: the check is not asked");
  const part = await findEnclosedGaps([{ geom: host }], { ...options, partial: true });
  assert.equal(part.holes.length, 0, "read as a part, the slot is under the enclave's region");
});

test("hotspots are the padded footprints of the repairs, and only what reaches one is looked at again", () => {
  const spots = hotspotsOf([{ geom: square(1, 1) }, { geom: square(3, 3) }], 100);
  assert.deepEqual(spots, [[900, 900, 2100, 2100], [2900, 2900, 4100, 4100]]);
  assert.ok(touchesHotspot(square(2, 1).getExtent(), spots), "the neighbour across the padding is looked at");
  assert.ok(!touchesHotspot(square(3, 0).getExtent(), spots), "a region 900 m from both is not");
  assert.ok(!touchesHotspot([5000, 5000, 6000, 6000], spots));
  assert.deepEqual(hotspotsOf([], 5), []);
});

test("the note says when the sweep stopped and why, and what it left for the next save", () => {
  const base = { changed: true, gaps: 3, overlaps: 1, affectedRegions: 4, passes: 1, elapsedMs: 60_400 };
  assert.equal(
    describeCleanupResult({ ...base, stopped: "time" }),
    "Borders partly cleaned: 3 cracks filled and 1 sliver trimmed across 4 regions; the check stopped after 60 s because the map is too detailed to check fully within one save.",
  );
  assert.equal(
    describeCleanupResult({ ...base, stopped: "user", elapsedMs: 12_000, repairsLeft: 7 }),
    "Borders partly cleaned: 3 cracks filled and 1 sliver trimmed across 4 regions; the check stopped after 12 s at your request. 7 repairs it had found were left for the next save.",
  );
  assert.equal(
    describeCleanupResult({ changed: false, regionCount: 9, stopped: "time", elapsedMs: 61_000 }),
    "Border cleanup stopped after 61 s because the map is too detailed to check fully within one save; nothing was changed.",
  );
  assert.equal(
    describeCleanupResult({ changed: false, regionCount: 9, stopped: "error", error: "Unable to find segment", elapsedMs: 3_000 }),
    "Border cleanup stopped after 3 s (Unable to find segment); nothing was changed.",
  );
  assert.equal(
    describeCleanupResult({ ...base, passes: 2, stopped: "", parts: 2 }),
    "Borders cleaned in 2 passes: 3 cracks filled and 1 sliver trimmed across 4 regions. The map is too detailed to check in one piece, so it was checked in 2 parts.",
  );
});

test("the loading screen says when a pass walks only the regions around the last repairs", () => {
  const local = describeCleanupProgress({ phase: "overlaps", pass: 2, maxPasses: 3, regionCount: 4848, passRegions: 231, regionsChecked: 100, overlapsFound: 0, gapsFound: 2 });
  assert.match(local.detail, /^100 of 231 regions around the last repairs checked/);
  assert.ok(local.fraction > 0.4 && local.fraction < 0.5, "the bar follows the pass's own walk");
  const gaps = describeCleanupProgress({ phase: "gaps", pass: 2, regionCount: 4848, passRegions: 231, chunkIndex: 0, chunkCount: 1 });
  assert.match(gaps.detail, /^231 regions around the last repairs · merging chunk 1 of 1/);
  const whole = describeCleanupProgress({ phase: "overlaps", pass: 1, regionCount: 4848, passRegions: 4848, regionsChecked: 200 });
  assert.match(whole.detail, /^200 of 4,848 regions checked/);
});

test("the note after a save says when a map was too detailed to check in one piece", () => {
  const base = { changed: true, gaps: 3, overlaps: 1, affectedRegions: 4, passes: 1 };
  assert.equal(describeCleanupResult({ ...base, parts: 1, skippedPairs: 0 }), "Borders cleaned: 3 cracks filled and 1 sliver trimmed across 4 regions.");
  assert.equal(
    describeCleanupResult({ ...base, parts: 3, skippedPairs: 0 }),
    "Borders cleaned: 3 cracks filled and 1 sliver trimmed across 4 regions. The map is too detailed to check in one piece, so it was checked in 3 parts.",
  );
  assert.equal(
    describeCleanupResult({ changed: false, regionCount: 12, parts: 1, skippedPairs: 1 }),
    `Borders checked: no cracks or slivers between ${BORDER_CLEANUP.minWidth} m and ${BORDER_CLEANUP.maxWidth} m across 12 regions. 1 pair of very large neighbouring regions was not compared.`,
  );
  assert.ok(describeCleanupResult({ ...base, skippedPairs: 4 }).endsWith(" 4 pairs of very large neighbouring regions were not compared."));
});
