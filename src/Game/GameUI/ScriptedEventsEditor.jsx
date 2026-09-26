/*! Open Historia — structured scenario scripted-event authoring © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { useMemo } from "react";
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

  return (
    <div data-no-translate style={{ minWidth: 0 }}>
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem", justifyContent: "space-between", minWidth: 0 }}>
        <div style={{ color: "rgba(255,255,255,0.55)", flex: "1 1 16rem", fontSize: "0.74rem", lineHeight: 1.45, minWidth: 0 }}>
          Dated historical beats. Conditions are checked once when due; if they pass, the chance is rolled once. No conditions with 100% chance is the old Always behavior.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
          {isGame && overridden && (
            <button type="button" className="oh-tap-row" style={buttonStyle(styles)} onClick={onUseScenarioDefault}>
              Use scenario default
            </button>
          )}
          <button type="button" className="oh-tap-row" style={buttonStyle(styles)} onClick={() => onChange([...events, makeEvent()])}>
            + Add scripted event
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gap: "0.55rem", marginTop: "0.55rem", minWidth: 0 }}>
        {events.length === 0 && (
          <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.76rem", padding: "0.3rem 0" }}>
            No scripted events.
          </div>
        )}
        {events.map((event, index) => {
          const rules = rulesFromTrigger(event?.trigger);
          const conditions = array(rules.conditions);
          const requiredCount = conditions.length
            ? Math.max(1, Math.min(conditions.length, Number.isFinite(Number(rules.requiredCount)) ? Math.trunc(Number(rules.requiredCount)) : 1))
            : 0;
          return (
            <div key={event?.id || index} style={{ background: "rgba(0,0,0,0.16)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "12px", minWidth: 0, padding: "0.65rem" }}>
              <div style={{ alignItems: "stretch", display: "flex", flexWrap: "wrap", gap: "0.45rem", minWidth: 0 }}>
                <input
                  aria-label="Event date"
                  placeholder="YYYY-MM-DD"
                  style={{ ...flexibleInputStyle(styles), maxWidth: "15rem" }}
                  value={event?.date || ""}
                  onChange={(e) => patchEvent(index, { date: e.target.value })}
                />
                <button
                  type="button"
                  className="oh-tap-row"
                  style={buttonStyle(styles, { color: "#fecaca", flex: "0 0 auto", marginLeft: "auto" })}
                  onClick={() => onChange(events.filter((_, row) => row !== index))}
                >
                  Remove
                </button>
              </div>

              <textarea
                data-no-translate
                aria-label="Scripted event text"
                rows={3}
                maxLength={4000}
                placeholder="What happens on this date?"
                style={{ ...styles.inputStyle, boxSizing: "border-box", fontFamily: "inherit", lineHeight: 1.45, marginTop: "0.45rem", minHeight: "4.5rem", minWidth: 0, resize: "vertical", width: "100%" }}
                value={event?.text || ""}
                onChange={(e) => patchEvent(index, { text: e.target.value })}
              />

              <div style={{ background: "rgba(255,255,255,0.025)", borderRadius: "9px", marginTop: "0.5rem", minWidth: 0, padding: "0.5rem" }}>
                <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.4rem", minWidth: 0 }}>
                  <span style={{ color: "rgba(255,255,255,0.64)", fontSize: "0.76rem", fontWeight: 700 }}>Conditions</span>
                  <select
                    aria-label="Condition match rule"
                    style={selectStyle(styles, { flex: "0 1 auto", minWidth: "9rem", width: "auto" })}
                    value={rules.operator}
                    onChange={(e) => patchRules(index, { operator: e.target.value })}
                  >
                    <option style={optionStyle} value="all">All conditions</option>
                    <option style={optionStyle} value="any">Any condition</option>
                    <option style={optionStyle} value="at_least">At least</option>
                  </select>
                  {rules.operator === "at_least" && conditions.length > 0 && (
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
                  <button
                    type="button"
                    className="oh-tap-row"
                    style={buttonStyle(styles)}
                    onClick={() => patchRules(index, { conditions: [...conditions, makeCondition()] })}
                  >
                    + Add condition
                  </button>
                </div>

                <div style={{ display: "grid", gap: "0.4rem", marginTop: "0.45rem", minWidth: 0 }}>
                  {conditions.map((condition, conditionIndex) => {
                    const type = clean(condition?.type) || "polity_exists";
                    const definition = CONDITION_BY_TYPE[type] || CONDITION_BY_TYPE.polity_exists;
                    const prefix = `scripted-${event?.id || index}-${conditionIndex}`;
                    return (
                      <div key={`${event?.id || index}-condition-${conditionIndex}`} style={{ background: "rgba(0,0,0,0.12)", border: "1px solid rgba(255,255,255,0.055)", borderRadius: "8px", minWidth: 0, padding: "0.42rem" }}>
                        <div style={{ alignItems: "stretch", display: "flex", flexWrap: "wrap", gap: "0.35rem", minWidth: 0 }}>
                          <select
                            aria-label="Condition type"
                            style={selectStyle(styles, { flex: "1.2 1 13rem", width: "auto" })}
                            value={definition.type}
                            onChange={(e) => setConditionType(index, conditionIndex, e.target.value)}
                          >
                            {CONDITION_DEFINITIONS.map((entry) => <option key={entry.type} style={optionStyle} value={entry.type}>{entry.label}</option>)}
                          </select>

                          {definition.fields.includes("institutionId") && (
                            <EntityField
                              ariaLabel="Institution"
                              id={`${prefix}-institution`}
                              options={institutionOptions}
                              placeholder="Search institution"
                              styles={styles}
                              value={condition?.institutionId || ""}
                              onChange={(institutionId) => patchCondition(index, conditionIndex, { institutionId })}
                            />
                          )}
                          {definition.fields.includes("polityId") && (
                            <EntityField
                              ariaLabel={definition.type.includes("subordinate") ? "Subordinate polity" : "Polity"}
                              id={`${prefix}-polity`}
                              options={polityOptions}
                              placeholder={definition.type.includes("subordinate") ? "Search subordinate polity" : "Search polity"}
                              styles={styles}
                              value={condition?.polityId || ""}
                              onChange={(polityId) => patchCondition(index, conditionIndex, { polityId })}
                            />
                          )}
                          {definition.fields.includes("overlordId") && (
                            <EntityField
                              ariaLabel="Overlord polity"
                              id={`${prefix}-overlord`}
                              options={polityOptions}
                              placeholder="Search overlord"
                              styles={styles}
                              value={condition?.overlordId || ""}
                              onChange={(overlordId) => patchCondition(index, conditionIndex, { overlordId })}
                            />
                          )}
                          {definition.fields.includes("status") && (
                            <select
                              aria-label="Institution membership status"
                              style={selectStyle(styles, { flex: "0.8 1 9rem", width: "auto" })}
                              value={clean(condition?.status) || "member"}
                              onChange={(e) => patchCondition(index, conditionIndex, { status: e.target.value })}
                            >
                              {INSTITUTION_MEMBER_STATUSES.map((status) => <option key={status} style={optionStyle} value={status}>{titleCase(status)}</option>)}
                            </select>
                          )}
                          {definition.fields.includes("kind") && (
                            <select
                              aria-label="Subordination kind"
                              style={selectStyle(styles, { flex: "0.8 1 9rem", width: "auto" })}
                              value={clean(condition?.kind)}
                              onChange={(e) => patchCondition(index, conditionIndex, { kind: e.target.value })}
                            >
                              <option style={optionStyle} value="">Any relationship</option>
                              {PUPPET_KINDS.map((kind) => <option key={kind} style={optionStyle} value={kind}>{titleCase(puppetKindLabel(kind))}</option>)}
                            </select>
                          )}
                          <button
                            type="button"
                            className="oh-tap-row"
                            style={buttonStyle(styles, { color: "#fecaca", flex: "0 0 auto" })}
                            onClick={() => patchRules(index, { conditions: conditions.filter((_, row) => row !== conditionIndex) })}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {conditions.length === 0 && (
                    <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.74rem" }}>
                      No conditions - this event is eligible whenever its date is reached.
                    </div>
                  )}
                </div>
              </div>

              <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem", marginTop: "0.5rem" }}>
                <span style={{ color: "rgba(255,255,255,0.66)", fontSize: "0.76rem", fontWeight: 700 }}>Chance after conditions pass</span>
                <input
                  aria-label="Event chance percent"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  style={{ ...styles.inputStyle, boxSizing: "border-box", minWidth: 0, width: "6rem" }}
                  value={rules.percent}
                  onChange={(e) => patchRules(index, { percent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                />
                <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.76rem" }}>% - rolled once, then persisted</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ScriptedEventsEditor;
