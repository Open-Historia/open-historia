/*!
 * Open Historia Continuum — Scenario Workshop polity manager
 * Continuum-only Phase 12.5 foundation.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Panel from "./Panel.jsx";
import { inputStyle, pillButton } from "./editorStyles.js";
import { ColorField, TagField } from "./fields.jsx";
import { TAG_SUGGESTIONS } from "../runtime/countryTags.js";
import { flagImageUrlFromGid } from "../runtime/countryFlags.js";
import { resolveStockCountryCode } from "../runtime/polityIdentity.js";

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
  regionEpoch = 0,
  colors = {},
  flags = {},
  tags = {},
  upsertPolity,
  renamePolityDisplay,
  removePolity,
  importPolityRoster,
  setColorOverride,
  setTags,
  onOpenFlagPicker,
  onPaintPolity,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [draftName, setDraftName] = useState("");
  const [newKey, setNewKey] = useState("");
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

  const current = selectedKey
    ? rows.find((row) => row.key === selectedKey) || {
        key: selectedKey,
        record: polities?.[selectedKey] || null,
        name: clean(polities?.[selectedKey]?.name) || selectedKey,
        regionCount: usage.get(selectedKey)?.regionCount || 0,
        claimantCount: usage.get(selectedKey)?.claimantCount || 0,
      }
    : null;

  useEffect(() => {
    setDraftName(current?.name || "");
    setTransferFrom("");
  }, [current?.key, current?.name]);

  const createPolity = () => {
    const key = clean(newKey || newName);
    const name = clean(newName || newKey);
    if (!key || !name) return;
    if (Object.prototype.hasOwnProperty.call(polities || {}, key) || usage.has(key)) {
      window.alert(`A polity with the stable key “${key}” already exists.`);
      return;
    }
    upsertPolity?.(key, { name, code: key, aliases: [name], status: "active", note: "" });
    if (selection.length) api?.setRegionAttrs?.(selection, { owner: key });
    setRefreshNonce((n) => n + 1);
    setSelectedKey(key);
    setNewKey("");
    setNewName("");
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

  const canDeleteRecord = Boolean(
    current?.record && current.regionCount === 0 && current.claimantCount === 0,
  );

  return (
    <Panel title="Polities" icon="list" onClose={onClose} width={390}>
      <div style={{ fontSize: 12, lineHeight: 1.45, color: "rgba(255,255,255,0.62)" }}>
        Regions store a <b>stable polity key</b>. Rename the polity here to change its visible identity without creating a new one-province country.
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search polity name or stable key…"
        style={inputStyle}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, maxHeight: 230, overflowY: "auto" }}>
        {rows.map((row) => {
          const active = row.key === selectedKey;
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => setSelectedKey(row.key)}
              style={{
                gridColumn: "1 / -1",
                display: "flex",
                alignItems: "center",
                gap: 8,
                textAlign: "left",
                padding: "7px 9px",
                borderRadius: 8,
                border: active ? "1px solid rgba(59,130,246,0.8)" : "1px solid rgba(255,255,255,0.08)",
                background: active ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.035)",
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
                  key: {row.key} · {row.regionCount} regions{row.claimantCount ? ` · ${row.claimantCount} claims` : ""}
                </div>
              </span>
            </button>
          );
        })}
      </div>

      {current && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <div>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.48)", marginBottom: 4 }}>Stable key</div>
            <div style={{ ...inputStyle, opacity: 0.75, userSelect: "text" }}>{current.key}</div>
          </div>

          <div>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.48)", marginBottom: 4 }}>Current display name</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} style={inputStyle} />
              <button
                type="button"
                style={pillButton(false)}
                disabled={!clean(draftName) || clean(draftName) === current.name}
                onClick={() => renamePolityDisplay?.(current.key, draftName)}
              >
                Rename
              </button>
            </div>
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
              title="Close this panel and start drag-painting this stable polity key across regions"
            >
              Paint this polity
            </button>
          </div>

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

          {current.record && (
            <button
              type="button"
              style={{ ...pillButton(false), color: canDeleteRecord ? "#f87171" : "rgba(255,255,255,0.35)" }}
              disabled={!canDeleteRecord}
              title={canDeleteRecord ? "Delete this landless polity record" : "Transfer/clear its territory and claims before deleting the polity record"}
              onClick={() => {
                if (!canDeleteRecord) return;
                if (!window.confirm(`Delete the polity record “${current.name}”?`)) return;
                removePolity?.(current.key);
                setSelectedKey("");
              }}
            >
              Delete polity record
            </button>
          )}
        </div>
      )}

      <div style={{ paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.1)", display: "grid", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>Bulk polity roster</div>
          <button
            type="button"
            style={pillButton(false)}
            onClick={fillMissingStandardFlags}
            title="Fill only missing scenario flags from OpenHistoria's built-in standard country flag catalog"
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
          <b>Fill standard flags</b> stores OpenHistoria&apos;s built-in country flags in this scenario for safely recognized polities that are currently missing a flag; custom/historical flags are never overwritten. Roster import creates or updates polity records in bulk. Territory is untouched. Supports
          <code> {"{ polities: [...] }"}</code>, a direct array, or an object keyed by stable polity key.
        </div>

        {rosterPreview && (
          <div style={{ padding: "8px 9px", borderRadius: 8, background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.22)", display: "grid", gap: 6 }}>
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
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Create polity</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Display name, e.g. Austria-Hungary" style={inputStyle} />
          <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="Stable key (optional; defaults to display name)" style={inputStyle} />
          <button type="button" style={pillButton(false)} disabled={!clean(newName || newKey)} onClick={createPolity}>
            {selection.length ? `Create + assign ${selection.length} selected regions` : "Create landless polity"}
          </button>
        </div>
      </div>
    </Panel>
  );
};

export default PolitiesPanel;
