/*! Open Historia — the Workshop's Pre-history tab © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A scenario's events before round one (runtime/scenarioPrehistory.js), kept
// with the scenario so a new game opens with them and asks no model: written
// here by hand — a date, a title, a description, and what else an event can
// carry — or generated from a prompt (AI/gameplay.js
// generateScenarioPrehistory) and then edited like any other. A generation also
// writes the Day-one facts, the wars, relations and agreements already true on
// the start date, listed below the events. Saved on its own, like the
// institutions (InstitutionAuthoringPanel.jsx), with its own Save.

import React, { useEffect, useMemo, useRef, useState } from "react";

import { downloadScenarioJsonAsset, saveScenario } from "../../runtime/library.js";
import { useTouchPrimary } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { EVENT_TAG_ENUM } from "../../runtime/eventTags.js";
import {
  emptyScenarioPrehistory,
  countPrehistoryUpdates,
  newPrehistoryEventId,
  normalizeScenarioPrehistory,
  PREHISTORY_IMPORTANCE,
  PREHISTORY_KINDS,
  MAX_PREHISTORY_EVENTS,
  prehistoryProblems,
  prehistoryUpdateRows,
  withoutPrehistoryUpdate,
} from "../../runtime/scenarioPrehistory.js";
import { generateScenarioPrehistory } from "../AI/gameplayLazy.js";
import { formatGameDateReadable } from "../../runtime/gameDates.js";
import { collectScenarioPoliticalPolities } from "../../runtime/scenarioPolities.js";
import {
  AUTHORABLE_DAY_ONE_KINDS,
  MAX_SEMANTIC_DAY_ONE_FACTS,
  changeManualAccessReciprocal,
  changeManualAgreementType,
  dayOneEditorProblems,
  insertManualDayOneFact,
  updateDayOneFact,
} from "../../runtime/scenarioPrehistoryDayOne.js";
import DayOneFactEditor from "./DayOneFactEditor.jsx";
import {
  scenarioCanonicalAgreements, sameScenarioCanonicalAgreements,
  editScenarioCanonicalAgreement, changeScenarioCanonicalAgreementType,
  changeScenarioCanonicalAccessReciprocal, removeScenarioCanonicalAgreement,
  validateScenarioCanonicalAgreementEdits,
} from "../../runtime/scenarioCanonicalAgreements.js";

const buttonStyle = {
  alignItems: "center",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "9px",
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
const sectionTitleStyle = { color: "rgba(255,255,255,0.78)", fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.06em", marginBottom: "0.5rem", textTransform: "uppercase" };
const choiceStyle = (active) => ({
  ...buttonStyle,
  background: active ? "rgba(0,0,0,0.42)" : "rgba(255,255,255,0.04)",
  borderColor: active ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.08)",
  color: active ? "#f4f4f5" : "rgba(255,255,255,0.7)",
  fontSize: "0.7rem",
  minHeight: "1.8rem",
  padding: "0 0.6rem",
});

// On a touch screen .oh-tap / .oh-tap-row (styles.css) make a control a
// finger's 44 px, which an inline minHeight would beat.
const touchFit = (style, touch) => (touch ? { ...style, minHeight: undefined } : style);

// Drawn, not typed: an arrow character comes out as a coloured emoji on some
// systems.
const Chevron = ({ up }) => (
  <svg aria-hidden="true" height="12" viewBox="0 0 12 12" width="12">
    <path d={up ? "M2 8 L6 4 L10 8" : "M2 4 L6 8 L10 4"} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
  </svg>
);

const startDateOf = (details) => String(details?.data?.game?.startDate || details?.data?.game?.gameDate || "").trim();
const recordOf = (details) => normalizeScenarioPrehistory(details?.data?.world?.prehistory, { draft: true });
const sameRecord = (a, b) => JSON.stringify(normalizeScenarioPrehistory(a, { draft: true })) === JSON.stringify(normalizeScenarioPrehistory(b, { draft: true }));

const ProblemLine = ({ problem, startDate }) => {
  const text = problem === "title"
    ? "Give this event a title."
    : problem === "date"
      ? "Give this event a date as YYYY-MM-DD; a negative year is BC."
      : `This event must come before the start date, ${(formatGameDateReadable(startDate) || startDate)}.`;
  return <div style={{ color: "#fca5a5", fontSize: "0.68rem", lineHeight: 1.45 }}>{text}</div>;
};

const DayOneRow = ({ row, onRemove, touch }) => {
  const sideA = row.sideA.join(", ");
  const sideB = row.sideB.join(", ");
  const title = row.title;
  const score = row.detail;
  // A lifecycle record is worded by its family; a semantic fact, whose family
  // is the one list they all share, by its own kind.
  const shape = row.family === "canonicalUpdates"
    ? ({ war: "warUpdates", relation: "relationUpdates", agreement: "agreementUpdates", puppet: "puppetUpdates" }[row.kind] ?? "storylineUpdates")
    : row.family;
  const line = shape === "warUpdates"
    ? `War: ${sideA} against ${sideB}`
    : shape === "relationUpdates"
      ? `Relations between ${sideA} and ${sideB}: ${score}`
      : shape === "agreementUpdates"
        ? `Agreement: ${title} (${sideA})`
        : shape === "puppetUpdates"
          ? `Subordination: ${sideA} over ${sideB}`
          : `Ongoing storyline: ${title}`;
  return (
    <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between", padding: "0.3rem 0" }}>
      <div style={{ color: "rgba(255,255,255,0.82)", fontSize: "0.74rem", lineHeight: 1.45, minWidth: 0, overflowWrap: "anywhere" }}>{line}</div>
      <button className="oh-tap" onClick={onRemove} style={touchFit({ ...buttonStyle, flex: "0 0 auto", fontSize: "0.68rem", minHeight: "1.7rem" }, touch)} type="button">Remove</button>
    </div>
  );
};

const EventCard = ({ event, index, count, problems, startDate, onChange, onMove, onRemove, isMobile, touch }) => {
  const edit = (field, value) => onChange({ ...event, [field]: value });
  const editQuote = (field, value) => onChange({ ...event, quote: { ...(event.quote ?? {}), [field]: value } });
  const toggleTag = (tag) => {
    const tags = event.tags.includes(tag) ? event.tags.filter((entry) => entry !== tag) : [...event.tags, tag].slice(0, 3);
    onChange({ ...event, tags });
  };
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${problems.length ? "rgba(248,113,113,0.35)" : "rgba(255,255,255,0.08)"}`, borderRadius: 12, display: "grid", gap: "0.55rem", padding: "0.65rem" }}>
      {/* Side by side while there is room for both, stacked when there is not. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.55rem" }}>
        <div style={{ flex: "1 1 8.5rem", maxWidth: isMobile ? "none" : "12rem" }}>
          <label style={labelStyle}>Date</label>
          <input onChange={(e) => edit("date", e.target.value)} placeholder="YYYY-MM-DD" style={inputStyle} value={event.date} />
        </div>
        <div style={{ flex: "3 1 14rem", minWidth: 0 }}>
          <label style={labelStyle}>Title</label>
          <input onChange={(e) => edit("title", e.target.value)} placeholder="Exact event title" style={inputStyle} value={event.title} />
        </div>
      </div>
      <div>
        <label style={labelStyle}>Description</label>
        <textarea onChange={(e) => edit("description", e.target.value)} placeholder="What canonically happened?" rows={3} style={{ ...inputStyle, lineHeight: 1.45, resize: "vertical" }} value={event.description} />
      </div>
      <details>
        <summary className="oh-tap-row" style={{ color: "rgba(255,255,255,0.72)", cursor: "pointer", fontSize: "0.7rem", fontWeight: 750 }}>Advanced event metadata</summary>
        <div style={{ display: "grid", gap: "0.55rem", marginTop: "0.5rem" }}>
          <div>
            <span style={labelStyle}>Importance</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
              {PREHISTORY_IMPORTANCE.map((value) => (
                <button className="oh-tap" key={value} onClick={() => edit("importance", value)} style={touchFit(choiceStyle(event.importance === value), touch)} type="button">{value}</button>
              ))}
            </div>
          </div>
          <div>
            <span style={labelStyle}>Kind</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
              {PREHISTORY_KINDS.map((value) => (
                <button className="oh-tap" key={value} onClick={() => edit("kind", value)} style={touchFit(choiceStyle(event.kind === value), touch)} type="button">{value}</button>
              ))}
            </div>
          </div>
          <div>
            <span style={labelStyle}>Categories</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
              {EVENT_TAG_ENUM.map((tag) => (
                <button className="oh-tap" key={tag} onClick={() => toggleTag(tag)} style={touchFit(choiceStyle(event.tags.includes(tag)), touch)} type="button">{tag}</button>
              ))}
            </div>
          </div>
          <label className="oh-tap-row" style={{ alignItems: "center", cursor: "pointer", display: "flex", fontSize: "0.72rem", gap: "0.4rem" }}>
            <input checked={Boolean(event.notable)} onChange={(e) => edit("notable", e.target.checked)} type="checkbox" />
            Notable
          </label>
          <div>
            <label style={labelStyle}>Quote text</label>
            <textarea onChange={(e) => editQuote("text", e.target.value)} placeholder="Quotation text without surrounding quotation marks" rows={2} style={{ ...inputStyle, lineHeight: 1.45, resize: "vertical" }} value={event.quote?.text ?? ""} />
          </div>
          <div style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "1fr 1fr" }}>
            <div>
              <label style={labelStyle}>Speaker</label>
              <input onChange={(e) => editQuote("speaker", e.target.value)} placeholder="Optional attribution" style={inputStyle} value={event.quote?.speaker ?? ""} />
            </div>
            <div>
              <label style={labelStyle}>Role / title</label>
              <input onChange={(e) => editQuote("role", e.target.value)} placeholder="Optional office or role" style={inputStyle} value={event.quote?.role ?? ""} />
            </div>
          </div>
        </div>
      </details>
      {problems.map((problem) => <ProblemLine key={problem} problem={problem} startDate={startDate} />)}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", justifyContent: "flex-end" }}>
        <button aria-label="Move up" className="oh-tap" disabled={index === 0} onClick={() => onMove(-1)} style={touchFit({ ...buttonStyle, opacity: index === 0 ? 0.4 : 1 }, touch)} type="button"><Chevron up /></button>
        <button aria-label="Move down" className="oh-tap" disabled={index === count - 1} onClick={() => onMove(1)} style={touchFit({ ...buttonStyle, opacity: index === count - 1 ? 0.4 : 1 }, touch)} type="button"><Chevron /></button>
        <button className="oh-tap" onClick={onRemove} style={touchFit(buttonStyle, touch)} type="button">Remove</button>
      </div>
    </div>
  );
};

const PrehistoryPanel = ({ details, onDetailsChange }) => {
  const isMobile = useIsMobile();
  const touch = useTouchPrimary();
  const scenarioId = details?.scenario?.id ?? "";
  const startDate = startDateOf(details);
  const saved = useMemo(() => recordOf(details), [details]);
  const [draft, setDraft] = useState(() => saved ?? emptyScenarioPrehistory());
  const [canonicalDraft, setCanonicalDraft] = useState(() => scenarioCanonicalAgreements(details?.data?.world));
  const [prompt, setPrompt] = useState(() => saved?.prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef(null);

  // Another scenario opened in the drawer: start from its record.
  useEffect(() => {
    setDraft(recordOf(details) ?? emptyScenarioPrehistory());
    setCanonicalDraft(scenarioCanonicalAgreements(details?.data?.world));
    setPrompt(recordOf(details)?.prompt ?? "");
    setMessage("");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const briefing = String(details?.data?.world?.startingTimelineText ?? "").trim();
  // A scenario with no record yet but a briefing may save an empty one on
  // purpose: its games then open with no backstory rather than asking for one.
  const changed = !sameRecord({ ...draft, prompt }, saved ?? emptyScenarioPrehistory());
  const problems = useMemo(() => prehistoryProblems(draft, { startDate }), [draft, startDate]);
  const problemsById = useMemo(() => {
    const map = new Map();
    for (const entry of problems) map.set(entry.id, [...(map.get(entry.id) ?? []), entry.problem]);
    return map;
  }, [problems]);
  const dayOne = useMemo(() => prehistoryUpdateRows(draft), [draft]);
  const world = useMemo(() => details?.data?.world || {}, [details?.data?.world]);
  const savedCanonical = useMemo(() => scenarioCanonicalAgreements(world), [world]);
  const canonicalDirty = !sameScenarioCanonicalAgreements(canonicalDraft, savedCanonical);
  const canonicalValidation = useMemo(() => validateScenarioCanonicalAgreementEdits({
    original: savedCanonical, draft: canonicalDraft, world, prehistory: draft, startDate,
  }), [savedCanonical, canonicalDraft, world, draft, startDate]);
  const canonicalProblems = canonicalDirty ? canonicalValidation.errors : [];
  const dirty = changed || canonicalDirty || (!saved && Boolean(briefing));
  const polities = useMemo(() => collectScenarioPoliticalPolities(world)
    .map((entry) => entry.polityKey), [world]);
  const dayOneProblems = useMemo(() => dayOneEditorProblems(draft, { startDate }), [draft, startDate]);
  const dayOneProblemsByKey = useMemo(() => {
    const map = new Map();
    for (const entry of dayOneProblems) {
      const key = String(entry.family) + ":" + String(entry.index);
      map.set(key, [...(map.get(key) || []), entry.problem]);
    }
    return map;
  }, [dayOneProblems]);
  const eventCount = draft.events.length;

  const setEvents = (events) => setDraft((current) => ({ ...current, events }));
  const addEvent = () => setEvents([...draft.events, { id: newPrehistoryEventId(), date: "", title: "", description: "", importance: "minor", kind: "world", tags: [] }]);
  const changeEvent = (index, next) => setEvents(draft.events.map((event, at) => (at === index ? next : event)));
  const moveEvent = (index, step) => {
    const target = index + step;
    if (target < 0 || target >= draft.events.length) return;
    const events = [...draft.events];
    [events[index], events[target]] = [events[target], events[index]];
    setEvents(events);
  };
  const removeEvent = (index) => setEvents(draft.events.filter((_, at) => at !== index));
  const addDayOne = (kind) => {
    try {
      setDraft((current) => insertManualDayOneFact(current, kind));
      setError("");
      setMessage("");
    } catch (nextError) {
      setError(nextError?.message || String(nextError));
    }
  };
  const editDayOne = (family, index, patch) => {
    setDraft((current) => updateDayOneFact(current, family, index, patch));
    setError("");
    setMessage("");
  };
  const changeAgreementType = (index, type) => {
    setDraft((current) => changeManualAgreementType(current, index, type));
    setError("");
  };
  const changeAccessReciprocal = (index, reciprocal) => {
    setDraft((current) => changeManualAccessReciprocal(current, index, reciprocal));
    setError("");
  };
  const removeDayOne = (family, index) => {
    setDraft((current) => withoutPrehistoryUpdate(current, family, index));
    setError("");
    setMessage("");
  };
  const applyCanonicalEdit = (edit) => {
    try {
      setCanonicalDraft(edit(canonicalDraft));
      setError("");
      setMessage("");
    } catch (nextError) {
      setError(nextError?.message || String(nextError));
    }
  };
  const removeCanonical = (agreement) => {
    if (!window.confirm("Remove this existing agreement from the scenario? Existing campaigns will not change.")) return;
    applyCanonicalEdit((current) => removeScenarioCanonicalAgreement(current, agreement.id));
  };

  const generate = async () => {
    if (!scenarioId || busy) return;
    if ((draft.events.length || countPrehistoryUpdates(draft)) && !window.confirm("Replace the events and Day-one facts below with a newly generated pre-history? You can still discard the result before saving.")) return;
    setError("");
    setMessage("");
    setBusy(true);
    setGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const [regionsGeojson, citiesGeojson, tags] = await Promise.all(["regionsGeojson", "citiesGeojson", "tags"]
        .map((key) => downloadScenarioJsonAsset(scenarioId, key).catch(() => null)));
      const generated = await generateScenarioPrehistory({
        details,
        prompt,
        assets: { regionsGeojson, citiesGeojson, tags },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setDraft(normalizeScenarioPrehistory(generated, { draft: true }));
      setMessage("Generated. Edit anything below, then save the pre-history.");
    } catch (nextError) {
      if (!controller.signal.aborted) setError(nextError?.message || String(nextError));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      setGenerating(false);
    }
  };
  const cancelGeneration = () => {
    abortRef.current?.abort();
    setMessage("Generation cancelled.");
  };

  const save = async () => {
    if (!scenarioId || busy || problems.length || dayOneProblems.length || canonicalProblems.length) return;
    const stagedWorld = canonicalDirty ? { ...world, agreements: canonicalValidation.agreements } : world;
    const verified = dayOneEditorProblems(draft, { startDate, world: stagedWorld, verifyWorld: true });
    if (verified.length) {
      setError("Day-one facts could not be saved: " + verified.map((entry) => entry.problem).join(" "));
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const record = normalizeScenarioPrehistory({ ...draft, prompt });
      const worldPatch = {
        ...(changed || (!saved && Boolean(briefing)) ? { prehistory: record } : {}),
        ...(canonicalDirty ? { agreements: canonicalValidation.agreements } : {}),
      };
      const nextDetails = await saveScenario(scenarioId, { worldPatch });
      onDetailsChange?.(nextDetails);
      setDraft(normalizeScenarioPrehistory(record, { draft: true }));
      setCanonicalDraft(scenarioCanonicalAgreements(nextDetails?.data?.world));
      setMessage("Starting history saved. New games from this scenario use the updated agreements and Day-one facts.");
    } catch (nextError) {
      setError(nextError?.message || String(nextError));
    } finally {
      setBusy(false);
    }
  };
  const discard = () => {
    setDraft(saved ?? emptyScenarioPrehistory());
    setCanonicalDraft(savedCanonical);
    setPrompt(saved?.prompt ?? "");
    setMessage("");
    setError("");
  };

  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.95rem", padding: "0.9rem" }}>
      <div style={{ color: "rgba(255,255,255,0.94)", fontSize: "0.95rem", fontWeight: 800 }}>Pre-game history</div>
      <div style={{ ...hintStyle, marginTop: "0.2rem" }}>The events before round one. A new game from this scenario starts with them on its timeline, without asking your AI for them.</div>
      <div style={{ ...hintStyle, marginTop: "0.2rem" }}>Write them below, or generate them from a prompt and edit the result.</div>
      {!saved && briefing ? (
        <div style={{ ...hintStyle, color: "#fde68a", marginTop: "0.45rem" }}>Until a pre-history is saved here, a new game from this scenario asks your AI to write one from World Before Round One when it first opens.</div>
      ) : null}

      <section style={sectionStyle}>
        <div style={sectionTitleStyle}>Generate</div>
        <label style={labelStyle}>Prompt</label>
        <textarea
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="What should the backstory cover? For example: the decade of crises that led to the war, seen from the great powers."
          rows={3}
          style={{ ...inputStyle, lineHeight: 1.45, resize: "vertical" }}
          value={prompt}
        />
        <div style={{ ...hintStyle, marginTop: "0.4rem" }}>The AI also reads the scenario's map, start date, World Before Round One and Simulation Rules. It writes the events and the Day-one facts, and replaces the events below.</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", marginTop: "0.55rem" }}>
          <button className="oh-tap" disabled={busy || !startDate} onClick={generate} style={touchFit({ ...primaryButtonStyle, opacity: busy || !startDate ? 0.55 : 1 }, touch)} type="button">
            {generating ? "Generating…" : "Generate pre-history"}
          </button>
          {generating ? <button className="oh-tap" onClick={cancelGeneration} style={touchFit(buttonStyle, touch)} type="button">Cancel</button> : null}
        </div>
        {!startDate ? <div style={{ ...hintStyle, color: "#fde68a", marginTop: "0.4rem" }}>Set and save the scenario's game date first.</div> : null}
      </section>

      <section style={sectionStyle}>
        <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <div style={{ ...sectionTitleStyle, marginBottom: 0 }}>{eventCount === 1 ? "1 event" : `${eventCount} events`}</div>
          <button className="oh-tap" disabled={eventCount >= MAX_PREHISTORY_EVENTS} onClick={addEvent} style={touchFit(buttonStyle, touch)} type="button">+ Add event</button>
        </div>
        {startDate ? <div style={{ ...hintStyle, marginBottom: "0.55rem" }}>{`Every event is dated before the start date, ${(formatGameDateReadable(startDate) || startDate)}, and they are kept oldest first.`}</div> : null}
        {!eventCount ? <div style={hintStyle}>No pre-history events yet.</div> : null}
        <div style={{ display: "grid", gap: "0.6rem" }}>
          {draft.events.map((event, index) => (
            <EventCard
              count={eventCount}
              event={event}
              index={index}
              isMobile={isMobile}
              key={event.id}
              onChange={(next) => changeEvent(index, next)}
              onMove={(step) => moveEvent(index, step)}
              onRemove={() => removeEvent(index)}
              problems={problemsById.get(event.id) ?? []}
              startDate={startDate}
              touch={touch}
            />
          ))}
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionTitleStyle}>Summary</div>
        <textarea
          onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}
          placeholder="One paragraph on the era leading into the start date (optional)."
          rows={2}
          style={{ ...inputStyle, lineHeight: 1.45, resize: "vertical" }}
          value={draft.summary}
        />
      </section>

      <section style={sectionStyle}>
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem", justifyContent: "space-between", marginBottom: "0.55rem" }}>
          <div style={{ ...sectionTitleStyle, marginBottom: 0 }}>Day-one facts</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
            {AUTHORABLE_DAY_ONE_KINDS.map((kind) => (
              <button className="oh-tap" disabled={busy || draft.updates.canonicalUpdates.length >= MAX_SEMANTIC_DAY_ONE_FACTS}
                key={kind} onClick={() => addDayOne(kind)} style={touchFit(buttonStyle, touch)} type="button">
                {kind === "relation" ? "+ Relationship" : kind === "agreement" ? "+ Agreement" : "+ Storyline"}
              </button>
            ))}
          </div>
        </div>
        <div style={{ ...hintStyle, marginBottom: "0.5rem" }}>
          Add or edit the diplomatic relationships, treaties and ongoing processes that already exist on the start date.
          They become canonical game records when a new campaign opens. Use the exact scenario country names.
          Existing wars and subordinations remain removable; the native war and puppet authoring contracts are unchanged.
        </div>
        {polities.length ? <datalist id="oh-prehistory-polities">{polities.map((name) => <option key={name} value={name} />)}</datalist> : null}
        {!dayOne.length && !canonicalDraft.length ? <div style={hintStyle}>No Day-one facts yet. You can add one without generating pre-history.</div> : null}
        <div style={{ display: "grid", gap: "0.45rem" }}>
          {dayOne.map((row) => {
            const fact = draft.updates?.[row.family]?.[row.index];
            const kind = row.family === "canonicalUpdates" ? fact?.kind :
              ({ relationUpdates: "relation", agreementUpdates: "agreement", storylineUpdates: "storyline" }[row.family]);
            const editable = AUTHORABLE_DAY_ONE_KINDS.includes(kind);
            const key = row.family + ":" + (fact?.ref || fact?.id || row.index);
            const problemText = dayOneProblemsByKey.get(row.family + ":" + row.index) || [];
            return editable ? (
              <DayOneFactEditor disabled={busy} fact={fact} key={key}
                onChange={(patch) => editDayOne(row.family, row.index, patch)}
                onChangeType={(type) => changeAgreementType(row.index, type)}
                onReciprocalChange={(reciprocal) => changeAccessReciprocal(row.index, reciprocal)}
                onRemove={() => removeDayOne(row.family, row.index)}
                problems={problemText} row={row} />
            ) : (
              <DayOneRow key={key} onRemove={() => removeDayOne(row.family, row.index)} row={row} touch={touch} />
            );
          })}
        </div>
        {canonicalDraft.length ? (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: "0.65rem", paddingTop: "0.65rem" }}>
            <div style={sectionTitleStyle}>Existing scenario agreements</div>
            <div style={{ ...hintStyle, marginBottom: "0.5rem" }}>
              These are already in the scenario's formal agreements ledger (including Political World generated treaties), not generated Pre-history facts.
              Edit or remove them here to change the starting state of NEW campaigns. Existing campaign saves are unaffected.
            </div>
            <div style={{ display: "grid", gap: "0.45rem" }}>
              {canonicalDraft.map((agreement, index) => {
                const id = String(agreement?.id ?? "").trim();
                const validId = id && canonicalDraft.filter((row) => String(row?.id ?? "").trim() === id).length === 1;
                const rowProblems = canonicalProblems.filter((problem) => problem.id === id).map((problem) => problem.problem);
                return (
                  <div key={index}>
                    <DayOneFactEditor row={{ family: "worldAgreements" }} fact={agreement}
                      disabled={busy || !validId}
                      problems={rowProblems}
                      onChange={(patch) => applyCanonicalEdit((current) => editScenarioCanonicalAgreement(current, id, patch))}
                      onChangeType={(type) => applyCanonicalEdit((current) => changeScenarioCanonicalAgreementType(current, id, type))}
                      onReciprocalChange={(reciprocal) => applyCanonicalEdit((current) => changeScenarioCanonicalAccessReciprocal(current, id, reciprocal))}
                      onRemove={() => removeCanonical(agreement)} />
                    {!validId ? <div style={{ ...hintStyle, color: "#fca5a5" }}>This older agreement has no unique canonical ID and cannot safely be edited here.</div> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {dayOneProblemsByKey.get("canonicalUpdates:-1")?.map((problem, index) => (
          <div key={index} style={{ color: "#fca5a5", fontSize: "0.69rem", marginTop: "0.45rem" }}>{problem}</div>
        ))}
      </section>
      {error ? <div style={{ color: "#fca5a5", fontSize: "0.72rem", lineHeight: 1.5, marginTop: "0.7rem", overflowWrap: "anywhere" }}>{error}</div> : null}
      {message ? <div style={{ color: "rgba(255,255,255,0.72)", fontSize: "0.72rem", lineHeight: 1.5, marginTop: "0.7rem" }}>{message}</div> : null}
      {problems.length ? <div style={{ color: "#fca5a5", fontSize: "0.72rem", lineHeight: 1.5, marginTop: "0.7rem" }}>Fix the events marked above before saving.</div> : null}
      {dayOneProblems.length ? <div style={{ color: "#fca5a5", fontSize: "0.72rem", marginTop: "0.35rem" }}>Fix the Day-one facts marked above before saving.</div> : null}
      {canonicalProblems.length ? <div style={{ color: "#fca5a5", fontSize: "0.72rem", marginTop: "0.35rem" }}>
        Fix the existing agreement problems before saving.
        {canonicalProblems.filter((problem) => !canonicalDraft.some((entry) => entry?.id === problem.id)).map((problem, index) => (
          <div key={index}>{problem.problem}</div>
        ))}
      </div> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", marginTop: "0.75rem" }}>
        <button className="oh-tap" disabled={busy || !dirty || problems.length > 0 || dayOneProblems.length > 0 || canonicalProblems.length > 0} onClick={save} style={touchFit({ ...primaryButtonStyle, opacity: busy || !dirty || problems.length || dayOneProblems.length || canonicalProblems.length ? 0.55 : 1 }, touch)} type="button">Save starting history</button>
        <button className="oh-tap" disabled={busy || !dirty} onClick={discard} style={touchFit({ ...buttonStyle, opacity: busy || !dirty ? 0.55 : 1 }, touch)} type="button">Discard changes</button>
      </div>
    </div>
  );
};

export default PrehistoryPanel;
