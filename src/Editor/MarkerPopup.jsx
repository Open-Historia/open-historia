/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Inline editor for a map feature that is not a city (mapFeatures.js): what it
// is, who holds it, its state, and a note the AI reads. Anchored where the map
// was clicked, like the city popup beside it.

import { useEffect, useRef, useState } from "react";
import { panelSurface, inputStyle, pillButton } from "./editorStyles.js";
import { MAP_FEATURE_KINDS, MAP_FEATURE_STATUSES } from "./mapFeatures.js";

const STATUS_LABELS = {
  planned: "Planned",
  under_construction: "Under construction",
  active: "Active",
  damaged: "Damaged",
  inactive: "Inactive",
  abandoned: "Abandoned",
  destroyed: "Destroyed",
};

const MarkerPopup = ({ feature, x, y, isNew, polities = [], onChange, onDelete, onClose }) => {
  const nameRef = useRef(null);
  const kind = String(feature?.kind || "landmark");
  const listed = MAP_FEATURE_KINDS.some((entry) => entry.id === kind);
  const [customKind, setCustomKind] = useState(!listed);

  useEffect(() => {
    if (!nameRef.current) return;
    nameRef.current.focus();
    if (isNew) nameRef.current.select();
  }, [isNew]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!feature) return null;
  const left = Math.max(8, Math.min(x - 20, (window.innerWidth || 1200) - 298));
  const top = Math.max(8, Math.min(y + 14, (window.innerHeight || 800) - 360));
  const owner = feature.owner || "";

  return (
    <div
      style={{
        ...panelSurface,
        position: "fixed",
        left,
        top,
        zIndex: 45,
        width: 280,
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
        onKeyDown={(e) => { if (e.key === "Enter") onClose(); }}
        placeholder="Feature name"
        style={{ ...inputStyle, padding: "6px 8px", fontSize: 13, fontWeight: 600 }}
      />

      <label style={{ display: "grid", gap: 4, color: "rgba(255,255,255,0.7)" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700 }}>Type</span>
        <select
          value={customKind ? "__other" : kind}
          onChange={(e) => {
            if (e.target.value === "__other") {
              setCustomKind(true);
              return;
            }
            setCustomKind(false);
            onChange({ kind: e.target.value });
          }}
          style={{ ...inputStyle, padding: "5px 6px" }}
        >
          {MAP_FEATURE_KINDS.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.label}</option>
          ))}
          <option value="__other">Other…</option>
        </select>
        {customKind && (
          <input
            value={listed ? "" : kind}
            onChange={(e) => onChange({ kind: e.target.value.toLowerCase() })}
            placeholder="shipyard, missile silo, monastery…"
            style={{ ...inputStyle, padding: "5px 7px" }}
          />
        )}
      </label>

      <label style={{ display: "grid", gap: 4, color: "rgba(255,255,255,0.7)" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700 }}>Held by</span>
        <select
          value={owner}
          onChange={(e) => onChange({ owner: e.target.value || null })}
          style={{ ...inputStyle, padding: "5px 6px" }}
        >
          <option value="">No one</option>
          {[...new Set([...polities.map((row) => row.key), ...(owner ? [owner] : [])])].map((key) => (
            <option key={key} value={key}>{polities.find((row) => row.key === key)?.name || key}</option>
          ))}
        </select>
      </label>

      <label style={{ display: "grid", gap: 4, color: "rgba(255,255,255,0.7)" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700 }}>State</span>
        <select
          value={feature.status || "active"}
          onChange={(e) => onChange({ status: e.target.value })}
          style={{ ...inputStyle, padding: "5px 6px" }}
        >
          {MAP_FEATURE_STATUSES.map((status) => (
            <option key={status} value={status}>{STATUS_LABELS[status] || status}</option>
          ))}
        </select>
      </label>

      <label style={{ display: "grid", gap: 4, color: "rgba(255,255,255,0.7)" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700 }}>Note (the AI reads it)</span>
        <textarea
          value={feature.note || ""}
          onChange={(e) => onChange({ note: e.target.value })}
          rows={3}
          placeholder="The fleet's northern anchorage; nuclear submarines."
          style={{ ...inputStyle, padding: "5px 7px", resize: "vertical", fontFamily: "inherit", fontSize: 12 }}
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

export default MarkerPopup;
