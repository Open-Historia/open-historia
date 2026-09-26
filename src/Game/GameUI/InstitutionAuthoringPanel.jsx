import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  downloadScenarioJsonAsset,
  saveScenario,
  uploadScenarioAsset,
} from "../../runtime/library.js";
import {
  institutionAuthoringDraft,
  institutionAuthoringRows,
  upsertScenarioInstitution,
} from "../../runtime/institutionAuthoring.js";
import { INSTITUTION_KINDS } from "../../runtime/institutions.js";
import {
  BUILTIN_INSTITUTION_LOGOS,
  institutionLogoUrl,
} from "../../runtime/institutionLogos.js";
import { collectScenarioPoliticalPolities } from "../../runtime/scenarioPolities.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";

const actionButtonStyle = {
  alignItems: "center",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "999px",
  color: "rgba(246,246,248,0.94)",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "0.76rem",
  fontWeight: 750,
  gap: "0.35rem",
  justifyContent: "center",
  minHeight: "2rem",
  padding: "0 0.75rem",
};

const inputStyle = {
  background: "rgba(255,255,255,0.045)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "10px",
  boxSizing: "border-box",
  color: "#f8fafc",
  colorScheme: "dark",
  fontSize: "0.76rem",
  minWidth: 0,
  outline: "none",
  padding: "0.58rem 0.64rem",
  width: "100%",
};

const optionStyle = {
  backgroundColor: "#1a1b1f",
  color: "#f8fafc",
};

const labelStyle = {
  color: "rgba(255,255,255,0.58)",
  display: "block",
  fontSize: "0.62rem",
  fontWeight: 800,
  letterSpacing: "0.055em",
  marginBottom: "0.3rem",
  textTransform: "uppercase",
};

const sectionStyle = {
  background: "rgba(255,255,255,0.025)",
  border: "1px solid rgba(255,255,255,0.075)",
  borderRadius: "13px",
  padding: "0.72rem",
};

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const kindLabel = (value) => String(value || "other")
  .replace(/_/g, " ")
  .replace(/\b\w/g, (char) => char.toUpperCase());

const readSmallRasterAsDataUrl = (file) => new Promise((resolve, reject) => {
  const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  if (!allowed.has(file?.type)) {
    reject(new Error("Upload a PNG, JPEG, WebP or GIF. SVG logos should use a normal scenario/public asset path rather than inline SVG."));
    return;
  }
  if (Number(file?.size || 0) > 256 * 1024) {
    reject(new Error("Embedded institution logos are limited to 256 KB. Use a scenario/public asset path or web URL for larger artwork."));
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("Could not read the selected logo file."));
  reader.onload = () => resolve(String(reader.result || ""));
  reader.readAsDataURL(file);
});

