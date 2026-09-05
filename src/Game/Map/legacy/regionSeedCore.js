/*! Open Historia — regions.geojson single-pass indexer © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Pure, dependency-free single pass over a scenario's regions FeatureCollection
// that produces everything the map needs: the owner/provenance index for every
// region (tile fills, click resolution, labels), the authored shapes for
// rendering at every zoom, and a COARSE copy of the plain GADM shapes for the
// far tier. The full-resolution geometry is dropped — geojson-vt tiling of 2.6M+
// vertices and O(vertices) passes over it were the multi-second startup freeze.
//
// Runs identically on the main thread (fallback) and inside regionSeedWorker.js.

// ---- the far tier's geometry ----------------------------------------------
// The stock vector tiles are simplified per zoom, and each region is simplified
// independently, so at low zoom neighbouring borders drift apart and the map
// shows sliver gaps between provinces. The far tier hides that by painting the
// same provinces from the scenario's own geometry below z7, crossfading out as
// the tiles fade in (z5.5 -> z6.5 in Nations.jsx).
//
// It cannot use the raw geometry: that is what froze startup. So the shapes are
// coarsened here, in the worker, where the full document already is — and the
// budget is generous because the tier is only ever seen zoomed OUT.
//
// COARSE_TOLERANCE_DEG is the Douglas-Peucker band. The map runs ~0.0155 deg/px
// at z5.5 (where the tier is fully opaque) and ~0.0078 at z6.5 (where it has
// faded to nothing), so 0.01 deg is 0.64px at z5.5 — already under what a screen
// can show. Tightening it further buys nothing visible and costs vertices
// linearly (0.005 doubles them for 0.32px), which is why the flicker fix below
// spends its budget on RINGS instead of on shape.
//
// COARSE_MIN_SPAN_DEG drops whole rings too small to see, and is the knob that
// has to be set against FLICKER rather than against detail. A ring the tier drops
// is still in the stock tiles, so it blinks into existence as they fade in — and
// at the first setting (0.0155, a full pixel at z5.5) that was 93,000 rings
// appearing across the crossfade, which reads as shimmer over any coast or
// archipelago. At a third of a pixel it cannot be seen arriving. The cost of the
// tighter figure is small and almost all of it is structured-clone time out of
// the worker: 602k -> 694k vertices, 18k -> 41k rings, index unchanged at ~130ms,
// clone 127ms -> 164ms. Still a third of the 2.57M vertices that froze startup.
//
// Dropping a ring is not dropping a region: only a polygon whose OUTER ring goes
// is removed, and a region keeps every part still big enough to see.
export const COARSE_TOLERANCE_DEG = 0.01;
export const COARSE_MIN_SPAN_DEG = 0.005;

// Squared perpendicular distance from p to segment ab. Squared throughout so the
// hot loop never calls Math.sqrt.
const segmentDistanceSq = (p, a, b) => {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
};

// Douglas-Peucker, iterative rather than recursive: a single coastline ring here
// can run to tens of thousands of points, and recursing that deep risks the
// stack. First and last points are always kept, which is what keeps a ring
// closed.
export const simplifyRing = (ring, toleranceSq) => {
  if (ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop();
    let furthest = -1;
    let best = toleranceSq;
    for (let i = lo + 1; i < hi; i += 1) {
      const d = segmentDistanceSq(ring[i], ring[lo], ring[hi]);
      if (d > best) {
        best = d;
        furthest = i;
      }
    }
    if (furthest !== -1) {
      keep[furthest] = 1;
      stack.push([lo, furthest], [furthest, hi]);
    }
  }
  const out = [];
  for (let i = 0; i < ring.length; i += 1) if (keep[i]) out.push(ring[i]);
  return out;
};

const ringSpan = (ring) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    if (point[0] < minX) minX = point[0];
    if (point[0] > maxX) maxX = point[0];
    if (point[1] < minY) minY = point[1];
    if (point[1] > maxY) maxY = point[1];
  }
  return Math.max(maxX - minX, maxY - minY);
};

// One polygon: [outerRing, ...holes]. A hole too small to see is dropped on its
// own; if the OUTER ring goes, the whole polygon does, because a hole without
// its shell would paint as land.
const coarsenPolygon = (rings, toleranceSq, minSpan) => {
  const out = [];
  for (let i = 0; i < rings.length; i += 1) {
    const isOuter = i === 0;
    if (ringSpan(rings[i]) < minSpan) {
      if (isOuter) return null;
      continue;
    }
    const simplified = simplifyRing(rings[i], toleranceSq);
    // Under four points there is no area left to fill: a closed ring repeats its
    // first point, so three entries is a degenerate sliver, not a triangle.
    if (simplified.length < 4) {
      if (isOuter) return null;
      continue;
    }
    out.push(simplified);
  }
  return out.length > 0 ? out : null;
};

// Every plain GADM region the tiles paint MUST also have far-tier geometry, or
// the z5.5->6.5 crossfade leaves a hole where the tiles have faded out and
// nothing has faded in. That is not hypothetical: Pukapuka in the Cook Islands is
// a MultiPolygon of atolls scattered over 2.8 degrees of ocean. Every individual
// ring is well under COARSE_MIN_SPAN_DEG, so the span test dropped all of them
// and the whole region — 182px wide at z5.5 — disappeared for a whole zoom band.
//
// So when nothing survives the thresholds, keep the biggest single ring anyway.
// The region ends up drawn as one speck rather than several, which at these
// zooms is what it looked like regardless.
const largestOuterRing = (geometry) => {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let best = null;
  let bestSpan = -1;
  for (const rings of polygons) {
    if (!rings?.length) continue;
    const span = ringSpan(rings[0]);
    if (span > bestSpan) {
      bestSpan = span;
      best = rings[0];
    }
  }
  return best;
};

export const coarsenGeometry = (geometry, {
  toleranceDeg = COARSE_TOLERANCE_DEG,
  minSpanDeg = COARSE_MIN_SPAN_DEG,
} = {}) => {
  const toleranceSq = toleranceDeg * toleranceDeg;
  let coarsened = null;
  if (geometry?.type === "Polygon") {
    const rings = coarsenPolygon(geometry.coordinates, toleranceSq, minSpanDeg);
    coarsened = rings ? { type: "Polygon", coordinates: rings } : null;
  } else if (geometry?.type === "MultiPolygon") {
    const polygons = [];
    for (const polygon of geometry.coordinates) {
      const rings = coarsenPolygon(polygon, toleranceSq, minSpanDeg);
      if (rings) polygons.push(rings);
    }
    coarsened = polygons.length > 0 ? { type: "MultiPolygon", coordinates: polygons } : null;
  } else {
    return null;
  }
  if (coarsened) return coarsened;

  const ring = largestOuterRing(geometry);
  if (!ring || ring.length < 4) return null;
  const simplified = simplifyRing(ring, toleranceSq);
  // Simplifying can flatten a speck below the four points a fill needs; the raw
  // ring is tiny by definition here, so keeping it costs nothing.
  return { type: "Polygon", coordinates: [simplified.length >= 4 ? simplified : ring] };
};

export const indexRegionFeatureCollection = (data, options = {}) => {
  const ownersById = new Map(); // region id -> seed owner ("" = unowned)
  const propsById = new Map(); // region id -> compact props record
  const authoredFeatures = [];
  const coarseFeatures = [];
  let hasDrawn = false;
  let hasGadm = false;
  for (const feature of data?.features ?? []) {
    const props = feature.properties || {};
    const id = String(props.id ?? "");
    if (!id) continue;
    propsById.set(id, {
      owner: props.owner ?? "",
      gid0: props.gid0 ?? "",
      name: props.name ?? "",
      edited: props.edited === true,
      claimants: Array.isArray(props.claimants) && props.claimants.length ? props.claimants : null,
    });
    ownersById.set(id, props.owner ?? "");
    if (!id.includes(".")) {
      authoredFeatures.push(feature);
      hasDrawn = true;
    } else {
      hasGadm = true;
      if (props.edited === true) {
        // A reshaped GADM region renders from the authored collection at every
        // zoom, so it must NOT also appear in the far tier — two fills at 0.72
        // stacked on the same ground darkens it.
        authoredFeatures.push(feature);
      } else {
        const geometry = coarsenGeometry(feature.geometry, options);
        if (geometry) coarseFeatures.push({ type: "Feature", properties: { id }, geometry });
      }
    }
  }
  return {
    ownersById,
    propsById,
    authoredFC: { type: "FeatureCollection", features: authoredFeatures },
    // Plain (unedited) GADM shapes, coarsened for the far tier. Carries only
    // `id`: the fill colour is a match expression built on the main thread from
    // live ownership, so nothing baked in here can go stale when a province
    // changes hands.
    coarseFC: { type: "FeatureCollection", features: coarseFeatures },
    hasDrawn,
    hasGadm,
  };
};

export const emptyRegionSeed = () => indexRegionFeatureCollection({ type: "FeatureCollection", features: [] });
