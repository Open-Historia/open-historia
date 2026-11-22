/*!
 * OpenHistoria Beta Map Editor - validated scissors cut.
 *
 * Split a polygon into two disjoint coverages using a drawn, non-self-crossing
 * polyline. For MultiPolygons, each component polygon is checked independently
 * against the drawn cut so extending endpoints to a component's bounds never
 * slices unrelated islands. The original region's stable ID stays with the
 * larger piece; a new ID is assigned only to the smaller piece. Invalid cuts
 * fail before mutation.
 */
import polygonClipping from "polygon-clipping";
import Feature from "ol/Feature.js";
import Polygon from "ol/geom/Polygon.js";
import MultiPolygon from "ol/geom/MultiPolygon.js";
import { planarGeometryArea } from "./geometry.js";
import { restoreCarvedEdited } from "./regionCarveHistory.js";

const EPSILON = 1e-8;

const coordsOf = (geometry) => (
  geometry.getType() === "Polygon" ? [geometry.getCoordinates()] : geometry.getCoordinates()
);

const asGeometry = (coords) => (
  coords.length === 1 ? new Polygon(coords[0]) : new MultiPolygon(coords)
);

const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

const segLen = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

const onSegment = (a, b, p) => {
  const tol = EPSILON * Math.max(1, segLen(a, b));
  return (
    p[0] >= Math.min(a[0], b[0]) - tol
    && p[0] <= Math.max(a[0], b[0]) + tol
    && p[1] >= Math.min(a[1], b[1]) - tol
    && p[1] <= Math.max(a[1], b[1]) + tol
  );
};

// Detects proper crossings, T-junctions, and collinear overlapping segments,
// using scale-normalized cross-product tolerances so Web Mercator coordinates
// (millions of meters) do not lose collinearity detection.
const segmentsIntersect = (a, b, c, d) => {
  const abLen = segLen(a, b);
  const cdLen = segLen(c, d);
  const abTol = EPSILON * Math.max(1, abLen * Math.max(segLen(a, c), segLen(a, d), 1));
  const cdTol = EPSILON * Math.max(1, cdLen * Math.max(segLen(c, a), segLen(c, b), 1));
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);

  if (((abC > abTol && abD < -abTol) || (abC < -abTol && abD > abTol))
    && ((cdA > cdTol && cdB < -cdTol) || (cdA < -cdTol && cdB > cdTol))) {
    return true;
  }
  if (Math.abs(abC) <= abTol && onSegment(a, b, c)) return true;
  if (Math.abs(abD) <= abTol && onSegment(a, b, d)) return true;
  if (Math.abs(cdA) <= cdTol && onSegment(c, d, a)) return true;
  if (Math.abs(cdB) <= cdTol && onSegment(c, d, b)) return true;
  return false;
};

const validPath = (points) => {
  if (!Array.isArray(points) || points.length < 2 || points.length > 4000) return false;
  for (let i = 0; i < points.length; i++) {
    if (
      !Array.isArray(points[i])
      || points[i].length < 2
      || !Number.isFinite(points[i][0])
      || !Number.isFinite(points[i][1])
    ) {
      return false;
    }
    if (i && Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]) < EPSILON) {
      return false;
    }
    // Reject backtracking collinear adjacent segments (A -> B -> A).
    if (i >= 2) {
      const prevDx = points[i - 1][0] - points[i - 2][0];
      const prevDy = points[i - 1][1] - points[i - 2][1];
      const nextDx = points[i][0] - points[i - 1][0];
      const nextDy = points[i][1] - points[i - 1][1];
      const prevLen = Math.hypot(prevDx, prevDy);
      const nextLen = Math.hypot(nextDx, nextDy);
      const collinearTol = EPSILON * Math.max(1, prevLen * nextLen);
      if (Math.abs(prevDx * nextDy - prevDy * nextDx) <= collinearTol && (prevDx * nextDx + prevDy * nextDy) < 0) {
        return false;
      }
    }
  }
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = i + 2; j < points.length - 1; j++) {
      if (segmentsIntersect(points[i], points[i + 1], points[j], points[j + 1])) return false;
    }
  }
  return true;
};

const rayExit = (point, other, [xmin, ymin, xmax, ymax]) => {
  const dx = point[0] - other[0];
  const dy = point[1] - other[1];
  const hits = [];
  if (dx !== 0) {
    for (const x of [xmin, xmax]) {
      const t = (x - point[0]) / dx;
      const y = point[1] + t * dy;
      if (t > 0 && y >= ymin - 1e-6 && y <= ymax + 1e-6) {
        hits.push({ t, point: [x, Math.max(ymin, Math.min(ymax, y))] });
      }
    }
  }
  if (dy !== 0) {
    for (const y of [ymin, ymax]) {
      const t = (y - point[1]) / dy;
      const x = point[0] + t * dx;
      if (t > 0 && x >= xmin - 1e-6 && x <= xmax + 1e-6) {
        hits.push({ t, point: [Math.max(xmin, Math.min(xmax, x)), y] });
      }
    }
  }
  hits.sort((left, right) => left.t - right.t);
  return hits[0]?.point ?? null;
};

