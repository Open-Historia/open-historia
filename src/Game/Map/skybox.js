/*! Open Historia — procedural space skybox © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// One panoramic sky image behind the globe: stars, faint nebula wisps and
// THE SUN, all baked together. The horizontal axis spans 360° of azimuth and
// the strip repeats seamlessly, so GlobeEffects can scroll it until the baked
// sun lines up with the sunlit side of the earth. Because the whole sky sits
// BEHIND the map canvas, the earth occludes the sun naturally — no z-order
// tricks, no eclipse masks.

export const SKYBOX_SIZE = 2048;
// Where the sun is baked into the image (fractions of width/height).
export const SKYBOX_SUN_U = 0.5;
export const SKYBOX_SUN_V = 0.35;

let skyboxUrl = "";

const buildSkyboxDataUrl = () => {
  if (typeof document === "undefined") return "";
  const size = SKYBOX_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#000003";
  ctx.fillRect(0, 0, size, size);

  // Deterministic pseudo-random so every load gets the same sky.
  let seed = 421337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  // Draw a radial blob three times (x, x±size) so the strip tiles seamlessly.
  const wrappedBlob = (x, y, radius, stops) => {
    for (const offset of [-size, 0, size]) {
      const gradient = ctx.createRadialGradient(x + offset, y, 0, x + offset, y, radius);
      for (const [at, color] of stops) gradient.addColorStop(at, color);
      ctx.fillStyle = gradient;
      ctx.fillRect(x + offset - radius, y - radius, radius * 2, radius * 2);
    }
  };

  // Faint nebula wisps — barely-there colour so the black isn't sterile.
  const NEBULA_TINTS = [
    "90,110,200", // blue
    "140,90,190", // violet
    "70,140,170", // teal
    "170,110,140", // dusty rose
  ];
  for (let i = 0; i < 10; i += 1) {
    const tint = NEBULA_TINTS[Math.floor(rand() * NEBULA_TINTS.length)];
    const alpha = 0.02 + rand() * 0.035;
    wrappedBlob(
      rand() * size,
      size * 0.12 + rand() * size * 0.76,
      280 + rand() * 560,
      [
        [0, `rgba(${tint},${alpha})`],
        [0.55, `rgba(${tint},${(alpha * 0.45).toFixed(3)})`],
        [1, `rgba(${tint},0)`],
      ],
    );
  }

  // Stars. The bright few get a soft halo.
  for (let i = 0; i < 850; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const magnitude = rand();
    const radius = magnitude < 0.9 ? 0.5 + rand() * 0.7 : 1.1 + rand() * 1.2;
    const alpha = 0.2 + rand() * 0.8;
    const tint = rand();
    const color = tint < 0.72
      ? `255,255,255`
      : tint < 0.9
        ? `195,216,255`
        : `255,232,198`;
    if (magnitude > 0.97) {
      wrappedBlob(x, y, 5 + rand() * 6, [
        [0, `rgba(${color},${(alpha * 0.55).toFixed(2)})`],
        [1, `rgba(${color},0)`],
      ]);
    }
    for (const offset of [-size, 0, size]) {
      ctx.fillStyle = `rgba(${color},${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(x + offset, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The sun: hot core, warm bloom, wide halo.
  const sunX = SKYBOX_SUN_U * size;
  const sunY = SKYBOX_SUN_V * size;
  wrappedBlob(sunX, sunY, 560, [
    [0, "rgba(255,253,244,1)"],
    [0.045, "rgba(255,248,222,1)"],
    [0.09, "rgba(255,238,185,0.9)"],
    [0.18, "rgba(255,216,140,0.5)"],
    [0.38, "rgba(255,196,112,0.18)"],
    [0.68, "rgba(255,186,102,0.05)"],
    [1, "rgba(255,182,98,0)"],
  ]);

  return canvas.toDataURL("image/png");
};

export const getSkyboxUrl = () => {
  if (!skyboxUrl) skyboxUrl = buildSkyboxDataUrl();
  return skyboxUrl;
};
