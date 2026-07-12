/*! Open Historia — fail-safe globe surface lighting © 2026 Nicholas Krol, MIT. */
import { directionFromLngLat } from "./globeSunMath.js";

const LATITUDE_SEGMENTS = 24;
const LONGITUDE_SEGMENTS = 48;
const LIGHT_BUCKETS = 32;
const MAX_CANVAS_PIXELS = 4_000_000;

const dot = (left, right) => left[0] * right[0] + left[1] * right[1] + left[2] * right[2];

const normalize = (vector) => {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
};

const buildSphereMesh = () => {
  const vertices = [];
  const triangles = [];
  for (let latIndex = 0; latIndex <= LATITUDE_SEGMENTS; latIndex += 1) {
    const lat = -90 + (latIndex / LATITUDE_SEGMENTS) * 180;
    for (let lngIndex = 0; lngIndex <= LONGITUDE_SEGMENTS; lngIndex += 1) {
      const lng = -180 + (lngIndex / LONGITUDE_SEGMENTS) * 360;
      vertices.push(directionFromLngLat(lng, lat));
    }
  }

  const rowLength = LONGITUDE_SEGMENTS + 1;
  const addTriangle = (a, b, c) => {
    const normal = normalize([
      vertices[a][0] + vertices[b][0] + vertices[c][0],
      vertices[a][1] + vertices[b][1] + vertices[c][1],
      vertices[a][2] + vertices[b][2] + vertices[c][2],
    ]);
    triangles.push({ indices: [a, b, c], normal });
  };

  for (let latIndex = 0; latIndex < LATITUDE_SEGMENTS; latIndex += 1) {
    for (let lngIndex = 0; lngIndex < LONGITUDE_SEGMENTS; lngIndex += 1) {
      const lowerLeft = latIndex * rowLength + lngIndex;
      const upperLeft = lowerLeft + rowLength;
      addTriangle(lowerLeft, upperLeft, lowerLeft + 1);
      addTriangle(lowerLeft + 1, upperLeft, upperLeft + 1);
    }
  }
  return { vertices, triangles };
};

const SPHERE_MESH = buildSphereMesh();
const PROJECTED_VERTICES = new Float32Array(SPHERE_MESH.vertices.length * 2);
const PROJECTED_VERTEX_VALID = new Uint8Array(SPHERE_MESH.vertices.length);
const TRIANGLE_BUCKETS = Array.from({ length: LIGHT_BUCKETS }, () => []);

const projectVertex = (matrix, point, width, height, index) => {
  const clipX = matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12];
  const clipY = matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13];
  const clipW = matrix[3] * point[0] + matrix[7] * point[1] + matrix[11] * point[2] + matrix[15];
  if (!Number.isFinite(clipW) || clipW <= 0) return false;
  PROJECTED_VERTICES[index * 2] = (clipX / clipW * 0.5 + 0.5) * width;
  PROJECTED_VERTICES[index * 2 + 1] = (0.5 - clipY / clipW * 0.5) * height;
  return true;
};

const smoothstep = (minimum, maximum, value) => {
  const progress = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return progress * progress * (3 - 2 * progress);
};

const colorForSunDot = (sunDot, opacity) => {
  const night = 1 - smoothstep(-0.18, 0.12, sunDot);
  const dusk = smoothstep(-0.24, -0.02, sunDot) * (1 - smoothstep(0.04, 0.28, sunDot));
  const daylight = smoothstep(0, 0.85, sunDot);
  const nightAlpha = night * 0.72;
  const duskAlpha = dusk * 0.14;
  const dayAlpha = daylight * 0.06;
  const weight = nightAlpha + duskAlpha + dayAlpha;
  const alpha = Math.min(0.78, weight) * opacity;
  if (alpha < 0.002) return null;
  const components = [
    [2, 6, 23, nightAlpha],
    [255, 87, 20, duskAlpha],
    [255, 173, 82, dayAlpha],
  ];
  const channel = (index) => Math.round(
    components.reduce((sum, color) => sum + color[index] * color[3], 0) / Math.max(weight, 0.0001),
  );
  return `rgba(${channel(0)}, ${channel(1)}, ${channel(2)}, ${alpha.toFixed(3)})`;
};

export const clearGlobeLighting = (canvas) => {
  canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
};

export const releaseGlobeLighting = (canvas) => {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
};

export const drawGlobeLighting = ({
  canvas,
  matrix,
  cameraPosition,
  sunDirection,
  width,
  height,
  opacity,
}) => {
  if (!canvas || !matrix || !cameraPosition || opacity <= 0 || width <= 0 || height <= 0) {
    clearGlobeLighting(canvas);
    return;
  }

  const safePixelRatio = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
  const pixelRatio = Math.min(1.5, window.devicePixelRatio || 1, safePixelRatio);
  const pixelWidth = Math.max(1, Math.floor(width * pixelRatio));
  const pixelHeight = Math.max(1, Math.floor(height * pixelRatio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  for (let index = 0; index < SPHERE_MESH.vertices.length; index += 1) {
    PROJECTED_VERTEX_VALID[index] = projectVertex(
      matrix,
      SPHERE_MESH.vertices[index],
      width,
      height,
      index,
    ) ? 1 : 0;
  }
  for (const bucket of TRIANGLE_BUCKETS) bucket.length = 0;
  for (const triangle of SPHERE_MESH.triangles) {
    if (dot(cameraPosition, triangle.normal) <= 1.001) continue;
    if (triangle.indices.some((index) => !PROJECTED_VERTEX_VALID[index])) continue;
    const sunDot = dot(sunDirection, triangle.normal);
    const bucketIndex = Math.max(0, Math.min(
      LIGHT_BUCKETS - 1,
      Math.round(((sunDot + 1) / 2) * (LIGHT_BUCKETS - 1)),
    ));
    TRIANGLE_BUCKETS[bucketIndex].push(triangle.indices);
  }

  for (let bucketIndex = 0; bucketIndex < TRIANGLE_BUCKETS.length; bucketIndex += 1) {
    const triangles = TRIANGLE_BUCKETS[bucketIndex];
    if (triangles.length === 0) continue;
    const sunDot = (bucketIndex / (LIGHT_BUCKETS - 1)) * 2 - 1;
    const color = colorForSunDot(sunDot, opacity);
    if (!color) continue;
    context.beginPath();
    for (const indices of triangles) {
      context.moveTo(PROJECTED_VERTICES[indices[0] * 2], PROJECTED_VERTICES[indices[0] * 2 + 1]);
      context.lineTo(PROJECTED_VERTICES[indices[1] * 2], PROJECTED_VERTICES[indices[1] * 2 + 1]);
      context.lineTo(PROJECTED_VERTICES[indices[2] * 2], PROJECTED_VERTICES[indices[2] * 2 + 1]);
      context.closePath();
    }
    context.fillStyle = color;
    context.fill();
  }
};
