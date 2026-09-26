/*! Open Historia — structured scenario scripted-event authoring © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React from "react";

const clean = (value) => String(value ?? "").trim();
const array = (value) => Array.isArray(value) ? value : [];

const CONDITION_TYPES = [
  "polity_exists",
  "polity_not_exists",
  "war_active",
  "war_not_active",
  "institution_exists",
  "institution_not_exists",
  "institution_has_polity",
  "institution_lacks_polity",
];

const conditionLabel = (value) => {
  const words = String(value ?? "").replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
};

const makeId = () => `scripted-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const makeEvent = () => ({
  id: makeId(),
  date: "",
  text: "",
  trigger: { mode: "always" },
});
const makeCondition = () => ({ type: "polity_exists", polityId: "" });

const buttonStyle = (styles, extra = {}) => ({
  ...styles.actionButtonStyle,
  minHeight: "2rem",
  padding: "0 0.65rem",
  ...extra,
});

const optionStyle = {
  backgroundColor: "#ffffff",
  color: "#111827",
};

const fieldStyle = (styles, extra = {}) => ({
  ...styles.inputStyle,
  boxSizing: "border-box",
  minWidth: 0,
  width: "100%",
  ...extra,
});

const ScriptedEventsEditor = ({
  value,
  scenarioValue = [],
  isGame = false,
  overridden = true,
  onChange,
  onUseScenarioDefault,
  onStartOverride,
  styles,
}) => {
  const events = array(value);

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
  const patchTrigger = (index, patch) => {
    const current = events[index] || {};
    patchEvent(index, { trigger: { ...(current.trigger || { mode: "always" }), ...patch } });
  };
  const setMode = (index, mode) => {
    if (mode === "chance") patchEvent(index, { trigger: { mode, percent: 50 } });
    else if (mode === "conditional") patchEvent(index, { trigger: { mode, operator: "all", conditions: [] } });
    else patchEvent(index, { trigger: { mode: "always" } });
  };
  const patchCondition = (eventIndex, conditionIndex, patch) => {
    const trigger = events[eventIndex]?.trigger || {};
    const conditions = [...array(trigger.conditions)];
    conditions[conditionIndex] = { ...(conditions[conditionIndex] || {}), ...patch };
    patchTrigger(eventIndex, { conditions });
  };

  return (
    <div data-no-translate style={{ minWidth: 0 }}>
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem", justifyContent: "space-between", minWidth: 0 }}>
        <div style={{ color: "rgba(255,255,255,0.55)", flex: "1 1 18rem", fontSize: "0.74rem", lineHeight: 1.45, minWidth: 0 }}>
          Dated historical beats. Always events preserve the old behavior; Chance and Conditional events resolve once when their date is reached.
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
          const trigger = event?.trigger || { mode: "always" };
          const mode = ["always", "chance", "conditional"].includes(trigger.mode) ? trigger.mode : "always";
          return (
            <div key={event?.id || index} style={{ background: "rgba(0,0,0,0.16)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "12px", minWidth: 0, padding: "0.65rem" }}>
              <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem", minWidth: 0 }}>
                <input
                  aria-label="Event date"
                  placeholder="YYYY-MM-DD"
                  style={{ ...fieldStyle(styles), flex: "1 1 11rem" }}
                  value={event?.date || ""}
                  onChange={(e) => patchEvent(index, { date: e.target.value })}
                />
                <select aria-label="Trigger" style={{ ...fieldStyle(styles, { flex: "1 1 11rem" }) }} value={mode} onChange={(e) => setMode(index, e.target.value)}>
                  <option value="always" style={optionStyle}>Always</option>
                  <option value="chance" style={optionStyle}>Chance</option>
                  <option value="conditional" style={optionStyle}>Conditional</option>
                </select>
                <button
                  type="button"
                  className="oh-tap-row"
                  style={buttonStyle(styles, { color: "#fecaca", flexShrink: 0, whiteSpace: "nowrap" })}
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
                style={{ ...fieldStyle(styles, { fontFamily: "inherit", lineHeight: 1.45, marginTop: "0.45rem", minHeight: "4.5rem", resize: "vertical" }) }}
                value={event?.text || ""}
                onChange={(e) => patchEvent(index, { text: e.target.value })}
              />

              {mode === "chance" && (
                <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem", marginTop: "0.45rem", minWidth: 0 }}>
                  <span style={{ color: "rgba(255,255,255,0.66)", fontSize: "0.76rem" }}>Chance</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    style={{ ...fieldStyle(styles, { width: "6rem", flex: "0 0 6rem" }) }}
                    value={Number.isFinite(Number(trigger.percent)) ? trigger.percent : 50}
                    onChange={(e) => patchTrigger(index, { percent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                  />
                  <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.76rem" }}>% - rolled once when due</span>
                </div>
              )}

              {mode === "conditional" && (
                <div style={{ background: "rgba(255,255,255,0.025)", borderRadius: "9px", marginTop: "0.5rem", minWidth: 0, padding: "0.5rem" }}>
                  <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.4rem", minWidth: 0 }}>
                    <span style={{ color: "rgba(255,255,255,0.64)", fontSize: "0.76rem" }}>Match</span>
                    <select
                      style={{ ...fieldStyle(styles, { flex: "0 1 auto", width: "auto" }) }}
                      value={trigger.operator === "any" ? "any" : "all"}
                      onChange={(e) => patchTrigger(index, { operator: e.target.value })}
                    >
                      <option value="all" style={optionStyle}>All conditions</option>
                      <option value="any" style={optionStyle}>Any condition</option>
                    </select>
                    <button
                      type="button"
                      className="oh-tap-row"
                      style={buttonStyle(styles)}
                      onClick={() => patchTrigger(index, { conditions: [...array(trigger.conditions), makeCondition()] })}
                    >
                      + Add condition
                    </button>
                  </div>

                  <div style={{ display: "grid", gap: "0.4rem", marginTop: "0.45rem", minWidth: 0 }}>
                    {array(trigger.conditions).map((condition, conditionIndex) => {
                      const type = clean(condition?.type) || "polity_exists";
                      const needsPolity = ["polity_exists", "polity_not_exists", "institution_has_polity", "institution_lacks_polity"].includes(type);
                      const needsWar = ["war_active", "war_not_active"].includes(type);
                      const needsInstitution = ["institution_exists", "institution_not_exists", "institution_has_polity", "institution_lacks_polity"].includes(type);
                      return (
                        <div key={`${event?.id || index}-condition-${conditionIndex}`} style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem", minWidth: 0 }}>
                          <select style={{ ...fieldStyle(styles, { flex: "1.3 1 12rem" }) }} value={type} onChange={(e) => {
                            const nextType = e.target.value;
                            patchCondition(index, conditionIndex, {
                              type: nextType,
                              polityId: nextType.includes("polity") ? condition?.polityId || "" : "",
                              warId: nextType.includes("war") ? condition?.warId || "" : "",
                              institutionId: nextType.includes("institution") ? condition?.institutionId || "" : "",
                            });
                          }}>
                            {CONDITION_TYPES.map((value) => <option key={value} value={value} style={optionStyle}>{conditionLabel(value)}</option>)}
                          </select>
                          <input
                            aria-label="Primary condition id"
                            placeholder={needsWar ? "War ID" : needsInstitution ? "Institution ID" : "Polity ID"}
                            style={{ ...fieldStyle(styles, { flex: "1 1 9rem" }) }}
                            value={needsWar ? condition?.warId || "" : needsInstitution ? condition?.institutionId || "" : condition?.polityId || ""}
                            onChange={(e) => patchCondition(index, conditionIndex, needsWar
                              ? { warId: e.target.value }
                              : needsInstitution
                                ? { institutionId: e.target.value }
                                : { polityId: e.target.value })}
                          />
                          {needsInstitution && needsPolity && (
                            <input
                              aria-label="Polity ID"
                              placeholder="Polity ID"
                              style={{ ...fieldStyle(styles, { flex: "1 1 9rem" }) }}
                              value={condition?.polityId || ""}
                              onChange={(e) => patchCondition(index, conditionIndex, { polityId: e.target.value })}
                            />
                          )}
                          <button
                            type="button"
                            className="oh-tap-row"
                            style={buttonStyle(styles, { color: "#fecaca", flexShrink: 0, whiteSpace: "nowrap" })}
                            onClick={() => patchTrigger(index, { conditions: array(trigger.conditions).filter((_, row) => row !== conditionIndex) })}
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                    {array(trigger.conditions).length === 0 && (
                      <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.74rem" }}>
                        No conditions means this event will fail closed and be skipped.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ScriptedEventsEditor;
