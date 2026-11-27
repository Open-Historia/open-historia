/*!
 * Open Historia Map Editor - scenario starting forces workspace.
 * Source of truth: the existing editor units list -> world.units.
 */
import { useMemo, useRef, useState } from "react";
import Panel from "./Panel.jsx";
import { pillButton } from "./editorStyles.js";
import { filterUnitsForWorkspace, pageOf, WORKSPACE_PAGE_SIZE } from "./editorWorkspaceFilters.js";
import {
  WorkspaceActions, WorkspaceEmpty, WorkspaceHeading, WorkspaceMore, WorkspaceSearch,
  WorkspaceSelect, WorkspaceStats, workspaceCard, workspaceMuted, workspaceRow,
} from "./EditorWorkspaceControls.jsx";
import { confirmDialog } from "../runtime/uiDialog.js";

const TYPE_LABELS = { infantry: "Infantry", armor: "Armour", air: "Air", naval: "Naval", artillery: "Artillery", garrison: "Garrison" };

const UnitsPanel = ({
  units = [], unitTypes = [], polityName = (key) => key,
  activeTool, setActiveTool, onLocate, onEdit, onRemove, onRemoveAll, onClose,
}) => {
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("*");
  const [kind, setKind] = useState("*");
  const [shown, setShown] = useState(WORKSPACE_PAGE_SIZE);
  const [focused, setFocused] = useState("");
  const confirmingRef = useRef(false);

  const filtered = useMemo(() => filterUnitsForWorkspace(units, {
    query, owner, kind, unitTypes, polityName,
  }), [units, query, owner, kind, unitTypes, polityName]);
  const visible = useMemo(() => pageOf(filtered, shown), [filtered, shown]);
  const ownerKeys = useMemo(() => [...new Set(units.map((u) => String(u.ownerCode || "")))]
    .sort((a, b) => polityName(a).localeCompare(polityName(b))), [units, polityName]);
  const kinds = useMemo(() => [...new Set(units.map((u) => String(u.type || "")))]
    .filter(Boolean).sort(), [units]);
  const uniqueOwners = ownerKeys.filter(Boolean).length;
  const focusedUnit = units.find((u) => u.id === focused);
  const placing = activeTool === "unit";

  const labelOf = (u) => {
    const custom = unitTypes.find((t) => t.id === u.unitType);
    return custom ? custom.name : TYPE_LABELS[u.type] || u.type || "Unspecified type";
  };
  const coords = (u) => {
    const lng = Number(u.lng);
    const lat = Number(u.lat);
    return Number.isFinite(lng) && Number.isFinite(lat) ? `${lng.toFixed(3)}°, ${lat.toFixed(3)}°` : "Position not specified";
  };

  return (
    <Panel
      title="Starting units"
      icon="unit"
      width={490}
      onClose={onClose}
      footer={
        <WorkspaceActions>
          <span style={{ ...workspaceMuted, flex: 1 }}>{units.length.toLocaleString()} units at scenario start</span>
          {units.length > 0 && (
            <button
              type="button"
              style={{ ...pillButton(false), color: "#f87171" }}
              onClick={() => onRemoveAll?.()}
            >
              Delete all…
            </button>
          )}
        </WorkspaceActions>
      }
    >
      <WorkspaceHeading
        title="Starting military deployment"
        detail="Place and inspect the units physically present when a new campaign begins. Country military statistics are edited separately."
      />
      <WorkspaceStats items={[
        { label: "Starting units", value: units.length },
        { label: "Polities fielding units", value: uniqueOwners },
        { label: "Matching", value: filtered.length },
      ]} />
      <button
        type="button"
        onClick={() => setActiveTool?.(placing ? "select" : "unit")}
        style={{ ...pillButton(placing), padding: 10, textAlign: "left" }}
      >
        {placing ? "✓ Placement active — click the map to add a unit; click here to stop" : "+ Place a starting unit on the map"}
      </button>
      <div style={workspaceMuted}>
        The native unit editor lets you choose its owner, infantry/armour/air/naval/artillery/garrison type, strength, name, composition and orders. This list shows units already placed, not estimated national armed forces.
      </div>
      {units.length === 0 ? (
        <WorkspaceEmpty
          title="No units placed yet"
          description="This scenario has no explicitly positioned starting units. It does not mean that every polity has zero military forces. Select Place a starting unit, then click a location on the map."
        />
      ) : (
        <>
          <WorkspaceSearch value={query} onChange={(value) => { setQuery(value); setShown(WORKSPACE_PAGE_SIZE); }} placeholder="Find unit, country, type or composition…" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            <WorkspaceSelect
              label="Polity"
              value={owner}
              onChange={(value) => { setOwner(value); setShown(WORKSPACE_PAGE_SIZE); }}
              options={[{ value: "*", label: "All polities" }, ...ownerKeys.map((key) => ({ value: key, label: key ? polityName(key) : "Unassigned" }))]}
            />
            <WorkspaceSelect
              label="Unit type"
              value={kind}
              onChange={(value) => { setKind(value); setShown(WORKSPACE_PAGE_SIZE); }}
              options={[{ value: "*", label: "All types" }, ...kinds.map((key) => ({ value: key, label: TYPE_LABELS[key] || key }))]}
            />
          </div>
          <WorkspaceHeading title="Deployment roster" detail={`Showing ${visible.length} of ${filtered.length} matching (${units.length} total)`} />
          {!filtered.length && <WorkspaceEmpty title="No matching deployments" description="Change the search or filters; placed units are untouched." />}
          <div role="list" aria-label="Starting unit roster" style={{ display: "grid", gap: 5 }}>
            {visible.map((u) => (
              <div role="listitem" key={u.id}>
                <button
                  type="button"
                  onClick={() => { setFocused(u.id); onLocate?.(u); }}
                  style={{ ...workspaceRow(focused === u.id), width: "100%", cursor: "pointer", color: "var(--oh-ui-text, white)", textAlign: "left", display: "flex", gap: 8, alignItems: "center" }}
                >
                  <span style={{ flex: 1, display: "grid", gap: 4 }}>
                    <strong style={{ fontSize: 12.5 }}>{u.name || "Unnamed unit"}</strong>
                    <span style={workspaceMuted}>{labelOf(u)} · {polityName(u.ownerCode) || "Unassigned"} · {u.strength ?? 100}% strength</span>
                    <span style={workspaceMuted}>{coords(u)}{u.composition ? ` · ${u.composition.slice(0, 95)}` : ""}</span>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              </div>
            ))}
          </div>
          <WorkspaceMore shown={visible.length} total={filtered.length} onMore={() => setShown((n) => n + WORKSPACE_PAGE_SIZE)} />
        </>
      )}
      {focusedUnit && (
        <section style={{ ...workspaceCard, display: "grid", gap: 8 }} aria-label="Unit inspector">
          <WorkspaceHeading title={focusedUnit.name || "Unnamed unit"} detail="Selected starting formation" />
          <div style={workspaceMuted}>
            <div>Deployed by: {polityName(focusedUnit.ownerCode) || "Unassigned"}</div>
            <div>Type: {labelOf(focusedUnit)} · Strength: {focusedUnit.strength ?? 100}%</div>
            <div>Coordinates: {coords(focusedUnit)}</div>
            {focusedUnit.composition && <div>Composition: {focusedUnit.composition}</div>}
            {focusedUnit.note && <div>Orders: {focusedUnit.note}</div>}
          </div>
          <WorkspaceActions>
            <button type="button" style={pillButton(true)} onClick={() => onEdit?.(focusedUnit.id)}>Edit formation</button>
            <button type="button" style={pillButton(false)} onClick={() => onLocate?.(focusedUnit)}>Locate on map</button>
            <button
              type="button"
              style={{ ...pillButton(false), color: "#f87171", marginLeft: "auto" }}
              onClick={async () => {
                if (confirmingRef.current) return;
                confirmingRef.current = true;
                try {
                  if (await confirmDialog(`Delete "${focusedUnit.name || focusedUnit.id}" from this scenario's starting units?`, { danger: true, confirmLabel: "Delete" })) {
                    onRemove?.(focusedUnit.id);
                    setFocused("");
                  }
                } finally {
                  confirmingRef.current = false;
                }
              }}
            >
              Delete unit
            </button>
          </WorkspaceActions>
        </section>
      )}
    </Panel>
  );
};

export default UnitsPanel;
