/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Editor place search. One box finds everything: the custom places added to
// this map (point features), this map's regions, and the modern world place
// index (~70k cities/POIs the original app ships). Clicking a result flies the
// view there; world places offer one-click "+ Add" to drop them onto the map
// as a custom city. Lives INSIDE the bottom bar (results open upward) so it
// never covers the tool buttons — floating it top-left did, on phones.

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { panelSurface, inputStyle } from "./editorStyles.js";
import { searchSeedCities } from "./citiesImport.js";

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "5px 7px",
  borderRadius: 7,
  cursor: "pointer",
  background: "transparent",
  border: "none",
  color: "white",
  width: "100%",
  textAlign: "left",
};

const badge = (text, color) => (
  <span
    style={{
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: 0.4,
      color,
      border: `1px solid ${color}44`,
      borderRadius: 4,
      padding: "1px 4px",
      whiteSpace: "nowrap",
    }}
  >
    {text}
  </span>
);

const formatPop = (n) => {
  if (!n) return "";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
};

const SearchBar = ({ api, features, onAddCity }) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState({ custom: [], regions: [], world: [] });
  const boxRef = useRef(null);

  // Debounced search across the three indexes.
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
      setResults({ custom: [], regions: [], world: [] });
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const custom = (features || [])
        .filter((f) => Array.isArray(f.coord) && String(f.name || "").toLowerCase().includes(q))
        .slice(0, 6);
      const regions = api ? api.queryRegions(q, 5) : [];
      const world = await searchSeedCities(q, 8);
      if (!cancelled) setResults({ custom, regions, world });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, features, api]);

  // Close when clicking anywhere outside the search box.
  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);

  const hasResults = results.custom.length || results.regions.length || results.world.length;

  return (
    <div ref={boxRef} style={{ position: "relative", flex: "1 1 170px", maxWidth: 300, minWidth: 140 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}>
        <Icon name="search" size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search places…"
          style={{ ...inputStyle, border: "none", background: "transparent", padding: "2px 0", fontSize: 12 }}
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
            style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 13, flexShrink: 0 }}
            title="Clear"
          >
            ✕
          </button>
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <div
          style={{
            ...panelSurface,
            position: "absolute",
            bottom: "calc(100% + 10px)",
            left: 0,
            width: "min(320px, calc(100vw - 40px))",
            padding: 6,
            maxHeight: "50vh",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            zIndex: 40,
          }}
        >
          {!hasResults && (
            <div style={{ padding: "6px 8px", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>No places found.</div>
          )}

          {results.custom.map((f) => (
            <button
              key={`c-${f.id}`}
              style={rowStyle}
              onClick={() => api?.locateFeature(f.coord)}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {badge("THIS MAP", "#a5b4fc")}
              <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.name}
              </span>
              <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)" }}>{formatPop(f.population)}</span>
            </button>
          ))}

          {results.regions.map((r) => (
            <button
              key={`r-${r.id}`}
              style={rowStyle}
              onClick={() => api?.zoomToRegion(r.id)}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {badge("REGION", "#86efac")}
              <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.name || r.id}
              </span>
              <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)" }}>{r.country || r.owner || ""}</span>
            </button>
          ))}

          {results.world.map((c, i) => (
            <div key={`w-${c.name}-${i}`} style={{ display: "flex", alignItems: "center" }}>
              <button
                style={{ ...rowStyle, flex: 1 }}
                onClick={() => api?.locateFeature(c.coord)}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {badge("WORLD", "#fcd34d")}
                <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.name}
                </span>
                <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)" }}>
                  {c.capital ? "★ " : ""}
                  {formatPop(c.population)}
                </span>
              </button>
              <button
                title="Add to this map as a city"
                onClick={() => onAddCity?.(c)}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 6,
                  color: "#93c5fd",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 7px",
                  marginLeft: 4,
                }}
              >
                ＋
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SearchBar;
