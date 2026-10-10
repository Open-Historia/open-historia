// An owner's colour on the map, one resolver for everything that paints by
// owner: region fills, disputed stripes and labels (Nations.jsx), unit
// counters and their orders (Units.jsx), and built structures
// (MarkersLayer.jsx). Before these shared it, units and structures looked the
// owner up in colors.json only, so a polity whose colour lives in the registry
// had its armies in an unrelated hash colour and its bases in parchment, beside
// territory painted correctly.
import { toCountryName } from "../../runtime/ownerNames.js";

// Procedural colour for an owner with no entry in the palette. Takes the owner —
// a country NAME now ("Russia", "Roman Empire"), not a GID_0 code.
//
// Stripping to A-Z first is what makes a name hash usefully. The letters are read
// positionally, so "Côte d'Ivoire" would otherwise hash on 'C', 'Ô', 'T' — and 'Ô'
// is not in the alphabet, so indexOf returns -1 and the channel clamps to 0. Every
// accented or two-word name would collapse toward the same dark corner of the
// space. Stripping gives "COTEDIVOIRE" and a colour that actually differs from its
// neighbours'.
export const fallbackRgbFromOwner = (owner = "") => {
  const normalized = String(owner ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (normalized.length < 3) {
    return [96, 96, 96];
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const a = Math.max(0, alphabet.indexOf(normalized[0]));
  const b = Math.max(0, alphabet.indexOf(normalized[1]));
  const c = Math.max(0, alphabet.indexOf(normalized[2]));
  return [64 + a * 5, 64 + c * 5, 64 + b * 5];
};

// "#c0507a" / "#c07" / "rgb(192, 80, 122)" -> [r,g,b]; null when unparseable.
// world.polityOverrides stores colours as CSS strings while colors.json stores
// RGB triplets, so the two namespaces need a bridge before they can be merged.
export const parseColorToRgb = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const hex = raw.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [
      parseInt(`${hex[0]}${hex[0]}`, 16),
      parseInt(`${hex[1]}${hex[1]}`, 16),
      parseInt(`${hex[2]}${hex[2]}`, 16),
    ];
  }
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(raw);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])].map((c) => Math.max(0, Math.min(255, c)));
};

// Display-only palette shaping. Scenario/save colours remain canonical; the map
// merely reins in extreme saturation/lightness so neighbouring polities read as
// one designed atlas rather than unrelated UI swatches.
export const normalizePoliticalRgb = (rgb) => {
  if (!Array.isArray(rgb) || rgb.length !== 3) return rgb;
  let [r, g, b] = rgb.map((value) => Math.max(0, Math.min(255, Number(value) || 0)));

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  // Release-map pass: preserve authored identity but give ordinary polity fills
  // enough chroma to survive the translucent physical basemap. The previous
  // atlas normalizer always pulled colors toward grey, which combined with the
  // low regional fill opacity to make neighboring countries look washed out.
  const saturationBoost = chroma < 18 ? 0.05 : chroma < 150 ? 0.18 : 0.09;
  r = luminance + (r - luminance) * (1 + saturationBoost);
  g = luminance + (g - luminance) * (1 + saturationBoost);
  b = luminance + (b - luminance) * (1 + saturationBoost);

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 510;

  if (lightness < 0.30) {
    const mix = Math.min(0.22, (0.30 - lightness) * 0.7);
    r += (255 - r) * mix;
    g += (255 - g) * mix;
    b += (255 - b) * mix;
  } else if (lightness > 0.64) {
    const mix = Math.min(0.18, (lightness - 0.64) * 0.75);
    r *= 1 - mix;
    g *= 1 - mix;
    b *= 1 - mix;
  }

  return [r, g, b].map((value) => Math.round(Math.max(0, Math.min(255, value))));
};

// Case/diacritic/punctuation-folded owner key, so "Côte d'Ivoire", "cote divoire"
// and "COTE D'IVOIRE" all reach the same palette entry.
export const ownerFoldKey = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

// ONE owner -> rgb resolver for every paint path. colors.json and the live
// polity registry (world.polityOverrides) are two different namespaces: a
// polity can be correctly NAMED by the registry while colors.json has no key
// for it — shipped example: "British Empire" owns 426 regions in
// world-war-ii-1939-copy with its colour (#c0507a) only in polityOverrides.
// Resolving the name but not the colour painted those regions a muddy
// procedural fallback, which reads to a player as "the map didn't annex it".
// Order: code -> name, colors.json, the registry's colour, then folded names
// (colors.json keys, registry keys and their aliases), then the hash.
// Memoised per owner: callers resolve one colour per REGION (3,662 in a played
// save) across only ~231 owners, and a fold-fallback miss is O(colorMap) with
// an allocation. Make a new resolver when either input changes.
export const createOwnerRgbResolver = (colorMap, polityOverrides) => {
  const palette = colorMap && typeof colorMap === "object" ? colorMap : {};
  const registry = polityOverrides && typeof polityOverrides === "object" ? polityOverrides : {};
  const cache = new Map();
  const resolve = (rawOwner) => {
    // Canonicalize an owner CODE ("ESP" from a transfer override) to the NAME the palette
    // is keyed by ("Spain") so a captured region takes its true owner's colour.
    const owner = toCountryName(rawOwner);
    const exact = palette[owner];
    if (exact) return exact;
    const registered = parseColorToRgb(registry[owner]?.color);
    if (registered) return registered;
    const fold = ownerFoldKey(owner);
    if (fold) {
      for (const [key, rgb] of Object.entries(palette)) {
        if (ownerFoldKey(key) === fold) return rgb;
      }
      for (const [key, entry] of Object.entries(registry)) {
        const names = [key, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])];
        if (!names.some((name) => ownerFoldKey(name) === fold)) continue;
        const rgb = parseColorToRgb(entry?.color);
        if (rgb) return rgb;
        const fromPalette = palette[key];
        if (fromPalette) return fromPalette;
      }
    }
    return fallbackRgbFromOwner(owner);
  };

  return (rawOwner) => {
    if (!rawOwner) return null;
    const key = String(rawOwner);
    if (!key.trim()) return null;
    if (cache.has(key)) return cache.get(key);
    const rgb = resolve(rawOwner);
    cache.set(key, rgb);
    return rgb;
  };
};

// The owner's colour as the territory shows it, as CSS; `unowned` for no owner.
export const ownerDisplayCss = (resolveOwnerRgb, owner, unowned) => {
  const rgb = normalizePoliticalRgb(resolveOwnerRgb(owner));
  return rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : unowned;
};
