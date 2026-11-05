import { useEffect, useMemo, useRef, useState } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import ImageLayer from "ol/layer/Image";
import ImageStatic from "ol/source/ImageStatic";
import VectorImageLayer from "ol/layer/VectorImage";
import VectorSource from "ol/source/Vector";
import Style from "ol/style/Style";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import GeoJSON from "ol/format/GeoJSON";
import { fromLonLat, transformExtent } from "ol/proj";
import { boundsFillSquare, normalizeImageBounds } from "../../../server/mapProjection.js";
import { crispWhenMagnified } from "../../Editor/crispWhenMagnified.js";
import { defaults as defaultControls } from "ol/control/defaults";
import { bundledFlagUrl, flagImageUrlFromGid, gidToAlpha2 } from "../../runtime/countryFlags.js";
import { loadRegionLabelGeometry } from "../../runtime/countryLabels.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { isBrowserOnline } from "../../runtime/networkStatus.js";
import { SCREEN_HEIGHT, isTouchPrimary, useCanHover, useTouchPrimary } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { createPickerHover } from "./countryPickerHover.js";

// Curated grand strategy atlas palette: muted, historical geopolitical tones.
// Eliminates neon rainbow clown colors in favor of rich, dignified atlas pigments.
const GRAND_STRATEGY_PALETTE = [
  [65, 105, 175],   // French Royal Blue
  [175, 55, 60],    // Imperial British Red
  [95, 135, 90],    // Russian Forest Green
  [195, 150, 60],   // Spanish Ochre
  [110, 115, 125],  // Prussian Slate
  [75, 135, 130],   // Nordic Teal
  [170, 90, 60],    // Terracotta
  [135, 75, 115],   // Vintage Burgundy
  [160, 140, 85],   // Habsburg Gold
  [80, 120, 155],   // Mediterranean Azure
  [110, 140, 90],   // Sage Green
  [180, 110, 75],   // Warm Sienna
  [70, 95, 145],    // Deep Cobalt
  [145, 65, 70],    // Crimson
  [125, 135, 100],  // Olive Drab
  [185, 130, 95],   // Desert Tan
  [85, 125, 110],   // Verdigris
  [145, 90, 135],   // Muted Damson
  [105, 125, 145],  // Steel Blue
  [165, 80, 65],    // Rust
  [90, 115, 80],    // Moss Green
  [175, 145, 105],  // Parchment Sand
  [75, 115, 140],   // Aegean Teal
  [140, 90, 85],    // Dusky Rose
  [115, 130, 70],   // Bohemian Olive
  [155, 115, 65],   // Amber
  [85, 100, 130],   // Navy Slate
  [135, 70, 95],    // Plum
  [100, 130, 115],  // Pine
  [165, 120, 80],   // Raw Umber
  [85, 110, 125],   // Storm Grey
  [150, 100, 110],  // Muted Coral
];

const fallbackColorFromCode = (code = "") => {
  const str = String(code || "");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 37 + str.charCodeAt(i)) >>> 0;
  }
  const [r, g, b] = GRAND_STRATEGY_PALETTE[hash % GRAND_STRATEGY_PALETTE.length];
  return `rgba(${r}, ${g}, ${b}, 0.78)`;
};

const resolveCountryColor = (option, palette) => {
  if (!option) return "rgba(160, 165, 175, 0.78)";
  const countryName = toCountryName(option.code) || option.name || option.code;
  const match = palette?.[countryName] || (option.name ? palette?.[option.name] : null) || (option.code ? palette?.[option.code] : null);
  if (match && Array.isArray(match)) {
    return `rgb(${match[0]}, ${match[1]}, ${match[2]})`;
  }
  return fallbackColorFromCode(countryName);
};

const resolveCountryFlag = (option) => {
  if (!option) return null;
  const direct = flagImageUrlFromGid(option.code) || (option.name ? flagImageUrlFromGid(option.name) : null);
  if (direct) return direct;
  const byAlpha2 = gidToAlpha2(option.code) || (option.name ? gidToAlpha2(option.name) : null);
  if (byAlpha2) return `https://flagcdn.com/${byAlpha2}.svg`;
  return null;
};

// "#rrggbb" + alpha -> an rgba() OL accepts. The faction's chosen colour is a hex
// string; region fills need it translucent so the dark basemap reads through.
const withAlpha = (hex, alpha) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return `#a1a1aa`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

