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
import MultiPolygon from "ol/geom/MultiPolygon.js";
import Polygon from "ol/geom/Polygon.js";
import VectorSource from "ol/source/Vector.js";

import { extractFromSource } from "../../scripts/i18n/extractStrings.mjs";
import { createPhraseBook } from "../runtime/phraseBook.js";
import { enclosedGapGeoms, enclosedGapsOfUnion, overlapGeoms, planarGeometryArea, unionAllGeoms } from "./geometry.js";
import {
  BORDER_CLEANUP,
  CLEANUP_LEFT_ALONE_TEXTS,
  bucketRegions,
  chunkIndexFor,
  cracksAmong,
  describeCleanupLeftAlone,
  describeCleanupProgress,
  describeCleanupResult,
  findEnclosedGaps,
  holdsRim,
  hotspotsOf,
  indexBoundary,
  isSliver,
  leftAloneTally,
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
  const direct = enclosedGapGeoms(grid.map((region) => region.geom), { maxWidth: BORDER_CLEANUP.maxWidth });
  assert.equal(direct.length, 1);
  assert.ok(direct[0].width > 19 && direct[0].width < 21, `the crack is ~20 m wide, got ${direct[0].width}`);

  const plan = planTopologyChunks([0, 0, 4000, 4000], grid.length, { targetRegionsPerChunk: 4 });
  const buckets = bucketRegions(plan, grid, (region) => region.geom.getExtent());
  const partials = buckets.map((bucket) => unionAllGeoms(bucket.map((region) => region.geom)));
  for (const partial of partials) {
    assert.equal(enclosedGapsOfUnion(partial, { maxWidth: BORDER_CLEANUP.maxWidth }).length, 0, "no chunk on its own encloses the crack");
  }
  const staged = enclosedGapsOfUnion(unionAllGeoms(partials), { maxWidth: BORDER_CLEANUP.maxWidth });
  assert.deepEqual(staged.map(key), direct.map(key), "the union of the chunk unions has the same holes as one union of everything");
  assert.equal(enclosedGapsOfUnion(null).length, 0);
});

test("overlaps are a pairwise check that does not depend on chunks", () => {
  const a = grid.find((region) => region.id === "1,2").geom;
  const b = grid.find((region) => region.id === "2,2").geom;
  const pieces = overlapGeoms(a, b, { maxWidth: BORDER_CLEANUP.maxWidth });
  assert.equal(pieces.length, 1);
  assert.ok(pieces[0].width > 28 && pieces[0].width < 31, `the sliver is ~30 m wide, got ${pieces[0].width}`);
  assert.equal(overlapGeoms(a, b, { maxWidth: 10 }).length, 0, "wider than the tolerance is left alone");
  assert.equal(overlapGeoms(a, b, { maxWidth: BORDER_CLEANUP.maxWidth, minWidth: 31 }).length, 0, "narrower than the floor is left alone");
  assert.equal(overlapGeoms(a, b, { maxWidth: BORDER_CLEANUP.maxWidth, minWidth: 2 }).length, 1, "the sweep's 2 m floor keeps a real sliver");
});

test("the save-time floor ignores cracks too narrow to be anything but rounding noise", () => {
  const geoms = grid.map((region) => region.geom);
  assert.equal(enclosedGapGeoms(geoms, { maxWidth: BORDER_CLEANUP.maxWidth, minWidth: 25 }).length, 0, "a 20 m crack is below a 25 m floor");
  assert.equal(enclosedGapGeoms(geoms, { maxWidth: BORDER_CLEANUP.maxWidth, minWidth: BORDER_CLEANUP.minWidth }).length, 1, "and above the sweep's 2 m floor");
  assert.ok(BORDER_CLEANUP.minWidth >= 1 && BORDER_CLEANUP.minWidth < 10, "the floor is about the size of the save's coordinate rounding");
});

// The width. A defect is as wide as twice its area over its perimeter: its
// real width when it is long and thin, half its diameter when it is round.
// Two 30 km blocks with a slot between them, closed at both ends by a cap, is
// the crack between regions the sweep is for; a pond in one block is a hole
// just as wide that is not a crack. The width cannot tell them apart; the
// regions on the rim can (the next test).
const slotBetweenBlocks = (slot) => [
  new Polygon([[[0, 0], [10000, 0], [10000, 30000], [0, 30000], [0, 0]]]),
  new Polygon([[[10000 + slot, 0], [30000, 0], [30000, 30000], [10000 + slot, 30000], [10000 + slot, 0]]]),
  new Polygon([[[10000, 0], [10000 + slot, 0], [10000 + slot, 5000], [10000, 5000], [10000, 0]]]),
  new Polygon([[[10000, 25000], [10000 + slot, 25000], [10000 + slot, 30000], [10000, 30000], [10000, 25000]]]),
];
const blockWithPond = (side) => [new Polygon([
  [[0, 0], [30000, 0], [30000, 30000], [0, 30000], [0, 0]],
  [[5000, 5000], [5000, 5000 + side], [5000 + side, 5000 + side], [5000 + side, 5000], [5000, 5000]],
])];

