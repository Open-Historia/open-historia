/*!
 * Open Historia Map Editor — groups and the areas they control
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Groups (runtime/groups.js): actors that are not countries — a terrorist
// organisation, a cartel, a militia, a zombie outbreak — each controlling an
// area of regions that stay their countries'. The document keeps the registry
// (name, what the group is, its colour) in doc.groups; a region in a group's
// area carries the group's name as `group`, set here or in the region
// inspector. The export writes world.groups and world.groupAreas, which the game
// outlines and tints and the AI reads, changes and erases (exportPreset.js).

import { useMemo, useState } from "react";
import Panel from "./Panel.jsx";
import { inputStyle, labelDim, pillButton } from "./editorStyles.js";
import {
  GROUP_DESCRIPTION_MAX,
  GROUP_NAME_MAX,
  GROUP_PALETTE,
  defaultGroupColor,
  findGroupKey,
  normalizeGroupColor,
  normalizeGroupDescription,
  normalizeGroupName,
} from "../runtime/groups.js";

const Swatch = ({ color, size = 14 }) => (
  <span
    aria-hidden="true"
    style={{ width: size, height: size, borderRadius: 3, flexShrink: 0, background: color, boxShadow: "0 0 0 1px rgba(0,0,0,0.5)" }}
  />
);

const GroupsPanel = ({ api, groups = {}, setGroups, selection = [], regionEpoch = 0, onClose }) => {
  const [current, setCurrent] = useState("");
  const [draftName, setDraftName] = useState("");
  const [newName, setNewName] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [note, setNote] = useState("");

  // Regions per group, read off the map. A group named on regions but missing
  // from the registry (an older document) is listed too, so it can be managed.
  const usage = useMemo(
    () => (api?.listGroupUsage ? api.listGroupUsage() : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, regionEpoch, groups],
  );
  const names = useMemo(() => {
    const all = new Set([...Object.keys(groups || {}), ...Object.keys(usage)]);
    return [...all].sort((a, b) => a.localeCompare(b));
  }, [groups, usage]);
  const recordOf = (name) => groups?.[name] ?? { name, description: "", color: defaultGroupColor(name) };
  const record = current ? recordOf(current) : null;
  const selectedInGroup = current && api?.getRegionSummary
    ? selection.filter((id) => api.getRegionSummary(id)?.group === current)
    : [];

  const patchRecord = (name, patch) => {
    setGroups((registry) => ({ ...registry, [name]: { ...recordOf(name), ...(registry?.[name] ?? {}), ...patch, name } }));
  };

  const open = (name) => {
    setCurrent(name);
    setDraftName(name);
    setDeleteArmed(false);
    setNote("");
  };

  const create = () => {
    const name = normalizeGroupName(newName);
    if (!name) return;
    const clash = findGroupKey(Object.fromEntries(names.map((key) => [key, recordOf(key)])), name);
    if (clash) {
      setNote(`There is already a group called ${clash}.`);
      return;
    }
    const color = GROUP_PALETTE[names.length % GROUP_PALETTE.length];
    setGroups((registry) => ({ ...registry, [name]: { name, description: "", color } }));
    setNewName("");
    open(name);
    if (selection.length) {
      api?.setRegionAttrs(selection, { group: name });
      setNote(`${name} controls the ${selection.length === 1 ? "selected region" : `${selection.length} selected regions`}.`);
    }
  };

  // Renaming re-keys the record and every region in the area, as one step on
  // the map's undo stack.
  const rename = () => {
    const to = normalizeGroupName(draftName);
    if (!current || !to || to === current) {
      setDraftName(current);
      return;
    }
    const clash = names.find((other) => other !== current && other.toLocaleLowerCase() === to.toLocaleLowerCase());
    if (clash) {
      setNote(`There is already a group called ${clash}.`);
      setDraftName(current);
      return;
    }
    const from = current;
    api?.retagGroup(from, to);
    setGroups((registry) => {
      const next = { ...registry };
      const moved = { ...recordOf(from), ...(registry?.[from] ?? {}), name: to };
      delete next[from];
      next[to] = moved;
      return next;
    });
    setCurrent(to);
    setDraftName(to);
    setNote(`Renamed to ${to}.`);
  };

  const erase = () => {
    const name = current;
    api?.retagGroup(name, null);
    setGroups((registry) => {
      const next = { ...registry };
      delete next[name];
      return next;
    });
    setCurrent("");
    setDeleteArmed(false);
    setNote(`${name} erased, and its area with it.`);
  };

  return (
    <Panel title="Groups" icon="list" onClose={onClose} width={340}>
      <div style={{ fontSize: 12, lineHeight: 1.45, color: "rgba(255,255,255,0.7)" }}>
        A group — a cartel, a militia, a zombie outbreak — controls an area without owning it. The regions stay their countries'; the game outlines the group's area and tints it in the group's colour, and the AI is told what the group is.
      </div>

      {!current && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {names.length === 0 && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>No groups yet.</div>
            )}
            {names.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => open(name)}
                style={{ ...pillButton(false), display: "flex", alignItems: "center", gap: 8, textAlign: "left", width: "100%" }}
              >
                <Swatch color={recordOf(name).color} />
                <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{name}</span>
                <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 500 }}>
                  {(usage[name] ?? 0) === 1 ? "1 region" : `${usage[name] ?? 0} regions`}
                </span>
              </button>
            ))}
          </div>
          <div style={labelDim}>New group</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={newName}
              maxLength={GROUP_NAME_MAX}
              placeholder="Cartel del Norte"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); create(); } }}
              style={{ ...inputStyle, flex: 1, minWidth: 0, padding: "5px 7px" }}
            />
            <button type="button" onClick={create} disabled={!newName.trim()} style={pillButton(true)}>
              Create
            </button>
          </div>
          {selection.length > 0 && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
              A new group takes the {selection.length === 1 ? "selected region" : `${selection.length} selected regions`}.
            </div>
          )}
        </>
      )}

      {current && record && (
        <>
          <button type="button" onClick={() => { setCurrent(""); setNote(""); }} style={{ ...pillButton(false), alignSelf: "flex-start" }}>
            ← All groups
          </button>
          <div style={labelDim}>Name</div>
          <input
            value={draftName}
            maxLength={GROUP_NAME_MAX}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); rename(); } }}
            style={{ ...inputStyle, padding: "5px 7px" }}
          />
          <div style={labelDim}>What it is (the AI is told this)</div>
          <textarea
            value={record.description || ""}
            maxLength={GROUP_DESCRIPTION_MAX}
            placeholder="A drug cartel that runs the border towns, taxes the smuggling routes and fights the army for the highways."
            onChange={(e) => patchRecord(current, { description: e.target.value })}
            onBlur={(e) => patchRecord(current, { description: normalizeGroupDescription(e.target.value) })}
            rows={5}
            style={{ ...inputStyle, padding: "6px 7px", resize: "vertical", fontFamily: "inherit", fontSize: 12.5 }}
          />
          <div style={labelDim}>Tint colour</div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
            {GROUP_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                onClick={() => patchRecord(current, { color })}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 5,
                  padding: 0,
                  cursor: "pointer",
                  background: color,
                  border: normalizeGroupColor(record.color) === color ? "2px solid #fff" : "1px solid rgba(0,0,0,0.5)",
                }}
              />
            ))}
            <input
              type="color"
              aria-label="Custom colour"
              value={normalizeGroupColor(record.color) || GROUP_PALETTE[0]}
              onChange={(e) => patchRecord(current, { color: e.target.value })}
              style={{ width: 30, height: 24, padding: 0, border: "none", background: "none", cursor: "pointer" }}
            />
          </div>

          <div style={labelDim}>Area</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
            {(usage[current] ?? 0) === 1 ? "1 region" : `${usage[current] ?? 0} regions`}
            {selection.length > 0 && ` · ${selection.length} selected`}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button type="button" onClick={() => api?.selectGroup(current, { zoom: true })} disabled={!usage[current]} style={pillButton(false)}>
              Select its regions
            </button>
            <button
              type="button"
              onClick={() => { api?.setRegionAttrs(selection, { group: current }); setNote(`${current} now controls the selection.`); }}
              disabled={!selection.length}
              style={pillButton(false)}
              title="Put the selected regions in this group's area"
            >
              Add the selection
            </button>
            <button
              type="button"
              onClick={() => { api?.setRegionAttrs(selectedInGroup, { group: null }); setNote(`Taken out of ${current}'s area.`); }}
              disabled={!selectedInGroup.length}
              style={pillButton(false)}
              title="Take the selected regions out of this group's area"
            >
              Remove the selection
            </button>
          </div>

          <button
            type="button"
            onClick={() => (deleteArmed ? erase() : setDeleteArmed(true))}
            style={{ ...pillButton(false), color: "#f87171", marginTop: 6 }}
          >
            {deleteArmed ? `Erase ${current} and its area? Click again` : "Erase group"}
          </button>
        </>
      )}
      {note && <div style={{ fontSize: 11.5, color: "rgba(191,219,254,0.9)" }}>{note}</div>}
    </Panel>
  );
};

export default GroupsPanel;
