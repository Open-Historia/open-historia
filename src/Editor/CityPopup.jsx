/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Inline city editor, anchored where the map was clicked. Opens when the city
// tool places a new city (name pre-selected — just type) or when an existing
// city is clicked with the tool. Size sets the population/prominence tier that
// drives when the city appears on the exported game map.

import { useEffect, useRef } from "react";
import { panelSurface, inputStyle, pillButton } from "./editorStyles.js";

const SIZES = [
  { value: "town", label: "Town", population: 20000 },
  { value: "city", label: "City", population: 250000 },
  { value: "major", label: "Major city", population: 1500000 },
];

const sizeOf = (population = 0) => (population >= 1000000 ? "major" : population >= 100000 ? "city" : "town");

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

  const left = Math.max(8, Math.min(x - 20, (window.innerWidth || 1200) - 268));
  const top = Math.max(8, Math.min(y + 14, (window.innerHeight || 800) - 190));

  return (
    <div
      style={{
        ...panelSurface,
        position: "fixed",
        left,
        top,
        zIndex: 45,
        width: 250,
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
          value={sizeOf(feature.population)}
          onChange={(e) => {
            const size = SIZES.find((s) => s.value === e.target.value);
            if (size) onChange({ population: size.population });
          }}
          style={{ ...inputStyle, padding: "5px 6px", flex: 1 }}
        >
          {SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
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
