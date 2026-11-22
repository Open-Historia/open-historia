/*!
 * Open Historia — Scenario Workshop polity manager
 * Ported from kernely's Continuum branch.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Panel from "./Panel.jsx";
import { inputStyle, pillButton } from "./editorStyles.js";
import { ColorField, TagField } from "./fields.jsx";
import { TAG_SUGGESTIONS } from "../runtime/countryTags.js";
import { bundledFlagUrl, flagImageUrlFromGid } from "../runtime/countryFlags.js";
import { resolveStockCountryCode } from "../runtime/polityIdentity.js";
import { acceptFor } from "../runtime/fileAccept.js";
import { formatPopulationFigure, readPopulationFigure } from "../runtime/populationFigure.js";
import PuppetFields from "./PuppetFields.jsx";
import MilitaryFields from "./MilitaryFields.jsx";
import CountryAliases from "./CountryAliases.jsx";
import { planCountryDraft } from "./countryCreationDraft.js";
import CountryCreationForm from "./CountryCreationForm.jsx";
import StartingRelationsFields from "./StartingRelationsFields.jsx";
import GovernmentIdentityFields from "./GovernmentIdentityFields.jsx";
import { applyStartingRelationEdits, mergeStartingRelationEdit, startingRelationRowsFor } from "./scenarioStartingRelations.js";

import CountryDetailsNavigation from "./CountryDetailsNavigation.jsx";
import { rateMilitaryFigures } from "../Game/AI/militaryRating.js";
import { militaryScaleOf } from "./militaryForm.js";
import { rosterRowKey } from "./polityRoster.js";
import { confirmDialog } from "../runtime/uiDialog.js";

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
  initialCountryKey = "",
  polities = {},
  selection = [],
  setSelection,
  regionEpoch = 0,
  colors = {},
  flags = {},
  tags = {},
  upsertPolity,
  commitCountryDraft,
  renamePolity,
  removePolity,
  removePolities,
  importPolityRoster,
  setColorOverride,
  setFlag,
  setTags,
  onOpenFlagPicker,
  onPaintPolity,
  puppets = [],
  setPuppets,
  relations = [],
  relationEdits = [],
  setRelationEdit,
  governmentActors = {},
  governmentEdits = [],
  setGovernmentEdit,
  polityRenames = [],
  // What a military figure left empty stands for in the scenario whose map
  // this is (militaryForm.js militaryDefaultsFor); null for a map on its own.
  militaryDefaults = null,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState(() => clean(initialCountryKey));
  const [detailsTab, setDetailsTab] = useState("overview");
  const [countryListOpen, setCountryListOpen] = useState(() => !clean(initialCountryKey));
  const [bulkSelected, setBulkSelected] = useState(() => new Set());
  const [draftName, setDraftName] = useState("");
  const [creating, setCreating] = useState(false);
  const [transferFrom, setTransferFrom] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [rosterPreview, setRosterPreview] = useState(null);
  // What the last roster or flag import said, and whether it went through: the
  // kind is set with the words ("ok" or "error"), never read back out of them
  // (a message starting "Imported ", "Added " or "Every " was green).
  const [rosterMessage, setRosterMessageLine] = useState({ text: "", ok: true });
  const setRosterMessage = (text, kind = "ok") => setRosterMessageLine({ text: String(text ?? ""), ok: kind !== "error" });
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

  // Every polity by name, unfiltered: the puppet fields' overlord list.
  const polityChoices = useMemo(
    () => [...new Set([...Object.keys(polities || {}), ...usage.keys()])]
      .map((key) => ({ key, name: clean(polities?.[key]?.name) || key,
        aliases: polities?.[key]?.aliases || [], formerNames: polities?.[key]?.formerNames || [] }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)),
    [polities, usage],
  );

   const effectiveRelations = applyStartingRelationEdits(relations, relationEdits, polityChoices);
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

  useEffect(() => {
    // A composite Undo can remove or rename the currently focused country.
    // Check against unfiltered polityChoices so typing a search query never
    // deselects the currently focused country.
    if (selectedKey && !polityChoices.some((row) => row.key === selectedKey)) {
      setSelectedKey("");
      setCountryListOpen(true);
    }
  }, [polityChoices, selectedKey]);

  const current = selectedKey
    ? rows.find((row) => row.key === selectedKey) || {
        key: selectedKey,
        record: polities?.[selectedKey] || null,
        name: clean(polities?.[selectedKey]?.name) || selectedKey,
        regionCount: usage.get(selectedKey)?.regionCount || 0,
        claimantCount: usage.get(selectedKey)?.claimantCount || 0,
      }
    : null;

  const currentStartingRelations = current && effectiveRelations.ok
    ? startingRelationRowsFor(effectiveRelations.relations, current.key, polityChoices)
      .filter((row) => row.score !== null && row.score !== undefined && row.score !== "" && Number.isFinite(Number(row.score)))
      .sort((a, b) => a.other.localeCompare(b.other))
    : [];

  const editStartingScore = (other, score) => {
    if (!current || typeof setRelationEdit !== "function") return { ok: false, reason: "Diplomatic scores cannot be saved here." };
    const edit = { a: current.key, b: other, score };
    const planned = applyStartingRelationEdits(relations, mergeStartingRelationEdit(relationEdits, edit), polityChoices);
    if (!planned.ok) return planned;
    setRelationEdit(edit);
    return { ok: true };
  };

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

  const confirmingRef = useRef(false);
  const livePolitiesRef = useRef({
    polities, usage, puppets, polityChoices, relations, relationEdits, selection, api, commitCountryDraft,
    removePolity, removePolities,
  });
  livePolitiesRef.current = {
    polities, usage, puppets, polityChoices, relations, relationEdits, selection, api, commitCountryDraft,
    removePolity, removePolities,
  };

  // The country-creation form is an entirely local draft. Revalidate on the
  // final click against CURRENT canonical identities, not an earlier preview.
  // No map or scenario mutation is attempted before validation and consent.
  const createPolity = async (draft) => {
    if (confirmingRef.current) return { ok: false, reason: "Finish the open confirmation dialog first." };
    let plan = planCountryDraft({
      draft, polities, occupiedKeys: [...usage.keys()], puppets, polityChoices,
    });
    if (!plan.ok) return plan;
    const plannedRelations = applyStartingRelationEdits(
      relations, [...relationEdits, ...plan.relationEdits], [...polityChoices, { key: plan.key }],
    );
    if (!plannedRelations.ok) return plannedRelations;
    if (typeof commitCountryDraft !== "function") {
      return { ok: false, reason: "Atomic country creation is unavailable in this editor." };
    }
    let confirmedSelection = null;
    if (plan.assignSelectedRegions) {
      if (!selection.length || typeof api?.setRegionAttrs !== "function") {
        return { ok: false, reason: "Select regions on the map before assigning starting territory." };
      }
      confirmedSelection = [...selection];
      const owners = [...new Set(confirmedSelection.map((id) => api?.getRegionSummary?.(id)?.owner).filter(Boolean))];
      const oldOwnerText = owners.length
        ? ` This changes the current ownership of regions belonging to: ${owners.join(", ")}.`
        : "";
      confirmingRef.current = true;
      let ok = false;
      try {
        ok = await confirmDialog(
          `Create "${plan.key}" and assign ${selection.length.toLocaleString()} selected regions?` +
          oldOwnerText +
          "\n\nCreating the country and assigning its territory becomes ONE Undo step.",
        );
      } finally {
        confirmingRef.current = false;
      }
      if (!ok) return { ok: false, reason: "Creation cancelled. The unfinished polity has not been added." };
    }

    // Revalidate against live state after any async confirmation so concurrent
    // edits (e.g. puppets or selection) are never overwritten by a stale plan.
    const live = livePolitiesRef.current;
    plan = planCountryDraft({
      draft,
      polities: live.polities,
      occupiedKeys: [...live.usage.keys()],
      puppets: live.puppets,
      polityChoices: live.polityChoices,
    });
    if (!plan.ok) return plan;
    const liveRelations = applyStartingRelationEdits(
      live.relations,
      [...live.relationEdits, ...plan.relationEdits],
      [...live.polityChoices, { key: plan.key }],
    );
    if (!liveRelations.ok) return liveRelations;
    const liveSelectionSet = new Set(live.selection);
    const assignedSelection = plan.assignSelectedRegions
      ? (confirmedSelection ? confirmedSelection.filter((id) => liveSelectionSet.has(id)) : live.selection)
      : [];
    if (plan.assignSelectedRegions && (!assignedSelection.length || typeof live.api?.setRegionAttrs !== "function")) {
      return { ok: false, reason: "Select regions on the map before assigning starting territory." };
    }

    // All canonical document metadata and selected region ownership are
    // committed together, then registered as one native Undo/Redo command.
    const created = live.commitCountryDraft(plan, plan.assignSelectedRegions ? assignedSelection : []);
    if (!created?.ok) return { ok: false, reason: created?.reason || "Country creation was refused." };
    setRefreshNonce((count) => count + 1);
    setSelectedKey(plan.key);
    setDetailsTab("overview");
    setCountryListOpen(false);
    setCreating(false);
    return { ok: true };
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

  const removeManyFromMap = async () => {
    if (confirmingRef.current) return;
    const targets = selectedBulkRows;
    if (!targets.length) return;
    const keys = targets.map((row) => row.key);
    const regionCount = targets.reduce((sum, row) => sum + row.regionCount, 0);
    const claimCount = targets.reduce((sum, row) => sum + row.claimantCount, 0);
    const consequences = [
      regionCount ? `${regionCount.toLocaleString()} owned region(s) become unowned` : "",
      claimCount ? `${claimCount.toLocaleString()} territorial claim(s) are removed` : "",
    ].filter(Boolean).join(" and ");
    confirmingRef.current = true;
    try {
      const ok = await confirmDialog(
        `Delete ${targets.length.toLocaleString()} selected countries?` +
        `${consequences ? `\n\n${consequences}.` : ""}` +
        "\n\nTheir country records, colours, flags and tags will also be deleted.",
        { danger: true, confirmLabel: "Delete" },
      );
      if (!ok) return;
      const live = livePolitiesRef.current;
      live.api?.removeOwners?.(keys);
      if (live.removePolities) live.removePolities(keys);
      else keys.forEach((key) => live.removePolity?.(key));
      setSelectedKey((prev) => (keys.includes(prev) ? "" : prev));
      setBulkSelected(new Set());
      setRefreshNonce((n) => n + 1);
    } finally {
      confirmingRef.current = false;
    }
  };

  // Removing a polity is a map operation: its regions become unowned, the
  // claims in its name are dropped, and the record (with its colour, flag and
  // tags) goes with them. Deleting only the record used to leave the regions
  // keyed to it, so the polity came straight back. The confirm counts come from
  // the usage scan the list already holds: no map serialisation, and the
  // selection is left alone until the author says yes.
  const removeFromMap = async () => {
    if (confirmingRef.current || !current?.key) return;
    const key = current.key;
    const summary = [
      current.regionCount ? `${current.regionCount} region(s) become unowned` : "",
      current.claimantCount ? `${current.claimantCount} claim(s) are dropped` : "",
    ].filter(Boolean).join(" and ");
    confirmingRef.current = true;
    try {
      if (!(await confirmDialog(
        `Remove “${current.name}” from the map?${summary ? ` ${summary};` : ""} its colour, flag and tags go with it.`,
        { danger: true, confirmLabel: "Remove" },
      ))) return;
      const live = livePolitiesRef.current;
      live.api?.removeOwners?.([key]);
      live.removePolity?.(key);
      setBulkSelected((previous) => { const next = new Set(previous); next.delete(key); return next; });
      setSelectedKey((prev) => (prev === key ? "" : prev));
      setRefreshNonce((n) => n + 1);
    } finally {
      confirmingRef.current = false;
    }
  };

  const assignSelection = () => {
    if (!current?.key || !selection.length) return;
    api?.setRegionAttrs?.(selection, { owner: current.key });
    setRefreshNonce((n) => n + 1);
  };

  const transferAll = async () => {
    if (confirmingRef.current || !current?.key || !transferFrom || transferFrom === current.key) return;
    const targetKey = current.key;
    const sourceKey = transferFrom;
    const regionCount = usage.get(sourceKey)?.regionCount || 0;
    if (!regionCount) return;
    const sourceName = clean(polities?.[sourceKey]?.name) || sourceKey;
    confirmingRef.current = true;
    try {
      const ok = await confirmDialog(
        `Transfer all ${regionCount.toLocaleString()} regions from "${sourceName}" to "${current.name}"?\n\n` +
        `"${sourceName}" will have no territory, but its country record will remain available to edit.\n\n` +
        "Undo restores the previous region ownership.",
      );
      if (!ok) return;
      const live = livePolitiesRef.current;
      const ids = live.api?.selectOwner?.(sourceKey, { zoom: false }) || [];
      if (!ids.length) return;
      live.api?.setRegionAttrs?.(ids, { owner: targetKey });
      setRefreshNonce((n) => n + 1);
      // Keep an explicit source polity record if one exists. Scenario authors may
      // want a landless government/exile/remnant; deletion must be deliberate.
      setTransferFrom("");
    } finally {
      confirmingRef.current = false;
    }
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
        // The key the import will use, so the preview counts what lands.
        const key = rosterRowKey(row);
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
      setRosterMessage(e?.message || String(e), "error");
    } finally {
      if (rosterInputRef.current) rosterInputRef.current.value = "";
    }
  };

  const applyRoster = async () => {
    if (confirmingRef.current || !rosterPreview?.rows?.length || !importPolityRoster) return;
    const rowsToImport = rosterPreview.rows;
    const count = rowsToImport.length;
    confirmingRef.current = true;
    try {
      const ok = await confirmDialog(
        `Import / merge ${count.toLocaleString()} polity records?\n\n` +
        "Stable keys already present will be updated in place. Territory ownership is NOT changed.",
      );
      if (!ok) return;

      const summary = importPolityRoster(rowsToImport);
      if (!summary?.count) {
        setRosterMessage("The roster contained no usable polity records.", "error");
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
        "ok",
      );
      setRosterPreview(null);
    } finally {
      confirmingRef.current = false;
    }
  };

  const fillMissingStandardFlags = async () => {
    if (confirmingRef.current || !importPolityRoster) return;

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
        unresolved ? "error" : "ok",
      );
      return;
    }

    confirmingRef.current = true;
    try {
      const ok = await confirmDialog(
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
        "ok",
      );
    } finally {
      confirmingRef.current = false;
    }
  };

  if (creating) {
    return (
      <CountryCreationForm
        polities={polities}
        occupiedKeys={[...usage.keys()]}
        puppets={puppets}
        polityChoices={polityChoices}
        militaryDefaults={militaryDefaults}
        selectionCount={selection.length}
        onCreate={createPolity}
        onOpenFlagPicker={(config) => onOpenFlagPicker?.({ kind: "country-draft", ...config })}
        onCancel={() => setCreating(false)}
      />
    );
  }

  return (
    <Panel title="Polities" icon="flag" onClose={onClose} width={440}>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <strong style={{ fontSize: 12.5 }}>Find a polity</strong>
        <button type="button" style={pillButton(true)} onClick={() => setCreating(true)}>
          + Create polity
        </button>
        {current && <button type="button" style={pillButton(false)} onClick={() => setCountryListOpen((open) => !open)}>
          {countryListOpen ? "Hide list" : "Change polity"}
        </button>}
      </div>
      {(!current || countryListOpen) && (<>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search polity name…"
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

      {/* A tall selected polity Overview must not squeeze the roster to one row.
          Keep the list independently scrollable while the panel body scrolls below it. */}
      <div style={{ display: "grid", gap: 6, flexShrink: 0, maxHeight: "min(46vh, 420px)", overflowY: "auto" }}>
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
                onClick={() => { setSelectedKey(row.key); setDetailsTab("overview"); setCountryListOpen(false); api?.selectOwner?.(row.key, { zoom: true }); }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  textAlign: "left",
                  padding: "7px 9px",
                  borderRadius: 8,
                  border: active ? "1px solid var(--oh-ui-focus, rgba(255,255,255,0.28))" : "1px solid var(--oh-ui-line, rgba(255,255,255,0.08))",
                  background: active ? "var(--oh-ui-active, rgba(0,0,0,0.25))" : "var(--oh-ui-raised, rgba(255,255,255,0.035))",
                  color: "var(--oh-ui-text, white)",
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

      </>)}

      {current && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 8, borderTop: "1px solid var(--oh-ui-line, rgba(255,255,255,0.1))" }}>
          <CountryDetailsNavigation
            current={current}
            color={colors?.[current.key]}
            flags={flags}
            tags={tags}
            polities={polities}
            puppets={puppets}
            tab={detailsTab}
            onTabChange={setDetailsTab}
          />
          {detailsTab === "names" && (
            <div style={{ display: "grid", gap: 10 }}>

          <div>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, color: "var(--oh-ui-text, #fff)" }}>
              Names &amp; identity
            </div>
            <div style={{ fontSize: 10.5, color: "var(--oh-ui-muted, rgba(255,255,255,0.6))", marginBottom: 4 }}>
              Polity name
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} style={inputStyle} />
              <button
                type="button"
                style={pillButton(false)}
                disabled={!clean(draftName) || clean(draftName) === current.key}
                title="Renames the polity everywhere on this map: its regions, claims, colour, flag, tags, map features, units and puppet ties. The old name is not kept."
                onClick={() => {
                  const next = clean(draftName);
                  const previousKey = current.key;
                  // A refused rename (the name is another polity's) leaves the
                  // panel on the country it was showing.
                  if (renamePolity?.(previousKey, next) !== true) return;
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
            <p style={{ fontSize: 11.5, lineHeight: 1.45, margin: "8px 0 0", color: "var(--oh-ui-muted, rgba(255,255,255,0.66))" }}>
              Renaming updates this country's name on the map and in the scenario.
              The previous name will not automatically become an alternative name.
            </p>
          </div>

          <CountryAliases
            key={current.key}
            countryKey={current.key}
            countryName={current.name}
            record={current.record}
            polities={polities}
            occupiedKeys={[...usage.keys()]}
            onChange={(aliases) => upsertPolity?.(current.key, { aliases })}
          />
            </div>
          )}
          {detailsTab === "territory" && (
            <div style={{ display: "grid", gap: 10 }}>

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

          <details style={{ border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.1))", borderRadius: 8, padding: "6px 9px" }}>
            <summary style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}>
              Regions ({ownedRegions.length}){current.claimantCount ? ` · ${current.claimantCount} claimed` : ""}
            </summary>
            {ownedRegions.length === 0 ? null : (
              <div style={{ display: "grid", gap: 3, marginTop: 6, maxHeight: 200, overflowY: "auto" }}>
                {ownedRegions.map((region) => (
                  <button
                    key={region.id}
                    type="button"
                    onClick={() => { setSelection?.([region.id]); api?.zoomToRegion?.(region.id); }}
                    title="Select this region and zoom to it"
                    style={{ textAlign: "left", padding: "4px 7px", borderRadius: 6, border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.08))", background: "var(--oh-ui-raised, rgba(255,255,255,0.03))", color: "var(--oh-ui-text, white)", cursor: "pointer", fontSize: 11.5 }}
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
            </div>
          )}
          {detailsTab === "relations" && (
            <StartingRelationsFields
              key={current.key}
              owner={current.key}
              choices={polityChoices}
              rows={currentStartingRelations}
              onSave={editStartingScore}
              onClear={(other) => editStartingScore(other, null)}
              disabled={!effectiveRelations.ok}
            />
          )}
          {detailsTab === "appearance" && (
            <div style={{ display: "grid", gap: 10 }}>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.58)", width: 52 }}>Colour</span>
            <ColorField value={colors?.[current.key] || [128, 128, 128]} onChange={(rgb) => setColorOverride?.(current.key, rgb)} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.58)", width: 52 }}>Flag</span>
            {flags?.[current.key] && <img src={bundledFlagUrl(flags[current.key])} alt="" style={{ width: 28, height: 18, objectFit: "contain", borderRadius: 3, border: "1px solid rgba(255,255,255,0.25)" }} />}
            <button type="button" style={pillButton(false)} onClick={() => onOpenFlagPicker?.(current.key)}>
              {flags?.[current.key] ? "Change" : "Choose flag"}
            </button>
          </div>

          <div>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.48)", marginBottom: 4 }}>Tags</div>
            <TagField value={tags?.[current.key] || []} suggestions={TAG_SUGGESTIONS} onChange={(next) => setTags?.(current.key, next)} />
          </div>
            </div>
          )}
          {detailsTab === "governance" && (
            <div style={{ display: "grid", gap: 10 }}>

          <GovernmentIdentityFields
            polity={current.key}
            actors={governmentActors}
            edits={governmentEdits}
            renames={polityRenames}
            onSave={setGovernmentEdit}
          />

          <PuppetFields
            polity={current.key}
            regionCount={current.regionCount}
            choices={polityChoices}
            puppets={puppets}
            setPuppets={setPuppets}
          />

          {current.record && (
            <div>
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.48)", marginBottom: 4 }}>Scenario note</div>
              <textarea
                value={current.record?.note || ""}
                onChange={(e) => upsertPolity?.(current.key, { note: e.target.value })}
                rows={2}
                style={{ ...inputStyle, resize: "vertical" }}
              />
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.48)", margin: "8px 0 4px" }}>Population when the scenario begins</div>
              <input
                key={`population-${current.key}`}
                defaultValue={formatPopulationFigure(current.record?.population)}
                inputMode="numeric"
                placeholder="Leave empty and the game works it out"
                onBlur={(e) => {
                  const people = readPopulationFigure(e.target.value);
                  e.target.value = formatPopulationFigure(people);
                  upsertPolity?.(current.key, { population: people > 0 ? people : undefined });
                }}
                style={inputStyle}
              />
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.42)", marginTop: 4 }}>Its troops are raised from these people, and its statistics begin from this figure, written in digits: 12500000 or 12,500,000.</div>
              {/* Its own military figures (MilitaryFields.jsx), kept with its record as `military`. */}
              <div style={{ marginTop: 8 }}>
                <MilitaryFields
                  recordKey={current.key}
                  value={current.record?.military}
                  defaults={militaryDefaults}
                  onChange={(military) => upsertPolity?.(current.key, { military: military ?? undefined })}
                  onRate={() => rateMilitaryFigures({
                    name: current.record?.name || current.key,
                    note: current.record?.note,
                    population: current.record?.population,
                    rated: militaryScaleOf(polities),
                    date: militaryDefaults?.gameDate,
                    era: Number.isInteger(militaryDefaults?.era) ? militaryDefaults.era : null,
                    rules: militaryDefaults?.rules,
                  })}
                />
              </div>
            </div>
          )}
            </div>
          )}
          {detailsTab === "manage" && (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{
                padding: "12px", display: "grid", gap: 9,
                background: "var(--oh-ui-raised, rgba(255,255,255,0.04))",
                border: "1px solid rgba(239,68,68,0.5)", borderRadius: 10,
              }}>
                <strong style={{ fontSize: 12.5, color: "#fca5a5" }}>Remove this country</strong>
                <span style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--oh-ui-muted, rgba(255,255,255,0.68))" }}>
                  Removing it makes its regions unowned, drops its claims and removes its country record, flag and settings.
                  Review the confirmation carefully; this operation is not guaranteed to be reversible with map Undo.
                </span>
                <button
                  type="button"
                  style={{ ...pillButton(false), color: "#f87171", justifyContent: "center" }}
                  title="Make its regions unowned, drop the claims in its name, and remove the polity with its colour, flag and tags"
                  onClick={removeFromMap}
                >
                  Remove from the map
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {(!current || detailsTab === "manage") && (<>
      <div style={{ paddingTop: 8, borderTop: "1px solid var(--oh-ui-line, rgba(255,255,255,0.1))", display: "grid", gap: 7 }}>
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
            accept={acceptFor(".json,application/json")}
            style={{ display: "none" }}
            onChange={(e) => readRosterFile(e.target.files?.[0] || null)}
          />
        </div>


        {rosterPreview && (
          <div style={{ padding: "8px 9px", borderRadius: 8, background: "var(--oh-ui-raised, rgba(255,255,255,0.1))", border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.1))", display: "grid", gap: 6 }}>
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

        {rosterMessage.text && (
          <div style={{ fontSize: 10.8, lineHeight: 1.45, color: rosterMessage.ok ? "#86efac" : "#fca5a5" }}>
            {rosterMessage.text}
          </div>
        )}
      </div>

      </>)}
    </Panel>
  );
};

export default PolitiesPanel;
