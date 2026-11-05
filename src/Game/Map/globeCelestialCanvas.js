/*! Open Historia - distant globe starfield renderer (c) 2026 Nicholas Krol, AGPL-3.0-or-later. */
import { projectCelestialDirection } from "./globeSunMath.js";

const STAR_COUNT = 1800;
const MAX_CANVAS_PIXELS = 4_000_000;

const random = (() => {
  let state = 0x51f15e;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
})();

const buildStars = () => {
  const stars = Array.from({ length: STAR_COUNT }, (_, index) => {
    const inMilkyWay = index >= 1100;
    const longitude = random() * Math.PI * 2;
    const latitude = inMilkyWay
      ? (random() + random() + random() - 1.5) * 0.16
      : Math.asin(random() * 2 - 1);
    const latitudeScale = Math.cos(latitude);
    const brightness = Math.pow(random(), 4);
    const warmth = random();
    const dirX = Math.sin(longitude) * latitudeScale;
    const dirY = Math.sin(latitude);
    const dirZ = Math.cos(longitude) * latitudeScale;
    return {
      direction: [dirX, dirY, dirZ],
      cx: dirX * 64, // CELESTIAL_RADIUS = 64 pre-multiplied
      cy: dirY * 64,
      cz: dirZ * 64,
      alpha: (inMilkyWay ? 0.2 : 0.3) + brightness * 0.7,
      radius: 0.35 + brightness * 1.45,
      color: warmth > 0.92 ? "255,224,190" : warmth < 0.08 ? "190,218,255" : "238,244,255",
    };
  });
  return stars.sort((a, b) => a.color.localeCompare(b.color));
};

const STARS = buildStars();

const resizeCanvas = (canvas, width, height) => {
  const safePixelRatio = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
  const pixelRatio = Math.min(1.5, window.devicePixelRatio || 1, safePixelRatio);
  const pixelWidth = Math.max(1, Math.floor(width * pixelRatio));
  const pixelHeight = Math.max(1, Math.floor(height * pixelRatio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  return pixelRatio;
};

export const drawCelestialStars = ({ canvas, matrix, width, height, opacity }) => {
  if (!canvas) return;
  if (!matrix || width <= 0 || height <= 0 || opacity <= 0) {
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const pixelRatio = resizeCanvas(canvas, width, height);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const m0 = matrix[0], m1 = matrix[1], m2 = matrix[2], m3 = matrix[3];
  const m4 = matrix[4], m5 = matrix[5], m6 = matrix[6], m7 = matrix[7];
  const m8 = matrix[8], m9 = matrix[9], m10 = matrix[10], m11 = matrix[11];
  const m12 = matrix[12], m13 = matrix[13], m14 = matrix[14], m15 = matrix[15];

  const minX = -4;
  const maxX = width + 4;
  const minY = -4;
  const maxY = height + 4;
  let lastColor = "";
  let lastAlphaInt = -1;

  for (let i = 0; i < STAR_COUNT; i++) {
    const star = STARS[i];
    const clipW = m3 * star.cx + m7 * star.cy + m11 * star.cz + m15;
    if (clipW <= 0) continue;
    const invW = 1 / clipW;
    const normX = (m0 * star.cx + m4 * star.cy + m8 * star.cz + m12) * invW;
    if (normX < -1.1 || normX > 1.1) continue;
    const normY = (m1 * star.cx + m5 * star.cy + m9 * star.cz + m13) * invW;
    if (normY < -1.1 || normY > 1.1) continue;
    const x = (normX * 0.5 + 0.5) * width;
    const y = (0.5 - normY * 0.5) * height;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;

    const alpha = star.alpha * opacity;
    const alphaInt = (alpha * 100) | 0;
    if (star.color !== lastColor || alphaInt !== lastAlphaInt) {
      context.fillStyle = `rgba(${star.color},${(alphaInt / 100).toFixed(2)})`;
      lastColor = star.color;
      lastAlphaInt = alphaInt;
    }
    if (star.radius < 0.75) {
      context.fillRect(x, y, 0.8, 0.8);
    } else {
      context.beginPath();
      context.arc(x, y, star.radius, 0, Math.PI * 2);
      context.fill();
    }
  }
};

export const releaseCelestialStars = (canvas) => {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
};