const boundaryPath = (from, to, [xmin, ymin, xmax, ymax]) => {
  const width = xmax - xmin;
  const height = ymax - ymin;
  const perimeter = 2 * (width + height);
  const along = ([x, y]) => {
    if (y === ymin) return x - xmin;
    if (x === xmax) return width + y - ymin;
    if (y === ymax) return width + height + xmax - x;
    if (x === xmin) return 2 * width + height + ymax - y;
    throw new Error("Scissors endpoint does not reach the enclosing rectangle.");
  };
  const t0 = along(from);
  const t1 = along(to);
  const stop = t1 <= t0 ? t1 + perimeter : t1;
  const corners = [
    [width, [xmax, ymin]],
    [width + height, [xmax, ymax]],
    [2 * width + height, [xmin, ymax]],
    [perimeter, [xmin, ymin]],
  ];
  const nodes = [];
  for (const [t, point] of corners) {
    for (const lap of [0, 1]) {
      const at = t + lap * perimeter;
      if (at > t0 + EPSILON && at < stop - EPSILON) nodes.push([at, point]);
    }
  }
  nodes.sort((left, right) => left[0] - right[0]);
  return [from, ...nodes.map(([, point]) => point), to];
};

const polygonExtent = (polyCoords) => {
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (const ring of polyCoords) {
    for (const [x, y] of ring) {
      if (x < xmin) xmin = x;
      if (y < ymin) ymin = y;
      if (x > xmax) xmax = x;
      if (y > ymax) ymax = y;
    }
  }
  return [xmin, ymin, xmax, ymax];
};

const polylineExtent = (points) => {
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (const [x, y] of points) {
    if (x < xmin) xmin = x;
    if (y < ymin) ymin = y;
    if (x > xmax) xmax = x;
    if (y > ymax) ymax = y;
  }
  return [xmin, ymin, xmax, ymax];
};

const extentsOverlap = (a, b) => (
  a[0] <= b[2] + EPSILON && a[2] >= b[0] - EPSILON && a[1] <= b[3] + EPSILON && a[3] >= b[1] - EPSILON
);

