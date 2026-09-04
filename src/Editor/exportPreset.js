/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Turn an edited map into a game-playable seed.
//
// Tier 1 (re-ownership maps): regions keep their GADM GID_1 ids, so the game
// renders them from the stock regions.pmtiles and just needs world.json
// (regionOwnershipOverrides + polityOverrides) and colors.json — exactly like the
// bundled WWII/Medieval presets. Tier 2 (custom geometry, new/split/merged
// regions): the exported regions.geojson carries the shapes and world.customRegions
// tells the game to render them from a GeoJSON layer (see src/Game/Map/Nations.jsx).

import COUNTRY_NAMES from "../runtime/generated/countryNames.js";
import { OWNER_SCHEMA } from "./documentMigration.js";

// GADM ids contain a dot ("DEU.2_1", "Z01.14_1", "CHN.HKG"); regions drawn in the
// editor use "reg_..." ids. Only the latter are custom geometry that tier-1 (stock
// regions.pmtiles) cannot render. This tests the region's ID, which stays a GADM
// identifier — it is not an owner test and does not move with the rename.
const isGid1 = (id) => /\./.test(String(id || "")) && !/^reg_/.test(String(id || ""));

// Deterministic pleasant color from an owner code (used when colors.json has no
// entry) — mirrors the game's procedural fallback rather than a flat gray.
const codeToColor = (code) => {
  let h = 0;
  for (let i = 0; i < code.length; i += 1) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const s = 0.5;
  const l = 0.5;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
};

const cssColorToRgb = (value) => {
  const m = /^#?([a-f0-9]{6})$/i.exec(String(value || "").trim());
  if (!m) return null;
  const hex = m[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
};

const rgbToHex = (rgb) =>
  `#${(Array.isArray(rgb) ? rgb : [128, 128, 128])
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, Math.round(Number(n) || 0))).toString(16).padStart(2, "0"))
    .join("")}`;

// OpenLayers' GeoJSON writer puts the feature id at the top level (feature.id),
// not in properties, and MapLibre's ["get","id"] reads from properties. Rebuild a
// FeatureCollection whose properties carry everything the game renderer/selection
// needs: id, owner (the owning country's NAME, which drives the fill), name,
// gid0, typeId.
const normalizeRegionsForGame = (regionsFC) => {
  const features = [];
  for (const f of regionsFC?.features || []) {
    const props = f.properties || {};
    const id = props.id != null ? String(props.id) : f.id != null ? String(f.id) : "";
    if (!id || !f.geometry) continue;
    const owner = props.owner ? String(props.owner) : "";
    // Disputed regions ship their claimant list — the game renders these striped
    // in the claimants' colors.
    const claimants = Array.isArray(props.claimants)
      ? props.claimants.map((c) => String(c).trim()).filter(Boolean)
      : [];
    // Keep the id in properties only (MapLibre reads ["get","id"]); a non-integer
    // top-level feature id would spam console warnings across thousands of regions.
    features.push({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        id,
        owner,
        // GADM provenance: which real country this polygon physically is. Blank
        // for a region drawn in the editor, which is on no GADM map. It used to
        // fall back to the owner, which was harmless while owner was a code and
        // is now a category error — it would file "Roman Empire" as a GADM code.
        gid0: props.gid0 ? String(props.gid0) : "",
        name: props.name ? String(props.name) : "",
        // No `country`: owner IS the country's name.
        typeId: props.typeId ? String(props.typeId) : "land",
        ...(claimants.length ? { claimants } : {}),
        // A GADM region the editor reshaped (draw-carve, vertex edit). Its true
        // geometry now lives in THIS GeoJSON, not the stock tiles — which still
        // hold the original shape. The game reads this to render the region from
        // the GeoJSON at every zoom and keep it OUT of the stock-tile fill, so the
        // reshaped area isn't painted twice and shaded too dark (see Nations.jsx).
        ...(props.edited ? { edited: true } : {}),
      },
    });
  }
  return { type: "FeatureCollection", features };
};

// A map needs its geometry shipped (tier 2) when it contains any non-GADM region,
// a merged region, or is a from-scratch (blank) document — anything the stock
// pmtiles cannot reproduce. Pure re-ownership world maps stay tier 1.
const detectCustomGeometry = (regionsFC, kind) => {
  if (kind === "blank") return true;
  for (const f of regionsFC?.features || []) {
    const props = f.properties || {};
    const id = props.id != null ? String(props.id) : f.id != null ? String(f.id) : "";
    if (!isGid1(id)) return true;
    if (props.mergedFrom || props.edited) return true;
  }
  return false;
};

