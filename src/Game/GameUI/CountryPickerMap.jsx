import { useEffect, useMemo, useRef, useState } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Style from "ol/style/Style";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import GeoJSON from "ol/format/GeoJSON";
import { fromLonLat } from "ol/proj";
import { defaults as defaultControls } from "ol/control/defaults";
import { loadSeedFeatures } from "../../Editor/regionImport.js";
import { flagEmojiFromGid } from "../../runtime/countryFlags.js";

const codeToColor = (code) => {
  let h = 0;
  for (let i = 0; i < code.length; i += 1) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 52%, 42%)`;
};

const parseGeoJSONFeatures = (geojson) => {
  const fmt = new GeoJSON();
  const features = fmt.readFeatures(geojson, {
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857",
  });
  for (const feature of features) {
    const props = feature.getProperties();
    if (props.id != null) feature.setId(String(props.id));
    if (feature.get("owner") == null) feature.set("owner", props.gid0 || props.owner || null);
    if (feature.get("typeId") == null) feature.set("typeId", "land");
  }
  return features;
};

const CountryPickerMap = ({ countryOptions, onPickCountry, regionsGeojson }) => {
  const containerRef = useRef(null);
  const layerRef = useRef(null);
  const sourceRef = useRef(null);
  const hoveredCodeRef = useRef(null);
  const playableCodesRef = useRef(new Set());
  const [query, setQuery] = useState("");

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

  // One-time map + layer creation
  useEffect(() => {
    const source = new VectorSource();
    const layer = new VectorLayer({ source });
    layerRef.current = layer;
    sourceRef.current = source;

    const olMap = new Map({
      target: containerRef.current,
      controls: defaultControls({ rotate: false, zoom: true }),
      layers: [
        new TileLayer({
          source: new XYZ({
            url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
            maxZoom: 16,
          }),
        }),
        layer,
      ],
      view: new View({
        center: fromLonLat([0, 20]),
        zoom: 2,
        minZoom: 1,
        maxZoom: 8,
      }),
    });

    const styleFn = (feature) => {
      const code = feature.get("owner") || feature.get("gid0");
      const isPlayable = code && playableCodesRef.current.has(code);
      const isHovered = code === hoveredCodeRef.current;

      if (!isPlayable) {
        return new Style({
          fill: new Fill({ color: "rgba(60,65,80,0.35)" }),
          stroke: new Stroke({
            color: "rgba(120,125,140,0.25)",
            width: 0.6,
          }),
        });
      }

      return new Style({
        fill: new Fill({
          color: isHovered ? "rgba(124,58,237,0.55)" : codeToColor(code),
        }),
        stroke: new Stroke({
          color: isHovered
            ? "rgba(124,58,237,0.9)"
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
      if (hit) {
        const code = hit.get("owner") || hit.get("gid0");
        if (code && playableCodesRef.current.has(code)) {
          onPickCountry(code);
        }
      }
    });

    olMap.on("pointermove", (evt) => {
      const hit = olMap.forEachFeatureAtPixel(
        evt.pixel,
        (f) => f,
        { hitTolerance: 5 },
      );
      const code = hit ? hit.get("owner") || hit.get("gid0") : null;
      const isClickable = code && playableCodesRef.current.has(code);
      olMap.getTargetElement().style.cursor = isClickable ? "pointer" : "";

      if (hoveredCodeRef.current !== code) {
        hoveredCodeRef.current = isClickable ? code : null;
        layer.changed();
      }
    });

    return () => olMap.setTarget(null);
  }, []);

  // Load or reload region features when GeoJSON source changes
  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;
    source.clear();

    if (regionsGeojson) {
      try {
        const features = parseGeoJSONFeatures(regionsGeojson);
        source.addFeatures(features);
      } catch {
        // parsed GeoJSON is invalid — fall through to seed
      }
    }
  }, [regionsGeojson]);

  // Load seed features on mount (after regionsGeojson is checked above)
  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;
    if (regionsGeojson) return; // custom data already loaded above
    loadSeedFeatures()
      .then((features) => source.addFeatures(features))
      .catch(() => {});
  }, [!!regionsGeojson]);

  // Re-style when countryOptions change
  useEffect(() => {
    const source = sourceRef.current;
    if (source) source.changed();
  }, [countryOptions]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <input
        autoFocus
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
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "320px",
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.1)",
          background: "#0a0c15",
        }}
      />
      <div
        style={{
          display: "flex",
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
              color: "rgba(244,246,255,0.92)",
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
