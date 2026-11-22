/*! Open Historia — pick a scripted event's regions on a mini map of the scenario © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CountryPickerMap from "./CountryPickerMap.jsx";
import { downloadScenarioJsonAsset } from "../../runtime/library.js";
import { buildRegionCatalogForMap } from "../../runtime/assets.js";
import { SCREEN_HEIGHT } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import {
  pickerOwnerOptions,
  pickerRegionRows,
  searchPickerRegions,
  toggleOwnerRegions,
  togglePickerRegion,
} from "./scriptedEventAuthoring.js";

const ACCENT = "var(--oh-ui-accent, #2bc1f3)";
const ACCENT_HEX = "#2bc1f3";
const LINE = "var(--oh-ui-line, rgba(255,255,255,0.1))";
const CARD = "var(--oh-ui-overlay-card, rgba(255,255,255,0.04))";
const TEXT = "var(--oh-ui-text, #f4f4f5)";
const MUTED = "rgba(255,255,255,0.55)";

let mapCache = null;

const loadPickerMap = (scenarioId, customRegions) => {
  const key = `${scenarioId}|${customRegions ? 1 : 0}`;
  if (mapCache?.key === key) return mapCache.promise;
  const promise = (async () => {
    const [geojson, colors] = await Promise.all([
      customRegions && scenarioId ? downloadScenarioJsonAsset(scenarioId, "regionsGeojson", { coarse: true }).catch(() => null) : null,
      scenarioId ? downloadScenarioJsonAsset(scenarioId, "colors").catch(() => null) : null,
    ]);
    const own = Array.isArray(geojson?.features) && geojson.features.length ? geojson : null;
    const catalog = own ? [] : await buildRegionCatalogForMap(null).catch(() => []);
    return { geojson: own, catalog, colors: colors && typeof colors === "object" && !Array.isArray(colors) ? colors : null };
  })();
  mapCache = { key, promise };
  promise.catch(() => { if (mapCache?.promise === promise) mapCache = null; });
  return promise;
};

const smallButton = (extra = {}) => ({
  alignItems: "center",
  background: CARD,
  border: `1px solid ${LINE}`,
  borderRadius: "8px",
  color: TEXT,
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "0.74rem",
  gap: "0.35rem",
  minHeight: "2rem",
  padding: "0 0.6rem",
  ...extra,
});

const fieldStyle = {
  background: "rgba(0,0,0,0.3)",
  border: `1px solid ${LINE}`,
  borderRadius: "8px",
  boxSizing: "border-box",
  color: TEXT,
  colorScheme: "dark",
  fontFamily: "inherit",
  fontSize: "0.8rem",
  minHeight: "2.1rem",
  minWidth: 0,
  padding: "0 0.6rem",
  width: "100%",
};

const optionStyle = { backgroundColor: "#1a1b1f", color: "#f8fafc" };

const ScriptedRegionPicker = ({
  mapSource = {},
  initialSelected = [],
  single = false,
  onDone,
  onClose,
}) => {
  const isMobile = useIsMobile();
  const [loaded, setLoaded] = useState(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(() => (Array.isArray(initialSelected) ? initialSelected.filter((entry) => entry?.id) : []));
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [hoverId, setHoverId] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const searchRef = useRef(null);
  const dialogRef = useRef(null);
  const { scenarioId = "", customRegions = false, ownerOverrides = null } = mapSource;

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    loadPickerMap(scenarioId, customRegions)
      .then((data) => { if (!cancelled) setLoaded(data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [scenarioId, customRegions]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      onClose?.();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  useEffect(() => {
    if (!isMobile) searchRef.current?.focus();
    else dialogRef.current?.focus();
  }, [isMobile]);

  const rows = useMemo(
    () => (loaded ? pickerRegionRows({ geojson: loaded.geojson, catalog: loaded.catalog, ownerOverrides }) : []),
    [loaded, ownerOverrides],
  );
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const owners = useMemo(() => pickerOwnerOptions(rows), [rows]);
  const matches = useMemo(() => searchPickerRegions(rows, query, 40), [rows, query]);
  const selectedIds = useMemo(() => new Set(selected.map((entry) => entry.id)), [selected]);

  useEffect(() => {
    if (!rows.length) return;
    setSelected((current) => current.map((entry) => ({ ...entry, name: rowById.get(entry.id)?.name || entry.name || entry.id })));
  }, [rows, rowById]);

  const toggle = (id) => {
    const row = rowById.get(id) || { id, name: id };
    setSelected((current) => togglePickerRegion(current, row, { single }));
  };
  const ownerSelectedCount = owner ? rows.filter((row) => row.owner === owner && selectedIds.has(row.id)).length : 0;
  const ownerCount = owner ? owners.find((entry) => entry.owner === owner)?.count || 0 : 0;
  const hovered = hoverId ? rowById.get(hoverId) : null;

  const title = single ? "Pick a region" : "Pick regions";
  const doneLabel = single ? "Use this region" : "Insert";

  const sheet = (
    <div
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
      style={{ alignItems: "center", background: "rgba(6,6,7,0.72)", display: "flex", inset: 0, justifyContent: "center", padding: isMobile ? 0 : "1rem", position: "fixed", zIndex: 2147483300 }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{
          background: "var(--oh-ui-surface, #1b1b1e)",
          border: isMobile ? "none" : `1px solid ${LINE}`,
          borderRadius: isMobile ? 0 : "16px",
          boxShadow: "0 24px 70px rgba(0,0,0,0.5)",
          boxSizing: "border-box",
          color: TEXT,
          display: "flex",
          flexDirection: "column",
          fontFamily: "sans-serif",
          height: isMobile ? SCREEN_HEIGHT : `min(46rem, calc(${SCREEN_HEIGHT} - 2rem))`,
          outline: "none",
          overflow: "hidden",
          width: isMobile ? "100vw" : "min(72rem, calc(100vw - 2rem))",
        }}
      >
        <header style={{ alignItems: "center", borderBottom: `1px solid ${LINE}`, display: "flex", gap: "0.6rem", justifyContent: "space-between", padding: "0.65rem 0.8rem" }}>
          <div style={{ fontSize: "0.98rem", fontWeight: 800 }}>{title}</div>
          <button type="button" className="oh-tap" aria-label="Close region picker" onClick={onClose} style={smallButton({ fontSize: "1rem", justifyContent: "center", minWidth: "2.2rem", padding: 0 })}>×</button>
        </header>

        <div style={{ display: "flex", flex: 1, flexDirection: isMobile ? "column" : "row", gap: "0.7rem", minHeight: 0, padding: "0.7rem" }}>
          <div style={{ display: "flex", flex: isMobile ? "1 1 46%" : "1 1 0", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
            <div data-no-translate style={{ color: MUTED, fontSize: "0.72rem", minHeight: "1.1rem", marginBottom: "0.3rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {hovered ? `${hovered.name}${hovered.owner ? ` · ${hovered.owner}` : ""}` : ""}
            </div>
            {failed ? (
              <div role="alert" style={{ color: "#fca5a5", fontSize: "0.8rem", padding: "1rem" }}>This scenario's map could not be loaded.</div>
            ) : loaded ? (
              <CountryPickerMap
                countryOptions={[]}
                onPickCountry={() => {}}
                regionsGeojson={loaded.geojson}
                ownerOverrides={ownerOverrides}
                colors={loaded.colors}
                selectionMode="regions"
                selectedRegionIds={selectedIds}
                onToggleRegion={toggle}
                selectionColor={ACCENT_HEX}
                regionHint={null}
                regionBorders
                focusRegionId={focusId}
                onHoverRegion={setHoverId}
                regionMapHeight="auto"
              />
            ) : (
              <div style={{ color: MUTED, fontSize: "0.8rem", padding: "1rem" }}>Loading the map…</div>
            )}
          </div>

          <aside style={{ display: "flex", flex: isMobile ? "1 1 54%" : "0 0 21rem", flexDirection: "column", gap: "0.5rem", minHeight: 0, minWidth: 0 }}>
            <input
              ref={searchRef}
              aria-label="Search regions"
              placeholder="Search regions by name…"
              className="oh-tap-row"
              style={fieldStyle}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {!single && (
              <div style={{ display: "flex", gap: "0.4rem", minWidth: 0 }}>
                <select aria-label="Country" className="oh-tap-row" style={{ ...fieldStyle, cursor: "pointer", flex: "1 1 auto" }} value={owner} onChange={(event) => setOwner(event.target.value)}>
                  <option style={optionStyle} value="">Choose a country…</option>
                  {owners.map((entry) => <option key={entry.owner} style={optionStyle} value={entry.owner}>{entry.owner} ({entry.count})</option>)}
                </select>
                <button
                  type="button"
                  className="oh-tap-row"
                  disabled={!owner}
                  onClick={() => setSelected((current) => toggleOwnerRegions(current, rows, owner))}
                  style={smallButton({ cursor: owner ? "pointer" : "default", flex: "0 0 auto", opacity: owner ? 1 : 0.5 })}
                >
                  {owner && ownerSelectedCount === ownerCount ? "Deselect all" : "Select all"}
                </button>
              </div>
            )}

            {query.trim() ? (
              <div role="list" aria-label="Matching regions" style={{ display: "grid", gap: "0.25rem", maxHeight: isMobile ? "9rem" : "40%", overflowY: "auto" }}>
                {matches.length === 0 && <div style={{ color: MUTED, fontSize: "0.74rem", padding: "0.3rem" }}>No region by that name.</div>}
                {matches.map((row) => {
                  const on = selectedIds.has(row.id);
                  return (
                    <button
                      key={row.id}
                      type="button"
                      role="listitem"
                      aria-pressed={on}
                      className="oh-tap-row"
                      onClick={() => { toggle(row.id); setFocusId(row.id); }}
                      style={smallButton({ background: on ? "rgba(0,0,0,0.42)" : CARD, borderColor: on ? ACCENT : LINE, justifyContent: "space-between", textAlign: "left", width: "100%" })}
                    >
                      <span data-no-translate style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                      <span data-no-translate style={{ color: MUTED, flex: "0 0 auto", fontSize: "0.66rem" }}>{row.owner}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: MUTED, fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                {selected.length === 1 ? "1 selected" : `${selected.length} selected`}
              </span>
              {selected.length > 0 && (
                <button type="button" className="oh-tap-row" onClick={() => setSelected([])} style={smallButton({ minHeight: "1.7rem" })}>Clear</button>
              )}
            </div>
            <div role="list" aria-label="Selected regions" style={{ alignContent: "flex-start", display: "flex", flex: "1 1 auto", flexWrap: "wrap", gap: "0.3rem", minHeight: "2.5rem", overflowY: "auto" }}>
              {selected.length === 0 && <div style={{ color: MUTED, fontSize: "0.74rem" }}>{single ? "Click a region on the map." : "Click regions on the map, or search for them."}</div>}
              {selected.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="listitem"
                  className="oh-tap-row"
                  aria-label={`Remove ${entry.name}`}
                  title={entry.id}
                  onClick={() => setSelected((current) => current.filter((item) => item.id !== entry.id))}
                  style={smallButton({ borderColor: ACCENT, minHeight: "1.8rem" })}
                >
                  <span data-no-translate>{entry.name}</span>
                  <span aria-hidden="true" style={{ color: MUTED }}>×</span>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: "0.45rem", justifyContent: "flex-end" }}>
              <button type="button" className="oh-tap-row" onClick={onClose} style={smallButton()}>Cancel</button>
              <button
                type="button"
                className="oh-tap-row"
                disabled={!selected.length}
                onClick={() => onDone?.(selected)}
                style={smallButton({ background: selected.length ? ACCENT : CARD, borderColor: selected.length ? ACCENT : LINE, color: selected.length ? "#06131a" : MUTED, cursor: selected.length ? "pointer" : "default", fontWeight: 800 })}
              >
                {doneLabel}
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(sheet, document.body);
};

export default ScriptedRegionPicker;
