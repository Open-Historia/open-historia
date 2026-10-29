export const ORIENTATIONS = ["identity", "flipX", "flipY", "rot180", "rot90cw", "rot90ccw", "transpose", "transverse"];

const SOURCE = {
  identity: (x, y) => [x, y],
  flipX: (x, y, w) => [w - 1 - x, y],
  flipY: (x, y, w, h) => [x, h - 1 - y],
  rot180: (x, y, w, h) => [w - 1 - x, h - 1 - y],
  rot90cw: (x, y, w, h) => [y, h - 1 - x],
  rot90ccw: (x, y, w) => [w - 1 - y, x],
  transpose: (x, y) => [y, x],
  transverse: (x, y, w, h) => [w - 1 - y, h - 1 - x],
};

const SWAPS = new Set(["rot90cw", "rot90ccw", "transpose", "transverse"]);

const difference = (base, image, name, step) => {
  const { width: w, height: h } = base;
  const swapped = SWAPS.has(name);
  if (image.width !== (swapped ? h : w) || image.height !== (swapped ? w : h)) return Infinity;
  const map = SOURCE[name];
  let total = 0;
  let count = 0;
  for (let y = 0; y < image.height; y += step) {
    for (let x = 0; x < image.width; x += step) {
      const [sx, sy] = map(x, y, w, h);
      const a = (y * image.width + x) * 4;
      const b = (sy * w + sx) * 4;
      const alphaA = image.rgba[a + 3] / 255;
      const alphaB = base.rgba[b + 3] / 255;
      for (let channel = 0; channel < 3; channel++) total += Math.abs(image.rgba[a + channel] * alphaA - base.rgba[b + channel] * alphaB);
      total += Math.abs(image.rgba[a + 3] - base.rgba[b + 3]);
      count += 4;
    }
  }
  return total / count;
};

export const orientationOf = (base, image, step = 3) => {
  const scores = ORIENTATIONS.map((name) => [name, difference(base, image, name, step)]).sort((a, b) => a[1] - b[1]);
  return { best: scores[0][0], score: Number(scores[0][1].toFixed(3)), next: scores[1][0], nextScore: Number(scores[1][1].toFixed(3)) };
};
