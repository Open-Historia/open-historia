/*! Open Historia — map projections: how a scenario's own map is laid on the screen © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Every map in the game is drawn in Web Mercator, whose whole world is a
// SQUARE: 360 degrees across, and from 85.05 north to 85.05 south. A scenario's
// own picture (a fantasy continent, a galaxy) was always stretched over that
// square whatever its shape, and its regions were drawn as places on a globe.
// So a picture that is not square was squeezed (a 2:1 picture lost half its
// width: a round galaxy became an egg), and a scenario laid out on its picture
// with the rows evenly spaced, as a person or a tool writes when no globe is
// meant, had every shape stretched toward the top and bottom as Greenland is,
// and none of them where the picture showed them.
//
// A scenario's map now has a PROJECTION: Mercator, which is what every map was
// and stays unless it says otherwise; another world projection
// (equirectangular, Robinson, Mollweide…); or FREEFORM, a flat sheet of any
// shape with no globe behind it.
//
// HOW IT IS DRAWN. The renderers still draw Mercator: they cannot draw another
// projection. So a map in projection P is kept ALREADY LAID OUT: every place
// is stored at the spot on the Mercator plane where P puts it. The plane is
// the square, 2π wide; P's whole world, whose outline is as wide as the plane,
// sits centred on it; and what is stored is that spot as an ordinary longitude
// and latitude. A map kept that way is ordinary data to everything that draws
// or reads it, and simply looks like P. world.projection records what it is
// ({ type, laidOut: true }, and `aspect` for freeform), which is what lets it
// be converted to another projection later, and lets a reader recover the
// true longitude and latitude (displayToGeo).
//
// WHERE THE PICTURE LIES. world.background may carry `bounds`
// ({ west, south, east, north }, degrees as stored). With bounds the picture
// is laid on that rectangle; without, it fills the square, as it always did,
// so a scenario made before this looks exactly as it looked. sheetBounds()
// is the rectangle of a projection's sheet.
//
// A FILE SAYS SO. A scenario file may declare its projection without being
// laid out: world.projection = "equirectangular" (or { type, aspect }) with
// its places as true longitudes and latitudes, or, for freeform, as x and y
// spread evenly over a sheet 360 by 180. On import the game lays it out once
// (layOutScenarioBundle) and marks it laidOut, so it is never done twice and
// an export of the imported scenario is an ordinary file.
//
// CONVERTING. Between two world projections a place goes back to its true
// longitude and latitude and out again (convertPlane). To or from freeform
// there is no globe to go through: the sheet's rectangle is stretched onto the
// other one, so a map follows its picture when the picture is reshaped.
//
// DELIBERATELY IMPORT-FREE: the server, the website's store, the three maps
// that draw a picture and the Workshop all load it.

const { PI, sqrt, sin, cos, tan, asin, atan, sinh, asinh, exp, log, abs, min, max } = Math;
const RAD = PI / 180;
const clamp = (value, low, high) => min(high, max(low, value));
// (+ 0: a height of minus nothing is nothing.)
const round = (value, places = 6) => Number(value.toFixed(places)) + 0;

// The edge of the Mercator square.
export const MERCATOR_MAX_LAT = 85.0511287798066;
const MERCATOR_MAX_PHI = MERCATOR_MAX_LAT * RAD;

export const DEFAULT_PROJECTION = "mercator";
export const FREEFORM = "freeform";

// ---------------------------------------------------------------------------
// The projections: forward (λ, φ in radians) to the projection's own plane,
// and back. Each is a world map whose outline is widest at the equator.
// ---------------------------------------------------------------------------

const ROBINSON_X = [1, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962, 0.8679, 0.835, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322];
const ROBINSON_Y = [0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1];
const ROBINSON_STEP = 5 * RAD;
// The table read between its rows, a straight line from one to the next: what
// the inverse below undoes exactly.
const robinsonAt = (table, phiAbs) => {
  const position = clamp(phiAbs / ROBINSON_STEP, 0, 18);
  const row = min(17, Math.floor(position));
  return table[row] + (table[row + 1] - table[row]) * (position - row);
};

const EE_A1 = 1.340264;
const EE_A2 = -0.081106;
const EE_A3 = 0.000893;
const EE_A4 = 0.003796;
const EE_M = sqrt(3) / 2;
const equalEarthY = (theta) => { const t2 = theta * theta; const t6 = t2 * t2 * t2; return theta * (EE_A1 + EE_A2 * t2 + t6 * (EE_A3 + EE_A4 * t2)); };
const equalEarthDY = (theta) => { const t2 = theta * theta; const t6 = t2 * t2 * t2; return EE_A1 + 3 * EE_A2 * t2 + t6 * (7 * EE_A3 + 9 * EE_A4 * t2); };

const naturalEarthY = (phi) => { const p2 = phi * phi; const p4 = p2 * p2; return phi * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))); };
const naturalEarthDY = (phi) => { const p2 = phi * phi; const p4 = p2 * p2; return 1.007226 + p2 * (0.015085 * 3 + p4 * (-0.044475 * 7 + 0.028874 * 9 * p2 - 0.005916 * 11 * p4)); };
const naturalEarthX = (phi) => { const p2 = phi * phi; const p4 = p2 * p2; return 0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)); };

const newton = (value, derivative, target, start) => {
  let guess = start;
  for (let step = 0; step < 30; step += 1) {
    const delta = (value(guess) - target) / derivative(guess);
    guess -= delta;
    if (abs(delta) < 1e-12) break;
  }
  return guess;
};

const MATH = {
  mercator: {
    forward: (lambda, phi) => [lambda, asinh(tan(clamp(phi, -MERCATOR_MAX_PHI, MERCATOR_MAX_PHI)))],
    inverse: (x, y) => [x, atan(sinh(y))],
  },
  equirectangular: {
    forward: (lambda, phi) => [lambda, phi],
    inverse: (x, y) => [x, y],
  },
  miller: {
    forward: (lambda, phi) => [lambda, 1.25 * log(tan(PI / 4 + 0.4 * phi))],
    inverse: (x, y) => [x, 2.5 * (atan(exp(0.8 * y)) - PI / 4)],
  },
  "gall-peters": {
    forward: (lambda, phi) => [lambda / sqrt(2), sqrt(2) * sin(phi)],
    inverse: (x, y) => [x * sqrt(2), asin(clamp(y / sqrt(2), -1, 1))],
  },
  sinusoidal: {
    forward: (lambda, phi) => [lambda * cos(phi), phi],
    inverse: (x, y) => { const c = cos(y); return [c > 1e-9 ? x / c : 0, y]; },
  },
  mollweide: {
    forward: (lambda, phi) => {
      const target = PI * sin(phi);
      const theta = abs(abs(phi) - PI / 2) < 1e-9
        ? Math.sign(phi) * PI / 2
        : newton((t) => 2 * t + sin(2 * t), (t) => 2 + 2 * cos(2 * t), target, phi);
      return [(2 * sqrt(2) / PI) * lambda * cos(theta), sqrt(2) * sin(theta)];
    },
    inverse: (x, y) => {
      const theta = asin(clamp(y / sqrt(2), -1, 1));
      const c = cos(theta);
      return [c > 1e-9 ? (PI * x) / (2 * sqrt(2) * c) : 0, asin(clamp((2 * theta + sin(2 * theta)) / PI, -1, 1))];
    },
  },
  robinson: {
    forward: (lambda, phi) => [0.8487 * robinsonAt(ROBINSON_X, abs(phi)) * lambda, 1.3523 * robinsonAt(ROBINSON_Y, abs(phi)) * Math.sign(phi)],
    inverse: (x, y) => {
      const height = clamp(abs(y) / 1.3523, 0, 1);
      let row = 0;
      while (row < 17 && ROBINSON_Y[row + 1] < height) row += 1;
      const span = ROBINSON_Y[row + 1] - ROBINSON_Y[row];
      const phiAbs = (row + (span > 0 ? (height - ROBINSON_Y[row]) / span : 0)) * ROBINSON_STEP;
      return [x / (0.8487 * robinsonAt(ROBINSON_X, phiAbs)), phiAbs * Math.sign(y)];
    },
  },
  "equal-earth": {
    forward: (lambda, phi) => {
      const theta = asin(EE_M * sin(phi));
      return [(lambda * cos(theta)) / (EE_M * equalEarthDY(theta)), equalEarthY(theta)];
    },
    inverse: (x, y) => {
      const theta = clamp(newton(equalEarthY, equalEarthDY, y, y), -PI / 3, PI / 3);
      return [(EE_M * x * equalEarthDY(theta)) / cos(theta), asin(clamp(sin(theta) / EE_M, -1, 1))];
    },
  },
  "natural-earth": {
    forward: (lambda, phi) => [lambda * naturalEarthX(phi), naturalEarthY(phi)],
    inverse: (x, y) => {
      const phi = clamp(newton(naturalEarthY, naturalEarthDY, y, y), -PI / 2, PI / 2);
      return [x / naturalEarthX(phi), phi];
    },
  },
};

// What the Workshop offers, in this order. `name` is the label; freeform is
// the last, and is not a projection of a globe at all.
export const PROJECTIONS = Object.freeze([
  { id: "mercator", name: "Mercator" },
  { id: "equirectangular", name: "Equirectangular" },
  { id: "miller", name: "Miller" },
  { id: "gall-peters", name: "Gall-Peters" },
  { id: "robinson", name: "Robinson" },
  { id: "natural-earth", name: "Natural Earth" },
  { id: "equal-earth", name: "Equal Earth" },
  { id: "mollweide", name: "Mollweide" },
  { id: "sinusoidal", name: "Sinusoidal" },
  { id: FREEFORM, name: "Freeform" },
]);

export const isWorldProjection = (type) => Object.hasOwn(MATH, String(type));

// A projection as the game keeps it: { type } and, for freeform, the sheet's
// aspect (width / height). Anything it does not know is Mercator. A file may
// write the bare name.
//
// Two things about how the map is SHOWN ride with it, each written only when
// it is switched off: `globe: false` (the game never wraps this map round a 3D
// globe: a flat sheet is not one) and `wrap: false` (the map does not repeat
// sideways when the player pans past its edge).
const viewFlags = (raw) => ({ ...(raw.globe === false ? { globe: false } : {}), ...(raw.wrap === false ? { wrap: false } : {}) });
export const normalizeProjection = (value) => {
  const raw = typeof value === "string" ? { type: value } : value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const type = String(raw.type ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (type === FREEFORM) {
    const aspect = Number(raw.aspect);
    return { type: FREEFORM, aspect: Number.isFinite(aspect) && aspect > 0 ? clamp(aspect, 0.05, 20) : 2, ...viewFlags(raw) };
  }
  return { type: isWorldProjection(type) ? type : DEFAULT_PROJECTION, ...viewFlags(raw) };
};

// What the game map is told of them.
export const mapViewOf = (projection) => {
  const raw = projection && typeof projection === "object" && !Array.isArray(projection) ? projection : {};
  return { noGlobe: raw.globe === false, noWrap: raw.wrap === false };
};

// Whether a projection is worth writing down at all: Mercator with both
// switches on is what a map is when it says nothing.
export const projectionIsDefault = (projection) => {
  const spec = normalizeProjection(projection);
  return spec.type === DEFAULT_PROJECTION && spec.globe !== false && spec.wrap !== false;
};

// Whether world.projection is a map already laid out (the game's own record)
// or only a file's declaration, still to be applied.
export const projectionIsLaidOut = (value) => Boolean(value && typeof value === "object" && value.laidOut === true);

export const sameProjection = (a, b) => {
  const left = normalizeProjection(a);
  const right = normalizeProjection(b);
  return left.type === right.type && (left.type !== FREEFORM || abs(left.aspect - right.aspect) < 1e-6);
};

// ---------------------------------------------------------------------------
// The sheet: a projection's whole world on the Mercator plane
// ---------------------------------------------------------------------------
//
// The plane is in Mercator's own units: X and Y from -π to π. A world
// projection is scaled so its equator is as wide as the plane; its sheet is
// the rectangle around its outline. A freeform sheet is the largest rectangle
// of its aspect that fits the square.

const SCALE = {};
const HALF_HEIGHT = {};
for (const [type, math] of Object.entries(MATH)) {
  const scale = PI / math.forward(PI, 0)[0];
  SCALE[type] = scale;
  HALF_HEIGHT[type] = type === "mercator" ? PI : math.forward(0, PI / 2)[1] * scale;
}

// Half the sheet's width and height on the plane.
export const sheetHalf = (projection) => {
  const spec = normalizeProjection(projection);
  if (spec.type === FREEFORM) return spec.aspect >= 1 ? { hx: PI, hy: PI / spec.aspect } : { hx: PI * spec.aspect, hy: PI };
  return { hx: PI, hy: HALF_HEIGHT[spec.type] };
};

// The sheet's own shape, width / height.
export const sheetAspect = (projection) => { const { hx, hy } = sheetHalf(projection); return hx / hy; };

const planeToLatDeg = (y) => atan(sinh(clamp(y, -PI, PI))) / RAD;
const latDegToPlane = (lat) => asinh(tan(clamp(Number(lat) || 0, -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT) * RAD));

// The rectangle the sheet covers, in degrees as stored: where a picture drawn
// in this projection lies. Mercator's is the whole square.
export const sheetBounds = (projection) => {
  const { hx, hy } = sheetHalf(projection);
  const east = round((hx / PI) * 180);
  const north = round(planeToLatDeg(hy));
  return { west: -east, south: -north, east, north };
};

// True longitude and latitude (degrees) to the plane, for a world projection.
const geoToPlane = (type, lon, lat) => {
  const [x, y] = MATH[type].forward(clamp(Number(lon) || 0, -180, 180) * RAD, clamp(Number(lat) || 0, -90, 90) * RAD);
  return [x * SCALE[type], y * SCALE[type]];
};

// And back. A spot outside the projection's outline (the corners of a
// Robinson or Mollweide sheet) has no place on the globe: it is given the
// nearest one, on the edge.
const planeToGeo = (type, X, Y) => {
  const half = HALF_HEIGHT[type];
  const [lambda, phi] = MATH[type].inverse(X / SCALE[type], clamp(Y, -half, half) / SCALE[type]);
  return [clamp(lambda, -PI, PI) / RAD, clamp(phi, -PI / 2, PI / 2) / RAD];
};

// One spot of the plane, moved from one projection's sheet to another's.
// Between two world projections it goes through the globe. To or from freeform
// the first sheet's rectangle is stretched onto the second's.
export const convertPlane = (from, to, X, Y) => {
  const source = normalizeProjection(from);
  const target = normalizeProjection(to);
  if (source.type !== FREEFORM && target.type !== FREEFORM) {
    if (source.type === target.type) return [X, Y];
    const [lon, lat] = planeToGeo(source.type, X, Y);
    return geoToPlane(target.type, lon, lat);
  }
  const a = sheetHalf(source);
  const b = sheetHalf(target);
  return [X * (b.hx / a.hx), Y * (b.hy / a.hy)];
};

// Whether a spot of the plane is on a projection's map at all: inside its
// sheet, and for a world projection inside its outline (the corners of a
// Robinson or Mollweide sheet are not on the globe). Redrawing a picture in
// another projection leaves such spots empty.
export const planeOnMap = (projection, X, Y) => {
  const spec = normalizeProjection(projection);
  const { hx, hy } = sheetHalf(spec);
  if (abs(X) > hx + 1e-9 || abs(Y) > hy + 1e-9) return false;
  if (spec.type === FREEFORM) return true;
  const [lambda] = MATH[spec.type].inverse(X / SCALE[spec.type], Y / SCALE[spec.type]);
  return abs(lambda) <= PI + 1e-6;
};

// Bounds as a rectangle of the plane (Mercator's own units).
export const boundsOnPlane = (bounds) => {
  const box = normalizeImageBounds(bounds) ?? { west: -180, south: -MERCATOR_MAX_LAT, east: 180, north: MERCATOR_MAX_LAT };
  return { west: box.west * RAD, east: box.east * RAD, south: latDegToPlane(box.south), north: latDegToPlane(box.north) };
};

// The same for a stored place (degrees).
export const convertDisplayPoint = (from, to, lon, lat) => {
  const [X, Y] = convertPlane(from, to, (Number(lon) || 0) * RAD, latDegToPlane(lat));
  return [round((clamp(X, -PI, PI) / PI) * 180), round(planeToLatDeg(Y))];
};

// A true longitude and latitude as it is stored for a map in `projection`.
// Freeform has no globe: there the pair is read as x and y on a sheet 360 by
// 180, spread evenly over the freeform sheet.
export const geoToDisplay = (projection, lon, lat) => {
  const spec = normalizeProjection(projection);
  if (spec.type === FREEFORM) {
    const { hx, hy } = sheetHalf(spec);
    const X = (clamp(Number(lon) || 0, -180, 180) / 180) * hx;
    const Y = (clamp(Number(lat) || 0, -90, 90) / 90) * hy;
    return [round((X / PI) * 180), round(planeToLatDeg(Y))];
  }
  const [X, Y] = geoToPlane(spec.type, lon, lat);
  return [round((X / PI) * 180), round(planeToLatDeg(Y))];
};

// A stored place of a map in `projection`, back as its true longitude and
// latitude (for freeform: its x and y on the 360 by 180 sheet).
export const displayToGeo = (projection, lon, lat) => {
  const spec = normalizeProjection(projection);
  const X = (Number(lon) || 0) * RAD;
  const Y = latDegToPlane(lat);
  if (spec.type === FREEFORM) {
    const { hx, hy } = sheetHalf(spec);
    return [round(clamp(X / hx, -1, 1) * 180), round(clamp(Y / hy, -1, 1) * 90)];
  }
  const [geoLon, geoLat] = planeToGeo(spec.type, X, Y);
  return [round(geoLon), round(geoLat)];
};

// ---------------------------------------------------------------------------
// Where a picture lies
// ---------------------------------------------------------------------------

// Bounds as the maps can use them, or null: four numbers, west of east, south
// of north, inside the square.
export const normalizeImageBounds = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const west = Number(value.west);
  const south = Number(value.south);
  const east = Number(value.east);
  const north = Number(value.north);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  const bounds = {
    west: clamp(west, -180, 180),
    south: clamp(south, -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT),
    east: clamp(east, -180, 180),
    north: clamp(north, -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT),
  };
  if (!(bounds.east - bounds.west > 1e-6) || !(bounds.north - bounds.south > 1e-6)) return null;
  return bounds;
};

// Whether bounds are the whole square, which is how a picture without any is
// drawn: such bounds need not be kept.
export const boundsFillSquare = (bounds) => {
  const box = normalizeImageBounds(bounds);
  return !box || (box.west <= -179.999 && box.east >= 179.999 && box.south <= -85.05 && box.north >= 85.05);
};

// The four corners MapLibre's image source wants (top-left, top-right,
// bottom-right, bottom-left). Without bounds the picture fills the square; on
// the globe that square is taken almost to the poles, as it always was.
export const imageQuad = (bounds, { globe = false } = {}) => {
  const box = normalizeImageBounds(bounds);
  if (!box || boundsFillSquare(box)) {
    const lat = globe ? 89.9 : 85.0511;
    return [[-180, lat], [180, lat], [180, -lat], [-180, -lat]];
  }
  return [[box.west, box.north], [box.east, box.north], [box.east, box.south], [box.west, box.south]];
};

// Bounds moved with their map from one projection to another: the rectangle
// around where the four corners and the middles of the edges land.
export const convertBounds = (from, to, bounds) => {
  const box = normalizeImageBounds(bounds) ?? sheetBounds(DEFAULT_PROJECTION);
  const midLon = (box.west + box.east) / 2;
  const midLat = (box.south + box.north) / 2;
  const points = [
    [box.west, box.north], [midLon, box.north], [box.east, box.north],
    [box.west, midLat], [box.east, midLat],
    [box.west, box.south], [midLon, box.south], [box.east, box.south],
  ].map(([lon, lat]) => convertDisplayPoint(from, to, lon, lat));
  return normalizeImageBounds({
    west: min(...points.map((point) => point[0])),
    east: max(...points.map((point) => point[0])),
    south: min(...points.map((point) => point[1])),
    north: max(...points.map((point) => point[1])),
  });
};

// ---------------------------------------------------------------------------
// Moving data: `move(lon, lat)` answers the new pair
// ---------------------------------------------------------------------------

const isPosition = (value) => Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number";

const moveCoordinates = (coordinates, move) => {
  if (isPosition(coordinates)) return [...move(coordinates[0], coordinates[1]), ...coordinates.slice(2)];
  return Array.isArray(coordinates) ? coordinates.map((entry) => moveCoordinates(entry, move)) : coordinates;
};

const isGeometry = (value) => Boolean(value) && typeof value === "object" && typeof value.type === "string"
  && (Array.isArray(value.coordinates) || Array.isArray(value.geometries));

const moveGeometry = (geometry, move) => (Array.isArray(geometry.geometries)
  ? { ...geometry, geometries: geometry.geometries.map((part) => (isGeometry(part) ? moveGeometry(part, move) : part)) }
  : { ...geometry, coordinates: moveCoordinates(geometry.coordinates, move) });

// A FeatureCollection, a Feature or a bare geometry with every place moved.
// Anything else comes back as it is.
export const moveGeojson = (value, move) => {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value.features)) return { ...value, features: value.features.map((feature) => moveGeojson(feature, move)) };
  if (value.type === "Feature") return { ...value, geometry: isGeometry(value.geometry) ? moveGeometry(value.geometry, move) : value.geometry };
  return isGeometry(value) ? moveGeometry(value, move) : value;
};

const LONGITUDE_KEYS = ["lng", "lon", "longitude"];
const LATITUDE_KEYS = ["lat", "latitude"];

// Plain game data (the world: units, structures, anything with a place),
// walked whole: an object holding a latitude beside a longitude is a place,
// and a GeoJSON geometry is moved as one. Nothing else is touched.
export const movePlaces = (value, move) => {
  if (Array.isArray(value)) return value.map((entry) => movePlaces(entry, move));
  if (!value || typeof value !== "object") return value;
  if (isGeometry(value) || value.type === "Feature" || Array.isArray(value.features)) return moveGeojson(value, move);
  const next = {};
  for (const [key, entry] of Object.entries(value)) next[key] = movePlaces(entry, move);
  const lonKey = LONGITUDE_KEYS.find((key) => typeof value[key] === "number");
  const latKey = LATITUDE_KEYS.find((key) => typeof value[key] === "number");
  if (lonKey && latKey) {
    const [lon, lat] = move(value[lonKey], value[latKey]);
    next[lonKey] = lon;
    next[latKey] = lat;
  }
  return next;
};

// ---------------------------------------------------------------------------
// A scenario bundle whose file declares its projection
// ---------------------------------------------------------------------------

const decodeBase64Json = (text) => {
  const binary = atob(String(text));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return JSON.parse(new TextDecoder().decode(bytes));
};

// One embedded GeoJSON asset of a bundle, moved. Its data travels as JSON, or
// as base64 of JSON in a bundle written before JSON assets stopped being
// base64'd; either way what comes back carries JSON.
const moveGeojsonAsset = (asset, move) => {
  if (!asset || asset.mode !== "embedded" || asset.data == null) return asset;
  let data = asset.data;
  if (typeof data === "string") {
    try {
      data = decodeBase64Json(data);
    } catch {
      return asset; // not something this can read: the importer says what is wrong with it
    }
  }
  const { encoding: _encoding, ...rest } = asset;
  return { ...rest, data: moveGeojson(data, move) };
};

// The projection a bundle's file declares and has not been laid out in, or
// null: nothing declared, already laid out, or Mercator, which needs nothing.
export const declaredProjectionOf = (bundle) => {
  const stated = bundle?.data?.world?.projection;
  if (stated == null || projectionIsLaidOut(stated)) return null;
  const spec = normalizeProjection(stated);
  return spec.type === DEFAULT_PROJECTION ? null : spec;
};

// A bundle whose file declares a projection, as the game keeps it: regions,
// cities and every place in the world laid out, the picture given the sheet's
// bounds, and the projection marked laidOut so this is never done twice. Any
// other bundle comes back untouched, the same object.
export const layOutScenarioBundle = (bundle) => {
  const spec = declaredProjectionOf(bundle);
  if (!spec) return bundle;
  const move = (lon, lat) => geoToDisplay(spec, lon, lat);
  const world = movePlaces(bundle.data.world, move);
  world.projection = { ...spec, laidOut: true };
  const background = bundle.data.world.background && typeof bundle.data.world.background === "object" ? bundle.data.world.background : null;
  if (background?.kind === "image") {
    // Bounds the file gives say what part of the globe (or of the freeform
    // sheet) the picture covers; without any it covers all of it.
    const stated = background.bounds && typeof background.bounds === "object" ? background.bounds : null;
    const corners = stated && [stated.west, stated.south, stated.east, stated.north].every((n) => Number.isFinite(Number(n)))
      ? normalizeImageBounds({
        west: move(stated.west, 0)[0],
        east: move(stated.east, 0)[0],
        south: move(0, stated.south)[1],
        north: move(0, stated.north)[1],
      })
      : null;
    world.background = { ...background, bounds: corners ?? sheetBounds(spec) };
  } else if (background) {
    world.background = background;
  }
  const assets = { ...(bundle.assets ?? {}) };
  for (const key of ["regionsGeojson", "citiesGeojson"]) {
    if (assets[key]) assets[key] = moveGeojsonAsset(assets[key], move);
  }
  // A vector basemap is geometry on the same globe.
  const payload = assets.backgroundData?.mode === "embedded" ? assets.backgroundData.data : null;
  if (background?.kind === "vector" && payload && typeof payload === "object" && payload.geojson) {
    assets.backgroundData = { ...assets.backgroundData, data: { ...payload, geojson: moveGeojson(payload.geojson, move) } };
  }
  const data = { ...bundle.data, world };
  if (Array.isArray(data.events)) data.events = movePlaces(data.events, move);
  return { ...bundle, data, assets };
};

// The community hub's maintainers can say of a post what its file does not: a
// post labelled "flat map" is imported as equirectangular, a sheet with its
// rows evenly spaced. A label is a person's judgement; nothing in a file lets
// the game tell such a sheet from a map drawn in the Workshop over a stretched
// picture, so the game never guesses.
export const FLAT_MAP_LABEL = "flat map";
export const postSaysFlatMap = (post) => (Array.isArray(post?.labels) ? post.labels : [])
  .some((label) => String(typeof label === "string" ? label : label?.name ?? "").trim().toLowerCase() === FLAT_MAP_LABEL);

// The bundle of such a post, declared equirectangular when it has a picture
// of its own, has not been laid out and says nothing itself.
export const declareFlatMapFromPost = (bundle, post) => {
  const world = bundle?.data?.world;
  if (!world || typeof world !== "object" || !postSaysFlatMap(post)) return bundle;
  if (world.projection != null || world.background?.kind !== "image" || world.background?.bounds) return bundle;
  return { ...bundle, data: { ...bundle.data, world: { ...world, projection: "equirectangular" } } };
};
