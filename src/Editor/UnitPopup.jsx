/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Inline editor for a unit placed in the Workshop, anchored where the map was
// clicked — the units a scenario starts with (world.units, source "scenario").
// Mirrors CityPopup: Escape/Enter closes, Delete removes.
//
// Its kind may also be one of the scenario's own unit types (runtime/unitTypes.js,
// set in the Scenario Editor under Wars): those its owner may field, below the
// kinds. A unit of one is of that type's base kind.

import { useEffect, useRef, useState } from "react";
import { panelSurface, inputStyle, pillButton } from "./editorStyles.js";
import { UNIT_TYPES } from "../runtime/gameState.js";
import { mayFieldUnitType } from "../runtime/unitTypes.js";
import { uiString } from "../runtime/translator.js";

const TYPE_LABELS = {
  infantry: "Infantry",
  armor: "Armour",
  air: "Air",
  naval: "Naval",
  artillery: "Artillery",
  garrison: "Garrison",
};
const UNIT_TYPES_GROUP_LABEL = "Unit types";
// A select's value for one of the scenario's own unit types, apart from the kinds.
// i18n-ignore
const OWN_TYPE = "own:";

const clampStrength = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(100, Math.round(n)));
};

const UnitPopup = ({ unit, x, y, isNew, polities = [], unitTypes = [], onChange, onDelete, onClose }) => {
  const nameRef = useRef(null);
  // The strength as typed, for the unit it was typed for. Clamping each
  // keystroke made an emptied box read 1 at once, so 75 could not be typed
  // over 100; the unit takes a value only once it is a whole 1..100, and the
  // box shows the unit's own strength again when it is left.
  const [typedStrength, setTypedStrength] = useState(null);
  const strengthDraft = typedStrength && typedStrength.id === unit?.id ? typedStrength.text : null;

  useEffect(() => {
    if (!nameRef.current) return;
    nameRef.current.focus();
    if (isNew) nameRef.current.select();
  }, [isNew]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!unit) return null;
  const left = Math.max(8, Math.min(x - 20, (window.innerWidth || 1200) - 300));
  const top = Math.max(8, Math.min(y + 14, (window.innerHeight || 800) - 330));
  const ownerKnown = polities.some((p) => p.key === unit.ownerCode);
  // The scenario's own unit types this unit may be: those its owner may field, and the one it is.
  const ownType = unitTypes.find((type) => type.id === unit.unitType) ?? null;
  const ownTypes = unitTypes.filter((type) => type === ownType || mayFieldUnitType(type, unit.ownerCode));
  const kind = ownType ? `${OWN_TYPE}${ownType.id}` : unit.type || "infantry";
  const pickKind = (value) => {
    const picked = value.startsWith(OWN_TYPE) ? unitTypes.find((type) => `${OWN_TYPE}${type.id}` === value) : null;
    onChange(picked ? { type: picked.base, unitType: picked.id } : { type: value, unitType: "" });
  };

  return (
    <div
      style={{
        ...panelSurface,
        position: "fixed",
        left,
        top,
        zIndex: 45,
        width: 282,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontSize: 12,
      }}
    >
      <input
        ref={nameRef}
        value={unit.name || ""}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="Unit name, e.g. 3rd Army"
        style={{ ...inputStyle, padding: "6px 8px", fontSize: 13, fontWeight: 600 }}
      />

      <div style={{ display: "flex", gap: 6 }}>
        <select value={kind} onChange={(e) => pickKind(e.target.value)} style={{ ...inputStyle, padding: "5px 6px", flex: 1 }} aria-label="Unit type">
          {UNIT_TYPES.map((type) => (
            <option key={type} value={type}>{TYPE_LABELS[type] || type}</option>
          ))}
          {ownTypes.length > 0 && (
            <optgroup label={uiString(UNIT_TYPES_GROUP_LABEL)}>
              {ownTypes.map((type) => (
                <option key={type.id} value={`${OWN_TYPE}${type.id}`} data-no-translate="">{type.icon ? `${type.icon} ${type.name}` : type.name}</option>
              ))}
            </optgroup>
          )}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", color: "rgba(255,255,255,0.7)" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700 }}>Strength</span>
          <input
            type="number"
            min="1"
            max="100"
            value={strengthDraft ?? unit.strength ?? 100}
            onChange={(e) => {
              const text = e.target.value;
              setTypedStrength({ id: unit.id, text });
              const n = Number(text);
              if (text.trim() !== "" && Number.isFinite(n) && n >= 1 && n <= 100) onChange({ strength: clampStrength(n) });
            }}
            onBlur={() => setTypedStrength(null)}
            style={{ ...inputStyle, padding: "5px 6px", width: 62 }}
            aria-label="Unit strength percent"
          />
        </label>
      </div>

      <label style={{ display: "grid", gap: 4, color: "rgba(255,255,255,0.7)" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700 }}>Owner</span>
        <select value={ownerKnown ? unit.ownerCode : ""} onChange={(e) => onChange({ ownerCode: e.target.value })} style={{ ...inputStyle, padding: "5px 6px" }} aria-label="Unit owner">
          {!ownerKnown && <option value="">{unit.ownerCode ? `${unit.ownerCode} (not on this map)` : "Choose a country…"}</option>}
          {polities.map((p) => (
            <option key={p.key} value={p.key}>{p.name}</option>
          ))}
        </select>
      </label>

      <label style={{ display: "grid", gap: 4, color: "rgba(255,255,255,0.7)" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700 }}>Composition</span>
        <input
          value={unit.composition || ""}
          onChange={(e) => onChange({ composition: e.target.value })}
          placeholder="e.g. 3 tank regiments, 1 mechanised brigade"
          style={{ ...inputStyle, padding: "5px 7px" }}
        />
      </label>

      <label style={{ display: "grid", gap: 4, color: "rgba(255,255,255,0.7)" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700 }}>What it is doing</span>
        <input
          value={unit.note || ""}
          onChange={(e) => onChange({ note: e.target.value })}
          placeholder="One sentence, e.g. Holding the northern border"
          style={{ ...inputStyle, padding: "5px 7px" }}
        />
      </label>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button onClick={onDelete} style={{ ...pillButton(false), color: "#f87171" }}>Delete</button>
        <button onClick={onClose} style={{ ...pillButton(true) }}>Done</button>
      </div>
    </div>
  );
};

export default UnitPopup;
