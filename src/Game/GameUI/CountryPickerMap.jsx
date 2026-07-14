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

const CountryPickerMap = ({ countryOptions, onPickCountry }) => {
  const containerRef = useRef(null);
  const layerRef = useRef(null);
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

  useEffect(() => {
    const source = new VectorSource();
    const layer = new VectorLayer({ source });
    layerRef.current = layer;

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

    loadSeedFeatures()
      .then((features) => source.addFeatures(features))
      .catch(() => {});

    const styleFn = (feature) => {
      const code = feature.get("owner") || feature.get("gid0");
      const isPlayable = code && playableCodesRef.current.has(code);
      const isHovered = code === hoveredCodeRef.current;

      if (!isPlayable) {
        return new Style({
          fill: new Fill({ color: "rgba(40,42,50,0.2)" }),
          stroke: new Stroke({
            color: "rgba(80,82,95,0.15)",
            width: 0.4,
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
            : "rgba(255,255,255,0.28)",
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

  // Re-style when countryOptions change (e.g., async load completes)
  useEffect(() => {
    layerRef.current?.changed();
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
      {query.trim() && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            maxHeight: 130,
            overflowY: "auto",
          }}
        >
          {filteredOptions.slice(0, 8).map((c) => (
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
                minHeight: "2.1rem",
                padding: "0 0.95rem",
                transition: "background 0.18s ease, border-color 0.18s ease",
              }}
            >
              <span aria-hidden="true" style={{ fontSize: "1.2rem", width: "1.5rem" }}>
                {flagEmojiFromGid(c.code) || "🏳️"}
              </span>
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default CountryPickerMap;
