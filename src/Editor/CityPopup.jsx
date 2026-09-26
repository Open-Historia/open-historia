/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Inline city editor, anchored where the map was clicked. City size, population,
// and capital status are deliberately separate pieces of state:
//   tier 1 = Town, tier 2 = City, tier 3 = Major City
// Population remains an independently editable demographic value, while capital
// is an independent tag. Legacy features without tier derive a display tier from
// population until the user explicitly chooses a size.

import { useEffect, useRef, useState } from "react";
import { panelSurface, inputStyle, pillButton } from "./editorStyles.js";

const SIZES = [
  { tier: 1, label: "Town" },
  { tier: 2, label: "City" },
  { tier: 3, label: "Major city" },
];

const tierFromPopulation = (population = 0) => {
  const pop = Number(population || 0);
  return pop >= 1000000 ? 3 : pop >= 100000 ? 2 : 1;
};

const cityTier = (feature) => {
  const authored = Number(feature?.tier);
  if (Number.isFinite(authored) && authored >= 1 && authored <= 3) return Math.round(authored);
  return tierFromPopulation(feature?.population);
};

// A population by year as text, one "year: population" a line (BC negative),
// and back. Lines that are not a year and a figure are dropped.
const seriesToText = (byYear) => Object.entries(byYear || {})
  .sort((a, b) => Number(a[0]) - Number(b[0]))
  .map(([year, population]) => `${year}: ${population}`)
  .join("\n");
const textToSeries = (text) => {
  const out = {};
  for (const line of String(text || "").split(/\n/)) {
    const match = /^\s*(-?\d{1,6})\s*[:=,\s]\s*([\d.,_\s]+)$/.exec(line);
    if (!match) continue;
    const year = Number(match[1]);
    const population = Number(match[2].replace(/[,_\s]/g, ""));
    if (Number.isInteger(year) && year !== 0 && Number.isFinite(population) && population > 0) out[year] = Math.round(population);
  }
  return out;
};

const CityPopup = ({ feature, x, y, isNew, onChange, onDelete, onClose }) => {
  const nameRef = useRef(null);
  // The population-by-year text being typed, for the city it was typed for; any
  // other city shows its own series.
  const [typed, setTyped] = useState(null);
  const seriesDraft = typed && typed.id === feature?.id ? typed.text : null;
  const setSeriesDraft = (text) => setTyped(text === null ? null : { id: feature?.id, text });

  // New city: focus the name and select the placeholder so typing replaces it.
  useEffect(() => {
    if (!nameRef.current) return;
    nameRef.current.focus();
    if (isNew) nameRef.current.select();
  }, [isNew]);

  useEffect(() => {
    const onKey = (e) => {
      // Enter in the population-by-year box starts a new line; it does not close.
      if (e.key === "Escape" || (e.key === "Enter" && e.target?.tagName !== "TEXTAREA")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!feature) return null;
  const tags = feature.tags || [];
  const isCapital = tags.includes("capital");
  const tier = cityTier(feature);
  const populationValue = feature.population == null ? "" : feature.population;

  const left = Math.max(8, Math.min(x - 20, (window.innerWidth || 1200) - 288));
  const top = Math.max(8, Math.min(y + 14, (window.innerHeight || 800) - 250));

  return (
    <div
      style={{
        ...panelSurface,
        position: "fixed",
        left,
        top,
        zIndex: 45,
        width: 270,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontSize: 12,
      }}
    >
      <input
        ref={nameRef}
        value={feature.name || ""}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="City name"
        style={{ ...inputStyle, padding: "6px 8px", fontSize: 13, fontWeight: 600 }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <select
          value={String(tier)}
          onChange={(e) => onChange({ tier: Number(e.target.value) })}
          style={{ ...inputStyle, padding: "5px 6px", flex: 1 }}
          aria-label="City size"
        >
          {SIZES.map((size) => (
            <option key={size.tier} value={String(size.tier)}>
              {size.label}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", whiteSpace: "nowrap" }}>
          <input
            type="checkbox"
            checked={isCapital}
            onChange={(e) =>
              onChange({
                tags: e.target.checked ? [...tags.filter((t) => t !== "capital"), "capital"] : tags.filter((t) => t !== "capital"),
              })
            }
          />
          ★ Capital
        </label>
      </div>

      <label style={{ display: "grid", gap: 4, color: "rgba(255,255,255,0.7)" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700 }}>Population</span>
        <input
          type="number"
          min="0"
          step="1000"
          value={populationValue}
          onChange={(e) => {
            const raw = e.target.value;
            onChange({ population: raw === "" ? null : Math.max(0, Math.round(Number(raw) || 0)) });
          }}
          onBlur={() => {
            if (feature.population == null || feature.population === "") onChange({ population: 0 });
          }}
          placeholder="0"
          style={{ ...inputStyle, padding: "5px 7px" }}
          aria-label="City population"
        />
      </label>

      <label style={{ display: "grid", gap: 4, color: "rgba(255,255,255,0.7)" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700 }}>Population by year</span>
        <textarea
          value={seriesDraft ?? seriesToText(feature.populationByYear)}
          onChange={(e) => setSeriesDraft(e.target.value)}
          onBlur={() => {
            if (seriesDraft === null) return;
            const byYear = textToSeries(seriesDraft);
            onChange({ populationByYear: Object.keys(byYear).length ? byYear : undefined });
            setSeriesDraft(null);
          }}
          rows={3}
          placeholder={"1950: 1200000\n2000: 3400000"}
          style={{ ...inputStyle, padding: "5px 7px", resize: "vertical", fontFamily: "inherit", fontSize: 12 }}
          aria-label="Population by year"
        />
        <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)", lineHeight: 1.35 }}>
          One year a line. The game reads the population for its date from these, until the AI changes this city's population itself.
        </span>
      </label>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button onClick={onDelete} style={{ ...pillButton(false), color: "#f87171" }}>
          Delete
        </button>
        <button onClick={onClose} style={{ ...pillButton(true) }}>
          Done
        </button>
      </div>
    </div>
  );
};

export default CityPopup;
