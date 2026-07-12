/*! Open Historia - distant globe starfield renderer (c) 2026 Nicholas Krol, MIT. */
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

const buildStars = () => Array.from({ length: STAR_COUNT }, (_, index) => {
  const inMilkyWay = index >= 1100;
  const longitude = random() * Math.PI * 2;
  const latitude = inMilkyWay
    ? (random() + random() + random() - 1.5) * 0.16
    : Math.asin(random() * 2 - 1);
  const latitudeScale = Math.cos(latitude);
  const brightness = Math.pow(random(), 4);
  const warmth = random();
  return {
    direction: [
      Math.sin(longitude) * latitudeScale,
      Math.sin(latitude),
      Math.cos(longitude) * latitudeScale,
    ],
    alpha: (inMilkyWay ? 0.2 : 0.3) + brightness * 0.7,
    radius: 0.35 + brightness * 1.45,
    color: warmth > 0.92 ? "255,224,190" : warmth < 0.08 ? "190,218,255" : "238,244,255",
  };
});

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

  for (const star of STARS) {
    const point = projectCelestialDirection({ direction: star.direction, matrix, width, height });
    if (!point || point.x < -4 || point.x > width + 4 || point.y < -4 || point.y > height + 4) continue;
    const alpha = star.alpha * opacity;
    context.fillStyle = `rgba(${star.color},${alpha.toFixed(3)})`;
    if (star.radius < 0.75) {
      context.fillRect(point.x, point.y, 0.8, 0.8);
    } else {
      context.beginPath();
      context.arc(point.x, point.y, star.radius, 0, Math.PI * 2);
      context.fill();
    }
  }
};

export const releaseCelestialStars = (canvas) => {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
};
