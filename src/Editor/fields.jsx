/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

import { useState } from "react";

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

// `list` opts the field into a <datalist> of suggestions while staying free text
// — the Country field offers the names already on the map without preventing a
// new one from being typed.
export const TextField = ({ value, onChange, placeholder, width, list }) => (
  <input
    value={value ?? ""}
    placeholder={placeholder}
    list={list}
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

// A country's tags, as removable chips plus a free-text box. The vocabulary is
// open (alt-history can't be enumerated), so `suggestions` only feeds a datalist —
// it steers spelling toward one form without ever rejecting a new tag.
//
// Commit on Enter/comma/blur; Backspace on an empty box removes the last chip.
// The comma split is what makes pasting "socialist, authoritarian, anti-nato"
// work, which is how anyone with a list in hand will actually enter these.
export const TagField = ({ value, onChange, suggestions = [], placeholder = "add a tag…" }) => {
  const [draft, setDraft] = useState("");
  const tags = Array.isArray(value) ? value : [];
  const listId = "oh-tag-suggestions";

  const commit = (raw) => {
    const parts = String(raw).split(",").map((t) => t.trim()).filter(Boolean);
    if (parts.length) onChange([...tags, ...parts]);
    setDraft("");
  };

  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
      {tags.length > 0 && (
        <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {tags.map((tag) => (
            <span
              key={tag}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                background: "rgba(124,58,237,0.22)", border: "1px solid rgba(124,58,237,0.5)",
                borderRadius: 999, padding: "1px 4px 1px 7px", fontSize: 11, lineHeight: "16px",
              }}
            >
              {tag}
              <button
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                title={`Remove ${tag}`}
                style={{
                  background: "none", border: "none", color: "inherit", cursor: "pointer",
                  padding: "0 2px", fontSize: 13, lineHeight: "14px", opacity: 0.7,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </span>
      )}
      <input
        value={draft}
        list={listId}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          // A datalist pick fires change with the full value; a comma means the
          // user is listing several. Either way that's a completed tag.
          if (v.includes(",")) commit(v); else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(draft); }
          else if (e.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={() => draft.trim() && commit(draft)}
        style={{ ...inputStyle, width: "100%", padding: "5px 7px" }}
      />
      <datalist id={listId}>
        {suggestions.map((s) => <option key={s} value={s} />)}
      </datalist>
    </span>
  );
};
