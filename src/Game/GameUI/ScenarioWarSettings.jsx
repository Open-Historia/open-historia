/*! Open Historia — the Scenario Editor's war settings © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Wars and Fronts Pt.2: how a scenario's wars are fought (runtime/
// warSettings.js, world.warSettings), at the top of the Scenario Editor's
// Fronts tab: "an explicit era setting per scenario", the men a counter stands
// for, the share of people who can fight, "a scenario default mobilisation
// time" (a mustering curve through two points, drawn: Editor/MusterChart.jsx),
// which of the front engine's newer mechanics are on, and its warfare: whether
// a war's troops come along fronts or as swarms (runtime/fronts/swarms.js), "war
// fronts havent always existed" (the owner, 2026-10-16). Every one of them left
// alone is what the game did before, but for the warfare, read off the date.
//
// Part of the editor's form, as the Music tab is: the drawer's Save writes
// them with the rest (libraryBar.jsx handleSave). The form holds them compact
// (scenarioWarSettings.js). A country may say otherwise for itself: its
// Military figures in the map editor's Countries panel (Editor/MilitaryFields.jsx).

import React, { useEffect, useRef, useState } from "react";

import { useTouchPrimary } from "../../runtime/mobileUi.js";
import { MEN_PER_FORMATION_BY_ERA } from "../../runtime/fronts/constants.js";
import { DEFAULT_MUSTER } from "../../runtime/mustering.js";
import { formatPopulationFigure } from "../../runtime/populationFigure.js";
import { eraOf } from "../../runtime/unitMotion.js";
import { ERA_LABELS, FRONTS_FROM_YEAR, WAR_MECHANICS, normalizeWarSettings, warfareOf } from "../../runtime/warSettings.js";
import MusterChart from "../../Editor/MusterChart.jsx";
import { warNumberText, withWarMechanic, withWarNumber, withWarOutcome, withWarSettings, withoutWarOutcome } from "./scenarioWarSettings.js";

const MECHANIC_LABELS = Object.freeze({
  fatigue: "Troop fatigue",
  weather: "Seasons and weather",
  terrain: "Terrain",
  walls: "Fortified lines",
  muster: "Mustering",
  military: "Countries' military figures",
  air: "Air in battles",
  supply: "Supplies",
  attrition: "Attrition",
  marching: "Marching to the front",
});
const MECHANIC_HINTS = Object.freeze({
  fatigue: "Troops tire as they march and fight, and recover at rest; a day after they hold their ground, they fight a little harder.",
  weather: "The season and the day's weather slow, blunt and wear troops, on land and at sea.",
  terrain: "Ground the map makes harder to cross slows an advance.",
  walls: "Fortified lines on the map must be broken through.",
  muster: "A war's levies come in over weeks, along the mustering curve, not all on its first morning.",
  military: "Each country's own quality, technology, arms, unit mix and men a counter, from the map editor's Countries panel.",
  air: "Air wings take part in the fighting below them.",
  supply: "Building fortified lines uses up a country's war resources, which its funding refills; an army low on them fights worse.",
  attrition: "Harsh weather and a hard winter wear down every army out in them, the more so tired, short of supply or cut off; what it costs weighs heavily on a country's will to fight.",
  marching: "New troops are raised inside their country, the deeper the thinner its people are spread, and march to the front; armies move half again as fast through their own side's territory as through the enemy's.",
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
const switchStyle = (on) => ({
  alignItems: "center",
  background: on ? "rgba(0,0,0,0.42)" : "rgba(255,255,255,0.04)",
  border: `1px solid ${on ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.08)"}`,
  borderRadius: "999px",
  color: on ? "#f4f4f5" : "rgba(255,255,255,0.55)",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "0.7rem",
  fontWeight: 700,
  gap: "0.35rem",
  minHeight: "1.8rem",
  padding: "0 0.65rem",
});
// On a touch screen .oh-tap (styles.css) makes a control a finger's 44 px,
// which an inline minHeight would beat.
const touchFit = (style, touch) => (touch ? { ...style, minHeight: undefined } : style);

// The wars meant to end one way (runtime/warOutcomes.js): each as a line with its Remove, and two fields and an
// Add for another.
const WarOutcomes = ({ value, onChange, touch }) => {
  const outcomes = normalizeWarSettings(value)?.outcomes ?? [];
  const [winner, setWinner] = useState("");
  const [loser, setLoser] = useState("");
  const ready = winner.trim() !== "" && loser.trim() !== "" && winner.trim().toLowerCase() !== loser.trim().toLowerCase();
  const add = () => {
    if (!ready) return;
    onChange(withWarOutcome(value, winner.trim(), loser.trim()));
    setWinner("");
    setLoser("");
  };
  return (
    <>
      <label style={{ ...labelStyle, marginTop: "0.9rem" }}>Scripted outcomes</label>
      <div style={{ ...hintStyle, marginBottom: "0.45rem" }}>
        A war meant to end one way: in any war between the two, a side nobody plays that is meant to lose is led by a plainer commander. Nothing is decided: a player who fights well can still win a war meant to be lost, and lose one meant to be won.
      </div>
      {outcomes.map((rule, index) => (
        <div key={`${rule.winner}|${rule.loser}`} style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.3rem" }}>
          <span data-no-translate style={{ color: "#f8fafc", fontSize: "0.78rem", fontWeight: 700 }}>{rule.winner}</span>
          <span style={hintStyle}>is meant to beat</span>
          <span data-no-translate style={{ color: "#f8fafc", fontSize: "0.78rem", fontWeight: 700 }}>{rule.loser}</span>
          <button className="oh-tap" onClick={() => onChange(withoutWarOutcome(value, index))} style={touchFit(switchStyle(false), touch)} type="button">Remove</button>
        </div>
      ))}
      <div style={{ alignItems: "center", display: "grid", gap: "0.4rem", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr) auto" }}>
        <input aria-label="Country meant to win" onChange={(event) => setWinner(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") add(); }} placeholder="Meant to win" style={inputStyle} value={winner} />
        <span style={hintStyle}>is meant to beat</span>
        <input aria-label="Country meant to lose" onChange={(event) => setLoser(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") add(); }} placeholder="Meant to lose" style={inputStyle} value={loser} />
        <button className="oh-tap" disabled={!ready} onClick={add} style={touchFit(switchStyle(ready), touch)} type="button">Add</button>
      </div>
      <div style={{ ...hintStyle, marginTop: "0.3rem" }}>Countries by their exact names. Every other war is fought by the best commander there is.</div>
    </>
  );
};

// A figure field: kept a keystroke at a time while it reads as a figure, and
// shown what was kept when the author leaves it.
const NumberField = ({ text, placeholder, label, onText }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.value = text;
  }, [text]);
  return (
    <input
      ref={ref}
      aria-label={label}
      defaultValue={text}
      inputMode="decimal"
      placeholder={placeholder}
      onChange={(event) => onText(event.target.value, null)}
      onBlur={(event) => onText(event.target.value, event.target)}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
      style={inputStyle}
    />
  );
};

//   value      the form's warSettings (compact: scenarioWarSettings.js), null for none
//   gameDate   the form's game date, which an era left automatic is read off
//   onChange   (next): the form's warSettings
const ScenarioWarSettings = ({ value, gameDate = "", onChange }) => {
  const touch = useTouchPrimary();
  const settings = normalizeWarSettings(value) ?? { mechanics: {}, era: null, menPerCounter: null, manpowerShare: null, muster: null };
  const dateEra = eraOf(gameDate, null);
  const era = settings.era ?? dateEra;
  // How its wars' troops come when nobody deploys them otherwise, as the date (and era) would have it.
  const dateWarfare = warfareOf({ warSettings: { ...settings, warfare: null } }, gameDate);
  const typed = (key) => (text, input) => {
    const { settings: next, ok } = withWarNumber(value, key, text);
    if (input) input.value = warNumberText(ok ? next : value, key);
    if (ok && JSON.stringify(next) !== JSON.stringify(value ?? null)) onChange(next);
  };

  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.95rem", padding: "0.9rem" }}>
      <div style={{ color: "rgba(255,255,255,0.94)", fontSize: "0.95rem", fontWeight: 800 }}>How its wars are fought</div>
      <div style={{ ...hintStyle, marginTop: "0.2rem" }}>
        For every war in a game of this scenario. A country may say otherwise for itself: its Military figures in the map editor&apos;s Countries panel. The Save button below saves these with the scenario.
      </div>

      <div style={{ display: "grid", gap: "0.8rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", marginTop: "0.8rem" }}>
        <div>
          <label style={labelStyle}>Era</label>
          <select
            aria-label="Era"
            onChange={(event) => onChange(withWarSettings(value, { era: event.target.value === "" ? null : Number(event.target.value) }))}
            style={{ ...inputStyle, appearance: "auto" }}
            value={settings.era === null ? "" : String(settings.era)}
          >
            <option value="">Automatic (read off the date)</option>
            {ERA_LABELS.map((label, index) => <option key={label} value={String(index)}>{label}</option>)}
          </select>
          <div style={{ ...hintStyle, marginTop: "0.3rem" }}>
            Read off the game date: <span>{ERA_LABELS[dateEra]}</span>
          </div>
        </div>
        <div>
          <label style={labelStyle}>Warfare</label>
          <select
            aria-label="Warfare"
            onChange={(event) => onChange(withWarSettings(value, { warfare: event.target.value === "" ? null : event.target.value }))}
            style={{ ...inputStyle, appearance: "auto" }}
            value={settings.warfare ?? ""}
          >
            <option value="">Automatic (read off the date)</option>
            <option value="front">Fronts</option>
            <option value="swarm">Swarms</option>
          </select>
          <div style={{ ...hintStyle, marginTop: "0.3rem" }}>
            Read off the game date: <span>{dateWarfare === "swarm" ? <>Swarms</> : <>Fronts</>}</span>
          </div>
          <div style={{ ...hintStyle, marginTop: "0.3rem" }}>
            Before {FRONTS_FROM_YEAR} a war&apos;s troops come as swarms: groups, each under a general of its own, not a line where the two sides meet. Each troop still moves and fights as it would on a front, and players can deploy either way in the war room.
          </div>
        </div>
        <div>
          <label style={labelStyle}>Men per counter</label>
          <NumberField
            label="Men per counter"
            onText={typed("menPerCounter")}
            placeholder={formatPopulationFigure(MEN_PER_FORMATION_BY_ERA[era])}
            text={warNumberText(value, "menPerCounter")}
          />
          <div style={{ ...hintStyle, marginTop: "0.3rem" }}>{`Empty: the era's own, ${formatPopulationFigure(MEN_PER_FORMATION_BY_ERA[era])} men.`}</div>
        </div>
        <div>
          <label style={labelStyle}>Manpower (% of people)</label>
          <NumberField
            label="The share of a country's people who can fight, in percent"
            onText={typed("manpowerShare")}
            placeholder="12"
            text={warNumberText(value, "manpowerShare")}
          />
          <div style={{ ...hintStyle, marginTop: "0.3rem" }}>Empty: 12, as every country had.</div>
        </div>
      </div>

      <label style={{ ...labelStyle, marginTop: "0.9rem" }}>Mustering</label>
      <div style={{ ...hintStyle, marginBottom: "0.45rem" }}>
        How long calling up an army takes, for every country without a curve of its own: from nothing on the first day through the two points. Left alone, half the army is in after 21 days and all of it after 90.
      </div>
      <MusterChart
        points={settings.muster}
        fallback={DEFAULT_MUSTER}
        ownLabel="The scenario's curve"
        fallbackLabel="The game's default"
        onChange={(points) => onChange(withWarSettings(value, { muster: points }))}
        fieldStyle={{ ...inputStyle, padding: "0.4rem 0.5rem", textAlign: "right" }}
      />

      <WarOutcomes value={value} onChange={onChange} touch={touch} />

      <label style={{ ...labelStyle, marginTop: "0.9rem" }}>Mechanics</label>
      <div style={{ ...hintStyle, marginBottom: "0.45rem" }}>Each is on unless you turn it off here.</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
        {WAR_MECHANICS.map((key) => {
          const on = settings.mechanics[key] !== false;
          return (
            <button
              aria-pressed={on}
              className="oh-tap"
              key={key}
              onClick={() => onChange(withWarMechanic(value, key, !on))}
              style={touchFit(switchStyle(on), touch)}
              title={MECHANIC_HINTS[key]}
              type="button"
            >
              <span aria-hidden="true">{on ? "✓" : "○"}</span>
              {MECHANIC_LABELS[key]}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ScenarioWarSettings;
