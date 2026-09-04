/*! Open Historia — unit counter flag icons © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Turns a unit's owner into a round flag icon sitting inside its counter.
//
// MapLibre can only draw an icon that is already in the style's image atlas, so
// every flag has to be fetched, rasterised and handed to map.addImage() before a
// symbol layer can name it. That makes three things matter:
//
//   * A flag is fetched ONCE per owner and the decoded pixels are kept. Owners
//     repeat across dozens of counters, and the same handful recur every time the
//     unit list is re-synced (every 5s).
//   * map.setStyle() throws the whole image atlas away — a basemap change or a
//     projection toggle silently drops every flag. So "is this on the map?" is
//     asked of the map itself on every sync, and a dropped icon is re-added from
//     the cached pixels without a second network request.
//   * A failure is cached too. A scenario country that resolves to no ISO flag
//     would otherwise re-request on every sync, forever.

import { gidToAlpha2 } from "../../runtime/countryFlags.js";

// Rasterised at 64px and scaled down by icon-size. Comfortably above the largest
// counter (16px radius => a ~26px disc at z12), so the flag stays supersampled
// rather than blurring at close zoom.
const FLAG_ICON_PX = 64;

const iconIdFor = (ownerCode) => `unit-flag:${ownerCode}`;

// flagcdn serves a fixed-width PNG alongside the .svg the DOM <img> tags use.
// Take the raster here: an SVG drawn into a canvas has no reliable intrinsic
// size (a viewBox-only file reports 0, or 300x150), and guessing it wrong
// stretches the flag.
const isoFlagUrl = (ownerCode) => {
  const alpha2 = gidToAlpha2(ownerCode);
  return alpha2 ? `https://flagcdn.com/w160/${alpha2}.png` : null;
};

// Same precedence as the country panel (see resolveEraFlagInfo in Selection/Regions):
// a flag the map-maker uploaded wins, then a scenario polity's own, then the ISO
// flag the owner name resolves to.
export const resolveUnitFlagUrl = (ownerCode, customFlags, polities) => {
  if (!ownerCode) return null;
  return customFlags?.[ownerCode] || polities?.[ownerCode]?.flag || isoFlagUrl(ownerCode);
};

// ownerCode -> ImageData, or null once a load has failed and must not be retried.
const pixelCache = new Map();
const inFlight = new Map();

// Crop to a circle so the flag sits inside the round counter instead of poking
// out of it as a rectangle. Cover-fit, so a 3:2 flag fills the disc rather than
// letterboxing into it.
const toCircularImageData = (image) => {
  const canvas = document.createElement("canvas");
  canvas.width = FLAG_ICON_PX;
  canvas.height = FLAG_ICON_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const half = FLAG_ICON_PX / 2;
  ctx.beginPath();
  ctx.arc(half, half, half, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  const width = image.naturalWidth || image.width || 3;
  const height = image.naturalHeight || image.height || 2;
  const scale = Math.max(FLAG_ICON_PX / width, FLAG_ICON_PX / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  ctx.drawImage(image, (FLAG_ICON_PX - drawWidth) / 2, (FLAG_ICON_PX - drawHeight) / 2, drawWidth, drawHeight);

  return ctx.getImageData(0, 0, FLAG_ICON_PX, FLAG_ICON_PX);
};

const loadFlagPixels = (url) =>
  new Promise((resolve, reject) => {
    const image = new window.Image();
    // Without this the canvas is tainted and getImageData throws. With it, a host
    // that sends no CORS headers fails the load outright instead — a clean miss
    // that falls back to the type glyph, rather than an exception mid-render.
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(toCircularImageData(image));
    image.onerror = () => reject(new Error(`flag image failed: ${url}`));
    image.src = url;
  });

// Make sure every owner in `wanted` has its flag on the map, and report which
// ones are ready RIGHT NOW as ownerCode -> icon id.
//
// wanted: [{ ownerCode, url }]. onChange fires once per newly available flag, so
// the caller can repaint — the icon id is inert until the source is re-tiled.
export const syncUnitFlagIcons = (map, wanted, onChange) => {
  const ready = {};
  if (!map?.addImage) return ready;

  for (const { ownerCode, url } of wanted) {
    if (!ownerCode || !url) continue;
    const id = iconIdFor(ownerCode);
    const cached = pixelCache.get(ownerCode);

    if (cached) {
      // Re-add after a style reload wiped the atlas. No refetch: the pixels are
      // still here, only the map's copy of them went away.
      if (!map.hasImage(id)) map.addImage(id, cached);
      ready[ownerCode] = id;
      continue;
    }
    // null (not undefined) means a previous load failed — leave it to the glyph.
    if (cached === null || inFlight.has(ownerCode)) continue;

    const request = loadFlagPixels(url)
      .then((pixels) => {
        pixelCache.set(ownerCode, pixels ?? null);
        if (pixels) onChange?.();
      })
      .catch(() => {
        pixelCache.set(ownerCode, null);
      })
      .finally(() => {
        inFlight.delete(ownerCode);
      });
    inFlight.set(ownerCode, request);
  }

  return ready;
};
