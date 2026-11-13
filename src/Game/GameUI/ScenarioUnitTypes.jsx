/*! Open Historia — the Scenario Editor's unit types © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "add custom units types that have their own custom stats for scenarios so like a dragon troop that is an air troop
// and super strong and very tough" (the owner, 2026-11-13).
//
// The scenario's own unit types (runtime/unitTypes.js, world.unitTypes), in the Features tab under Wars, after how its
// wars are fought: each a name, the kind of unit it is, how hard it hits, how little it loses and how fast it moves
// against an ordinary unit of that kind, a mark of its own, a line on what it is, and the countries that may field it.
// Part of the editor's form, as the war settings are: the drawer's Save writes them (libraryBar.jsx handleSave), and
// the Workshop is handed them as they stand, saved or not, so a unit placed there can be of one (Editor/UnitPopup.jsx).

import React, { useEffect, useRef, useState } from "react";

import { useTouchPrimary } from "../../runtime/mobileUi.js";
import { FIGURE_MOST, ICON_MOST, NAME_MOST, NOTE_MOST, SPEED_MOST, UNIT_TYPES, UNIT_TYPES_MOST } from "../../runtime/unitTypes.js";
import { typedUnitTypeFigure, withNewUnitType, withUnitType, withUnitTypeOwner, withoutUnitType, withoutUnitTypeOwner } from "./scenarioUnitTypes.js";

const BASE_LABELS = Object.freeze({
  infantry: "Infantry",
  armor: "Armor",
  air: "Air",
  naval: "Naval",
  artillery: "Artillery",
  garrison: "Garrison",
});
const BASE_GLYPHS = Object.freeze({ infantry: "🛡", armor: "⚙", air: "✈", naval: "⚓", artillery: "💥", garrison: "🏰" });
const FIGURE_HINTS = Object.freeze({
  attack: "How hard it hits against an ordinary unit of its kind: 2 is twice as hard.",
  toughness: "How little it loses against an ordinary unit of its kind: 2 loses half as much.",
  speed: "How fast it moves on the map against an ordinary unit of its kind: 2 is twice as fast.",
});

const inputStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "10px",
  boxSizing: "border-box",
  color: "#f8fafc",
  fontFamily: "inherit",
  fontSize: "0.78rem",
  outline: "none",
  padding: "0.6rem 0.66rem",
  width: "100%",
};
const labelStyle = {
  color: "rgba(255,255,255,0.58)",
  display: "block",
  fontSize: "0.63rem",
  fontWeight: 700,
  letterSpacing: "0.05em",
  marginBottom: "0.3rem",
  textTransform: "uppercase",
};
const hintStyle = { color: "rgba(255,255,255,0.5)", fontSize: "0.7rem", lineHeight: 1.5 };
const pillStyle = (on) => ({
  alignItems: "center",
  background: on ? "rgba(43,193,243,0.16)" : "rgba(255,255,255,0.04)",
  border: `1px solid ${on ? "rgba(43,193,243,0.4)" : "rgba(255,255,255,0.08)"}`,
  borderRadius: "999px",
  color: on ? "#e0f6fe" : "rgba(255,255,255,0.7)",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "0.7rem",
  fontWeight: 700,
  gap: "0.35rem",
  minHeight: "1.8rem",
  padding: "0 0.65rem",
});
// On a touch screen .oh-tap (styles.css) makes a control a finger's 44 px, which an inline minHeight would beat.
const touchFit = (style, touch) => (touch ? { ...style, minHeight: undefined } : style);

// A figure's field: kept a keystroke at a time while it reads as a figure, and shown what was kept when it is left.
const FigureField = ({ value, most, label, hint, onValue }) => {
  const ref = useRef(null);
  const shown = String(value ?? 1);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.value = shown;
  }, [shown]);
  const typed = (input, leaving) => {
    const { value: next, ok } = typedUnitTypeFigure(input.value, most);
    if (ok && next !== value) onValue(next);
    if (leaving) input.value = String(ok ? next : value ?? 1);
  };
  return (
    <div title={hint}>
      <label style={labelStyle}>{label}</label>
      <input
        ref={ref}
        aria-label={label}
        defaultValue={shown}
        inputMode="decimal"
        onBlur={(event) => typed(event.target, true)}
        onChange={(event) => typed(event.target, false)}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        style={inputStyle}
      />
    </div>
  );
};

// The countries that may field a type: each a chip with its Remove, and a field to add another; none is any.
const Owners = ({ type, countries, listId, onAdd, onRemove, touch }) => {
  const [draft, setDraft] = useState("");
  const add = () => {
    if (!draft.trim()) return;
    onAdd(draft.trim());
    setDraft("");
  };
  return (
    <div>
      <label style={labelStyle}>Who may field it</label>
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.4rem" }}>
        {type.owners.length === 0 ? <span style={hintStyle}>Any country</span> : null}
        {type.owners.map((name) => (
          <span key={name} style={{ ...pillStyle(false), cursor: "default", paddingRight: "0.3rem" }}>
            <span data-no-translate="">{name}</span>
            <button
              aria-label={`Remove ${name}`}
              className="oh-tap"
              onClick={() => onRemove(name)}
              style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "0.8rem", padding: "0 0.25rem" }}
              type="button"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "grid", gap: "0.4rem", gridTemplateColumns: "minmax(0, 1fr) auto" }}>
        <input
          aria-label="Add a country"
          list={listId}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") add(); }}
          placeholder="Add a country"
          style={inputStyle}
          value={draft}
        />
        <button className="oh-tap" disabled={!draft.trim()} onClick={add} style={touchFit({ ...pillStyle(Boolean(draft.trim())), opacity: draft.trim() ? 1 : 0.5 }, touch)} type="button">Add</button>
      </div>
      <datalist id={listId}>
        {countries.map((name) => <option key={name} value={name} />)}
      </datalist>
    </div>
  );
};

//   value      the form's unit types, as the author is writing them (scenarioUnitTypes.js)
//   countries  the names of the scenario's countries, offered as owners
//   onChange   (next): the form's unit types
const ScenarioUnitTypes = ({ value, countries = [], onChange }) => {
  const touch = useTouchPrimary();
  const types = Array.isArray(value) ? value : [];
  const [draftName, setDraftName] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const full = types.length >= UNIT_TYPES_MOST;
  const add = () => {
    const next = withNewUnitType(types, draftName);
    if (next.length === types.length) return;
    const made = next[next.length - 1];
    onChange(next);
    setOpen((was) => new Set([...was, made.id]));
    setDraftName("");
  };
  const toggle = (id) => setOpen((was) => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const change = (id, patch) => onChange(withUnitType(types, id, patch));

  return (
    <div data-oh-scenario-unit-types="" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.95rem", padding: "0.9rem" }}>
      <div style={{ color: "rgba(255,255,255,0.94)", fontSize: "0.95rem", fontWeight: 800 }}>Unit types</div>

      <div style={{ display: "grid", gap: "0.4rem", gridTemplateColumns: "minmax(0, 1fr) auto", marginTop: "0.8rem" }}>
        <input
          aria-label="New unit type name (e.g. Dragon)"
          maxLength={NAME_MOST}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") add(); }}
          placeholder="New unit type name (e.g. Dragon)"
          style={inputStyle}
          value={draftName}
        />
        <button className="oh-tap" disabled={!draftName.trim() || full} onClick={add} style={touchFit({ ...pillStyle(Boolean(draftName.trim()) && !full), opacity: !draftName.trim() || full ? 0.5 : 1 }, touch)} type="button">Add</button>
      </div>

      {types.length === 0 ? <div style={{ ...hintStyle, marginTop: "0.6rem" }}>No unit types yet.</div> : null}

      <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.7rem" }}>
        {types.map((type) => {
          const expanded = open.has(type.id);
          const base = UNIT_TYPES.includes(type.base) ? type.base : "infantry";
          return (
            <div key={type.id} style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px", overflow: "hidden" }}>
              <button
                aria-expanded={expanded}
                className="oh-tap-row"
                onClick={() => toggle(type.id)}
                style={{ alignItems: "center", background: "rgba(255,255,255,0.04)", border: "none", color: "#f8fafc", cursor: "pointer", display: "flex", gap: "0.55rem", padding: "0.55rem 0.7rem", textAlign: "left", width: "100%" }}
                type="button"
              >
                <span aria-hidden="true" style={{ fontSize: "1rem", lineHeight: 1, minWidth: "1.2rem", textAlign: "center" }}>{type.icon || BASE_GLYPHS[base]}</span>
                <span data-no-translate="" style={{ flex: 1, fontSize: "0.82rem", fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{type.name}</span>
                <span style={{ ...hintStyle, whiteSpace: "nowrap" }}>{BASE_LABELS[base]}</span>
                <span aria-hidden="true" data-no-translate="" style={{ ...hintStyle, whiteSpace: "nowrap" }}>{`×${type.attack ?? 1} · ×${type.toughness ?? 1} · ×${type.speed ?? 1}`}</span>
                <span aria-hidden="true" style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.7rem" }}>{expanded ? "▴" : "▾"}</span>
              </button>
              {expanded ? (
                <div style={{ display: "grid", gap: "0.8rem", padding: "0.8rem 0.75rem" }}>
                  <div style={{ display: "grid", gap: "0.8rem", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))" }}>
                    <div>
                      <label style={labelStyle}>Name</label>
                      <input aria-label="Name" maxLength={NAME_MOST} onChange={(event) => change(type.id, { name: event.target.value })} style={inputStyle} value={type.name ?? ""} />
                    </div>
                    <div>
                      <label style={labelStyle}>Kind</label>
                      <select aria-label="Kind" onChange={(event) => change(type.id, { base: event.target.value })} style={{ ...inputStyle, appearance: "auto" }} value={base}>
                        {UNIT_TYPES.map((kind) => <option key={kind} value={kind}>{BASE_LABELS[kind]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Icon</label>
                      <input aria-label="Icon" maxLength={ICON_MOST * 8} onChange={(event) => change(type.id, { icon: event.target.value })} placeholder={BASE_GLYPHS[base]} style={inputStyle} value={type.icon ?? ""} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: "0.8rem", gridTemplateColumns: "repeat(auto-fit, minmax(7rem, 1fr))" }}>
                    <FigureField hint={FIGURE_HINTS.attack} label="Attack" most={FIGURE_MOST} onValue={(next) => change(type.id, { attack: next })} value={type.attack} />
                    <FigureField hint={FIGURE_HINTS.toughness} label="Toughness" most={FIGURE_MOST} onValue={(next) => change(type.id, { toughness: next })} value={type.toughness} />
                    <FigureField hint={FIGURE_HINTS.speed} label="Speed" most={SPEED_MOST} onValue={(next) => change(type.id, { speed: next })} value={type.speed} />
                  </div>
                  <div>
                    <label style={labelStyle}>Note</label>
                    <input aria-label="Note" maxLength={NOTE_MOST} onChange={(event) => change(type.id, { note: event.target.value })} style={inputStyle} value={type.note ?? ""} />
                  </div>
                  <Owners
                    countries={countries}
                    listId={`oh-unit-type-owners-${type.id}`}
                    onAdd={(owner) => onChange(withUnitTypeOwner(types, type.id, owner))}
                    onRemove={(owner) => onChange(withoutUnitTypeOwner(types, type.id, owner))}
                    touch={touch}
                    type={{ ...type, owners: Array.isArray(type.owners) ? type.owners : [] }}
                  />
                  <div>
                    <button className="oh-tap" onClick={() => onChange(withoutUnitType(types, type.id))} style={touchFit({ ...pillStyle(false), color: "#f87171" }, touch)} type="button">Delete type</button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ScenarioUnitTypes;
