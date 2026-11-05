/*! Open Historia — the Workshop's Fronts tab © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The fronts a scenario begins with (runtime/fronts/scenarioFronts.js): which
// countries face each other, whether they are at war there or have only
// fortified the border, how many formations each side has, what each is told
// from the first day, and what its generals are called. The line is not drawn
// here: it runs where the two sides' ground meets on the scenario's map, and
// the game builds the battlefield the first time it is opened, asking no model
// (AI/frontScenario.js). Saved on its own, like the pre-history
// (PrehistoryPanel.jsx), with its own Save.

import React, { useEffect, useMemo, useState } from "react";

import { saveScenario } from "../../runtime/library.js";
import { useTouchPrimary } from "../../runtime/mobileUi.js";
import { collectScenarioPoliticalPolities } from "../../runtime/scenarioPolities.js";
import { GENERAL_NAME_MAX, MAX_COMMANDS, MAX_SIDE_MEMBERS, MAX_TROOPS_PER_SIDE } from "../../runtime/fronts/constants.js";
import { MAX_SCENARIO_FRONTS, blankScenarioFront, normalizeScenarioFronts } from "../../runtime/fronts/scenarioFronts.js";

const buttonStyle = {
  alignItems: "center",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "999px",
  color: "rgba(246,246,248,0.92)",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "0.76rem",
  fontWeight: 700,
  gap: "0.35rem",
  justifyContent: "center",
  minHeight: "2rem",
  padding: "0 0.8rem",
};
const primaryButtonStyle = { ...buttonStyle, background: "rgba(43,193,243,0.16)", borderColor: "rgba(43,193,243,0.4)", color: "#e0f6fe" };
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
const sectionStyle = { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, marginTop: "0.8rem", padding: "0.75rem" };
const choiceStyle = (active) => ({
  ...buttonStyle,
  background: active ? "rgba(0,0,0,0.42)" : "rgba(255,255,255,0.04)",
  borderColor: active ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.08)",
  color: active ? "#f4f4f5" : "rgba(255,255,255,0.7)",
  fontSize: "0.7rem",
  minHeight: "1.8rem",
  padding: "0 0.6rem",
});
// On a touch screen .oh-tap (styles.css) makes a control a finger's 44 px,
// which an inline minHeight would beat.
const touchFit = (style, touch) => (touch ? { ...style, minHeight: undefined } : style);

const frontsOf = (details) => normalizeScenarioFronts(details?.data?.world?.scenarioFronts, { draft: true });
const same = (a, b) => JSON.stringify(normalizeScenarioFronts(a, { draft: true })) === JSON.stringify(normalizeScenarioFronts(b, { draft: true }));
const fold = (value) => String(value ?? "").trim().toLowerCase();

// What a side is told from the first day, as the Workshop words it.
const StanceWord = ({ stance }) => {
  if (stance === "dig in") return <>Dig in</>;
  if (stance === "advance") return <>Attack</>;
  return <>Hold</>;
};

// One side of a front: who is on it, how many, told what, led by whom.
const SideEditor = ({ front, side, countries, onChange, touch }) => {
  const members = front.sides[side];
  const taken = new Set([...front.sides[0], ...front.sides[1]].map(fold));
  const free = countries.filter((country) => !taken.has(fold(country.key)));
  const most = front.war ? MAX_SIDE_MEMBERS : 1;
  const setMembers = (next) => onChange({ ...front, sides: front.sides.map((list, index) => (index === side ? next : list)) });
  const setAt = (key, value) => onChange({ ...front, [key]: front[key].map((entry, index) => (index === side ? value : entry)) });
  const stances = front.war ? ["hold", "dig in", "advance"] : ["hold", "dig in"];
  // How the side's troops stand there (runtime/fronts/swarms.js): "" as the scenario's wars are fought, "front", or "swarm".
  const forms = Array.isArray(front.forms) ? front.forms : ["", ""];
  const setForm = (form) => onChange({ ...front, forms: forms.map((entry, index) => (index === side ? form : entry)) });
  return (
    <div style={{ flex: "1 1 15rem", minWidth: 0 }}>
      <label style={labelStyle}>{side === 0 ? <>One side</> : <>The other side</>}</label>
      <div data-no-translate style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginBottom: members.length ? "0.4rem" : 0 }}>
        {members.map((name) => (
          <span key={name} style={{ alignItems: "center", background: "rgba(255,255,255,0.08)", borderRadius: "999px", display: "inline-flex", fontSize: "0.74rem", fontWeight: 700, gap: "0.3rem", padding: "0.2rem 0.3rem 0.2rem 0.65rem" }}>
            {countries.find((country) => fold(country.key) === fold(name))?.label ?? name}
            <button
              aria-label="Remove"
              className="oh-tap"
              onClick={() => setMembers(members.filter((other) => other !== name))}
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "0.85rem", lineHeight: 1, padding: "0 0.25rem" }}
              type="button"
            >✕</button>
          </span>
        ))}
      </div>
      {members.length < most && (
        <select
          aria-label="Add a country"
          onChange={(event) => { if (event.target.value) setMembers([...members, event.target.value]); }}
          style={{ ...inputStyle, appearance: "auto" }}
          value=""
        >
          <option value="">{members.length === 0 ? "Choose a country…" : "Add an ally…"}</option>
          {free.map((country) => <option data-no-translate key={country.key} value={country.key}>{country.label}</option>)}
        </select>
      )}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.55rem" }}>
        <div style={{ flex: "0 0 6.5rem" }}>
          <label style={labelStyle}>Formations</label>
          <input
            inputMode="numeric"
            max={MAX_TROOPS_PER_SIDE}
            min={0}
            onChange={(event) => setAt("troops", Math.max(0, Math.min(MAX_TROOPS_PER_SIDE, Math.round(Number(event.target.value) || 0))))}
            placeholder="By size"
            style={inputStyle}
            type="number"
            value={front.troops[side] || ""}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <label style={labelStyle}>From the first day</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
            {stances.map((stance) => (
              <button className="oh-tap" key={stance} onClick={() => setAt("stance", stance)} style={touchFit(choiceStyle(front.stance[side] === stance), touch)} type="button">
                <StanceWord stance={stance} />
              </button>
            ))}
          </div>
        </div>
      </div>
      <label style={{ ...labelStyle, marginTop: "0.55rem" }}>Deployed as</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
        {["", "front", "swarm"].map((form) => (
          <button className="oh-tap" data-oh-front-form={form || "auto"} key={form || "auto"} onClick={() => setForm(form)} style={touchFit(choiceStyle((forms[side] || "") === form), touch)} type="button">
            {form === "swarm" ? <>Swarms</> : form === "front" ? <>A front</> : <>As its wars are fought</>}
          </button>
        ))}
      </div>
      <label style={{ ...labelStyle, marginTop: "0.55rem" }}>Generals</label>
      <input
        maxLength={(GENERAL_NAME_MAX + 2) * MAX_COMMANDS}
        onChange={(event) => setAt("generals", event.target.value.split(",").slice(0, MAX_COMMANDS).map((name) => name.replace(/^\s+/, "").slice(0, GENERAL_NAME_MAX)))}
        placeholder="Names, with commas between them"
        style={inputStyle}
        type="text"
        value={front.generals[side].join(", ")}
      />
    </div>
  );
};

const ScenarioFrontsPanel = ({ details, onDetailsChange }) => {
  const touch = useTouchPrimary();
  const scenarioId = details?.scenario?.id ?? "";
  const saved = useMemo(() => frontsOf(details), [details]);
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Another scenario opened in the drawer: start from its fronts.
  useEffect(() => {
    setDraft(frontsOf(details));
    setMessage("");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId]);

  // The countries that hold ground on the scenario's map: a front runs where
  // two of them meet.
  const countries = useMemo(() => {
    const world = details?.data?.world ?? {};
    return collectScenarioPoliticalPolities(world)
      .filter((entry) => entry.hasTerritory && entry.active !== false)
      .map((entry) => ({ key: entry.polityKey, label: String(world.polityOverrides?.[entry.polityKey]?.name || entry.polityKey) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [details]);

  const changed = !same(draft, saved);
  const unfinished = draft.filter((front) => front.sides[0].length === 0 || front.sides[1].length === 0).length;
  const edit = (index, next) => {
    // A border at peace is between two countries, one a side, and nobody attacks across it.
    const held = next.war ? next : {
      ...next,
      sides: next.sides.map((members) => members.slice(0, 1)),
      stance: next.stance.map((stance) => (stance === "advance" ? "hold" : stance)),
    };
    setDraft(draft.map((front, at) => (at === index ? held : front)));
    setMessage("");
  };
  const save = async () => {
    if (!scenarioId || busy || unfinished) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const fronts = normalizeScenarioFronts(draft);
      const nextDetails = await saveScenario(scenarioId, { worldPatch: { scenarioFronts: fronts } });
      onDetailsChange?.(nextDetails);
      setDraft(normalizeScenarioFronts(fronts, { draft: true }));
      setMessage("Fronts saved. New games from this scenario begin with them.");
    } catch (nextError) {
      setError(nextError?.message || String(nextError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.95rem", padding: "0.9rem" }}>
      <div style={{ color: "rgba(255,255,255,0.94)", fontSize: "0.95rem", fontWeight: 800 }}>Fronts</div>
      <div style={{ ...hintStyle, marginTop: "0.2rem" }}>The fronts this scenario begins with. A new game opens with their troops already standing along the line, and its war room ready, without asking your AI for anything.</div>
      <div style={{ ...hintStyle, marginTop: "0.2rem" }}>You do not draw the line: it runs where the two sides’ land meets on your map. Paint the land each side holds in the map editor, then name the sides here.</div>

      <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between", marginTop: "0.8rem" }}>
        <div style={{ color: "rgba(255,255,255,0.78)", fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {draft.length === 1 ? "1 front" : `${draft.length} fronts`}
        </div>
        <button className="oh-tap" disabled={draft.length >= MAX_SCENARIO_FRONTS} onClick={() => setDraft([...draft, blankScenarioFront()])} style={touchFit({ ...buttonStyle, opacity: draft.length >= MAX_SCENARIO_FRONTS ? 0.5 : 1 }, touch)} type="button">+ Add a front</button>
      </div>
      {draft.length === 0 ? <div style={{ ...hintStyle, marginTop: "0.5rem" }}>No fronts yet. Without any, a battlefield still opens by itself wherever a war’s two sides hold land that touches, at the first time skip.</div> : null}
      {countries.length < 2 && draft.length > 0 ? <div style={{ ...hintStyle, color: "#fde68a", marginTop: "0.45rem" }}>This scenario’s map has fewer than two countries holding land. Save a map with the countries on it first.</div> : null}

      {draft.map((front, index) => (
        <section key={`front-${index}`} style={sectionStyle}>
          <div style={{ alignItems: "flex-end", display: "flex", gap: "0.5rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={labelStyle}>Name</label>
              <input
                maxLength={80}
                onChange={(event) => edit(index, { ...front, name: event.target.value })}
                placeholder="The Western Front"
                style={inputStyle}
                type="text"
                value={front.name}
              />
            </div>
            <button className="oh-tap" onClick={() => { setDraft(draft.filter((_, at) => at !== index)); setMessage(""); }} style={touchFit(buttonStyle, touch)} type="button">Remove</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.55rem" }}>
            <button className="oh-tap" onClick={() => edit(index, { ...front, war: true })} style={touchFit(choiceStyle(front.war), touch)} type="button">At war from the first day</button>
            <button className="oh-tap" onClick={() => edit(index, { ...front, war: false })} style={touchFit(choiceStyle(!front.war), touch)} type="button">A fortified border, at peace</button>
          </div>
          <div style={{ ...hintStyle, marginTop: "0.35rem" }}>
            {front.war
              ? <>The two sides are at war here when the game begins. If your pre-history does not already put them at war, the war is written into the game for you.</>
              : <>Two countries that have manned their border and are not at war. A side told nothing has no troops there.</>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.9rem", marginTop: "0.65rem" }}>
            <SideEditor countries={countries} front={front} onChange={(next) => edit(index, next)} side={0} touch={touch} />
            <SideEditor countries={countries} front={front} onChange={(next) => edit(index, next)} side={1} touch={touch} />
          </div>
          {front.sides[0].length === 0 || front.sides[1].length === 0 ? <div style={{ ...hintStyle, color: "#fde68a", marginTop: "0.45rem" }}>Choose at least one country on each side.</div> : null}
        </section>
      ))}

      <div style={{ ...hintStyle, marginTop: "0.7rem" }}>Leave Formations empty and the game counts them by each side’s size and the length of the line. Generals are named in the order of their commands, from the north or the west; leave it empty and the player’s generals introduce themselves.</div>
      {error ? <div data-no-translate role="alert" style={{ color: "#fca5a5", fontSize: "0.74rem", marginTop: "0.5rem" }}>{error}</div> : null}
      {message ? <div role="status" style={{ color: "#86efac", fontSize: "0.74rem", marginTop: "0.5rem" }}>{message}</div> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", marginTop: "0.7rem" }}>
        <button className="oh-tap" disabled={busy || !changed || unfinished > 0} onClick={save} style={touchFit({ ...primaryButtonStyle, opacity: busy || !changed || unfinished > 0 ? 0.55 : 1 }, touch)} type="button">
          {busy ? "Saving…" : "Save fronts"}
        </button>
        {changed ? <button className="oh-tap" disabled={busy} onClick={() => { setDraft(saved); setMessage(""); setError(""); }} style={touchFit(buttonStyle, touch)} type="button">Discard changes</button> : null}
      </div>
    </div>
  );
};

export default ScenarioFrontsPanel;
