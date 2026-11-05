/*!
 * Open Historia Map Editor — a country's own military figures
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Wars and Fronts Pt.2: per-country settings "in the Workshop country panel,
// next to population, defaulting to today's behaviour". The Military block of
// the Countries panel (PolitiesPanel.jsx), and of the Groups panel for a
// group: its troops' quality and technology, what it can do on land, at sea
// and in the air ("zero meaning they can't use that at all"), how weary of war
// it is when it first goes to one, the share of its people who can fight, its
// unit mix, the men one of its counters stands for, and its own mustering
// curve (MusterChart.jsx). What each does in a war: runtime/fronts/military.js.
//
// Every field may be left empty, and an empty field is what every country has:
// the placeholder says what that is in this scenario (militaryForm.js
// militaryDefaultsFor). A figure is kept as it is typed, a keystroke at a time:
// a click on the map takes no focus from a field (OlMap cancels it), so its
// leaving cannot be waited for.

import { useEffect, useRef, useState } from "react";
import { inputStyle, pillButton } from "./editorStyles.js";
import MusterChart from "./MusterChart.jsx";
import { militaryFieldText, unitMixEra, withMilitaryField, withMilitaryMuster } from "./militaryForm.js";
import { normalizeMilitaryStats } from "../runtime/militaryStats.js";
import { DEFAULT_MUSTER } from "../runtime/mustering.js";
import { formatPopulationFigure } from "../runtime/populationFigure.js";

const fieldStyle = { ...inputStyle, flex: "0 0 64px", padding: "4px 6px", textAlign: "right", width: 64 };
const hintStyle = { color: "rgba(255,255,255,0.45)", fontSize: 10.5, lineHeight: 1.45 };
const groupLabelStyle = { color: "rgba(255,255,255,0.48)", fontSize: 10.5, marginTop: 2 };
const percent = (share) => String(Math.round(Number(share) * 1000) / 10);

// One figure: its name, and a field that keeps what is typed in it. The stored
// figure is shown again whenever it changes while the field is not being typed in.
const FigureField = ({ label, title, text, placeholder, onText }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.value = text;
  }, [text]);
  return (
    <label title={title} style={{ alignItems: "center", display: "flex", gap: 6, minWidth: 0 }}>
      <span style={{ color: "rgba(255,255,255,0.72)", flex: 1, fontSize: 11.5, minWidth: 0 }}>{label}</span>
      <input
        ref={ref}
        defaultValue={text}
        inputMode="decimal"
        placeholder={placeholder}
        onChange={(event) => onText(event.target.value, null)}
        onBlur={(event) => onText(event.target.value, event.target)}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        style={fieldStyle}
      />
    </label>
  );
};

//   recordKey  whose figures these are: another country's start from fresh fields
//   value      the record's `military`, or nothing
//   defaults   what an empty field stands for in this scenario (militaryForm.js
//              militaryDefaultsFor), or null for a map opened on its own
//   onChange   (military | null): the figures the record keeps; null for none
//   onRate     () => Promise<military>: the AI's figures for it (Game/AI/militaryRating.js),
//              which fill only the fields left empty; none, no button
const MilitaryFields = ({ recordKey = "", value, defaults = null, onChange, onRate = null }) => {
  const kept = normalizeMilitaryStats(value);
  const [rating, setRating] = useState(false);
  const [rateError, setRateError] = useState("");
  // The AI's figures, under what the designer has set already: those stand.
  const fillIn = async () => {
    setRating(true);
    setRateError("");
    try {
      const figures = await onRate();
      const next = normalizeMilitaryStats({ ...(figures ?? {}), ...(kept ?? {}) });
      if (next && JSON.stringify(next) !== JSON.stringify(kept)) onChange?.(next);
    } catch (error) {
      setRateError(String(error?.message ?? error) || "The AI could not be asked.");
    } finally {
      setRating(false);
    }
  };
  const mix = unitMixEra(defaults);
  const [horse, siege] = mix === "modern" ? ["Armour (%)", "Artillery (%)"] : mix === "old" ? ["Cavalry (%)", "Siege (%)"] : ["Cavalry / armour (%)", "Siege / artillery (%)"];

  // What was typed in a field: kept at once when it is a figure; a field left
  // (`input`) is shown what it now holds, or what it held when the text was none.
  const typed = (field) => (text, input) => {
    const { military, ok } = withMilitaryField(kept, field, text);
    if (input) input.value = militaryFieldText(ok ? military : kept, field);
    if (!ok) return;
    if (JSON.stringify(military) !== JSON.stringify(kept)) onChange?.(military);
  };
  const figure = (field, label, title, placeholder) => (
    <FigureField
      key={field}
      label={label}
      title={title}
      text={militaryFieldText(kept, field)}
      placeholder={placeholder}
      onText={typed(field)}
    />
  );

  return (
    <details style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "6px 9px" }}>
      <summary style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}>
        <span>Military</span>
        {kept && <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 500 }}> · its own figures</span>}
      </summary>
      <div key={recordKey} style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 7 }}>

        <div style={groupLabelStyle}>Its soldiers</div>
        <div style={{ display: "grid", gap: "5px 12px", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
          {figure("quality", "Troop quality", "How well its soldiers fight, 0 to 100: a levy low, elites high. Empty is 50.", "50")}
          {figure("technology", "Technology", "What its soldiers fight with, 0 to 100. Empty is 50.", "50")}
          {figure("spending", "Spending", "What its forces have to spend, against the other countries', 0 to 100. Empty is 50.", "50")}
          {figure("weariness", "War weariness", "How weary of war it is when it first goes to one, 0 to 100. Empty is 0.", "0")}
        </div>

        <div style={groupLabelStyle}>What it can fight with</div>
        <div style={{ display: "grid", gap: "5px 12px", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
          {figure("land", "Land", "What it can do on land, 0 to 100; 0 is no army at all. Empty is 50.", "50")}
          {figure("sea", "Naval", "What it can do at sea, 0 to 100; 0 is no navy at all. Empty is 50.", "50")}
          {figure("air", "Air", "What it can do in the air, 0 to 100; 0 is no air force at all. Empty is 50.", "50")}
        </div>

        <div style={groupLabelStyle}>Its army</div>
        <div style={{ display: "grid", gap: "5px 12px", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
          {figure(
            "manpowerShare",
            "Manpower (%)",
            "The share of its people who can fight, in percent. Every country had 12; the Night's Watch might have 60.",
            defaults ? String(defaults.manpowerShare) : "12",
          )}
          {figure(
            "menPerCounter",
            "Men per counter",
            "The men one of its counters stands for. Empty: the scenario's, else the era's.",
            defaults ? formatPopulationFigure(defaults.menPerCounter) : "By era",
          )}
          {figure("cavalryShare", horse, "The share of its counters that are horse (armour from 1850), in percent. Empty: the era's.", defaults ? percent(defaults.cavalryShare) : "By era")}
          {figure("siegeShare", siege, "The share of its counters that are siege engines (artillery from 1850), in percent. Empty: the era's.", defaults ? percent(defaults.siegeShare) : "By era")}
        </div>

        <div style={groupLabelStyle}>Mustering</div>
        <MusterChart
          points={kept?.muster ?? null}
          fallback={defaults?.muster ?? DEFAULT_MUSTER}
          ownLabel="Its own curve"
          fallbackLabel={defaults?.scenarioMuster ? "The scenario's curve" : "The game's default"}
          onChange={(points) => {
            const next = withMilitaryMuster(kept, points);
            if (JSON.stringify(next) !== JSON.stringify(kept)) onChange?.(next);
          }}
          fieldStyle={{ ...inputStyle, padding: "4px 6px", textAlign: "right" }}
        />

        {typeof onRate === "function" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              disabled={rating}
              style={{ ...pillButton(false), alignSelf: "flex-start" }}
              title="Ask the AI for the figures left empty, from what the scenario says of this country and its era"
              onClick={fillIn}
            >
              {rating ? "Asking the AI…" : "Fill in with AI"}
            </button>
            {rateError && <span style={hintStyle}>{rateError}</span>}
          </div>
        )}
        {kept && (
          <button
            type="button"
            style={{ ...pillButton(false), alignSelf: "flex-start" }}
            title="Take every one of its military figures away: it fights as every country does"
            onClick={() => onChange?.(null)}
          >
            Clear its military figures
          </button>
        )}
      </div>
    </details>
  );
};

export default MilitaryFields;
