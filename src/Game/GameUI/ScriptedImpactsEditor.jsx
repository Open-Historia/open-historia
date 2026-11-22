/*! Open Historia — a scripted event's impacts, written as rows instead of prose © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React from "react";
import {
  SCRIPTED_IMPACT_TYPES,
  scriptedImpactProblems,
  scriptedImpactType,
} from "../../../server/scriptedImpacts.js";
import { regionNameList, scriptedEventPickerLabel, scriptedEventPickerValue } from "./scriptedEventAuthoring.js";

const array = (value) => (Array.isArray(value) ? value : []);
const optionStyle = { backgroundColor: "#1a1b1f", color: "#f8fafc" };

const TYPE_LABELS = {
  transfer: "Regions change hands",
  independence: "A new country gains regions",
  control: "Regions are occupied",
  contest: "Regions become contested",
  clear_contest: "Fighting over regions ends",
  claim: "A country claims regions",
  drop_claim: "A country drops its claim",
  clear_country_claims: "Remove all claims on a country's territory",
  annex: "A country is annexed",
  dissolve: "A country is dissolved",
  create: "A new country is founded",
  rename: "A country is renamed",
  leader: "New leader or government",
};

const fieldLabel = (type, field) => {
  if (field === "regions") return "Regions";
  if (field === "from") return "From (optional)";
  if (field === "color") return "Colour";
  if (field === "actor") return "Attacker";
  if (field === "leader") return "New leader";
  if (field === "government") return "New government";
  if (field === "to") {
    if (type === "control") return "Occupier";
    if (type === "annex") return "Annexed by";
    if (type === "dissolve") return "Its land goes to";
    return "New owner";
  }
  if (field === "claimant") {
    if (type === "clear_contest") return "Only this side (optional)";
    if (type === "clear_country_claims") return "Only this claimant (optional)";
    return "Claimant";
  }
  if (field === "polity") return "Country";
  if (field === "name") return type === "rename" ? "New name" : "New country's name";
  return field;
};

const PolityInput = ({ ariaLabel, listId, options, styles, value, onChange }) => (
  <input
    aria-label={ariaLabel}
    list={listId}
    placeholder="Search country"
    style={{ ...styles.inputStyle, boxSizing: "border-box", minWidth: 0, width: "100%" }}
    value={scriptedEventPickerLabel(value, options)}
    onChange={(event) => onChange(scriptedEventPickerValue(event.target.value, options))}
  />
);

const ScriptedImpactsEditor = ({ idPrefix, rows: rowsInput, polityOptions = [], styles, onChange, onPickRegions }) => {
  const rows = array(rowsInput);
  const problems = scriptedImpactProblems(rows);
  const listId = `${idPrefix}-impact-polities`;
  const patchRow = (index, patch) => onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const setType = (index, type) => {
    const definition = scriptedImpactType(type);
    if (!definition) return;
    const current = rows[index] || {};
    const next = { type };
    for (const field of definition.fields) {
      if (field === "regions") next.regions = array(current.regions);
      else if (current[field] !== undefined) next[field] = current[field];
    }
    onChange(rows.map((row, at) => (at === index ? next : row)));
  };
  const buttonStyle = { ...styles.actionButtonStyle, minHeight: "2rem", padding: "0 0.65rem" };

  return (
    <div style={{ display: "grid", gap: "0.42rem", marginTop: "0.45rem", minWidth: 0 }}>
      <datalist id={listId}>
        {polityOptions.map((option) => <option key={option.id} label={option.id} value={option.label} />)}
      </datalist>
      {rows.map((row, index) => {
        const definition = scriptedImpactType(row?.type) || SCRIPTED_IMPACT_TYPES[0];
        const { missing, repeated } = problems[index] || { missing: [], repeated: [] };
        const needed = missing.map((field) => fieldLabel(definition.type, field)).join(", ");
        return (
          <div key={`${idPrefix}-impact-${index}`} data-scripted-impact-row="true" style={{ background: "rgba(0,0,0,0.14)", border: "1px solid rgba(255,255,255,0.055)", borderRadius: "9px", minWidth: 0, padding: "0.48rem" }}>
            <div style={{ alignItems: "flex-end", display: "flex", flexWrap: "wrap", gap: "0.38rem", minWidth: 0 }}>
              <select aria-label="Impact type" style={{ ...styles.inputStyle, boxSizing: "border-box", colorScheme: "dark", cursor: "pointer", flex: "1.2 1 13rem", minWidth: 0 }} value={definition.type} onChange={(event) => setType(index, event.target.value)}>
                {SCRIPTED_IMPACT_TYPES.map((entry) => <option key={entry.type} style={optionStyle} value={entry.type}>{TYPE_LABELS[entry.type]}</option>)}
              </select>
              {definition.fields.map((field) => {
                const label = fieldLabel(definition.type, field);
                if (field === "regions") {
                  const regions = array(row.regions);
                  return (
                    <div key={field} style={{ flex: "2 1 16rem", minWidth: 0 }}>
                      <label style={styles.fieldLabelStyle}>{label}</label>
                      <div style={{ alignItems: "center", display: "flex", gap: "0.38rem", minWidth: 0 }}>
                        <button type="button" className="oh-tap-row" style={{ ...buttonStyle, flex: "0 0 auto" }} onClick={() => onPickRegions(index)}>
                          {regions.length ? `Pick on map (${regions.length})` : "Pick on map"}
                        </button>
                        <span data-no-translate title={regionNameList(regions)} style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.7rem", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {regionNameList(regions)}
                        </span>
                      </div>
                    </div>
                  );
                }
                if (field === "color") {
                  return (
                    <div key={field} style={{ flex: "0 0 4.5rem" }}>
                      <label style={styles.fieldLabelStyle}>{label}</label>
                      <input aria-label={label} type="color" style={{ ...styles.inputStyle, boxSizing: "border-box", cursor: "pointer", padding: "0.1rem", width: "100%" }} value={row.color || "#808080"} onChange={(event) => patchRow(index, { color: event.target.value })} />
                    </div>
                  );
                }
                const polityField = ["to", "from", "actor", "claimant", "polity"].includes(field);
                return (
                  <div key={field} style={{ flex: "1 1 10rem", minWidth: 0 }}>
                    <label style={styles.fieldLabelStyle}>{label}</label>
                    {polityField ? (
                      <PolityInput ariaLabel={label} listId={listId} options={polityOptions} styles={styles} value={row[field] || ""} onChange={(value) => patchRow(index, { [field]: value })} />
                    ) : (
                      <input aria-label={label} style={{ ...styles.inputStyle, boxSizing: "border-box", minWidth: 0, width: "100%" }} value={row[field] || ""} onChange={(event) => patchRow(index, { [field]: event.target.value })} />
                    )}
                  </div>
                );
              })}
              <button type="button" className="oh-tap-row" style={{ ...buttonStyle, color: "#fecaca", flex: "0 0 auto" }} onClick={() => onChange(rows.filter((_, at) => at !== index))}>
                Remove
              </button>
            </div>
            {missing.length > 0 && (
              <div style={{ color: "#fbbf24", fontSize: "0.62rem", lineHeight: 1.35, marginTop: "0.25rem" }}>
                Still needed: {needed}. This impact is left out until it is complete.
              </div>
            )}
            {repeated.length > 0 && (
              <div style={{ color: "#fbbf24", fontSize: "0.62rem", lineHeight: 1.35, marginTop: "0.25rem" }}>
                Already chosen in another impact: <span data-no-translate>{repeated.join(", ")}</span>
              </div>
            )}
          </div>
        );
      })}
      <div>
        <button type="button" className="oh-tap-row" style={buttonStyle} onClick={() => onChange([...rows, { type: "transfer", regions: [], to: "", from: "" }])}>
          + Add impact
        </button>
      </div>
    </div>
  );
};

export default ScriptedImpactsEditor;