test("the sweep repairs cracks and slivers up to 1.5 km wide, and what that takes with it", () => {
  assert.equal(BORDER_CLEANUP.maxWidth, 1500, "1.5 km, in metres of the map projection");
  const sweep = { maxWidth: BORDER_CLEANUP.maxWidth, minWidth: BORDER_CLEANUP.minWidth };
  const crack = enclosedGapGeoms(slotBetweenBlocks(1200), sweep);
  assert.equal(crack.length, 1, "a 1.2 km crack between two regions is filled");
  assert.ok(crack[0].width > 1100 && crack[0].width < 1200, `20 km long, it measures nearly its real width, got ${crack[0].width}`);
  assert.equal(enclosedGapGeoms(slotBetweenBlocks(1200), { ...sweep, maxWidth: 500 }).length, 0, "which the old 500 m limit left open");
  assert.equal(enclosedGapGeoms(slotBetweenBlocks(1700), sweep).length, 0, "a 1.7 km one is not a crack any more");
  // Round holes count as half as wide as they are across.
  assert.equal(enclosedGapGeoms(blockWithPond(8000), sweep).length, 0, "a lake 8 km across is too wide, whatever is round it");
  assert.equal(enclosedGapGeoms(blockWithPond(2000), sweep).length, 1, "a pond 2 km across counts as 1 km wide: narrow enough, and spared only by its rim");
  assert.equal(enclosedGapGeoms(blockWithPond(2000), { ...sweep, maxWidth: 500 }).length, 0, "the old limit did not reach it");
  // The same for overlaps: one block reaching 1.2 km into the other.
  const [west, east] = slotBetweenBlocks(-1200);
  const sliver = overlapGeoms(west, east, sweep);
  assert.equal(sliver.length, 1, "a 1.2 km overlap is trimmed");
  assert.equal(overlapGeoms(west, east, { ...sweep, maxWidth: 500 }).length, 0);
  // With no width given, geometry.js looks as far as the sweep does.
  assert.equal(enclosedGapGeoms(slotBetweenBlocks(1200)).length, 1);
  assert.equal(enclosedGapGeoms(slotBetweenBlocks(1700)).length, 0);
  assert.equal(overlapGeoms(west, east).length, 1);
});

// The two guards that keep 1.5 km to cracks between regions. On a map cut from
// the stock world the wider limit alone filled narrow inlets and lagoons that
// one region surrounds (Randers Fjord, Laguna Madre, Santa Rosa Sound) and
// trimmed away most of regions a few square kilometres across (Montegiardino
// in San Marino kept 0.1 of its 1.3 km²).
//
// A region's boundary segments around a point, the slow way: the Workshop
// reads them from the region's index (indexBoundary, tested below).
const boundaryNear = (geom) => {
  const segments = [];
  const polys = geom.getType() === "Polygon" ? [geom.getCoordinates()] : geom.getCoordinates();
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 1; i < ring.length; i += 1) segments.push([ring[i - 1], ring[i]]);
    }
  }
  return ([x, y], reach) => segments.filter(([a, b]) => (
    Math.min(a[0], b[0]) <= x + reach && Math.max(a[0], b[0]) >= x - reach
    && Math.min(a[1], b[1]) <= y + reach && Math.max(a[1], b[1]) >= y - reach
  ));
};
const rimRegionsAmong = (geoms) => (hole) => geoms.filter((geom) => holdsRim(hole.geom.getCoordinates()[0], boundaryNear(geom))).length;

test("a hole one region surrounds keeps the old 500 m limit; the same width between two regions is a crack, and is filled", () => {
  assert.equal(BORDER_CLEANUP.maxWidthInsideOneRegion, 500);
  const sweep = { maxWidth: BORDER_CLEANUP.maxWidth, minWidth: BORDER_CLEANUP.minWidth };
  // A pond 2 km across in one block and a slot 1 km wide between two: each
  // measures about 1 km.
  const pond = blockWithPond(2000);
  const pondHoles = enclosedGapGeoms(pond, sweep);
  assert.equal(pondHoles.length, 1);
  assert.equal(rimRegionsAmong(pond)(pondHoles[0]), 1);
  assert.deepEqual(cracksAmong(pondHoles, rimRegionsAmong(pond)), [], "one region all the way round: its own water, left alone");
  const slot = slotBetweenBlocks(1000);
  const slotHoles = enclosedGapGeoms(slot, sweep);
  assert.ok(slotHoles[0].width > 900 && slotHoles[0].width < 1000, `the slot measures ${slotHoles[0].width}`);
  assert.equal(rimRegionsAmong(slot)(slotHoles[0]), 4, "both blocks and both caps hold an edge of it");
  assert.equal(cracksAmong(slotHoles, rimRegionsAmong(slot)).length, 1, "between regions: a crack, filled");
  // Up to the old limit a lone hole is filled as it always was, and its rim is
  // not even looked at.
  const puddle = enclosedGapGeoms(blockWithPond(600), sweep);
  assert.equal(puddle.length, 1);
  assert.equal(cracksAmong(puddle, () => assert.fail("a hole this narrow needs no rim count")).length, 1);

  // The pond is the one hole of the three the guard passes over, and it says
  // so: the note after the save counts what it hears of.
  const leftAlone = [];
  const onLeftAlone = (hole) => leftAlone.push(hole);
  cracksAmong(pondHoles, rimRegionsAmong(pond), { onLeftAlone });
  cracksAmong(slotHoles, rimRegionsAmong(slot), { onLeftAlone });
  cracksAmong(puddle, rimRegionsAmong(blockWithPond(600)), { onLeftAlone });
  assert.deepEqual(leftAlone, [pondHoles[0]]);

  // A corner is not a rim. A wedge between two regions, closed along its base
  // by a third, comes to a point on the border of a fourth: three hold an
  // edge of it, the fourth only that point.
  const wedgeWest = new Polygon([[[-10000, 0], [0, 0], [-500, 10000], [-10000, 10000], [-10000, 0]]]);
  const wedgeEast = new Polygon([[[0, 0], [10000, 0], [10000, 10000], [500, 10000], [0, 0]]]);
  const base = new Polygon([[[-10000, 10000], [10000, 10000], [10000, 12000], [-10000, 12000], [-10000, 10000]]]);
  const atThePoint = new Polygon([[[-10000, -2000], [10000, -2000], [10000, 0], [-10000, 0], [-10000, -2000]]]);
  const wedges = enclosedGapGeoms([wedgeWest, wedgeEast, base, atThePoint], sweep);
  assert.equal(wedges.length, 1);
  const ring = wedges[0].geom.getCoordinates()[0];
  assert.deepEqual([wedgeWest, wedgeEast, base, atThePoint].map((geom) => holdsRim(ring, boundaryNear(geom))), [true, true, true, false]);

  // The Workshop asks exactly this of every hole a search finds, and the
  // save-time sweep keeps count of the ones passed over.
  const olMap = fs.readFileSync(new URL("./OlMap.jsx", import.meta.url), "utf8");
  assert.ok(olMap.includes("for (const row of cracksAmong(holes, rimRegionsOf, { maxWidth: width, onLeftAlone })) {"));
  assert.ok(olMap.includes("maxTargetVertices: BORDER_CLEANUP.maxUnionVertices, onLeftAlone: leftAlone.hole });"));
});

