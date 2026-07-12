/*! Open Historia — procedural space skybox © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// One repeatable panoramic sky image behind the globe. The sun is deliberately
// separate: baking a unique object into a tiled texture creates duplicate suns.

export const SKYBOX_SIZE = 2048;

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

  return canvas.toDataURL("image/png");
};

export const getSkyboxUrl = () => {
  if (!skyboxUrl) skyboxUrl = buildSkyboxDataUrl();
  return skyboxUrl;
};