const InstitutionLogoPreview = ({ draft, previewUrl = "", size = "4.2rem" }) => {
  const [failed, setFailed] = useState(false);
  const resolved = previewUrl || institutionLogoUrl(draft || {});
  useEffect(() => setFailed(false), [resolved]);
  const initials = String(draft?.shortName || draft?.name || draft?.id || "ORG")
    .trim()
    .split(/\s+/g)
    .slice(0, 3)
    .map((entry) => entry[0])
    .join("")
    .toUpperCase()
    .slice(0, 4) || "ORG";

  return (
    <div style={{ alignItems: "center", background: "rgba(7,10,18,0.72)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "14px", display: "flex", flex: "0 0 auto", height: size, justifyContent: "center", overflow: "hidden", width: size }}>
      {resolved && !failed
        ? <img alt="" aria-hidden="true" onError={() => setFailed(true)} src={resolved} style={{ maxHeight: `calc(${size} - 0.7rem)`, maxWidth: `calc(${size} - 0.7rem)`, objectFit: "contain" }} />
        : <span style={{ color: "rgba(255,255,255,0.82)", fontSize: "0.78rem", fontWeight: 900, letterSpacing: "0.05em" }}>{initials}</span>}
    </div>
  );
};

const EMPTY_DRAFT = institutionAuthoringDraft(null);

export default function InstitutionAuthoringPanel({ details, onDetailsChange }) {
  const isMobile = useIsMobile();
  const world = details?.data?.world || {};
  const rows = useMemo(() => institutionAuthoringRows(world), [world]);
  const [managerOpen, setManagerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingLogoDataUrl, setPendingLogoDataUrl] = useState("");
  const [memberEntry, setMemberEntry] = useState("");
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (dirty) return;
    const selected = rows.find((entry) => entry.id === selectedId) || rows[0] || null;
    setSelectedId(selected?.id || "");
    setDraft(institutionAuthoringDraft(selected));
  }, [rows, selectedId, dirty]);

  useEffect(() => {
    if (!managerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (dirty && !window.confirm("Discard unsaved institution edits?")) return;
      setManagerOpen(false);
      setMessage("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [managerOpen, dirty]);

  const filteredRows = useMemo(() => {
    const needle = clean(query).toLocaleLowerCase();
    if (!needle) return rows;
    return rows.filter((institution) => `${institution.name || ""} ${institution.shortName || ""} ${institution.kind || ""} ${institution.id || ""}`.toLocaleLowerCase().includes(needle));
  }, [query, rows]);

  const totalMembers = useMemo(() => rows.reduce((total, institution) => total + (Array.isArray(institution.members) ? institution.members.length : 0), 0), [rows]);

  const polityOptions = useMemo(() => collectScenarioPoliticalPolities(world)
    .filter((entry) => entry.active !== false)
    .map((entry) => {
      const override = world?.polityOverrides?.[entry.polityKey] || {};
      const label = clean(override?.name) || clean(entry.polityKey);
      const aliases = [entry.polityKey, label, ...(Array.isArray(override?.aliases) ? override.aliases : [])]
        .map((value) => clean(value))
        .filter(Boolean);
      return { polityKey: entry.polityKey, label, aliases };
    })
    .sort((left, right) => left.label.localeCompare(right.label)), [world]);

  const polityLookup = useMemo(() => {
    const map = new Map();
    for (const option of polityOptions) {
      for (const alias of option.aliases) map.set(alias.toLocaleLowerCase(), option);
    }
    return map;
  }, [polityOptions]);

  const edit = (field, value) => {
    setDirty(true);
    setMessage("");
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const chooseInstitution = (institution) => {
    if (institution?.id === selectedId && draft.id) return;
    if (dirty && !window.confirm("Discard unsaved institution edits?")) return;
    setSelectedId(institution?.id || "");
    setDraft(institutionAuthoringDraft(institution));
    setPendingLogoDataUrl("");
    setMemberEntry("");
    setDirty(false);
    setMessage("");
  };

  const createNew = () => {
    if (dirty && !window.confirm("Discard unsaved institution edits?")) return;
    setSelectedId("");
    setDraft(institutionAuthoringDraft(null));
    setPendingLogoDataUrl("");
    setMemberEntry("");
    setDirty(true);
    setMessage("");
  };

  const discard = () => {
    const selected = rows.find((entry) => entry.id === selectedId) || null;
    setDraft(institutionAuthoringDraft(selected));
    setPendingLogoDataUrl("");
    setMemberEntry("");
    setDirty(false);
    setMessage("");
  };

  const closeManager = () => {
    if (dirty && !window.confirm("Discard unsaved institution edits?")) return;
    if (dirty) discard();
    setManagerOpen(false);
    setMessage("");
  };

  const save = async () => {
    if (!details?.scenario?.id || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = upsertScenarioInstitution(world, draft);
      if (result.error) throw new Error(result.error);

      const institutionId = result.institution.id;
      const storedLogos = await downloadScenarioJsonAsset(details.scenario.id, "institutionLogos") || {};
      const nextStoredLogos = storedLogos && typeof storedLogos === "object" && !Array.isArray(storedLogos)
        ? { ...storedLogos }
        : {};
      if (pendingLogoDataUrl) nextStoredLogos[institutionId] = pendingLogoDataUrl;
      else if (result.institution.logoAsset !== true) delete nextStoredLogos[institutionId];

      if (pendingLogoDataUrl || Object.hasOwn(storedLogos || {}, institutionId)) {
        await uploadScenarioAsset(
          details.scenario.id,
          "institutionLogos",
          new Blob([JSON.stringify(nextStoredLogos)], { type: "application/json" }),
        );
      }

      const nextDetails = await saveScenario(details.scenario.id, {
        worldPatch: { institutions: result.world.institutions },
      });
      onDetailsChange?.(nextDetails);
      setSelectedId(result.institution.id);
      setDraft(institutionAuthoringDraft(result.institution));
      setPendingLogoDataUrl("");
      setDirty(false);
      setMessage("Institution saved to scenario canon.");
    } catch (error) {
      setMessage(error?.message || "Could not save institution.");
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async (event) => {
    const [file] = Array.from(event.target.files || []);
    event.target.value = "";
    if (!file) return;
    setMessage("");
    try {
      const dataUrl = await readSmallRasterAsDataUrl(file);
      setPendingLogoDataUrl(dataUrl);
      setDirty(true);
      setDraft((current) => ({ ...current, logoUrl: "", logoAsset: true }));
    } catch (error) {
      setMessage(error?.message || "Could not load logo.");
    }
  };

  const storedLogoPreview = draft.logoAsset === true && draft.id && details?.scenario?.id
    ? `/api/scenarios/${encodeURIComponent(details.scenario.id)}/institution-logo/${encodeURIComponent(draft.id)}`
    : "";
  const previewUrl = pendingLogoDataUrl || storedLogoPreview;

  const memberNames = useMemo(() => {
    const seen = new Set();
    return String(draft.membersText || "")
      .split(/[\n,;]+/g)
      .map((entry) => entry.trim())
      .filter((entry) => {
        const key = entry.toLocaleLowerCase();
        if (!entry || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [draft.membersText]);

  const setMemberNames = (names) => edit("membersText", names.join("\n"));

  const resolvePolityOption = (value) => polityLookup.get(clean(value).toLocaleLowerCase()) || null;
  const memberSelection = resolvePolityOption(memberEntry);
  const memberKeys = useMemo(() => new Set(memberNames.map((entry) => (resolvePolityOption(entry)?.polityKey || entry).toLocaleLowerCase())), [memberNames, polityLookup]);
  const memberSuggestions = useMemo(() => {
    const needle = clean(memberEntry).toLocaleLowerCase();
    return polityOptions
      .filter((option) => !memberKeys.has(option.polityKey.toLocaleLowerCase()))
      .filter((option) => !needle || option.aliases.some((alias) => alias.toLocaleLowerCase().includes(needle)))
      .slice(0, 10);
  }, [memberEntry, memberKeys, polityOptions]);

  const addMember = (polityKey = memberSelection?.polityKey || "") => {
    const next = clean(polityKey);
    if (!next || !polityOptions.some((option) => option.polityKey === next)) return;
    if (!memberKeys.has(next.toLocaleLowerCase())) setMemberNames([...memberNames, next]);
    setMemberEntry("");
    setMemberPickerOpen(false);
  };

  const removeMember = (name) => {
    setMemberNames(memberNames.filter((entry) => entry.toLocaleLowerCase() !== name.toLocaleLowerCase()));
  };

  const selectedInstitution = rows.find((entry) => entry.id === selectedId) || null;
  const selectedIsNew = !draft.id && dirty;
  const displayName = clean(draft.name) || "New institution";
  const displaySubtitle = clean(draft.shortName) || (selectedIsNew ? "Unsaved institution" : "Choose an institution to edit");

  const manager = managerOpen && typeof document !== "undefined" ? createPortal(
    <div
      aria-label="Institution authoring manager"
      aria-modal="true"
      role="dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeManager();
      }}
      style={{ alignItems: "center", background: "rgba(6,6,7,0.8)", backdropFilter: "blur(14px)", display: "flex", inset: 0, justifyContent: "center", padding: "clamp(0.5rem, 1.8vw, 1.2rem)", position: "fixed", zIndex: 2147483200 }}
    >
      <div data-institution-authoring-manager="true" style={{ background: "rgba(24,24,27,0.985)", border: "1px solid rgba(255,255,255,0.11)", borderRadius: "20px", boxShadow: "0 24px 70px rgba(0,0,0,0.52)", color: "#fff", display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 1.2rem)", minHeight: "min(44rem, calc(100vh - 1.2rem))", overflow: "hidden", width: "min(82rem, calc(100vw - 1rem))" }}>
        <header style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: "0.8rem", justifyContent: "space-between", padding: "0.85rem 1rem" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "rgba(255,255,255,0.46)", fontSize: "0.63rem", fontWeight: 850, letterSpacing: "0.08em", textTransform: "uppercase" }}>Scenario authoring</div>
            <div style={{ fontSize: "1.15rem", fontWeight: 850, letterSpacing: "-0.025em", marginTop: "0.12rem" }}>Institutions</div>
            <div style={{ color: "rgba(255,255,255,0.46)", fontSize: "0.69rem", marginTop: "0.16rem" }}>{rows.length} institution{rows.length === 1 ? "" : "s"} · {totalMembers} starting membership record{totalMembers === 1 ? "" : "s"}</div>
          </div>
          <button aria-label="Close Institutions manager" className="oh-tap" onClick={closeManager} style={{ ...actionButtonStyle, background: "rgba(255,255,255,0.04)", fontSize: "1rem", minWidth: "2.35rem", padding: 0 }} type="button">×</button>
        </header>

        <div style={{ display: "grid", flex: 1, gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(16rem, 0.78fr) minmax(0, 2.22fr)", gridTemplateRows: isMobile ? "minmax(11rem, 16rem) minmax(0, 1fr)" : undefined, minHeight: 0 }}>
          <aside style={{ borderBottom: isMobile ? "1px solid rgba(255,255,255,0.08)" : undefined, borderRight: isMobile ? undefined : "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", display: "grid", gap: "0.45rem", padding: "0.72rem" }}>
              <input aria-label="Search institutions" onChange={(event) => setQuery(event.target.value)} placeholder="Search institutions..." style={inputStyle} value={query} />
              <button onClick={createNew} style={{ ...actionButtonStyle, background: "var(--oh-grey-raised)", borderColor: "var(--oh-grey-border-strong)", width: "100%" }} type="button">+ Create institution</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0.45rem" }}>
              {selectedIsNew && (
                <button className="oh-tap-row" style={{ alignItems: "center", background: "var(--oh-grey-selected)", border: "1px solid var(--oh-grey-border-strong)", borderRadius: "10px", color: "#fff", cursor: "pointer", display: "flex", gap: "0.55rem", justifyContent: "space-between", marginBottom: "0.3rem", padding: "0.55rem 0.6rem", textAlign: "left", width: "100%" }} type="button">
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: "0.76rem", fontWeight: 800 }}>New institution</span>
                    <span style={{ color: "rgba(255,255,255,0.4)", display: "block", fontSize: "0.59rem", marginTop: "0.12rem" }}>Unsaved draft</span>
                  </span>
                  <span style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.24)", borderRadius: 999, color: "#fbbf24", flex: "0 0 auto", fontSize: "0.55rem", fontWeight: 900, padding: "0.1rem 0.35rem" }}>NEW</span>
                </button>
              )}
              {filteredRows.length ? filteredRows.map((institution) => {
                const selected = institution.id === selectedId && !selectedIsNew;
                const memberCount = Array.isArray(institution.members) ? institution.members.length : 0;
                return (
                  <button
                    className="oh-tap-row"
                    key={institution.id}
                    onClick={() => chooseInstitution(institution)}
                    style={{ alignItems: "center", background: selected ? "var(--oh-grey-selected)" : "transparent", border: `1px solid ${selected ? "var(--oh-grey-border-strong)" : "transparent"}`, borderRadius: "10px", color: "#fff", cursor: "pointer", display: "flex", gap: "0.55rem", justifyContent: "space-between", marginBottom: "0.22rem", padding: "0.55rem 0.6rem", textAlign: "left", width: "100%" }}
                    type="button"
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: "0.76rem", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{institution.shortName || institution.name}</span>
                      <span style={{ color: "rgba(255,255,255,0.38)", display: "block", fontSize: "0.59rem", marginTop: "0.12rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{institution.name}</span>
                    </span>
                    <span style={{ color: "rgba(255,255,255,0.38)", flex: "0 0 auto", fontSize: "0.56rem", fontWeight: 800 }}>{memberCount}</span>
                  </button>
                );
              }) : <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.72rem", padding: "1rem 0.5rem", textAlign: "center" }}>{rows.length ? "No institutions match this search." : "No authored institutions yet."}</div>}
            </div>
          </aside>

          <main style={{ minHeight: 0, overflowY: "auto", padding: "0.85rem 1rem 1rem" }}>
            <div style={{ alignItems: "flex-start", background: "rgba(24,24,27,0.96)", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "space-between", margin: "-0.85rem -1rem 0.75rem", padding: "0.85rem 1rem 0.72rem", position: "sticky", top: "-0.85rem", zIndex: 3 }}>
              <div style={{ alignItems: "center", display: "flex", gap: "0.7rem", minWidth: 0 }}>
                <InstitutionLogoPreview draft={draft} previewUrl={previewUrl} size="3.4rem" />
                <div style={{ minWidth: 0 }}>
                  <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.42rem" }}>
                    <div style={{ fontSize: "1.05rem", fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</div>
                    <span style={{ background: selectedIsNew ? "rgba(245,158,11,0.12)" : "rgba(34,197,94,0.12)", border: `1px solid ${selectedIsNew ? "rgba(245,158,11,0.24)" : "rgba(34,197,94,0.24)"}`, borderRadius: 999, color: selectedIsNew ? "#fbbf24" : "#86efac", fontSize: "0.55rem", fontWeight: 900, padding: "0.11rem 0.36rem", textTransform: "uppercase" }}>{selectedIsNew ? "New draft" : "Scenario canon"}</span>
                  </div>
                  <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.63rem", marginTop: "0.16rem" }}>{displaySubtitle}{draft.id ? ` · ${draft.id}` : ""}</div>
                  <div style={{ color: "rgba(255,255,255,0.44)", fontSize: "0.66rem", lineHeight: 1.4, marginTop: "0.3rem", maxWidth: "48rem" }}>Create institutions that already exist when the scenario begins. Political World may enrich them later while preserving the authored canonical identity, membership and visual assets.</div>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                <button disabled={!dirty || busy} onClick={discard} style={{ ...actionButtonStyle, opacity: !dirty || busy ? 0.45 : 1 }} type="button">Discard</button>
                <button disabled={!dirty || busy} onClick={save} style={{ ...actionButtonStyle, background: "var(--oh-grey-raised)", borderColor: "var(--oh-grey-border-strong)", opacity: !dirty || busy ? 0.5 : 1 }} type="button">{busy ? "Saving..." : "Save institution"}</button>
              </div>
            </div>

            {message && (
              <div style={{ background: /saved/i.test(message) ? "rgba(34,197,94,0.08)" : "rgba(248,113,113,0.08)", border: `1px solid ${/saved/i.test(message) ? "rgba(34,197,94,0.2)" : "rgba(248,113,113,0.22)"}`, borderRadius: "10px", color: /saved/i.test(message) ? "#bbf7d0" : "#fecaca", fontSize: "0.68rem", lineHeight: 1.45, marginBottom: "0.7rem", padding: "0.55rem 0.65rem" }}>
                {message}
              </div>
            )}

            <div style={{ display: "grid", gap: "0.7rem" }}>
              <details open style={sectionStyle}>
                <summary style={{ cursor: "pointer", fontSize: "0.78rem", fontWeight: 850 }}>Identity & lifecycle</summary>
                <div style={{ display: "grid", gap: "0.62rem", gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))", marginTop: "0.7rem" }}>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={labelStyle}>Name</label>
                    <input onChange={(event) => edit("name", event.target.value)} placeholder="e.g. Northern League" style={inputStyle} value={draft.name} />
                  </div>
                  <div>
                    <label style={labelStyle}>Short name</label>
                    <input onChange={(event) => edit("shortName", event.target.value)} placeholder="NL" style={inputStyle} value={draft.shortName} />
                  </div>
                  <div>
                    <label style={labelStyle}>Type</label>
                    <select onChange={(event) => edit("kind", event.target.value)} style={inputStyle} value={draft.kind}>
                      {INSTITUTION_KINDS.map((kind) => <option key={kind} style={optionStyle} value={kind}>{kindLabel(kind)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Founded</label>
                    <input onChange={(event) => edit("foundedDate", event.target.value)} placeholder="YYYY-MM-DD" style={inputStyle} value={draft.foundedDate} />
                  </div>
                  <div>
                    <label style={labelStyle}>Dissolved</label>
                    <input onChange={(event) => edit("dissolvedDate", event.target.value)} placeholder="Leave blank if active" style={inputStyle} value={draft.dissolvedDate} />
                  </div>
                </div>
              </details>

              <details open style={sectionStyle}>
                <summary style={{ cursor: "pointer", fontSize: "0.78rem", fontWeight: 850 }}>Starting membership ({memberNames.length})</summary>
                <div style={{ color: "rgba(255,255,255,0.44)", fontSize: "0.64rem", lineHeight: 1.45, marginTop: "0.35rem" }}>Add the polities that belong to this institution when the scenario begins. Existing member roles and statuses are preserved for members that remain in the list.</div>
                <div style={{ alignItems: "flex-start", display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.6rem" }}>
                  <div style={{ flex: "1 1 16rem", minWidth: 0, position: "relative" }}>
                    <input
                      aria-autocomplete="list"
                      aria-expanded={memberPickerOpen}
                      aria-label="Search scenario polities for institution membership"
                      onBlur={() => window.setTimeout(() => setMemberPickerOpen(false), 120)}
                      onChange={(event) => { setMemberEntry(event.target.value); setMemberPickerOpen(true); }}
                      onFocus={() => setMemberPickerOpen(true)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") { setMemberPickerOpen(false); return; }
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        if (memberSelection) addMember(memberSelection.polityKey);
                        else if (memberSuggestions.length === 1) addMember(memberSuggestions[0].polityKey);
                      }}
                      placeholder="Search scenario polities..."
                      role="combobox"
                      style={inputStyle}
                      value={memberEntry}
                    />
                    {memberPickerOpen && (
                      <div role="listbox" style={{ background: "#1a1b1f", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", boxShadow: "0 14px 36px rgba(0,0,0,0.42)", left: 0, maxHeight: "15rem", overflowY: "auto", padding: "0.3rem", position: "absolute", right: 0, top: "calc(100% + 0.3rem)", zIndex: 40 }}>
                        {memberSuggestions.length ? memberSuggestions.map((option) => (
                          <button
                            key={option.polityKey}
                            onMouseDown={(event) => { event.preventDefault(); addMember(option.polityKey); }}
                            role="option"
                            style={{ background: "transparent", border: 0, borderRadius: "8px", color: "#f8fafc", cursor: "pointer", display: "block", padding: "0.5rem 0.55rem", textAlign: "left", width: "100%" }}
                            type="button"
                          >
                            <span style={{ display: "block", fontSize: "0.72rem", fontWeight: 800 }}>{option.label}</span>
                            {option.polityKey !== option.label && <code style={{ color: "rgba(255,255,255,0.38)", display: "block", fontSize: "0.58rem", marginTop: "0.12rem" }}>{option.polityKey}</code>}
                          </button>
                        )) : (
                          <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.66rem", padding: "0.65rem" }}>{polityOptions.length ? "No matching scenario polity." : "This scenario has no canonical polity roster to choose from."}</div>
                        )}
                      </div>
                    )}
                  </div>
                  <button disabled={!memberSelection || memberKeys.has(memberSelection.polityKey.toLocaleLowerCase())} onClick={() => addMember(memberSelection?.polityKey)} style={{ ...actionButtonStyle, opacity: memberSelection && !memberKeys.has(memberSelection.polityKey.toLocaleLowerCase()) ? 1 : 0.45 }} type="button">Add member</button>
                </div>
                <div style={{ color: "rgba(255,255,255,0.36)", fontSize: "0.61rem", lineHeight: 1.4, marginTop: "0.35rem" }}>Only canonical polities in this scenario can be added. Typing text does not create a membership record - choose a polity from the results.</div>
                {memberNames.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.6rem" }}>
                    {memberNames.map((name) => {
                      const option = resolvePolityOption(name);
                      const unresolved = polityOptions.length > 0 && !option;
                      const label = option?.label || name;
                      return (
                        <span key={name.toLocaleLowerCase()} title={unresolved ? "This member does not resolve to the scenario polity roster and must be removed or corrected before saving." : option?.polityKey || name} style={{ alignItems: "center", background: unresolved ? "rgba(248,113,113,0.08)" : "rgba(255,255,255,0.05)", border: `1px solid ${unresolved ? "rgba(248,113,113,0.24)" : "var(--oh-grey-border)"}`, borderRadius: "999px", color: unresolved ? "#fecaca" : undefined, display: "inline-flex", fontSize: "0.66rem", gap: "0.35rem", padding: "0.3rem 0.35rem 0.3rem 0.55rem" }}>
                          {label}{unresolved ? " · unresolved" : ""}
                          <button aria-label={`Remove ${label}`} onClick={() => removeMember(name)} style={{ background: "transparent", border: 0, color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: "0.8rem", lineHeight: 1, padding: "0 0.15rem" }} type="button">×</button>
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: "10px", color: "rgba(255,255,255,0.36)", fontSize: "0.66rem", marginTop: "0.6rem", padding: "0.75rem", textAlign: "center" }}>No starting members added.</div>
                )}
                <details style={{ marginTop: "0.65rem" }}>
                  <summary style={{ color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: "0.65rem", fontWeight: 750 }}>Advanced bulk edit member list</summary>
                  <div style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.6rem", lineHeight: 1.4, marginTop: "0.35rem" }}>Values are validated against the scenario polity roster on save. Unknown names or IDs are rejected.</div>
                  <textarea onChange={(event) => edit("membersText", event.target.value)} placeholder="One canonical polity per line" style={{ ...inputStyle, minHeight: "6rem", marginTop: "0.45rem", resize: "vertical" }} value={draft.membersText} />
                </details>
              </details>

              <details style={sectionStyle}>
                <summary style={{ cursor: "pointer", fontSize: "0.78rem", fontWeight: 850 }}>Visual identity</summary>
                <div style={{ alignItems: "flex-start", display: "grid", gap: "0.8rem", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "auto minmax(0, 1fr)", marginTop: "0.7rem" }}>
                  <InstitutionLogoPreview draft={draft} previewUrl={previewUrl} size="5rem" />
                  <div style={{ display: "grid", gap: "0.55rem", minWidth: 0 }}>
                    <div>
                      <label style={labelStyle}>Historical emblem</label>
                      <select
                        onChange={(event) => {
                          const badgeKey = event.target.value;
                          setPendingLogoDataUrl("");
                          setDirty(true);
                          setDraft((current) => ({ ...current, badgeKey, logoUrl: "", logoAsset: false }));
                        }}
                        style={inputStyle}
                        value={draft.logoUrl || draft.logoAsset ? "" : draft.badgeKey}
                      >
                        <option style={optionStyle} value="">None / custom logo</option>
                        {Object.keys(BUILTIN_INSTITUTION_LOGOS).map((badgeKey) => <option key={badgeKey} style={optionStyle} value={badgeKey}>{badgeKey.toUpperCase()}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Custom logo URL or asset path</label>
                      <input onChange={(event) => { setPendingLogoDataUrl(""); setDirty(true); setMessage(""); setDraft((current) => ({ ...current, badgeKey: "", logoUrl: event.target.value, logoAsset: false })); }} placeholder="logos/my-alliance.svg or https://..." style={inputStyle} value={draft.logoUrl} />
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                      <button onClick={() => fileRef.current?.click()} style={actionButtonStyle} type="button">Upload small logo</button>
                      <button onClick={() => { setPendingLogoDataUrl(""); setDirty(true); setDraft((current) => ({ ...current, badgeKey: "", logoUrl: "", logoAsset: false })); }} style={actionButtonStyle} type="button">Clear logo</button>
                      <input accept=".gif,.jpeg,.jpg,.png,.webp" onChange={uploadLogo} ref={fileRef} style={{ display: "none" }} type="file" />
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.61rem", lineHeight: 1.45 }}>PNG, JPEG, WebP and GIF uploads up to 256 KB can travel with the scenario. Use an asset path or URL for SVG or larger artwork.</div>
                  </div>
                </div>
              </details>

              <details style={sectionStyle}>
                <summary style={{ cursor: "pointer", fontSize: "0.78rem", fontWeight: 850 }}>Advanced details</summary>
                <div style={{ display: "grid", gap: "0.55rem", marginTop: "0.65rem" }}>
                  <div>
                    <label style={labelStyle}>Aliases</label>
                    <input onChange={(event) => edit("aliasesText", event.target.value)} placeholder="Comma-separated alternate names" style={inputStyle} value={draft.aliasesText} />
                  </div>
                  <div>
                    <label style={labelStyle}>Author note</label>
                    <textarea onChange={(event) => edit("note", event.target.value)} placeholder="Optional note for scenario authors" style={{ ...inputStyle, minHeight: "5rem", resize: "vertical" }} value={draft.note} />
                  </div>
                  {draft.id && <div style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.61rem" }}>Canonical id: <code>{draft.id}</code></div>}
                </div>
              </details>
            </div>
          </main>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.9rem", padding: "0.9rem" }}>
      <div style={{ alignItems: "flex-start", display: "flex", flexWrap: "wrap", gap: "0.7rem", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "rgba(255,255,255,0.94)", fontSize: "0.95rem", fontWeight: 800 }}>Institutions</div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.7rem", lineHeight: 1.5, marginTop: "0.2rem" }}>Create institutions that already exist when the scenario begins. Political World generation may enrich membership and governance later, but it will preserve the identity and artwork you author here.</div>
          <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.64rem", marginTop: "0.35rem" }}>{rows.length} institution{rows.length === 1 ? "" : "s"} configured · {totalMembers} starting member{totalMembers === 1 ? "" : "s"}.</div>
        </div>
        <button onClick={() => setManagerOpen(true)} style={{ ...actionButtonStyle, background: "var(--oh-grey-raised)", borderColor: "var(--oh-grey-border-strong)", flex: "0 0 auto" }} type="button">Manage institutions</button>
      </div>
      {!rows.length && (
        <div style={{ background: "rgba(255,255,255,0.035)", border: "1px solid var(--oh-grey-border)", borderRadius: 12, color: "var(--oh-grey-muted)", fontSize: "0.7rem", lineHeight: 1.5, marginTop: "0.75rem", padding: "0.65rem 0.7rem" }}><strong>No institutions created yet.</strong> Open the manager to author one manually, or leave this empty and let Political World generation establish relevant institutions later.</div>
      )}
      {manager}
    </div>
  );
}
