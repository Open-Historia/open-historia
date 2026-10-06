/*!
 * Open Historia Map Editor — save-time border cleanup
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Every scenario save (Save, Save & Exit, Apply & Play) first runs a
// conservative border repair over EVERY region, every time — enclosed cracks
// filled, thin overlaps trimmed — before the map is written (MapEditor.jsx
// persistScenario → OlMap.jsx repairTopologyEverywhere). How wide a crack or
// a sliver it repairs is the author's choice at each save: a quick clean
// stops at 500 m, a deep one at 1.5 km (CLEANUP_MODES below). The standalone
// editor has no scenario to save into: a map leaves it as a file, so there
// Export JSON and Export for game ask and run it first instead (MapEditor.jsx
// exportFromMenu). Nothing else in the Workshop repairs borders. This module
// is the pure part: how regions are grouped for the staged union, and what
// the loading screen and the note after the save say.
//
// The pass is not all-pairs. Overlap discovery asks the map's spatial index for
// extent neighbours only (the stock 4,848-region world: 14,011 pairs, ~3 s),
// and the gap search reads the holes of ONE union of every region on the map.
// That union is built in stages — each chunk of regions unioned, then the chunk
// results unioned — which is the same polygon set as a single call (union is
// associative; the stock world yields the identical 332 cracks crack by crack)
// with bounded memory (414 MB → ~200 MB of heap on the stock world) and a
// repaint between chunks. Searching each chunk on its own was rejected: a crack
// longer than a chunk, such as a double-traced border between two large
// countries, can have both end-caps outside any one chunk and go unseen.
//
// Two more measured facts shape the pass. Trimming a sliver can expose a
// hairline between the winner and a third region the trimmed region used to
// cover, so the pass repeats until it finds nothing (the stock world: 106
// cracks and 59 slivers, then nothing). And the save writes coordinates at
// five decimals, about a metre, which leaves centimetre slivers along every
// repaired border on reload — without a floor those would be "repaired" again
// on every save, moving hundreds of regions by centimetres each time.
//
// And no single call may be too big. polygon-clipping refuses any operation
// past 1,000,000 queued segment endpoints (about 500,000 segments) with
// "Infinite loop when putting segment endpoints in a priority queue", and it
// says so only after building the queue: 0.8 GB of heap for the stock GADM
// world's chunk results (1.25 million vertices), in one synchronous call. A
// page on a machine with 8 GB of RAM gets about 2 GB of heap, much of it
// already held by the game and the Workshop's own copy of the map, so on a
// detailed map that one call could need more than the page had left; a page
// that runs out dies, and the desktop window is left on its dark grey
// background. So no union is handed more than maxUnionVertices: a heavy chunk
// is split until its pieces fit, the chunk results are merged pairwise within
// the budget, and a map that cannot be merged into one piece is read in parts.
// A hole in one part that a region of another part fills (an enclave grouped
// elsewhere) is not a crack, and is dropped.
//
// And a call can be refused whatever its size: "Unable to complete output
// ring starting at …", "Unable to find segment … in SweepLine tree", a stack
// overflow while it nests its rings. One such throw used to end the whole
// cleanup with nothing repaired, and on the standalone editor's default
// world (3,662 regions, 2.58 million vertices) it came 0.3 s in. Measured there: six of the twenty pieces of the first stage
// are refused, and each failing set comes down to PAIRS of regions (eight of
// them: Veracruz and Oaxaca, Los Lagos and Chubut, Fars and Kerman …), never
// to one region on its own. The cause is in the coordinates. polygon-clipping
// snaps a coordinate to one it has already seen when the two are within one
// part in 2^52 of each other, x and y each on its own, and loses its way when
// two values sit just outside that. That map has 600 such values among its
// 1.2 million: points where two regions were clipped against the same line
// separately, so each holds its own copy of the crossing, a few billionths of
// a metre from the other's (Veracruz 17.559134472946308° N, Oaxaca
// 17.559134472946305°). The built-in map has none: no two different values
// on it are closer than 1.11 m. So when a union is refused the search starts
// over with the regions WELDED: each such value made equal to its neighbour
// within weldReach (weldTable, below). On the default world that is every
// refusal gone, at any reach tried from 1e-8 to 1e-3 m: after the one
// refused call that turns the weld on, the 29 unions of the search all go
// through, the map is read in the 10 parts its size makes it, and 25,079
// holes are found in 24 s.
//
// The other thing it refuses is its own work, which is what a map saved
// again without a reload is full of: a region the sweep has trimmed has new
// corners that lie on its neighbour's edge to within a nanometre, where the
// neighbour has no vertex (nodeBoundaries, below, has what was measured). So
// welding also puts such corners into the edges they lie on. With both, six
// saves of the default world in a row each read it in the same 10 parts with
// nothing left apart (and, counted after the first four, in the same 29
// unions with none refused).
//
// Welding only helps to FIND. A welded region is what polygon-clipping is
// shown in the region's place, and is thrown away with the search: every
// repair is made from the regions as they are, so no welded region is
// written into the map. A region with no such value and no such corner is
// shown as it is, and a map on which nothing is refused is never welded.
//
// What welding does not cure is kept apart instead of ending the search: a
// piece of the first stage that is still refused is halved until its halves
// union (a region refused on its own stays as it is), and of two parts whose
// merge is refused the lighter stays a part of its own. The map is then read
// in parts as an over-budget map is, the result counts the parts left apart
// (partsApart), and the note says a crack along their edge may have been
// missed. That alone, with no weld, was the first design, and it is the worse
// one on the default world: 154 unions of which 49 are refused, 36 s where
// welding takes 24, and 7 of 18 parts left apart with 462 of the holes unseen.

export const BORDER_CLEANUP = Object.freeze({
  // The widest crack or sliver that is repaired, in metres of the map
  // projection (Web Mercator: 1,500 m on the ground at the equator, half that
  // at 60°). A defect's width is twice its area over its perimeter: its real
  // width when it is long and thin, half its diameter when it is round, so a
  // hole up to about 3 km across between regions is within it too.
  //
  // It was 500 m. That left eight cracks on the built-in map, 501 to 977 m,
  // each a triangle where two or three regions of one country had their
  // shared border simplified differently (the longest: 358 km of the
  // Wyoming–Montana line, nowhere wider than 900 m). 1,500 m takes them and
  // nothing else: the map has no hole between 977 m and 4,402 m, the
  // narrowest water left as a hole (the lower Uruguay river) measures
  // 7,031 m, and no two regions overlap by more than 930 m. (All of this was
  // measured on the built-in map as it shipped until revision 3 of its seed,
  // which is that map deep-cleaned: a save of it now finds nothing.)
  //
  // A map cut from the stock world is why the wider limit has two guards (the
  // next two numbers). Its regions were each simplified on their own, so
  // neighbours disagree by up to 2.5 km along most borders and the sweep
  // rewrites such a map wholesale at either width: the 940 regions of a
  // European cut had 2,105 cracks filled and 2,856 slivers trimmed at 500 m.
  // At 1,500 m alone that was 4,103 and 5,263, and along with the borders
  // 500 m had left open it took what else was that narrow: 32 more holes of
  // water inside one region, and over half the area of nine regions a few
  // square kilometres across. With the guards it is 4,071 and 5,220: the
  // water stays, and no region loses more than a fifth of its area, where
  // ten did at 500 m. (The whole stock world was out of reach at any width
  // while a refused union ended the cleanup. A first pass over it finds
  // 24,661 cracks and 49,647 slivers at this one; given all the time it
  // wants, the sweep fills 24,882 cracks and trims 49,043 slivers in three
  // passes, and no region gains or loses more than a fifth of its area.)
  //
  // The scenario diff's tolerance follows this number
  // (runtime/scenarioChanges.js CLEANUP_WIDTH), or a save's own repairs
  // would read as suggested changes.
  //
  // This is the DEEP clean. A save asks which of the two the author wants
  // (CLEANUP_MODES below), and the other, the quick one, stops at quickWidth.
  maxWidth: 1500,
  // The quick clean's width: the limit every save had before 1.5 km. On the
  // built-in map as it was before its seed was deep-cleaned it filled 98
  // cracks and trimmed 58 slivers across 143 regions, where the deep clean's
  // 106, 59 and 152 include the eight cracks 501 to 977 m wide described above. Both read every region; the width decides
  // what is repaired, not what is looked at, so the search costs the same.
  quickWidth: 500,
  // A hole with ONE region on its rim is not a crack between regions: it is
  // water, or a void, that the region was drawn around, and it keeps the
  // limit the sweep had before. At 1,500 m a map cut from the stock world
  // lost its narrow inlets and lagoons as "cracks": Randers Fjord (13 km²),
  // Laguna Madre (38 km²), Santa Rosa Sound (39 km²), 32 holes in the
  // European cut alone. (cracksAmong, below.)
  maxWidthInsideOneRegion: 500,
  // What two regions share is a sliver only while it is small beside the
  // smaller of them. A pair that shares more than this much of the smaller
  // one's area is left alone, since a trim would take that much of a region:
  // at 1,500 m, nine regions of the European cut lost over half their area
  // (Montegiardino in San Marino kept 0.1 of its 1.3 km²). With a tenth, no
  // region loses more than a fifth on any of the three cuts measured (the
  // worst, 18.8%), and the European cut has 34 pairs passed over out of some
  // three thousand compared. (isSliver, below.)
  maxSliverShare: 0.1,
  // Defects narrower than this are coordinate-rounding noise, invisible at any
  // zoom, and left alone.
  minWidth: 2,
  // A pass that repaired something is followed by another; stop when a pass
  // finds nothing, or after this many.
  maxPasses: 3,
  // A chunk is sized to about this many regions.
  targetRegionsPerChunk: 300,
  // Regions per overlap batch between repaints.
  overlapBatch: 200,
  // The most vertices one polygon-clipping call is handed (see above), half its
  // own ceiling. The stock 4,848-region map is 235,996 vertices in all, so it
  // is always one union, exactly as before.
  maxUnionVertices: 250_000,
  // The search's wall-clock budget in milliseconds, over every phase and
  // pass. Past it the sweep stops looking, applies what it has found, and the
  // note after the save says the map was too detailed to check fully within
  // one save. Without one, a map with a single 41,000-vertex sea zone held the
  // Workshop for tens of minutes: every one of its 4,800 regions was checked
  // against the whole coastline, and then all of it twice more.
  maxMillis: 60_000,
  // Applying what was found may run on until this long after the start; the
  // rest of the repairs are left for the next save.
  maxApplyMillis: 90_000,
  // A follow-up pass looks only around the previous pass's repairs: their
  // footprints, padded by this many times maxWidth.
  hotspotPad: 2,
  // When polygon-clipping refuses a call, the regions are welded and it is
  // asked again: coordinate values closer to each other than this, in metres
  // on one axis, are made one value (weldTable, below), and a corner of one
  // region closer than this to an edge of another is put into that edge
  // (nodeBoundaries). On the standalone editor's default world 600 values lie
  // that close to another, most of them 1e-10 to 1e-8 m off; between 1e-6
  // and 1e-5 m that map has three, and past that only what chance puts there
  // (some 5,000 values per axis within a metre of another). A micron is a
  // hundred times past where they crowd and a millionth of what the save
  // rounds to, so nothing it welds was ever meant to be two points.
  weldReach: 1e-6,
});

// The two cleans a save offers, by the widest crack or sliver each repairs
// (MapEditor.jsx asks; BorderCleanupOverlay.jsx BorderCleanupChoice is the
// question). Deep is the one a save ran before there was a choice, and what
// anything that does not say runs.
export const CLEANUP_MODES = Object.freeze({
  quick: BORDER_CLEANUP.quickWidth,
  deep: BORDER_CLEANUP.maxWidth,
});
export const cleanupWidthOf = (mode) => CLEANUP_MODES[mode] ?? CLEANUP_MODES.deep;

const count = (value) => Number(value) || 0;
const formatCount = (value) => count(value).toLocaleString("en-US");

// A square grid over the map's extent, sized so a cell holds roughly
// targetRegionsPerChunk regions. Returns null for nothing to chunk.
export const planTopologyChunks = (
  extent,
  regionCount,
  { targetRegionsPerChunk = BORDER_CLEANUP.targetRegionsPerChunk } = {},
) => {
  if (!Array.isArray(extent) || extent.length !== 4 || !extent.every(Number.isFinite)) return null;
  if (!(regionCount > 0)) return null;
  const cells = Math.max(1, Math.ceil(Math.sqrt(regionCount / Math.max(1, targetRegionsPerChunk))));
  const [minX, minY, maxX, maxY] = extent;
  return {
    extent: [minX, minY, maxX, maxY],
    cells,
    cellWidth: (maxX - minX) / cells,
    cellHeight: (maxY - minY) / cells,
  };
};

// Which cell a region belongs to: the one under the centre of its extent, so
// every region is unioned exactly once. (A region crossing cells is merged
// with its neighbours when the cell unions are unioned.)
export const chunkIndexFor = (plan, regionExtent) => {
  if (!plan || !Array.isArray(regionExtent) || regionExtent.length !== 4) return 0;
  const axis = (low, high, origin, size) => {
    if (!(size > 0)) return 0;
    const centre = (Number(low) + Number(high)) / 2;
    return Math.min(plan.cells - 1, Math.max(0, Math.floor((centre - origin) / size)));
  };
  const column = axis(regionExtent[0], regionExtent[2], plan.extent[0], plan.cellWidth);
  const row = axis(regionExtent[1], regionExtent[3], plan.extent[1], plan.cellHeight);
  return column * plan.cells + row;
};

// Groups regions by cell; empty cells are dropped, order is by cell index.
export const bucketRegions = (plan, regions, extentOf) => {
  if (!plan) return regions.length ? [regions.slice()] : [];
  const buckets = new Map();
  for (const region of regions) {
    const index = chunkIndexFor(plan, extentOf(region));
    if (!buckets.has(index)) buckets.set(index, []);
    buckets.get(index).push(region);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, bucket]) => bucket);
};

// Lets the browser paint between chunks: React commits the progress state and
// the frame is drawn before the next chunk starts. Plain macrotask in Node.
export const yieldToBrowser = () =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });

// Vertices in an OpenLayers geometry: what a union's cost grows with.
export const vertexCountOf = (geom) => {
  const flat = geom?.getFlatCoordinates?.();
  if (!flat) return 0;
  return flat.length / (geom.getStride?.() || 2);
};

// A region's boundary, for asking which of its segments pass near a point
// (which regions are on a hole's rim, which neighbour a crack touches most).
// The segments are taken sixteen at a time in the order the rings run, each
// run in a box, and the boxes packed into a tree sixteen to a node after
// sorting the runs along a Z-order curve, so an island's runs sit together
// however the rings were listed. All of it is typed arrays over the
// geometry's own flat coordinates.
//
// It was an R-tree holding an object for every segment, 470 bytes each.
// Nothing had measured that on a map the sweep could not get through: once
// the default world's unions went through (2.47 million segments, 25,000
// holes along every coast, each asking for its neighbours' boundaries), the
// indexes of its regions held 1.1 GB, the sweep's heap peaked at 2.7 GB, and
// a run held to 1 GB died. These hold 14 MB for the same regions (6 bytes a
// segment), are built in 0.1 s where the R-trees took 2.8 s, and answer the
// same questions with the same segments.
//
// `flat` is x, y, x, y, …; `ends` the offset each ring ends at (OpenLayers'
// getEnds(), or getEndss() flattened). `near(x, y, reach)` hands back, as
// [[x1, y1], [x2, y2]] pairs, every segment whose own box meets the square of
// half-side `reach` about the point: exactly what the R-tree answered.
// `offsetsNear` hands back the same segments by the offset each starts at.
export const indexBoundary = (flat, ends, stride = 2) => {
  const RUN = 16;
  const FAN = 16;
  let runCount = 0;
  let from = 0;
  for (const end of ends) {
    const segments = Math.max(0, (end - from) / stride - 1);
    runCount += Math.ceil(segments / RUN);
    from = end;
  }
  if (!runCount) return { size: 0, near: () => [], offsetsNear: () => [] };
  const first = new Uint32Array(runCount);
  const length = new Uint8Array(runCount);
  const runBoxes = new Float64Array(runCount * 4);
  let size = 0;
  let run = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  from = 0;
  for (const end of ends) {
    const lastPoint = end - stride;
    for (let at = from; at < lastPoint; at += RUN * stride) {
      const stop = Math.min(lastPoint, at + RUN * stride);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = at; i <= stop; i += stride) {
        const x = flat[i];
        const y = flat[i + 1];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      first[run] = at;
      length[run] = (stop - at) / stride;
      runBoxes.set([x0, y0, x1, y1], run * 4);
      size += length[run];
      run += 1;
      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (x1 > maxX) maxX = x1;
      if (y1 > maxY) maxY = y1;
    }
    from = end;
  }
  // The runs in Z-order of their box centres (16 bits a side, interleaved).
  const spread = (value) => {
    let v = value & 0xffff;
    v = (v | (v << 8)) & 0x00ff00ff;
    v = (v | (v << 4)) & 0x0f0f0f0f;
    v = (v | (v << 2)) & 0x33333333;
    v = (v | (v << 1)) & 0x55555555;
    return v;
  };
  const scaleX = maxX > minX ? 65535 / (maxX - minX) : 0;
  const scaleY = maxY > minY ? 65535 / (maxY - minY) : 0;
  let keys = new Uint32Array(runCount);
  for (let i = 0; i < runCount; i += 1) {
    const cx = ((runBoxes[i * 4] + runBoxes[i * 4 + 2]) / 2 - minX) * scaleX;
    const cy = ((runBoxes[i * 4 + 1] + runBoxes[i * 4 + 3]) / 2 - minY) * scaleY;
    keys[i] = (spread(Math.floor(cx)) | (spread(Math.floor(cy)) << 1)) >>> 0;
  }
  const order = new Uint32Array(runCount);
  for (let i = 0; i < runCount; i += 1) order[i] = i;
  order.sort((a, b) => keys[a] - keys[b] || a - b);
  // Only the order is kept (the comparator above would hold the keys with it).
  keys = null;
  // Level 0 is the runs in that order; each level above boxes FAN of the one
  // below, until one node's worth is left.
  const levels = [{ offset: 0, count: runCount }];
  let nodes = runCount;
  for (let count = runCount; count > FAN;) {
    count = Math.ceil(count / FAN);
    levels.push({ offset: nodes, count });
    nodes += count;
  }
  const boxes = new Float64Array(nodes * 4);
  for (let i = 0; i < runCount; i += 1) boxes.set(runBoxes.subarray(order[i] * 4, order[i] * 4 + 4), i * 4);
  for (let level = 1; level < levels.length; level += 1) {
    const below = levels[level - 1];
    const here = levels[level];
    for (let i = 0; i < here.count; i += 1) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const stop = Math.min(below.count, (i + 1) * FAN);
      for (let child = i * FAN; child < stop; child += 1) {
        const at = (below.offset + child) * 4;
        if (boxes[at] < x0) x0 = boxes[at];
        if (boxes[at + 1] < y0) y0 = boxes[at + 1];
        if (boxes[at + 2] > x1) x1 = boxes[at + 2];
        if (boxes[at + 3] > y1) y1 = boxes[at + 3];
      }
      boxes.set([x0, y0, x1, y1], (here.offset + i) * 4);
    }
  }
  const top = levels.length - 1;
  const stack = [];
  const offsetsNear = (x, y, reach) => {
    const qx0 = x - reach;
    const qy0 = y - reach;
    const qx1 = x + reach;
    const qy1 = y + reach;
    const found = [];
    stack.length = 0;
    for (let i = levels[top].count - 1; i >= 0; i -= 1) stack.push(top, i);
    while (stack.length) {
      const index = stack.pop();
      const level = stack.pop();
      const at = (levels[level].offset + index) * 4;
      if (boxes[at] > qx1 || boxes[at + 2] < qx0 || boxes[at + 1] > qy1 || boxes[at + 3] < qy0) continue;
      if (level > 0) {
        const stop = Math.min(levels[level - 1].count, (index + 1) * FAN);
        for (let child = stop - 1; child >= index * FAN; child -= 1) stack.push(level - 1, child);
        continue;
      }
      let i = first[order[index]];
      for (let left = length[order[index]]; left > 0; left -= 1, i += stride) {
        const ax = flat[i];
        const ay = flat[i + 1];
        const bx = flat[i + stride];
        const by = flat[i + stride + 1];
        if ((ax < bx ? ax : bx) > qx1 || (ax > bx ? ax : bx) < qx0 || (ay < by ? ay : by) > qy1 || (ay > by ? ay : by) < qy0) continue;
        found.push(i);
      }
    }
    return found;
  };
  const near = (x, y, reach) => offsetsNear(x, y, reach).map((i) => [[flat[i], flat[i + 1]], [flat[i + stride], flat[i + stride + 1]]]);
  return { size, near, offsetsNear };
};

// A group of regions cut in two at the median of their extent centres along
// the longer side: two compact patches of neighbours, the first never the
// smaller.
const halveByExtent = (group, extentOf) => {
  const rows = group.map((region, index) => {
    const e = extentOf(region);
    return { region, index, x: (e[0] + e[2]) / 2, y: (e[1] + e[3]) / 2 };
  });
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const row of rows) {
    minX = Math.min(minX, row.x);
    maxX = Math.max(maxX, row.x);
    minY = Math.min(minY, row.y);
    maxY = Math.max(maxY, row.y);
  }
  const axis = maxX - minX >= maxY - minY ? "x" : "y";
  rows.sort((a, b) => a[axis] - b[axis] || a.index - b.index);
  const half = Math.ceil(rows.length / 2);
  return [rows.slice(0, half).map((row) => row.region), rows.slice(half).map((row) => row.region)];
};

// A bucket too heavy for one union, split into pieces that are not: halved at
// the median of its regions' extent centres along the longer side, again and
// again, so each piece is a compact patch of neighbours. A single region
// heavier than the budget is a piece of its own. Pieces come out in the order
// of the halving, so neighbouring patches sit next to each other.
export const splitByVertexBudget = (regions, { verticesOf, extentOf, budget = BORDER_CLEANUP.maxUnionVertices }) => {
  const pieces = [];
  const stack = [regions.slice()];
  while (stack.length) {
    const group = stack.pop();
    let total = 0;
    for (const region of group) total += count(verticesOf(region));
    if (group.length < 2 || total <= budget) {
      if (group.length) pieces.push(group);
      continue;
    }
    const [first, second] = halveByExtent(group, extentOf);
    // The second half goes on the stack first, so the first half is split next.
    stack.push(second);
    stack.push(first);
  }
  return pieces;
};

// polygon-clipping keeps every x and every y it has seen, and takes a new
// one for an old one when the two are within one part in 2^52 of each other
// (a nanometre or two at this projection's scale). Two values just outside
// that are what it cannot handle: two copies of one crossing point, each
// computed by an earlier clip of its own region, a few ulps apart. This is
// the table that makes such values one before it sees them: every value on
// one axis that lies less than `reach` above another gives way to it, so
// afterwards no two different values are closer than `reach`. `values` are
// one axis's coordinates, in any order and with repeats (a Float64Array is
// sorted where it is); returned is a Map from each value that gives way to
// the value it becomes (empty on a map whose coordinates were all written at
// five decimals, where the closest two are 1.11 m apart).
export const weldTable = (values, reach = BORDER_CLEANUP.weldReach) => {
  const table = new Map();
  const sorted = values instanceof Float64Array ? values.sort() : Float64Array.from(values || []).sort();
  let anchor = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const value = sorted[i];
    if (value === anchor) continue;
    if (value - anchor < reach) table.set(value, anchor);
    else anchor = value;
  }
  return table;
};

// Flat coordinates (x, y, x, y, …) with the two tables applied: a copy with
// the welded values in it, or null when none of its values gives way, which
// is nearly always (441 of the default world's 3,662 regions hold one).
export const weldFlatCoordinates = (flat, [xs, ys], stride = 2) => {
  if (!xs.size && !ys.size) return null;
  let out = null;
  for (let i = 0; i < flat.length; i += stride) {
    const x = xs.get(flat[i]);
    const y = ys.get(flat[i + 1]);
    if (x === undefined && y === undefined) continue;
    if (!out) out = flat.slice();
    if (x !== undefined) out[i] = x;
    if (y !== undefined) out[i + 1] = y;
  }
  return out;
};

// The other thing polygon-clipping cannot handle is its own work. Trimming a
// region gives it corners where its old border crossed the neighbour's: each
// lies on the neighbour's edge to within a nanometre, the neighbour has no
// vertex there, and no weld of values helps, because the corner's values are
// nobody else's. polygon-clipping does not take such a corner for a point of
// that edge, and now and then refuses the next union of the two: 91 times in
// 40,000 random pairs of overlapping polygons, each trimmed against the other
// and then unioned with it. So a map already repaired in part is the worst
// case: on the default world, after three saves without a reload (32,000
// slivers trimmed), the gap search with only the values welded is 329 unions
// with 119 refused and 19 of 29 parts left apart, in the whole of its 60 s.
//
// This puts the corners into the edges ("noding"). `shapes` are the regions,
// welded, each { flat, ends, extent, stride }; `neighboursOf(i, box)` hands
// back the regions that can reach the box (by their place in `shapes`). For
// each region, every vertex of a neighbour that lies on one of its edges
// within `reach`, and is not already an end of it, is put into that edge.
// Returned, per region, is null when nothing was put in, else its coordinates
// with the corners in them, { flat, ends }. With that the same search is 29
// unions and none refused, in 26 s (30,000 corners into the edges of 1,995
// regions), every one of the 91 random pairs unions, and the default world
// before any save (841 corners, 500 regions) gives the search the same
// 25,079 holes with them as without.
export const nodeBoundaries = (shapes, neighboursOf, reach = BORDER_CLEANUP.weldReach) =>
  shapes.map((shape, b) => {
    const { flat, stride = 2 } = shape;
    const box = [shape.extent[0] - reach, shape.extent[1] - reach, shape.extent[2] + reach, shape.extent[3] + reach];
    // The region's own index, built when the first neighbour's vertex comes
    // inside its box; and the corners to put in, by the offset of the segment
    // each goes into.
    let index = null;
    let corners = null;
    for (const a of neighboursOf(b, box)) {
      if (a === b) continue;
      const other = shapes[a].flat;
      const step = shapes[a].stride || 2;
      for (let i = 0; i < other.length; i += step) {
        const x = other[i];
        const y = other[i + 1];
        if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue;
        if (!index) index = indexBoundary(flat, shape.ends, stride);
        for (const at of index.offsetsNear(x, y, reach)) {
          const px = flat[at];
          const py = flat[at + 1];
          const qx = flat[at + stride];
          const qy = flat[at + stride + 1];
          if ((px === x && py === y) || (qx === x && qy === y)) continue;
          const vx = qx - px;
          const vy = qy - py;
          const vv = vx * vx + vy * vy;
          if (!(vv > 0)) continue;
          const t = ((x - px) * vx + (y - py) * vy) / vv;
          if (!(t > 0 && t < 1)) continue;
          if (Math.hypot(x - (px + t * vx), y - (py + t * vy)) > reach) continue;
          if (!corners) corners = new Map();
          const list = corners.get(at) || [];
          if (!list.length) corners.set(at, list);
          if (!list.some((corner) => corner.x === x && corner.y === y)) list.push({ t, x, y });
        }
      }
    }
    if (!corners) return null;
    const out = [];
    const ends = [];
    let from = 0;
    for (const end of shape.ends) {
      for (let i = from; i < end; i += stride) {
        for (let k = 0; k < stride; k += 1) out.push(flat[i + k]);
        const list = corners.get(i);
        if (!list) continue;
        for (const corner of list.sort((m, n) => m.t - n.t)) {
          out.push(corner.x, corner.y);
          for (let k = 2; k < stride; k += 1) out.push(flat[i + k]);
        }
      }
      ends.push(out.length);
      from = end;
    }
    return { flat: out, ends };
  });

// The chunk results merged back into one union without ever handing a single
// call more than the budget. When they fit together, that is the one call the
// sweep always made. When they do not, neighbours are merged in pairs, round
// after round, until one union is left or no neighbouring pair fits; what is
// left is the map in parts.
//
// A union that throws (polygon-clipping refusing the call) leaves parts
// too. The one call of everything falls back to the pairs; and of a pair
// whose union throws, the lighter part stays a part of its own for good,
// `onApart(part, error)` is told, and the other is tried with the part after
// it. Which of the two holds what cannot be unioned is not known, and it
// takes both: the lighter is kept apart because less border lies along its
// edge, and a crack between a part left apart and the rest is not seen. One
// refused call is all a part left apart costs.
export const mergeWithinBudget = async (parts, { union, verticesOf = vertexCountOf, budget = BORDER_CLEANUP.maxUnionVertices, between, shouldStop = () => false, onApart } = {}) => {
  let level = parts.filter(Boolean);
  if (level.length < 2) return level;
  let total = 0;
  for (const part of level) total += count(verticesOf(part));
  if (total <= budget) {
    try {
      const whole = union(level);
      return whole ? [whole] : [];
    } catch {
      // Refused as one call: in pairs, then, to find what it is that will not
      // join and keep only that apart.
    }
  }
  const apart = [];
  let merged = true;
  while (merged && level.length > 1) {
    const next = [];
    merged = false;
    let i = 0;
    while (i < level.length) {
      const a = level[i];
      const b = level[i + 1];
      if (b !== undefined && count(verticesOf(a)) + count(verticesOf(b)) <= budget) {
        if (shouldStop()) return [...next, ...level.slice(i), ...apart];
        let joined = null;
        try {
          joined = union([a, b]);
        } catch (error) {
          const lighter = count(verticesOf(b)) <= count(verticesOf(a)) ? i + 1 : i;
          apart.push(level[lighter]);
          onApart?.(level[lighter], error);
          level.splice(lighter, 1);
          if (between) await between();
          continue;
        }
        if (joined) next.push(joined);
        merged = true;
        i += 2;
        if (between) await between();
      } else {
        next.push(a);
        i += 1;
      }
    }
    level = next;
  }
  return [...level, ...apart];
};

// When the map was read in parts, a hole in one part's union can be land that
// a region of another part holds: a narrow enclave whose own region was grouped
// elsewhere. A crack is a hole no region covers, so a hole with a region under
// its interior point is not one. (A union of the whole map never has such a
// hole, and is not asked.)
export const dropCoveredHoles = (holes, isCovered) =>
  holes.filter((hole) => !isCovered(hole.geom.getInteriorPoint().getCoordinates().slice(0, 2)));

const byWidthThenArea = (a, b) => a.width - b.width || a.area - b.area;

// One pass's gap search: the regions bucketed by the grid, heavy buckets split
// to fit the budget, each piece unioned, the pieces merged within the budget,
// and the holes of what is left read at the sweep's tolerances. `union` and
// `gapsOf` are geometry.js's unionAllGeoms and enclosedGapsOfUnion, handed in
// so this module stays import-free; `isCovered(point)` asks the map whether a
// region lies under a point. Returns the holes, narrowest first, and how many
// parts the map was read in (1: one union of everything, as it always was).
//
// A union that throws does not end the search (the header says what was
// measured). With a `weld` to turn to, the first refused union starts the
// search over with every geometry welded before polygon-clipping sees it:
// `welded` in what is returned says it came to that. A piece refused all the
// same is halved, and its halves unioned on their own, down to single
// regions; two parts whose merge is refused stay two (mergeWithinBudget).
// What could be joined to nothing is counted in `apart`, and is among the
// `parts`: its own holes are read like any part's, and only a crack between
// it and the rest goes unseen.
export const findEnclosedGaps = async (regions, {
  plan,
  geometryOf,
  union,
  gapsOf,
  isCovered = () => false,
  maxWidth = BORDER_CLEANUP.maxWidth,
  minWidth = BORDER_CLEANUP.minWidth,
  budget = BORDER_CLEANUP.maxUnionVertices,
  onChunks,
  onChunk,
  between = yieldToBrowser,
  // Asked before each union; true ends the search with no holes at all (the
  // holes of a partial union are not trusted).
  shouldStop = () => false,
  // True when `regions` are a part of the map rather than all of it (a
  // follow-up pass): a hole then always has to prove no region lies under it.
  partial = false,
  // `weld(geometry)` hands back what polygon-clipping is shown in a
  // geometry's place: a region with its near-equal coordinates made equal and
  // its neighbours' corners put into its edges, a union of regions with the
  // first of those (the same geometry when there is nothing to do to it).
  // `welded` true starts with it, for the passes after one that needed it.
  // `onRefused(error)` hears of every union that threw.
  weld = null,
  welded = false,
  onRefused,
}) => {
  const verticesOf = (region) => vertexCountOf(geometryOf(region));
  const extentOf = (region) => geometryOf(region).getExtent();
  const pieces = bucketRegions(plan, regions, extentOf)
    .flatMap((bucket) => splitByVertexBudget(bucket, { verticesOf, extentOf, budget }));
  onChunks?.(pieces.length);
  let welding = Boolean(welded && weld);
  // Set by the refusal that turns the weld on. What was unioned before it was
  // made of the regions as they are, so the search starts over: every union
  // of a search is of regions as they are, or every one of welded regions.
  let startOver = false;
  let stopped = false;
  const unionOf = (geoms) => {
    if (!welding) {
      try {
        return union(geoms);
      } catch (error) {
        onRefused?.(error);
        if (weld) {
          welding = true;
          startOver = true;
        }
        throw error;
      }
    }
    try {
      return union(geoms.map(weld));
    } catch (error) {
      onRefused?.(error);
      throw error;
    }
  };
  // True when this run of the search is to go no further.
  const halted = () => {
    if (!startOver && !stopped && shouldStop()) stopped = true;
    return startOver || stopped;
  };
  let partials = [];
  // What could be unioned with nothing else: a part each, never merged.
  let apart = [];
  const stoppedEarly = () => ({ holes: [], parts: 0, stopped: true, welded: welding, apart: 0 });
  // One piece into `partials`; false when the run is halted on the way.
  const unionPiece = async (piece) => {
    if (halted()) return false;
    // A region heavier than the budget goes in as it is: the union of one
    // polygon is that polygon, and handing it to polygon-clipping alone is the
    // very call the budget exists to avoid.
    const heavyAlone = piece.length === 1 && verticesOf(piece[0]) > budget;
    let unioned = null;
    try {
      unioned = heavyAlone ? geometryOf(piece[0]) : unionOf(piece.map(geometryOf));
    } catch {
      if (startOver) return false;
      // Refused, welded or with no weld to turn to. One region that cannot
      // be unioned even with itself is a part as it is; more are halved, and
      // the halves tried.
      if (piece.length < 2) {
        apart.push(geometryOf(piece[0]));
        return true;
      }
      await between();
      const [first, second] = halveByExtent(piece, extentOf);
      const before = partials.length;
      const apartBefore = apart.length;
      if (!(await unionPiece(first))) return false;
      const fromFirst = partials.length - before;
      await between();
      if (!(await unionPiece(second))) return false;
      // Each half made one union at its first try, so it takes both for the
      // refusal. Their merge is tried here, where the halving has made the
      // two as small as they will be: refused again, the lighter is the part
      // kept apart, and it is a patch of a few regions rather than whatever
      // the merging would have grown around it by the time the two met.
      if (fromFirst === 1 && partials.length - before === 2 && apart.length === apartBefore) {
        if (halted()) return false;
        const [a, b] = partials.splice(before, 2);
        try {
          const joined = unionOf([a, b]);
          if (joined) partials.push(joined);
        } catch {
          const lighter = vertexCountOf(b) <= vertexCountOf(a) ? b : a;
          apart.push(lighter);
          partials.push(lighter === a ? b : a);
        }
      }
      return true;
    }
    if (unioned) partials.push(unioned);
    return true;
  };
  let merged = [];
  let chunksDone = 0;
  for (;;) {
    startOver = false;
    partials = [];
    apart = [];
    // The regions are all welded at the first asking. Asked here, where an
    // error in the welding is an error, and not inside a union, where it
    // would be taken for one more refusal.
    if (welding && regions.length) weld(geometryOf(regions[0]));
    let through = true;
    for (let index = 0; index < pieces.length; index += 1) {
      through = await unionPiece(pieces[index]);
      if (!through) break;
      // (A search that started over does not count its chunks back down.)
      if (index + 1 > chunksDone) {
        chunksDone = index + 1;
        onChunk?.(chunksDone);
      }
      await between();
    }
    if (through) merged = await mergeWithinBudget(partials, { union: unionOf, budget, between, shouldStop: halted, onApart: (part) => apart.push(part) });
    if (!startOver) break;
  }
  // Stopped: nothing was checked, so no "checked in N parts" either.
  if (stopped || shouldStop()) return stoppedEarly();
  // mergeWithinBudget hands back the parts it left apart with the rest.
  const all = [...merged, ...apart.filter((part) => !merged.includes(part))];
  const holes = all.flatMap((part) => gapsOf(part, { maxWidth, minWidth }));
  if (all.length < 2 && !partial) return { holes, parts: all.length, stopped: false, welded: welding, apart: apart.length };
  return { holes: dropCoveredHoles(holes, isCovered).sort(byWidthThenArea), parts: all.length, stopped: false, welded: welding, apart: apart.length };
};

const distanceToSegment = (p, a, b) => {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const vv = vx * vx + vy * vy;
  const t = vv > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / vv)) : 0;
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
};

// Whether a region is on a hole's rim: whether its boundary runs along one of
// the hole's edges. Asked at the middle of each edge, because a corner belongs
// to every region that meets there, one that touches the hole at that single
// point included. `segmentsNear(point, reach)` hands back the region's
// boundary segments around a point, as [a, b] pairs (the Workshop reads them
// from the region's index, indexBoundary above). A hole of a union is made of
// its regions' own boundaries, so the distance is zero; the metre is the
// save's rounding. (polygon-clipping joins edges that lie in one straight
// line, so where two regions share such a side end to end only the one at its
// middle is seen there. That can only count too few regions, which leaves a
// hole alone.)
export const holdsRim = (ring, segmentsNear, tolerance = 1) => {
  for (let i = 1; i < ring.length; i += 1) {
    const middle = [(ring[i - 1][0] + ring[i][0]) / 2, (ring[i - 1][1] + ring[i][1]) / 2];
    for (const [a, b] of segmentsNear(middle, tolerance)) {
      if (distanceToSegment(middle, a, b) <= tolerance) return true;
    }
  }
  return false;
};

// The holes of a gap search that are cracks, and are filled. With two or more
// regions on its rim a hole is a crack between regions, whatever its width up
// to maxWidth. With one it is that region's own water or void, and is filled
// only up to maxWidthInsideOneRegion. `rimRegionsOf(hole)` counts the regions
// on a hole's rim (two is as far as it needs to count) and is asked only about
// a hole wide enough for the answer to matter. `onLeftAlone(hole)` hears of
// each hole passed over, so the note after the save can say how many there
// were: a lagoon left open otherwise looks like a crack the cleanup missed.
export const cracksAmong = (holes, rimRegionsOf, {
  maxWidth = BORDER_CLEANUP.maxWidth,
  maxWidthInsideOneRegion = BORDER_CLEANUP.maxWidthInsideOneRegion,
  onLeftAlone,
} = {}) => {
  const alone = Math.min(maxWidth, maxWidthInsideOneRegion);
  return holes.filter((hole) => {
    if (hole.width <= alone || rimRegionsOf(hole) > 1) return true;
    onLeftAlone?.(hole);
    return false;
  });
};

// Whether what two regions share is a sliver, to be trimmed off the smaller
// one. `shared` is the area of all they share, whatever its width
// (geometry.js overlapGeoms), because a trim takes all of it.
export const isSliver = (shared, smallerArea, maxShare = BORDER_CLEANUP.maxSliverShare) =>
  count(shared) <= maxShare * count(smallerArea);

// What the two guards passed over during one sweep, for the note after the
// save: the holes cracksAmong left open and the pairs isSliver left
// overlapping. A follow-up pass comes across the same ones again around its
// repairs, so a hole is kept by where it is (its extent, to the metre) and a
// pair by its two regions' ids, in either order, and each counts once. A pair
// passed over on one pass can be a sliver on the next, once a repair has
// changed one of the two (a crack filled into the smaller region makes it
// larger): trimmed then, it was not left alone.
export const leftAloneTally = () => {
  const holes = new Set();
  const pairs = new Set();
  const pairKey = (idA, idB) => [idA, idB].sort().join("\n");
  return {
    hole: (hole) => {
      holes.add(hole.geom.getExtent().map((value) => Math.round(value)).join(","));
    },
    pair: (idA, idB) => {
      pairs.add(pairKey(idA, idB));
    },
    trimmed: (idA, idB) => {
      pairs.delete(pairKey(idA, idB));
    },
    counts: () => ({ holesLeftAlone: holes.size, pairsLeftAlone: pairs.size }),
  };
};

// Where a follow-up pass looks. A repair changes the map only inside its own
// footprint — the sliver a trim takes away, the crack a fill adds — so anything
// it exposes (the hairline between the winner and a third region that the
// trimmed sliver used to cover) lies within that footprint, and the first pass
// has already seen everything else. The footprints, padded, are the hotspots:
// the next pass reads the regions that reach one and keeps the holes that do.
export const hotspotsOf = (repairs, pad) =>
  repairs.map((repair) => {
    const [minX, minY, maxX, maxY] = repair.geom.getExtent();
    return [minX - pad, minY - pad, maxX + pad, maxY + pad];
  });

export const touchesHotspot = (extent, hotspots) =>
  hotspots.some((spot) => !(extent[2] < spot[0] || extent[0] > spot[2] || extent[3] < spot[1] || extent[1] > spot[3]));

const plural = (n, word) => `${formatCount(n)} ${word}${count(n) === 1 ? "" : word.endsWith("s") ? "es" : "s"}`;

// What a heavy map's sweep could not look at, said after the result. The
// parts a refused union left apart (partsApart) are among `parts` and have a
// line of their own (describeCleanupLeftAlone): a map in parts for that
// reason alone is not too detailed, and is not said to be.
const describeCleanupLimits = (result) => {
  let note = "";
  if (count(result.parts) - count(result.partsApart) > 1) {
    note += ` The map is too detailed to check in one piece, so it was checked in ${formatCount(result.parts)} parts.`;
  }
  const skipped = count(result.skippedPairs);
  if (skipped > 0) {
    note += ` ${plural(skipped, "pair")} of very large neighbouring regions ${skipped === 1 ? "was" : "were"} not compared.`;
  }
  return note;
};

// The one-line result shown after the save (and inside the loading screen
// while the map is being written).
// Why a sweep ended before it was done, when it did.
const describeStop = (result) => {
  const seconds = Math.max(1, Math.round(count(result.elapsedMs) / 1000));
  switch (result.stopped) {
    case "time":
      return `stopped after ${seconds} s because the map is too detailed to check fully within one save`;
    case "user":
      return `stopped after ${seconds} s at your request`;
    case "error":
      return `stopped after ${seconds} s (${result.error || "an error"})`;
    default:
      return "";
  }
};

export const describeCleanupResult = (result, error = "") => {
  if (error) return `Border cleanup was skipped (${error}); the map was saved as it is.`;
  if (!result) return "";
  const limits = describeCleanupLimits(result);
  const stop = describeStop(result);
  const left = count(result.repairsLeft) > 0
    ? ` ${plural(result.repairsLeft, "repair")} it had found ${count(result.repairsLeft) === 1 ? "was" : "were"} left for the next save.`
    : "";
  if (!result.changed) {
    if (stop) return `Border cleanup ${stop}; nothing was changed.${left}${limits}`;
    // Up to the width this sweep ran at: the quick clean's or the deep one's
    // (a result from before a save asked has none, and was the deep one).
    return `Borders checked: no cracks or slivers between ${BORDER_CLEANUP.minWidth} m and ${(count(result.maxWidth) || BORDER_CLEANUP.maxWidth) / 1000} km across ${plural(result.regionCount, "region")}.${limits}`;
  }
  const passes = count(result.passes) > 1 ? ` in ${plural(result.passes, "pass")}` : "";
  const repairs = `${plural(result.gaps, "crack")} filled and ${plural(result.overlaps, "sliver")} trimmed across ${plural(result.affectedRegions, "region")}`;
  if (stop) return `Borders partly cleaned${passes}: ${repairs}; the check ${stop}.${left}${limits}`;
  return `Borders cleaned${passes}: ${repairs}.${limits}`;
};

// What the two guards passed over, said under the result, a line each: without
// it a lagoon left open reads as a crack the cleanup missed, and a small
// region still lying over its neighbour as a sliver it missed. The sentences
// are in a *_TEXTS table because the string extractor reads those
// (scripts/i18n/), so the language packs carry each one whole, and the
// singular is a sentence of its own: a language cannot translate an "s". Each
// is shown in an element of its own, where the translator finds it by its
// pattern (BorderCleanupOverlay.jsx).
export const CLEANUP_LEFT_ALONE_TEXTS = Object.freeze({
  holeOne: "1 gap inside a single region was left open: it is treated as enclosed water, not a crack.",
  holeMany: "{{count}} gaps, each inside a single region, were left open: they are treated as enclosed water, not cracks.",
  pairOne: "1 pair of overlapping regions was left as it is: trimming would take too much of the smaller region.",
  pairMany: "{{count}} pairs of overlapping regions were left as they are: trimming would take too much of the smaller region.",
});

// What polygon-clipping refused, and welding did not cure: said the same way,
// a line each under the result, so a crack or a sliver still on the map
// after the save is not read as one the cleanup overlooked. `partsApart`
// counts the parts of the map no union could join to the rest
// (findEnclosedGaps), `pairsFailed` the neighbouring pairs whose overlap
// could not be worked out, and `repairsFailed` the cracks and slivers that
// were found and could not be filled or trimmed (OlMap.jsx
// repairTopologyEverywhere counts both, each once over all the passes).
export const CLEANUP_REFUSED_TEXTS = Object.freeze({
  apartOne: "1 part of the map could not be joined to the rest, so a crack along its edge may have been missed.",
  apartMany: "{{count}} parts of the map could not be joined to the rest, so cracks along their edges may have been missed.",
  pairOne: "1 pair of neighbouring regions could not be compared, so a sliver between them may have been missed.",
  pairMany: "{{count}} pairs of neighbouring regions could not be compared, so slivers between them may have been missed.",
  repairOne: "1 crack or sliver that was found could not be repaired, and was left as it is.",
  repairMany: "{{count}} cracks or slivers that were found could not be repaired, and were left as they are.",
});

const leftAloneLine = (n, one, many) => (count(n) === 1 ? one : many.replace("{{count}}", formatCount(n)));

// The lines for a sweep's result: `holesLeftAlone` counts the holes wider than
// maxWidthInsideOneRegion with one region on their rim (cracksAmong), and
// `pairsLeftAlone` the pairs that share more than maxSliverShare of the
// smaller region (isSliver); then what was refused (CLEANUP_REFUSED_TEXTS).
// No line for a count of zero.
export const describeCleanupLeftAlone = (result) => {
  const lines = [];
  if (count(result?.holesLeftAlone) > 0) {
    lines.push(leftAloneLine(result.holesLeftAlone, CLEANUP_LEFT_ALONE_TEXTS.holeOne, CLEANUP_LEFT_ALONE_TEXTS.holeMany));
  }
  if (count(result?.pairsLeftAlone) > 0) {
    lines.push(leftAloneLine(result.pairsLeftAlone, CLEANUP_LEFT_ALONE_TEXTS.pairOne, CLEANUP_LEFT_ALONE_TEXTS.pairMany));
  }
  if (count(result?.partsApart) > 0) {
    lines.push(leftAloneLine(result.partsApart, CLEANUP_REFUSED_TEXTS.apartOne, CLEANUP_REFUSED_TEXTS.apartMany));
  }
  if (count(result?.pairsFailed) > 0) {
    lines.push(leftAloneLine(result.pairsFailed, CLEANUP_REFUSED_TEXTS.pairOne, CLEANUP_REFUSED_TEXTS.pairMany));
  }
  if (count(result?.repairsFailed) > 0) {
    lines.push(leftAloneLine(result.repairsFailed, CLEANUP_REFUSED_TEXTS.repairOne, CLEANUP_REFUSED_TEXTS.repairMany));
  }
  return lines;
};

// What the loading screen shows for a progress state from
// repairTopologyEverywhere: a fraction for the bar (phases weighted by their
// measured cost; the bar restarts on a follow-up pass) and two lines of
// plain words. While the map is being written the second line is the result,
// and `leftAlone` the lines under it for what the guards passed over.
export const describeCleanupProgress = (state) => {
  if (!state) return { fraction: 0, headline: "Preparing", detail: "" };
  const regions = count(state.regionCount);
  // A follow-up pass walks only the regions around the last pass's repairs.
  const walked = count(state.passRegions) || regions;
  const scope = walked < regions ? `${plural(walked, "region")} around the last repairs` : plural(regions, "region");
  const share = (done, total) => (total > 0 ? Math.min(1, Math.max(0, done / total)) : 0);
  const pass = count(state.pass);
  const passLabel = pass > 1 ? `Pass ${pass} of up to ${count(state.maxPasses) || BORDER_CLEANUP.maxPasses}, checking the repairs left nothing behind — ` : "";
  switch (state.phase) {
    case "gaps": {
      const chunkCount = Math.max(1, count(state.chunkCount));
      const chunkIndex = count(state.chunkIndex);
      const merging = chunkIndex >= chunkCount;
      return {
        fraction: 0.05 + 0.2 * share(chunkIndex, chunkCount),
        headline: `${passLabel}looking for cracks between regions`,
        detail: merging
          ? `${scope} · merging ${plural(chunkCount, "chunk")} into one map and reading every enclosed gap`
          : `${scope} · merging chunk ${Math.min(chunkIndex + 1, chunkCount)} of ${chunkCount}`,
      };
    }
    case "overlaps":
      return {
        fraction: 0.25 + 0.5 * share(count(state.regionsChecked), walked),
        headline: `${passLabel}looking for thin slivers where regions overlap`,
        detail: `${formatCount(state.regionsChecked)} of ${scope} checked · ${plural(state.overlapsFound, "sliver")} so far · ${plural(state.gapsFound, "crack")} found`,
      };
    case "apply": {
      const total = count(state.repairCount);
      return {
        fraction: 0.75 + 0.2 * share(count(state.repairsDone), total),
        headline: total ? `${passLabel}repairing` : `${passLabel}nothing to repair`,
        detail: total
          ? `${formatCount(state.repairsDone)} of ${plural(total, "repair")} this pass · ${plural(state.gapsFilled, "crack")} filled, ${plural(state.overlapsTrimmed, "sliver")} trimmed so far`
          : "",
      };
    }
    case "save":
      return {
        fraction: 0.97,
        // The standalone editor has no scenario: there the map is being
        // written to a file (MapEditor.jsx exportFromMenu).
        headline: state.exporting ? "exporting the map" : "saving the map into the scenario",
        detail: describeCleanupResult(state.result, state.error),
        leftAlone: describeCleanupLeftAlone(state.result),
      };
    default:
      return { fraction: 1, headline: "done", detail: "" };
  }
};
