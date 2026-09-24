/*! Open Historia — unit counter flag icons © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Turns a unit's owner into a round flag icon sitting inside its counter.
//
// MapLibre can only draw an icon that is already in the style's image atlas, so
// every flag has to be fetched, rasterised and handed to map.addImage() before a
// symbol layer can name it. That makes three things matter:
//
//   * A flag is fetched ONCE per owner+URL and the decoded pixels are kept. The
//     URL is part of the key because a regime/flag change must replace an icon for
//     the SAME stable polity identity without requiring a map reload.
//   * map.setStyle() throws the whole image atlas away — a basemap change or a
//     projection toggle silently drops every flag. So "is this on the map?" is
//     asked of the map itself on every sync, and a dropped icon is re-added from
//     the cached pixels without a second network request.
//   * A failure is cached per owner+URL too. A bad old URL must not poison a
//     later replacement flag for the same stable polity identity.

import { resolvePolityFlag } from "../../runtime/polityFlags.js";

// Rasterised at 64px and scaled down by icon-size. Comfortably above the largest
// counter (16px radius => a ~26px disc at z12), so the flag stays supersampled
// rather than blurring at close zoom.
const FLAG_ICON_PX = 64;

const iconIdFor = (ownerCode) => `unit-flag:${ownerCode}`;

// flagcdn serves a fixed-width PNG alongside the .svg the DOM <img> tags use.
// Take the raster here: an SVG drawn into a canvas has no reliable intrinsic
// size (a viewBox-only file reports 0, or 300x150), and guessing it wrong
// stretches the flag.
const FLAGCDN_SVG = /^https:\/\/flagcdn\.com\/([a-z-]+)\.svg$/i;
const rasterFlagUrl = (url) => {
  const match = FLAGCDN_SVG.exec(url);
  return match ? `https://flagcdn.com/w160/${match[1].toLowerCase()}.png` : url;
};

// The same flag the country panel, the chat and the flag picker show: the one
// shared resolver (runtime/polityFlags.js). This used to be its own lookup —
// an exact flags.json key, the polity record's own flag, or an ISO country
// NAMED exactly like the owner — so a renamed polity (the United Kingdom
// reconstituted as the British Empire) found nothing on all three and its
// counters fell back to the unit-type letters while its panel showed the flag.
// The shared resolver follows the polity's identity: its aliases, its map
// references and its stock country.
export const resolveUnitFlagUrl = (ownerCode, customFlags, polities) => {
  if (!ownerCode) return null;
  const { imageUrl } = resolvePolityFlag({
    polity: { name: ownerCode, code: ownerCode },
    world: { polityOverrides: polities ?? {} },
    flags: customFlags ?? {},
  });
  return imageUrl ? rasterFlagUrl(imageUrl) : null;
};

// ownerCode + URL -> ImageData, or null once that exact URL has failed. Stable
// polity identity deliberately does NOT change when the display name or regime
// changes, so owner-only caching would permanently pin the old flag in-session.
export const unitFlagPixelCacheKey = (ownerCode, url) => `${String(ownerCode ?? "")}\u0000${String(url ?? "")}`;
const pixelCache = new Map();
const inFlight = new Map();
// The URL each owner was last asked for. A replacement flag evicts the previous
// URL's pixels (custom flags are data URLs, so an entry holds the image twice)
// instead of keeping every flag a player ever tried for the whole session.
const latestUrlByOwner = new Map();
const forgetPreviousFlag = (ownerCode, url) => {
  const previous = latestUrlByOwner.get(ownerCode);
  if (previous === url) return;
  latestUrlByOwner.set(ownerCode, url);
  if (previous === undefined) return;
  const previousKey = unitFlagPixelCacheKey(ownerCode, previous);
  if (!inFlight.has(previousKey)) pixelCache.delete(previousKey);
};

// The style image atlas is per MapLibre map/style. Track which URL is currently
// installed under each stable owner icon so a changed flag can update the same
// icon id without re-keying units or forcing a reload.
const installedUrlByMap = new WeakMap();
const installedUrlsFor = (map) => {
  let urls = installedUrlByMap.get(map);
  if (!urls) {
    urls = new Map();
    installedUrlByMap.set(map, urls);
  }
  return urls;
};

const removeInstalledFlag = (map, ownerCode, id) => {
  const urls = installedUrlsFor(map);
  if (map?.hasImage?.(id)) {
    try { map.removeImage?.(id); } catch { /* style may be mid-reload */ }
  }
  urls.delete(ownerCode);
};

const installFlagPixels = (map, ownerCode, url, pixels) => {
  if (!map?.addImage || !pixels) return false;
  const id = iconIdFor(ownerCode);
  const urls = installedUrlsFor(map);
  let hasImage = false;
  try { hasImage = Boolean(map.hasImage?.(id)); } catch { hasImage = false; }

  if (!hasImage) {
    try {
      map.addImage(id, pixels);
      urls.set(ownerCode, url);
      return true;
    } catch {
      return false;
    }
  }

  if (urls.get(ownerCode) === url) return true;

  // MapLibre's updateImage is the clean replacement path: source features keep
  // referring to the same stable icon id while only its pixels change.
  if (typeof map.updateImage === "function") {
    try {
      map.updateImage(id, pixels);
      urls.set(ownerCode, url);
      return true;
    } catch {
      // Fall through for older/partial MapLibre implementations.
    }
  }

  try {
    map.removeImage?.(id);
    map.addImage(id, pixels);
    urls.set(ownerCode, url);
    return true;
  } catch {
    return false;
  }
};

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
    const cacheKey = unitFlagPixelCacheKey(ownerCode, url);
    forgetPreviousFlag(ownerCode, url);
    const cached = pixelCache.get(cacheKey);

    if (cached) {
      // Re-add after a style reload, or replace the pixels when this same stable
      // polity received a new flag URL. No refetch when the exact URL is cached.
      if (installFlagPixels(map, ownerCode, url, cached)) ready[ownerCode] = id;
      continue;
    }

    // null (not undefined) means this exact URL failed. If an older flag remains
    // installed under the stable icon id, drop it rather than showing stale state.
    if (cached === null) {
      const installed = installedUrlsFor(map).get(ownerCode);
      if (installed && installed !== url) removeInstalledFlag(map, ownerCode, id);
      continue;
    }

    // While a replacement downloads, keeping the previous icon for a few frames
    // is less jarring than flashing back to the unit-type glyph. It is replaced
    // atomically as soon as the new pixels arrive.
    try {
      if (map.hasImage?.(id)) ready[ownerCode] = id;
    } catch { /* style may be mid-reload */ }

    if (inFlight.has(cacheKey)) continue;
    const request = loadFlagPixels(url)
      .then((pixels) => {
        pixelCache.set(cacheKey, pixels ?? null);
        if (pixels) onChange?.();
      })
      .catch(() => {
        pixelCache.set(cacheKey, null);
        onChange?.();
      })
      .finally(() => {
        inFlight.delete(cacheKey);
      });
    inFlight.set(cacheKey, request);
  }

  return ready;
};
