/*!
 * Open Historia Map Editor - region management workspace.
 * The OpenLayers source owns region geometry, attributes and undo history.
 */
import { useMemo, useRef, useState } from "react";
import Panel from "./Panel.jsx";
import { inputStyle, labelDim, pillButton } from "./editorStyles.js";
import { polityDisplayName } from "./regionSearch.js";
import { filterRegionsForWorkspace, pageOf, selectionAfterWorkspacePick, WORKSPACE_PAGE_SIZE } from "./editorWorkspaceFilters.js";
import {
  WorkspaceActions, WorkspaceEmpty, WorkspaceHeading, WorkspaceMore, WorkspaceSearch,
  WorkspaceSelect, WorkspaceStats, workspaceCard, workspaceMuted, workspaceRow,
} from "./EditorWorkspaceControls.jsx";
import { confirmDialog } from "../runtime/uiDialog.js";

const clean = (v) => String(v ?? "").trim();
const ordered = (values) => [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

const RegionsPanel = ({ api, polities = {}, types = [], groups = {}, selection = [], setSelection, regionEpoch = 0, onClose }) => {
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("*");
  const [typeId, setTypeId] = useState("*");
  const [group, setGroup] = useState("*");
  const [sort, setSort] = useState("name");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [shown, setShown] = useState(WORKSPACE_PAGE_SIZE);
  const [nameDraft, setNameDraft] = useState({ id: "", text: "" });
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkType, setBulkType] = useState("");
  const [bulkGroup, setBulkGroup] = useState("");
  const [note, setNote] = useState("");
  const anchor = useRef(null);

  // Query the real OpenLayers region registry, not only the first 300 search
  // results. No serialized geometry is copied into React state.
  const all = useMemo(
    () => api?.queryRegions?.("", 100000, { polities }) || [],
    // The OpenLayers source changes in place; the native map notifies regionEpoch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, polities, regionEpoch],
  );
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const ownerKeys = useMemo(() => ordered(new Set([...Object.keys(polities || {}), ...all.map((r) => clean(r.owner))].filter(Boolean))), [polities, all]);
  const typeKeys = useMemo(() => ordered(new Set([...types.map((t) => t.id), ...all.map((r) => clean(r.typeId))].filter(Boolean))), [types, all]);
  const groupKeys = useMemo(() => ordered(new Set([...Object.keys(groups || {}), ...all.map((r) => clean(r.group))].filter(Boolean))), [groups, all]);
  const typeLabel = (id) => types.find((t) => t.id === id)?.name || id || "Land";
  const filtered = useMemo(() => filterRegionsForWorkspace(all, {
    query, owner, typeId, group, selectedOnly, selectedIds: selection, polities, sort,
  }), [all, query, owner, typeId, group, selectedOnly, selection, polities, sort]);
  const visible = useMemo(() => pageOf(filtered, shown), [filtered, shown]);
  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const current = selection.length === 1 ? api?.getRegionSummary?.(selection[0]) : null;
  const draftName = nameDraft.id === current?.id ? nameDraft.text : current?.name || "";
  const selectedRows = useMemo(() => all.filter((r) => selectedSet.has(r.id)), [all, selectedSet]);
  const counts = useMemo(() => ({
    owners: new Set(selectedRows.map((r) => r.owner || "")).size,
    types: new Set(selectedRows.map((r) => r.typeId || "land")).size,
    groups: new Set(selectedRows.map((r) => r.group || "")).size,
  }), [selectedRows]);


  const selectRow = (event, id) => {
    const additive = event.ctrlKey || event.metaKey;
    const next = selectionAfterWorkspacePick(selection, filteredIds, id, {
      additive: additive || event.shiftKey, range: event.shiftKey, anchor: anchor.current,
    });
    setSelection?.(next);
    if (!event.shiftKey) anchor.current = id;
    if (!additive && !event.shiftKey) api?.zoomToRegion?.(id);
  };
  const confirmingRef = useRef(false);
  const liveRegionsRef = useRef({ api, selectedRows });
  liveRegionsRef.current = { api, selectedRows };

  const apply = async (patch, label) => {
    if (confirmingRef.current) return;
    const ids = selectedRows.map((r) => r.id);
    if (!ids.length || !api?.setRegionAttrs) return;
    if (ids.length > 1) {
      confirmingRef.current = true;
      let ok = false;
      try {
        ok = await confirmDialog(`Change ${label} for ${ids.length.toLocaleString()} selected regions? This modifies their starting map state.`);
      } finally {
        confirmingRef.current = false;
      }
      if (!ok) return;
    }
    const live = liveRegionsRef.current;
    const confirmedSet = new Set(ids);
    const liveIds = live.selectedRows.map((r) => r.id).filter((id) => confirmedSet.has(id));
    if (!liveIds.length || !live.api?.setRegionAttrs) return;
    live.api.setRegionAttrs(liveIds, patch);
    setNote(`Updated ${label} for ${liveIds.length.toLocaleString()} region${liveIds.length === 1 ? "" : "s"}. Undo restores the previous values.`);
  };
  const options = (keys, labelFor) => keys.map((key) => ({ value: key, label: labelFor(key) }));
  const ownershipOptions = [{ value: "", label: "Unowned / no polity" }, ...options(ownerKeys, (key) => polityDisplayName(polities, key))];
  const groupOptions = [{ value: "", label: "No group control" }, ...options(groupKeys, (key) => key)];
  const filterOptions = (allOptions, anyLabel) => [{ value: "*", label: anyLabel }, ...allOptions];

  return <Panel title="Regions" icon="list" onClose={onClose} width={490}
    footer={<WorkspaceActions>
      <span style={{ ...workspaceMuted, flex: 1 }}>{selectedRows.length.toLocaleString()} selected of {all.length.toLocaleString()} regions</span>
      <button type="button" style={pillButton(false)} disabled={!selectedRows.length}
        onClick={() => api?.zoomToSelection?.(selectedRows.map((r) => r.id))}>Focus selection</button>
    </WorkspaceActions>}>
    <WorkspaceHeading title="Territory workspace" detail="Find, inspect and edit regions together with the map."/>
    <WorkspaceStats items={[
      { label: "Regions", value: all.length.toLocaleString() },
      { label: "Matching", value: filtered.length.toLocaleString() },
      { label: "Selected", value: selectedRows.length.toLocaleString() },
    ]}/>
    <WorkspaceSearch value={query} onChange={(value) => { setQuery(value); setShown(WORKSPACE_PAGE_SIZE); }} placeholder="Find region, code or polity…"/>
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      <WorkspaceSelect label="Polity" value={owner} onChange={(value) => { setOwner(value); setShown(WORKSPACE_PAGE_SIZE); }}
        options={filterOptions(ownershipOptions, "All polities")}/>
      <WorkspaceSelect label="Region type" value={typeId} onChange={(value) => { setTypeId(value); setShown(WORKSPACE_PAGE_SIZE); }}
        options={filterOptions(options(typeKeys, typeLabel), "All types")}/>
      <WorkspaceSelect label="Group control" value={group} onChange={(value) => { setGroup(value); setShown(WORKSPACE_PAGE_SIZE); }}
        options={filterOptions(groupOptions, "All groups")}/>
      <WorkspaceSelect label="Sort by" value={sort} onChange={(value) => { setSort(value); setShown(WORKSPACE_PAGE_SIZE); }} options={[
        { value: "name", label: "Region name" }, { value: "owner", label: "Polity" },
        { value: "type", label: "Type" }, { value: "id", label: "Region code" },
      ]}/>
    </div>
    <label style={{ ...workspaceMuted, display: "flex", alignItems: "center", gap: 7 }}>
      <input type="checkbox" checked={selectedOnly} onChange={(e) => { setSelectedOnly(e.target.checked); setShown(WORKSPACE_PAGE_SIZE); }}/>
      Show selected regions only
    </label>
    <WorkspaceActions>
      <button type="button" style={pillButton(false)} disabled={!filtered.length}
        onClick={() => setSelection?.([...new Set([...selection, ...filteredIds])])}>Add matching to selection</button>
      <button type="button" style={pillButton(false)} disabled={!filtered.length}
        onClick={() => { const matching = new Set(filteredIds); setSelection?.(filteredIds.filter((id) => !selectedSet.has(id)).concat(selection.filter((id) => !matching.has(id)))); }}>Invert matching</button>
      <button type="button" style={pillButton(false)} disabled={!selection.length}
        onClick={() => setSelection?.([])}>Clear selection</button>
    </WorkspaceActions>
    {selectedRows.length > 0 && <section style={{ ...workspaceCard, display: "grid", gap: 9 }} aria-label="Selected region inspector">
      <WorkspaceHeading title={current ? (current.name || current.id) : `${selectedRows.length.toLocaleString()} selected regions`}
        detail={current ? `Region ID: ${current.id}` : `${counts.owners} polities · ${counts.types} types · ${counts.groups} groups`}/>
      {current && <>
        <div style={{ ...workspaceMuted, display: "grid", gap: 2 }}>
          <span>Owner: {polityDisplayName(polities, current.owner) || "Unowned"}</span>
          <span>Type: {typeLabel(current.typeId)} · Group: {current.group || "None"}</span>
          <span>Claims: {current.claimants?.length ? current.claimants.map((c) => polityDisplayName(polities, c)).join(", ") : "None"}</span>
        </div>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={labelDim}>Region name</span>
          <input value={draftName} onChange={(e) => setNameDraft({ id: current.id, text: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (clean(draftName)) { apply({ name: clean(draftName) }, "name"); setNameDraft({ id: "", text: "" }); } } }}
            style={inputStyle} maxLength={150}/>
        </label>
        <button type="button" style={pillButton(false)} disabled={!clean(draftName) || draftName === current.name}
          onClick={() => { apply({ name: clean(draftName) }, "name"); setNameDraft({ id: "", text: "" }); }}>Apply name</button>
      </>}
      <div style={{ ...workspaceMuted }}>Bulk changes affect exactly the current map selection and use the native map Undo stack.</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 6, alignItems: "end" }}>
        <WorkspaceSelect label="Set owner" value={bulkOwner} onChange={setBulkOwner}
          options={[{ value: "", label: "Choose a polity…" }, ...options(ownerKeys, (key) => polityDisplayName(polities, key)), { value: "__unowned__", label: "Unowned (clear owner)" }]}/>
        <button type="button" style={pillButton(true)} disabled={!bulkOwner} onClick={() => apply({ owner: bulkOwner === "__unowned__" ? null : bulkOwner }, "owner")}>Apply</button>
        <WorkspaceSelect label="Set type" value={bulkType} onChange={setBulkType}
          options={[{ value: "", label: "Choose a type…" }, ...options(typeKeys, typeLabel)]}/>
        <button type="button" style={pillButton(true)} disabled={!bulkType} onClick={() => apply({ typeId: bulkType }, "type")}>Apply</button>
        <WorkspaceSelect label="Set group control" value={bulkGroup} onChange={setBulkGroup}
          options={[{ value: "", label: "Choose a group…" }, ...options(groupKeys, (key) => key), { value: "__none__", label: "Clear group control" }]}/>
        <button type="button" style={pillButton(true)} disabled={!bulkGroup} onClick={() => apply({ group: bulkGroup === "__none__" ? null : bulkGroup }, "group control")}>Apply</button>
      </div>
      {note && <span role="status" style={workspaceMuted}>{note}</span>}
    </section>}
    <WorkspaceHeading title="Region browser" detail={filtered.length
      ? `Showing ${Math.min(shown, filtered.length)} of ${filtered.length.toLocaleString()} matches. Click to focus; Ctrl/Cmd-click toggles; Shift-click selects a range.`
      : "No regions match the current filters."}/>
    {filtered.length === 0 && <WorkspaceEmpty title="No matching regions"
      description="Adjust the search or filters. Your map and existing selection are unchanged."/>}
    <div role="list" aria-label="Filtered regions" style={{ display: "grid", gap: 4 }}>
      {visible.map((region) => <div key={region.id} role="listitem">
        <button type="button" aria-pressed={selectedSet.has(region.id)}
          onClick={(e) => selectRow(e, region.id)}
          style={{ ...workspaceRow(selectedSet.has(region.id)), display: "flex", gap: 8, alignItems: "center", textAlign: "left", width: "100%", color: "var(--oh-ui-text, white)", cursor: "pointer" }}>
          <span aria-hidden="true" style={{ fontSize: 14 }}>{selectedSet.has(region.id) ? "☑" : "□"}</span>
          <span style={{ display: "grid", gap: 3, flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>{region.name || region.id}</strong>
            <span style={workspaceMuted}>{region.id} · {polityDisplayName(polities, region.owner) || "Unowned"} · {typeLabel(region.typeId)}{region.group ? ` · ${region.group}` : ""}</span>
          </span>
        </button>
      </div>)}
    </div>
    <WorkspaceMore shown={visible.length} total={filtered.length}
      onMore={() => setShown((count) => count + WORKSPACE_PAGE_SIZE)}/>
  </Panel>;
};

export default RegionsPanel;
