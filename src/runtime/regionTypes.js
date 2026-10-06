/*! Open Historia — region types in the game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A region type (the Workshop's Region Types panel, src/Editor/TypeManager.jsx)
// is a look and a few rules that regions share: "Sea", "Mountains",
// "Wasteland". Each region names its type by `typeId` in the regions file, and
// the Workshop saves the map's types into the scenario's world as
// world.regionTypes (exportPreset.js buildGameSeed). The game reads them here:
//
//   - the map draws a type's fill colour, opacity, border and zoom range
//     (regionTypeRenderStyles, regionTypeFeatureState; Nations.jsx);
//   - the unit and structure directors are told a type's rules for moving
//     and placing (regionTypeRules; gameplay.js), inside requests they make
//     anyway.
//
// Only what differs from the Workshop's default Land type counts, so a map
// whose types are left as they come looks and plays exactly as before. The
// Workshop's Z-Index and Included In Labels have no counterpart in the game:
// its regions never overlap, and it labels countries, not regions. Pure;
// tested in regionTypes.test.js.

const TYPE_LIMIT = 64;

// The Workshop's Land type (src/Editor/useMapDocument.js DEFAULT_TYPES).
export const REGION_TYPE_DEFAULTS = Object.freeze({
  opacity: 0.55,
  unownedOpacity: 0.25,
  zIndex: 1,
  strokeWidth: 1.5,
  strokeColor: Object.freeze([0, 0, 0]),
  strokeOpacity: 1,
  overrideColor: null,
  pathfindingSpeed: 1,
  interactable: true,
  showToDefaultPrompt: true,
  passable: true,
  includedInLabels: true,
  zoomSettings: Object.freeze([Object.freeze({ minZoom: 0, maxZoom: 24 })]),
});

const text = (value) => String(value ?? "").trim();
const number = (value, fallback, min = -Infinity, max = Infinity) => {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const rgb = (value) => (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every((c) => c !== null && c !== "" && Number.isFinite(Number(c)))
  ? value.slice(0, 3).map((c) => Math.round(Math.min(255, Math.max(0, Number(c)))))
  : null);
const flag = (value, fallback) => (typeof value === "boolean" ? value : fallback);

// The types as the Workshop keeps them, cleaned: each has an id (the first of
// an id wins), a name, and every setting in range, missing ones at Land's
// values. Anything else a type carries is kept, so a round trip through the
// scenario loses nothing.
export const normalizeRegionTypes = (value) => {
  const d = REGION_TYPE_DEFAULTS;
  const seen = new Set();
  const types = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (types.length >= TYPE_LIMIT) break;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const id = text(entry.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const bands = (Array.isArray(entry.zoomSettings) ? entry.zoomSettings : d.zoomSettings)
      .filter((band) => band && typeof band === "object")
      .map((band) => ({ ...band, minZoom: number(band.minZoom, 0, 0, 24), maxZoom: number(band.maxZoom, 24, 0, 24) }));
    types.push({
      ...entry,
      id,
      name: text(entry.name) || id,
      opacity: number(entry.opacity, d.opacity, 0, 1),
      unownedOpacity: number(entry.unownedOpacity, d.unownedOpacity, 0, 1),
      zIndex: number(entry.zIndex, d.zIndex),
      strokeWidth: number(entry.strokeWidth, d.strokeWidth, 0, 50),
      strokeColor: rgb(entry.strokeColor) ?? [...d.strokeColor],
      strokeOpacity: number(entry.strokeOpacity, d.strokeOpacity, 0, 1),
      overrideColor: rgb(entry.overrideColor),
      pathfindingSpeed: number(entry.pathfindingSpeed, d.pathfindingSpeed, 0, 100),
      interactable: flag(entry.interactable, d.interactable),
      showToDefaultPrompt: flag(entry.showToDefaultPrompt, d.showToDefaultPrompt),
      passable: flag(entry.passable, d.passable),
      includedInLabels: flag(entry.includedInLabels, d.includedInLabels),
      zoomSettings: bands,
    });
  }
  return types;
};

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

const sameRgb = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

// What a (normalized) type changes about how its regions are drawn, or null
// when it draws them as Land does:
//   fill           its override colour, over the owner's
//   ownedScale     its opacity against Land's, for an owned region
//   unownedScale   its unowned opacity against Land's, for an unowned one
//   stroke         its border colour, where it is not Land's black
//   strokeScale    its border width against Land's
//   bands          [[min, max], ...] in Workshop zoom, where it is not always shown
// The game's own opacities and hairlines stay the baseline: a type twice as
// opaque as Land fills twice as strongly as the game fills a Land region.
export const regionTypeRenderStyle = (type) => {
  const d = REGION_TYPE_DEFAULTS;
  if (!type || typeof type !== "object") return null;
  const fill = rgb(type.overrideColor);
  const strokeRgb = rgb(type.strokeColor) ?? d.strokeColor;
  const strokeOpacity = number(type.strokeOpacity, d.strokeOpacity, 0, 1);
  const bands = (Array.isArray(type.zoomSettings) ? type.zoomSettings : [])
    .filter((band) => band && typeof band === "object")
    .map((band) => [number(band.minZoom, 0), number(band.maxZoom, 24)]);
  const style = {
    fill: fill ? `rgb(${fill.join(", ")})` : null,
    ownedScale: number(type.opacity, d.opacity, 0, 1) / d.opacity,
    unownedScale: number(type.unownedOpacity, d.unownedOpacity, 0, 1) / d.unownedOpacity,
    stroke: sameRgb(strokeRgb, d.strokeColor) && strokeOpacity === d.strokeOpacity
      ? null
      : `rgba(${strokeRgb.join(", ")}, ${strokeOpacity})`,
    strokeScale: number(type.strokeWidth, d.strokeWidth, 0, 50) / d.strokeWidth,
    // No bands, or one that covers every zoom, is always shown (olStyle.js pickZoomBand).
    bands: bands.length && !bands.some(([min, max]) => min <= 0 && max >= 24) ? bands : null,
  };
  const plain = !style.fill && style.ownedScale === 1 && style.unownedScale === 1
    && !style.stroke && style.strokeScale === 1 && !style.bands;
  return plain ? null : style;
};

// typeId -> render style, for the types that draw differently from Land.
export const regionTypeRenderStyles = (types) => {
  const styles = new Map();
  for (const type of normalizeRegionTypes(types)) {
    const style = regionTypeRenderStyle(type);
    if (style) styles.set(type.id, style);
  }
  return styles;
};

// The Workshop (OpenLayers) counts zoom in 256-pixel tiles and the game's
// MapLibre in 512-pixel ones, so the same view is one level lower in the game.
export const WORKSHOP_ZOOM_OFFSET = 1;

export const regionTypeShownAt = (style, zoom) => {
  if (!style?.bands) return true;
  const workshopZoom = Number(zoom) + WORKSHOP_ZOOM_OFFSET;
  return style.bands.some(([min, max]) => workshopZoom >= min && workshopZoom <= max);
};

// Which banded types are shown at a zoom, as one string: the map rewrites its
// types' state only when this changes, not on every zoom step.
export const regionTypeZoomKey = (styles, zoom) => {
  let key = "";
  for (const [id, style] of styles ?? []) {
    if (style.bands) key += `${id}:${regionTypeShownAt(style, zoom) ? 1 : 0};`;
  }
  return key;
};

const EMPTY_STATE = Object.freeze({ typeFill: null, typeOpacity: null, typeStroke: null, typeStrokeScale: null });

// The feature-state a region of this style gets on the game map. The paint
// reads each key with the game's own value as the fallback, so null leaves
// that part as it is; outside its zoom range the fill and border are 0.
export const regionTypeFeatureState = (style, { owned = false, zoom = 0 } = {}) => {
  if (!style) return EMPTY_STATE;
  const shown = regionTypeShownAt(style, zoom);
  const scale = owned ? style.ownedScale : style.unownedScale;
  return {
    typeFill: style.fill,
    typeOpacity: !shown ? 0 : scale === 1 ? null : scale,
    typeStroke: style.stroke,
    typeStrokeScale: !shown ? 0 : style.strokeScale === 1 ? null : style.strokeScale,
  };
};

// ---------------------------------------------------------------------------
// The AI
// ---------------------------------------------------------------------------

// What a type's movement and placement settings say, in words for the unit
// and structure directors; nothing for one that is left as Land's. Show To
// Default Prompt has no reader and is not offered in the Workshop.
export const regionTypeRuleText = (type) => {
  const rules = [];
  const speed = number(type?.pathfindingSpeed, 1, 0, 100);
  if (type?.passable === false || speed === 0) {
    rules.push("impassable: no unit enters or crosses these regions, so route around them");
  } else if (speed !== 1) {
    rules.push(speed < 1
      ? `slow going: units cross these regions at ${speed} times their usual speed`
      : `fast going: units cross these regions at ${speed} times their usual speed`);
  }
  if (type?.interactable === false) rules.push("out of play: place no unit and build no structure in these regions");
  return rules;
};

export const regionTypesHaveRules = (types) => normalizeRegionTypes(types).some((type) => regionTypeRuleText(type).length > 0);

// One line per type that has rules and regions, naming up to `namesPerType`
// of them: "- Sea (3 regions: North Sea, Irish Sea, Channel): impassable: …".
// `regions` are catalog rows ({ id, name, typeId }). "" when there is nothing
// to say, which is every map whose types are Land's.
export const regionTypeRules = (types, regions, { namesPerType = 12 } = {}) => {
  const ruled = normalizeRegionTypes(types)
    .map((type) => ({ type, rules: regionTypeRuleText(type) }))
    .filter(({ rules }) => rules.length);
  if (!ruled.length) return "";
  const namesByType = new Map(ruled.map(({ type }) => [type.id, []]));
  for (const region of Array.isArray(regions) ? regions : []) {
    const names = namesByType.get(text(region?.typeId));
    if (names) names.push(text(region?.name) || text(region?.id));
  }
  const lines = [];
  for (const { type, rules } of ruled) {
    const names = namesByType.get(type.id).filter(Boolean);
    if (!names.length) continue;
    const listed = names.slice(0, namesPerType).join(", ");
    const more = names.length > namesPerType ? `, and ${names.length - namesPerType} more` : "";
    const count = names.length === 1 ? "1 region" : `${names.length} regions`;
    lines.push(`- ${type.name} (${count}: ${listed}${more}): ${rules.join("; ")}.`);
  }
  return lines.join("\n");
};
