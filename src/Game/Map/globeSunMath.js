/*! Open Historia — globe sun projection helpers © 2026 Nicholas Krol, MIT. */

const DEG_TO_RAD = Math.PI / 180;
const SUN_ORBIT_RADIUS = 1.32;

const clamp = (minimum, maximum, value) => Math.max(minimum, Math.min(maximum, value));

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

// Use MapLibre's own globe matrix so the sun follows zoom, pitch, bearing,
// latitude correction, and the globe-to-Mercator projection transition.
export const projectGlobeSun = ({ sunLng, sunLat, matrix, width, height }) => {
  if (!matrix || ![sunLng, sunLat, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;

  const direction = directionFromLngLat(sunLng, sunLat);
  const clip = transformPoint(matrix, direction.map((value) => value * SUN_ORBIT_RADIUS));
  if (!Number.isFinite(clip[3]) || clip[3] <= 0) return null;

  const inverseW = 1 / clip[3];
  const centerDepth = Math.max(0.0001, Math.abs(matrix[15]));
  return {
    x: (clip[0] * inverseW * 0.5 + 0.5) * width,
    y: (0.5 - clip[1] * inverseW * 0.5) * height,
    scale: clamp(0.68, 1.38, centerDepth / clip[3]),
  };
};