// The game has three city-size tiers: 1 = town, 2 = city, 3 = major city.
// Capital is an independent flag, not a fourth size tier. Imported/authored tier
// wins when present; legacy cities without tier still derive size from population.
const cityTier = (f) => {
  const authored = Number(f.tier);
  if (Number.isFinite(authored) && authored >= 1 && authored <= 3) return Math.round(authored);
  const pop = Number(f.population || 0);
  return pop >= 1000000 ? 3 : pop >= 100000 ? 2 : 1;
};

// The document's point features (cities) as the game-ready cities.geojson.
const buildCitiesForGame = (features) => ({
  type: "FeatureCollection",
  features: (features || [])
    .filter((f) => Array.isArray(f.coord) && f.coord.length === 2 && f.coord[0] != null && f.coord[1] != null)
    .map((f) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [Number(f.coord[0]), Number(f.coord[1])] },
      properties: {
        city: f.name ? String(f.name) : "",
        population: f.population || 0,
        capital: (f.tags || []).includes("capital") ? "primary" : "",
        tier: cityTier(f),
      },
    })),
});

// Turn the editor's persisted custom background (doc.metadata.customBackground)
// into what the game needs: a light descriptor for world.json (just the kind) and
// the heavy payload for the backgroundData asset (loaded once, off the 5s world
// poll). Images carry a data URL — the game stretches them across the whole world
// to fully replace Earth; vectors carry their GeoJSON. Raster uploads
// (GeoTIFF/PMTiles) are editor-only reference and don't persist, so they never
// reach here. Returns { background: null } when there's nothing.
const buildBackgroundForGame = (customBackground) => {
  const bg = customBackground;
  if (!bg || typeof bg !== "object") return { background: null, backgroundData: null };
  if (bg.kind === "image" && bg.dataUrl) {
    return {
      background: { kind: "image" },
      backgroundData: { dataUrl: bg.dataUrl },
    };
  }
  if (bg.kind === "vector" && bg.geojson && Array.isArray(bg.geojson.features)) {
    return {
      background: { kind: "vector" },
      backgroundData: { geojson: bg.geojson },
    };
  }
  return { background: null, backgroundData: null };
};

// Every country the stock world already knows by name. An owner in here is a real
// GADM country the game can name, colour and flag on its own; an owner outside it
// is something the map-maker invented, and only a polity entry tells the game and
// the model that it exists at all.
const STOCK_COUNTRY_NAMES = new Set(Object.values(COUNTRY_NAMES));

