/*!
 * Open Historia Map Editor - non-sovereign group management workspace.
 * Native world.groups / groupAreas remain distinct from sovereign ownership.
 */
import { useMemo, useRef, useState } from "react";
import Panel from "./Panel.jsx";
import { inputStyle, labelDim, pillButton } from "./editorStyles.js";
import { groupRowsForWorkspace } from "./editorWorkspaceFilters.js";
import {
  WorkspaceActions, WorkspaceEmpty, WorkspaceHeading, WorkspaceSearch,
  WorkspaceSelect, WorkspaceStats, WorkspaceTabs, workspaceCard, workspaceMuted, workspaceRow,
} from "./EditorWorkspaceControls.jsx";
import { formatPopulationFigure, readPopulationFigure } from "../runtime/populationFigure.js";
import {
  GROUP_DESCRIPTION_MAX, GROUP_NAME_MAX, GROUP_PALETTE, MAX_GROUPS, canRenameGroup,
  defaultGroupColor, findGroupKey, normalizeGroupColor, normalizeGroupDescription,
  normalizeGroupName,
} from "../runtime/groups.js";
import { groupEraseSteps, groupRenameSteps } from "./documentUndo.js";
import MilitaryFields from "./MilitaryFields.jsx";
import { rateMilitaryFigures } from "../Game/AI/militaryRating.js";
import { militaryScaleOf } from "./militaryForm.js";
import { confirmDialog } from "../runtime/uiDialog.js";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "identity", label: "Identity" },
  { id: "territory", label: "Territory" },
  { id: "forces", label: "Forces" },
  { id: "appearance", label: "Appearance" },
  { id: "manage", label: "Organization" },
];
const Swatch = ({ color, size = 16 }) => <span aria-hidden="true" style={{
  width: size, height: size, borderRadius: 5, flexShrink: 0,
  background: color, border: "1px solid var(--oh-ui-line, rgba(255,255,255,.2))",
}}/>;
const labeledInput = { ...inputStyle, padding: "8px 10px" };

