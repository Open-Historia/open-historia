/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Turns whatever flag file a map-maker drags in into one normalized PNG data URL.
//
// We never store the upload as-is. Every flag ends up in flags.json, which is
// base64'd into the scenario bundle — and a bundle is already ~17MB and gets
// published as a GitHub issue attachment (~25MB ceiling). A single careless 4MB
// PNG, times a few countries, pushes a scenario past the point where it can be
// shared at all. Downscaling here is what keeps that from happening, and it costs
// nothing: a flag is never drawn larger than a panel header or a profile circle.
//
// SVG is accepted because that is the format flags actually come in (the game's own
// fallback pulls .svg from flagcdn), but it is rasterized immediately: the stored
// format stays PNG, so nothing downstream has to sanitize markup that arrived
// inside a shared scenario.

// Long-edge cap. 256 keeps a flag crisp in the country panel and the profile
// circles while landing around 5-15KB each.
const MAX_DIM = 256;

export const FLAG_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.svg,image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file isn't an image the browser can read."));
    img.src = src;
  });

// An SVG with no width/height renders at 0x0 on a canvas in some browsers, so give
// the element an explicit size before drawing.
const naturalSize = (img) => {
  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  if (w > 0 && h > 0) return { w, h };
  return { w: MAX_DIM, h: Math.round(MAX_DIM * 0.66) }; // sane flag-ish default
};

/**
 * @param {File} file
 * @returns {Promise<string>} PNG data URL, long edge <= MAX_DIM
 */
export const fileToFlagDataUrl = async (file) => {
  if (!file) throw new Error("No file selected.");
  const sourceUrl = await readAsDataUrl(file);
  const img = await loadImage(sourceUrl);
  const { w, h } = naturalSize(img);

  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process that image.");
  // Flags are flat colour and hard edges; smoothing on downscale avoids jaggies.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, outW, outH);

  // PNG, not JPEG: flags have hard edges and often transparency, and JPEG ringing
  // on a two-colour flag looks worse than the bytes it saves.
  return canvas.toDataURL("image/png");
};

export const dataUrlBytes = (dataUrl) => {
  const comma = String(dataUrl || "").indexOf(",");
  if (comma < 0) return 0;
  // base64 -> bytes, ignoring padding.
  return Math.floor((String(dataUrl).length - comma - 1) * 3 / 4);
};
