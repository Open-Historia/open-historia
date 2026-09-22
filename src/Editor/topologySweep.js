/*!
 * Open Historia Map Editor — save-time border cleanup
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Every scenario save (Save, Save & Exit, Apply & Play) first runs the Topology
// panel's conservative repair over EVERY region — enclosed cracks narrower than
// 500 m filled, thin overlaps trimmed — before the map is written
// (MapEditor.jsx persistScenario → OlMap.jsx repairTopologyEverywhere). This
// module is the pure part: how regions are grouped for the staged union, and
// what the loading screen says.
//
// The pass is not all-pairs. Overlap discovery asks the map's spatial index for
// extent neighbours only (the stock 4,848-region world: 14,011 pairs, ~3 s),
// and the gap search reads the holes of ONE union of every region on the map.
// That union is built in stages — each chunk of regions unioned, then the chunk
// results unioned — which is the same polygon set as a single call (union is
// associative; the stock world yields the identical 324 cracks crack by crack)
// with bounded memory (414 MB → ~200 MB of heap on the stock world) and a
// repaint between chunks. Searching each chunk on its own was rejected: a crack
// longer than a chunk, such as a double-traced border between two large
// countries, can have both end-caps outside any one chunk and go unseen.
//
// Two more measured facts shape the pass. Trimming a sliver can expose a
// hairline between the winner and a third region the trimmed region used to
// cover, so the pass repeats until it finds nothing (the stock world: 98
// cracks and 57 slivers, then nothing). And the save writes coordinates at
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

export const BORDER_CLEANUP = Object.freeze({
  // Metres in the map projection: the Topology panel's default tolerance.
  maxWidth: 500,
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
  // own ceiling. The stock 4,848-region map is 236,003 vertices in all, so it
  // is always one union, exactly as before.
  maxUnionVertices: 250_000,
});

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
    // The second half goes on the stack first, so the first half is split next.
    stack.push(rows.slice(half).map((row) => row.region));
    stack.push(rows.slice(0, half).map((row) => row.region));
  }
  return pieces;
};

// The chunk results merged back into one union without ever handing a single
// call more than the budget. When they fit together, that is the one call the
// sweep always made. When they do not, neighbours are merged in pairs, round
// after round, until one union is left or no neighbouring pair fits; what is
// left is the map in parts.
export const mergeWithinBudget = async (parts, { union, verticesOf = vertexCountOf, budget = BORDER_CLEANUP.maxUnionVertices, between } = {}) => {
  let level = parts.filter(Boolean);
  if (level.length < 2) return level;
  let total = 0;
  for (const part of level) total += count(verticesOf(part));
  if (total <= budget) {
    const whole = union(level);
    return whole ? [whole] : [];
  }
  let merged = true;
  while (merged && level.length > 1) {
    const next = [];
    merged = false;
    let i = 0;
    while (i < level.length) {
      const a = level[i];
      const b = level[i + 1];
      if (b !== undefined && count(verticesOf(a)) + count(verticesOf(b)) <= budget) {
        const joined = union([a, b]);
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
  return level;
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
}) => {
  const verticesOf = (region) => vertexCountOf(geometryOf(region));
  const extentOf = (region) => geometryOf(region).getExtent();
  const pieces = bucketRegions(plan, regions, extentOf)
    .flatMap((bucket) => splitByVertexBudget(bucket, { verticesOf, extentOf, budget }));
  onChunks?.(pieces.length);
  const partials = [];
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index];
    // A region heavier than the budget goes in as it is: the union of one
    // polygon is that polygon, and handing it to polygon-clipping alone is the
    // very call the budget exists to avoid.
    const heavyAlone = piece.length === 1 && verticesOf(piece[0]) > budget;
    const unioned = heavyAlone ? geometryOf(piece[0]) : union(piece.map(geometryOf));
    if (unioned) partials.push(unioned);
    onChunk?.(index + 1);
    await between();
  }
  const merged = await mergeWithinBudget(partials, { union, budget, between });
  const holes = merged.flatMap((part) => gapsOf(part, { maxWidth, minWidth }));
  if (merged.length < 2) return { holes, parts: merged.length };
  return { holes: dropCoveredHoles(holes, isCovered).sort(byWidthThenArea), parts: merged.length };
};

const plural = (n, word) => `${formatCount(n)} ${word}${count(n) === 1 ? "" : word.endsWith("s") ? "es" : "s"}`;

// What a heavy map's sweep could not look at, said after the result.
const describeCleanupLimits = (result) => {
  let note = "";
  if (count(result.parts) > 1) {
    note += ` The map is too detailed to check in one piece, so it was checked in ${formatCount(result.parts)} parts.`;
  }
  const skipped = count(result.skippedPairs);
  if (skipped > 0) {
    note += ` ${plural(skipped, "pair")} of very large neighbouring regions ${skipped === 1 ? "was" : "were"} not compared.`;
  }
  return note;
};

// The one-line result shown after the save (and inside the loading screen
// while the scenario is being written).
export const describeCleanupResult = (result, error = "") => {
  if (error) return `Border cleanup was skipped (${error}); the map was saved as it is.`;
  if (!result) return "";
  const limits = describeCleanupLimits(result);
  if (!result.changed) {
    return `Borders checked: no cracks or slivers between ${BORDER_CLEANUP.minWidth} m and ${BORDER_CLEANUP.maxWidth} m across ${plural(result.regionCount, "region")}.${limits}`;
  }
  const passes = count(result.passes) > 1 ? ` in ${plural(result.passes, "pass")}` : "";
  return `Borders cleaned${passes}: ${plural(result.gaps, "crack")} filled and ${plural(result.overlaps, "sliver")} trimmed across ${plural(result.affectedRegions, "region")}.${limits}`;
};

// What the loading screen shows for a progress state from
// repairTopologyEverywhere: a fraction for the bar (phases weighted by their
// measured cost; the bar restarts on a follow-up pass) and two lines of
// plain words.
export const describeCleanupProgress = (state) => {
  if (!state) return { fraction: 0, headline: "Preparing", detail: "" };
  const regions = count(state.regionCount);
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
          ? `${plural(regions, "region")} · merging ${plural(chunkCount, "chunk")} into one map and reading every enclosed gap`
          : `${plural(regions, "region")} · merging chunk ${Math.min(chunkIndex + 1, chunkCount)} of ${chunkCount}`,
      };
    }
    case "overlaps":
      return {
        fraction: 0.25 + 0.5 * share(count(state.regionsChecked), regions),
        headline: `${passLabel}looking for thin slivers where regions overlap`,
        detail: `${formatCount(state.regionsChecked)} of ${plural(regions, "region")} checked · ${plural(state.overlapsFound, "sliver")} so far · ${plural(state.gapsFound, "crack")} found`,
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
        headline: "saving the map into the scenario",
        detail: describeCleanupResult(state.result, state.error),
      };
    default:
      return { fraction: 1, headline: "done", detail: "" };
  }
};
