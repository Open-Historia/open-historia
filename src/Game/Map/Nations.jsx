/*! Open Historia — portions (custom-regions tier-2 rendering) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markPolitiesReady } from "../../runtime/mapReadiness.js";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { onRegionSelected, onOceanClicked, dismissRegionPopup } from "../Selection/Regions";
import { onUnitSelected, dismissUnitPopup } from "../Selection/Units";
import { onFeatureSelected, dismissFeaturePopup } from "../Selection/Features";
import { saveSettledStructure } from "../../runtime/structurePlacement.js";
import {
  getInteractionMode,
  setInteractionMode,
  clearInteractionMode,
  deployUnit,
  placeUnitAdmin,
  UNIT_NOT_SAVED,
} from "./unitsController.js";
import { recordMapTrace, recordMapWork } from "../../runtime/mapPerfTrace.js";
import { logDebugEvent } from "../../runtime/debugLog.js";
import { ensurePmtilesProtocol } from "./mapLibreSetup.js";
import {
  JSON_URLS,
  PMTILES_PROTOCOL_URLS,
  getNationColors,
  loadRegionTileIdSet,
  primeCustomRegionCatalogEntries,
  readJson,
  reportPerfOperation,
  resolveCountryDisplayName,
} from "../../runtime/assets.js";
import { resolveRegionName } from "../../runtime/regionNameFixes.js";
import { isConstrainedDevice } from "../../runtime/deviceProfile.js";
import { useWorkerFetchableUrl } from "./useWorkerFetchableUrl.js";
import {
  REGIONS_PARSE_HOLD_MS,
  forgetParsedSourceCopy,
  holdUntilSourceLoaded,
} from "./regionsSourceMemory.js";
import { publishGroupIndex, publishPolityIndex } from "../../runtime/placeSearch.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { summarizePolityLabelDiagnostics } from "./vnext/polityLabels.js";
import { translateLabel } from "../../runtime/translator.js";
import { MAP_SETTING_KEYS, reduceMotionEnabled, useMapSetting, useMapSettingValue } from "../../runtime/mapSettings.js";
import { useActiveFeatures } from "../../runtime/gameFeatures.js";
import { getWorldStateSnapshot, useWorldState } from "./useWorldState.js";
import { cityPopulationOverridesByTileName, effectiveCityPopulation } from "../../runtime/cityPopulation.js";
import { buildProvinceOutlinePaint, PROVINCE_OUTLINE_MIN_ZOOM } from "./provinceOutlineStyle.js";
import { TYPE_FILL_STATE, withTypeFillOpacity } from "./regionTypePaint.js";
import { regionTypeFeatureState, regionTypeRenderStyles, regionTypeZoomKey } from "../../runtime/regionTypes.js";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";
import {
  createOwnerRgbResolver,
  fallbackRgbFromOwner,
  normalizePoliticalRgb,
  ownerDisplayCss,
} from "./ownerColors.js";
import GroupAreaLayers from "./GroupAreaLayers.jsx";
import { EMPTY_GROUP_AREA_DATA } from "./vnext/groupAreas.js";
import { POLITICAL_FILL_OPACITY_STOPS, V_NEXT_MARKER_SHAPE_LAYER_IDS } from "./vnext/presentationPolicy.js";
import { resolvePolityLabelNames } from "./vnext/polityNaming.js";
import PolityTextLayer, {
  isPolityTextPtr0Enabled,
  isPolityTextPtr1DebugEnabled,
  isPolityTextPtr1Enabled,
} from "./labels/PolityTextLayer.jsx";
import { buildPolityTextPtr1Records } from "./labels/polityTextRecords.js";
import { POLITY_TEXT_MAX_ZOOM } from "./labels/polityTextLayout.js";
import {
  buildOwnershipPresentationDelta,
  createPoliticalCartographyScheduler,
  diffPoliticalOwnership,
} from "./vnext/politicalCartographyLifecycle.js";
import { createOwnershipPresentationState } from "./vnext/ownershipPresentationHolds.js";
import { deriveLegacyAuthoritativeCountryCodes } from "./vnext/legacyScenarioGeometryAuthority.js";
import { hasExactRegionTileIdentity } from "./vnext/regionTileAuthority.js";
import {
  createOwnershipFloodCustomLayer,
  MAX_ACTIVE_OWNERSHIP_FLOOD_FIELDS,
  OWNERSHIP_FLOOD_LAYER_ID,
} from "./vnext/ownershipFloodCustomLayer.js";

ensurePmtilesProtocol();
const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };
const EMPTY_CUSTOM_REGION_META = Object.freeze({
  ready: false,
  featureCount: 0,
  hasDrawnGeometry: false,
  fullyAuthoredGeometry: false,
  ownedCountryCodes: Object.freeze([]),
  editedStockIds: Object.freeze([]),
  records: Object.freeze([]),
});
const EMPTY_POLITY_LABEL_COLLECTIONS = Object.freeze({
  labelData: EMPTY_FEATURE_COLLECTION,
  ptrLabelData: EMPTY_FEATURE_COLLECTION,
  pointLabelData: EMPTY_FEATURE_COLLECTION,
  curvedLabelData: EMPTY_FEATURE_COLLECTION,
  lineLabelData: EMPTY_FEATURE_COLLECTION,
  glyphLabelData: EMPTY_FEATURE_COLLECTION,
});
const EMPTY_REGION_RENDER_REPAIR = Object.freeze({
  geometryEpoch: "",
  data: EMPTY_FEATURE_COLLECTION,
  repairedIds: Object.freeze([]),
});

const ownershipTransitionVertexCount = (geometry) => {
  if (geometry?.type === "Polygon") {
    return (geometry.coordinates ?? []).reduce(
      (sum, ring) => sum + (Array.isArray(ring) ? ring.length : 0),
      0,
    );
  }
  if (geometry?.type === "MultiPolygon") {
    return (geometry.coordinates ?? []).reduce(
      (sum, polygon) => sum + (Array.isArray(polygon)
        ? polygon.reduce((inner, ring) => inner + (Array.isArray(ring) ? ring.length : 0), 0)
        : 0),
      0,
    );
  }
  return 0;
};
const OWNERSHIP_FLOOD_MAX_VERTEX_COUNT = 24000;
const OWNERSHIP_FLOOD_PREP_BUDGET_MS = 350;

// Globe projection renders a label's own high-latitude countries oversized
// relative to their outline — confirmed (issue #6) to be text-only (fills
// stay correctly scaled) and tied to each FEATURE's own latitude, not the
// camera's. cos(lat) undoes it; only applied in globe mode; flat/mercator
// keeps the exact same sizing it always has (this factor is 1 at lat 0 and
// visibly wrong in mercator at high latitude, so never enable it there).
const GLOBE_LAT_CORRECTION = ["cos", ["*", ["coalesce", ["get", "lat"], 0], Math.PI / 180]];

// How a country label is sized, and why its opacity is tied to that size.
//
// MapLibre draws a label from two sizes per tile — this expression evaluated at
// the tile's zoom and at one level above — mixed by the zoom in between, and it
// packs each of those sizes into 8 bits: 255 px is the most a glyph is ever
// drawn at (symbol_size.ts MAX_GLYPH_ICON_SIZE). Two things follow.
//
// 1. The stops are every integer zoom, each the uncapped size at that zoom, so
//    the two sizes the engine mixes are exactly one level and exactly 2× apart
//    and a label doubles with the map, as if painted on it. The first version
//    had stops four levels apart with a pixel cap inside them; the engine then
//    mixed an honest z4 size toward a clamped z8 one across the whole interval,
//    and every label crept while the map doubled — the field report "labels
//    shrink as you zoom in". Dropping the app's cap changed nothing, because the
//    engine's own 255 px clamp did the same to the z8 stop.
//
// 2. A label has to be GONE before its size reaches that clamp, or the clamp
//    reappears as the same creep in its last level. So buildCountryTextOpacity
//    ties text-opacity to the size this expression yields: a label fades out
//    between LABEL_FADE_START_PX and LABEL_FADE_END_PX at whatever zoom it gets
//    there, on top of each layer's own zoom ramp (which is how the small
//    labels, which never grow that big, leave). Fading, never shrinking.
const LABEL_FADE_START_PX = 140;
const LABEL_FADE_END_PX = 230;
const LABEL_SIZE_STOP_ZOOMS = Array.from({ length: 25 }, (_, zoom) => zoom);
// Opacity is read by the engine at the tile's zoom and one above, so half-level
// stops are as fine as it can use; each ramp's own stops are merged in by the
// builder so no ramp corner is skipped.
const LABEL_OPACITY_STOP_ZOOMS = Array.from({ length: 13 }, (_, index) => 2 + index * 0.5);

const countryTextScale = (multiplier, correctForGlobe) =>
  (correctForGlobe ? ["*", multiplier, GLOBE_LAT_CORRECTION] : multiplier);

// The size at one zoom, as an expression over the feature's own scale property.
const countryTextSizeAt = (zoom, multiplier, correctForGlobe, scaleProperty, { safe = false } = {}) => [
  "*",
  countryTextScale(multiplier, correctForGlobe),
  ["*", safe ? ["coalesce", ["get", scaleProperty], 0] : ["get", scaleProperty], 2 ** (zoom - 16)],
];

const buildCountryTextSize = (
  multiplier = 1,
  correctForGlobe = false,
  scaleProperty = "areaScale",
) => [
  "interpolate", ["exponential", 2], ["zoom"],
  ...LABEL_SIZE_STOP_ZOOMS.flatMap((zoom) => [zoom, countryTextSizeAt(zoom, multiplier, correctForGlobe, scaleProperty)]),
];

// A [zoom, value, zoom, value, …] ramp read at one zoom: piecewise-linear, held
// flat beyond its ends.
const rampValueAt = (ramp, zoom) => {
  if (zoom <= ramp[0]) return ramp[1];
  for (let index = 2; index < ramp.length; index += 2) {
    if (zoom <= ramp[index]) {
      const fromZoom = ramp[index - 2];
      const fromValue = ramp[index - 1];
      const toZoom = ramp[index];
      const toValue = ramp[index + 1];
      return fromValue + ((toValue - fromValue) * (zoom - fromZoom)) / (toZoom - fromZoom);
    }
  }
  return ramp[ramp.length - 1];
};

// text-opacity for a label layer: the layer's zoom ramp times a fade keyed to
// the label's own size — the same expression as its text-size, so the two agree
// — which has it transparent before the engine would clamp it.
const buildCountryTextOpacity = (
  ramp,
  multiplier = 1,
  correctForGlobe = false,
  scaleProperty = "areaScale",
) => {
  const rampZooms = ramp.filter((_, index) => index % 2 === 0);
  const zooms = [...new Set([...LABEL_OPACITY_STOP_ZOOMS, ...rampZooms])].sort((left, right) => left - right);
  const fadeAt = (zoom) => [
    "min", 1,
    ["max", 0, [
      "/",
      ["-", LABEL_FADE_END_PX, countryTextSizeAt(zoom, multiplier, correctForGlobe, scaleProperty, { safe: true })],
      LABEL_FADE_END_PX - LABEL_FADE_START_PX,
    ]],
  ];
  return [
    "interpolate", ["linear"], ["zoom"],
    ...zooms.flatMap((zoom) => [zoom, ["*", Number(rampValueAt(ramp, zoom).toFixed(4)), fadeAt(zoom)]]),
  ];
};

// Where polity names stop: every label layer below ends at this zoom and its
// ramp fades toward it over the last half zoom, so a zoomed-in map is
// provinces and cities rather than a country name across the viewport. The
// polity text renderer shares the ceiling (POLITY_TEXT_MAX_ZOOM).
const LABEL_MAX_ZOOM = POLITY_TEXT_MAX_ZOOM;
// Each label layer's own zoom ramp (see buildCountryTextOpacity).
const STOCK_LABEL_RAMP = Object.freeze([4, 0.98, 5.8, 0.90, 7.0, 0.52, LABEL_MAX_ZOOM, 0]);
// The curved glyph layer on a custom map hands off from the live point labels
// at z3.85–4.15.
const CUSTOM_CURVED_LABEL_RAMP = Object.freeze([3.85, 0, 4.15, 0.98, 5.8, 0.90, 7.0, 0.52, LABEL_MAX_ZOOM, 0]);
const LIVE_LABEL_RAMP = Object.freeze([2.0, 0.90, 3.2, 0.985, 5.8, 0.96, 6.95, 0.72, LABEL_MAX_ZOOM, 0]);

// Palettes are owner -> [r,g,b]. Re-reading colors.json hands back a fresh object
// every time; swapping identity for identical contents would rebuild every
// MapLibre match expression on the map, so compare contents before accepting it.
const shallowEqualColors = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  for (const key of keysA) {
    const left = a[key];
    const right = b[key];
    if (left === right) continue;
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false;
    }
  }
  return true;
};

// ---- Disputed-region stripes ------------------------------------------------
// A region whose `claimants` list names the countries contesting it renders
// striped in their colors (current administrator first). The stripe tile's
// image id encodes the rgb list itself ("oh-stripes-r_g_b-r_g_b"), so the
// styleimagemissing handler can rebuild any tile the style asks for — including
// after the globe/mercator toggle remounts the map and its images are gone.
const STRIPE_PREFIX = "oh-stripes-";
const STRIPE_BAND_PX = 8;

const stripeImageId = (rgbList) => STRIPE_PREFIX + rgbList.map((rgb) => rgb.join("_")).join("-");

const parseStripeImageId = (id) => {
  if (typeof id !== "string" || !id.startsWith(STRIPE_PREFIX)) return null;
  const colors = id
    .slice(STRIPE_PREFIX.length)
    .split("-")
    .map((part) => part.split("_").map(Number));
  const valid = colors.length >= 2 &&
    colors.every((rgb) => rgb.length === 3 && rgb.every((n) => Number.isFinite(n) && n >= 0 && n <= 255));
  return valid ? colors : null;
};

// Diagonal stripe tile as raw RGBA: band = (x+y) mod period, which tiles
// seamlessly in both directions.
const buildStripeImage = (rgbList) => {
  const size = rgbList.length * STRIPE_BAND_PX;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const rgb = rgbList[Math.floor(((x + y) % size) / STRIPE_BAND_PX)];
      const p = (y * size + x) * 4;
      data[p] = rgb[0];
      data[p + 1] = rgb[1];
      data[p + 2] = rgb[2];
      data[p + 3] = 255;
    }
  }
  return { width: size, height: size, data };
};

// Neutral tone for unowned custom regions (land with no owner code).
const NEUTRAL_LAND_COLOR = "rgb(88, 98, 110)";
// Constant GL expression: canonical live ownership arrives through feature-state.
// Authored/disputed features may also carry an explicit ownerColor/_fillColor;
// neutral land is the final fallback. No derived polity surface owns political fill.
// A scenario region type's override colour (typeFill, regionTypePaint.js) comes
// before all of them, as it does in the Workshop.
const CUSTOM_FILL_COLOR = [
  "coalesce",
  TYPE_FILL_STATE,
  ["feature-state", "fillColor"],
  ["get", "ownerColor"],
  ["get", "_fillColor"],
  NEUTRAL_LAND_COLOR,
];
const DETAIL_FILL_COLOR = [
  "coalesce",
  TYPE_FILL_STATE,
  ["feature-state", "fillColor"],
  "rgba(0, 0, 0, 0)",
];

// GADM region ids contain a dot ("DEU.2_1"); author-drawn regions ("reg_...")
// don't. On custom maps, GADM regions crossfade between two sources: the seed
// GeoJSON when zoomed OUT (the stock tiles are too simplified out there and
// show sliver gaps) and the stock vector tiles when zoomed IN (the z5 seed is
// too coarse up close). Author-drawn geometry renders from the GeoJSON at every
// zoom, on top — the tiles don't know those shapes.
// Geometry provenance must be explicit. Historical stock catalogs can contain
// dotless/numeric IDs, so punctuation is not a reliable stock-vs-authored test.
// The editor contract marks drawn geometry with reg_* and reshaped stock geometry
// with edited=true; newer imports may additionally carry authored/geometrySource.
const AUTHORED_GEOMETRY_FILTER = [
  "any",
  ["==", ["get", "edited"], true],
  ["==", ["get", "authored"], true],
  ["==", ["get", "geometrySource"], "authored"],
  ["==", ["slice", ["to-string", ["get", "id"]], 0, 4], "reg_"],
];
const STOCK_GEOMETRY_FILTER = ["!", AUTHORED_GEOMETRY_FILTER];
const SCENARIO_GID0_EXPRESSION = ["upcase", ["coalesce", ["get", "gid0"], ["get", "GID_0"], ""]];
const SCENARIO_REGION_ID_EXPRESSION = ["to-string", ["coalesce", ["get", "id"], ["get", "GID_1"], ""]];
// The fill strength by zoom is POLITICAL_FILL_OPACITY_STOPS
// (vnext/presentationPolicy.js), shared with the conquest flood.
// MapLibre requires camera expressions to keep ["zoom"] as the direct input
// of the top-level step/interpolate expression. Data-driven visibility therefore
// belongs in each stop output, never around the zoom ramp with a top-level case.
// So does a scenario region type's factor on it (withTypeFillOpacity), which is
// 1 for every region whose type draws as Land does.
const buildPoliticalFillOpacity = (hiddenExpression = null) => [
  "interpolate", ["linear"], ["zoom"],
  ...POLITICAL_FILL_OPACITY_STOPS.flatMap(([zoom, opacity]) => [
    zoom,
    hiddenExpression ? ["case", hiddenExpression, 0, withTypeFillOpacity(opacity)] : withTypeFillOpacity(opacity),
  ]),
];

const POLITICAL_FILL_OPACITY = buildPoliticalFillOpacity();
const DISPUTED_STRIPE_OPACITY = 0.22;

// Experiment F: stop drawing the stock GeoJSON fallback and the stock vector
// tile fill at the same zoom. The previous z4->z5 alpha crossfade painted two
// independently tiled versions of the same region geometry simultaneously; where
// their triangulation/clipping differed, semi-transparent same-colour fills showed
// up as bright/dark wedges. Use one canonical presentation source at a time:
// GeoJSON below z4.5, vector tiles from z4.5 upward. Both use the same political
// opacity policy so the handoff changes geometry source, not visual strength.
const STOCK_REGION_HANDOFF_ZOOM = 4.5;
const DISPUTED_TILE_FILL_OPACITY = POLITICAL_FILL_OPACITY;

const PERF_MAP_WARN_MS = 40;

const WorldMap = ({ isGlobe = false }) => {
  const { current: map } = useMap();
  // Between a WebGL context loss and its restore MapLibre has no style, and
  // getLayer throws. A render in that window (a turn landing) must not crash;
  // react-map-gl's own Source and Layer check the same thing.
  const hasMapLayer = (id) => Boolean(map?.getMap?.()?.style && map.getLayer(id));
  const [colorMap, setColorMap] = useState({});
  const {
    worldState,
    worldKnown,
    customRegions: customFlag,
    regionOwnershipOverrides,
    regionClaimants,
    polityOverrides,
    groups,
    groupAreas,
    regionTypes,
    labelFont,
    labelHaloColor,
    labelTextColor,
  } = useWorldState();
  // Groups switched off for this game draw no area (server/gameFeatures.js);
  // the world keeps them for a game switched back on.
  const groupsOn = useActiveFeatures().groups?.enabled !== false;
  const mapDisplaySettings = {
    hideCountryLabels: useMapSetting(MAP_SETTING_KEYS.hideCountryLabels),
    disableCurvedCountryLabels: useMapSetting(MAP_SETTING_KEYS.disableCurvedCountryLabels),
  };

  // A player's own choice from Settings > Map. Empty means "whatever the
  // scenario author set", so it changes nothing until it is filled in.
  const labelFontOverride = useMapSettingValue(MAP_SETTING_KEYS.labelFont);
  // PTR-1.7 is the default polity-name renderer The old MapLibre
  // label stack remains mounted only as a last-resort fallback while PTR is
  // waiting for canonical records, if PTR fails to mount, or when explicitly
  // disabled via ?legacyPolityText=1 / localStorage value "0".
  const ptr0PolityTextEnabled = useMemo(() => isPolityTextPtr0Enabled(), []);
  const ptr1PolityTextEnabled = useMemo(() => isPolityTextPtr1Enabled(), []);
  const ptr1PolityTextDebugEnabled = useMemo(() => isPolityTextPtr1DebugEnabled(), []);
  const [ptrPolityTextStatus, setPtrPolityTextStatus] = useState({
    requested: false,
    mounted: false,
    failed: false,
    waitingForStyle: false,
    recordCount: 0,
    owners: [],
    lastMountError: null,
  });
  // The region catalog becomes available before political cartography finishes.
  // Keep that early metadata path, but remember whether the initial worker
  // revision has actually produced the label records PTR needs for first paint.
  const [initialCartographySettled, setInitialCartographySettled] = useState(false);
  // Targeted malformed-region repair is part of the same initial cartography
  // transaction from the player's perspective. Keep the existing scenario
  // loading screen up until the worker either publishes the tiny repair source
  // or explicitly fails open to canonical geometry; never reveal a known-bad
  // tessellation for a few frames and then snap it away after scenario entry.
  const [initialRegionRepairSettled, setInitialRegionRepairSettled] = useState(false);
  const [customRegionMeta, setCustomRegionMeta] = useState(EMPTY_CUSTOM_REGION_META);
  const [regionRenderRepair, setRegionRenderRepair] = useState(EMPTY_REGION_RENDER_REPAIR);
  const [disputedRegionData, setDisputedRegionData] = useState(EMPTY_FEATURE_COLLECTION);
  // Groups' areas (runtime/groups.js): the regions worker cuts each area's
  // outline from its frontier topology (vnext/groupAreas.js). Asked outside
  // the political pipeline — a group moves no owner and no border — through
  // groupAreaRequestRef, which the worker effect sets once its worker has
  // published catalog-ready.
  const [groupAreaData, setGroupAreaData] = useState(EMPTY_GROUP_AREA_DATA);
  const groupAreaInputRef = useRef({ groupAreas, groups });
  const groupAreaRequestRef = useRef(null);
  const [polityLabelCollections, setPolityLabelCollections] = useState(EMPTY_POLITY_LABEL_COLLECTIONS);
  const [derivedSourceEpoch, setDerivedSourceEpoch] = useState(0);
  const boundaryFeatureMapRef = useRef(new Map());
  // Canonical ownership may advance immediately, but presentation stays on the
  // last accepted visual revision until its sovereignty sweep completes: the
  // per-region holds and the queued sweeps, keyed by cartography revision so
  // the sweep can start as soon as its geometry arrives and the derived
  // cartography publishes only after it finishes
  // (vnext/ownershipPresentationHolds.js). One object for the map's life.
  const [ownershipPresentationHoldEpoch, setOwnershipPresentationHoldEpoch] = useState(0);
  const [ownershipPresentation] = useState(() => createOwnershipPresentationState({
    onHoldsChanged: () => setOwnershipPresentationHoldEpoch((epoch) => epoch + 1),
  }));
  const appliedCustomFillStateRef = useRef(new Map());
  // The desired region -> fill map is a pure function of the two inputs cached
  // beside it, and a hold/release epoch changes neither. Keyed on identity so an
  // epoch bump mid-sweep reuses it instead of recolouring every region again.
  const ownershipFillTargetRef = useRef({ owners: null, colorCss: null, fills: null });
  const appliedTileFillStateRef = useRef(new Map());
  // The region-type feature-state written so far (id -> what and where), and
  // the source rebuilds it belongs to: a rebuilt source has none.
  const appliedRegionTypeStateRef = useRef({ epoch: "", written: new Map() });
  const ownershipSweepRef = useRef({
    active: false,
    token: 0,
    worker: null,
    frame: 0,
    waitFrame: 0,
    timeout: 0,
    regionIds: [],
    floodLayer: null,
    finish: null,
  });
  const [ownershipTransitionQueueEpoch, setOwnershipTransitionQueueEpoch] = useState(0);
  const [ownershipTransitionSlices, setOwnershipTransitionSlices] = useState(EMPTY_FEATURE_COLLECTION);
  const holdOwnershipPresentation = ownershipPresentation.hold;
  const releaseOwnershipPresentation = ownershipPresentation.release;
  const releaseAllOwnershipPresentation = ownershipPresentation.releaseAll;
  const [labelZoom, setLabelZoom] = useState(3.5);
  // R5.4.6: owners whose curved polity label MapLibre has actually confirmed
  // as rendered after the map settles. A curve-capable point fallback is never
  // hidden from theoretical zoom eligibility alone.
  const [renderConfirmedCurveOwners, setRenderConfirmedCurveOwners] = useState([]);
  const polityBoundaryWorkerRef = useRef(null);
  const polityBoundarySchedulerRef = useRef(null);
  // The runtime regions URL carries the active game/scenario generation token.
  // Keep the last worker geometry epoch separately from React metadata so a
  // custom-map switch can invalidate old derived borders/labels immediately.
  const cartographyGeometryEpochRef = useRef("");
  const initialFramingAppliedRef = useRef(false);
  const enqueuedBoundaryOwnershipRef = useRef(null);
  const enqueuedBoundaryClaimantsRef = useRef(null);
  const enqueuedBoundaryLabelNamesRef = useRef(null);
  const boundaryWorkerRestartCountRef = useRef(0);
  // The worker gave up for good on this geometry (no retry left): every later
  // readiness mark says so, or the next one would read as a recovery.
  const bordersFailedRef = useRef(false);
  const regionOwnershipOverridesRef = useRef(regionOwnershipOverrides);
  regionOwnershipOverridesRef.current = regionOwnershipOverrides;
  const regionClaimantsRef = useRef(regionClaimants);
  regionClaimantsRef.current = regionClaimants;
  const [acknowledgedBoundaryOwnership, setAcknowledgedBoundaryOwnership] = useState(null);
  const [boundaryWorkerEpoch, setBoundaryWorkerEpoch] = useState(0);
  const regionsUrl = PMTILES_PROTOCOL_URLS.regions;
  const regionsGeojsonUrl = JSON_URLS.regionsGeojson;
  // What the MapLibre source and the cartography worker actually fetch: the
  // runtime URL itself on the desktop, a blob: copy of it on the website
  // (assets.js, prepareWorkerFetchableUrl), "" while that copy is being staged.
  // The runtime URL above stays the identity for epochs, catalog keys and
  // readiness.
  const regionsGeojsonFetchUrl = useWorkerFetchableUrl(regionsGeojsonUrl);
  const activeGeometryEpoch = String(regionsGeojsonUrl || "custom-regions");
  const activeRegionRenderRepair = regionRenderRepair.geometryEpoch === activeGeometryEpoch
    ? regionRenderRepair
    : EMPTY_REGION_RENDER_REPAIR;
  const repairedRegionIds = activeRegionRenderRepair.repairedIds ?? [];
  const repairedRegionIdSet = useMemo(() => new Set(repairedRegionIds), [repairedRegionIds]);

  // The worker's compact metadata remains canonical. A tiny, presentation-only
  // repair collection may replace only demonstrably malformed feature geometry;
  // ownership, region identity and the saved scenario remain unchanged.
  const customActive = customFlag && customRegionMeta.ready;
  const fullyAuthoredGeometry = Boolean(customActive && customRegionMeta.fullyAuthoredGeometry);
  const [regionTileIdentityState, setRegionTileIdentityState] = useState("unknown");

  useEffect(() => {
    if (!customFlag || !customRegionMeta.ready || fullyAuthoredGeometry) {
      setRegionTileIdentityState(fullyAuthoredGeometry ? "incompatible" : "unknown");
      return undefined;
    }

    let cancelled = false;
    setRegionTileIdentityState("checking");
    loadRegionTileIdSet()
      .then((tileRegionIds) => {
        if (cancelled) return;
        setRegionTileIdentityState(
          hasExactRegionTileIdentity(customRegionMeta.records, tileRegionIds)
            ? "compatible"
            : "incompatible",
        );
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn(
          "Could not prove close-zoom region-tile identity; keeping scenario geometry authoritative:",
          error,
        );
        setRegionTileIdentityState("incompatible");
      });

    return () => {
      cancelled = true;
    };
  }, [activeGeometryEpoch, customFlag, customRegionMeta.ready, customRegionMeta.records, fullyAuthoredGeometry]);

  // Current PMTiles may be a different region catalog from the scenario's
  // serialized geometry (legacy scenarios can carry numeric/UUID ids while the
  // shipped archive uses a newer GADM vocabulary). A close-zoom handoff is legal
  // only when every stock-like scenario record exists by EXACT id in the mounted
  // region-tile archive. Punctuation, gid0 and polity identity are not evidence.
  const regionTileHandoffSafe = Boolean(
    customActive && regionTileIdentityState === "compatible"
  );
  const scenarioOwnsRegionGeometryAtAllZooms = Boolean(customActive && !regionTileHandoffSafe);
  const shouldMountStockRegions = !customFlag || regionTileHandoffSafe;

  // Bumped when the translator learns new strings, so labels rebuild with
  // translated names (they're baked into map features, not DOM text).
  const [labelEpoch, setLabelEpoch] = useState(0);
  useEffect(() => {
    const onUpdated = () => setLabelEpoch((epoch) => epoch + 1);
    window.addEventListener("i18n:updated", onUpdated);
    return () => window.removeEventListener("i18n:updated", onUpdated);
  }, []);

  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!mapInstance?.getZoom) return undefined;

    const updateZoom = () => {
      const next = Number(mapInstance.getZoom?.() ?? 3.5);
      setLabelZoom((current) => {
        if (Math.abs(current - next) < 0.01) return current;
        recordMapTrace("nations:label-zoom", { from: current, to: next });
        return next;
      });
    };

    updateZoom();
    // Panning must not wake React/Nations at all. Only a completed zoom can
    // change polity label eligibility.
    mapInstance.on("zoomend", updateZoom);
    return () => mapInstance.off("zoomend", updateZoom);
  }, [map]);

  // Disputed-region stripe tiles, generated the moment the style asks for one.
  // Reactive (rather than pre-registered) so any stripe combination works and
  // the globe/mercator remount — which rebuilds the style without its images —
  // heals itself on the next frame.
  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!mapInstance?.on) return undefined;
    const onMissing = (event) => {
      const colors = parseStripeImageId(event?.id);
      if (!colors) return;
      if (mapInstance.hasImage?.(event.id)) return;
      try {
        mapInstance.addImage(event.id, buildStripeImage(colors), { pixelRatio: 1 });
      } catch (error) {
        console.warn("Failed to build stripe tile:", error);
      }
    };
    mapInstance.on("styleimagemissing", onMissing);
    return () => mapInstance.off("styleimagemissing", onMissing);
  }, [map]);

  // Pipeline v2: live polity label geometry is worker-owned. The UI thread only
  // receives compact ready-to-render point/line collections; no polygon fitting
  // or territorial geometry work is allowed in React.
  const useLivePolityLabels = polityLabelCollections.labelData.features.length > 0;
  const ptr1PolityTextRecords = useMemo(() => buildPolityTextPtr1Records({
    ptrLabelData: polityLabelCollections.ptrLabelData,
    labelData: polityLabelCollections.labelData,
  }), [polityLabelCollections.ptrLabelData, polityLabelCollections.labelData]);
  const ptr1PolityTextRequested = Boolean(
    ptr1PolityTextEnabled
    && worldKnown
    && customFlag
    && useLivePolityLabels
    && !mapDisplaySettings.hideCountryLabels
  );
  //without this the globe would reveal a frame of legacy MapLibre labels and then snap them away.
  const ptrBlocksInitialReadiness = Boolean(
    ptr1PolityTextEnabled
    && customFlag
    && !mapDisplaySettings.hideCountryLabels
  );
  const ptr1PolityTextAuthoritative = Boolean(
    ptr1PolityTextRequested
    && ptrPolityTextStatus.mounted
    && ptrPolityTextStatus.recordCount > 0
  );
  const ptrRenderedOwnerNames = useMemo(
    () => ptr1PolityTextAuthoritative
      ? (ptrPolityTextStatus.owners ?? []).filter(Boolean)
      : [],
    [ptr1PolityTextAuthoritative, ptrPolityTextStatus.owners],
  );
  const ptrRenderedOwnersLiteral = useMemo(
    () => ["literal", ptrRenderedOwnerNames],
    [ptrRenderedOwnerNames],
  );
  // The legacy MapLibre renderer is retained per-owner only. While PTR is
  // unavailable it renders normally; once PTR owns a polity, the matching
  // legacy label is filtered out. Any malformed/unsupported polity that PTR
  // cannot prepare therefore keeps a genuine last-resort legacy label instead
  // of disappearing with the rest of the old stack.
  const legacyPtrOwnerFilter = useMemo(() => (
    ptrRenderedOwnerNames.length
      ? ["!", ["in", ["coalesce", ["get", "sourceOwner"], ["get", "owner"], ""], ptrRenderedOwnersLiteral]]
      : ["all"]
  ), [ptrRenderedOwnerNames.length, ptrRenderedOwnersLiteral]);


  // R5.4.6: renderer-confirmed polity label handoff.
  //
  // The previous rule hid/demoted point fallbacks once a curve crossed its
  // theoretical zoom threshold. That can still leave a blank label when
  // MapLibre declines to place the line. Keep point fallbacks guaranteed while
  // the camera moves, then inspect ONLY the two live polity curve layers after
  // MapLibre reaches idle. No source mutation, no setData(), and no movement-
  // time renderer scan.
  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (ptr1PolityTextAuthoritative || !customFlag || !useLivePolityLabels || mapDisplaySettings.disableCurvedCountryLabels || !mapInstance?.on) {
      setRenderConfirmedCurveOwners((current) => (current.length ? [] : current));
      return undefined;
    }

    const clearRenderConfirmation = () => {
      // During camera movement prefer a brief point+curve duplicate over a
      // missing polity name. This is one bounded filter-state change at movement
      // start; it does not rebuild either GeoJSON source.
      setRenderConfirmedCurveOwners((current) => (current.length ? [] : current));
    };

    const confirmRenderedCurves = () => {
      if (mapInstance.isMoving?.() || mapInstance.isZooming?.()) return;
      if (!mapInstance.queryRenderedFeatures) return;

      const curveLayers = [
        "country-line-labels-live-world",
        "country-line-labels-live-detail",
      ].filter((layerId) => mapInstance.getLayer?.(layerId));

      if (!curveLayers.length) {
        clearRenderConfirmation();
        return;
      }

      let rendered = [];
      try {
        rendered = mapInstance.queryRenderedFeatures({ layers: curveLayers }) ?? [];
      } catch {
        // A style remount can invalidate a layer between getLayer() and query.
        // Fail safe to the guaranteed point labels and wait for the next idle.
        clearRenderConfirmation();
        return;
      }

      const nextOwners = [...new Set(
        rendered
          .map((feature) => String(feature?.properties?.owner ?? "").trim())
          .filter(Boolean),
      )].sort();

      setRenderConfirmedCurveOwners((current) => {
        if (
          current.length === nextOwners.length
          && current.every((owner, index) => owner === nextOwners[index])
        ) return current;
        return nextOwners;
      });
    };

    mapInstance.on("movestart", clearRenderConfirmation);
    mapInstance.on("idle", confirmRenderedCurves);
    return () => {
      mapInstance.off("movestart", clearRenderConfirmation);
      mapInstance.off("idle", confirmRenderedCurves);
    };
  }, [customFlag, map, mapDisplaySettings.disableCurvedCountryLabels, ptr1PolityTextAuthoritative, useLivePolityLabels]);

  // Where each polity sits, for the place search: a custom scenario's countries are nowhere else.
  useEffect(() => {
    const ptrFeatures = polityLabelCollections.ptrLabelData?.features;
    publishPolityIndex(ptrFeatures?.length ? ptrFeatures : polityLabelCollections.labelData?.features);
  }, [polityLabelCollections]);

  // Where each group's label sits, for the place search: the only place a group can be found.
  // None while groups are switched off for this game, as none is drawn.
  useEffect(() => {
    publishGroupIndex(groupsOn ? groupAreaData.labels?.features : null);
  }, [groupAreaData, groupsOn]);

  // Development-time proof instead of screenshot guesswork. One authoritative
  // record per polity is exposed for inspection and the known regression set is
  // printed whenever live label geometry changes.
  useEffect(() => {
    if (!import.meta.env.DEV || !useLivePolityLabels || globalThis.__OH_MAP_LABEL_DEBUG__ !== true) return;
    const diagnostics = summarizePolityLabelDiagnostics(polityLabelCollections);
    globalThis.__OH_POLITY_LABEL_DIAGNOSTICS__ = diagnostics;
    const watch = new Set([
      "russia", "canada", "china", "united states", "united states of america",
      "brazil", "kazakhstan", "ukraine", "poland", "germany", "france",
      "democratic republic of the congo", "latvia",
    ]);
    const rows = diagnostics.filter((entry) => {
      const owner = String(entry.owner ?? "").toLocaleLowerCase();
      const name = String(entry.name ?? "").toLocaleLowerCase();
      return watch.has(owner) || watch.has(name);
    });
    const duplicates = diagnostics.filter((entry) => entry.labelCount !== 1);
    if (duplicates.length) {
      console.error("[OH map labels] invariant violation: duplicate/missing polity labels", duplicates);
    }
    if (rows.length) console.table(rows);
  }, [polityLabelCollections, useLivePolityLabels]);

  // Start a campaign with its player polity inside the composition instead of
  // blindly centring longitude zero (which wastes half a wide screen on the
  // Atlantic in European scenarios). This runs only while the camera is still
  // at the untouched legacy default; an early user pan always wins.
  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (
      isGlobe
      || initialFramingAppliedRef.current
      || !polityLabelCollections.labelData.features.length
      || !mapInstance?.jumpTo
    ) return undefined;

    let cancelled = false;
    const center = mapInstance.getCenter?.();
    const zoom = mapInstance.getZoom?.() ?? 3.5;
    if (!center || Math.abs(center.lng) > 0.25 || Math.abs(center.lat) > 0.25 || Math.abs(zoom - 3.5) > 0.12) {
      initialFramingAppliedRef.current = true;
      return undefined;
    }

    readJson(JSON_URLS.game, { defaultValue: {} }).then((game) => {
      if (cancelled || initialFramingAppliedRef.current) return;
      const player = String(game?.country ?? "").trim().toLocaleLowerCase();
      if (!player) {
        initialFramingAppliedRef.current = true;
        return;
      }

      const owner = polityLabelCollections.labelData.features
        .map((feature) => String(feature?.properties?.owner ?? "").trim())
        .find((candidate) => {
          const override = polityOverrides?.[candidate] ?? {};
          return [candidate, override.name, ...(Array.isArray(override.aliases) ? override.aliases : [])]
            .some((value) => String(value ?? "").trim().toLocaleLowerCase() === player);
        });
      const focus = polityLabelCollections.labelData.features
        .find((feature) => feature?.properties?.owner === owner);
      const focusCoordinates = focus?.geometry?.type === "Point"
        ? focus.geometry.coordinates
        : [focus?.properties?.anchorLng, focus?.properties?.anchorLat];
      const [lng, lat] = focusCoordinates ?? [];
      initialFramingAppliedRef.current = true;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

      const width = mapInstance.getCanvas?.()?.clientWidth || 1440;
      const responsiveZoom = Math.max(3.5, Math.min(3.92, 3.55 + Math.log2(Math.max(900, width) / 1440) * 0.22));
      mapInstance.jumpTo({
        center: [lng, Math.max(-70, Math.min(70, lat - 5))],
        zoom: responsiveZoom,
        bearing: 0,
        pitch: 0,
      });
    }).catch(() => {
      initialFramingAppliedRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, [isGlobe, map, polityLabelCollections, polityOverrides]);

  // Derived political artifacts are valid only for the last worker-acknowledged
  // ownership revision. Canonical region fills never wait for them. While an
  // owner is dirty, hide only borders/labels touching that owner; unrelated
  // cartography remains stable.
  const ownershipPresentationTarget = useMemo(() => (
    ownershipPresentation.holds.size > 0 && acknowledgedBoundaryOwnership != null
      ? acknowledgedBoundaryOwnership
      : regionOwnershipOverrides
  ), [
    acknowledgedBoundaryOwnership,
    ownershipPresentation,
    ownershipPresentationHoldEpoch,
    regionOwnershipOverrides,
  ]);
  const ownershipPresentationDelta = useMemo(
    () => buildOwnershipPresentationDelta(
      customRegionMeta.records,
      ownershipPresentationTarget,
      acknowledgedBoundaryOwnership,
    ),
    [acknowledgedBoundaryOwnership, customRegionMeta.records, ownershipPresentationTarget],
  );
  const dirtyPoliticalOwners = useMemo(
    () => [...new Set(ownershipPresentationDelta.flatMap((entry) => [
      toCountryName(entry.fromOwner),
      toCountryName(entry.toOwner),
    ]).filter(Boolean))].sort(),
    [ownershipPresentationDelta],
  );
  const dirtyOwnersLiteral = useMemo(() => ["literal", dirtyPoliticalOwners], [dirtyPoliticalOwners]);
  const visibleDerivedOwnerFilter = useMemo(() => dirtyPoliticalOwners.length
    ? ["!", ["in", ["coalesce", ["get", "sourceOwner"], ["get", "owner"], ""], dirtyOwnersLiteral]]
    : ["all"], [dirtyOwnersLiteral, dirtyPoliticalOwners.length]);

  const visibleBoundaryFilter = useMemo(() => dirtyPoliticalOwners.length
    ? ["!", ["any", ...dirtyPoliticalOwners.map((owner) => ["in", owner, ["get", "ownerList"]])]]
    : ["all"], [dirtyPoliticalOwners]);


  const rawLivePolityPointLabelData = worldKnown && customFlag && useLivePolityLabels
    ? polityLabelCollections.pointLabelData
    : EMPTY_FEATURE_COLLECTION;
  const rawLivePolityLineLabelData = worldKnown && customFlag && useLivePolityLabels && !mapDisplaySettings.disableCurvedCountryLabels
    ? polityLabelCollections.lineLabelData
    : EMPTY_FEATURE_COLLECTION;
  const currentLabelZoom = Number(labelZoom ?? 3.5);

  // R5.4.6: render-confirmed handoff. Curve-capable polities never enter the
  // collision-managed fallback layer. Their point label remains in the
  // guaranteed overlap layer until an idle-time renderer check confirms that
  // MapLibre actually drew the curve for that owner.
  const renderedCurveOwnersLiteral = useMemo(
    () => ["literal", mapDisplaySettings.disableCurvedCountryLabels ? [] : renderConfirmedCurveOwners],
    [mapDisplaySettings.disableCurvedCountryLabels, renderConfirmedCurveOwners],
  );

  const livePointManagedFilter = useMemo(() => [
    "all",
    visibleDerivedOwnerFilter,
    legacyPtrOwnerFilter,
    ["<=", ["coalesce", ["get", "minZoom"], 0], currentLabelZoom],
    ["==", ["coalesce", ["get", "curveBand"], "none"], "none"],
    ["!=", ["coalesce", ["get", "allowOverlap"], false], true],
    [">", ["coalesce", ["get", "forceOverlapZoom"], 99], currentLabelZoom],
  ], [currentLabelZoom, legacyPtrOwnerFilter, visibleDerivedOwnerFilter]);

  const livePointOverlapFilter = useMemo(() => [
    "all",
    visibleDerivedOwnerFilter,
    legacyPtrOwnerFilter,
    ["<=", ["coalesce", ["get", "minZoom"], 0], currentLabelZoom],
    [
      "any",
      // Every curve-capable polity is guaranteed until its curve is visibly
      // present in one of the two live curve layers after MapLibre reaches idle.
      [
        "all",
        ["!=", ["coalesce", ["get", "curveBand"], "none"], "none"],
        ["!", ["in", ["get", "owner"], renderedCurveOwnersLiteral]],
      ],
      // Point-only polities preserve their existing overlap policy.
      [
        "all",
        ["==", ["coalesce", ["get", "curveBand"], "none"], "none"],
        [
          "any",
          ["==", ["coalesce", ["get", "allowOverlap"], false], true],
          ["<=", ["coalesce", ["get", "forceOverlapZoom"], 99], currentLabelZoom],
        ],
      ],
    ],
  ], [currentLabelZoom, legacyPtrOwnerFilter, renderedCurveOwnersLiteral, visibleDerivedOwnerFilter]);

  const liveWorldLineFilter = useMemo(() => [
    "all",
    visibleDerivedOwnerFilter,
    legacyPtrOwnerFilter,
    ["==", ["get", "safeWarp"], true],
    ["==", ["coalesce", ["get", "curveBand"], "detail"], "world"],
    ["<=", ["coalesce", ["get", "curveMinZoom"], 99], currentLabelZoom],
  ], [currentLabelZoom, legacyPtrOwnerFilter, visibleDerivedOwnerFilter]);

  const liveDetailLineFilter = useMemo(() => [
    "all",
    visibleDerivedOwnerFilter,
    legacyPtrOwnerFilter,
    ["==", ["get", "safeWarp"], true],
    ["!=", ["coalesce", ["get", "curveBand"], "detail"], "world"],
    // CP4.2: the territorial baseline is the normal map typography, not a late
    // curve upgrade. The worker already gives it a small lead over minZoom; the
    // renderer should not add another hidden half-zoom delay.
    ["<=", ["coalesce", ["get", "curveMinZoom"], 99], currentLabelZoom],
  ], [currentLabelZoom, legacyPtrOwnerFilter, visibleDerivedOwnerFilter]);

  const handleRegionClick = useCallback(async (event) => {
    const unitsAt = () =>
      map.getLayer("units-fill")
        ? map.queryRenderedFeatures(event.point, { layers: ["units-fill"] })
        : [];

    // Resolve the province under this click using the existing region layer
    // stack. Fully authored worlds must never fall through to leftover GADM Earth.
    const resolveRegionHit = () => {
      const candidateLayers = (scenarioOwnsRegionGeometryAtAllZooms
        ? [
          "custom-regions-repair-fill",
          "custom-regions-fill",
          "custom-regions-disputed-vnext",
          "custom-regions-repair-fill-far",
          "custom-regions-fill-far",
        ]
        : [
          "custom-regions-repair-fill",
          "custom-regions-fill",
          "custom-regions-disputed-vnext",
          "regions-fill",
          "regions-disputed",
          "custom-regions-repair-fill-far",
          "custom-regions-fill-far",
        ]
      ).filter((id) => map.getLayer(id));
      if (!candidateLayers.length) return null;
      const hits = map.queryRenderedFeatures(event.point, { layers: candidateLayers });
      if (!hits.length) return null;
      const props = hits[0].properties ?? {};
      const regionId = String(props.GID_1 ?? props.id ?? "");
      if (!regionId) return null;
      const lookupOwner = ownerLookupRef.current.size
        ? ownerLookupRef.current.get(regionId)
        : undefined;
      const owner = lookupOwner !== undefined ? lookupOwner : props.owner;
      const gid0 = String(props.gid0 ?? props.GID_0 ?? "");
      return {
        props,
        regionId,
        gid0,
        owner: owner ?? "",
        regionName: resolveRegionName(regionId, props.NAME_1 ?? props.name ?? ""),
        country: props.COUNTRY ?? toCountryName(gid0),
        lngLat: event.lngLat,
      };
    };

    // A city or built structure under the cursor. Query only the point glyphs,
    // not city text: a giant label bounding box should not steal a province click.
    const featureAt = () => {
      const featureLayers = [
        ...V_NEXT_MARKER_SHAPE_LAYER_IDS,
        "cities-shapes",
        "cities-capitals",
      ].filter((id) => map.getLayer(id));
      const featureHits = featureLayers.length
        ? map.queryRenderedFeatures(event.point, { layers: featureLayers })
        : [];
      if (!featureHits.length) return null;
      const hit = featureHits.find((entry) => entry.layer.id.startsWith("markers-shapes")) ?? featureHits[0];
      const props = hit.properties ?? {};
      const [lng, lat] = hit.geometry?.coordinates ?? [event.lngLat.lng, event.lngLat.lat];
      const host = resolveRegionHit();
      const hostCountry = host?.owner || (host?.owner === "" ? "" : toCountryName(host?.gid0 ?? ""));
      // The region under it, as a region click hands it over: the card's Region
      // row opens that region's card (Selection/Features.jsx).
      const hostRegion = host
        ? { GID_0: hostCountry, COUNTRY: host.country, NAME_1: host.regionName, GID_1: host.regionId, gid0: host.gid0, owner: host.owner, lngLat: { lng, lat } }
        : null;
      return hit.layer.id.startsWith("markers-shapes")
        ? {
          source: "marker",
          id: props.id,
          name: props.name,
          kind: props.kind,
          ownerCode: props.ownerCode || hostCountry,
          note: props.note || "",
          hostRegionId: host?.regionId || "",
          hostRegionName: host?.regionName || "",
          hostRegion,
          lng,
          lat,
        }
        : {
          source: "city",
          name: props.city || props.name || "",
          // The drawn figure is already the year's (Cities.jsx); one the AI set
          // by hand is the city's population from then on.
          population: effectiveCityPopulation(props, {
            cityPopulations: cityPopulationOverridesByTileName(
              getWorldStateSnapshot()?.cityPopulations,
              getWorldStateSnapshot()?.cityRenames,
            ),
          }),
          capital: props.capital,
          tier: props.tier,
          ownerCode: hostCountry,
          hostRegionId: host?.regionId || "",
          hostRegionName: host?.regionName || "",
          hostRegion,
          lng,
          lat,
        };
    };

    const mode = getInteractionMode();
    // The map draws world copies either side of the date line and a click on
    // one reports its unwrapped longitude (e.g. 210); a unit is stored in range.
    const clicked = event.lngLat?.wrap?.() ?? event.lngLat;

    // Move on an approximately placed structure's popup (Selection/Features.jsx):
    // it goes where the player clicks, sea included, and is settled.
    if (mode.kind === "structure-place") {
      void saveSettledStructure(mode.markerId, { lng: event.lngLat.lng, lat: event.lngLat.lat })
        .catch((error) => logDebugEvent("warn", "[map] Moving the structure failed.", error));
      clearInteractionMode();
      return;
    }

    if (mode.kind === "admin-place") {
      clearInteractionMode();
      // The Force Manager's hand placement (forces.jsx): one that could not be
      // saved stays armed and says so, as a deploy does.
      void placeUnitAdmin(mode.unitId, clicked.lng, clicked.lat).then((unit) => {
        if (!unit && getInteractionMode().kind === "idle") setInteractionMode({ ...mode, error: UNIT_NOT_SAVED });
      });
      return;
    }

    if (mode.kind === "deploy") {
      clearInteractionMode();
      // A deploy that could not be saved stays armed and says so in the
      // Forces banner, for another tap (unitsController.js deployUnit).
      void deployUnit({ ...mode.params, lng: clicked.lng, lat: clicked.lat }).then((result) => {
        if (!result?.ok && getInteractionMode().kind === "idle") setInteractionMode({ ...mode, error: result?.error });
      });
      return;
    }
    const unitHits = unitsAt();
    if (unitHits.length) {
      dismissRegionPopup();
      dismissFeaturePopup();
      onUnitSelected({ id: unitHits[0].properties.id, lngLat: event.lngLat });
      return;
    }

    dismissUnitPopup();

    const featureHit = featureAt();
    if (featureHit) {
      dismissRegionPopup();
      onFeatureSelected(featureHit);
      return;
    }

    dismissFeaturePopup();
    const hit = resolveRegionHit();
    if (!hit) {
      onOceanClicked();
      return;
    }

    const { props, regionId, gid0, owner } = hit;
    // The world's list wherever it has one, an ended dispute's empty one
    // included (useWorldState.js withSettledClaims); the feature's own claimants
    // only for a region the world never recorded.
    const rawClaimants = regionClaimants && Object.prototype.hasOwnProperty.call(regionClaimants, regionId)
      ? regionClaimants[regionId]
      : (Array.isArray(props.claimants) ? props.claimants : []);
    const claimants = Array.isArray(rawClaimants) ? rawClaimants : [];
    onRegionSelected({
      GID_0: owner || (owner === "" ? "" : toCountryName(gid0)),
      COUNTRY: hit.country,
      NAME_1: hit.regionName,
      GID_1: regionId,
      gid0,
      owner,
      claimants,
      isDisputed: Boolean(props._stripes || claimants.length > 0),
      lngLat: event.lngLat,
    });
  }, [map, regionClaimants, scenarioOwnsRegionGeometryAtAllZooms]);

  useEffect(() => {
    if (!map) return;
    map.on("click", handleRegionClick);
    return () => map.off("click", handleRegionClick);
  }, [handleRegionClick, map]);

  // The palette is re-read whenever colors.json is written (every AI turn can mint
  // or recolour a polity, and the main menu's faction creator writes the player's
  // own colour over an already-mounted map). Fetching once on mount left any
  // owner coloured after mount painting a procedural fallback for the rest of the
  // session — healed only by a reload. `oh:colors-updated` is dispatched by the
  // asset layer's write path; the epoch re-runs this effect.
  const [colorsEpoch, setColorsEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setColorsEpoch((n) => n + 1);
    window.addEventListener("oh:colors-updated", bump);
    return () => window.removeEventListener("oh:colors-updated", bump);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getNationColors()
      .then((next) => {
        if (cancelled) return;
        // Only swap the object when the contents actually differ — a new identity
        // rebuilds every MapLibre match expression below.
        setColorMap((prev) => (shallowEqualColors(prev, next) ? prev : next));
      })
      .catch((error) => console.error("Error loading colors:", error));
    return () => {
      cancelled = true;
    };
  }, [colorsEpoch]);

  // The one owner -> rgb resolver (ownerColors.js), shared with the unit and
  // structure layers so an owner reads the same colour everywhere on the map.
  const resolveOwnerRgb = useMemo(
    () => createOwnerRgbResolver(colorMap, polityOverrides),
    [colorMap, polityOverrides],
  );

  const ownerColorCss = useCallback(
    (owner) => ownerDisplayCss(resolveOwnerRgb, owner, NEUTRAL_LAND_COLOR),
    [resolveOwnerRgb],
  );

  // Worker geometry is keyed by canonical political owner, so label metadata
  // must use that exact namespace too (vnext/polityNaming.js).
  const workerLabelNames = useMemo(() => resolvePolityLabelNames({
    records: customRegionMeta.records,
    regionOwnershipOverrides,
    polityOverrides,
    canonicalOwner: toCountryName,
    displayName: resolveCountryDisplayName,
    translate: translateLabel,
  }),
  // labelEpoch intentionally rebakes translated strings after i18n updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [customRegionMeta.records, labelEpoch, polityOverrides, regionOwnershipOverrides]);
  const workerLabelNamesRef = useRef(workerLabelNames);
  workerLabelNamesRef.current = workerLabelNames;

  const sourceObjectsRef = useRef({ boundary: null });
  const updateBoundarySourceFromPatch = useCallback((patch) => {
    if (!patch) return;
    const cache = boundaryFeatureMapRef.current;
    const removeIds = (patch.removeIds ?? []).map(String);
    const existingIds = new Set(cache.keys());
    const upserts = (patch.upsert ?? []).filter((feature) => feature?.id !== undefined && feature?.id !== null);

    if (patch.removeAll) cache.clear();
    for (const id of removeIds) cache.delete(id);
    for (const feature of upserts) cache.set(String(feature.id), feature);

    const mapInstance = map?.getMap ? map.getMap() : map;
    // With no style (a lost WebGL context) only the cache changes; the boundary
    // rehydrate hands it to the rebuilt source after the restore.
    const source = mapInstance?.style ? mapInstance.getSource?.("polity-boundaries-source") : null;
    if (source) {
      const fullSnapshot = () => ({ type: "FeatureCollection", features: [...cache.values()] });
      const fallbackToSnapshot = (error) => {
        console.warn("[map] polity-boundaries-source incremental update failed; restoring current snapshot:", error);
        try {
          source.setData?.(fullSnapshot());
        } catch (fallbackError) {
          console.warn("[map] polity-boundaries-source snapshot restore failed:", fallbackError);
        }
      };
      try {
        if (typeof source.updateData === "function") {
          let diff = null;
          if (patch.removeAll) {
            diff = { removeAll: true, add: upserts };
          } else {
            const add = [];
            const update = [];
            for (const feature of upserts) {
              const id = String(feature.id);
              if (existingIds.has(id)) {
                update.push({
                  id,
                  newGeometry: feature.geometry,
                  removeAllProperties: true,
                  addOrUpdateProperties: Object.entries(feature.properties ?? {}).map(([key, value]) => ({ key, value })),
                });
              } else add.push(feature);
            }
            diff = {};
            if (removeIds.length) diff.remove = removeIds;
            if (add.length) diff.add = add;
            if (update.length) diff.update = update;
          }
          if (diff && Object.keys(diff).length) {
            const pending = source.updateData(diff);
            pending?.catch?.(fallbackToSnapshot);
          }
        } else if (typeof source.setData === "function") {
          source.setData(fullSnapshot());
        }
      } catch (error) {
        fallbackToSnapshot(error);
      }
    }
    setDerivedSourceEpoch((epoch) => epoch + 1);
  }, [map]);

  const publishOwnershipPresentation = useCallback((queued) => {
    if (!queued) return;
    const result = queued.cartographyResult ?? {};
    if (result.boundaryPatch) updateBoundarySourceFromPatch(result.boundaryPatch);
    if (result.disputedData?.features) setDisputedRegionData(result.disputedData);
    if (result.labels?.labelData?.features) {
      setPolityLabelCollections({
        ...EMPTY_POLITY_LABEL_COLLECTIONS,
        ...result.labels,
        curvedLabelData: EMPTY_FEATURE_COLLECTION,
        glyphLabelData: EMPTY_FEATURE_COLLECTION,
      });
    }
    setInitialCartographySettled(true);
    setAcknowledgedBoundaryOwnership(queued.ownershipOverrides ?? {});
    ownershipPresentation.releaseEntry(queued);
  }, [ownershipPresentation, updateBoundarySourceFromPatch]);

  const clearDerivedCartography = useCallback(({ resetMetadata = false } = {}) => {
    boundaryFeatureMapRef.current.clear();
    setPolityLabelCollections(EMPTY_POLITY_LABEL_COLLECTIONS);
    setDisputedRegionData(EMPTY_FEATURE_COLLECTION);
    setGroupAreaData(EMPTY_GROUP_AREA_DATA);
    setAcknowledgedBoundaryOwnership(null);
    if (resetMetadata) setCustomRegionMeta(EMPTY_CUSTOM_REGION_META);
    const mapInstance = map?.getMap ? map.getMap() : map;
    const source = mapInstance?.style ? mapInstance.getSource?.("polity-boundaries-source") : null;
    try {
      if (typeof source?.updateData === "function") source.updateData({ removeAll: true });
      else source?.setData?.(EMPTY_FEATURE_COLLECTION);
    } catch {}
  }, [map]);

  // A style/projection remount recreates MapLibre source objects. Rehydrate the
  // controller-owned boundary cache only when that source identity changes.
  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!mapInstance?.on) return undefined;
    let frame = 0;
    const hydrate = () => {
      frame = 0;
      // A frame queued just before a WebGL context loss runs with no style.
      if (!mapInstance.style) return;
      const source = mapInstance.getSource?.("polity-boundaries-source");
      if (!source || sourceObjectsRef.current.boundary === source) return;
      sourceObjectsRef.current.boundary = source;
      const features = [...boundaryFeatureMapRef.current.values()];
      const snapshot = { type: "FeatureCollection", features };
      const fallback = (error) => {
        console.warn("[map] Incremental boundary rehydrate failed; restoring snapshot:", error);
        try { source.setData?.(snapshot); } catch {}
      };
      try {
        if (typeof source.updateData === "function") source.updateData({ removeAll: true, add: features })?.catch?.(fallback);
        else source.setData?.(snapshot);
      } catch (error) {
        fallback(error);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(hydrate);
    };
    schedule();
    mapInstance.on("styledata", schedule);
    return () => {
      mapInstance.off("styledata", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [map, derivedSourceEpoch]);

  // MapLibre keeps a copy of the whole parsed regions file on the page once it
  // has loaded it; it is dropped as soon as it lands (regionsSourceMemory.js).
  const regionsFetchUrlRef = useRef("");
  regionsFetchUrlRef.current = regionsGeojsonFetchUrl || "";
  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!mapInstance?.on) return undefined;
    const forget = (event) => {
      if (event?.sourceId !== "custom-regions-source") return;
      forgetParsedSourceCopy(mapInstance, "custom-regions-source", regionsFetchUrlRef.current);
    };
    mapInstance.on("sourcedata", forget);
    forget({ sourceId: "custom-regions-source" });
    return () => mapInstance.off?.("sourcedata", forget);
  }, [map]);

  // Political Cartography Pipeline v2. Canonical per-region ownership remains
  // the visual truth. The worker owns topology, political borders and polity
  // label geometry; only a result for the newest desired political revision may
  // be published. Catalog readiness is emitted before derived cartography.
  useEffect(() => {
    const geometryEpoch = activeGeometryEpoch;
    const previousGeometryEpoch = cartographyGeometryEpochRef.current;
    const geometryChanged = Boolean(
      customFlag
      && previousGeometryEpoch
      && previousGeometryEpoch !== geometryEpoch
    );

    const previousScheduler = polityBoundarySchedulerRef.current;
    previousScheduler?.stop?.();
    polityBoundarySchedulerRef.current = null;
    const previous = polityBoundaryWorkerRef.current;
    if (previous) previous.terminate();
    polityBoundaryWorkerRef.current = null;
    enqueuedBoundaryOwnershipRef.current = null;
    enqueuedBoundaryClaimantsRef.current = null;
    enqueuedBoundaryLabelNamesRef.current = null;

    if (!customFlag) {
      bordersFailedRef.current = false;
      releaseAllOwnershipPresentation();
      setInitialCartographySettled(true);
      setInitialRegionRepairSettled(true);
      cartographyGeometryEpochRef.current = "";
      setRegionRenderRepair(EMPTY_REGION_RENDER_REPAIR);
      setCustomRegionMeta(EMPTY_CUSTOM_REGION_META);
      clearDerivedCartography();
      return undefined;
    }

    setInitialCartographySettled(false);
    setInitialRegionRepairSettled(false);
    cartographyGeometryEpochRef.current = geometryEpoch;
    if (geometryChanged) {
      setRegionRenderRepair(EMPTY_REGION_RENDER_REPAIR);
      ownershipPresentation.reset();
      const sweep = ownershipSweepRef.current;
      sweep.token += 1;
      sweep.worker?.terminate?.();
      if (sweep.frame) cancelAnimationFrame(sweep.frame);
      if (sweep.waitFrame) cancelAnimationFrame(sweep.waitFrame);
      if (sweep.timeout) clearTimeout(sweep.timeout);
      sweep.active = false;
      sweep.regionIds = [];
      setOwnershipTransitionSlices(EMPTY_FEATURE_COLLECTION);
      // A game/scenario switch can keep the same MapLibre instance alive. Old
      // derived borders/labels therefore must be removed synchronously at the
      // geometry authority boundary rather than surviving until the new worker
      // finishes. Canonical per-region rendering remains the only truth while
      // the replacement cartography is being derived.
      boundaryWorkerRestartCountRef.current = 0;
      bordersFailedRef.current = false;
      clearDerivedCartography({ resetMetadata: true });
    }

    // Website: the worker reads the regions through a blob: copy that is still
    // being staged, and there is nothing to initialize with until it exists —
    // an empty URL would publish an empty catalog and open the map on nothing.
    // The effect runs again when the copy lands (it is a dependency below).
    if (regionsGeojsonUrl && !regionsGeojsonFetchUrl) return undefined;

    // Readiness belongs to THIS worker/geometry epoch. On an ordinary watchdog
    // restart of the same geometry, already-published metadata remains valid; on
    // a geometry switch, readiness must be re-established by catalog-ready.
    let catalogReady = Boolean(customRegionMeta.ready && !geometryChanged);

    let worker;
    try {
      worker = new Worker(new URL("./vnext/polityBoundariesWorker.js", import.meta.url), { type: "module" });
    } catch (error) {
      console.warn("Political cartography worker is unavailable:", error);
      logDebugEvent("warn", "[map] Political cartography worker is unavailable; borders and labels fall back to the simpler form.", {
        error: String(error?.message ?? error),
        regionsUrl: regionsGeojsonUrl,
      });
      bordersFailedRef.current = true;
      setInitialCartographySettled(true);
      setInitialRegionRepairSettled(true);
      setCustomRegionMeta(EMPTY_CUSTOM_REGION_META);
      clearDerivedCartography();
      markPolitiesReady(regionsGeojsonUrl, { failed: true });
      return undefined;
    }
    polityBoundaryWorkerRef.current = worker;
    // A worker that starts has its own chance, on the same geometry too (the
    // effect reruns when the map instance changes): only its own final failure
    // marks the borders failed again.
    bordersFailedRef.current = false;

    // Groups' areas: asked of THIS worker only once it has published its
    // catalog (before that it holds no regions, or the last map's), and every
    // answer but the newest is dropped.
    let groupAreasReady = false;
    let groupAreaRequest = 0;
    const requestGroupAreas = () => {
      if (!groupAreasReady || worker !== polityBoundaryWorkerRef.current) return;
      groupAreaRequest += 1;
      const { groupAreas: areas, groups: registry } = groupAreaInputRef.current;
      if (!Object.keys(areas ?? {}).length) {
        setGroupAreaData(EMPTY_GROUP_AREA_DATA);
        return;
      }
      const colors = Object.fromEntries(Object.entries(registry ?? {}).map(([name, group]) => [name, { color: group?.color }]));
      worker.postMessage({ type: "group-areas", requestId: `group-areas-${groupAreaRequest}`, geometryEpoch, groupAreas: areas, groups: colors });
    };
    groupAreaRequestRef.current = requestGroupAreas;

    // On a phone the worker's first message waits until MapLibre has parsed the
    // same file (regionsSourceMemory.js): the two parses of a classic map at
    // once are what took phones down on the second loading screen. The
    // scheduler keeps one request in flight, so at most one message is held.
    const holdMap = map?.getMap ? map.getMap() : map;
    let parseHeld = Boolean(regionsGeojsonFetchUrl && holdMap?.on && isConstrainedDevice());
    let heldMessage = null;
    const postToWorker = (message) => {
      if (parseHeld) heldMessage = message;
      else worker.postMessage(message);
    };
    const parseHold = parseHeld
      ? holdUntilSourceLoaded({
          map: holdMap,
          sourceId: "custom-regions-source",
          onRelease: (reason) => {
            parseHeld = false;
            recordMapTrace("nations:regions-parse-released", { reason });
            forgetParsedSourceCopy(holdMap, "custom-regions-source", regionsGeojsonFetchUrl);
            const message = heldMessage;
            heldMessage = null;
            if (message && worker === polityBoundaryWorkerRef.current) worker.postMessage(message);
          },
        })
      : null;

    const restartWorker = ({ initialFailure = false } = {}) => {
      if (worker !== polityBoundaryWorkerRef.current) return;
      // The stalled revision's presentation holds die with its worker: the
      // replacement only runs initialize, which never releases them, and a held
      // region would otherwise keep its previous fill for the rest of the
      // session while borders and labels already show the current owner.
      releaseAllOwnershipPresentation();
      polityBoundarySchedulerRef.current?.stop?.();
      worker.terminate();
      polityBoundaryWorkerRef.current = null;
      polityBoundarySchedulerRef.current = null;
      const retrying = boundaryWorkerRestartCountRef.current < 1;
      if (initialFailure) {
        clearDerivedCartography({ resetMetadata: true });
        // Not a failure yet: the replacement worker below may still succeed.
        // With no retry left, the branch below marks the failure.
        if (retrying) markPolitiesReady(regionsGeojsonUrl);
      }
      if (retrying) {
        boundaryWorkerRestartCountRef.current += 1;
        setBoundaryWorkerEpoch((epoch) => epoch + 1);
      } else {
        // Two failed worker generations must degrade to canonical fills/legacy
        // labels rather than holding the scenario-open screen until its ceiling.
        bordersFailedRef.current = true;
        logDebugEvent("warn", "[map] Political cartography failed twice; borders and labels fall back to the simpler form.", {
          regionsUrl: regionsGeojsonUrl,
        });
        setInitialCartographySettled(true);
        setInitialRegionRepairSettled(true);
        markPolitiesReady(regionsGeojsonUrl, { failed: true });
      }
    };

    const scheduler = createPoliticalCartographyScheduler({
      dispatch: ({ revision, payload }) => {
        if (worker !== polityBoundaryWorkerRef.current) return;
        recordMapTrace("nations:cartography-dispatch", {
          revision,
          type: payload?.type ?? "",
        });
        postToWorker({ ...payload, requestId: revision, geometryEpoch });
      },
      onTimeout: ({ stalled, latestDesired }) => {
        if (worker !== polityBoundaryWorkerRef.current) return;
        console.warn(
          `Political cartography worker stalled on revision ${stalled.revision}; canonical region rendering remains authoritative.`,
        );
        logDebugEvent("warn", `[map] Political cartography worker stalled on revision ${stalled.revision}.`, {
          stalledRevision: stalled.revision,
          desiredRevision: latestDesired?.revision ?? stalled.revision,
          regionsUrl: regionsGeojsonUrl,
        });
        // Preserve already-valid unrelated derived artifacts. Dirty owners stay
        // hidden by canonical fallback while the replacement worker rebuilds.
        restartWorker({ initialFailure: !catalogReady });
      },
    });
    polityBoundarySchedulerRef.current = scheduler;

    worker.onmessage = ({ data: result }) => {
      if (worker !== polityBoundaryWorkerRef.current) return;

      if (result?.messageType === "group-areas-result") {
        if (result.geometryEpoch && result.geometryEpoch !== geometryEpoch) return;
        if (result.requestId !== `group-areas-${groupAreaRequest}`) return;
        if (result.error) {
          console.warn("Group areas could not be drawn:", result.error);
          return;
        }
        setGroupAreaData({
          fills: result.fills?.features ? result.fills : EMPTY_FEATURE_COLLECTION,
          outlines: result.outlines?.features ? result.outlines : EMPTY_FEATURE_COLLECTION,
          labels: result.labels?.features ? result.labels : EMPTY_FEATURE_COLLECTION,
        });
        return;
      }

      if (result?.messageType === "render-repair-ready") {
        if (result.geometryEpoch && result.geometryEpoch !== geometryEpoch) return;
        const repairData = result.repairData?.type === "FeatureCollection"
          ? result.repairData
          : EMPTY_FEATURE_COLLECTION;
        const repairedIds = Array.isArray(result.repairedIds)
          ? result.repairedIds.map(String).filter(Boolean)
          : [];
        // A repaired feature lives in a second, tiny GeoJSON source. Force live
        // ownership feature-state to replay so repaired and canonical sources are
        // visually identical apart from geometry safety.
        appliedCustomFillStateRef.current = new Map();
        setRegionRenderRepair({ geometryEpoch, data: repairData, repairedIds });
        setInitialRegionRepairSettled(true);
        if (result.disputedData) setDisputedRegionData(result.disputedData);
        // Repaired shapes replace malformed ones in the groups' tint too.
        requestGroupAreas();
        if (Number.isFinite(result.stats?.elapsedMs)) {
          reportPerfOperation("map targeted region render repair", result.stats.elapsedMs, {
            warnAt: PERF_MAP_WARN_MS,
          });
        }
        globalThis.__OH_MAP_SOURCE_PERF__ = {
          ...(globalThis.__OH_MAP_SOURCE_PERF__ ?? {}),
          regionRenderRepairMs: Number(result.stats?.elapsedMs ?? 0),
          regionRenderRepairScanned: Number(result.stats?.scannedFeatureCount ?? 0),
          regionRenderRepairUnsafe: Number(result.stats?.unsafeFeatureCount ?? 0),
          regionRenderRepairFeatures: Number(result.stats?.repairedFeatureCount ?? 0),
          regionRenderRepairDetachedPolygons: Number(result.stats?.removedDetachedPolygonCount ?? 0),
          regionRenderRepairPrecisionFeatures: Number(result.stats?.precisionHazardFeatureCount ?? 0),
          regionRenderRepairPrecisionVertices: Number(result.stats?.removedPrecisionVertexCount ?? 0),
          regionRenderRepairRejected: Number(
            (result.stats?.rejectedAreaDriftCount ?? 0)
            + (result.stats?.repairErrorCount ?? 0),
          ),
        };
        return;
      }

      if (result?.messageType === "render-repair-error") {
        if (result.geometryEpoch && result.geometryEpoch !== geometryEpoch) return;
        // Repair is a presentation safety layer, never canonical authority. A
        // failure must release startup to the canonical renderer rather than
        // deadlocking the scenario loading screen.
        setInitialRegionRepairSettled(true);
        console.warn("Targeted region render repair failed; keeping canonical geometry:", result.error);
        return;
      }

      if (result?.messageType === "catalog-ready") {
        if (result.geometryEpoch && result.geometryEpoch !== geometryEpoch) return;
        catalogReady = true;
        groupAreasReady = true;
        requestGroupAreas();
        const metadata = { ...EMPTY_CUSTOM_REGION_META, ...(result.metadata ?? {}), ready: true };
        setCustomRegionMeta(metadata);
        primeCustomRegionCatalogEntries(metadata.records, { url: regionsGeojsonUrl, invalidateCatalog: false });
        if (Number.isFinite(result.stats?.parseMs)) {
          globalThis.__OH_MAP_SOURCE_PERF__ = {
            ...(globalThis.__OH_MAP_SOURCE_PERF__ ?? {}),
            authoredRegionsWorkerFetchMs: Number(result.stats.fetchMs ?? 0),
            authoredRegionsWorkerParseMs: Number(result.stats.parseMs ?? 0),
            authoredRegionsBytes: Number(result.stats.bytes ?? 0),
          };
        }
        return;
      }

      if (result?.messageType === "ownership-transition-ready") {
        if (result.geometryEpoch && result.geometryEpoch !== geometryEpoch) return;
        const revision = Number(result.requestId);
        const snapshot = scheduler.snapshot();
        const request = snapshot.inFlight;
        // Early transition geometry belongs only to the exact still-desired
        // ownership revision. If a newer canonical mutation already superseded
        // it, do not animate an obsolete intermediate political state.
        if (
          !request
          || Number(request.revision) !== revision
          || request?.payload?.type !== "update-ownership"
          || Number(snapshot.latestDesired?.revision) !== revision
        ) return;

        const transitionData = result.ownershipTransitionData?.features?.length
          ? result.ownershipTransitionData
          : EMPTY_FEATURE_COLLECTION;
        if (!transitionData.features.length) return;

        const { added } = ownershipPresentation.addTransition({
          revision,
          transitionData,
          ownershipOverrides: request?.payload?.ownershipOverrides ?? {},
          changedRegionIds: result.changedRegionIds ?? request?.payload?.changedRegionIds ?? [],
        });
        if (added) setOwnershipTransitionQueueEpoch((epoch) => epoch + 1);
        return;
      }

      if (result?.geometryEpoch && result.geometryEpoch !== geometryEpoch) {
        return;
      }

      const completion = scheduler.complete(result?.requestId);
      if (!completion.accepted) {
        // The scheduler coalesces unpublished political revisions: the
        // surviving ownership revision keeps one hold per region, plus one
        // for a sweep still playing (ownershipPresentationHolds.js).
        ownershipPresentation.discardCartography(result?.requestId, {
          supersededByChangedRegionIds: completion.superseded
            && completion.supersededBy?.payload?.type === "update-ownership"
            ? completion.supersededBy.payload.changedRegionIds ?? []
            : null,
        });
        return;
      }
      const request = completion.request;

      if (result.error) {
        if (request?.payload?.type === "initialize") {
          setInitialCartographySettled(true);
          setInitialRegionRepairSettled(true);
        }
        if (request?.payload?.type === "update-ownership") {
          ownershipPresentation.failCartography(request?.revision, request?.payload?.changedRegionIds ?? []);
        }
        console.warn("Political cartography derivation failed:", result.error);
        logDebugEvent("warn", `[map] Political cartography revision ${request?.revision ?? "?"} failed.`, {
          error: result.error,
          type: request?.payload?.type ?? "",
        });
        // Local updates fail toward canonical per-region rendering. Only an
        // initialization failure lacks enough derived state to justify clearing.
        restartWorker({ initialFailure: request?.payload?.type === "initialize" && !catalogReady });
        return;
      }

      boundaryWorkerRestartCountRef.current = 0;
      const isOwnershipUpdate = request?.payload?.type === "update-ownership";
      const hasOwnershipSweep = Boolean(
        isOwnershipUpdate
        && result.ownershipTransitionData?.features?.length,
      );

      if (hasOwnershipSweep) {
        // Transition geometry is normally emitted BEFORE the expensive
        // boundary/PTR result, so the sweep can already be running while this
        // result is derived. Attach the accepted cartography to that same
        // revision instead of starting a second/delayed animation.
        // A revision whose early transition-ready message never came gets
        // its sweep queued here: the animation is kept, just without the
        // latency advantage.
        const { entry, added, publishNow } = ownershipPresentation.acceptCartography({
          revision: Number(request?.revision ?? result?.requestId ?? 0),
          transitionData: result.ownershipTransitionData,
          cartographyResult: {
            boundaryPatch: result.boundaryPatch,
            disputedData: result.disputedData,
            labels: result.labels,
          },
          ownershipOverrides: request?.payload?.ownershipOverrides,
          changedRegionIds: request?.payload?.changedRegionIds,
        });
        if (added) setOwnershipTransitionQueueEpoch((epoch) => epoch + 1);

        // If the ~680 ms sweep already finished while cartography was still
        // deriving, publish the new borders/PTR now. Otherwise finish() will
        // commit them exactly when the sweep reaches 100%.
        if (publishNow) publishOwnershipPresentation(entry);
      } else {
        if (result.boundaryPatch) updateBoundarySourceFromPatch(result.boundaryPatch);
        if (result.disputedData?.features) setDisputedRegionData(result.disputedData);
        if (result.labels?.labelData?.features) {
          setPolityLabelCollections({
            ...EMPTY_POLITY_LABEL_COLLECTIONS,
            ...result.labels,
            curvedLabelData: EMPTY_FEATURE_COLLECTION,
            glyphLabelData: EMPTY_FEATURE_COLLECTION,
          });
        }
        if (!["update-claims", "update-labels"].includes(request?.payload?.type)) {
          setInitialCartographySettled(true);
          setAcknowledgedBoundaryOwnership(request?.payload?.ownershipOverrides ?? {});
        }
        if (isOwnershipUpdate) {
          releaseOwnershipPresentation(request?.payload?.changedRegionIds ?? []);
        }
      }

      recordMapTrace("nations:cartography-ack", {
        revision: request?.revision ?? result?.requestId ?? 0,
        type: request?.payload?.type ?? "",
      });
      if (request?.payload?.type === "update-ownership") {
        globalThis.__OH_MAP_SOURCE_PERF__ = {
          ...(globalThis.__OH_MAP_SOURCE_PERF__ ?? {}),
          ownershipCartographyMs: Number(result.stats?.elapsedMs ?? 0),
          ownershipBoundaryMs: Number(result.stats?.boundaryMs ?? 0),
          ownershipLabelGeometryMs: Number(result.stats?.labelGeometryMs ?? 0),
          ownershipLabelBuildMs: Number(result.stats?.labelMs ?? 0),
          ownershipChangedRegionCount: Number(result.stats?.changedRegionCount ?? 0),
          ownershipAffectedOwnerCount: Number(result.stats?.affectedOwnerCount ?? 0),
          ownershipRefreshedLabelOwnerCount: Number(result.stats?.refreshedLabelOwnerCount ?? 0),
          ownershipDeferredLabelOwnerCount: Number(result.stats?.deferredLabelOwnerCount ?? 0),
          ownershipDeferredLabelOwners: Array.isArray(result.stats?.deferredLabelOwners)
            ? [...result.stats.deferredLabelOwners]
            : [],
        };
      }
      if (Number.isFinite(result.stats?.elapsedMs)) {
        reportPerfOperation("map political cartography worker", result.stats.elapsedMs, { warnAt: PERF_MAP_WARN_MS });
      }
    };

    worker.onerror = (error) => {
      if (worker !== polityBoundaryWorkerRef.current) return;
      releaseAllOwnershipPresentation();
      console.warn("Political cartography worker failed:", error);
      logDebugEvent("warn", "[map] Political cartography worker failed.", {
        error: String(error?.message ?? error),
        regionsUrl: regionsGeojsonUrl,
      });
      restartWorker({ initialFailure: !catalogReady });
    };

    const ownershipOverrides = regionOwnershipOverridesRef.current;
    const claimants = regionClaimantsRef.current;
    const labelNames = workerLabelNamesRef.current;
    enqueuedBoundaryOwnershipRef.current = ownershipOverrides;
    enqueuedBoundaryClaimantsRef.current = claimants;
    enqueuedBoundaryLabelNamesRef.current = labelNames;
    // A held parse keeps the worker's whole budget: the wait is not its time.
    scheduler.enqueue({
      type: "initialize",
      regionsUrl: regionsGeojsonFetchUrl,
      ownershipOverrides,
      regionClaimants: claimants,
      labelNames,
    }, { timeoutMs: 120000 + (parseHeld ? REGIONS_PARSE_HOLD_MS : 0) });

    return () => {
      if (groupAreaRequestRef.current === requestGroupAreas) groupAreaRequestRef.current = null;
      parseHold?.cancel();
      scheduler.stop();
      worker.terminate();
      if (polityBoundarySchedulerRef.current === scheduler) polityBoundarySchedulerRef.current = null;
      if (polityBoundaryWorkerRef.current === worker) polityBoundaryWorkerRef.current = null;
    };
  // Metadata is emitted by this effect; do not restart the worker merely because
  // catalog-ready updated customRegionMeta.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeGeometryEpoch,
    boundaryWorkerEpoch,
    clearDerivedCartography,
    customFlag,
    regionsGeojsonFetchUrl,
    regionsGeojsonUrl,
    releaseAllOwnershipPresentation,
    releaseOwnershipPresentation,
    updateBoundarySourceFromPatch,
  ]);

  useEffect(() => {
    groupAreaInputRef.current = { groupAreas, groups };
    groupAreaRequestRef.current?.();
  }, [groupAreas, groups]);

  // Group layers mount with a best-guess beforeId (GroupAreaLayers.jsx); the
  // canonical stack (mapLayerOrder.js) settles them once they exist.
  useEffect(() => {
    if (!groupAreaData.fills.features.length && !groupAreaData.outlines.features.length) return undefined;
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!mapInstance?.style) return undefined;
    const frame = requestAnimationFrame(() => {
      try {
        if (mapInstance.style && mapInstance.getLayer("group-areas-tint")) enforceMapLayerOrder(mapInstance);
      } catch {
        // The style is being rebuilt; the next change settles the stack.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [groupAreaData, map]);

  // Opening-screen readiness now includes the authoritative PTR first paint
  // AND targeted geometry-safety settlement. Catalog metadata still publishes
  // early for gameplay/GM consumers, but a custom map keeps the existing
  // scenario loading screen up until the initial worker revision has produced
  // polity records, malformed-region presentation repair has settled, and PTR
  // has mounted.
  // Mid-campaign ownership/name updates remain incremental and never reopen the
  // screen. If PTR genuinely fails or there are no renderable records, the
  // legacy MapLibre fallback is allowed through instead of deadlocking startup.
  useEffect(() => {
    if (!worldKnown) return;
    if (customFlag && !customRegionMeta.ready) return;
    if (customFlag && !initialCartographySettled) return;
    if (customFlag && !initialRegionRepairSettled) return;
    if (
      ptrBlocksInitialReadiness
      && ptr1PolityTextRecords.length > 0
      && !ptrPolityTextStatus.mounted
      && !ptrPolityTextStatus.failed
    ) return;
    markPolitiesReady(regionsGeojsonUrl, { failed: bordersFailedRef.current });
  }, [
    customFlag,
    customRegionMeta.ready,
    initialCartographySettled,
    initialRegionRepairSettled,
    ptr1PolityTextRecords.length,
    ptrBlocksInitialReadiness,
    ptrPolityTextStatus.failed,
    ptrPolityTextStatus.mounted,
    regionsGeojsonUrl,
    worldKnown,
  ]);

  useEffect(() => {
    const scheduler = polityBoundarySchedulerRef.current;
    if (!customFlag || !scheduler) return;

    const previousOwnership = enqueuedBoundaryOwnershipRef.current;
    const previousClaimants = enqueuedBoundaryClaimantsRef.current;
    const previousLabels = enqueuedBoundaryLabelNamesRef.current ?? {};
    const ownershipChanged = previousOwnership !== regionOwnershipOverrides;
    const claimantsChanged = previousClaimants !== regionClaimants;
    const labelOwners = new Set([...Object.keys(previousLabels), ...Object.keys(workerLabelNames)]);
    const changedLabelOwners = [...labelOwners].filter((owner) => previousLabels?.[owner] !== workerLabelNames?.[owner]);

    if (!ownershipChanged && !claimantsChanged && !changedLabelOwners.length) return;
    enqueuedBoundaryOwnershipRef.current = regionOwnershipOverrides;
    enqueuedBoundaryClaimantsRef.current = regionClaimants;
    enqueuedBoundaryLabelNamesRef.current = workerLabelNames;

    if (ownershipChanged) {
      const diff = diffPoliticalOwnership(
        customRegionMeta.records,
        previousOwnership ?? {},
        regionOwnershipOverrides,
      );
      // Before catalog-ready, base owners are unavailable. Exact changed override
      // ids are still known; the worker resolves old/new owners from its own
      // geometry topology once initialization has parsed the authored map.
      if (!diff.affectedOwners.length && diff.changedRegionIds.length) {
        for (const owner of Object.values(previousOwnership ?? {})) if (owner) diff.affectedOwners.push(String(owner));
        for (const owner of Object.values(regionOwnershipOverrides ?? {})) if (owner && !diff.affectedOwners.includes(String(owner))) diff.affectedOwners.push(String(owner));
      }
      if (diff.changedRegionIds.length) {
        // Freeze the visible political revision BEFORE the later fill-sync
        // effect runs. Canonical state still advances immediately, while the
        // map keeps the prior colour/border/label revision until the sweep has
        // actually played and can hand off atomically to the worker result.
        holdOwnershipPresentation(diff.changedRegionIds);
        scheduler.enqueue({
          type: "update-ownership",
          ownershipOverrides: regionOwnershipOverrides,
          regionClaimants,
          labelNames: workerLabelNames,
          // A political ownership change and a translated/display-name change can
          // land in the same React pass. Preserve both invalidation domains in
          // one worker revision so advancing the label ref cannot swallow a
          // label update unrelated to the changed territorial owners.
          affectedOwners: [...new Set([...diff.affectedOwners, ...changedLabelOwners])],
          changedRegionIds: diff.changedRegionIds,
          forceFullSnapshot: acknowledgedBoundaryOwnership == null,
        }, { timeoutMs: 60000 });
        return;
      }
      // A fresh object with identical canonical ownership is not a political
      // revision. Fall through so a simultaneous claims/name update takes the
      // cheapest dedicated route instead of rebuilding ownership artifacts.
    }

    if (claimantsChanged) {
      scheduler.enqueue({
        type: "update-claims",
        ownershipOverrides: regionOwnershipOverrides,
        regionClaimants,
        labelNames: workerLabelNames,
        // Claim and label changes may be observed together. Carry the label
        // invalidation in this same revision rather than marking it enqueued and
        // then returning a claims-only result that never republishes the label.
        affectedOwners: changedLabelOwners,
      }, { timeoutMs: 60000 });
      return;
    }

    scheduler.enqueue({
      type: "update-labels",
      ownershipOverrides: regionOwnershipOverrides,
      regionClaimants,
      labelNames: workerLabelNames,
      affectedOwners: changedLabelOwners,
    }, { timeoutMs: 60000 });
  }, [
    acknowledgedBoundaryOwnership,
    customFlag,
    customRegionMeta.records,
    holdOwnershipPresentation,
    regionClaimants,
    regionOwnershipOverrides,
    workerLabelNames,
  ]);


  const enrichedDisputedRegionData = useMemo(() => {
    if (!disputedRegionData?.features?.length) return EMPTY_FEATURE_COLLECTION;
    return {
      ...disputedRegionData,
      features: disputedRegionData.features.map((feature) => {
        const props = feature?.properties ?? {};
        const id = String(props.id ?? props.GID_1 ?? "");
        const liveOwner = String(
          (id ? regionOwnershipOverrides?.[id] : undefined)
          ?? props._liveOwner
          ?? props.owner
          ?? "",
        );
        const claimants = id && Array.isArray(regionClaimants?.[id])
          ? regionClaimants[id]
          : Array.isArray(props._liveClaimants)
            ? props._liveClaimants
            : [];
        const seen = new Set();
        const stripeRgbs = [];
        for (const name of (liveOwner ? [liveOwner, ...claimants] : claimants)) {
          const key = String(name ?? "").trim();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          stripeRgbs.push(resolveOwnerRgb(key) ?? fallbackRgbFromOwner(key));
        }
        const stripes = stripeRgbs.length >= 2 ? stripeImageId(stripeRgbs) : null;
        return {
          ...feature,
          properties: {
            ...props,
            _fillColor: liveOwner ? ownerColorCss(liveOwner) : NEUTRAL_LAND_COLOR,
            ...(stripes ? { _stripes: stripes } : {}),
          },
        };
      }),
    };
  }, [disputedRegionData, ownerColorCss, regionClaimants, regionOwnershipOverrides, resolveOwnerRgb]);

  // GADM disputed regions also paint the stock tiles (the crisp close-detail
  // twin), read from the worker's compact metadata rather than a parsed
  // geometry graph retained on the UI thread.
  const disputedTileStops = useMemo(() => {
    if (fullyAuthoredGeometry) return [];
    const stops = [];
    for (const record of customRegionMeta.records ?? []) {
      const id = String(record?.id ?? "");
      if (!id || record?.authored === true) continue;
      const claimants = Object.prototype.hasOwnProperty.call(regionClaimants, id) ? regionClaimants[id] : record?.claimants;
      if (!Array.isArray(claimants) || !claimants.length) continue;
      const liveOwner = regionOwnershipOverrides[id] ?? record?.owner ?? "";
      const seen = new Set();
      const stripeRgbs = [];
      for (const name of (liveOwner ? [liveOwner, ...claimants] : claimants)) {
        const key = String(name ?? "").trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        stripeRgbs.push(resolveOwnerRgb(key) ?? fallbackRgbFromOwner(key));
      }
      if (stripeRgbs.length >= 2) stops.push(id, stripeImageId(stripeRgbs));
    }
    return stops;
  }, [fullyAuthoredGeometry, customRegionMeta.records, regionClaimants, regionOwnershipOverrides, resolveOwnerRgb]);

  const ownerByRegionId = useMemo(() => {
    const lookup = new Map();

    // Live exact-region ownership is canonical even when a hybrid scenario's
    // regions.geojson omits the stock geometry for that id. PR #647-era maps
    // preserved this by keeping the PMTiles region underneath; PCPv2 accidentally
    // rebuilt the lookup only from worker metadata and silently dropped such ids.
    for (const [regionId, owner] of Object.entries(regionOwnershipOverrides ?? {})) {
      const id = String(regionId ?? "");
      if (id) lookup.set(id, owner ?? "");
    }

    if (!customActive) return lookup;
    for (const record of customRegionMeta.records ?? []) {
      const id = String(record?.id ?? "");
      if (!id || lookup.has(id)) continue;
      lookup.set(id, record?.owner ?? "");
    }
    return lookup;
  }, [customActive, customRegionMeta.records, regionOwnershipOverrides]);

  const ownerLookupRef = useRef(new Map());
  useEffect(() => {
    ownerLookupRef.current = ownerByRegionId;
  }, [ownerByRegionId]);

  const editedStockIds = useMemo(
    () => (customActive ? customRegionMeta.editedStockIds ?? [] : []),
    [customActive, customRegionMeta.editedStockIds],
  );

  // Backward compatibility for tier-2 scenarios authored before `edited:true`
  // became a complete per-feature invariant. If a scenario explicitly reshaped
  // any stock region in a country, its serialized GeoJSON becomes the geometry
  // authority for that whole stock-country cohort. This prevents an unmarked
  // sibling replacement from disappearing at the PMTiles handoff and exposing
  // the underlying modern stock province (wrong shape/owner or "Unclaimed").
  //
  // This is intentionally keyed by stable stock geography (gid0), never polity
  // names: Russian Empire / Russia / fictional owners all get identical behavior.
  const legacyAuthoritativeCountryCodes = useMemo(
    () => customActive
      ? deriveLegacyAuthoritativeCountryCodes(customRegionMeta.records)
      : [],
    [customActive, customRegionMeta.records],
  );

  const customAuthoritativeGeometryFilter = useMemo(() => (
    legacyAuthoritativeCountryCodes.length
      ? [
        "any",
        AUTHORED_GEOMETRY_FILTER,
        ["in", SCENARIO_GID0_EXPRESSION, ["literal", legacyAuthoritativeCountryCodes]],
      ]
      : AUTHORED_GEOMETRY_FILTER
  ), [legacyAuthoritativeCountryCodes]);

  const customFarStockGeometryFilter = useMemo(() => (
    legacyAuthoritativeCountryCodes.length
      ? [
        "all",
        STOCK_GEOMETRY_FILTER,
        ["!", ["in", SCENARIO_GID0_EXPRESSION, ["literal", legacyAuthoritativeCountryCodes]]],
      ]
      : STOCK_GEOMETRY_FILTER
  ), [legacyAuthoritativeCountryCodes]);

  const repairedRegionIdsLiteral = useMemo(
    () => ["literal", repairedRegionIds],
    [repairedRegionIds],
  );
  const unrepairedRegionFilter = useMemo(() => (
    repairedRegionIds.length
      ? ["!", ["in", SCENARIO_REGION_ID_EXPRESSION, repairedRegionIdsLiteral]]
      : ["all"]
  ), [repairedRegionIds.length, repairedRegionIdsLiteral]);
  const canonicalCustomAuthoritativeGeometryFilter = useMemo(() => (
    repairedRegionIds.length
      ? ["all", customAuthoritativeGeometryFilter, unrepairedRegionFilter]
      : customAuthoritativeGeometryFilter
  ), [customAuthoritativeGeometryFilter, repairedRegionIds.length, unrepairedRegionFilter]);
  const canonicalCustomFarStockGeometryFilter = useMemo(() => (
    repairedRegionIds.length
      ? ["all", customFarStockGeometryFilter, unrepairedRegionFilter]
      : customFarStockGeometryFilter
  ), [customFarStockGeometryFilter, repairedRegionIds.length, unrepairedRegionFilter]);

  const stockRegionsVisibilityFilter = useMemo(() => {
    const clauses = [];
    if (editedStockIds.length) {
      clauses.push(["!", ["in", ["get", "GID_1"], ["literal", editedStockIds]]]);
    }
    if (legacyAuthoritativeCountryCodes.length) {
      clauses.push(["!", ["in", ["upcase", ["get", "GID_0"]], ["literal", legacyAuthoritativeCountryCodes]]]);
    }
    return clauses.length ? ["all", ...clauses] : ["all"];
  }, [editedStockIds, legacyAuthoritativeCountryCodes]);

  // Feature-state lives on the MapLibre source object. A lost WebGL context
  // (Android drops it under memory pressure) or a style MapLibre cannot diff
  // (Settings > 3D Terrain) rebuilds every source as a new object with no
  // state, while the applied-fill ledgers still said each colour was drawn:
  // the whole map stayed grey. A source a ledger wrote to that is replaced or
  // gone voids that ledger, and its epoch makes the sync write every fill again.
  const fillStateSourcesRef = useRef({ custom: null, repair: null, tiles: null });
  const [customFillSourceEpoch, setCustomFillSourceEpoch] = useState(0);
  const [tileFillSourceEpoch, setTileFillSourceEpoch] = useState(0);
  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!mapInstance?.on) return undefined;
    let frame = 0;
    const check = () => {
      frame = 0;
      // Between a context loss and its restore the map has no style at all.
      if (!mapInstance.style) return;
      const seen = fillStateSourcesRef.current;
      const next = {
        custom: mapInstance.getSource("custom-regions-source") ?? null,
        repair: mapInstance.getSource("custom-regions-repair-source") ?? null,
        tiles: mapInstance.getSource("regions-source") ?? null,
      };
      fillStateSourcesRef.current = next;
      if ((seen.custom && seen.custom !== next.custom) || (seen.repair && seen.repair !== next.repair)) {
        // The rebuild dropped the ownership flood layer too, and with it the
        // callback that ends the sweep: end it here (holds released, cartography
        // published, queue moving), then let the replay draw every fill.
        if (seen.custom !== next.custom && ownershipSweepRef.current.active) ownershipSweepRef.current.finish?.();
        appliedCustomFillStateRef.current = new Map();
        setCustomFillSourceEpoch((epoch) => epoch + 1);
      }
      if (seen.tiles && seen.tiles !== next.tiles) {
        appliedTileFillStateRef.current = new Map();
        setTileFillSourceEpoch((epoch) => epoch + 1);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    schedule();
    mapInstance.on("styledata", schedule);
    return () => {
      mapInstance.off("styledata", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [map]);

  // The URL-backed authored source uses the same merged ownership lookup as
  // click resolution and the stock-detail fill path. Live overrides stay
  // authoritative; scenario metadata supplies the starting owner when no live
  // override exists. This keeps edited/authored regions from falling through to
  // neutral grey simply because their starting ownership was never duplicated
  // into world.regionOwnershipOverrides.
  useEffect(() => {
    if (!customFlag) return undefined;
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!mapInstance?.setFeatureState) return undefined;
    let cancelled = false;
    let retryFrame = 0;
    let workFrame = 0;

    const begin = () => {
      if (cancelled) return;
      // No style (a lost WebGL context) waits like a source not there yet.
      if (
        !mapInstance.style
        || !mapInstance.getSource?.("custom-regions-source")
        || (repairedRegionIds.length && !mapInstance.getSource?.("custom-regions-repair-source"))
      ) {
        retryFrame = requestAnimationFrame(begin);
        return;
      }

      const syncStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      const cachedTarget = ownershipFillTargetRef.current;
      let next = cachedTarget.fills;
      if (
        !next
        || cachedTarget.owners !== ownerByRegionId
        || cachedTarget.colorCss !== ownerColorCss
      ) {
        next = new Map();
        for (const [regionId, owner] of ownerByRegionId) {
          const id = String(regionId ?? "");
          if (!id || !owner) continue;
          next.set(id, ownerColorCss(owner));
        }
        // Read-only below: the diff never writes to it, appliedAfterSync is its
        // own Map. Anything that starts mutating it must drop the cache too.
        ownershipFillTargetRef.current = {
          owners: ownerByRegionId,
          colorCss: ownerColorCss,
          fills: next,
        };
      }
      const applied = appliedCustomFillStateRef.current;
      const held = ownershipPresentation.holds;
      const operations = [];
      for (const [regionId, fillColor] of next) {
        if (held.has(regionId) || applied.get(regionId) === fillColor) continue;
        operations.push({ kind: "set", regionId, fillColor });
      }
      for (const regionId of applied.keys()) {
        if (held.has(regionId) || next.has(regionId)) continue;
        operations.push({ kind: "remove", regionId });
      }

      // Track only feature-state writes that actually reached MapLibre. Held
      // regions intentionally stay on their previous visual revision.
      const appliedAfterSync = new Map(applied);
      let cursor = 0;
      let setCount = 0;
      let removeCount = 0;
      const applySlice = () => {
        if (cancelled || !mapInstance.style) return;
        const sliceStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
        let processed = 0;
        while (cursor < operations.length) {
          const op = operations[cursor++];
          const sourceIds = repairedRegionIdSet.has(op.regionId)
            ? ["custom-regions-source", "custom-regions-repair-source"]
            : ["custom-regions-source"];
          if (op.kind === "set") {
            for (const source of sourceIds) {
              mapInstance.setFeatureState(
                { source, id: op.regionId },
                { fillColor: op.fillColor },
              );
            }
            appliedAfterSync.set(op.regionId, op.fillColor);
            setCount += 1;
          } else {
            for (const source of sourceIds) {
              mapInstance.removeFeatureState?.(
                { source, id: op.regionId },
                "fillColor",
              );
            }
            appliedAfterSync.delete(op.regionId);
            removeCount += 1;
          }
          processed += 1;
          const now = typeof performance !== "undefined" ? performance.now() : Date.now();
          if (processed >= 160 || now - sliceStartedAt >= 4) break;
        }

        if (cursor < operations.length) {
          workFrame = requestAnimationFrame(applySlice);
          return;
        }

        // A ledger replaced mid-pass was reset on purpose (a region repair, a
        // rebuilt source), and the reset re-runs this sync to write every fill.
        if (appliedCustomFillStateRef.current === applied) appliedCustomFillStateRef.current = appliedAfterSync;
        const syncElapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - syncStartedAt;
      };

      // Normal political changes are small enough to remain same-frame. Huge
      // scenario/bootstrap batches are sliced so they never monopolize input.
      if (operations.length <= 256) applySlice();
      else workFrame = requestAnimationFrame(applySlice);
    };

    begin();
    return () => {
      cancelled = true;
      if (retryFrame) cancelAnimationFrame(retryFrame);
      if (workFrame) cancelAnimationFrame(workFrame);
    };
  }, [
    customFillSourceEpoch,
    customFlag,
    map,
    ownerColorCss,
    ownershipPresentation.holds,
    ownershipPresentationHoldEpoch,
    ownerByRegionId,
    repairedRegionIdSet,
    repairedRegionIds,
  ]);

  // Presentation-only legal sovereignty transition. Canonical ownership advances
  // immediately in world state, but the MAP intentionally keeps the previous
  // accepted colour visible until transition geometry is ready. Transition
  // geometry arrives early, before expensive boundary/PTR derivation, so the
  // frontier-distance flood starts promptly. New borders/labels may finish during the transition or
  // shortly after it, but they never publish before the ownership animation. The
  // previous directional strip sweep remains mounted as a fail-soft fallback.
  useEffect(() => {
    const sweep = ownershipSweepRef.current;
    if (sweep.active) return;
    const queued = ownershipPresentation.nextTransition();
    if (!queued) return;

    const transitionData = queued.transitionData ?? EMPTY_FEATURE_COLLECTION;
    const mapInstance = map?.getMap ? map.getMap() : map;

    // If presentation animation is unavailable, fail soft to the canonical
    // target colour immediately, but do NOT pretend the slower border/PTR
    // derivation is already ready. It will publish when its accepted result
    // actually arrives.
    if (!transitionData?.features?.length || !customActive || !mapInstance?.setFeatureState) {
      if (ownershipPresentation.finishTransition(queued) === "publish") publishOwnershipPresentation(queued);
      setOwnershipTransitionQueueEpoch((epoch) => epoch + 1);
      return;
    }

    // The in-game Reduce motion switch or the system's reduced-motion setting:
    // the new owner's colour lands at once, without the sweep.
    if (reduceMotionEnabled()) {
      if (ownershipPresentation.finishTransition(queued) === "publish") publishOwnershipPresentation(queued);
      setOwnershipTransitionQueueEpoch((epoch) => epoch + 1);
      return;
    }

    sweep.active = true;
    sweep.token += 1;
    const token = sweep.token;
    let committed = false;
    const enrichedFeatures = transitionData.features.map((feature) => ({
      ...feature,
      properties: {
        ...(feature.properties ?? {}),
        fromColor: ownerColorCss(feature?.properties?.fromOwner),
        toColor: ownerColorCss(feature?.properties?.toOwner),
      },
    }));
    sweep.regionIds = [...new Set(enrichedFeatures
      .map((feature) => String(feature?.properties?.id ?? feature?.id ?? ""))
      .filter(Boolean))];

    const sourceIdsForRegion = (regionId) => (
      repairedRegionIdSet.has(String(regionId))
        ? ["custom-regions-source", "custom-regions-repair-source"]
        : ["custom-regions-source"]
    );

    const setBaseHidden = (hidden) => {
      for (const regionId of sweep.regionIds) {
        for (const source of sourceIdsForRegion(regionId)) {
          if (!mapInstance.getSource?.(source)) continue;
          try {
            mapInstance.setFeatureState(
              { source, id: regionId },
              { ownershipTransitionHidden: Boolean(hidden) },
            );
          } catch {}
        }
      }
    };

    const applyTargetBaseFill = () => {
      // The overlay is already showing 100% target colour when this runs.
      // Prime every underlying source with the same target colour BEFORE the
      // overlay is removed, making the hand-off visually atomic.
      for (const feature of enrichedFeatures) {
        const regionId = String(feature?.properties?.id ?? feature?.id ?? "");
        const toColor = String(feature?.properties?.toColor ?? "");
        if (!regionId || !toColor) continue;

        for (const source of sourceIdsForRegion(regionId)) {
          if (!mapInstance.getSource?.(source)) continue;
          try {
            mapInstance.setFeatureState(
              { source, id: regionId },
              { fillColor: toColor },
            );
          } catch {}
        }
        appliedCustomFillStateRef.current.set(regionId, toColor);

        if (mapInstance.getSource?.("regions-source")) {
          try {
            mapInstance.setFeatureState(
              { source: "regions-source", sourceLayer: "regions", id: regionId },
              { fillColor: toColor },
            );
            appliedTileFillStateRef.current.set(regionId, toColor);
          } catch {}
        }
      }
    };

    const finish = () => {
      if (token !== ownershipSweepRef.current.token || committed) return;
      // With the WebGL context lost the map has no style: nothing can be read
      // or drawn. The fill-source watcher finishes the sweep once the restored
      // style has brought the sources back.
      if (!mapInstance.style) return;
      committed = true;
      if (sweep.frame) cancelAnimationFrame(sweep.frame);
      if (sweep.waitFrame) cancelAnimationFrame(sweep.waitFrame);
      if (sweep.timeout) clearTimeout(sweep.timeout);
      sweep.worker?.terminate?.();
      sweep.worker = null;
      sweep.frame = 0;
      sweep.waitFrame = 0;
      sweep.timeout = 0;

      // Commit the colour transition immediately at 100%. The expensive
      // border/PTR result is allowed to still be deriving in parallel; if it is
      // ready, publish it under the full target-colour overlay before reveal.
      // If not, reveal the target base fill now and let the accepted derived
      // cartography catch up as soon as its worker result arrives.
      applyTargetBaseFill();
      if (ownershipPresentation.finishTransition(queued) === "publish") publishOwnershipPresentation(queued);
      setBaseHidden(false);
      try {
        if (mapInstance.getLayer?.("ownership-transition-sweep-fill")) {
          mapInstance.setPaintProperty("ownership-transition-sweep-fill", "fill-opacity", 0);
        }
      } catch {}
      try { sweep.floodLayer?.clearTransition?.(); } catch {}

      sweep.regionIds = [];
      sweep.active = false;
      setOwnershipTransitionSlices(EMPTY_FEATURE_COLLECTION);
      setOwnershipTransitionQueueEpoch((epoch) => epoch + 1);
      mapInstance.triggerRepaint?.();
    };
    sweep.finish = finish;

    let worker;
    try {
      worker = new Worker(new URL("./vnext/ownershipTransitionWorker.js", import.meta.url), { type: "module" });
    } catch (error) {
      console.warn("Ownership transition worker unavailable; applying canonical presentation immediately:", error);
      finish();
      return;
    }
    sweep.worker = worker;
    const requestId = `${Date.now()}:${token}`;
    sweep.timeout = setTimeout(() => {
      if (token !== ownershipSweepRef.current.token) return;
      console.warn(
        `Ownership flood preparation exceeded ${OWNERSHIP_FLOOD_PREP_BUDGET_MS} ms; applying canonical presentation immediately.`,
      );
      finish();
    }, OWNERSHIP_FLOOD_PREP_BUDGET_MS);

    let fallbackSweepRequested = false;
    const requestLegacySweep = (reason = "") => {
      if (fallbackSweepRequested || token !== ownershipSweepRef.current.token) return;
      fallbackSweepRequested = true;
      if (sweep.timeout) clearTimeout(sweep.timeout);
      sweep.timeout = setTimeout(() => {
        if (token !== ownershipSweepRef.current.token) return;
        console.warn("Ownership sweep fallback timed out; applying canonical presentation immediately.");
        finish();
      }, 900);
      if (reason) console.warn("Ownership flood unavailable; using directional sweep fallback:", reason);
      worker.postMessage({
        type: "slice-ownership-transition",
        requestId,
        features: enrichedFeatures,
      });
    };

    worker.onmessage = ({ data }) => {
      if (token !== ownershipSweepRef.current.token || data?.requestId !== requestId) return;
      // No style (a lost WebGL context): nothing to animate on. The restore
      // finishes the sweep without it.
      if (!mapInstance.style) return;
      if (data?.type === "ownership-transition-error") {
        if (!fallbackSweepRequested) {
          requestLegacySweep(data.error);
          return;
        }
        console.warn("Ownership transition geometry failed; applying canonical presentation immediately:", data.error);
        finish();
        return;
      }

      if (data?.type === "ownership-transition-flood") {
        const fields = Array.isArray(data.fields) ? data.fields : [];
        if (!fields.length) {
          requestLegacySweep("flood worker produced no fields");
          return;
        }
        if (fields.length > MAX_ACTIVE_OWNERSHIP_FLOOD_FIELDS) {
          requestLegacySweep(`flood field budget exceeded (${fields.length} > ${MAX_ACTIVE_OWNERSHIP_FLOOD_FIELDS})`);
          return;
        }

        let floodLayer = sweep.floodLayer;
        try {
          if (!mapInstance.getLayer?.(OWNERSHIP_FLOOD_LAYER_ID)) {
            floodLayer = createOwnershipFloodCustomLayer({
              onError: (error) => console.warn("Ownership flood custom layer failed:", error),
            });
            const beforeId = mapInstance.getLayer?.("polity-boundaries-shadow")
              ? "polity-boundaries-shadow"
              : undefined;
            mapInstance.addLayer(floodLayer, beforeId);
            sweep.floodLayer = floodLayer;
          }
          enforceMapLayerOrder(mapInstance);
        } catch (error) {
          requestLegacySweep(error);
          return;
        }

        if (!floodLayer?._program || typeof floodLayer.startTransition !== "function") {
          requestLegacySweep("custom WebGL flood layer did not initialize");
          return;
        }

        if (sweep.timeout) clearTimeout(sweep.timeout);
        sweep.timeout = 0;
        globalThis.__OH_MAP_SOURCE_PERF__ = {
          ...(globalThis.__OH_MAP_SOURCE_PERF__ ?? {}),
          ownershipTransitionFloodMs: Number(data.elapsedMs ?? 0),
          ownershipTransitionRegionCount: sweep.regionIds.length,
          ownershipTransitionFloodFieldCount: fields.length,
          ownershipTransitionDirectionBasis: enrichedFeatures.map(
            (feature) => feature?.properties?.sweepBasis ?? "",
          ),
        };

        floodLayer.startTransition({ fields }, {
          onReady: () => {
            if (token !== ownershipSweepRef.current.token) return;
            // Keep the worker alive until the first flood texture has actually
            // reached the GPU. If texture/materialization fails before this
            // point, the same worker can still build the known-good strip sweep.
            worker.terminate();
            if (sweep.worker === worker) sweep.worker = null;
            // The custom layer now contains a complete OLD-colour mask. Only
            // after that first GPU draw do we hide the base political region,
            // so canonical state can never flash through ahead of the flood.
            setBaseHidden(true);
            mapInstance.triggerRepaint?.();
          },
          onComplete: () => {
            if (token !== ownershipSweepRef.current.token) return;
            finish();
          },
          onError: (error) => {
            if (token !== ownershipSweepRef.current.token) return;
            try { floodLayer.clearTransition?.(); } catch {}
            if (sweep.worker === worker && !fallbackSweepRequested) {
              requestLegacySweep(error);
              return;
            }
            console.warn("Ownership flood render failed after start; applying canonical presentation immediately:", error);
            finish();
          },
        });
        mapInstance.triggerRepaint?.();
        return;
      }

      if (data?.type !== "ownership-transition-slices") return;
      if (sweep.timeout) clearTimeout(sweep.timeout);
      sweep.timeout = 0;
      worker.terminate();
      sweep.worker = null;
      const sliceData = data.data?.features?.length ? data.data : EMPTY_FEATURE_COLLECTION;
      if (!sliceData.features.length) {
        finish();
        return;
      }
      setOwnershipTransitionSlices(sliceData);
      globalThis.__OH_MAP_SOURCE_PERF__ = {
        ...(globalThis.__OH_MAP_SOURCE_PERF__ ?? {}),
        ownershipTransitionSliceMs: Number(data.elapsedMs ?? 0),
        ownershipTransitionRegionCount: sweep.regionIds.length,
        ownershipTransitionSliceCount: sliceData.features.length,
        ownershipTransitionDirectionBasis: enrichedFeatures.map(
          (feature) => feature?.properties?.sweepBasis ?? "",
        ),
      };

      const waitForLayer = () => {
        if (token !== ownershipSweepRef.current.token || !mapInstance.style) return;
        const sourceReady = mapInstance.getSource?.("ownership-transition-sweep-source");
        const layerReady = mapInstance.getLayer?.("ownership-transition-sweep-fill");
        if (!sourceReady || !layerReady) {
          sweep.waitFrame = requestAnimationFrame(waitForLayer);
          return;
        }

        try {
          // React owns the resting empty source, but the animation is imperative.
          // Push this exact slice payload BEFORE hiding the previous base colour,
          // so worker/source scheduling can never expose the target state early.
          sourceReady.setData?.(sliceData);
          enforceMapLayerOrder(mapInstance);
          mapInstance.setPaintProperty("ownership-transition-sweep-fill", "fill-opacity", POLITICAL_FILL_OPACITY);
          mapInstance.setPaintProperty(
            "ownership-transition-sweep-fill",
            "fill-color",
            ["get", "fromColor"],
          );
        } catch {
          finish();
          return;
        }

        // Only now that an exact old-colour overlay exists do we hide the base.
        // Until this line the player has continued to see the untouched OLD
        // political presentation even though canonical state already advanced.
        setBaseHidden(true);
        mapInstance.triggerRepaint?.();

        const startedAt = performance.now();
        const durationMs = 680;
        let lastStep = -1;
        const animate = (now) => {
          if (token !== ownershipSweepRef.current.token) return;
          const progress = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
          const step = Math.min(24, Math.floor(progress * 24));
          if (step !== lastStep) {
            lastStep = step;
            const threshold = step / 24;
            try {
              mapInstance.setPaintProperty(
                "ownership-transition-sweep-fill",
                "fill-color",
                [
                  "case",
                  ["<=", ["get", "transitionT"], threshold],
                  ["get", "toColor"],
                  ["get", "fromColor"],
                ],
              );
            } catch {
              finish();
              return;
            }
          }
          if (progress >= 1) {
            finish();
            return;
          }
          sweep.frame = requestAnimationFrame(animate);
        };
        sweep.frame = requestAnimationFrame(animate);
      };
      sweep.waitFrame = requestAnimationFrame(waitForLayer);
    };
    worker.onerror = (error) => {
      if (token !== ownershipSweepRef.current.token) return;
      console.warn("Ownership transition worker failed; applying canonical presentation immediately:", error);
      finish();
    };
    const requestedMode = typeof window !== "undefined"
      ? String(window.localStorage?.getItem?.("openhistoria:ownershipTransitionMode") ?? "").trim().toLowerCase()
      : "";
    const floodVertexCount = enrichedFeatures.reduce(
      (sum, feature) => sum + ownershipTransitionVertexCount(feature?.geometry),
      0,
    );
    const floodEligible = requestedMode !== "sweep"
      && enrichedFeatures.length <= MAX_ACTIVE_OWNERSHIP_FLOOD_FIELDS
      && floodVertexCount <= OWNERSHIP_FLOOD_MAX_VERTEX_COUNT;

    if (!floodEligible && requestedMode !== "sweep") {
      // Do not spend hundreds of milliseconds proving that a cosmetic flood is
      // too large. The already-live directional sweep is our bounded fallback.
      requestLegacySweep(
        enrichedFeatures.length > MAX_ACTIVE_OWNERSHIP_FLOOD_FIELDS
          ? `region budget exceeded (${enrichedFeatures.length} > ${MAX_ACTIVE_OWNERSHIP_FLOOD_FIELDS})`
          : `geometry budget exceeded (${floodVertexCount} > ${OWNERSHIP_FLOOD_MAX_VERTEX_COUNT} vertices)`,
      );
    } else {
      worker.postMessage({
        type: requestedMode === "sweep" ? "slice-ownership-transition" : "build-ownership-flood",
        requestId,
        features: enrichedFeatures,
      });
    }
  }, [
    customActive,
    map,
    ownerColorCss,
    ownershipPresentation,
    ownershipTransitionQueueEpoch,
    publishOwnershipPresentation,
    repairedRegionIdSet,
  ]);

  useEffect(() => () => {
    const sweep = ownershipSweepRef.current;
    sweep.token += 1;
    sweep.worker?.terminate?.();
    if (sweep.frame) cancelAnimationFrame(sweep.frame);
    if (sweep.waitFrame) cancelAnimationFrame(sweep.waitFrame);
    if (sweep.timeout) clearTimeout(sweep.timeout);
    try { sweep.floodLayer?.clearTransition?.(); } catch {}
    const mapInstance = map?.getMap ? map.getMap() : map;
    try {
      if (mapInstance?.getLayer?.(OWNERSHIP_FLOOD_LAYER_ID)) mapInstance.removeLayer(OWNERSHIP_FLOOD_LAYER_ID);
    } catch {}
    sweep.floodLayer = null;
    sweep.active = false;
    ownershipPresentation.reset({ releaseHolds: false });
  }, [map, ownershipPresentation]);


  // Detailed PMTiles previously evaluated a region-id match table containing
  // thousands of entries on every rendered frame. Store the resolved colour on
  // each promoted GID_1 feature instead, and only touch feature-state when the
  // canonical ownership colour actually changes.
  const authoredRegionIds = useMemo(
    () => new Set(
      (customRegionMeta.records ?? [])
        .filter((record) => record?.authored === true)
        .map((record) => String(record?.id ?? ""))
        .filter(Boolean),
    ),
    [customRegionMeta.records],
  );
  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!shouldMountStockRegions || !mapInstance?.setFeatureState) return undefined;

    let cancelled = false;
    let retryFrame = 0;
    let workFrame = 0;

    const begin = () => {
      if (cancelled) return;
      if (!mapInstance.style || !mapInstance.getSource?.("regions-source")) {
        retryFrame = requestAnimationFrame(begin);
        return;
      }

      const applyStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      const edited = new Set(editedStockIds);
      const next = new Map();

      for (const [regionId, owner] of ownerByRegionId) {
        // Unknown-to-the-seed override ids are intentionally attempted here: in
        // a hybrid world they may be legitimate stock PMTiles regions omitted
        // from regions.geojson. Setting feature-state for a non-existent tile id
        // is harmless; dropping a real stock id recreates the historical hole.
        if (authoredRegionIds.has(regionId) || edited.has(regionId)) continue;
        next.set(regionId, owner ? ownerColorCss(owner) : NEUTRAL_LAND_COLOR);
      }

      const applied = appliedTileFillStateRef.current;
      const held = ownershipPresentation.holds;
      const operations = [];

      for (const [regionId, fillColor] of next) {
        if (held.has(regionId) || applied.get(regionId) === fillColor) continue;
        operations.push({ kind: "set", regionId, fillColor });
      }

      for (const regionId of applied.keys()) {
        if (held.has(regionId) || next.has(regionId)) continue;
        operations.push({ kind: "remove", regionId });
      }

      // Small ownership changes should remain immediate. Initial scenario load can
      // involve several thousand feature-state writes; split that work into tiny
      // frame-budgeted slices so it cannot monopolize pointer input for seconds.
      const appliedAfterSync = new Map(applied);
      let cursor = 0;
      const applySlice = () => {
        if (cancelled || !mapInstance.style) return;
        const sliceStart = typeof performance !== "undefined" ? performance.now() : Date.now();
        let processed = 0;

        while (cursor < operations.length) {
          const op = operations[cursor++];
          if (op.kind === "set") {
            mapInstance.setFeatureState(
              { source: "regions-source", sourceLayer: "regions", id: op.regionId },
              { fillColor: op.fillColor },
            );
            appliedAfterSync.set(op.regionId, op.fillColor);
          } else {
            mapInstance.removeFeatureState?.(
              { source: "regions-source", sourceLayer: "regions", id: op.regionId },
              "fillColor",
            );
            appliedAfterSync.delete(op.regionId);
          }

          processed += 1;
          const now = typeof performance !== "undefined" ? performance.now() : Date.now();
          if (processed >= 180 || now - sliceStart >= 4.5) break;
        }

        if (cursor < operations.length) {
          workFrame = requestAnimationFrame(applySlice);
          return;
        }

        if (appliedTileFillStateRef.current === applied) appliedTileFillStateRef.current = appliedAfterSync;
        const applyElapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - applyStartedAt;
        reportPerfOperation("map feature-state ownership sync", applyElapsed, { warnAt: PERF_MAP_WARN_MS });
        recordMapWork("Nations:feature-state-sync", applyElapsed, { operations: operations.length });
      };

      if (operations.length <= 180) {
        applySlice();
      } else {
        workFrame = requestAnimationFrame(applySlice);
      }
    };

    begin();

    return () => {
      cancelled = true;
      if (retryFrame) cancelAnimationFrame(retryFrame);
      if (workFrame) cancelAnimationFrame(workFrame);
    };
  }, [authoredRegionIds, map, ownerByRegionId, editedStockIds, ownerColorCss, ownershipPresentation.holds, ownershipPresentationHoldEpoch, shouldMountStockRegions, tileFillSourceEpoch]);

  // Region types (runtime/regionTypes.js): the fill colour, opacity, border and
  // zoom range a scenario gives a kind of region, written as feature-state
  // beside the owner's fillColor on every source that draws the region (the
  // paint reads them through regionTypePaint.js). Only regions of a type that
  // draws differently from Land are written, so a map without such types
  // writes nothing. A region's opacity follows whether it is owned, and a
  // banded type is rewritten only when the zoom crosses one of its bands.
  const regionTypeStyles = useMemo(() => regionTypeRenderStyles(regionTypes), [regionTypes]);
  const typedRegionStyles = useMemo(() => {
    const typed = new Map();
    if (!regionTypeStyles.size) return typed;
    for (const record of customRegionMeta.records ?? []) {
      const id = String(record?.id ?? "");
      const style = regionTypeStyles.get(String(record?.typeId ?? ""));
      if (id && style) typed.set(id, style);
    }
    return typed;
  }, [customRegionMeta.records, regionTypeStyles]);
  const [regionTypeZoom, setRegionTypeZoom] = useState("");
  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!mapInstance?.on || !regionTypeStyles.size) return undefined;
    const update = () => setRegionTypeZoom(regionTypeZoomKey(regionTypeStyles, mapInstance.getZoom()));
    update();
    mapInstance.on("zoom", update);
    return () => mapInstance.off("zoom", update);
  }, [map, regionTypeStyles]);
  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!mapInstance?.setFeatureState) return undefined;
    const ledger = appliedRegionTypeStateRef.current;
    const epoch = `${customFillSourceEpoch}:${tileFillSourceEpoch}`;
    if (ledger.epoch !== epoch) {
      ledger.epoch = epoch;
      ledger.written = new Map();
    }
    if (!typedRegionStyles.size && !ledger.written.size) return undefined;

    let cancelled = false;
    let frame = 0;
    const begin = () => {
      if (cancelled) return;
      // No style (a lost WebGL context) or no regions source yet waits a frame.
      // So do the stock tiles once they are to be mounted: nothing else reruns
      // this when they arrive, and at close zoom they draw a re-ownership map.
      if (
        !mapInstance.style
        || (customFlag && !mapInstance.getSource?.("custom-regions-source"))
        || (shouldMountStockRegions && !mapInstance.getSource?.("regions-source"))
      ) {
        frame = requestAnimationFrame(begin);
        return;
      }
      const hasCustom = Boolean(mapInstance.getSource("custom-regions-source"));
      const hasRepair = Boolean(mapInstance.getSource("custom-regions-repair-source"));
      const hasTiles = Boolean(mapInstance.getSource("regions-source"));
      const zoom = mapInstance.getZoom();
      const operations = [];
      const plan = (id, style) => {
        const targets = [
          ...(hasCustom ? [{ source: "custom-regions-source", id }] : []),
          ...(hasRepair && repairedRegionIdSet.has(id) ? [{ source: "custom-regions-repair-source", id }] : []),
          ...(hasTiles ? [{ source: "regions-source", sourceLayer: "regions", id }] : []),
        ];
        const state = regionTypeFeatureState(style, { owned: Boolean(ownerByRegionId.get(id)), zoom });
        const signature = `${JSON.stringify(state)}|${targets.map((target) => target.source).join(",")}`;
        if (ledger.written.get(id) === signature) return;
        operations.push({ id, style, targets, state, signature });
      };
      for (const [id, style] of typedRegionStyles) plan(id, style);
      // A region whose type no longer draws differently goes back to the game's own look.
      for (const id of ledger.written.keys()) if (!typedRegionStyles.has(id)) plan(id, null);

      // A sea of typed regions is written a slice a frame, like the fills above.
      let cursor = 0;
      const applySlice = () => {
        if (cancelled || !mapInstance.style) return;
        const until = cursor + 400;
        while (cursor < operations.length && cursor < until) {
          const op = operations[cursor++];
          for (const target of op.targets) mapInstance.setFeatureState(target, op.state);
          if (op.style) ledger.written.set(op.id, op.signature);
          else ledger.written.delete(op.id);
        }
        if (cursor < operations.length) frame = requestAnimationFrame(applySlice);
      };
      applySlice();
    };
    begin();
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
    };
  }, [customFillSourceEpoch, customFlag, map, ownerByRegionId, regionTypeZoom, repairedRegionIdSet, shouldMountStockRegions, tileFillSourceEpoch, typedRegionStyles]);

  const stockRegionsFillPaint = useMemo(
    () => customActive
      ? {
          "fill-color": DETAIL_FILL_COLOR,
          "fill-opacity": POLITICAL_FILL_OPACITY,
          "fill-antialias": false,
          "fill-outline-color": DETAIL_FILL_COLOR,
        }
      : { "fill-opacity": 0 },
    [customActive],
  );
  const transitionAwareFillOpacity = useMemo(() => (customFlag
    ? buildPoliticalFillOpacity([
        "boolean",
        ["feature-state", "ownershipTransitionHidden"],
        false,
      ])
    : 0), [customFlag]);
  const customFarFillOpacity = transitionAwareFillOpacity;
  const customAuthoredFillOpacity = transitionAwareFillOpacity;

  // Scenario geometry owns its grid; never stack stock outlines on top of it.
  // Both paths use the same close-zoom hairline policy, and stay hidden until
  // the world is known. Political frontiers remain visible independently.
  const regionsOutlinePaint = buildProvinceOutlinePaint(worldKnown && !customActive);

  // Scenario-authored label styling (world.labelFont/labelTextColor/
  // labelHaloColor). The style has no glyphs endpoint, so MapLibre v5 draws
  // every glyph locally with this stack as a CSS font-family — any font on the
  // PLAYER's machine works, with the trailing names as fallbacks where the
  // first is not installed.
  const labelFontStack = useMemo(
    // Political labels read like atlas typography rather than delicate
    // annotations. Georgia is a heavier default on Windows; an authored scenario
    // font wins over it, and the player's own Settings > Map override wins over
    // both - it is the one setting whose whole purpose is to overrule what the
    // author picked.
    () => [labelFontOverride || labelFont || "Georgia", "Georgia", "Times New Roman", "Palatino Linotype", "serif"],
    [labelFont, labelFontOverride],
  );

  // PTR-1.7 consumes every canonical worker polity record regardless of the
  // scenario's naming scheme. It becomes authoritative only after its custom
  // layer has mounted successfully; until then the legacy MapLibre labels are
  // allowed to act as a last-resort initialization/failure fallback.

  const pointLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "name"],
    "text-font": labelFontStack,
    "text-size": buildCountryTextSize(0.72, isGlobe),
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": false,
    "text-letter-spacing": ["coalesce", ["get", "letterSpacing"], 0.12],
    "text-max-width": 100,
    "text-padding": 6,
    "symbol-sort-key": ["-", ["coalesce", ["get", "priorityScale"], ["get", "areaScale"]]],
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
    visibility: mapDisplaySettings.hideCountryLabels ? "none" : "visible",
  }), [isGlobe, labelFontStack, mapDisplaySettings.hideCountryLabels]);

  const curvedLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "glyph"],
    "text-font": labelFontStack,
    "text-size": buildCountryTextSize(0.78, isGlobe),
    "text-rotate": ["get", "rotation"],
    "text-offset": ["coalesce", ["get", "textOffset"], ["literal", [0, 0]]],
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-ignore-placement": true,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
    visibility: mapDisplaySettings.hideCountryLabels ? "none" : "visible",
  }), [isGlobe, labelFontStack, mapDisplaySettings.hideCountryLabels]);

  const livePointLabelLayerLayout = useMemo(() => ({
    ...pointLabelLayerLayout,
    // fitScale is solved from the actual territory width + name width at z4;
    // it then scales with the map at the same 2^zoom rate as the geometry.
    "text-size": buildCountryTextSize(1, isGlobe, "fitScale"),
    "text-letter-spacing": ["coalesce", ["get", "letterSpacing"], 0.18],
    "text-allow-overlap": false,
    // Important tiers may still opt into overlap, but every placed polity label
    // now reserves collision space. R3 used ignore-placement=true, which let the
    // Balkans/microstates pile on top of one another at regional zoom.
    "text-ignore-placement": false,
    "text-padding": 2,
  }), [isGlobe, pointLabelLayerLayout]);

  const liveLineLabelLayerLayout = useMemo(() => ({
    "symbol-placement": "line-center",
    "text-field": ["get", "name"],
    "text-font": labelFontStack,
    // Unlike R1, fitScale is the TARGET territory occupancy, not an area-based
    // size that is merely capped by the spine. This is what makes RUSSIA stretch.
    "text-size": buildCountryTextSize(1, isGlobe, "fitScale"),
    "text-letter-spacing": ["coalesce", ["get", "letterSpacing"], 0.18],
    // Atlas-like warping should follow a territory, not corkscrew through it.
    // A moderate max-angle keeps long labels visibly shaped by the polity while
    // rejecting the extreme bends that previously made Bosnia-like cases ugly.
    "text-max-angle": 48,
    "text-padding": 1,
    "text-allow-overlap": false,
    "text-ignore-placement": false,
    "symbol-sort-key": ["-", ["coalesce", ["get", "visibilityScale"], ["get", "priorityScale"]]],
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": true,
    visibility: mapDisplaySettings.hideCountryLabels ? "none" : "visible",
  }), [isGlobe, labelFontStack, mapDisplaySettings.hideCountryLabels]);

  const labelPaintBase = useMemo(() => ({
    "text-color": labelTextColor || "rgba(247, 246, 240, 0.98)",
    "text-halo-color": labelHaloColor || "rgba(7, 10, 14, 0.92)",
    "text-halo-width": 1.1,
    "text-halo-blur": 0.32,
  }), [labelHaloColor, labelTextColor]);
  // Every opacity below is keyed to its layer's own text-size: the multiplier and
  // scale property must match the layout's buildCountryTextSize call.
  const pointLabelLayerPaint = useMemo(() => ({
    ...labelPaintBase,
    "text-opacity": buildCountryTextOpacity(STOCK_LABEL_RAMP, 0.72, isGlobe),
  }), [isGlobe, labelPaintBase]);
  const curvedStockLabelLayerPaint = useMemo(() => ({
    ...labelPaintBase,
    "text-opacity": buildCountryTextOpacity(STOCK_LABEL_RAMP, 0.78, isGlobe),
  }), [isGlobe, labelPaintBase]);
  const curvedLabelLayerPaint = useMemo(() => ({
    ...labelPaintBase,
    "text-opacity": buildCountryTextOpacity(CUSTOM_CURVED_LABEL_RAMP, 0.78, isGlobe),
  }), [isGlobe, labelPaintBase]);
  const integratedLabelLayerPaint = useMemo(() => ({
    // Stronger atlas treatment: the polity name is a primary political layer,
    // not a faint annotation. Keep a crisp dark edge so large white serif text
    // survives both pale and saturated polity fills, as a printed atlas's does.
    "text-color": labelTextColor || "rgba(250, 249, 244, 0.995)",
    "text-halo-color": labelHaloColor || "rgba(4, 6, 9, 0.96)",
    "text-halo-width": 1.62,
    "text-halo-blur": 0.20,
    // The live line and point layers both size 1 × fitScale.
    "text-opacity": buildCountryTextOpacity(LIVE_LABEL_RAMP, 1, isGlobe, "fitScale"),
  }), [isGlobe, labelHaloColor, labelTextColor]);

  return (
    <>
      {/* maxzoom 8, not the archive's 10, because 8 is what the editor can
          actually author against. z10 cannot be stitched into a seed at all —
          extract-regions.mjs completes and then dies in JSON.stringify, over V8's
          512MB max string length. z9 stitches, but 4.1M vertices then ran the
          editor's tab out of heap: Chrome killed the renderer with "Aw, Snap"
          while the machine still had 3GB free, because the cap is per-renderer.
          z8's 2.6M is stable. Rendering finer than the editor can edit only draws
          detail no map can be built against. Past z8 MapLibre overzooms, exactly
          as it already did past z10.

          Mounted on a custom map too, whenever its region ids match the tiles
          (regionTileHandoffSafe) — this source is not decoration on a custom
          map, it is the close-detail political layer for re-ownership
          scenarios. The seed GeoJSON now stays underneath as a fallback if a
          vector tile is late, while regions-fill sharpens the map once the tile
          is present. Keeping this source mounted also preserves high-zoom
          hit-testing and the stock-region hairlines. */}
      {shouldMountStockRegions && (
      <Source id="regions-source" type="vector" url={regionsUrl} maxzoom={8} promoteId="GID_1">
        <Layer
          id="regions-fill"
          type="fill"
          minzoom={STOCK_REGION_HANDOFF_ZOOM}
          source-layer="regions"
          beforeId={hasMapLayer("polity-boundaries-shadow") ? "polity-boundaries-shadow" : undefined}
          filter={stockRegionsVisibilityFilter}
          paint={stockRegionsFillPaint}
        />
        {/* Striped fill for disputed GADM regions on the crisp tile geometry —
            fades in with the tile fills, exactly like the color layer above. */}
        {disputedTileStops.length > 0 && (
          <Layer
            id="regions-disputed"
            type="fill"
            minzoom={STOCK_REGION_HANDOFF_ZOOM}
            source-layer="regions"
            beforeId={hasMapLayer("regions-outline") ? "regions-outline" : undefined}
            filter={[
              "all",
              ["in", ["get", "GID_1"], ["literal", disputedTileStops.filter((_, i) => i % 2 === 0)]],
              stockRegionsVisibilityFilter,
            ]}
            paint={{
              "fill-pattern": ["match", ["get", "GID_1"], ...disputedTileStops, disputedTileStops[1]],
              "fill-opacity": customActive && worldKnown ? DISPUTED_TILE_FILL_OPACITY : 0,
            }}
          />
        )}
        <Layer
          id="regions-outline"
          type="line"
          minzoom={PROVINCE_OUTLINE_MIN_ZOOM}
          source-layer="regions"
          beforeId={hasMapLayer("polity-boundaries-shadow") ? "polity-boundaries-shadow" : undefined}
          filter={stockRegionsVisibilityFilter}
          paint={regionsOutlinePaint}
        />
      </Source>
      )}

      {/* Canonical region ids/ownership remain authoritative. The worker may
          publish a SMALL repair collection for only demonstrably malformed
          features; those exact ids are filtered out here and drawn from the
          repaired presentation source below. Clean scenario geometry is never
          rebuilt or replaced. */}
      {customFlag && (
      <Source
        id="custom-regions-source"
        type="geojson"
        data={regionsGeojsonFetchUrl || EMPTY_FEATURE_COLLECTION}
        promoteId="id"
        tolerance={0.001}
      >
        {/* Clean canonical features render directly from the scenario source.
            Only ids present in the targeted repair collection are filtered out
            here; their presentation geometry is drawn by the tiny source below. */}
        <Layer
          id="custom-regions-fill-far"
          type="fill"
          maxzoom={!regionTileHandoffSafe ? undefined : STOCK_REGION_HANDOFF_ZOOM}
          beforeId={shouldMountStockRegions
            ? "regions-fill"
            : hasMapLayer("polity-boundaries-shadow")
              ? "polity-boundaries-shadow"
              : undefined}
          filter={canonicalCustomFarStockGeometryFilter}
          paint={{
            "fill-color": CUSTOM_FILL_COLOR,
            "fill-opacity": customFarFillOpacity,
            "fill-antialias": false,
            "fill-outline-color": CUSTOM_FILL_COLOR,
          }}
        />
        <Layer
          id="custom-regions-fill"
          type="fill"
          beforeId={hasMapLayer("polity-boundaries-shadow") ? "polity-boundaries-shadow" : undefined}
          filter={canonicalCustomAuthoritativeGeometryFilter}
          paint={{
            "fill-color": CUSTOM_FILL_COLOR,
            "fill-opacity": customAuthoredFillOpacity,
            "fill-antialias": false,
            "fill-outline-color": CUSTOM_FILL_COLOR,
          }}
        />
        {/* Only the province strokes disappear at overview zoom. Keep the
            source and fills mounted so province selection still works. */}
        <Layer
          id="custom-regions-local-outline"
          type="line"
          minzoom={PROVINCE_OUTLINE_MIN_ZOOM}
          beforeId={hasMapLayer("polity-boundaries-shadow") ? "polity-boundaries-shadow" : undefined}
          filter={unrepairedRegionFilter}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={buildProvinceOutlinePaint(customActive && worldKnown)}
        />
      </Source>
      )}

      {customFlag && activeRegionRenderRepair.data.features.length > 0 && (
      <Source
        id="custom-regions-repair-source"
        type="geojson"
        data={activeRegionRenderRepair.data}
        promoteId="id"
        tolerance={0.001}
      >
        <Layer
          id="custom-regions-repair-fill-far"
          type="fill"
          maxzoom={!regionTileHandoffSafe ? undefined : STOCK_REGION_HANDOFF_ZOOM}
          beforeId={shouldMountStockRegions
            ? "regions-fill"
            : hasMapLayer("polity-boundaries-shadow")
              ? "polity-boundaries-shadow"
              : undefined}
          filter={customFarStockGeometryFilter}
          paint={{
            "fill-color": CUSTOM_FILL_COLOR,
            "fill-opacity": customFarFillOpacity,
            "fill-antialias": false,
            "fill-outline-color": CUSTOM_FILL_COLOR,
          }}
        />
        <Layer
          id="custom-regions-repair-fill"
          type="fill"
          beforeId={hasMapLayer("polity-boundaries-shadow") ? "polity-boundaries-shadow" : undefined}
          filter={customAuthoritativeGeometryFilter}
          paint={{
            "fill-color": CUSTOM_FILL_COLOR,
            "fill-opacity": customAuthoredFillOpacity,
            "fill-antialias": false,
            "fill-outline-color": CUSTOM_FILL_COLOR,
          }}
        />
        <Layer
          id="custom-regions-repair-local-outline"
          type="line"
          minzoom={PROVINCE_OUTLINE_MIN_ZOOM}
          beforeId={hasMapLayer("polity-boundaries-shadow") ? "polity-boundaries-shadow" : undefined}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={buildProvinceOutlinePaint(customActive && worldKnown)}
        />
      </Source>
      )}

      {customFlag && (
      <Source
        id="ownership-transition-sweep-source"
        type="geojson"
        data={ownershipTransitionSlices}
        promoteId="id"
        tolerance={0.001}
      >
        <Layer
          id="ownership-transition-sweep-fill"
          type="fill"
          beforeId={hasMapLayer("polity-boundaries-shadow") ? "polity-boundaries-shadow" : undefined}
          paint={{
            "fill-color": ["get", "fromColor"],
            "fill-opacity": 0,
            "fill-antialias": false,
          }}
        />
      </Source>
      )}

      {enrichedDisputedRegionData.features.length > 0 && (
        <Source id="custom-regions-disputed-source" type="geojson" data={enrichedDisputedRegionData} tolerance={0.6}>
          <Layer
            id="custom-regions-disputed-vnext"
            type="fill"
            beforeId={hasMapLayer("polity-boundaries-shadow") ? "polity-boundaries-shadow" : undefined}
            filter={["has", "_stripes"]}
            paint={{
              "fill-pattern": ["get", "_stripes"],
              "fill-opacity": customActive && worldKnown ? DISPUTED_STRIPE_OPACITY : 0,
            }}
          />
        </Source>
      )}

      <GroupAreaLayers data={groupAreaData} visible={Boolean(customActive && worldKnown && groupsOn)} hasMapLayer={hasMapLayer} />

      <Source id="polity-boundaries-source" type="geojson" data={EMPTY_FEATURE_COLLECTION} tolerance={0.25}>
        <Layer
          id="polity-boundaries-shadow"
          type="line"
          filter={visibleBoundaryFilter}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{
            "line-color": "rgba(1, 4, 8, 0.72)",
            "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.8, 3, 2.5, 6, 3.6, 9, 4.7, 12, 5.8],
            "line-blur": ["interpolate", ["linear"], ["zoom"], 1, 0.7, 6, 1.15, 12, 1.5],
            "line-opacity": customActive && worldKnown ? 0.52 : 0,
          }}
        />
