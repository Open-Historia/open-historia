/*! Open Historia — globe sun projection helpers © 2026 Nicholas Krol, MIT. */

const DEG_TO_RAD = Math.PI / 180;
export const CELESTIAL_RADIUS = 64;

const clamp = (minimum, maximum, value) => Math.max(minimum, Math.min(maximum, value));
const smoothstep = (start, end, value) => {
  const progress = clamp(0, 1, (value - start) / (end - start));
  return progress * progress * (3 - 2 * progress);
};

export const normalizeLongitude = (lng) => ((lng + 180) % 360 + 360) % 360 - 180;

// Sphere geometry cannot follow MapLibre's high-zoom globe-to-Mercator morph.
// Fade it while the map is still visually spherical instead of letting it drift.
export const globeTransitionOpacity = (transition) => {
  if (!Number.isFinite(transition)) return 1;
  const progress = clamp(0, 1, (transition - 0.9) / 0.1);
  return progress * progress * (3 - 2 * progress);
};

export const directionFromLngLat = (lng, lat) => {
  const lngRad = lng * DEG_TO_RAD;
  const latRad = lat * DEG_TO_RAD;
  const latitudeScale = Math.cos(latRad);
  return [
    Math.sin(lngRad) * latitudeScale,
    Math.sin(latRad),
    Math.cos(lngRad) * latitudeScale,
  ];
};

const transformPoint = (matrix, point) => [
  matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
  matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
  matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  matrix[3] * point[0] + matrix[7] * point[1] + matrix[11] * point[2] + matrix[15],
];

const projectWorldPoint = (matrix, point, width, height) => {
  const clip = transformPoint(matrix, point);
  if (!Number.isFinite(clip[3]) || clip[3] <= 0) return null;
  const inverseW = 1 / clip[3];
  return {
    x: (clip[0] * inverseW * 0.5 + 0.5) * width,
    y: (0.5 - clip[1] * inverseW * 0.5) * height,
  };
};

// The map itself occludes the sun disc. This computes only the atmosphere-like
// flare at the projected globe limb, in pixels so its width is stable on zoom.
export const sunLimbBloom = ({ sunX, sunY, cameraPosition, matrix, width, height }) => {
  if (!cameraPosition || !matrix || ![sunX, sunY, width, height].every(Number.isFinite)) return 0;
  const cameraLength = Math.hypot(...cameraPosition);
  if (!Number.isFinite(cameraLength) || cameraLength <= 1) return 0;
  const axis = cameraPosition.map((value) => value / cameraLength);
  const reference = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const basis = [
    axis[1] * reference[2] - axis[2] * reference[1],
    axis[2] * reference[0] - axis[0] * reference[2],
    axis[0] * reference[1] - axis[1] * reference[0],
  ];
  const basisLength = Math.hypot(...basis);
  if (basisLength <= 0) return 0;
  const limbCenter = axis.map((value) => value / cameraLength);
  const limbRadius = Math.sqrt(1 - 1 / (cameraLength * cameraLength));
  const limbPoint = limbCenter.map((value, index) => (
    value + basis[index] / basisLength * limbRadius
  ));
  const projectedCenter = projectWorldPoint(matrix, limbCenter, width, height);
  const projectedEdge = projectWorldPoint(matrix, limbPoint, width, height);
  if (!projectedCenter || !projectedEdge) return 0;
  const globeRadius = Math.hypot(
    projectedEdge.x - projectedCenter.x,
    projectedEdge.y - projectedCenter.y,
  );
  const clearance = Math.abs(
    Math.hypot(sunX - projectedCenter.x, sunY - projectedCenter.y) - globeRadius,
  );
  return 1 - smoothstep(0, 72, clearance);
};

export const projectCelestialDirection = ({ direction, matrix, width, height }) => {
  if (!matrix || !direction || width <= 0 || height <= 0) return null;
  const clip = transformPoint(matrix, direction.map((value) => value * CELESTIAL_RADIUS));
  if (!Number.isFinite(clip[3]) || clip[3] <= 0) return null;

  const inverseW = 1 / clip[3];
  const normalizedX = clip[0] * inverseW;
  const normalizedY = clip[1] * inverseW;
  if (Math.abs(normalizedX) > 4 || Math.abs(normalizedY) > 4) return null;
  const x = (normalizedX * 0.5 + 0.5) * width;
  const y = (0.5 - normalizedY * 0.5) * height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
};

// Use MapLibre's own globe matrix so the sun follows zoom, pitch, bearing,
// latitude correction, and the globe-to-Mercator projection transition.
export const projectGlobeSun = ({ sunLng, sunLat, matrix, width, height }) => {
  if (!matrix || ![sunLng, sunLat, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;

  const projected = projectCelestialDirection({
    direction: directionFromLngLat(sunLng, sunLat),
    matrix,
    width,
    height,
  });
  return projected ? { ...projected, scale: 1 } : null;
};