// Repaint stock geometry with the scenario's owners. A re-ownership scenario
// (Fallout, WWII, Rome — anything that reassigns real regions instead of drawing
// its own map) ships no geometry of its own, so this map falls back to the modern
// Earth seed, whose features carry GADM owners: "DEU", "FRA", "GBR". Those match
// nothing in the scenario's playable set, so every region drew as unplayable AND
// the picker read as a map of present-day Europe in a post-apocalyptic scenario.
// world.regionOwnershipOverrides is the same region-id -> owner lookup the game
// map resolves through (see Nations.jsx ownerLookupRef); applying it here makes
// the picker agree with the world you are about to play.
const applyOwnerOverrides = (features, overrides) => {
  if (!overrides) return features;
  for (const feature of features) {
    const id = feature.getId();
    if (id == null) continue;
    const owner = overrides[String(id)];
    // "" is a real value — an explicitly unclaimed region — so only skip undefined.
    if (owner !== undefined) feature.set("owner", owner);
  }
  return features;
};

// The picker never zooms past 8, where a pixel is ~600 m: geometry finer
// than a couple of kilometres is invisible here and only costs the draw.
const PICKER_SIMPLIFY_TOLERANCE_M = 2000;

const parseGeoJSONFeatures = (geojson, { stock = false } = {}) => {
  const fmt = new GeoJSON();
  const features = fmt.readFeatures(geojson, {
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857",
  });
  for (const feature of features) {
    const props = feature.getProperties();
    if (props.id != null) feature.setId(String(props.id));
    // The stock tile carries the modern country as `owner`; resolve it from the
    // GADM code the way the seed did, so the playable set matches by name.
    if (stock) feature.set("owner", toCountryName(props.gid0) || props.owner || null);
    else if (feature.get("owner") == null) feature.set("owner", props.gid0 || props.owner || null);
    if (feature.get("typeId") == null) feature.set("typeId", "land");
    const geometry = feature.getGeometry();
    if (!stock && geometry?.simplify) feature.setGeometry(geometry.simplify(PICKER_SIMPLIFY_TOLERANCE_M));
  }
  return features;
};

// The ESRI Ocean basemap: provides realistic ocean bathymetry and shaded land relief.
const ESRI_OCEAN_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}";
// The whole Web Mercator world - where World.jsx pins an uploaded image
// (WORLD_IMAGE_COORDS_FLAT) - in this map's projection.
const WORLD_IMAGE_EXTENT = transformExtent([-180, -85.0511, 180, 85.0511], "EPSG:4326", "EPSG:3857");
// The sea under a custom map, the same as the game's (buildWorldStyle).
const CUSTOM_SEA = "#0b1a2b";

// What the regions are drawn over. A scenario with its own basemap gets that
// basemap, placed and coloured as the game map places it (World.jsx
// buildWorldStyle): an uploaded image stretched across the whole world, or the
// vector biomes each carrying its own `fill`. Every other scenario keeps the
// ESRI canvas, exactly as before.
const buildBaseLayer = (customBackground) => {
  // A plain sea: no tiles, as the game map draws such a scenario.
  if (customBackground?.kind === "plain") return new VectorImageLayer({ source: new VectorSource({ wrapX: false }) });
  if (customBackground?.kind === "image" && customBackground.imageUrl) {
    // On the scenario's own bounds when it states them, as the game map lays it.
    const bounds = normalizeImageBounds(customBackground.bounds);
    const imageExtent = bounds && !boundsFillSquare(bounds)
      ? transformExtent([bounds.west, bounds.south, bounds.east, bounds.north], "EPSG:4326", "EPSG:3857")
      : WORLD_IMAGE_EXTENT;
    return crispWhenMagnified(new ImageLayer({
      source: new ImageStatic({ url: customBackground.imageUrl, imageExtent, projection: "EPSG:3857" }),
    }), imageExtent, customBackground.imageUrl);
  }
  if (customBackground?.kind === "vector" && customBackground.geojson) {
    const features = new GeoJSON().readFeatures(customBackground.geojson, { featureProjection: "EPSG:3857" });
    return new VectorImageLayer({
      source: new VectorSource({ features, wrapX: false }),
      imageRatio: 2,
      style: (feature) => new Style({
        fill: new Fill({ color: feature.get("fill") || "#33435c" }),
        stroke: new Stroke({ color: "rgba(0,0,0,0.18)", width: 0.4 }),
      }),
    });
  }
  // No network at all: the game's bundled relief (public/offline-relief), dimmed
  // toward the dark canvas, instead of tile requests that can only fail.
  if (!isBrowserOnline()) {
    return new TileLayer({ source: new XYZ({ url: "/offline-relief/{z}/{y}/{x}.jpg", maxZoom: 3, wrapX: false }), opacity: 0.4 });
  }
  return new TileLayer({ source: new XYZ({ url: ESRI_OCEAN_TILES, maxZoom: 13, wrapX: false }), opacity: 0.6 });
};

