/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Searchable region list. Matches by name / id / owner / country; clicking a row
// selects the region and zooms to it. Backed by the OL source via the map API.

import { useEffect, useMemo, useState } from "react";
import Panel from "./Panel.jsx";
import Icon from "./Icon.jsx";
import { inputStyle } from "./editorStyles.js";

const RegionsPanel = ({ api, selection, setSelection, onClose }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);

  useEffect(() => {
    if (!api) return;
    setResults(api.queryRegions(query, 300));
  }, [api, query, selection]);

  return (
    <Panel title="Regions" icon="list" onClose={onClose} width={330}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="search" size={15} style={{ opacity: 0.6 }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, code, owner…"
          style={{ ...inputStyle, padding: "6px 8px" }}
          autoFocus
        />
      </div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
        {results.length}{results.length >= 300 ? "+" : ""} shown
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {results.map((r) => {
          const active = selectedSet.has(r.id);
          return (
            <button
              key={r.id}
              onClick={() => {
                setSelection([r.id]);
                api?.zoomToRegion(r.id);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                textAlign: "left",
                padding: "6px 8px",
                borderRadius: 8,
                border: active ? "1px solid rgba(59,130,246,0.8)" : "1px solid transparent",
                background: active ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.03)",
                color: "white",
                cursor: "pointer",
              }}
            >
              <span style={{ flex: 1, overflow: "hidden" }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                  {r.name || r.id}
                </div>
                <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)" }}>
                  {r.id} · {r.owner || "unowned"}
                </div>
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
};

export default RegionsPanel;
