/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Inline city editor, anchored where the map was clicked. City size, population,
// and capital status are deliberately separate pieces of state:
//   tier 1 = Town, tier 2 = City, tier 3 = Major City
// Population remains an independently editable demographic value, while capital
// is an independent tag. Legacy features without tier derive a display tier from
// population until the user explicitly chooses a size.

import { useEffect, useRef } from "react";
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

const CityPopup = ({ feature, x, y, isNew, onChange, onDelete, onClose }) => {
  const nameRef = useRef(null);

  // New city: focus the name and select the placeholder so typing replaces it.
  useEffect(() => {
    if (!nameRef.current) return;
    nameRef.current.focus();
    if (isNew) nameRef.current.select();
  }, [isNew]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
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
