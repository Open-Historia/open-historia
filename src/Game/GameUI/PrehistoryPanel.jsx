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
      : `This event must come before the start date, ${startDate}.`;
  return <div style={{ color: "#fca5a5", fontSize: "0.68rem", lineHeight: 1.45 }}>{text}</div>;
};

const DayOneRow = ({ row, onRemove, touch }) => {
  const sideA = row.sideA.join(", ");
  const sideB = row.sideB.join(", ");
  const title = row.title;
  const score = row.detail;
  const line = row.family === "warUpdates"
    ? `War: ${sideA} against ${sideB}`
    : row.family === "relationUpdates"
      ? `Relations between ${sideA} and ${sideB}: ${score}`
      : row.family === "agreementUpdates"
        ? `Agreement: ${title} (${sideA})`
        : row.family === "puppetUpdates"
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
  const [prompt, setPrompt] = useState(() => saved?.prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef(null);

  // Another scenario opened in the drawer: start from its record.
  useEffect(() => {
    setDraft(recordOf(details) ?? emptyScenarioPrehistory());
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
  const dirty = changed || (!saved && Boolean(briefing));
  const problems = useMemo(() => prehistoryProblems(draft, { startDate }), [draft, startDate]);
  const problemsById = useMemo(() => {
    const map = new Map();
    for (const entry of problems) map.set(entry.id, [...(map.get(entry.id) ?? []), entry.problem]);
    return map;
  }, [problems]);
  const dayOne = useMemo(() => prehistoryUpdateRows(draft), [draft]);
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

  const generate = async () => {
    if (!scenarioId || busy) return;
    if (draft.events.length && !window.confirm("Replace the events below with a newly generated pre-history? You can still discard the result before saving.")) return;
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
    if (!scenarioId || busy || problems.length) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const record = normalizeScenarioPrehistory({ ...draft, prompt });
      const nextDetails = await saveScenario(scenarioId, { worldPatch: { prehistory: record } });
      onDetailsChange?.(nextDetails);
      setDraft(normalizeScenarioPrehistory(record, { draft: true }));
      setMessage("Pre-history saved. New games from this scenario start with it.");
    } catch (nextError) {
      setError(nextError?.message || String(nextError));
    } finally {
      setBusy(false);
    }
  };
  const discard = () => {
    setDraft(saved ?? emptyScenarioPrehistory());
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
        {startDate ? <div style={{ ...hintStyle, marginBottom: "0.55rem" }}>{`Every event is dated before the start date, ${startDate}, and they are kept oldest first.`}</div> : null}
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

      {dayOne.length ? (
        <section style={sectionStyle}>
          <div style={sectionTitleStyle}>Day-one facts</div>
          <div style={{ ...hintStyle, marginBottom: "0.4rem" }}>Wars, relations and agreements already true on the start date, written by the generation. A new game starts with them in its records.</div>
          {dayOne.map((row) => (
            <DayOneRow key={`${row.family}-${row.index}`} onRemove={() => setDraft((current) => withoutPrehistoryUpdate(current, row.family, row.index))} row={row} touch={touch} />
          ))}
        </section>
      ) : null}

      {error ? <div style={{ color: "#fca5a5", fontSize: "0.72rem", lineHeight: 1.5, marginTop: "0.7rem", overflowWrap: "anywhere" }}>{error}</div> : null}
      {message ? <div style={{ color: "rgba(255,255,255,0.72)", fontSize: "0.72rem", lineHeight: 1.5, marginTop: "0.7rem" }}>{message}</div> : null}
      {problems.length ? <div style={{ color: "#fca5a5", fontSize: "0.72rem", lineHeight: 1.5, marginTop: "0.7rem" }}>Fix the events marked above before saving.</div> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", marginTop: "0.75rem" }}>
        <button className="oh-tap" disabled={busy || !dirty || problems.length > 0} onClick={save} style={touchFit({ ...primaryButtonStyle, opacity: busy || !dirty || problems.length ? 0.55 : 1 }, touch)} type="button">Save pre-history</button>
        <button className="oh-tap" disabled={busy || !changed} onClick={discard} style={touchFit({ ...buttonStyle, opacity: busy || !changed ? 0.55 : 1 }, touch)} type="button">Discard changes</button>
      </div>
    </div>
  );
};

export default PrehistoryPanel;
