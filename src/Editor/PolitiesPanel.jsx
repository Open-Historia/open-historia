/*!
 * Open Historia — Scenario Workshop polity manager
 * Ported from kernely's Continuum branch.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Panel from "./Panel.jsx";
import { inputStyle, pillButton } from "./editorStyles.js";
import { ColorField, TagField } from "./fields.jsx";
import { TAG_SUGGESTIONS } from "../runtime/countryTags.js";
import { flagImageUrlFromGid } from "../runtime/countryFlags.js";
import { resolveStockCountryCode } from "../runtime/polityIdentity.js";
import { POLITY_ROLE_PLACEHOLDER } from "../../server/polityRole.js";

const clean = (value) => String(value ?? "").trim();

const rosterRowsFromJson = (value) => {
  if (Array.isArray(value)) return value;

  if (!value || typeof value !== "object") return [];

  if (Array.isArray(value.polities)) return value.polities;
  if (Array.isArray(value.roster)) return value.roster;
  if (Array.isArray(value.countries)) return value.countries;

  // Also accept a keyed polity map:
  // { "Russian Empire": { "name":"Russian Empire", ... }, ... }
  const keyed = value.polities && typeof value.polities === "object" && !Array.isArray(value.polities)
    ? value.polities
    : value;
  const ignoredTopLevel = new Set(["format", "track", "scenario", "derivation", "metadata", "version"]);
  const rows = [];
  for (const [key, record] of Object.entries(keyed || {})) {
    if (ignoredTopLevel.has(key)) continue;
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    rows.push({ key, ...record });
  }
  return rows;
};

const rosterKey = (row) =>
  clean(row?.key ?? row?.stableKey ?? row?.stable_key ?? row?.code ?? row?.id ?? row?.name);

const uniqueStandardFlagForCandidates = (candidates) => {
  const codes = new Set();
  for (const candidate of candidates || []) {
    const code = resolveStockCountryCode(candidate);
    if (code) codes.add(code);
  }
  if (codes.size !== 1) return null;
  return flagImageUrlFromGid([...codes][0]);
};

const PolitiesPanel = ({
  api,
  polities = {},
  selection = [],
  setSelection,
  regionEpoch = 0,
  colors = {},
  flags = {},
  tags = {},
  upsertPolity,
  renamePolity,
  removePolity,
  removePolities,
  importPolityRoster,
  setColorOverride,
  setTags,
  onOpenFlagPicker,
  onPaintPolity,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [bulkSelected, setBulkSelected] = useState(() => new Set());
  const [draftName, setDraftName] = useState("");
  const [newName, setNewName] = useState("");
  const [transferFrom, setTransferFrom] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [rosterPreview, setRosterPreview] = useState(null);
  const [rosterMessage, setRosterMessage] = useState("");
  const rosterInputRef = useRef(null);

  // A scan of ~3,500 lightweight feature properties is cheap and, unlike a memo
  // keyed only on region COUNT, it notices ownership changes where the count stays
  // exactly the same.
  const usageRows = useMemo(
    () => api?.listPolityUsage?.() || [],
    [api, regionEpoch, refreshNonce],
  );
  const usage = useMemo(() => {
    const map = new globalThis.Map();
    for (const row of usageRows) map.set(row.key, row);
    return map;
  }, [usageRows]);

  const rows = useMemo(() => {
    const keys = new Set([...Object.keys(polities || {}), ...usage.keys()]);
    return [...keys]
      .map((key) => {
        const record = polities?.[key] || null;
        const counts = usage.get(key) || { regionCount: 0, claimantCount: 0 };
        return {
          key,
          record,
          name: clean(record?.name) || key,
          regionCount: counts.regionCount || 0,
          claimantCount: counts.claimantCount || 0,
        };
      })
      .filter((row) => {
        const q = clean(query).toLowerCase();
        if (!q) return true;
        const aliases = Array.isArray(row.record?.aliases) ? row.record.aliases.join(" ") : "";
        return `${row.key} ${row.name} ${aliases}`.toLowerCase().includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  }, [polities, usage, query]);

  const allFilteredSelected = rows.length > 0 && rows.every((row) => bulkSelected.has(row.key));
  const selectedBulkRows = useMemo(() => {
    const allKeys = new Set([...Object.keys(polities || {}), ...usage.keys()]);
    return [...bulkSelected]
      .filter((key) => allKeys.has(key))
      .map((key) => {
        const record = polities?.[key] || null;
        const counts = usage.get(key) || { regionCount: 0, claimantCount: 0 };
        return { key, name: clean(record?.name) || key, regionCount: counts.regionCount || 0, claimantCount: counts.claimantCount || 0 };
      });
  }, [bulkSelected, polities, usage]);

  const current = selectedKey
    ? rows.find((row) => row.key === selectedKey) || {
        key: selectedKey,
        record: polities?.[selectedKey] || null,
        name: clean(polities?.[selectedKey]?.name) || selectedKey,
        regionCount: usage.get(selectedKey)?.regionCount || 0,
        claimantCount: usage.get(selectedKey)?.claimantCount || 0,
      }
    : null;

  // The regions the selected country owns, for the list under its name: a scan
  // of the region features, keyed like usageRows so it follows ownership edits.
  const ownedRegions = useMemo(
    () => (current?.key ? api?.listOwnerRegions?.(current.key) || [] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, current?.key, regionEpoch, refreshNonce],
  );

  useEffect(() => {
    setDraftName(current?.name || "");
    setTransferFrom("");
  }, [current?.key, current?.name]);

  // A polity is keyed by its name: the name typed here is the key, and renaming
  // it later re-keys everything (renamePolity).
  const createPolity = () => {
    const name = clean(newName);
    const key = name;
    if (!key) return;
    if (Object.prototype.hasOwnProperty.call(polities || {}, key) || usage.has(key)) {
      window.alert(`A polity named “${key}” already exists.`);
      return;
    }
    upsertPolity?.(key, { name, code: key, aliases: [name], status: "active", note: "" });
    // A country is registered the moment it is created, regions or not: with a
    // selection it takes those regions now; otherwise it waits, landless, for
    // the paint tool or an assignment, and ships to the game either way.
    if (selection.length) api?.setRegionAttrs?.(selection, { owner: key });
    setRefreshNonce((n) => n + 1);
    setSelectedKey(key);
    setNewName("");
  };

  const toggleBulkKey = (key) => {
    setBulkSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleFiltered = () => {
    setBulkSelected((previous) => {
      const next = new Set(previous);
      if (allFilteredSelected) rows.forEach((row) => next.delete(row.key));
      else rows.forEach((row) => next.add(row.key));
      return next;
    });
  };

  const removeManyFromMap = () => {
    const targets = selectedBulkRows;
    if (!targets.length) return;
    const keys = targets.map((row) => row.key);
    const regionCount = targets.reduce((sum, row) => sum + row.regionCount, 0);
    const claimCount = targets.reduce((sum, row) => sum + row.claimantCount, 0);
    const consequences = [
      regionCount ? `${regionCount.toLocaleString()} owned region(s) become unowned` : "",
      claimCount ? `${claimCount.toLocaleString()} territorial claim(s) are removed` : "",
    ].filter(Boolean).join(" and ");
    const ok = window.confirm(
      `Delete ${targets.length.toLocaleString()} selected countries?` +
      `${consequences ? `\n\n${consequences}.` : ""}` +
      "\n\nTheir country records, colours, flags and tags will also be deleted.",
    );
    if (!ok) return;
    api?.removeOwners?.(keys);
    if (removePolities) removePolities(keys);
    else keys.forEach((key) => removePolity?.(key));
    if (keys.includes(selectedKey)) setSelectedKey("");
    setBulkSelected(new Set());
    setRefreshNonce((n) => n + 1);
  };

  // Removing a polity is a map operation: its regions become unowned, the
  // claims in its name are dropped, and the record (with its colour, flag and
  // tags) goes with them. Deleting only the record used to leave the regions
  // keyed to it, so the polity came straight back.
  const removeFromMap = () => {
    if (!current?.key) return;
    const key = current.key;
    const owned = api?.selectOwner?.(key, { zoom: false }) || [];
    const disputed = (api?.serializeRegions?.()?.features || []).filter((feature) =>
      Array.isArray(feature?.properties?.claimants) && feature.properties.claimants.includes(key));
    const summary = [
      owned.length ? `${owned.length} region(s) become unowned` : "",
      disputed.length ? `${disputed.length} claim(s) are dropped` : "",
    ].filter(Boolean).join(" and ");
    if (!window.confirm(`Remove “${current.name}” from the map?${summary ? ` ${summary};` : ""} its colour, flag and tags go with it.`)) return;
    if (api?.removeOwners) api.removeOwners([key]);
    else {
      if (owned.length) api?.setRegionAttrs?.(owned, { owner: null });
      for (const feature of disputed) {
        const id = String(feature?.properties?.id ?? feature?.id ?? "");
        if (!id) continue;
        api?.setRegionAttrs?.([id], { claimants: feature.properties.claimants.filter((claimant) => claimant !== key) });
      }
    }
    removePolity?.(key);
    setBulkSelected((previous) => { const next = new Set(previous); next.delete(key); return next; });
    setSelectedKey("");
    setRefreshNonce((n) => n + 1);
  };

  const assignSelection = () => {
    if (!current?.key || !selection.length) return;
    api?.setRegionAttrs?.(selection, { owner: current.key });
    setRefreshNonce((n) => n + 1);
  };

  const transferAll = () => {
    if (!current?.key || !transferFrom || transferFrom === current.key) return;
    const ids = api?.selectOwner?.(transferFrom, { zoom: false }) || [];
    if (!ids.length) return;
    api?.setRegionAttrs?.(ids, { owner: current.key });
    setRefreshNonce((n) => n + 1);
    // Keep an explicit source polity record if one exists. Scenario authors may
    // want a landless government/exile/remnant; deletion must be deliberate.
    setTransferFrom("");
  };

  const readRosterFile = async (file) => {
    setRosterMessage("");
    setRosterPreview(null);
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      const rawRows = rosterRowsFromJson(parsed);
      const seen = new Set();
      const rows = [];
      let invalid = 0;
      let duplicates = 0;

      for (const row of rawRows) {
        const key = rosterKey(row);
        if (!key) {
          invalid += 1;
          continue;
        }
        if (seen.has(key)) {
          duplicates += 1;
          continue;
        }
        seen.add(key);
        rows.push({ ...row, key });
      }

      if (!rows.length) {
        throw new Error("No usable polity records were found in that JSON file.");
      }

      const existing = rows.filter((row) => Object.prototype.hasOwnProperty.call(polities || {}, row.key)).length;
      const incomingColors = rows.filter((row) => row.color || row.rgb || row.colour).length;
      const incomingTags = rows.filter((row) => Array.isArray(row.tags) ? row.tags.length : clean(row.tags)).length;
      const incomingFlags = rows.filter((row) => clean(row.flag || row.flagUrl || row.flag_url || row.flagDataUrl)).length;

      setRosterPreview({
        fileName: file.name,
        rows,
        invalid,
        duplicates,
        existing,
        fresh: rows.length - existing,
        incomingColors,
        incomingTags,
        incomingFlags,
      });
    } catch (e) {
      setRosterMessage(e?.message || String(e));
    } finally {
      if (rosterInputRef.current) rosterInputRef.current.value = "";
    }
  };

  const applyRoster = () => {
    if (!rosterPreview?.rows?.length || !importPolityRoster) return;
    const count = rosterPreview.rows.length;
    const ok = window.confirm(
      `Import / merge ${count.toLocaleString()} polity records?\n\n` +
      "Stable keys already present will be updated in place. Territory ownership is NOT changed.",
    );
    if (!ok) return;

    const summary = importPolityRoster(rosterPreview.rows);
    if (!summary?.count) {
      setRosterMessage("The roster contained no usable polity records.");
      return;
    }

    setRefreshNonce((n) => n + 1);
    setSelectedKey(summary.firstKey || "");
    setRosterMessage(
      `Imported ${summary.count.toLocaleString()} polities: ` +
      `${summary.created.toLocaleString()} new, ${summary.updated.toLocaleString()} updated` +
      `${summary.colors ? ` · ${summary.colors.toLocaleString()} colours` : ""}` +
      `${summary.tags ? ` · ${summary.tags.toLocaleString()} tag sets` : ""}` +
      `${summary.flags ? ` · ${summary.flags.toLocaleString()} flags` : ""}.`,
    );
    setRosterPreview(null);
  };

  const fillMissingStandardFlags = () => {
    if (!importPolityRoster) return;

    const keys = new Set([...Object.keys(polities || {}), ...usage.keys()]);
    const importRows = [];
    let unresolved = 0;
    let alreadyFlagged = 0;

    for (const key of keys) {
      const record = polities?.[key] || null;
      if (flags?.[key]) {
        alreadyFlagged += 1;
        continue;
      }

      const name = clean(record?.name) || key;
      const aliases = Array.isArray(record?.aliases) ? record.aliases : [];
      const flag = uniqueStandardFlagForCandidates([
        record?.code,
        key,
        name,
        ...aliases,
      ]);

      if (!flag) {
        unresolved += 1;
        continue;
      }

      importRows.push({
        key,
        name,
        aliases,
        status: record?.status || "active",
        note: record?.note || "",
        mapRefs: record?.mapRefs || null,
        flag,
      });
    }

    if (!importRows.length) {
      setRosterMessage(
        unresolved
          ? `No missing standard flags could be resolved; ${unresolved.toLocaleString()} polities remain without a safe built-in match.`
          : "Every current polity already has a scenario flag.",
      );
      return;
    }

    const ok = window.confirm(
      `Store ${importRows.length.toLocaleString()} built-in standard flags in this scenario?\n\n` +
      "Only polities that currently have NO scenario flag are included. Existing custom/historical flags will not be overwritten.",
    );
    if (!ok) return;

    const summary = importPolityRoster(importRows);
    setRefreshNonce((n) => n + 1);
    setRosterMessage(
      `Added ${Number(summary?.flags || importRows.length).toLocaleString()} standard flags to the scenario` +
      (alreadyFlagged ? ` · ${alreadyFlagged.toLocaleString()} existing flags preserved` : "") +
      (unresolved ? ` · ${unresolved.toLocaleString()} unresolved/ambiguous polities skipped` : "") +
      ".",
    );
  };

  return (
    <Panel title="Countries" icon="list" onClose={onClose} width={390}>
      <div style={{ fontSize: 12, lineHeight: 1.45, color: "rgba(255,255,255,0.62)" }}>
        Every country on the map is listed — it owns a region or a region is disputed in its name — and so is every country registered here, with regions or not; a registered country stays until it is removed. Click one to select its whole territory. A country is <b>keyed by its name</b>: renaming it re-keys everything that carried the old name.
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search country name…"
        style={inputStyle}
      />

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" style={pillButton(false)} disabled={!rows.length} onClick={toggleFiltered}>
          {allFilteredSelected ? "Unselect filtered" : `Select filtered (${rows.length})`}
        </button>
        <button type="button" style={pillButton(false)} disabled={!bulkSelected.size} onClick={() => setBulkSelected(new Set())}>
          Clear selection
        </button>
        <button type="button" style={pillButton(true)} disabled={!selectedBulkRows.length} onClick={removeManyFromMap}>
          Delete selected ({selectedBulkRows.length})
        </button>
      </div>

      <div style={{ display: "grid", gap: 6, maxHeight: 230, overflowY: "auto" }}>
        {rows.map((row) => {
          const active = row.key === selectedKey;
          const checked = bulkSelected.has(row.key);
          return (
            <div key={row.key} style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
              <label
                title={`Include ${row.name} in bulk actions`}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, flex: "0 0 30px", borderRadius: 8, border: checked ? "1px solid rgba(239,68,68,0.65)" : "1px solid rgba(255,255,255,0.08)", background: checked ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.025)", cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleBulkKey(row.key)}
                  aria-label={`Select ${row.name} for bulk actions`}
                />
              </label>
              <button
                type="button"
                onClick={() => { setSelectedKey(row.key); api?.selectOwner?.(row.key, { zoom: true }); }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  textAlign: "left",
                  padding: "7px 9px",
                  borderRadius: 8,
                  border: active ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.08)",
                  background: active ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.035)",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    flex: "0 0 auto",
                    background: colors?.[row.key] ? `rgb(${colors[row.key].join(",")})` : "rgba(255,255,255,0.18)",
                    border: "1px solid rgba(255,255,255,0.25)",
                  }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.name}
                  </div>
                  <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.48)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.regionCount ? `${row.regionCount} regions` : "registered, no regions yet"}{row.claimantCount ? ` · ${row.claimantCount} claims` : ""}{Array.isArray(polities?.[row.key]?.formerNames) && polities[row.key].formerNames.length ? ` · formerly ${polities[row.key].formerNames.join(", ")}` : ""}
                  </div>
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {current && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <div>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.48)", marginBottom: 4 }}>Name</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} style={inputStyle} />
              <button
                type="button"
                style={pillButton(false)}
                disabled={!clean(draftName) || clean(draftName) === current.key}
                title="Renames the country everywhere on this map: its regions, claims, colour, flag, tags and cities. The old name is kept as a former name."
                onClick={() => {
                  const next = clean(draftName);
                  const previousKey = current.key;
                  renamePolity?.(previousKey, next);
                  setBulkSelected((previous) => {
                    if (!previous.has(previousKey)) return previous;
                    const updated = new Set(previous);
                    updated.delete(previousKey);
                    updated.add(next);
                    return updated;
                  });
                  setSelectedKey(next);
                }}
              >
                Rename
              </button>
            </div>
            {Array.isArray(current.record?.formerNames) && current.record.formerNames.length > 0 && (
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>Formerly {current.record.formerNames.join(", ")}</div>
            )}
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" style={pillButton(false)} onClick={() => api?.selectOwner?.(current.key, { zoom: true })}>
              Select territory ({current.regionCount})
            </button>
            <button type="button" style={pillButton(false)} disabled={!selection.length} onClick={assignSelection}>
              Assign selected ({selection.length})
            </button>
            <button
              type="button"
              style={pillButton(true)}
              onClick={() => onPaintPolity?.(current.key)}
              title="Close this panel and start drag-painting this polity across regions"
            >
              Paint this polity
            </button>
          </div>

          <details style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "6px 9px" }}>
            <summary style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}>
              Regions ({ownedRegions.length}){current.claimantCount ? ` · ${current.claimantCount} claimed` : ""}
            </summary>
            {ownedRegions.length === 0 ? (
              <div style={{ fontSize: 10.8, color: "rgba(255,255,255,0.5)", marginTop: 6 }}>
                No regions yet — this country is registered and ships to the game without land until it is painted or assigned some.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 3, marginTop: 6, maxHeight: 200, overflowY: "auto" }}>
                {ownedRegions.map((region) => (
                  <button
                    key={region.id}
                    type="button"
                    onClick={() => { setSelection?.([region.id]); api?.zoomToRegion?.(region.id); }}
                    title="Select this region and zoom to it"
                    style={{ textAlign: "left", padding: "4px 7px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "white", cursor: "pointer", fontSize: 11.5 }}
                  >
                    {region.name || region.id}
                  </button>
                ))}
              </div>
            )}
          </details>

          <div>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.48)", marginBottom: 4 }}>Transfer all territory from another polity</div>
            <div style={{ display: "flex", gap: 6 }}>
              <select value={transferFrom} onChange={(e) => setTransferFrom(e.target.value)} style={inputStyle}>
                <option value="">Choose polity…</option>
                {usageRows.filter((row) => row.key !== current.key && row.regionCount > 0).map((row) => (
                  <option key={row.key} value={row.key}>{clean(polities?.[row.key]?.name) || row.key} ({row.regionCount})</option>
                ))}
              </select>
              <button type="button" style={pillButton(false)} disabled={!transferFrom} onClick={transferAll}>Transfer</button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.58)", width: 52 }}>Colour</span>
            <ColorField value={colors?.[current.key] || [128, 128, 128]} onChange={(rgb) => setColorOverride?.(current.key, rgb)} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.58)", width: 52 }}>Flag</span>
            {flags?.[current.key] && <img src={flags[current.key]} alt="" style={{ width: 28, height: 18, objectFit: "contain", borderRadius: 3, border: "1px solid rgba(255,255,255,0.25)" }} />}
            <button type="button" style={pillButton(false)} onClick={() => onOpenFlagPicker?.(current.key)}>
              {flags?.[current.key] ? "Change" : "Choose flag"}
            </button>
          </div>

          <div>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.48)", marginBottom: 4 }}>Tags</div>
            <TagField value={tags?.[current.key] || []} suggestions={TAG_SUGGESTIONS} onChange={(next) => setTags?.(current.key, next)} />
          </div>

          <div>
            <div
              style={{ fontSize: 10.5, color: "rgba(255,255,255,0.48)", marginBottom: 4 }}
              title="What this power IS, in your own words — a country claiming land as its own, a terrorist organisation, a gang, one side of a civil war. The game's AI reads it wherever this polity appears."
            >
              What it is
            </div>
            <input
              value={current.record?.role || ""}
              placeholder={POLITY_ROLE_PLACEHOLDER}
              onChange={(e) => upsertPolity?.(current.key, current.record
                ? { role: e.target.value }
                : { name: current.key, code: current.key, aliases: [current.key], status: "active", note: "", role: e.target.value })}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
            />
          </div>

          {current.record && (
            <div>
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.48)", marginBottom: 4 }}>Scenario note</div>
              <textarea
                value={current.record?.note || ""}
                onChange={(e) => upsertPolity?.(current.key, { note: e.target.value })}
                rows={2}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>
          )}

          <button
            type="button"
            style={{ ...pillButton(false), color: "#f87171" }}
            title="Make its regions unowned, drop the claims in its name, and remove the polity with its colour, flag and tags"
            onClick={removeFromMap}
          >
            Remove from the map
          </button>
        </div>
      )}

      <div style={{ paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.1)", display: "grid", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>Bulk polity roster</div>
          <button
            type="button"
            style={pillButton(false)}
            onClick={fillMissingStandardFlags}
            title="Fill only missing scenario flags from Open Historia's built-in standard country flag catalog"
          >
            Fill standard flags
          </button>
          <button type="button" style={pillButton(true)} onClick={() => rosterInputRef.current?.click()}>
            Import roster JSON…
          </button>
          <input
            ref={rosterInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => readRosterFile(e.target.files?.[0] || null)}
          />
        </div>

        <div style={{ fontSize: 10.8, lineHeight: 1.45, color: "rgba(255,255,255,0.5)" }}>
          <b>Fill standard flags</b> stores Open Historia&apos;s built-in country flags in this scenario for safely recognized polities that are currently missing a flag; custom/historical flags are never overwritten. Roster import creates or updates polity records in bulk. Territory is untouched. Supports
          <code> {"{ polities: [...] }"}</code>, a direct array, or an object keyed by polity name.
        </div>

        {rosterPreview && (
          <div style={{ padding: "8px 9px", borderRadius: 8, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.1)", display: "grid", gap: 6 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700 }}>{rosterPreview.fileName}</div>
            <div style={{ fontSize: 10.8, lineHeight: 1.45, color: "rgba(255,255,255,0.62)" }}>
              {rosterPreview.rows.length.toLocaleString()} unique polity keys · {rosterPreview.fresh.toLocaleString()} new · {rosterPreview.existing.toLocaleString()} already present
              {rosterPreview.incomingColors ? ` · ${rosterPreview.incomingColors.toLocaleString()} colours` : ""}
              {rosterPreview.incomingTags ? ` · ${rosterPreview.incomingTags.toLocaleString()} tag sets` : ""}
              {rosterPreview.incomingFlags ? ` · ${rosterPreview.incomingFlags.toLocaleString()} flags` : ""}
              {rosterPreview.duplicates ? ` · ${rosterPreview.duplicates.toLocaleString()} duplicate rows ignored` : ""}
              {rosterPreview.invalid ? ` · ${rosterPreview.invalid.toLocaleString()} invalid rows ignored` : ""}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" style={pillButton(true)} onClick={applyRoster}>
                Import / merge {rosterPreview.rows.length.toLocaleString()}
              </button>
              <button type="button" style={pillButton(false)} onClick={() => setRosterPreview(null)}>Cancel</button>
            </div>
          </div>
        )}

        {rosterMessage && (
          <div style={{ fontSize: 10.8, lineHeight: 1.45, color: (rosterMessage.startsWith("Imported ") || rosterMessage.startsWith("Added ") || rosterMessage.startsWith("Every ")) ? "#86efac" : "#fca5a5" }}>
            {rosterMessage}
          </div>
        )}
      </div>

      <div style={{ paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Create country</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name, e.g. Austria-Hungary" style={inputStyle} />
          <button type="button" style={pillButton(false)} disabled={!clean(newName)} onClick={createPolity}>
            {selection.length ? `Create country + assign ${selection.length} selected regions` : "Create country (no regions yet)"}
          </button>
        </div>
      </div>
    </Panel>
  );
};

export default PolitiesPanel;
