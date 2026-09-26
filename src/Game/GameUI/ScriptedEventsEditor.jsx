/*! Open Historia — structured scenario scripted-event authoring © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { INSTITUTION_MEMBER_STATUSES } from "../../runtime/institutions.js";
import { PUPPET_KINDS, puppetKindLabel } from "../../runtime/puppets.js";
import {
  scriptedEventInstitutionOptions,
  scriptedEventPickerLabel,
  scriptedEventPickerValue,
  scriptedEventPolityOptions,
} from "./scriptedEventAuthoring.js";

const clean = (value) => String(value ?? "").trim();
const array = (value) => Array.isArray(value) ? value : [];

const CONDITION_DEFINITIONS = [
  { type: "polity_exists", label: "Polity exists", fields: ["polityId"] },
  { type: "polity_not_exists", label: "Polity does not exist", fields: ["polityId"] },
  { type: "political_actor_exists", label: "Political World exists for polity", fields: ["polityId"] },
  { type: "political_actor_not_exists", label: "Political World does not exist for polity", fields: ["polityId"] },
  { type: "institution_exists", label: "Institution exists", fields: ["institutionId"] },
  { type: "institution_not_exists", label: "Institution does not exist", fields: ["institutionId"] },
  { type: "institution_has_polity", label: "Polity is in institution", fields: ["institutionId", "polityId"] },
  { type: "institution_lacks_polity", label: "Polity is not in institution", fields: ["institutionId", "polityId"] },
  { type: "institution_member_status", label: "Polity has institution status", fields: ["institutionId", "polityId", "status"] },
  { type: "polity_subordinate_to", label: "Polity is subordinate to polity", fields: ["polityId", "overlordId", "kind"] },
  { type: "polity_not_subordinate_to", label: "Polity is not subordinate to polity", fields: ["polityId", "overlordId", "kind"] },
];

const CONDITION_BY_TYPE = Object.fromEntries(CONDITION_DEFINITIONS.map((entry) => [entry.type, entry]));

const makeId = () => `scripted-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const makeEvent = () => ({
  id: makeId(),
  date: "",
  text: "",
  trigger: { mode: "rules", operator: "all", conditions: [], percent: 100 },
});
const makeCondition = () => ({ type: "polity_exists", polityId: "" });

const buttonStyle = (styles, extra = {}) => ({
  ...styles.actionButtonStyle,
  minHeight: "2rem",
  padding: "0 0.65rem",
  ...extra,
});

const selectStyle = (styles, extra = {}) => ({
  ...styles.inputStyle,
  boxSizing: "border-box",
  colorScheme: "dark",
  cursor: "pointer",
  minWidth: 0,
  ...extra,
});

const optionStyle = {
  backgroundColor: "#1a1b1f",
  color: "#f8fafc",
};

const flexibleInputStyle = (styles, extra = {}) => ({
  ...styles.inputStyle,
  boxSizing: "border-box",
  flex: "1 1 11rem",
  minWidth: 0,
  ...extra,
});

const titleCase = (value) => clean(value).replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const rulesFromTrigger = (triggerInput) => {
  const trigger = triggerInput && typeof triggerInput === "object" && !Array.isArray(triggerInput) ? triggerInput : {};
  const mode = clean(trigger.mode).toLowerCase() || "always";
  if (mode === "rules") {
    return {
      mode: "rules",
      operator: ["all", "any", "at_least"].includes(trigger.operator) ? trigger.operator : "all",
      requiredCount: Number.isFinite(Number(trigger.requiredCount)) ? Math.trunc(Number(trigger.requiredCount)) : 1,
      conditions: array(trigger.conditions),
      percent: Number.isFinite(Number(trigger.percent)) ? Math.max(0, Math.min(100, Number(trigger.percent))) : 100,
    };
  }
  if (mode === "chance") return { mode: "rules", operator: "all", requiredCount: 0, conditions: [], percent: Number.isFinite(Number(trigger.percent)) ? Math.max(0, Math.min(100, Number(trigger.percent))) : 50 };
  if (mode === "conditional") return { mode: "rules", operator: trigger.operator === "any" ? "any" : "all", requiredCount: 1, conditions: array(trigger.conditions), percent: 100 };
  return { mode: "rules", operator: "all", requiredCount: 0, conditions: [], percent: 100 };
};

const EntityField = ({ ariaLabel, id, options, placeholder, styles, value, onChange }) => {
  const shown = scriptedEventPickerLabel(value, options);
  const unresolved = Boolean(clean(value)) && !options.some((option) => option.id === value);
  return (
    <div style={{ flex: "1 1 10rem", minWidth: 0 }}>
      <input
        aria-label={ariaLabel}
        list={id}
        placeholder={placeholder}
        style={{ ...flexibleInputStyle(styles), width: "100%" }}
        title="Type to search by name. An exact canonical ID may also be entered for an advanced/future reference."
        value={shown}
        onChange={(event) => onChange(scriptedEventPickerValue(event.target.value, options))}
      />
      <datalist id={id}>
        {options.map((option) => <option key={option.id} label={option.id} value={option.label} />)}
      </datalist>
      {unresolved && (
        <div style={{ color: "rgba(251,191,36,0.78)", fontSize: "0.62rem", lineHeight: 1.35, marginTop: "0.18rem" }}>
          Custom/unresolved canonical ID: {value}
        </div>
      )}
    </div>
  );
};

const eventKey = (event, index) => clean(event?.id) || `scripted-row-${index}`;

const eventTitle = (event) => {
  const text = clean(event?.text);
  if (!text) return "Untitled scripted event";
  const firstLine = text.split(/\r?\n/)[0].trim();
  return firstLine.length > 92 ? `${firstLine.slice(0, 89)}...` : firstLine;
};

const eventRuleSummary = (event) => {
  const rules = rulesFromTrigger(event?.trigger);
  const conditions = array(rules.conditions);
  const percent = Math.max(0, Math.min(100, Number(rules.percent) || 0));
  if (!conditions.length) return `NO CONDITIONS · ${percent}%`;
  if (rules.operator === "any") return `ANY · ${conditions.length} CONDITION${conditions.length === 1 ? "" : "S"} · ${percent}%`;
  if (rules.operator === "at_least") {
    const required = Math.max(1, Math.min(conditions.length, Number(rules.requiredCount) || 1));
    return `AT LEAST ${required}/${conditions.length} · ${percent}%`;
  }
  return `ALL · ${conditions.length} CONDITION${conditions.length === 1 ? "" : "S"} · ${percent}%`;
};

const cloneScriptedEvent = (event) => ({
  ...event,
  id: makeId(),
  trigger: {
    ...rulesFromTrigger(event?.trigger),
    conditions: array(rulesFromTrigger(event?.trigger).conditions).map((condition) => ({ ...condition })),
  },
});

const ScriptedEventsEditor = ({
  value,
  scenarioValue = [],
  isGame = false,
  overridden = true,
  world = {},
  onChange,
  onUseScenarioDefault,
  onStartOverride,
  styles,
}) => {
  const events = array(value);
  const polityOptions = useMemo(() => scriptedEventPolityOptions(world), [world]);
  const institutionOptions = useMemo(() => scriptedEventInstitutionOptions(world), [world]);
  const [managerOpen, setManagerOpen] = useState(false);
  const [expandedKey, setExpandedKey] = useState("");
  const [query, setQuery] = useState("");
  const [sortDirection, setSortDirection] = useState("asc");
  const [filterMode, setFilterMode] = useState("all");

  useEffect(() => {
    if (!managerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setManagerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [managerOpen]);

  if (isGame && !overridden) {
    return (
      <div data-no-translate style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "0.65rem" }}>
        <div style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.76rem" }}>
          Following the scenario ({array(scenarioValue).length} scripted event{array(scenarioValue).length === 1 ? "" : "s"}).
        </div>
        <button type="button" className="oh-tap-row" style={{ ...buttonStyle(styles), marginTop: "0.45rem" }} onClick={onStartOverride}>
          Override for this game
        </button>
      </div>
    );
  }

  const replaceAt = (index, next) => {
    const copy = [...events];
    copy[index] = next;
    onChange(copy);
  };
  const patchEvent = (index, patch) => replaceAt(index, { ...events[index], ...patch });
  const patchRules = (index, patch) => {
    const rules = rulesFromTrigger(events[index]?.trigger);
    patchEvent(index, { trigger: { ...rules, ...patch, mode: "rules" } });
  };
  const patchCondition = (eventIndex, conditionIndex, patch) => {
    const rules = rulesFromTrigger(events[eventIndex]?.trigger);
    const conditions = [...array(rules.conditions)];
    conditions[conditionIndex] = { ...(conditions[conditionIndex] || {}), ...patch };
    patchRules(eventIndex, { conditions });
  };
  const setConditionType = (eventIndex, conditionIndex, type) => {
    const rules = rulesFromTrigger(events[eventIndex]?.trigger);
    const current = array(rules.conditions)[conditionIndex] || {};
    const definition = CONDITION_BY_TYPE[type] || CONDITION_BY_TYPE.polity_exists;
    const next = { type };
    for (const field of definition.fields) {
      if (field === "status") next.status = clean(current.status) || "member";
      else if (field === "kind") next.kind = clean(current.kind);
      else next[field] = clean(current[field]);
    }
    const conditions = [...array(rules.conditions)];
    conditions[conditionIndex] = next;
    patchRules(eventIndex, { conditions });
  };
  const addEvent = () => {
    const next = makeEvent();
    setQuery("");
    setFilterMode("all");
    setSortDirection("asc");
    onChange([...events, next]);
    setExpandedKey(next.id);
  };
  const duplicateEvent = (index) => {
    const next = cloneScriptedEvent(events[index]);
    const copy = [...events];
    copy.splice(index + 1, 0, next);
    onChange(copy);
    setExpandedKey(next.id);
  };
  const removeEvent = (index) => {
    const key = eventKey(events[index], index);
    onChange(events.filter((_, row) => row !== index));
    if (expandedKey === key) setExpandedKey("");
  };

  const datedEvents = events.map((event, index) => ({ event, index, key: eventKey(event, index) }));
  const sortedEvents = [...datedEvents].sort((a, b) => {
    const aDate = clean(a.event?.date);
    const bDate = clean(b.event?.date);
    const comparison = aDate.localeCompare(bDate) || a.index - b.index;
    return sortDirection === "desc" ? -comparison : comparison;
  });
  const normalizedQuery = clean(query).toLocaleLowerCase();
  const visibleEvents = sortedEvents.filter(({ event }) => {
    const rules = rulesFromTrigger(event?.trigger);
    const conditions = array(rules.conditions);
    if (filterMode === "unconditional" && conditions.length) return false;
    if (filterMode === "conditional" && !conditions.length) return false;
    if (filterMode === "chance" && Number(rules.percent) >= 100) return false;
    if (!normalizedQuery) return true;
    return `${event?.date || ""} ${event?.text || ""} ${eventRuleSummary(event)}`.toLocaleLowerCase().includes(normalizedQuery);
  });

  const validDates = events.map((event) => clean(event?.date)).filter(Boolean).sort();
  const rangeText = validDates.length === 0
    ? "No dates set"
    : validDates.length === 1
      ? validDates[0]
      : `${validDates[0]} → ${validDates[validDates.length - 1]}`;

  const renderEventEditor = (event, index) => {
    const rules = rulesFromTrigger(event?.trigger);
    const conditions = array(rules.conditions);
    const requiredCount = conditions.length
      ? Math.max(1, Math.min(conditions.length, Number.isFinite(Number(rules.requiredCount)) ? Math.trunc(Number(rules.requiredCount)) : 1))
      : 0;
    const conditionMode = conditions.length ? rules.operator : "none";

    return (
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", padding: "0.8rem" }}>
        <div style={{ alignItems: "stretch", display: "flex", flexWrap: "wrap", gap: "0.45rem", minWidth: 0 }}>
          <div style={{ flex: "0 1 15rem", minWidth: "10rem" }}>
            <label style={styles.fieldLabelStyle}>Date</label>
            <input
              aria-label="Event date"
              placeholder="YYYY-MM-DD"
              style={{ ...flexibleInputStyle(styles), width: "100%" }}
              value={event?.date || ""}
              onChange={(e) => patchEvent(index, { date: e.target.value })}
            />
          </div>
          <div style={{ display: "flex", flex: "1 1 auto", flexWrap: "wrap", gap: "0.4rem", justifyContent: "flex-end", marginLeft: "auto" }}>
            <button type="button" className="oh-tap-row" style={buttonStyle(styles)} onClick={() => duplicateEvent(index)}>
              Duplicate
            </button>
            <button type="button" className="oh-tap-row" style={buttonStyle(styles, { color: "#fecaca" })} onClick={() => removeEvent(index)}>
              Remove
            </button>
          </div>
        </div>

        <div style={{ marginTop: "0.55rem" }}>
          <label style={styles.fieldLabelStyle}>Event instruction</label>
          <textarea
            data-no-translate
            aria-label="Scripted event text"
            rows={4}
            maxLength={4000}
            placeholder="What happens on this date?"
            style={{ ...styles.inputStyle, boxSizing: "border-box", fontFamily: "inherit", lineHeight: 1.45, minHeight: "5.5rem", minWidth: 0, resize: "vertical", width: "100%" }}
            value={event?.text || ""}
            onChange={(e) => patchEvent(index, { text: e.target.value })}
          />
        </div>

        <section style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", marginTop: "0.65rem", minWidth: 0, padding: "0.65rem" }}>
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem", minWidth: 0 }}>
            <span style={{ color: "rgba(255,255,255,0.64)", fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase" }}>Conditions</span>
            <select
              aria-label="Condition match rule"
              style={selectStyle(styles, { flex: "0 1 auto", minWidth: "10rem", width: "auto" })}
              value={conditionMode}
              onChange={(e) => {
                const mode = e.target.value;
                if (mode === "none") {
                  patchRules(index, { operator: "all", requiredCount: 0, conditions: [] });
                  return;
                }
                patchRules(index, {
                  operator: mode,
                  requiredCount: mode === "at_least" ? 1 : rules.requiredCount,
                  conditions: conditions.length ? conditions : [makeCondition()],
                });
              }}
            >
              <option style={optionStyle} value="none">No conditions</option>
              <option style={optionStyle} value="all">All conditions</option>
              <option style={optionStyle} value="any">Any condition</option>
              <option style={optionStyle} value="at_least">At least</option>
            </select>
            {conditionMode === "at_least" && conditions.length > 0 && (
              <>
                <input
                  aria-label="Required condition count"
                  type="number"
                  min="1"
                  max={conditions.length}
                  step="1"
                  style={{ ...styles.inputStyle, boxSizing: "border-box", minWidth: 0, width: "4.5rem" }}
                  value={requiredCount}
                  onChange={(e) => patchRules(index, { requiredCount: Math.max(1, Math.min(conditions.length, Number(e.target.value) || 1)) })}
                />
                <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.72rem" }}>of {conditions.length}</span>
              </>
            )}
            {conditionMode !== "none" && (
              <button type="button" className="oh-tap-row" style={buttonStyle(styles)} onClick={() => patchRules(index, { conditions: [...conditions, makeCondition()] })}>
                + Add condition
              </button>
            )}
          </div>

          {conditionMode === "none" ? (
            <div style={{ color: "rgba(255,255,255,0.43)", fontSize: "0.72rem", lineHeight: 1.45, marginTop: "0.45rem" }}>
              No conditions - this event becomes eligible when its date is reached. Chance is still rolled once below.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "0.42rem", marginTop: "0.5rem", minWidth: 0 }}>
              {conditions.map((condition, conditionIndex) => {
                const type = clean(condition?.type) || "polity_exists";
                const definition = CONDITION_BY_TYPE[type] || CONDITION_BY_TYPE.polity_exists;
                const prefix = `scripted-${event?.id || index}-${conditionIndex}`;
                return (
                  <div key={`${event?.id || index}-condition-${conditionIndex}`} style={{ background: "rgba(0,0,0,0.14)", border: "1px solid rgba(255,255,255,0.055)", borderRadius: "9px", minWidth: 0, padding: "0.48rem" }}>
                    <div style={{ alignItems: "stretch", display: "flex", flexWrap: "wrap", gap: "0.38rem", minWidth: 0 }}>
                      <select aria-label="Condition type" style={selectStyle(styles, { flex: "1.2 1 13rem", width: "auto" })} value={definition.type} onChange={(e) => setConditionType(index, conditionIndex, e.target.value)}>
                        {CONDITION_DEFINITIONS.map((entry) => <option key={entry.type} style={optionStyle} value={entry.type}>{entry.label}</option>)}
                      </select>

                      {definition.fields.includes("institutionId") && (
                        <EntityField ariaLabel="Institution" id={`${prefix}-institution`} options={institutionOptions} placeholder="Search institution" styles={styles} value={condition?.institutionId || ""} onChange={(institutionId) => patchCondition(index, conditionIndex, { institutionId })} />
                      )}
                      {definition.fields.includes("polityId") && (
                        <EntityField ariaLabel={definition.type.includes("subordinate") ? "Subordinate polity" : "Polity"} id={`${prefix}-polity`} options={polityOptions} placeholder={definition.type.includes("subordinate") ? "Search subordinate polity" : "Search polity"} styles={styles} value={condition?.polityId || ""} onChange={(polityId) => patchCondition(index, conditionIndex, { polityId })} />
                      )}
                      {definition.fields.includes("overlordId") && (
                        <EntityField ariaLabel="Overlord polity" id={`${prefix}-overlord`} options={polityOptions} placeholder="Search overlord" styles={styles} value={condition?.overlordId || ""} onChange={(overlordId) => patchCondition(index, conditionIndex, { overlordId })} />
                      )}
                      {definition.fields.includes("status") && (
                        <select aria-label="Institution membership status" style={selectStyle(styles, { flex: "0.8 1 9rem", width: "auto" })} value={clean(condition?.status) || "member"} onChange={(e) => patchCondition(index, conditionIndex, { status: e.target.value })}>
                          {INSTITUTION_MEMBER_STATUSES.map((status) => <option key={status} style={optionStyle} value={status}>{titleCase(status)}</option>)}
                        </select>
                      )}
                      {definition.fields.includes("kind") && (
                        <select aria-label="Subordination kind" style={selectStyle(styles, { flex: "0.8 1 9rem", width: "auto" })} value={clean(condition?.kind)} onChange={(e) => patchCondition(index, conditionIndex, { kind: e.target.value })}>
                          <option style={optionStyle} value="">Any relationship</option>
                          {PUPPET_KINDS.map((kind) => <option key={kind} style={optionStyle} value={kind}>{titleCase(puppetKindLabel(kind))}</option>)}
                        </select>
                      )}
                      <button type="button" className="oh-tap-row" style={buttonStyle(styles, { color: "#fecaca", flex: "0 0 auto" })} onClick={() => patchRules(index, { conditions: conditions.filter((_, row) => row !== conditionIndex) })}>
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", marginTop: "0.65rem", padding: "0.65rem" }}>
          <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
            <div>
              <div style={{ color: "rgba(255,255,255,0.66)", fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase" }}>Chance after conditions pass</div>
              <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.66rem", marginTop: "0.16rem" }}>Rolled once when due, then persisted. No save/reload rerolls.</div>
            </div>
            <div style={{ alignItems: "center", display: "flex", gap: "0.3rem" }}>
              <input
                aria-label="Event chance percent"
                type="number"
                min="0"
                max="100"
                step="1"
                style={{ ...styles.inputStyle, boxSizing: "border-box", minWidth: 0, textAlign: "right", width: "5.5rem" }}
                value={rules.percent}
                onChange={(e) => patchRules(index, { percent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              />
              <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.76rem" }}>%</span>
            </div>
          </div>
          <input
            aria-label="Event chance slider"
            type="range"
            min="0"
            max="100"
            step="1"
            style={{ accentColor: "#a1a1aa", cursor: "pointer", marginTop: "0.65rem", width: "100%" }}
            value={rules.percent}
            onChange={(e) => patchRules(index, { percent: Number(e.target.value) })}
          />
        </section>
      </div>
    );
  };

  const manager = managerOpen && typeof document !== "undefined" ? createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scripted Events manager"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setManagerOpen(false);
      }}
      style={{ alignItems: "center", background: "rgba(6,6,7,0.78)", backdropFilter: "blur(14px)", display: "flex", inset: 0, justifyContent: "center", padding: "clamp(0.55rem, 2vw, 1.25rem)", position: "fixed", zIndex: 2147483200 }}
    >
      <div style={{ background: "rgba(24,24,27,0.98)", border: "1px solid rgba(255,255,255,0.11)", borderRadius: "20px", boxShadow: "0 24px 70px rgba(0,0,0,0.5)", color: "#fff", display: "flex", flexDirection: "column", fontFamily: "sans-serif", maxHeight: "calc(100vh - 1.5rem)", minHeight: "min(42rem, calc(100vh - 1.5rem))", overflow: "hidden", width: "min(76rem, calc(100vw - 1.1rem))" }}>
        <header style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: "0.8rem", justifyContent: "space-between", padding: "0.9rem 1rem" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.65rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Scenario authoring</div>
            <div style={{ fontSize: "1.15rem", fontWeight: 850, letterSpacing: "-0.025em", marginTop: "0.12rem" }}>Scripted Events</div>
            <div style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.7rem", marginTop: "0.16rem" }}>{events.length} event{events.length === 1 ? "" : "s"} · {rangeText}</div>
          </div>
          <button aria-label="Close scripted events manager" type="button" className="oh-tap" style={buttonStyle(styles, { background: "rgba(255,255,255,0.04)", fontSize: "1rem", minWidth: "2.35rem", padding: 0 })} onClick={() => setManagerOpen(false)}>×</button>
        </header>

        <div style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", flexWrap: "wrap", gap: "0.5rem", padding: "0.7rem 1rem" }}>
          <input aria-label="Search scripted events" placeholder="Search date or event text..." style={{ ...styles.inputStyle, boxSizing: "border-box", flex: "2 1 18rem", minWidth: "12rem" }} value={query} onChange={(event) => setQuery(event.target.value)} />
          <select aria-label="Filter scripted events" style={selectStyle(styles, { flex: "0 1 11rem", width: "auto" })} value={filterMode} onChange={(event) => setFilterMode(event.target.value)}>
            <option style={optionStyle} value="all">All events</option>
            <option style={optionStyle} value="unconditional">No conditions</option>
            <option style={optionStyle} value="conditional">Has conditions</option>
            <option style={optionStyle} value="chance">Chance below 100%</option>
          </select>
          <select aria-label="Sort scripted events" style={selectStyle(styles, { flex: "0 1 11rem", width: "auto" })} value={sortDirection} onChange={(event) => setSortDirection(event.target.value)}>
            <option style={optionStyle} value="asc">Date ↑</option>
            <option style={optionStyle} value="desc">Date ↓</option>
          </select>
          <button type="button" className="oh-tap-row" style={buttonStyle(styles, { background: "rgba(255,255,255,0.09)" })} onClick={addEvent}>+ Add event</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem 1rem 1rem" }}>
          <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", color: "rgba(255,255,255,0.52)", fontSize: "0.7rem", lineHeight: 1.45, marginBottom: "0.65rem", padding: "0.55rem 0.65rem" }}>
            Conditions are checked once when an event becomes due. If they pass, chance is rolled once and persisted. No conditions + 100% is the old Always behavior.
          </div>

          {visibleEvents.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.78rem", padding: "2rem 0", textAlign: "center" }}>
              {events.length ? "No scripted events match this view." : "No scripted events yet."}
            </div>
          ) : (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {visibleEvents.map(({ event, index, key }) => {
                const expanded = expandedKey === key;
                return (
                  <article key={key} style={{ background: expanded ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.025)", border: `1px solid ${expanded ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.075)"}`, borderRadius: "13px", overflow: "hidden" }}>
                    <button
                      type="button"
                      className="oh-tap-row"
                      aria-expanded={expanded}
                      onClick={() => setExpandedKey(expanded ? "" : key)}
                      style={{ alignItems: "center", background: "transparent", border: 0, color: "#fff", cursor: "pointer", display: "grid", gap: "0.65rem", gridTemplateColumns: "auto minmax(0, 1fr) auto", padding: "0.7rem 0.8rem", textAlign: "left", width: "100%" }}
                    >
                      <span aria-hidden="true" style={{ color: "rgba(255,255,255,0.46)", fontSize: "0.75rem", transform: expanded ? "rotate(90deg)" : "none", transition: "transform 120ms ease" }}>▶</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
                          <span style={{ color: "rgba(255,255,255,0.78)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "0.68rem", fontWeight: 800 }}>{clean(event?.date) || "No date"}</span>
                          <span style={{ fontSize: "0.79rem", fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{eventTitle(event)}</span>
                        </span>
                        <span style={{ color: "rgba(255,255,255,0.42)", display: "block", fontSize: "0.61rem", fontWeight: 800, letterSpacing: "0.045em", marginTop: "0.22rem" }}>{eventRuleSummary(event)}</span>
                      </span>
                      <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.66rem", fontWeight: 700 }}>{expanded ? "Collapse" : "Edit"}</span>
                    </button>
                    {expanded && renderEventEditor(event, index)}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div data-no-translate style={{ minWidth: 0 }}>
      <div style={{ alignItems: "center", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", display: "flex", flexWrap: "wrap", gap: "0.7rem", justifyContent: "space-between", padding: "0.72rem 0.75rem" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "rgba(255,255,255,0.9)", fontSize: "0.82rem", fontWeight: 800 }}>{events.length} scripted event{events.length === 1 ? "" : "s"}</div>
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.68rem", marginTop: "0.18rem" }}>{rangeText}</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
          {isGame && overridden && (
            <button type="button" className="oh-tap-row" style={buttonStyle(styles)} onClick={onUseScenarioDefault}>Use scenario default</button>
          )}
          <button type="button" className="oh-tap-row" style={buttonStyle(styles, { background: "rgba(255,255,255,0.09)" })} onClick={() => setManagerOpen(true)}>Manage scripted events</button>
        </div>
      </div>
      {manager}
    </div>
  );
};

export default ScriptedEventsEditor;
