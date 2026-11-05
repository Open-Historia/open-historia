/*! Open Historia — a disc of circular-brushed metal © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The war room's button is a disc of metal brushed in circles: very fine
// grooves ring its middle, and the light lies across it in two bright wedges
// the way it does on a turned knob. The owner asked for exactly this look for
// this one button; every other surface of the interface is a flat colour.
//
// It is worked out a pixel at a time and nothing here is drawn by the browser:
// how bright a pixel is depends on which groove it lies in (a ring a fraction
// of a pixel wide, each a little lighter or darker than the next, the same
// every time) and on how the groove it lies in catches the light (which is by
// its angle round the middle, since a groove is a tiny mirror that runs across
// the line to the middle). The rim is a bevel: a dark edge with a bright lip.

// A number from 0 up to 1 for a whole number, the same on every machine.
const noise = (value) => {
  let hash = (value | 0) * 374761393 + 668265263;
  hash = (hash ^ (hash >>> 13)) * 1274126177;
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
};

const clamp = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

// The disc as pixels: `size` across, red, green, blue and how solid, a byte each.
//   base     the colour of the metal, [red, green, blue] 0-255
//   light    which way the brightest wedge points, in turns round the middle
//   grooves  how many grooves to a pixel of radius
export const brushedMetalPixels = (size, { base = [168, 24, 30], light = 0.105, grooves = 2.2, seed = 7 } = {}) => {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const middle = size / 2;
  const radius = size / 2;
  const turn = light * Math.PI * 2;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const dx = col + 0.5 - middle;
      const dy = row + 0.5 - middle;
      const out = Math.sqrt(dx * dx + dy * dy);
      const at = (row * size + col) * 4;
      if (out > radius) continue;
      const far = out / radius;
      // The groove it lies in: a ring, a shade of its own, and one in six a deeper scratch.
      const ring = Math.floor(out * grooves);
      const scratch = noise(ring * 31 + seed);
      const groove = (noise(ring + seed * 977) - 0.5) * 0.17 + (scratch > 0.82 ? (scratch - 0.82) * -0.7 : 0);
      // How it catches the light: two bright wedges opposite each other, and
      // two fainter ones across them, sharper toward the rim than at the middle.
      const angle = Math.atan2(dy, dx) - turn;
      const across = Math.cos(angle * 2);
      const wedge = Math.pow(clamp(across), 3) * 0.62 + Math.pow(clamp(-across), 6) * 0.2;
      const shine = wedge * (0.35 + 0.65 * clamp(far * 1.4));
      // The rim: a bright lip just inside a dark edge.
      const lip = Math.exp(-Math.pow((far - 0.9) / 0.022, 2)) * 0.34;
      const edge = far > 0.93 ? (far - 0.93) / 0.07 : 0;
      // The boss in the middle is a touch darker, as a turned disc is.
      const boss = Math.exp(-Math.pow(far / 0.16, 2)) * 0.14;
      const lightness = 0.62 + groove + lip - edge * 0.5 - boss;
      for (let channel = 0; channel < 3; channel += 1) {
        // The shine is the colour of the light, not of the metal: it lifts every channel toward white.
        const lit = base[channel] * lightness + (255 - base[channel] * lightness) * clamp(shine * (1 + groove * 2.5));
        pixels[at + channel] = Math.round(clamp(lit / 255) * 255);
      }
      // A soft edge, a pixel wide.
      pixels[at + 3] = Math.round(clamp(radius - out) * 255);
    }
  }
  return pixels;
};

// The same as a picture a stylesheet can use, made once for each size and colour.
const made = new Map();
export const brushedMetalUrl = (size, options = {}) => {
  if (typeof document === "undefined") return "";
  const key = `${size}|${JSON.stringify(options)}`;
  if (made.has(key)) return made.get(key);
  let url = "";
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    const image = context.createImageData(size, size);
    image.data.set(brushedMetalPixels(size, options));
    context.putImageData(image, 0, 0);
    url = canvas.toDataURL("image/png");
  } catch {
    url = "";
  }
  made.set(key, url);
  return url;
};