export const buildGameSeed = (doc, regionsFC, palette = {}, { playerCountry } = {}) => {
  const regionOwnershipOverrides = {};
  const owners = new Set();
  let customCount = 0;

  for (const f of regionsFC?.features || []) {
    const props = f.properties || {};
    const id = props.id != null ? String(props.id) : f.id != null ? String(f.id) : "";
    const owner = props.owner;
    if (!id) continue;
    if (!isGid1(id)) customCount += 1;
    if (owner) {
      regionOwnershipOverrides[id] = owner;
      owners.add(owner);
    }
  }

  const kind = doc.metadata?.kind || "import-world";
  const hasCustomGeometry = detectCustomGeometry(regionsFC, kind);
  const gameRegions = normalizeRegionsForGame(regionsFC);

  // Scenario Workshop / owner schema 4: region ownership is a stable
  // polity KEY. The visible/current name belongs to the polity registry and may
  // change without re-keying a single region.
  const overrides = doc.colorOverrides || {};
  const declaredPolities = doc.polities && typeof doc.polities === "object"
    ? doc.polities
    : {};
  const colors = {};
  const polityOverrides = {};

  const emitPolity = (key, source = null) => {
    const stableKey = String(key || "").trim();
    if (!stableKey) return;
    const record = source && typeof source === "object" ? source : {};
    const displayName = String(record.name || stableKey).trim() || stableKey;
    const rgb = overrides[stableKey]
      || palette[stableKey]
      || cssColorToRgb(record.color)
      || codeToColor(stableKey);
    colors[stableKey] = rgb;

    // Explicit records are authoritative even for stock/base countries: that is
    // how an author can keep the stable key "Austria" while presenting the polity
    // as "Austria-Hungary". Unknown owner keys still receive a default record so
    // the game/model know the polity exists.
    const explicit = Object.prototype.hasOwnProperty.call(declaredPolities, stableKey);
    if (explicit || !STOCK_COUNTRY_NAMES.has(stableKey)) {
      const aliases = [...new Set([
        ...(Array.isArray(record.aliases) ? record.aliases : []),
        displayName,
      ].map((v) => String(v || "").trim()).filter(Boolean))];
      polityOverrides[stableKey] = {
        ...record,
        code: record.code || stableKey,
        name: displayName,
        aliases,
        color: overrides[stableKey] ? rgbToHex(overrides[stableKey]) : (record.color || rgbToHex(rgb)),
        note: String(record.note || ""),
        status: record.status || "active",
        ...(record.verbatim || COUNTRY_NAMES[stableKey] ? { verbatim: Boolean(record.verbatim || COUNTRY_NAMES[stableKey]) } : {}),
      };
    }
  };

  for (const owner of owners) emitPolity(owner, declaredPolities[owner]);
  // Landless governments/exiles and other explicit scenario actors have no region
  // to discover them from, so the document registry must be included independently.
  for (const [key, record] of Object.entries(declaredPolities)) {
    if (!owners.has(key)) emitPolity(key, record);
  }

  const author = (doc.metadata?.author || "").trim();
  const gameCities = buildCitiesForGame(doc.features);
  const { background, backgroundData } = buildBackgroundForGame(doc.metadata?.customBackground);
  const world = {
    ownerSchema: doc.ownerSchema ?? OWNER_SCHEMA,
    regionOwnershipOverrides,
    polityOverrides,
    // A custom background replaces Earth, so it must also hide the stock modern
    // political overlay (country fills, borders, "Russia"/"France" labels) — those
    // are gated on customRegions in the game, so force it on whenever there's a
    // background, even for a re-ownership map that ships no drawn geometry.
    customRegions: hasCustomGeometry || Boolean(background),
    // Custom map background (image placed by extent, or a vector overlay). null
    // clears any previously applied background. The heavy payload rides in the
    // seed's backgroundData below, uploaded as a separate scenario asset.
    background,
    // The chosen built-in basemap (an ESRI preset id) so the game renders THAT
    // basemap, not always the ocean default. Ignored when a custom background
    // replaces it. Falls back to ocean in-game if unset/unknown.
    basemap: doc.metadata?.basemap || null,
    // Authored cities replace the modern city labels. A custom-geometry map with
    // no cities still sets the flag — modern names over invented land would be
    // wrong — while a pure re-ownership map without cities keeps the stock set.
    customCities: gameCities.features.length > 0 || hasCustomGeometry,
    author,
    mapCredit: author ? `Made by ${author}` : "",
    simulationRules: doc.metadata?.simulationRules || "",
    startingTimelineText: doc.metadata?.startingTimelineText || "",
  };
  const firstOwner = Object.values(regionOwnershipOverrides)[0] || "";
  const game = {
    country: playerCountry || firstOwner,
    startDate: doc.metadata?.startDate || "",
    gameDate: doc.metadata?.gameDate || "",
  };

  return {
    name: `${doc.name || doc.metadata?.name || "map"}-game-seed`,
    kind,
    author,
    credit: author ? `Made by ${author}` : "",
    hasCustomGeometry,
    stats: { ownedRegions: Object.keys(regionOwnershipOverrides).length, owners: owners.size, customGeometry: customCount },
    world,
    // Merge onto the full base palette so re-ownership (tier-1) maps keep colors
    // for every country the stock pmtiles still renders, not just the edited ones.
    // Overrides go on last so a colour the map-maker picked survives even for a
    // country that owns no regions on this map — the stock tiles still paint it.
    colors: { ...palette, ...colors, ...overrides },
    game,
    // flags.json: owner code -> PNG data URL. Deliberately NOT part of world, which
    // the game re-polls every 5s — these are re-fetched only when the scenario
    // changes, exactly like colors. Empty object when the map sets no flags, so the
    // upload is skipped and the game keeps its code-derived flags.
    flags: doc.flags && Object.keys(doc.flags).length > 0 ? { ...doc.flags } : null,
    // tags.json: owner code -> string[]. Same reasoning as flags — static author
    // data, not part of the 5s world poll. These are the STARTING tags; the AI's
    // later changes live in world.countryTags and are merged over these on read.
    tags: doc.tags && Object.keys(doc.tags).length > 0 ? { ...doc.tags } : null,
    // regions is the normalized, game-ready FeatureCollection. Only uploaded to the
    // scenario when hasCustomGeometry (tier 2); harmless in the downloaded JSON.
    regions: gameRegions,
    // cities is the authored era city set (cities.geojson in the scenario).
    cities: gameCities,
    // Heavy background payload ({ dataUrl } or { geojson }) — uploaded as the
    // backgroundData scenario asset; null when there's no custom background.
    backgroundData,
  };
};