test("a pair that shares more than a tenth of the smaller region is left alone; one that shares less is a sliver, and trimmed", () => {
  assert.equal(BORDER_CLEANUP.maxSliverShare, 0.1);
  const sweep = { maxWidth: BORDER_CLEANUP.maxWidth, minWidth: BORDER_CLEANUP.minWidth };
  const large = new Polygon([[[-90000, 0], [10000, 0], [10000, 30000], [-90000, 30000], [-90000, 0]]]);
  // A neighbour reaching 1 km into it along 30 km: the same 30 km² piece,
  // 968 m wide by the sweep's measure, whatever the neighbour's own size.
  const reachingIn = (width) => new Polygon([[[9000, 0], [9000 + width, 0], [9000 + width, 30000], [9000, 30000], [9000, 0]]]);
  const shareOf = (region) => {
    const pieces = overlapGeoms(large, region, sweep);
    assert.equal(pieces.length, 1);
    assert.ok(pieces[0].width > 960 && pieces[0].width < 975);
    assert.equal(Math.round(pieces[0].shared), 30e6);
    return isSliver(pieces[0].shared, Math.min(planarGeometryArea(large), planarGeometryArea(region)));
  };
  assert.equal(shareOf(reachingIn(4000)), false, "a quarter of a 120 km² region: not a sliver, left alone");
  assert.equal(shareOf(reachingIn(15000)), true, "a fifteenth of a 450 km² one: a sliver, trimmed");
  assert.equal(isSliver(10, 100), true, "a tenth exactly is still a sliver");
  assert.equal(isSliver(10.5, 100), false);
  assert.equal(isSliver(0, 0), true);
  assert.equal(isSliver(1, 0), false, "nothing is small beside nothing");

  // `shared` is all the two share, because a trim takes all of it: a thin
  // strip (5 km²) beside a lobe too wide to be a piece (50 km²).
  const strip = [[[9500, 0], [12000, 0], [12000, 10000], [9500, 10000], [9500, 0]]];
  const lobe = [[[5000, 15000], [12000, 15000], [12000, 25000], [5000, 25000], [5000, 15000]]];
  const both = new MultiPolygon([strip, lobe]);
  const narrow = overlapGeoms(large, both, sweep);
  assert.equal(narrow.length, 1, "only the strip is narrow enough to be a piece");
  assert.equal(Math.round(narrow[0].area), 5e6);
  assert.equal(Math.round(narrow[0].shared), 55e6);
  assert.equal(isSliver(narrow[0].area, planarGeometryArea(both)), true, "the strip alone is a twentieth of the region");
  assert.equal(isSliver(narrow[0].shared, planarGeometryArea(both)), false, "all they share is over half of it");

  // The Workshop asks exactly this of every pair before it trims one, and the
  // save-time sweep keeps count of the pairs passed over.
  const olMap = fs.readFileSync(new URL("./OlMap.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(olMap, /if \(!isSliver\(pieces\[0\]\.shared, Math\.min\(aArea, bArea\)\)\) \{\n\s+onLeftAlone\?\.\(a, b\);\n\s+continue;\n\s+\}/);
  assert.ok(olMap.includes("onLeftAlone: (a, b) => leftAlone.pair(a.getId(), b.getId()),"));
});

// The sweep makes up to three passes, and a follow-up pass reads the regions
// around the last pass's repairs again: on the European cut of the stock
// world its second save met two of the 34 pairs twice. The note counts what
// was left alone, not how often it was looked at.
test("what the guards left alone is counted once, however many passes meet it", () => {
  const sweep = { maxWidth: BORDER_CLEANUP.maxWidth, minWidth: BORDER_CLEANUP.minWidth };
  const tally = leftAloneTally();
  assert.deepEqual(tally.counts(), { holesLeftAlone: 0, pairsLeftAlone: 0 });
  const [pond] = enclosedGapGeoms(blockWithPond(2000), sweep);
  const [lagoon] = enclosedGapGeoms(blockWithPond(2400), sweep);
  tally.hole(pond);
  tally.hole(lagoon);
  // The pond again on a follow-up pass, read from another union of its
  // region: the same place, to the metre.
  const [again] = enclosedGapGeoms(blockWithPond(2000), sweep);
  again.geom.translate(0.2, -0.3);
  tally.hole(again);
  tally.pair("reg_a", "reg_b");
  tally.pair("reg_b", "reg_a"); // the follow-up pass walks the changed region first
  tally.pair("reg_a", "reg_c");
  assert.deepEqual(tally.counts(), { holesLeftAlone: 2, pairsLeftAlone: 2 });
  // A pair that a later pass does trim was not left alone.
  tally.trimmed("reg_c", "reg_a");
  tally.trimmed("reg_x", "reg_y");
  assert.deepEqual(tally.counts(), { holesLeftAlone: 2, pairsLeftAlone: 1 });

  // The sweep keeps one tally over all its passes and hands the counts back.
  const olMap = fs.readFileSync(new URL("./OlMap.jsx", import.meta.url), "utf8");
  const run = olMap.slice(olMap.indexOf("const repairTopologyEverywhere = async"), olMap.indexOf("const summarize = (f) =>"));
  assert.ok(run.indexOf("const leftAlone = leftAloneTally();") < run.indexOf("while (passes < BORDER_CLEANUP.maxPasses"), "made before the first pass");
  assert.ok(run.includes("...leftAlone.counts(),"), "in the result");
  assert.ok(run.includes("leftAlone.trimmed(item.winnerId, item.loserId);"), "told of every trim");
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
  assert.equal(describeCleanupProgress({ phase: "save", exporting: true, result: null }).headline, "exporting the map", "the standalone editor has no scenario to save into");
  assert.equal(save.detail, "Borders cleaned in 2 passes: 12 cracks filled and 41 slivers trimmed across 48 regions.");
  assert.ok(gaps.fraction < merging.fraction && merging.fraction <= overlaps.fraction && overlaps.fraction < apply.fraction && apply.fraction < save.fraction);
  assert.ok(describeCleanupProgress({ phase: "gaps", regionCount: 10, chunkIndex: 0, chunkCount: 0 }).fraction >= 0);
  assert.equal(describeCleanupProgress(null).fraction, 0);
  assert.equal(describeCleanupProgress({ phase: "apply", repairCount: 0 }).headline, "nothing to repair");
});

test("the note after a save says what changed, that nothing did, or that the cleanup was skipped", () => {
  assert.equal(
    describeCleanupResult({ changed: false, regionCount: 4848 }),
    "Borders checked: no cracks or slivers between 2 m and 1.5 km across 4,848 regions.",
  );
  assert.equal(describeCleanupResult({ changed: true, gaps: 1, overlaps: 2, affectedRegions: 3, passes: 1 }), "Borders cleaned: 1 crack filled and 2 slivers trimmed across 3 regions.");
  // The built-in map's own first save.
  assert.equal(describeCleanupResult({ changed: true, gaps: 106, overlaps: 59, affectedRegions: 152, passes: 2 }), "Borders cleaned in 2 passes: 106 cracks filled and 59 slivers trimmed across 152 regions.");
  assert.match(describeCleanupResult(null, "boom"), /^Border cleanup was skipped \(boom\); the map was saved as it is\.$/);
  assert.equal(describeCleanupResult(null), "");
});

// What the two guards passed over. Nothing said it, so a lagoon the cleanup
// left open on purpose looked like a crack it had missed, and a small region
// still lying over its neighbour like a sliver it had missed.
test("the note says what the two guards left alone, a line each, and nothing when they left nothing", () => {
  const base = { changed: true, gaps: 4071, overlaps: 5220, affectedRegions: 880, passes: 2 };
  // The European cut of the stock world: 32 holes and 34 pairs.
  assert.deepEqual(describeCleanupLeftAlone({ ...base, holesLeftAlone: 32, pairsLeftAlone: 34 }), [
    "32 gaps, each inside a single region, were left open: they are treated as enclosed water, not cracks.",
    "34 pairs of overlapping regions were left as they are: trimming would take too much of the smaller region.",
  ]);
  assert.deepEqual(describeCleanupLeftAlone({ ...base, holesLeftAlone: 1, pairsLeftAlone: 1 }), [
    "1 gap inside a single region was left open: it is treated as enclosed water, not a crack.",
    "1 pair of overlapping regions was left as it is: trimming would take too much of the smaller region.",
  ]);
  assert.deepEqual(describeCleanupLeftAlone({ ...base, holesLeftAlone: 0, pairsLeftAlone: 2 }), [
    "2 pairs of overlapping regions were left as they are: trimming would take too much of the smaller region.",
  ]);
  assert.deepEqual(describeCleanupLeftAlone({ ...base, holesLeftAlone: 1234 }), [
    "1,234 gaps, each inside a single region, were left open: they are treated as enclosed water, not cracks.",
  ]);
  // The built-in map: the guards pass over nothing on it, and the note is the
  // one line it always was.
  assert.deepEqual(describeCleanupLeftAlone({ changed: true, gaps: 106, overlaps: 59, affectedRegions: 152, passes: 2, holesLeftAlone: 0, pairsLeftAlone: 0 }), []);
  assert.deepEqual(describeCleanupLeftAlone({ changed: false, regionCount: 9 }), [], "a result from before the counts says nothing");
  assert.deepEqual(describeCleanupLeftAlone(null), [], "nor does a cleanup that was skipped");
  // A save that repaired nothing still says what it left: the cut's third save.
  assert.equal(describeCleanupResult({ changed: false, regionCount: 940, holesLeftAlone: 32, pairsLeftAlone: 34 }), "Borders checked: no cracks or slivers between 2 m and 1.5 km across 940 regions.");
  assert.equal(describeCleanupLeftAlone({ changed: false, regionCount: 940, holesLeftAlone: 32, pairsLeftAlone: 34 }).length, 2);

  // The loading screen shows the same lines under the result while the map is
  // written, which is all a Save & Exit or an Apply & Play ever shows of it.
  const save = describeCleanupProgress({ phase: "save", result: { ...base, holesLeftAlone: 32, pairsLeftAlone: 0 } });
  assert.equal(save.detail, "Borders cleaned in 2 passes: 4,071 cracks filled and 5,220 slivers trimmed across 880 regions.");
  assert.deepEqual(save.leftAlone, ["32 gaps, each inside a single region, were left open: they are treated as enclosed water, not cracks."]);
  assert.deepEqual(describeCleanupProgress({ phase: "save", result: base }).leftAlone, []);
  assert.deepEqual(describeCleanupProgress({ phase: "save", result: null, error: "boom" }).leftAlone, []);

  // The Workshop's note is the result and then these lines.
  const mapEditor = fs.readFileSync(new URL("./MapEditor.jsx", import.meta.url), "utf8");
  assert.ok(mapEditor.includes("[describeCleanupResult(cleanup, cleanupError), ...describeCleanupLeftAlone(cleanup)].filter(Boolean)"));
  assert.ok(mapEditor.includes("<BorderCleanupNote lines={cleanupNote}"));
});

// The lines reach the player through the language packs: the extractor reads
// the table, each sentence whole, and the translator finds a line on screen by
// its sentence, whatever the count in it.
test("every sentence about what was left alone reaches the language packs whole", () => {
  const file = "src/Editor/topologySweep.js";
  const { exact, patterns } = extractFromSource(fs.readFileSync(new URL("./topologySweep.js", import.meta.url), "utf8"), file, { jsx: false, catchAll: false });
  const found = new Set([...exact.keys(), ...patterns.keys()]);
  for (const [key, text] of Object.entries(CLEANUP_LEFT_ALONE_TEXTS)) {
    assert.ok(found.has(text), `${key} is read by the extractor`);
    assert.match(text, /\.$/, `${key} is a sentence`);
  }
  assert.ok(found.has("exporting the map") && found.has("saving the map into the scenario"), "and both things the screen says while the map is written");

  const book = createPhraseBook();
  book.setAll({
    [CLEANUP_LEFT_ALONE_TEXTS.holeOne]: "1 Lücke innerhalb einer einzelnen Region blieb offen: Sie gilt als eingeschlossenes Wasser, nicht als Riss.",
    [CLEANUP_LEFT_ALONE_TEXTS.holeMany]: "{{count}} Lücken, jede innerhalb einer einzelnen Region, blieben offen: Sie gelten als eingeschlossenes Wasser, nicht als Risse.",
    [CLEANUP_LEFT_ALONE_TEXTS.pairMany]: "{{count}} Paare überlappender Regionen blieben, wie sie sind: Ein Beschnitt nähme der kleineren Region zu viel.",
  });
  const [holes, pairs] = describeCleanupLeftAlone({ holesLeftAlone: 1234, pairsLeftAlone: 34 });
  assert.equal(book.translate(holes), "1,234 Lücken, jede innerhalb einer einzelnen Region, blieben offen: Sie gelten als eingeschlossenes Wasser, nicht als Risse.");
  assert.equal(book.translate(pairs), "34 Paare überlappender Regionen blieben, wie sie sind: Ein Beschnitt nähme der kleineren Region zu viel.");
  assert.equal(book.translate(describeCleanupLeftAlone({ holesLeftAlone: 1 })[0]), "1 Lücke innerhalb einer einzelnen Region blieb offen: Sie gilt als eingeschlossenes Wasser, nicht als Riss.");

  // Each line is an element of its own on both surfaces, or the translator
  // would be handed the lines run together and know none of them.
  const overlay = fs.readFileSync(new URL("./BorderCleanupOverlay.jsx", import.meta.url), "utf8");
  assert.ok(overlay.includes("<div key={line}>{line}</div>"), "the note after the save");
  assert.match(overlay, /\{leftAlone\.map\(\(line\) => \(\s+<div key=\{line\}[^>]*>\s+\{line\}\s+<\/div>/, "the loading screen");
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
  assert.deepEqual(enclosedGapsOfUnion(one[0], { maxWidth: BORDER_CLEANUP.maxWidth }).map(key), enclosedGapGeoms(geoms, { maxWidth: BORDER_CLEANUP.maxWidth }).map(key));

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
    maxWidth: BORDER_CLEANUP.maxWidth,
    minWidth: 0,
    between: noWait,
  };
  const direct = enclosedGapGeoms(grid.map((region) => region.geom), { maxWidth: BORDER_CLEANUP.maxWidth }).map(key);
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

// The built-in map, and one union of all of it built the way the sweep first
// built it: a union per chunk, then one union of the chunk results. Made once,
// for the two tests that read it.
let builtIn = null;
const builtInMap = () => {
  if (!builtIn) {
    const text = fs.readFileSync(new URL("../../server/seed/default/regions.geojson", import.meta.url), "utf8");
    const features = new GeoJSON().readFeatures(JSON.parse(text), { featureProjection: "EPSG:3857" }).filter((f) => f.getGeometry());
    const source = new VectorSource({ features });
    const plan = planTopologyChunks(source.getExtent(), features.length);
    const partials = bucketRegions(plan, features, (f) => f.getGeometry().getExtent())
      .map((bucket) => unionAllGeoms(bucket.map((f) => f.getGeometry())))
      .filter(Boolean);
    builtIn = { features, source, plan, whole: unionAllGeoms(partials) };
  }
  return builtIn;
};

test("the built-in map: exactly the gaps the one-union sweep found, and within a small budget nothing false and no call over it", async () => {
  const { features, source, plan, whole } = builtInMap();
  const tolerances = { maxWidth: BORDER_CLEANUP.maxWidth, minWidth: BORDER_CLEANUP.minWidth };
  const before = enclosedGapsOfUnion(whole, tolerances).map(key);
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

// What 1.5 km takes on the built-in map, and what it must leave alone. The
// limit was 500 m, which left eight cracks behind, 501 to 977 m: each a
// triangle where two or three regions of one country had the border they share
// simplified differently (358 km of the Wyoming–Montana line, nowhere wider
// than 900 m, is the longest). Above them the map has nothing until 4,402 m
// (one more triangle, between Kamchatka and Magadan), and the narrowest water
// it leaves as a hole, the lower Uruguay river, measures 7,031 m; no two
// regions overlap by more than 930 m (East and West Antarctica). So the limit
// sits in an empty band. A revision of the map that puts a lake or an enclave
// inside it shows here, before a save fills it in.
test("the built-in map at 1.5 km: the cracks 500 m left behind are filled, and no water or region is within reach", () => {
  const { features, source, whole } = builtInMap();
  const { maxWidth, minWidth } = BORDER_CLEANUP;
  const holes = enclosedGapsOfUnion(whole, { maxWidth: Infinity, minWidth });
  const filled = holes.filter((hole) => hole.width <= maxWidth);
  const left = holes.filter((hole) => hole.width > maxWidth);
  const beyondOldLimit = filled.filter((hole) => hole.width > 500);
  assert.equal(beyondOldLimit.length, 8, "eight cracks between 500 m and 1.5 km");
  for (const hole of beyondOldLimit) {
    assert.equal(vertexCountOf(hole.geom), 4, `a ${Math.round(hole.width)} m crack is a triangle, not a shoreline`);
  }
  const widestFilled = Math.max(...filled.map((hole) => hole.width));
  const narrowestLeft = Math.min(...left.map((hole) => hole.width));
  assert.ok(widestFilled < 1000, `the widest crack filled is ${Math.round(widestFilled)} m`);
  assert.ok(narrowestLeft > 4000, `the narrowest hole left alone is ${Math.round(narrowestLeft)} m`);
  const water = left.filter((hole) => vertexCountOf(hole.geom) > 4);
  assert.ok(water.length >= 10, "the lakes, lagoons and the Caspian are holes, and stay");
  assert.ok(Math.min(...water.map((hole) => hole.width)) > 7000, "the narrowest of them is over 7 km");

  // The guard on holes leaves every one of them a crack: each has two or more
  // regions on its rim (the save fills the same 106 with it as without).
  const rimRegionsOf = (hole) => source.getFeaturesInExtent(hole.geom.getExtent())
    .filter((feature) => holdsRim(hole.geom.getCoordinates()[0], boundaryNear(feature.getGeometry()))).length;
  for (const hole of filled) assert.ok(rimRegionsOf(hole) > 1, `a ${Math.round(hole.width)} m crack lies between regions`);
  assert.equal(cracksAmong(filled, rimRegionsOf).length, filled.length, "none is left alone as one region's water");

  // The overlaps: every piece two neighbouring regions share, however wide.
  const order = new Map(features.map((feature, index) => [feature, index]));
  const pieces = [];
  let largestShare = 0;
  for (let i = 0; i < features.length; i += 1) {
    const geom = features[i].getGeometry();
    for (const other of source.getFeaturesInExtent(geom.getExtent())) {
      if (!(order.get(other) > i)) continue;
      const shared = overlapGeoms(geom, other.getGeometry(), { maxWidth: Infinity, minWidth });
      if (!shared.length) continue;
      pieces.push(...shared);
      largestShare = Math.max(largestShare, shared[0].shared / Math.min(planarGeometryArea(geom), planarGeometryArea(other.getGeometry())));
    }
  }
  assert.ok(pieces.length > 50, `the stock map has its known slivers (${pieces.length})`);
  const beyond = pieces.filter((piece) => piece.width > 500);
  assert.equal(beyond.length, 1, "one sliver between 500 m and 1.5 km");
  assert.ok(beyond[0].width < 1000, `and nothing wider: ${Math.round(beyond[0].width)} m is the widest piece two regions share`);
  // The guard on slivers passes over none of them either (the same 59).
  assert.ok(largestShare < 0.01, `no pair shares more than ${(largestShare * 100).toFixed(2)}% of its smaller region, far under a tenth`);
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
  assert.ok(mapEditor.includes("maxWidth: BORDER_CLEANUP.maxWidth,"), "at the sweep's own width");
});

// The save is the only thing that repairs borders. The Topology panel, which
// ran the same repair on a selection at a width the author chose, was removed:
// its chip, its file, the selection repair it called and the two messages
// that sent a failed merge to it. A merge from a branch that still has the
// panel would bring parts of it back; this is where that shows.
test("only the save repairs borders: no Topology panel, and a merge that fails points to the save", () => {
  const read = (name) => fs.readFileSync(new URL(name, import.meta.url), "utf8");
  assert.ok(!fs.existsSync(new URL("./TopologyPanel.jsx", import.meta.url)), "the panel's file is gone");
  const mapEditor = read("./MapEditor.jsx");
  const bottomBar = read("./BottomBar.jsx");
  const olMap = read("./OlMap.jsx");
  assert.ok(!mapEditor.includes("TopologyPanel") && !mapEditor.includes("openPanel === \"topology\""), "MapEditor mounts no such panel");
  assert.ok(!bottomBar.includes("\"topology\"") && !bottomBar.includes("label=\"Topology\""), "the bottom bar has no chip for it");
  assert.ok(!/topology panel/i.test(olMap + mapEditor + read("./BorderCleanupOverlay.jsx")), "nothing on screen sends the player to it");
  assert.equal(olMap.split("Borders are repaired when the map is saved into its scenario").length - 1, 2, "a merge and a border removal that fail both point to the save");
  assert.equal(olMap.split("Borders are repaired when the map is exported, so export the map and then try again.").length - 1, 2, "and in the standalone editor, which has no scenario, to the export");
  assert.ok(mapEditor.includes("scenarioMode={scenarioMode}"), "the map is told which of the two it is");
  assert.ok(!/\brepairTopology\b/.test(olMap), "the selection-scoped repair is gone with its only caller");
  const api = olMap.slice(olMap.indexOf("onReady?.({"), olMap.indexOf("replaceRegionsFromImport:"));
  assert.ok(api.includes("repairTopologyEverywhere,"), "the Workshop is handed the save-time sweep");
  assert.ok(!api.includes("analyzeTopology") && !api.includes("clearTopologyDiagnostics"), "and nothing of the panel's");
  // The Shared border tool keeps its own check after each edit, at its own width.
  assert.ok(olMap.includes("analyzeTopologyRef.current?.(pair.map((f) => f.getId()), { maxWidth: 100 })"));
});

// The standalone editor (/?editor=1) has no scenario, and so none of the three
// Save buttons: with the panel gone nothing repaired borders in it at all. A
// map leaves it as a file, so there Export JSON and Export for game run the
// cleanup before they write. Save now does not: it writes the editor's own
// stored copy, and is the autosave run early.
test("an export from the standalone editor cleans the borders first; a scenario's exports and Save now do not", () => {
  const mapEditor = fs.readFileSync(new URL("./MapEditor.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(mapEditor.includes("onExport={() => exportFromMenu(exportDocument)}"), "Export JSON");
  assert.ok(mapEditor.includes("onExportGame={() => exportFromMenu(exportGameSeed)}"), "Export for game");
  const fromMenu = mapEditor.slice(mapEditor.indexOf("const exportFromMenu = async (write) => {"), mapEditor.indexOf("// The ✕, and on a phone Back"));
  assert.match(fromMenu, /if \(scenarioMode\) \{\n\s+await write\(\);\n\s+return;\n\s+\}/, "in a scenario's Workshop the file is written at once, as it was");
  const cleaned = fromMenu.indexOf("await cleanBorders({ exporting: true })");
  const written = fromMenu.indexOf("await write();", cleaned);
  assert.ok(cleaned > 0 && written > cleaned, "the cleanup comes before the file is written");
  assert.ok(fromMenu.indexOf("setCleanupNote(note);") > written, "and the note after it");
  assert.ok(fromMenu.includes("if (!api || borderCleanup) return;"), "one at a time");
  assert.ok(fromMenu.includes("setBorderCleanup(null);"), "the screen comes down whether or not the file was written");
  // The file is built after the cleanup, from the map as it then is.
  assert.ok(mapEditor.includes("const exportDocument = () => downloadJson({ ...buildPayload(), id: docIdRef.current, version: 1 });"));
  assert.ok(mapEditor.includes("downloadJson(buildGameSeed(d.doc, api?.serializeRegions() || { type: \"FeatureCollection\", features: [] }, d.colors));"));

  // One cleanup for both: the same sweep, width, screen, Save now and note.
  const clean = mapEditor.slice(mapEditor.indexOf("const cleanBorders = async"), mapEditor.indexOf("const persistScenario = async"));
  assert.ok(clean.includes("api.repairTopologyEverywhere?.({") && clean.includes("maxWidth: BORDER_CLEANUP.maxWidth,") && clean.includes("stopRequested: () => cleanupStopRef.current"));
  assert.ok(clean.includes("return [describeCleanupResult(cleanup, cleanupError), ...describeCleanupLeftAlone(cleanup)].filter(Boolean);"));
  const scenario = mapEditor.slice(mapEditor.indexOf("const persistScenario = async"), mapEditor.indexOf("const docIdRef = useRef(null);"));
  assert.ok(scenario.includes("const note = await cleanBorders();") && scenario.includes("setCleanupNote(note);"));
  assert.equal(mapEditor.split("api.repairTopologyEverywhere").length - 1, 1, "nothing else in the editor runs the sweep");

  // Save now is the store's own write, the one the autosave makes every two
  // seconds: no cleanup in front of it.
  assert.ok(mapEditor.includes("onSave={saveNow}"));
  assert.ok(mapEditor.includes("const saveNow = () => runSaveRef.current();"));
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
    "Borders checked: no cracks or slivers between 2 m and 1.5 km across 12 regions. 1 pair of very large neighbouring regions was not compared.",
  );
  assert.ok(describeCleanupResult({ ...base, skippedPairs: 4 }).endsWith(" 4 pairs of very large neighbouring regions were not compared."));
});

// A region's boundary index. It was an R-tree with an object for every
// segment: 1.1 GB for the default world's regions, once that map's unions
// went through and its 25,000 holes each asked for their neighbours'.
// The index is typed arrays over the geometry's own coordinates, and must
// answer exactly what the R-tree answered: every segment whose own box meets
// the square about the point, which is what walking them all finds.
test("a region's boundary index hands back the segments a walk over all of them finds", () => {
  const indexOf = (geom) => indexBoundary(geom.getFlatCoordinates(), geom.getType() === "Polygon" ? geom.getEnds() : geom.getEndss().flat(), geom.getStride());
  const segmentsOf = (geom) => {
    const polys = geom.getType() === "Polygon" ? [geom.getCoordinates()] : geom.getCoordinates();
    return polys.reduce((sum, poly) => sum + poly.reduce((inPoly, ring) => inPoly + Math.max(0, ring.length - 1), 0), 0);
  };
  const sorted = (pairs) => pairs.map((pair) => JSON.stringify(pair)).sort();
  let asked = 0;
  let handedBack = 0;
  const compare = (geom, points, reaches) => {
    const index = indexOf(geom);
    const walk = boundaryNear(geom);
    assert.equal(index.size, segmentsOf(geom), "every segment of every ring is in it");
    for (const point of points) {
      for (const reach of reaches) {
        const fast = index.near(point[0], point[1], reach);
        assert.deepEqual(sorted(fast), sorted(walk(point, reach)));
        asked += 1;
        handedBack += fast.length;
      }
    }
  };

  // A square with a pond, and islands listed in no order across a wide sea.
  const pond = blockWithPond(2000)[0];
  compare(pond, [[0, 0], [15000, 0], [5000, 5000], [6000, 6000], [40000, 40000], [29999, 30001]], [1, 120, 6000]);
  const islands = [];
  for (let i = 0; i < 300; i += 1) {
    const x = ((i * 7919) % 300) * 5000;
    const y = ((i * 104729) % 97) * 9000;
    islands.push([[[x, y], [x + 900, y], [x + 1200, y + 700], [x + 400, y + 1300], [x - 200, y + 600], [x, y]]]);
  }
  const archipelago = new MultiPolygon(islands);
  compare(archipelago, islands.filter((island, i) => i % 7 === 0).map((island) => island[0][2]), [1, 120, 2500]);
  compare(archipelago, [[-1e7, -1e7], [750000, 400000]], [1, 1e7]);

  // The built-in map's five heaviest regions, asked the way the sweep asks:
  // at points of their own boundary and beside it, at a metre (the rim) and
  // at 120 m (the touch score).
  const { features } = builtInMap();
  const heaviest = features.map((feature) => feature.getGeometry()).sort((a, b) => vertexCountOf(b) - vertexCountOf(a)).slice(0, 5);
  for (const geom of heaviest) {
    const flat = geom.getFlatCoordinates();
    const points = [];
    for (let i = 0; i < flat.length; i += 2 * 37) points.push([flat[i], flat[i + 1]], [flat[i] + 60, flat[i + 1] - 45]);
    compare(geom, points, [1, 120]);
  }
  assert.ok(asked > 500 && handedBack > 1000, `${asked} questions, ${handedBack} segments handed back`);

  // Nothing to index: nothing near anything.
  for (const empty of [indexBoundary([], []), indexBoundary([5, 5], [2]), indexBoundary([], [], 2)]) {
    assert.equal(empty.size, 0);
    assert.deepEqual(empty.near(5, 5, 100), []);
  }
  // A ring that is one segment there and back is two segments, and both are found.
  const sliver = indexBoundary([0, 0, 10, 0, 0, 0], [6]);
  assert.equal(sliver.size, 2);
  assert.equal(sliver.near(5, 0, 1).length, 2);

  const olMap = fs.readFileSync(new URL("./OlMap.jsx", import.meta.url), "utf8");
  assert.ok(olMap.includes("return indexBoundary(") && !olMap.includes("RBush"), "the Workshop builds this index, and no R-tree");
  assert.ok(olMap.includes("holdsRim(ring, ([x, y], reach) => index.near(x, y, reach))") && olMap.includes("boundaryIndex.near(p[0], p[1], epsilon)"), "and asks it for the rim and for the touch score");
});