const pointInRing = (point, ring) => {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = ((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
};

const pointInPolygonCoords = (point, polyCoords) => (
  polyCoords.length > 0
  && pointInRing(point, polyCoords[0])
  && !polyCoords.slice(1).some((hole) => pointInRing(point, hole))
);

const polylineTouchesPolygon = (points, polyCoords) => {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    for (const ring of polyCoords) {
      for (let j = 0; j < ring.length - 1; j++) {
        if (segmentsIntersect(a, b, ring[j], ring[j + 1])) return true;
      }
    }
  }
  return points.some((point) => pointInPolygonCoords(point, polyCoords));
};

const buildCutHalves = (extent, points) => {
  const xmin = Math.min(extent[0], ...points.map((p) => p[0]));
  const ymin = Math.min(extent[1], ...points.map((p) => p[1]));
  const xmax = Math.max(extent[2], ...points.map((p) => p[0]));
  const ymax = Math.max(extent[3], ...points.map((p) => p[1]));
  const pad = Math.max(10, Math.max(xmax - xmin, ymax - ymin) * 0.1);
  const bounds = [xmin - pad, ymin - pad, xmax + pad, ymax + pad];

  const startExit = rayExit(points[0], points[1], bounds);
  const endExit = rayExit(points[points.length - 1], points[points.length - 2], bounds);
  if (!startExit || !endExit || Math.hypot(startExit[0] - endExit[0], startExit[1] - endExit[1]) < 1e-7) {
    return null;
  }
  const line = [startExit, ...points, endExit];
  if (!validPath(line)) return null;
  const forward = boundaryPath(endExit, startExit, bounds);
  const backward = boundaryPath(startExit, endExit, bounds).reverse();
  return {
    firstHalf: [...line, ...forward.slice(1)],
    secondHalf: [...line, ...backward.slice(1)],
  };
};

const clipPolygonByHalves = (polyCoords, halves) => {
  try {
    const leftCoords = polygonClipping.intersection([polyCoords], [halves.firstHalf]) || [];
    const rightCoords = polygonClipping.intersection([polyCoords], [halves.secondHalf]) || [];
    return { leftCoords, rightCoords };
  } catch {
    return null;
  }
};

const coordsArea = (multiCoords) => (multiCoords?.length ? planarGeometryArea(asGeometry(multiCoords)) : 0);

export const splitGeometryByLine = (geometry, rawPoints) => {
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.getType?.())) return null;
  const points = rawPoints?.map((point) => (Array.isArray(point) ? point.slice(0, 2) : point));
  if (!validPath(points)) return null;
  const extent = geometry.getExtent();
  if (!extent.every(Number.isFinite)) return null;

  const halves = buildCutHalves(extent, points);
  if (!halves) return null;

  const components = coordsOf(geometry);
  const cutBox = polylineExtent(points);
  const leftParts = [];
  const rightParts = [];
  const tiedUntouchedParts = [];

  for (const polyCoords of components) {
    const compExtent = polygonExtent(polyCoords);
    const touched = components.length === 1
      || (extentsOverlap(compExtent, cutBox) && polylineTouchesPolygon(points, polyCoords));
    const clipped = clipPolygonByHalves(polyCoords, halves);
    if (!clipped) {
      if (touched) return null;
      tiedUntouchedParts.push(polyCoords);
      continue;
    }
    const { leftCoords, rightCoords } = clipped;
    if (touched) {
      if (leftCoords.length && rightCoords.length) {
        leftParts.push(...leftCoords);
        rightParts.push(...rightCoords);
      } else if (components.length === 1) {
        return null;
      } else if (leftCoords.length) {
        leftParts.push(polyCoords);
      } else if (rightCoords.length) {
        rightParts.push(polyCoords);
      }
      continue;
    }

    // Untouched MultiPolygon islands are never sliced by extended ray projections:
    // assign each intact island to whichever side of the cut holds its majority area
    // (tie-breaking to the larger side when split evenly along an extended ray).
    const leftArea = coordsArea(leftCoords);
    const rightArea = coordsArea(rightCoords);
    const compArea = leftArea + rightArea;
    if (Math.abs(leftArea - rightArea) <= Math.max(1e-4, compArea * 1e-6)) {
      tiedUntouchedParts.push(polyCoords);
    } else if (leftArea > rightArea) {
      leftParts.push(polyCoords);
    } else {
      rightParts.push(polyCoords);
    }
  }

  if (!leftParts.length || !rightParts.length) return null;

  let leftGeom = asGeometry(leftParts);
  let rightGeom = asGeometry(rightParts);
  if (tiedUntouchedParts.length) {
    if (planarGeometryArea(leftGeom) >= planarGeometryArea(rightGeom)) {
      leftGeom = asGeometry([...leftParts, ...tiedUntouchedParts]);
    } else {
      rightGeom = asGeometry([...rightParts, ...tiedUntouchedParts]);
    }
  }

  const total = planarGeometryArea(geometry);
  const firstArea = planarGeometryArea(leftGeom);
  const secondArea = planarGeometryArea(rightGeom);
  const minPiece = Math.max(1e-4, total * 1e-8);
  if (
    firstArea <= minPiece
    || secondArea <= minPiece
    || Math.abs(firstArea + secondArea - total) > Math.max(0.01, total * 1e-6)
  ) {
    return null;
  }
  return firstArea >= secondArea ? [leftGeom, rightGeom] : [rightGeom, leftGeom];
};

export const splitRegionFeature = (source, original, points, makeId) => {
  if (!source || !original || source.getFeatureById(original.getId()) !== original) return null;
  const geometry = original.getGeometry();
  const parts = splitGeometryByLine(geometry, points);
  if (!parts) return null;
  const id = String(makeId?.() ?? "");
  if (!id || source.getFeatureById(id)) return null;
  const props = { ...original.getProperties() };
  delete props.geometry;
  delete props.id;
  // A newly drawn piece is not stock GADM geometry or the original geographic
  // provenance; inherited claims, owner, type and group remain authored facts.
  for (const field of Object.keys(props)) if (/^gid\d*$/i.test(field)) delete props[field];
  props.gid0 = "";
  props.name = `${String(original.get("name") || "Region")} (split)`;
  props.edited = true;
  if (Array.isArray(props.claimants)) props.claimants = props.claimants.slice();
  const created = new Feature({ ...props, geometry: parts[1].clone() });
  created.setId(id);
  const before = geometry.clone();
  const edited = original.get("edited");
  const apply = () => {
    original.setGeometry(parts[0].clone());
    original.set("edited", true);
    source.addFeature(created);
  };
  try {
    apply();
  } catch {
    if (source.getFeatureById(id) === created) source.removeFeature(created);
    original.setGeometry(before.clone());
    restoreCarvedEdited(original, edited);
    return null;
  }
  return {
    retainedId: original.getId(),
    createdId: id,
    undo: () => {
      if (source.getFeatureById(id) === created) source.removeFeature(created);
      original.setGeometry(before.clone());
      restoreCarvedEdited(original, edited);
    },
    redo: apply,
  };
};
