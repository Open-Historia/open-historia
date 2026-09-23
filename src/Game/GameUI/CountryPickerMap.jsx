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
import { defaults as defaultControls } from "ol/control/defaults";
import { flagEmojiFromGid } from "../../runtime/countryFlags.js";
import { loadRegionLabelGeometry } from "../../runtime/countryLabels.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { isBrowserOnline } from "../../runtime/networkStatus.js";

const codeToColor = (code) => {
  let h = 0;
  for (let i = 0; i < code.length; i += 1) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 52%, 42%)`;
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

// The ESRI dark canvas the picker has always drawn on.
const ESRI_DARK_GRAY_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
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
  if (customBackground?.kind === "image" && customBackground.imageUrl) {
    return new ImageLayer({
      source: new ImageStatic({ url: customBackground.imageUrl, imageExtent: WORLD_IMAGE_EXTENT, projection: "EPSG:3857" }),
    });
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
  return new TileLayer({ source: new XYZ({ url: ESRI_DARK_GRAY_TILES, maxZoom: 16, wrapX: false }) });
};

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
}) => {
  const containerRef = useRef(null);
  const mapObjectRef = useRef(null);
  const baseLayerRef = useRef(null);
  const customBackgroundRef = useRef(customBackground);
  customBackgroundRef.current = customBackground;
  const layerRef = useRef(null);
  const sourceRef = useRef(null);
  const hoveredCodeRef = useRef(null);
  const hoveredRegionRef = useRef(null);
  const playableCodesRef = useRef(new Set());
  const [query, setQuery] = useState("");
  // A coarse primary pointer = a touch screen, where focus opens the keyboard.
  const [touchFirst] = useState(() => {
    try {
      return typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches);
    } catch {
      return false;
    }
  });

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

    const baseLayer = buildBaseLayer(customBackgroundRef.current);
    baseLayerRef.current = baseLayer;
    const olMap = new Map({
      target: containerRef.current,
      controls: defaultControls({ rotate: false, zoom: true }),
      layers: [baseLayer, layer],
      view: new View({
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
        return new Style({
          fill: new Fill({
            color: isSelected
              ? withAlpha(selectionColorRef.current, 0.6)
              : isHovered ? "rgba(255,255,255,0.28)" : "rgba(66,66,70,0.3)",
          }),
          stroke: new Stroke({
            color: isSelected ? withAlpha(selectionColorRef.current, 0.95) : "rgba(150,155,170,0.4)",
            width: isSelected ? 1.6 : isHovered ? 1.4 : 0.6,
          }),
        });
      }

      const code = feature.get("owner") || feature.get("gid0");
      const isPlayable = code && playableCodesRef.current.has(code);
      const isHovered = code === hoveredCodeRef.current;

      if (!isPlayable) {
        return new Style({
          fill: new Fill({ color: "rgba(66,66,70,0.35)" }),
          stroke: new Stroke({
            color: "rgba(120,125,140,0.25)",
            width: 0.6,
          }),
        });
      }

      return new Style({
        fill: new Fill({
          color: isHovered ? "rgba(255,255,255,0.35)" : codeToColor(code),
        }),
        stroke: new Stroke({
          color: isHovered
            ? "rgba(255,255,255,0.85)"
            : "rgba(255,255,255,0.3)",
          width: isHovered ? 2.5 : 1,
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

      if (hoveredCodeRef.current !== code) {
        hoveredCodeRef.current = isClickable ? code : null;
        layer.changed();
      }
    });

    return () => {
      sourceRef.current?.clear();
      olMap.setTarget(null);
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

  const regionMode = selectionMode === "regions";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {regionMode ? (
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.78rem" }}>
          Click regions on the map to claim them as your faction's starting
          territory. Click again to release one.
        </div>
      ) : (
        <input
          // On a touch screen focusing raises the keyboard over the picker it
          // is meant to help with; there the player taps the box to search.
          autoFocus={!touchFirst}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search countries…"
          style={{
            padding: "0.55rem 0.7rem",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.16)",
            background: "rgba(0,0,0,0.28)",
            color: "#fff",
            outline: "none",
            fontFamily: "sans-serif",
            fontSize: "0.85rem",
          }}
        />
      )}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "320px",
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.1)",
          background: customBackground ? CUSTOM_SEA : "#0f0f11",
        }}
      />
      <div
        style={{
          display: regionMode ? "none" : "flex",
          flexDirection: "column",
          gap: 2,
          maxHeight: query.trim() ? 180 : 120,
          overflowY: "auto",
        }}
      >
        {filteredOptions.slice(0, query.trim() ? 30 : 12).map((c) => (
          <button
            key={c.code}
            type="button"
            onClick={() => onPickCountry(c.code)}
            style={{
              alignItems: "center",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "999px",
              color: "rgba(246,246,248,0.92)",
              cursor: "pointer",
              display: "inline-flex",
              fontSize: "0.82rem",
              fontWeight: 600,
              gap: "0.4rem",
              justifyContent: "flex-start",
              minHeight: "1.9rem",
              padding: "0 0.85rem",
              transition: "background 0.18s ease, border-color 0.18s ease",
            }}
          >
            <span aria-hidden="true" style={{ fontSize: "1.2rem", width: "1.5rem" }}>
              {flagEmojiFromGid(c.code) || "🏳️"}
            </span>
            <span>{c.name}</span>
          </button>
        ))}
        {filteredOptions.length > (query.trim() ? 30 : 12) && (
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", padding: "0.3rem", textAlign: "center" }}>
            {filteredOptions.length - (query.trim() ? 30 : 12)} more… type to search
          </div>
        )}
      </div>
    </div>
  );
};

export default CountryPickerMap;