<Layer
          id="polity-boundaries"
          type="line"
          filter={visibleBoundaryFilter}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{
            "line-color": "rgba(5, 8, 13, 0.96)",
            "line-width": [
              "interpolate", ["linear"], ["zoom"],
              1, 0.58,
              3, 0.92,
              6, 1.34,
              9, 1.72,
              12, 2.08,
            ],
            "line-opacity": customActive && worldKnown ? 0.94 : 0,
          }}
        />
      </Source>

      <PolityTextLayer
        map={map}
        isGlobe={isGlobe}
        enabled={Boolean(
          ptr1PolityTextRequested
          || (
            ptr0PolityTextEnabled
            && !ptr1PolityTextEnabled
            && !mapDisplaySettings.hideCountryLabels
          )
        )}
        mode={ptr1PolityTextEnabled ? "ptr1" : "ptr0"}
        records={ptr1PolityTextEnabled ? ptr1PolityTextRecords : []}
        fontFamilies={labelFontStack}
        textColor={labelTextColor || "rgba(250, 249, 244, 0.995)"}
        haloColor={labelHaloColor || "rgba(4, 6, 9, 0.96)"}
        debugBaseline={ptr1PolityTextEnabled ? ptr1PolityTextDebugEnabled : true}
        onStatusChange={setPtrPolityTextStatus}
      />

      {/* Always empty now: every served world is a custom one (customRegions is
          forced on), and the stock modern-country labels that fed these two
          layers could never draw. The layers stay as the anchors other layers
          are placed under (beforeId, mapLayerOrder.js). */}
      <Source id="country-curved-label-source" type="geojson" data={EMPTY_FEATURE_COLLECTION}>
        <Layer
          id="country-curved-labels"
          type="symbol"
          minzoom={customFlag && useLivePolityLabels ? 3.85 : undefined}
          maxzoom={LABEL_MAX_ZOOM}
          layout={curvedLabelLayerLayout}
          paint={customFlag && useLivePolityLabels ? curvedLabelLayerPaint : curvedStockLabelLayerPaint}
        />
      </Source>

      {/*
          R5.0: same label geometry/policy, radically thinner renderer.
          The previous implementation expanded five tiers × multiple handoff
          bands into ~38 live country symbol layers. Current-zoom filtering now
          happens once in React after camera settle, leaving four constant
          MapLibre symbol layers and no motion-time visual degradation.
      */}
      <Source
        id="country-live-polity-line-label-source"
        type="geojson"
        data={rawLivePolityLineLabelData}
        // R5.4.5: label geometry is static vector cartography, not terrain.
        // Stop GeoJSON-VT at z3 and overzoom those stable source tiles above it.
        // This prevents Ukraine-class label spines from being re-clipped at
        // progressively finer tile boundaries as the camera zooms.
        maxzoom={3}
        buffer={256}
      >
        {customFlag && useLivePolityLabels && (
          <Layer
            id="country-line-labels-live-world"
            source="country-live-polity-line-label-source"
            type="symbol"
            maxzoom={LABEL_MAX_ZOOM}
            filter={liveWorldLineFilter}
            layout={{
              ...liveLineLabelLayerLayout,
              "text-max-angle": 38,
              "text-allow-overlap": true,
            }}
            paint={integratedLabelLayerPaint}
          />
        )}
        {customFlag && useLivePolityLabels && (
          <Layer
            id="country-line-labels-live-detail"
            source="country-live-polity-line-label-source"
            type="symbol"
            maxzoom={LABEL_MAX_ZOOM}
            filter={liveDetailLineFilter}
            layout={{
              ...liveLineLabelLayerLayout,
              "text-max-angle": 48,
              "text-allow-overlap": true,
            }}
            paint={integratedLabelLayerPaint}
          />
        )}
      </Source>

      <Source
        id="country-live-polity-point-label-source"
        type="geojson"
        data={rawLivePolityPointLabelData}
        // Point anchors are equally static. Keep them on the same fixed source
        // grid so zooming does not build another polity-label tile pyramid.
        maxzoom={3}
        buffer={256}
      >
        {customFlag && useLivePolityLabels && (
          <Layer
            id="country-labels-live-managed"
            source="country-live-polity-point-label-source"
            type="symbol"
            maxzoom={LABEL_MAX_ZOOM}
            filter={livePointManagedFilter}
            layout={{
              ...livePointLabelLayerLayout,
              "text-allow-overlap": false,
            }}
            paint={integratedLabelLayerPaint}
          />
        )}
        {customFlag && useLivePolityLabels && (
          <Layer
            id="country-labels-live-overlap"
            source="country-live-polity-point-label-source"
            type="symbol"
            maxzoom={LABEL_MAX_ZOOM}
            filter={livePointOverlapFilter}
            layout={{
              ...livePointLabelLayerLayout,
              // R5.4.6: this is a genuine guarantee layer. A failed curve must
              // not let a city/neighbor collision erase the polity fallback.
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            }}
            paint={integratedLabelLayerPaint}
          />
        )}
      </Source>

      <Source id="country-point-label-source" type="geojson" data={EMPTY_FEATURE_COLLECTION}>
        <Layer
          id="country-labels"
          type="symbol"
          maxzoom={LABEL_MAX_ZOOM}
          layout={pointLabelLayerLayout}
          paint={pointLabelLayerPaint}
        />
      </Source>
    </>
  );
};

export default WorldMap;
