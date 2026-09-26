/*! Open Historia - scenario Political World manual authoring */
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { saveScenario } from "../../runtime/library.js";
import {
  POLITICAL_REGIME_CHARACTERS,
  POLITICAL_REPRESENTATIONS,
} from "../../runtime/politicalActors.js";
import {
  POLITICAL_TRAIT_REGISTRY,
  canonicalPoliticalTraitKey,
  normalizePoliticalTraitValue,
} from "../../runtime/politicalTraitRegistry.js";
import { collectScenarioPoliticalPolities } from "../../runtime/scenarioPolities.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import {
  applyPoliticalEditorStateToWorld,
  politicalActorToEditorState,
  politicalDebugSnapshotFromWorld,
} from "./countryEditorPolitical.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const clone = (value) => {
  if (!value || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const panelStyle = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "18px",
  marginBottom: "0.95rem",
  padding: "0.9rem",
};

const buttonStyle = {
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

const emptyParty = () => ({
  id: `custom-party-${Date.now().toString(36)}`,
  name: "New political entity",
  shortName: "",
  leader: "",
  ideology: "",
  publicDescription: "",
  publicPrioritiesText: "",
  publicForeignPolicyText: "",
  supportPercent: "",
  influencePercent: "",
  influenceLabel: "",
  ruling: false,
  coalition: false,
  priorityField: "publicPriorities",
});

const emptyBloc = () => ({
  id: `custom-bloc-${Date.now().toString(36)}`,
  name: "New power bloc",
  shortName: "",
  kind: "",
  status: "",
  leader: "",
  ideology: "",
  publicDescription: "",
  publicPrioritiesText: "",
  publicForeignPolicyText: "",
  influencePercent: "",
  influenceLabel: "",
  priorityField: "publicPriorities",
});

const actorLabel = (world, polityKey) => clean(world?.polityOverrides?.[polityKey]?.name) || clean(polityKey) || "Unknown polity";

const representationLabel = (value) => clean(value).replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

export default function PoliticalWorldAuthoringPanel({ details, onDetailsChange }) {
  const isMobile = useIsMobile();
  const world = details?.data?.world || {};
  const scenarioId = details?.scenario?.id || "";
  const rows = useMemo(() => collectScenarioPoliticalPolities(world).map((entry) => ({
    ...entry,
    label: actorLabel(world, entry.polityKey),
    hasActor: Boolean(world?.politicalActors?.byPolity?.[entry.polityKey]),
  })).sort((a, b) => a.label.localeCompare(b.label)), [world]);

  const actorCount = Object.keys(world?.politicalActors?.byPolity || {}).length;
  const [managerOpen, setManagerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [draft, setDraft] = useState(() => politicalActorToEditorState(null));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!managerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !dirty) setManagerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [managerOpen, dirty]);

  useEffect(() => {
    if (dirty) return;
    const first = rows.find((row) => row.polityKey === selectedKey) || rows[0] || null;
    const key = first?.polityKey || "";
    if (key !== selectedKey) setSelectedKey(key);
    setDraft(politicalActorToEditorState(key ? world?.politicalActors?.byPolity?.[key] || null : null));
  }, [rows, selectedKey, world, dirty]);

  const filteredRows = useMemo(() => {
    const needle = clean(query).toLocaleLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => `${row.label} ${row.polityKey}`.toLocaleLowerCase().includes(needle));
  }, [rows, query]);

  const selectPolity = (key) => {
    if (key === selectedKey) return;
    if (dirty && !window.confirm("Discard unsaved Political World edits for this polity?")) return;
    setSelectedKey(key);
    setDraft(politicalActorToEditorState(world?.politicalActors?.byPolity?.[key] || null));
    setDirty(false);
    setMessage("");
  };

  const edit = (field, value) => {
    setDirty(true);
    setMessage("");
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const editTrait = (key, value) => {
    setDirty(true);
    setMessage("");
    setDraft((current) => {
      const next = { ...current, traitValues: { ...(current.traitValues || {}), [key]: value } };
      try {
        const raw = JSON.parse(String(current.traitsJson || "{}").trim() || "{}");
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const rawKey of Object.keys(raw)) {
            if (canonicalPoliticalTraitKey(rawKey) === key) delete raw[rawKey];
          }
          const normalized = normalizePoliticalTraitValue(value);
          if (normalized != null) raw[key] = normalized;
          next.traitsJson = JSON.stringify(raw, null, 2);
        }
      } catch {
        // Preserve invalid in-progress JSON; save-time validation explains it.
      }
      return next;
    });
  };

  const editTraitsJson = (value) => {
    setDirty(true);
    setMessage("");
    setDraft((current) => {
      const next = { ...current, traitsJson: value };
      try {
        const parsed = JSON.parse(String(value || "{}").trim() || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return next;
        const traitValues = Object.fromEntries(POLITICAL_TRAIT_REGISTRY.map((definition) => [definition.key, ""]));
        for (const [rawKey, rawValue] of Object.entries(parsed)) {
          const key = canonicalPoliticalTraitKey(rawKey);
          if (!key) continue;
          const normalized = normalizePoliticalTraitValue(rawValue);
          if (normalized != null) traitValues[key] = String(normalized);
        }
        next.traitValues = traitValues;
      } catch {
        // Invalid JSON is allowed while typing and rejected when Save is attempted.
      }
      return next;
    });
  };

  const editParty = (index, field, value) => {
    setDirty(true);
    setMessage("");
    setDraft((current) => ({
      ...current,
      parties: (current.parties || []).map((party, partyIndex) => partyIndex === index ? { ...party, [field]: value } : party),
    }));
  };

  const editBloc = (index, field, value) => {
    setDirty(true);
    setMessage("");
    setDraft((current) => ({
      ...current,
      powerBlocs: (current.powerBlocs || []).map((bloc, blocIndex) => blocIndex === index ? { ...bloc, [field]: value } : bloc),
    }));
  };

  const discard = () => {
    setDraft(politicalActorToEditorState(selectedKey ? world?.politicalActors?.byPolity?.[selectedKey] || null : null));
    setDirty(false);
    setMessage("");
  };

  const save = async () => {
    if (!scenarioId || !selectedKey || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const nextWorld = clone(world) || {};
      const actor = applyPoliticalEditorStateToWorld(nextWorld, selectedKey, draft);
      const nextDetails = await saveScenario(scenarioId, {
        worldPatch: { politicalActors: nextWorld.politicalActors },
      });
      onDetailsChange?.(nextDetails);
      setDraft(politicalActorToEditorState(actor));
      setDirty(false);
      setMessage("Political Actor saved to scenario canon.");
    } catch (error) {
      setMessage(error?.message || "Could not save Political Actor.");
    } finally {
      setBusy(false);
    }
  };

  const addParty = () => {
    setDirty(true);
    setMessage("");
    setDraft((current) => ({ ...current, parties: [...(current.parties || []), emptyParty()] }));
  };
  const removeParty = (index) => {
    setDirty(true);
    setMessage("");
    setDraft((current) => ({ ...current, parties: (current.parties || []).filter((_, row) => row !== index) }));
  };
  const addBloc = () => {
    setDirty(true);
    setMessage("");
    setDraft((current) => ({ ...current, powerBlocs: [...(current.powerBlocs || []), emptyBloc()] }));
  };
  const removeBloc = (index) => {
    setDirty(true);
    setMessage("");
    setDraft((current) => ({ ...current, powerBlocs: (current.powerBlocs || []).filter((_, row) => row !== index) }));
  };

  const closeManager = () => {
    if (dirty && !window.confirm("Discard unsaved Political World edits?")) return;
    setManagerOpen(false);
    setDirty(false);
    setMessage("");
  };

  const renderInput = (label, field, props = {}) => (
    <div style={{ minWidth: 0 }}>
      <label style={labelStyle}>{label}</label>
      <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} value={draft[field] ?? ""} onChange={(event) => edit(field, event.target.value)} />
    </div>
  );

  const renderTextarea = (label, field, placeholder = "") => (
    <div style={{ minWidth: 0 }}>
      <label style={labelStyle}>{label}</label>
      <textarea rows={4} placeholder={placeholder} style={{ ...inputStyle, lineHeight: 1.45, minHeight: "6rem", resize: "vertical" }} value={draft[field] ?? ""} onChange={(event) => edit(field, event.target.value)} />
    </div>
  );

  const selectedActor = selectedKey ? world?.politicalActors?.byPolity?.[selectedKey] || null : null;
  const debugSnapshot = selectedKey ? politicalDebugSnapshotFromWorld(world, selectedKey) : null;

  const manager = managerOpen && typeof document !== "undefined" ? createPortal(
    <div
      aria-label="Political World authoring manager"
      aria-modal="true"
      role="dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeManager();
      }}
      style={{ alignItems: "center", background: "rgba(6,6,7,0.8)", backdropFilter: "blur(14px)", display: "flex", inset: 0, justifyContent: "center", padding: "clamp(0.5rem, 1.8vw, 1.2rem)", position: "fixed", zIndex: 2147483200 }}
    >
      <div style={{ background: "rgba(24,24,27,0.985)", border: "1px solid rgba(255,255,255,0.11)", borderRadius: "20px", boxShadow: "0 24px 70px rgba(0,0,0,0.52)", color: "#fff", display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 1.2rem)", minHeight: "min(46rem, calc(100vh - 1.2rem))", overflow: "hidden", width: "min(92rem, calc(100vw - 1rem))" }}>
        <header style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: "0.8rem", justifyContent: "space-between", padding: "0.85rem 1rem" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "rgba(255,255,255,0.46)", fontSize: "0.63rem", fontWeight: 850, letterSpacing: "0.08em", textTransform: "uppercase" }}>Scenario authoring</div>
            <div style={{ fontSize: "1.15rem", fontWeight: 850, letterSpacing: "-0.025em", marginTop: "0.12rem" }}>Political World</div>
            <div style={{ color: "rgba(255,255,255,0.46)", fontSize: "0.69rem", marginTop: "0.16rem" }}>{actorCount} canonical actor{actorCount === 1 ? "" : "s"} · {rows.length} scenario polities</div>
          </div>
          <button aria-label="Close Political World manager" className="oh-tap" onClick={closeManager} style={{ ...buttonStyle, background: "rgba(255,255,255,0.04)", fontSize: "1rem", minWidth: "2.35rem", padding: 0 }} type="button">×</button>
        </header>

        <div style={{ display: "grid", flex: 1, gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(15rem, 0.72fr) minmax(0, 2.28fr)", gridTemplateRows: isMobile ? "minmax(10rem, 15rem) minmax(0, 1fr)" : undefined, minHeight: 0 }}>
          <aside style={{ borderBottom: isMobile ? "1px solid rgba(255,255,255,0.08)" : undefined, borderRight: isMobile ? undefined : "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "0.72rem" }}>
              <input aria-label="Search scenario polities" placeholder="Search polity..." style={inputStyle} value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0.45rem" }}>
              {filteredRows.length ? filteredRows.map((row) => {
                const selected = row.polityKey === selectedKey;
                return (
                  <button
                    className="oh-tap-row"
                    key={row.polityKey}
                    onClick={() => selectPolity(row.polityKey)}
                    style={{ alignItems: "center", background: selected ? "var(--oh-grey-selected)" : "transparent", border: `1px solid ${selected ? "var(--oh-grey-border-strong)" : "transparent"}`, borderRadius: "10px", color: "#fff", cursor: "pointer", display: "flex", gap: "0.55rem", justifyContent: "space-between", marginBottom: "0.22rem", padding: "0.55rem 0.6rem", textAlign: "left", width: "100%" }}
                    type="button"
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: "0.76rem", fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</span>
                      <code style={{ color: "rgba(255,255,255,0.35)", display: "block", fontSize: "0.57rem", marginTop: "0.12rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.polityKey}</code>
                    </span>
                    <span title={row.hasActor ? "Political Actor exists" : "No Political Actor yet"} style={{ background: row.hasActor ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.12)", border: `1px solid ${row.hasActor ? "rgba(34,197,94,0.26)" : "rgba(245,158,11,0.24)"}`, borderRadius: 999, color: row.hasActor ? "#86efac" : "#fbbf24", flex: "0 0 auto", fontSize: "0.55rem", fontWeight: 900, padding: "0.1rem 0.35rem" }}>{row.hasActor ? "PW" : "+"}</span>
                  </button>
                );
              }) : <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.72rem", padding: "1rem 0.5rem", textAlign: "center" }}>No polities match this search.</div>}
            </div>
          </aside>

          <main style={{ minHeight: 0, overflowY: "auto", padding: "0.85rem 1rem 1rem" }}>
            {!selectedKey ? (
              <div style={{ color: "rgba(255,255,255,0.44)", padding: "3rem 1rem", textAlign: "center" }}>This scenario has no editable polity roster yet.</div>
            ) : (
              <>
                <div style={{ alignItems: "flex-start", background: "rgba(24,24,27,0.96)", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "space-between", margin: "-0.85rem -1rem 0.75rem", padding: "0.85rem 1rem 0.72rem", position: "sticky", top: "-0.85rem", zIndex: 3 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
                      <div style={{ fontSize: "1.05rem", fontWeight: 850 }}>{actorLabel(world, selectedKey)}</div>
                      <span style={{ background: selectedActor ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)", border: `1px solid ${selectedActor ? "rgba(34,197,94,0.26)" : "rgba(245,158,11,0.24)"}`, borderRadius: 999, color: selectedActor ? "#86efac" : "#fbbf24", fontSize: "0.56rem", fontWeight: 900, padding: "0.12rem 0.38rem", textTransform: "uppercase" }}>{selectedActor ? "Canonical actor" : "Creates actor on save"}</span>
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.63rem", marginTop: "0.18rem" }}>Stable polity key: <code>{selectedKey}</code></div>
                    <div style={{ color: "rgba(255,255,255,0.44)", fontSize: "0.67rem", lineHeight: 1.45, marginTop: "0.35rem", maxWidth: "52rem" }}>Edits write directly to the scenario's canonical <code>world.politicalActors</code> ledger. Blank trait values remain unset, not zero. Hidden native/derived Political World state is preserved.</div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    <button disabled={!dirty || busy} onClick={discard} style={{ ...buttonStyle, opacity: !dirty || busy ? 0.45 : 1 }} type="button">Discard</button>
                    <button disabled={!dirty || busy} onClick={save} style={{ ...buttonStyle, background: "var(--oh-grey-raised)", borderColor: "var(--oh-grey-border-strong)", opacity: !dirty || busy ? 0.5 : 1 }} type="button">{busy ? "Saving..." : "Save Political Actor"}</button>
                  </div>
                </div>

                {message ? <div style={{ background: message.startsWith("Political Actor saved") ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.09)", border: `1px solid ${message.startsWith("Political Actor saved") ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.24)"}`, borderRadius: "10px", color: message.startsWith("Political Actor saved") ? "#bbf7d0" : "#fecaca", fontSize: "0.7rem", marginBottom: "0.7rem", padding: "0.5rem 0.65rem" }}>{message}</div> : null}

                <div style={{ display: "grid", gap: "0.7rem" }}>
                  <details open style={sectionStyle}>
                    <summary style={{ cursor: "pointer", fontSize: "0.78rem", fontWeight: 850 }}>Government & political system</summary>
                    <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))", marginTop: "0.7rem" }}>
                      {renderInput("Government form", "governmentForm")}
                      {renderInput("Government ideology", "governmentIdeology")}
                      {renderInput("Head of state", "headOfState")}
                      {renderInput("Head of government", "headOfGovernment")}
                      {renderInput("Operative political leader", "politicalLeader")}
                      {renderInput("Government status", "governmentStatus")}
                      {renderInput("Coalition / cabinet name", "coalitionName")}
                      {renderInput("Political system type", "politicalSystemType")}
                      <div style={{ minWidth: 0 }}>
                        <label style={labelStyle}>Representation model</label>
                        <select style={inputStyle} value={draft.politicalRepresentation ?? ""} onChange={(event) => edit("politicalRepresentation", event.target.value)}>
                          <option style={optionStyle} value="">Auto / unspecified</option>
                          {Object.values(POLITICAL_REPRESENTATIONS).map((value) => <option key={value} style={optionStyle} value={value}>{representationLabel(value)}</option>)}
                        </select>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <label style={labelStyle}>Regime character</label>
                        <select style={inputStyle} value={draft.regimeCharacter ?? ""} onChange={(event) => edit("regimeCharacter", event.target.value)}>
                          <option style={optionStyle} value="">Unspecified</option>
                          {POLITICAL_REGIME_CHARACTERS.map((value) => <option key={value} style={optionStyle} value={value}>{representationLabel(value)}</option>)}
                        </select>
                      </div>
                      {renderInput("Government approval / 100", "approval", { type: "number", min: "0", max: "100", step: "0.1" })}
                      {renderInput("Political stability / 100", "politicalStability", { type: "number", min: "0", max: "100", step: "0.1" })}
                      {renderInput("Public system label", "politicalSystemLabel")}
                    </div>
                    <div style={{ marginTop: "0.55rem" }}>{renderTextarea("Political-system notes", "politicalSystemNotes")}</div>
                  </details>

                  <details style={sectionStyle}>
                    <summary style={{ cursor: "pointer", fontSize: "0.78rem", fontWeight: 850 }}>Strategic outlook</summary>
                    <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.64rem", lineHeight: 1.45, marginTop: "0.35rem" }}>One item per line. These are canonical causal inputs, not flavor text.</div>
                    <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))", marginTop: "0.65rem" }}>
                      {renderTextarea("Goals", "goalsText", "One goal per line")}
                      {renderTextarea("Fears", "fearsText", "One fear per line")}
                      {renderTextarea("Ambitions", "ambitionsText", "One ambition per line")}
                      {renderTextarea("Domestic pressure notes", "domesticPressuresText", "One pressure per line")}
                    </div>
                  </details>

                  <details style={sectionStyle}>
                    <summary style={{ cursor: "pointer", fontSize: "0.78rem", fontWeight: 850 }}>Parties / political entities ({draft.parties?.length || 0})</summary>
                    <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.63rem", lineHeight: 1.45, marginTop: "0.35rem" }}>Ruling and coalition flags write to canonical government party IDs.</div>
                    <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.6rem" }}>
                      {(draft.parties || []).map((party, index) => (
                        <details key={party.id || index} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.075)", borderRadius: "10px", padding: "0.55rem" }}>
                          <summary style={{ cursor: "pointer", fontSize: "0.72rem", fontWeight: 800 }}>{party.name || `Political entity ${index + 1}`}{party.ruling ? " · Government" : party.coalition ? " · Coalition" : ""}</summary>
                          <div style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", marginTop: "0.6rem" }}>
                            {[["Name", "name"], ["Short name", "shortName"], ["Leader", "leader"], ["Ideology", "ideology"], ["Influence label", "influenceLabel"]].map(([label, field]) => <div key={field}><label style={labelStyle}>{label}</label><input style={inputStyle} value={party[field] ?? ""} onChange={(event) => editParty(index, field, event.target.value)} /></div>)}
                            <div><label style={labelStyle}>Support (%)</label><input type="number" min="0" max="100" step="0.1" style={inputStyle} value={party.supportPercent ?? ""} onChange={(event) => editParty(index, "supportPercent", event.target.value)} /></div>
                            <div><label style={labelStyle}>Influence (%)</label><input type="number" min="0" max="100" step="0.1" style={inputStyle} value={party.influencePercent ?? ""} onChange={(event) => editParty(index, "influencePercent", event.target.value)} /></div>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", marginTop: "0.55rem" }}>
                            <label style={{ alignItems: "center", display: "flex", fontSize: "0.68rem", gap: "0.35rem" }}><input checked={party.ruling === true} onChange={(event) => editParty(index, "ruling", event.target.checked)} type="checkbox" /> Ruling / government</label>
                            <label style={{ alignItems: "center", display: "flex", fontSize: "0.68rem", gap: "0.35rem" }}><input checked={party.coalition === true} disabled={party.ruling === true} onChange={(event) => editParty(index, "coalition", event.target.checked)} type="checkbox" /> Coalition partner</label>
                          </div>
                          <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))", marginTop: "0.55rem" }}>
                            <div><label style={labelStyle}>Public description</label><textarea rows={3} style={{ ...inputStyle, resize: "vertical" }} value={party.publicDescription ?? ""} onChange={(event) => editParty(index, "publicDescription", event.target.value)} /></div>
                            <div><label style={labelStyle}>Public priorities · one per line</label><textarea rows={3} style={{ ...inputStyle, resize: "vertical" }} value={party.publicPrioritiesText ?? ""} onChange={(event) => editParty(index, "publicPrioritiesText", event.target.value)} /></div>
                            <div><label style={labelStyle}>Foreign-policy outlook · one per line</label><textarea rows={3} style={{ ...inputStyle, resize: "vertical" }} value={party.publicForeignPolicyText ?? ""} onChange={(event) => editParty(index, "publicForeignPolicyText", event.target.value)} /></div>
                          </div>
                          <details style={{ marginTop: "0.55rem" }}>
                            <summary style={{ color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: "0.65rem", fontWeight: 750 }}>Advanced identity</summary>
                            <div style={{ marginTop: "0.45rem" }}><label style={labelStyle}>Stable party ID</label><input style={inputStyle} value={party.id ?? ""} onChange={(event) => editParty(index, "id", event.target.value)} /></div>
                          </details>
                          <button onClick={() => removeParty(index)} style={{ ...buttonStyle, color: "#fca5a5", marginTop: "0.55rem" }} type="button">Remove political entity</button>
                        </details>
                      ))}
                    </div>
                    <button onClick={addParty} style={{ ...buttonStyle, marginTop: "0.6rem" }} type="button">+ Add political entity</button>
                  </details>

                  <details style={sectionStyle}>
                    <summary style={{ cursor: "pointer", fontSize: "0.78rem", fontWeight: 850 }}>Power blocs / non-party actors ({draft.powerBlocs?.length || 0})</summary>
                    <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.6rem" }}>
                      {(draft.powerBlocs || []).map((bloc, index) => (
                        <details key={bloc.id || index} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.075)", borderRadius: "10px", padding: "0.55rem" }}>
                          <summary style={{ cursor: "pointer", fontSize: "0.72rem", fontWeight: 800 }}>{bloc.name || `Power bloc ${index + 1}`}</summary>
                          <div style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", marginTop: "0.6rem" }}>
                            {[["Name", "name"], ["Short name", "shortName"], ["Kind", "kind"], ["Status", "status"], ["Leader", "leader"], ["Ideology", "ideology"], ["Influence label", "influenceLabel"]].map(([label, field]) => <div key={field}><label style={labelStyle}>{label}</label><input style={inputStyle} value={bloc[field] ?? ""} onChange={(event) => editBloc(index, field, event.target.value)} /></div>)}
                            <div><label style={labelStyle}>Influence (%)</label><input type="number" min="0" max="100" step="0.1" style={inputStyle} value={bloc.influencePercent ?? ""} onChange={(event) => editBloc(index, "influencePercent", event.target.value)} /></div>
                          </div>
                          <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))", marginTop: "0.55rem" }}>
                            <div><label style={labelStyle}>Public description</label><textarea rows={3} style={{ ...inputStyle, resize: "vertical" }} value={bloc.publicDescription ?? ""} onChange={(event) => editBloc(index, "publicDescription", event.target.value)} /></div>
                            <div><label style={labelStyle}>Public priorities · one per line</label><textarea rows={3} style={{ ...inputStyle, resize: "vertical" }} value={bloc.publicPrioritiesText ?? ""} onChange={(event) => editBloc(index, "publicPrioritiesText", event.target.value)} /></div>
                            <div><label style={labelStyle}>Foreign-policy outlook · one per line</label><textarea rows={3} style={{ ...inputStyle, resize: "vertical" }} value={bloc.publicForeignPolicyText ?? ""} onChange={(event) => editBloc(index, "publicForeignPolicyText", event.target.value)} /></div>
                          </div>
                          <details style={{ marginTop: "0.55rem" }}>
                            <summary style={{ color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: "0.65rem", fontWeight: 750 }}>Advanced identity</summary>
                            <div style={{ marginTop: "0.45rem" }}><label style={labelStyle}>Stable bloc ID</label><input style={inputStyle} value={bloc.id ?? ""} onChange={(event) => editBloc(index, "id", event.target.value)} /></div>
                          </details>
                          <button onClick={() => removeBloc(index)} style={{ ...buttonStyle, color: "#fca5a5", marginTop: "0.55rem" }} type="button">Remove power bloc</button>
                        </details>
                      ))}
                    </div>
                    <button onClick={addBloc} style={{ ...buttonStyle, marginTop: "0.6rem" }} type="button">+ Add power bloc</button>
                  </details>

                  <details data-political-trait-catalog="true" style={sectionStyle}>
                    <summary style={{ cursor: "pointer", fontSize: "0.78rem", fontWeight: 850 }}>Canonical traits · full supported catalog ({POLITICAL_TRAIT_REGISTRY.length})</summary>
                    <div style={{ color: "rgba(255,255,255,0.44)", fontSize: "0.64rem", lineHeight: 1.45, marginTop: "0.35rem" }}>Every supported native trait is shown. Blank means <strong>unset</strong>, not 0. Values are canonical 0-100 inputs.</div>
                    <div style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(13.5rem, 1fr))", marginTop: "0.65rem" }}>
                      {POLITICAL_TRAIT_REGISTRY.map((trait) => {
                        const rawValue = draft.traitValues?.[trait.key] ?? "";
                        const isSet = rawValue !== "" && rawValue !== null && rawValue !== undefined;
                        return (
                          <div key={trait.key} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "0.55rem" }}>
                            <div style={{ alignItems: "center", display: "flex", gap: "0.4rem", justifyContent: "space-between" }}>
                              <label style={{ ...labelStyle, margin: 0 }}>{trait.label}</label>
                              <span style={{ color: isSet ? "#86efac" : "rgba(255,255,255,0.34)", fontSize: "0.54rem", fontWeight: 900, textTransform: "uppercase" }}>{isSet ? "set" : "unset"}</span>
                            </div>
                            <div style={{ alignItems: "center", display: "grid", gap: "0.45rem", gridTemplateColumns: "minmax(0, 1fr) 4.6rem", marginTop: "0.35rem" }}>
                              <input aria-label={`${trait.label} slider`} max={trait.max} min={trait.min} step="0.1" style={{ accentColor: "rgba(231,231,234,0.72)", width: "100%" }} type="range" value={isSet ? rawValue : trait.min} onChange={(event) => editTrait(trait.key, event.target.value)} />
                              <input aria-label={`${trait.label} value`} max={trait.max} min={trait.min} placeholder="unset" step="0.1" style={inputStyle} type="number" value={rawValue} onChange={(event) => editTrait(trait.key, event.target.value)} />
                            </div>
                            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.57rem", lineHeight: 1.35, marginTop: "0.32rem" }}>{trait.description}</div>
                            <code style={{ color: "var(--oh-grey-muted)", display: "block", fontSize: "0.54rem", marginTop: "0.28rem" }}>{trait.key}</code>
                          </div>
                        );
                      })}
                    </div>
                  </details>

                  <details data-political-structured-json="true" style={sectionStyle}>
                    <summary style={{ cursor: "pointer", fontSize: "0.78rem", fontWeight: 850 }}>Advanced structured traits & perceptions</summary>
                    <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.64rem", lineHeight: 1.45, marginTop: "0.35rem" }}>Raw JSON remains available for legacy/extension traits and structured perceptions. Canonical registered traits stay synchronized with the controls above while this JSON is valid.</div>
                    <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: "repeat(auto-fit, minmax(20rem, 1fr))", marginTop: "0.65rem" }}>
                      <div><label style={labelStyle}>Traits JSON</label><textarea rows={12} spellCheck={false} style={{ ...inputStyle, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "0.66rem", lineHeight: 1.42, resize: "vertical" }} value={draft.traitsJson ?? "{}"} onChange={(event) => editTraitsJson(event.target.value)} /></div>
                      <div><label style={labelStyle}>Perceptions JSON</label><textarea rows={12} spellCheck={false} style={{ ...inputStyle, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "0.66rem", lineHeight: 1.42, resize: "vertical" }} value={draft.perceptionsJson ?? "{}"} onChange={(event) => edit("perceptionsJson", event.target.value)} /></div>
                    </div>
                  </details>

                  <details data-political-debug="true" style={sectionStyle}>
                    <summary style={{ cursor: "pointer", fontSize: "0.78rem", fontWeight: 850 }}>Canonical debug · read-only</summary>
                    <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.64rem", lineHeight: 1.45, marginTop: "0.35rem" }}>This proves what is currently saved in scenario canon. Derived state is intentionally not directly editable.</div>
                    <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))", marginTop: "0.65rem" }}>
                      <div><label style={labelStyle}>Decision authority · derived</label><pre style={{ ...inputStyle, maxHeight: "13rem", overflow: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(debugSnapshot?.decisionAuthority ?? null, null, 2)}</pre></div>
                      <div><label style={labelStyle}>Behavioral disposition · derived now</label><pre style={{ ...inputStyle, maxHeight: "13rem", overflow: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(debugSnapshot?.derivedDisposition ?? null, null, 2)}</pre></div>
                    </div>
                    <div style={{ marginTop: "0.55rem" }}><label style={labelStyle}>Full saved Political Actor JSON</label><pre style={{ ...inputStyle, maxHeight: "22rem", overflow: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(debugSnapshot?.actor ?? null, null, 2)}</pre></div>
                  </details>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div style={panelStyle}>
      <div style={{ alignItems: "flex-start", display: "flex", flexWrap: "wrap", gap: "0.7rem", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "rgba(255,255,255,0.94)", fontSize: "0.95rem", fontWeight: 800 }}>Manual Political World authoring</div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.7rem", lineHeight: 1.5, marginTop: "0.2rem" }}>Edit scenario-start Political Actors directly: government, leaders, parties, blocs, strategic outlook, perceptions and the full canonical trait catalog.</div>
          <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.64rem", marginTop: "0.35rem" }}>{actorCount} actor{actorCount === 1 ? "" : "s"} configured across {rows.length} scenario polities.</div>
        </div>
        <button onClick={() => setManagerOpen(true)} style={{ ...buttonStyle, background: "var(--oh-grey-raised)", borderColor: "var(--oh-grey-border-strong)", flex: "0 0 auto" }} type="button">Manage Political World</button>
      </div>
      {manager}
    </div>
  );
}
