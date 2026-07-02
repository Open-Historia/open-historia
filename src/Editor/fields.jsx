/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Small form-field building blocks + color helpers for the editor panels.

import { inputStyle, ACCENT } from "./editorStyles.js";

export const rgbToHex = (rgb) =>
  Array.isArray(rgb)
    ? "#" + rgb.slice(0, 3).map((n) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, "0")).join("")
    : "#000000";

export const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const Row = ({ label, children, title }) => (
  <label title={title} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
    <span style={{ flex: "0 0 46%", color: "rgba(255,255,255,0.72)" }}>{label}</span>
    <span style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>{children}</span>
  </label>
);

export const NumberField = ({ value, onChange, step = 1, min, max, width = 76 }) => (
  <input
    type="number"
    value={value ?? ""}
    step={step}
    min={min}
    max={max}
    onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    style={{ ...inputStyle, width, padding: "4px 6px", textAlign: "right" }}
  />
);

export const TextField = ({ value, onChange, placeholder, width }) => (
  <input
    value={value ?? ""}
    placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
    style={{ ...inputStyle, width: width || "100%", padding: "5px 7px" }}
  />
);

export const ColorField = ({ value, onChange }) => (
  <input
    type="color"
    value={rgbToHex(value)}
    onChange={(e) => onChange(hexToRgb(e.target.value))}
    style={{
      width: 40,
      height: 26,
      padding: 0,
      border: "1px solid rgba(255,255,255,0.2)",
      borderRadius: 6,
      background: "transparent",
      cursor: "pointer",
    }}
  />
);

export const Toggle = ({ value, onChange }) => (
  <button
    onClick={() => onChange(!value)}
    role="switch"
    aria-checked={!!value}
    style={{
      width: 38,
      height: 22,
      borderRadius: 11,
      border: "1px solid rgba(255,255,255,0.2)",
      background: value ? ACCENT : "rgba(255,255,255,0.12)",
      position: "relative",
      cursor: "pointer",
      transition: "background 0.15s",
    }}
  >
    <span
      style={{
        position: "absolute",
        top: 2,
        left: value ? 18 : 2,
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: "white",
        transition: "left 0.15s",
      }}
    />
  </button>
);

export const SelectField = ({ value, onChange, options, width }) => (
  <select
    value={value ?? ""}
    onChange={(e) => onChange(e.target.value)}
    style={{ ...inputStyle, width: width || "auto", padding: "5px 7px", cursor: "pointer" }}
  >
    {options.map((o) => (
      <option key={o.value} value={o.value} style={{ color: "#000" }}>
        {o.label}
      </option>
    ))}
  </select>
);