// Whether the focus an element has is the keyboard's, the one drawn with a
// ring. A button pressed with the mouse takes the focus as well.
const hasKeyboardFocus = (element) => element.matches(":focus-visible");
const CountryPickerMap = ({
  countryOptions,
  onPickCountry,
  regionsGeojson,
  // world.regionOwnershipOverrides for the scenario being picked from: region id
  // -> owner. Required for scenarios that reassign stock geometry rather than
  // drawing their own — without it this renders present-day Earth. See
  // applyOwnerOverrides.
  ownerOverrides = null,
  // "country" (default): click a whole country to pick it — the new-game selector.
  // "regions": click regions to toggle them in/out of a selection — the faction
  // creator picking its starting territory. selectedRegionIds + onToggleRegion +
  // selectionColor drive it. Kept as one component so both share the OL map, the
  // seed load and the hover machinery.
  selectionMode = "country",
  selectedRegionIds = null,
  onToggleRegion = null,
  selectionColor = "#a1a1aa",
  // The scenario's own basemap, when it has one: { kind: "image", imageUrl } or
  // { kind: "vector", geojson } - world.background plus the background.json
  // payload, the same pair the game map reads through useCustomBackground.
  // Null means the scenario draws on ESRI, and so does this map.
  customBackground = null,
  onPickDefault = null,
  colors = null,
  playGameId = null,
}) => {
  const containerRef = useRef(null);
  const mapObjectRef = useRef(null);
  const baseLayerRef = useRef(null);
  const customBackgroundRef = useRef(customBackground);
  customBackgroundRef.current = customBackground;
  const layerRef = useRef(null);
  const sourceRef = useRef(null);
  // The country drawn highlighted: the one under the pointer on the map, or
  // the one whose row of the list is pointed at (countryPickerHover.js has who
  // wins). Made with the map, whose region layer it repaints.
  const hoverRef = useRef(null);
  const hoveredRegionRef = useRef(null);
  const playableCodesRef = useRef(new Set());
  const colorPaletteRef = useRef(null);
  const stockPaletteRef = useRef(null);
  const scenarioColorsRef = useRef(colors);
  useEffect(() => {
    scenarioColorsRef.current = colors;
    colorPaletteRef.current = { ...(stockPaletteRef.current || {}), ...(colors || {}) };
    layerRef.current?.changed();
  }, [colors]);
  useEffect(() => {
    let cancelled = false;
    fetch("/assets/colors.json")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data && typeof data === "object") {
          stockPaletteRef.current = data;
          colorPaletteRef.current = { ...data, ...(scenarioColorsRef.current || {}) };
          layerRef.current?.changed();
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [query, setQuery] = useState("");
  // A touch screen, where focus opens the keyboard (mobileUi.js: a phone can
  // report a fine pointer, and then the box focused itself and raised the
  // keyboard as the picker opened).
  const [touchFirst] = useState(() => isTouchPrimary());
  const isMobile = useIsMobile();
  const touch = useTouchPrimary();
  const canHover = useCanHover();
  // While a search is typed on a phone the map folds away and the matches sit
  // right under the box, above the keyboard. By the query, not by focus: a
  // blur as the finger lands on a match would move the list under it.
  const searching = isMobile && query.trim().length > 0;
  // Unfolded again, the map measures its box anew.
  useEffect(() => {
    if (!searching) mapObjectRef.current?.updateSize?.();
  }, [searching]);
  // Refs the once-created map's handlers read at click time — so switching mode or
  // toggling a region never rebuilds the map.
  const modeRef = useRef(selectionMode);
  modeRef.current = selectionMode;
  const onToggleRegionRef = useRef(onToggleRegion);
  onToggleRegionRef.current = onToggleRegion;
  const selectedRegionsRef = useRef(new Set());
  const selectionColorRef = useRef(selectionColor);
  selectionColorRef.current = selectionColor;
  useEffect(() => {
    selectedRegionsRef.current = selectedRegionIds instanceof Set
      ? selectedRegionIds
      : new Set(selectedRegionIds || []);
    if (layerRef.current) layerRef.current.changed();
  }, [selectedRegionIds]);

  playableCodesRef.current = useMemo(
    () => new Set(countryOptions.map((c) => c.code)),
    [countryOptions],
  );

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? countryOptions.filter((c) => `${c.name} ${c.code}`.toLowerCase().includes(q))
      : countryOptions;
  }, [countryOptions, query]);
  // The rows the list shows: the first few, and more of them once a search has
  // narrowed it.
  const rowLimit = query.trim() ? 30 : 12;
  const shownOptions = useMemo(() => filteredOptions.slice(0, rowLimit), [filteredOptions, rowLimit]);
  // A row taken away under the pointer (the search narrowing the list) gets no
  // mouseleave and no blur, so the hover is told which rows are left.
  useEffect(() => {
    hoverRef.current?.rowsShown(shownOptions.map((c) => c.code));
  }, [shownOptions]);

  // The scenario's basemap arrives after the map does (it is fetched once the
  // scenario's details are in), so the base layer is swapped in place rather
  // than the map rebuilt: same view, same regions, same hover state.
  useEffect(() => {
    const olMap = mapObjectRef.current;
    if (!olMap) return;
    const next = buildBaseLayer(customBackground);
    const layers = olMap.getLayers();
    if (baseLayerRef.current) layers.remove(baseLayerRef.current);
    layers.insertAt(0, next);
    baseLayerRef.current = next;
  }, [customBackground]);

  // One-time map + layer creation
  useEffect(() => {
    // wrapX:false, as the editor found the hard way (OlMap.jsx): the canvas
    // renderer otherwise repeats the world sideways and redraws EVERY region for
    // each copy, two or three times per frame at this zoom. VectorImage
    // rasterises the regions once and re-blits while panning; a hover or a pick
    // re-rasterises, which on the coarse geometry is cheap.
    const source = new VectorSource({ wrapX: false });
    const layer = new VectorImageLayer({
      source,
      imageRatio: 2,
      wrapX: false,
      renderBuffer: 128,
      updateWhileInteracting: false,
      updateWhileAnimating: false,
    });
    layerRef.current = layer;
    sourceRef.current = source;
    // A change of the highlighted country is one such re-rasterise, whether
    // the pointer is on the map or on a row of the list: the style function
    // reads the one code and the layer is told it changed. So running the
    // pointer down the list costs what running it across the map does, and
    // renders nothing, reloads nothing and never moves the view.
    const hover = createPickerHover(() => layer.changed());
    hoverRef.current = hover;

    const baseLayer = buildBaseLayer(customBackgroundRef.current);
    baseLayerRef.current = baseLayer;
    const olMap = new Map({
      target: containerRef.current,
      // The zoom buttons are finger-sized on a touch screen (.oh-tap only
      // applies there).
      controls: defaultControls({
        rotate: false,
        zoom: true,
        zoomOptions: { zoomInClassName: "ol-zoom-in oh-tap", zoomOutClassName: "ol-zoom-out oh-tap" },
      }),
      layers: [baseLayer, layer],      view: new View({
        center: fromLonLat([0, 20]),
        zoom: 2,
        minZoom: 1,
        maxZoom: 8,
      }),
    });

    mapObjectRef.current = olMap;

    const regionIdOf = (feature) =>
      (feature.getId?.() ?? feature.get("id") ?? feature.get("GID_1") ?? null);

    const styleFn = (feature) => {
      if (modeRef.current === "regions") {
        const id = regionIdOf(feature);
        const isSelected = id != null && selectedRegionsRef.current.has(String(id));
        const isHovered = id != null && String(id) === hoveredRegionRef.current;
        if (isSelected) {
          return new Style({
            fill: new Fill({ color: withAlpha(selectionColorRef.current, 0.9) }),
            stroke: new Stroke({ color: "rgba(255, 255, 255, 0.9)", width: 1.6 }),
          });
        }
        const regionOwner = feature.get("owner") || feature.get("gid0");
        const ownerName = regionOwner ? toCountryName(regionOwner) || regionOwner : null;
        const ownerPalette = ownerName ? colorPaletteRef.current?.[ownerName] : null;
        const ownerFill = !ownerName
          ? "rgba(20, 25, 35, 0.65)"
          : ownerPalette
            ? `rgba(${ownerPalette[0]}, ${ownerPalette[1]}, ${ownerPalette[2]}, 0.82)`
            : fallbackColorFromCode(ownerName);
        return new Style({
          fill: new Fill({ color: isHovered ? "rgba(255, 255, 255, 0.48)" : ownerFill }),
        });
      }

      const code = feature.get("owner") || feature.get("gid0");
      const isPlayable = code && playableCodesRef.current.has(code);
      const isHovered = code === hover.code;

      if (!isPlayable) {
        return new Style({
          fill: new Fill({ color: "rgba(20, 25, 35, 0.65)" }),
        });
      }

      const countryName = toCountryName(code) || code;
      const paletteMatch = colorPaletteRef.current?.[countryName];
      const baseFill = paletteMatch
        ? `rgba(${paletteMatch[0]}, ${paletteMatch[1]}, ${paletteMatch[2]}, 0.82)`
        : fallbackColorFromCode(countryName);

      return new Style({
        fill: new Fill({
          color: isHovered ? "rgba(255, 255, 255, 0.48)" : baseFill,
        }),
      });
    };
    layer.setStyle(styleFn);

    olMap.on("singleclick", (evt) => {
      const hit = olMap.forEachFeatureAtPixel(
        evt.pixel,
        (f) => f,
        { hitTolerance: 5 },
      );
      if (!hit) return;
      if (modeRef.current === "regions") {
        const id = regionIdOf(hit);
        if (id != null && onToggleRegionRef.current) onToggleRegionRef.current(String(id));
        return;
      }
      const code = hit.get("owner") || hit.get("gid0");
      if (code && playableCodesRef.current.has(code)) {
        onPickCountry(code);
      }
    });

    olMap.on("pointermove", (evt) => {
      const hit = olMap.forEachFeatureAtPixel(
        evt.pixel,
        (f) => f,
        { hitTolerance: 5 },
      );
      if (modeRef.current === "regions") {
        const id = hit ? regionIdOf(hit) : null;
        olMap.getTargetElement().style.cursor = id != null ? "pointer" : "";
        const key = id != null ? String(id) : null;
        if (hoveredRegionRef.current !== key) {
          hoveredRegionRef.current = key;
          layer.changed();
        }
        return;
      }
      const code = hit ? hit.get("owner") || hit.get("gid0") : null;
      const isClickable = code && playableCodesRef.current.has(code);
      olMap.getTargetElement().style.cursor = isClickable ? "pointer" : "";

      // The pointer is on the map, so the map's own hover has the highlight
      // again, whatever row of the list held it: the playable country under
      // the pointer, or none.
      hover.overMap(isClickable ? code : null);
    });

    return () => {
      sourceRef.current?.clear();
      olMap.setTarget(null);
      // Detaching alone left every layer's canvas alive for the rest of the
      // session: a picker-sized 2D canvas at the device pixel ratio, two of
      // them 15 MB each on a phone, carried into the game the player picked.
      // Disposing the layers and the map releases them.
      olMap.getLayers().getArray().slice().forEach((layer) => layer.dispose());
      olMap.dispose();
    };
  }, []);

  // Load or reload region features when GeoJSON source changes
  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;
    source.clear();

    if (regionsGeojson) {
      try {
        const features = parseGeoJSONFeatures(regionsGeojson);
        source.addFeatures(applyOwnerOverrides(features, ownerOverrides));
      } catch {
        // parsed GeoJSON is invalid — fall through to seed
      }
    }
  }, [regionsGeojson, ownerOverrides]);

  // The stock world, from the z0 tile of the regions archive: ~15k vertices in
  // a few hundred kilobytes, the same geometry the game's own labels use and
  // already cached once they have. This used to fetch and parse the 55 MB
  // full-resolution seed — tens of seconds, for a map the size of a card.
  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;
    if (regionsGeojson) return; // custom data already loaded above
    let cancelled = false;
    loadRegionLabelGeometry()
      .then((collection) => {
        if (cancelled || !collection?.features?.length) return;
        // The stock world is the shared modern one, so overriding owners on it
        // is what turns "present-day Earth" into this scenario's map.
        const features = parseGeoJSONFeatures(collection, { stock: true });
        source.addFeatures(applyOwnerOverrides(features, ownerOverrides));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [!!regionsGeojson, ownerOverrides]);

  // Re-style when the playable set OR the selection mode changes (the style fn
  // reads modeRef, so the layer must be told to repaint when the mode flips).
  useEffect(() => {
    const source = sourceRef.current;
    if (source) source.changed();
  }, [countryOptions, selectionMode, selectionColor]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      mapObjectRef.current?.updateSize?.();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const regionMode = selectionMode === "regions";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isMobile || regionMode ? "column" : "row",
        gap: isMobile ? "0.6rem" : "1.25rem",
        alignItems: "stretch",
        flex: 1,
        minHeight: 0,
        width: "100%",
      }}
    >
      {/* Map Column */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: isMobile || regionMode ? "1 1 auto" : "1.5 1 0",
          minWidth: 0,
          position: "relative",
        }}
      >
        {regionMode ? (
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.78rem", marginBottom: "0.4rem" }}>
            Click regions on the map to claim them as your faction's starting
            territory. Click again to release one.
          </div>
        ) : isMobile ? (
          <input
            // On a touch screen or a phone-sized one, focusing raises the
            // keyboard over the picker it is meant to help with; there the
            // player taps the box to search.
            autoFocus={!touchFirst && !isMobile}
            className="oh-tap-row"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search countries…"
            style={{
              padding: "0.55rem 0.75rem",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(0,0,0,0.32)",
              color: "#fff",
              outline: "none",
              fontFamily: "sans-serif",
              fontSize: "0.85rem",
              marginBottom: "0.4rem",
            }}
          />
        ) : null}
        <div
          ref={containerRef}
          style={{
            width: "100%",
            display: searching ? "none" : "block",
            // On a phone the map gives up height so the search, the list and the
            // dialog's buttons fit on the screen with it: whatever the screen
            // leaves after them, between 150 and the usual 320 px. The screen
            // height, not the visible one, which shrinks with the keyboard and
            // took the map down to 150 px with it.
            height: isMobile ? `clamp(150px, calc(${SCREEN_HEIGHT} - 28rem), 320px)` : regionMode ? "480px" : "100%",
            minHeight: isMobile ? undefined : "480px",
            borderRadius: 14,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.12)",
            background: customBackground ? CUSTOM_SEA : "#070e18",
            boxShadow: "inset 0 0 24px rgba(0,0,0,0.5)",
            position: "relative",
          }}
        />
        {!isMobile && !regionMode && (
          <div
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between",
              marginTop: "0.5rem",
              color: "rgba(255,255,255,0.45)",
              fontSize: "0.74rem",
            }}
          >
            <span>🌍 Drag to pan • Scroll to zoom • Click any nation to select</span>
            <span>{countryOptions.length} playable nations</span>
          </div>
        )}
      </div>

      {/* Dossier & Nations List Column */}
      {!regionMode && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: isMobile ? "1 1 auto" : "1 1 0",
            minWidth: isMobile ? 0 : "300px",
            maxWidth: isMobile ? undefined : "360px",
            background: isMobile ? "transparent" : "rgba(0,0,0,0.22)",
            borderRadius: 14,
            border: isMobile ? "none" : "1px solid rgba(255,255,255,0.08)",
            padding: isMobile ? 0 : "0.85rem",
          }}
        >
          {!isMobile && (
            <div style={{ marginBottom: "0.6rem" }}>
              <div style={{ color: "rgba(255,255,255,0.85)", fontSize: "0.82rem", fontWeight: 700, marginBottom: "0.4rem" }}>
                Select Nation
              </div>
              <input
                autoFocus={!touchFirst && !isMobile}
                className="oh-tap-row"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search countries or codes…"
                style={{
                  boxSizing: "border-box",
                  width: "100%",
                  padding: "0.6rem 0.8rem",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(0,0,0,0.35)",
                  color: "#fff",
                  outline: "none",
                  fontFamily: "sans-serif",
                  fontSize: "0.85rem",
                }}
              />
            </div>
          )}

          {onPickDefault && !query.trim() && (
            <button
              type="button"
              className="oh-tap-row"
              onClick={onPickDefault}
              style={{
                alignItems: "center",
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.16)",
                borderLeft: "3.5px solid #eab308",
                borderRadius: 8,
                color: "#fff",
                cursor: "pointer",
                display: "flex",
                fontSize: "0.82rem",
                fontWeight: 700,
                gap: "0.55rem",
                justifyContent: "flex-start",
                minHeight: touch ? undefined : "2.2rem",
                padding: "0.45rem 0.75rem",
                textAlign: "left",
                marginBottom: "0.35rem",
                transition: "background 0.15s ease, border-color 0.15s ease",
              }}
            >
              <span aria-hidden="true" style={{ fontSize: "1.1rem", width: "1.5rem" }}>
                ⭐
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span>{playGameId ? "Keep scenario default" : "Scenario default"}</span>
                <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.68rem", fontWeight: 400 }}>
                  Start with the scenario's designated country
                </span>
              </div>
            </button>
          )}

          <div
            style={{
              display: regionMode ? "none" : "flex",
              flexDirection: "column",
              gap: 3,
              maxHeight: isMobile ? (searching ? 240 : query.trim() ? 180 : 120) : "410px",
              overflowY: "auto",
              paddingRight: "0.15rem",
            }}
          >
            {shownOptions.map((c) => (
              <button
                key={c.code}
                type="button"
                className="oh-tap-row"
                onClick={() => onPickCountry(c.code)}
                // Pointing at a row lights its country on the map, with the
                // pointer or with the keyboard focus, and leaving it puts it out
                // (countryPickerHover.js). By the row's code, which is the owner
                // the map's regions carry; the name is only what is shown. The
                // focus only when it is the keyboard's: a row pressed with the
                // mouse and let go of elsewhere keeps the focus, and would keep
                // its country lit with nothing pointing at it. Not on a touch
                // screen: nothing hovers there, and a tap would light the country
                // for the moment before it is picked.
                onMouseEnter={canHover ? () => hoverRef.current?.enterRow(c.code) : undefined}
                onMouseLeave={canHover ? () => hoverRef.current?.leaveRow(c.code) : undefined}
                onFocus={canHover ? (event) => { if (hasKeyboardFocus(event.currentTarget)) hoverRef.current?.focusRow(c.code); } : undefined}
                onBlur={canHover ? () => hoverRef.current?.blurRow(c.code) : undefined}
                style={{
                  alignItems: "center",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderLeft: `3.5px solid ${resolveCountryColor(c, colorPaletteRef.current)}`,
                  borderRadius: 8,
                  color: "rgba(246,246,248,0.95)",
                  cursor: "pointer",
                  display: "flex",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  gap: "0.6rem",
                  justifyContent: "flex-start",
                  // Left to .oh-tap-row on a touch screen, which an inline
                  // min-height would override.
                  minHeight: touch ? undefined : "2rem",
                  padding: "0.38rem 0.75rem",
                  textAlign: "left",
                  transition: "background 0.15s ease, border-color 0.15s ease",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    alignItems: "center",
                    background: resolveCountryFlag(c) ? "rgba(0,0,0,0.3)" : resolveCountryColor(c, colorPaletteRef.current),
                    border: "1px solid rgba(255,255,255,0.18)",
                    borderRadius: 3,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
                    display: "inline-flex",
                    flexShrink: 0,
                    height: "1.05rem",
                    justifyContent: "center",
                    overflow: "hidden",
                    width: "1.45rem",
                  }}
                >
                  {resolveCountryFlag(c) ? (
                    <img
                      src={bundledFlagUrl(resolveCountryFlag(c))}
                      alt=""
                      loading="lazy"
                      style={{ display: "block", height: "100%", objectFit: "cover", width: "100%" }}
                    />
                  ) : (
                    <span
                      style={{
                        background: resolveCountryColor(c, colorPaletteRef.current),
                        display: "block",
                        height: "100%",
                        width: "100%",
                      }}
                    />
                  )}
                </span>
                <span>{c.name}</span>
                {c.code && c.code !== c.name && c.code.length <= 4 && (
                  <span
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 4,
                      color: "rgba(255,255,255,0.45)",
                      fontFamily: "monospace",
                      fontSize: "0.68rem",
                      letterSpacing: "0.05em",
                      marginLeft: "auto",
                      padding: "0.1rem 0.4rem",
                    }}
                  >
                    {c.code}
                  </span>
                )}
              </button>
            ))}
            {filteredOptions.length > rowLimit && (
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", padding: "0.4rem", textAlign: "center" }}>
                {filteredOptions.length - rowLimit} more… type to search
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CountryPickerMap;