const GroupsPanel = ({
  api, groups = {}, setGroups, polities = {}, selection = [], regionEpoch = 0,
  militaryDefaults = null, onClose,
}) => {
  const [selectedName, setCurrent] = useState("");
  const [tab, setTab] = useState("overview");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newColor, setNewColor] = useState(GROUP_PALETTE[0]);
  const [assignSelection, setAssignSelection] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [note, setNote] = useState("");

  const usage = useMemo(
    () => api?.listGroupUsage?.() || {},
    // The native map changes its region source in place; regionEpoch signals changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, regionEpoch],
  );
  const allNames = useMemo(() => new Set([...Object.keys(groups || {}), ...Object.keys(usage)]), [groups, usage]);
  const current = selectedName && allNames.has(selectedName) ? selectedName : "";
  const rows = useMemo(() => groupRowsForWorkspace(groups, usage, { query, scope }), [groups, usage, query, scope]);
  const recordOf = (name) => groups?.[name] ?? { name, description: "", color: defaultGroupColor(name) };
  const record = current ? recordOf(current) : null;
  const selectedInGroup = current && api?.getRegionSummary
    ? selection.filter((id) => api.getRegionSummary(id)?.group === current) : [];
  const polityOptions = [{ value: "", label: "Independent group / no polity sponsor" },
    ...Object.keys(polities || {}).sort((a, b) => a.localeCompare(b))
      .map((key) => ({ value: key, label: polities?.[key]?.name || key }))];
  if (record?.owner && !polityOptions.some((row) => row.value === record.owner)) {
    polityOptions.push({ value: record.owner, label: `${record.owner} (not in polity registry)` });
  }
  const recordCount = allNames.size;
  const controlledCount = Object.values(usage).reduce((sum, count) => sum + count, 0);


  const open = (name) => {
    setCurrent(name); setDraftName(name); setTab("overview");
    setCreating(false); setDeleteArmed(false); setNote("");
  };
  const patchRecord = (name, patch) => {
    setGroups((registry) => ({
      ...registry, [name]: { ...recordOf(name), ...(registry?.[name] ?? {}), ...patch, name },
    }));
  };

  const confirmingRef = useRef(false);
  const liveGroupStateRef = useRef({ allNames, groups, recordCount, selection, api });
  liveGroupStateRef.current = { allNames, groups, recordCount, selection, api };

  const create = async () => {
    if (confirmingRef.current) return;
    const name = normalizeGroupName(newName);
    if (!name) { setNote("Enter a group name."); return; }
    const collision = findGroupKey(Object.fromEntries([...allNames].map((key) => [key, recordOf(key)])), name);
    if (collision) { setNote(`The name or historical alias already belongs to ${collision}.`); return; }
    if (recordCount >= MAX_GROUPS) { setNote(`This scenario already has the maximum of ${MAX_GROUPS} groups.`); return; }
    if (assignSelection && selection.length && !api?.setRegionAttrs) {
      setNote("The map selection cannot be assigned here."); return;
    }
    if (assignSelection && selection.length) {
      confirmingRef.current = true;
      let confirmed = false;
      try {
        confirmed = await confirmDialog(
          `Create "${name}" and give it control of ${selection.length} selected regions? Existing group control on those regions will be replaced. Political ownership is unchanged.`,
        );
      } finally {
        confirmingRef.current = false;
      }
      if (!confirmed) return;
    }
    const live = liveGroupStateRef.current;
    const latestRecordOf = (key) => live.groups?.[key] ?? { name: key, description: "", color: defaultGroupColor(key) };
    const liveCollision = findGroupKey(Object.fromEntries([...live.allNames].map((key) => [key, latestRecordOf(key)])), name);
    if (liveCollision) {
      const collision = liveCollision;
      setNote(`The name or historical alias already belongs to ${collision}.`);
      return;
    }
    if (live.recordCount >= MAX_GROUPS) { setNote(`This scenario already has the maximum of ${MAX_GROUPS} groups.`); return; }
    const targetSelection = assignSelection ? live.selection : [];
    const liveApi = live.api;
    if (targetSelection.length && !liveApi?.setRegionAttrs) {
      setNote("The map selection cannot be assigned here."); return;
    }
    const color = normalizeGroupColor(newColor) || defaultGroupColor(name);
    const description = normalizeGroupDescription(newDescription);
    const createdRecord = { name, description, color };
    const assignedCount = targetSelection.length;
    const applyGroup = () => setGroups((registry) => ({ ...registry, [name]: createdRecord }));
    const removeGroup = () => setGroups((registry) => {
      const next = { ...(registry || {}) };
      delete next[name];
      return next;
    });

    if (liveApi?.pushStep) {
      const regionStep = assignedCount ? liveApi.setRegionAttrs(targetSelection, { group: name }, { deferHistory: true }) : null;
      applyGroup();
      liveApi.pushStep({
        undo: () => {
          regionStep?.undo();
          removeGroup();
        },
        redo: () => {
          applyGroup();
          regionStep?.redo();
        },
      });
    } else {
      applyGroup();
      if (assignedCount) liveApi?.setRegionAttrs(targetSelection, { group: name });
    }
    setNewName(""); setNewDescription(""); setAssignSelection(false); setCreating(false);
    open(name);
    setNote(`Created ${name}${assignedCount ? ` with ${assignedCount} controlled regions` : ""}.`);
  };

  const rename = () => {
    const to = normalizeGroupName(draftName);
    if (!current || to === current) return;
    if (!to || !canRenameGroup(Object.fromEntries([...allNames].map((key) => [key, recordOf(key)])), current, to)) {
      setNote("The new name is empty or already belongs to another group or former name.");
      setDraftName(current); return;
    }
    const from = current;
    const steps = groupRenameSteps(setGroups, from, to, recordOf(from));
    if (api?.retagGroup) api.retagGroup(from, to, steps);
    else steps.redo();
    setCurrent(to); setDraftName(to); setNote(`Renamed ${from} to ${to}. The controlled area follows the rename.`);
  };
  const erase = () => {
    if (!current) return;
    const name = current;
    const steps = groupEraseSteps(setGroups, name, groups?.[name] ?? null);
    if (api?.retagGroup) api.retagGroup(name, null, steps);
    else steps.redo();
    setCurrent(""); setDeleteArmed(false);
    setNote(`Dissolved ${name}; its territorial control was removed without transferring sovereignty.`);
  };

  const changedAreas = async (ids, nextGroup, actionLabel) => {
    if (!ids.length || !api?.setRegionAttrs) return;
    if (ids.length > 1 && !(await confirmDialog(
      `${actionLabel} for ${ids.length} selected regions? This changes group control, not polity ownership.`,
    ))) return;
    api.setRegionAttrs(ids, { group: nextGroup });
    setNote(`${actionLabel}: ${ids.length} region${ids.length === 1 ? "" : "s"}. Undo restores previous control.`);
  };

  return <Panel title="Groups" icon="list" width={490} onClose={onClose}>
    {!current && <>
      <WorkspaceHeading title="Non-sovereign actors" detail="Political movements, organizations, militias, insurgencies and other groups. A group may exist without controlling any territory."/>
      <WorkspaceStats items={[
        { label: "Groups", value: recordCount },
        { label: "With territory", value: Object.values(usage).filter(Boolean).length },
        { label: "Controlled regions", value: controlledCount.toLocaleString() },
      ]}/>
      <WorkspaceSearch value={query} onChange={setQuery} placeholder="Find group, description or sponsor…"/>
      <WorkspaceSelect label="Territorial presence" value={scope} onChange={setScope}
        options={[
          { value: "all", label: "All groups" },
          { value: "territorial", label: "Control territory" },
          { value: "landless", label: "No controlled territory" },
        ]}/>
      <WorkspaceActions>
        <span style={{ ...workspaceMuted, flex: 1 }}>{rows.length} of {recordCount} groups</span>
        <button type="button" style={pillButton(true)} onClick={() => { setCreating(!creating); setNote(""); }}>
          {creating ? "Cancel creation" : "+ Create group"}
        </button>
      </WorkspaceActions>
      {creating && <section style={{ ...workspaceCard, display: "grid", gap: 9 }} aria-label="Create a group">
        <WorkspaceHeading title="New group" detail="Identity is separate from territory. Nothing is assigned unless you explicitly choose it."/>
        <label style={{ display: "grid", gap: 4 }}><span style={labelDim}>Name</span>
          <input maxLength={GROUP_NAME_MAX} value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. National Liberation Front" style={labeledInput}/>
        </label>
        <label style={{ display: "grid", gap: 4 }}><span style={labelDim}>Description / scenario role</span>
          <textarea value={newDescription} maxLength={GROUP_DESCRIPTION_MAX}
            onChange={(e) => setNewDescription(e.target.value)} rows={4} style={{ ...labeledInput, resize: "vertical" }}
            placeholder="What this organization is, wants and does in the scenario."/>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, ...workspaceMuted }}>
          <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)}/> Map tint
        </label>
        {selection.length > 0 && <label style={{ display: "flex", alignItems: "center", gap: 7, ...workspaceMuted }}>
          <input type="checkbox" checked={assignSelection} onChange={(e) => setAssignSelection(e.target.checked)}/>
          Also give this group control over the {selection.length} selected map regions
        </label>}
        <button type="button" disabled={!normalizeGroupName(newName) || recordCount >= MAX_GROUPS}
          style={{ ...pillButton(true), opacity: recordCount >= MAX_GROUPS ? .5 : 1 }}
          onClick={create}>Create organization</button>
      </section>}
      {rows.length === 0 && <WorkspaceEmpty title="No matching groups" description={recordCount
        ? "Change the search or territorial filter." : "Create a non-sovereign actor to define its role and appearance."}/>}
      <div role="list" aria-label="Groups roster" style={{ display: "grid", gap: 5 }}>
        {rows.map(({ key, record: group, regions }) => <div role="listitem" key={key}>
          <button type="button" onClick={() => open(key)} style={{ ...workspaceRow(), width: "100%", display: "flex", alignItems: "center", gap: 9, textAlign: "left", color: "var(--oh-ui-text, white)", cursor: "pointer" }}>
            <Swatch color={normalizeGroupColor(group?.color) || defaultGroupColor(key)}/>
            <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 4 }}>
              <strong style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>{key}</strong>
              <span style={workspaceMuted}>{group?.description ? `${group.description.slice(0, 105)}${group.description.length > 105 ? "…" : ""}` : "Description not yet defined"}</span>
              <span style={workspaceMuted}>{regions ? `${regions} controlled region${regions === 1 ? "" : "s"}` : "No controlled territory"}{group?.owner ? ` · Linked to ${polities?.[group.owner]?.name || group.owner}` : ""}</span>
            </span>
            <span aria-hidden="true">›</span>
          </button>
        </div>)}
      </div>
    </>}

    {current && record && <>
      <WorkspaceActions>
        <button type="button" style={pillButton(false)} onClick={() => { setCurrent(""); setNote(""); }}>← All groups</button>
        <span style={{ ...workspaceMuted, marginLeft: "auto" }}>Non-sovereign actor</span>
      </WorkspaceActions>
      <div style={{ ...workspaceCard, display: "flex", alignItems: "center", gap: 11 }}>
        <Swatch color={normalizeGroupColor(record.color) || defaultGroupColor(current)} size={34}/>
        <div style={{ minWidth: 0, flex: 1, display: "grid", gap: 4 }}>
          <strong style={{ fontSize: 16, overflowWrap: "anywhere" }}>{current}</strong>
          <span style={workspaceMuted}>{usage[current]
            ? `${usage[current]} controlled regions`
            : "No controlled territory"} · {record.owner ? `Linked to ${polities?.[record.owner]?.name || record.owner}` : "Independent actor"}</span>
        </div>
      </div>
      <WorkspaceTabs label="Group details" tabs={TABS} active={tab}
        onChange={(next) => { setTab(next); setDeleteArmed(false); }}/>

      {tab === "overview" && <div style={{ display: "grid", gap: 9 }}>
        <WorkspaceHeading title="Organization overview" detail="Starting scenario state. Territory does not determine whether the group exists."/>
        <div style={{ ...workspaceCard, display: "grid", gap: 7 }}>
          <span style={labelDim}>Role in the scenario</span>
          <span style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{record.description || "No description authored yet. Add one in Identity so the AI knows what this group is."}</span>
        </div>
        <WorkspaceStats items={[
          { label: "Controlled regions", value: usage[current] || 0 },
          { label: "Population", value: record.population ? formatPopulationFigure(record.population) : "Unset" },
          { label: "Military figures", value: record.military ? "Authored" : "Unset" },
        ]}/>
        <div style={workspaceMuted}>Controlled territory overlays existing polities; it never annexes their land.</div>
        <WorkspaceActions>
          <button type="button" style={pillButton(false)} onClick={() => setTab("identity")}>Edit identity</button>
          <button type="button" style={pillButton(false)} onClick={() => setTab("territory")}>Manage territory</button>
          <button type="button" style={pillButton(false)} onClick={() => setTab("forces")}>Edit forces</button>
        </WorkspaceActions>
      </div>}

      {tab === "identity" && <div style={{ display: "grid", gap: 9 }}>
        <WorkspaceHeading title="Identity & purpose" detail="Name and description are read by the scenario simulation."/>
        <label style={{ display: "grid", gap: 4 }}><span style={labelDim}>Group name</span>
          <input value={draftName} maxLength={GROUP_NAME_MAX} onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); rename(); } }} style={labeledInput}/>
        </label>
        <button type="button" style={pillButton(false)} disabled={!normalizeGroupName(draftName) || draftName === current} onClick={rename}>
          Apply rename (including controlled regions)
        </button>
        <label style={{ display: "grid", gap: 4 }}><span style={labelDim}>Description / AI context</span>
          <textarea value={record.description || ""} maxLength={GROUP_DESCRIPTION_MAX}
            onChange={(e) => patchRecord(current, { description: e.target.value })}
            onBlur={(e) => patchRecord(current, { description: normalizeGroupDescription(e.target.value) })}
            rows={6} style={{ ...labeledInput, resize: "vertical" }}
            placeholder="Who is this group? What does it want? What is its role in this scenario?"/>
        </label>
        <WorkspaceSelect label="Country whose force this is (optional)" value={record.owner || ""}
          onChange={(value) => patchRecord(current, { owner: value || undefined })}
          options={polityOptions}/>
        <div style={workspaceMuted}>This link is only for groups representing a country's own forces. It is not general political affiliation or membership.</div>
      </div>}

      {tab === "territory" && <div style={{ display: "grid", gap: 9 }}>
        <WorkspaceHeading title="Controlled territory" detail="Manage an overlay of control; sovereign region owners remain unchanged."/>
        <WorkspaceStats items={[
          { label: "Group controls", value: usage[current] || 0 },
          { label: "Map selected", value: selection.length },
          { label: "Selected in group", value: selectedInGroup.length },
        ]}/>
        <WorkspaceActions>
          <button type="button" style={pillButton(false)} disabled={!usage[current]}
            onClick={() => api?.selectGroup?.(current, { zoom: true })}>Select & focus group territory</button>
          <button type="button" style={pillButton(true)} disabled={!selection.length}
            onClick={() => changedAreas(selection, current, "Assign control")}>Give group selected regions</button>
          <button type="button" style={pillButton(false)} disabled={!selectedInGroup.length}
            onClick={() => changedAreas(selectedInGroup, null, "Remove group control")}>Release selected regions</button>
        </WorkspaceActions>
        <span style={workspaceMuted}>{usage[current]
          ? "Use the map or Regions workspace to adjust your selection. Assigning control replaces any previous group control over those regions."
          : "This group controls no regions. It remains a valid actor until explicitly dissolved."}</span>
      </div>}

      {tab === "forces" && <div style={{ display: "grid", gap: 10 }}>
        <WorkspaceHeading title="Population & military" detail="Optional starting capabilities. Unset values retain the scenario's native defaults."/>
        <label style={{ display: "grid", gap: 4 }}><span style={labelDim}>Population when the scenario begins</span>
          <input key={current} defaultValue={formatPopulationFigure(record.population)} inputMode="numeric"
            onBlur={(e) => { const people = readPopulationFigure(e.target.value); e.target.value = formatPopulationFigure(people); patchRecord(current, { population: people > 0 ? people : undefined }); }}
            placeholder="Unset: derived from controlled territory when applicable" style={labeledInput}/>
        </label>
        <MilitaryFields recordKey={current} value={record.military} defaults={militaryDefaults}
          onChange={(military) => patchRecord(current, { military: military ?? undefined })}
          onRate={() => rateMilitaryFigures({
            name: current, note: record.description, population: record.population,
            rated: militaryScaleOf({}, groups), date: militaryDefaults?.gameDate,
            era: Number.isInteger(militaryDefaults?.era) ? militaryDefaults.era : null,
            rules: militaryDefaults?.rules,
          })}/>
      </div>}

      {tab === "appearance" && <div style={{ display: "grid", gap: 9 }}>
        <WorkspaceHeading title="Map appearance" detail="Group control is tinted over the existing political map."/>
        <WorkspaceActions>
          <Swatch color={normalizeGroupColor(record.color) || defaultGroupColor(current)} size={30}/>
          <strong style={{ fontSize: 12 }}>{normalizeGroupColor(record.color) || defaultGroupColor(current)}</strong>
        </WorkspaceActions>
        <div aria-label="Group tint palette" style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {GROUP_PALETTE.map((color) => <button type="button" key={color} aria-label={`Set group tint ${color}`}
            aria-pressed={normalizeGroupColor(record.color) === color} onClick={() => patchRecord(current, { color })}
            style={{ background: color, width: 28, height: 28, borderRadius: 7, cursor: "pointer",
              border: normalizeGroupColor(record.color) === color ? "3px solid var(--oh-ui-text, white)" : "1px solid var(--oh-ui-line, #444)" }}/>)}
        </div>
        <label style={{ ...workspaceMuted, display: "flex", alignItems: "center", gap: 9 }}>
          <input type="color" aria-label="Custom group tint" value={normalizeGroupColor(record.color) || GROUP_PALETTE[0]}
            onChange={(e) => patchRecord(current, { color: e.target.value })}/> Custom tint
        </label>
      </div>}

      {tab === "manage" && <div style={{ display: "grid", gap: 9 }}>
        <WorkspaceHeading title="Manage organization" detail="Dissolving removes both the group registry entry and its controlled territory."/>
        <div style={workspaceMuted}>This does not delete countries, change sovereign ownership, or remove units belonging to other entities.</div>
        <button type="button" onClick={() => (deleteArmed ? erase() : setDeleteArmed(true))}
          style={{ ...pillButton(false), color: "#f87171" }}>
          {deleteArmed ? `Confirm dissolution of ${current}` : "Dissolve this group"}
        </button>
        {deleteArmed && <button type="button" onClick={() => setDeleteArmed(false)} style={pillButton(false)}>Cancel dissolution</button>}
      </div>}
    </>}
    {note && <div role="status" style={{ ...workspaceCard, fontSize: 11.5 }}>{note}</div>}
  </Panel>;
};
export default GroupsPanel;
