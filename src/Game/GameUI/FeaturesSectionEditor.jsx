/*! Open Historia — the Features tab of the scenario and game editors © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React from "react";
import { useTouchPrimary } from "../../runtime/mobileUi.js";
import ScriptedEventsEditor from "./ScriptedEventsEditor.jsx";
import {
  FEATURE_DEFINITIONS,
  normalizeFeatureSettings,
  normalizeScriptedEvents,
  resolveFeatures,
} from "../../runtime/gameFeatures.js";
import { reviewScriptedEvents } from "../AI/worldDirection.js";

const IGNORED_LINE_REASONS = {
  "no-date": "No date at the start of this line (YYYY-MM-DD), so it is ignored.",
  "no-text": "This line has a date but nothing after it, so it is ignored.",
};

// Under the Scripted events box: how many beats the engine will use, and each
// line it will not, so a mistyped date is not lost without anyone knowing.
const ScriptedEventsCheck = ({ text, currentDate, includeOrigin, isGame }) => {
  const { count, ignored } = reviewScriptedEvents(text, { currentDate, includeOrigin });
  if (!count && !ignored.length) return null;
  const passedReason = isGame
    ? "This date has already passed in this game, so no time skip will reach it."
    : "This date is before the scenario starts, so no time skip will reach it.";
  return (
    <div style={{ display: "grid", gap: "0.3rem", marginTop: "0.35rem" }}>
      <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.74rem" }}>
        {count === 1 ? "1 beat recognised" : `${count} beats recognised`}
      </div>
      {ignored.map((entry, index) => (
        <div key={`${index}:${entry.line}`} style={{ borderLeft: "2px solid rgba(251,191,36,0.6)", paddingLeft: "0.5rem" }}>
          <div style={{ color: "#fde68a", fontSize: "0.72rem" }}>
            {entry.problem === "passed" ? passedReason : IGNORED_LINE_REASONS[entry.problem]}
          </div>
          <div data-no-translate style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.72rem", overflowWrap: "anywhere" }}>{entry.line}</div>
        </div>
      ))}
    </div>
  );
};

// A scenario edits its complete configuration: what every game made from it
// starts with. A game edits only overrides: each control has a "Scenario
// default" state that keeps following the scenario, including changes made to
// the scenario later. `features` is therefore the complete object for a
// scenario and the sparse override object for a game.
//
// `currentDate` is the game's date (the scenario's start in its own editor),
// and `firstSkipAhead` says the next skip is the game's first, which covers
// that day too: what the Scripted events check measures a beat against.
// `world` is the world a scripted event's conditions pick their polities and
// institutions from (ScriptedEventsEditor).
const FeaturesSectionEditor = ({ kind, features, scenarioFeatures, world, onChange, styles, currentDate = "", firstSkipAhead = true }) => {
  const isGame = kind === "game";
  const base = normalizeFeatureSettings(scenarioFeatures);
  const effective = isGame ? resolveFeatures(scenarioFeatures, features) : normalizeFeatureSettings(features);
  const overrides = isGame ? (features ?? {}) : effective;
  // On a touch screen every choice is a finger's height (.oh-tap-row), which an
  // inline min-height would pin smaller: there the class sets it.
  const touch = useTouchPrimary();

  // A game's patch with `undefined` values removes those overrides.
  const setFeature = (key, patch) => {
    if (!isGame) {
      onChange({ ...effective, [key]: { ...effective[key], ...patch } });
      return;
    }
    const current = { ...(overrides[key] ?? {}) };
    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) delete current[field];
      else current[field] = value;
    }
    const next = { ...overrides };
    if (Object.keys(current).length) next[key] = current;
    else delete next[key];
    onChange(next);
  };

  const choice = (active) => ({
    ...styles.actionButtonStyle,
    background: active ? "rgba(0,0,0,0.42)" : "rgba(255,255,255,0.04)",
    borderColor: active ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)",
    minHeight: touch ? undefined : "2rem",
    padding: "0 0.7rem",
  });

  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.95rem", padding: "0.9rem" }}>
      <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.82rem", lineHeight: 1.5, marginBottom: "0.85rem" }}>
        {isGame
          ? "What this game plays with. Anything left on the scenario default follows the scenario, including changes made to it later; On and Off are this game's own choice."
          : "What games made from this scenario play with. Each game can override these in its own editor."}
      </div>
      <div style={{ display: "grid", gap: "0.7rem" }}>
        {FEATURE_DEFINITIONS.map((definition) => {
          const override = overrides[definition.key] ?? {};
          const enabledState = !isGame
            ? (effective[definition.key].enabled ? "on" : "off")
            : override.enabled === undefined ? "default" : override.enabled ? "on" : "off";
          const scenarioSays = base[definition.key].enabled ? "On" : "Off";
          return (
            <div key={definition.key} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "0.72rem 0.78rem" }}>
              <div style={{ alignItems: "flex-start", display: "flex", flexWrap: "wrap", gap: "0.6rem", justifyContent: "space-between" }}>
                <div style={{ flex: "1 1 14rem", minWidth: 0 }}>
                  <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>{definition.label}</div>
                  <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.78rem", lineHeight: 1.45, marginTop: "0.15rem" }}>{definition.description}</div>
                </div>
{/* A feature with no on/off (Player focus) is a choice, not a switch. */}
                {definition.toggleable !== false && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {isGame && (
                    <button type="button" className="oh-tap-row" style={choice(enabledState === "default")} onClick={() => setFeature(definition.key, { enabled: undefined })}>
                      Scenario default ({scenarioSays})
                    </button>
                  )}
                  <button type="button" className="oh-tap-row" style={choice(enabledState === "on")} onClick={() => setFeature(definition.key, { enabled: true })}>On</button>
                  <button type="button" className="oh-tap-row" style={choice(enabledState === "off")} onClick={() => setFeature(definition.key, { enabled: false })}>Off</button>
                </div>
                )}
              </div>
              {definition.settings.length > 0 && (
                <div style={{ display: "grid", gap: "0.6rem", marginTop: "0.6rem" }}>
                  {definition.settings.map((setting) => {
                    const overridden = isGame && override[setting.key] !== undefined;
                    const value = isGame ? (override[setting.key] ?? "") : effective[definition.key][setting.key];
                    if (setting.type === "scripted-events") {
                      const scenarioEvents = normalizeScriptedEvents(base[definition.key][setting.key]);
                      const raw = features?.[definition.key]?.[setting.key];
                      const shownEvents = Array.isArray(raw)
                        ? raw
                        : normalizeScriptedEvents(raw ?? (isGame ? scenarioEvents : value));
                      const cloneScenario = () => scenarioEvents.map((event) => ({
                        ...event,
                        trigger: {
                          ...(event.trigger || {}),
                          conditions: Array.isArray(event.trigger?.conditions)
                            ? event.trigger.conditions.map((condition) => ({ ...condition }))
                            : event.trigger?.conditions,
                        },
                        outcomes: Array.isArray(event.outcomes) ? event.outcomes.map((outcome) => ({ ...outcome })) : event.outcomes,
                      }));
                      return (
                        <div key={setting.key}>
                          <label style={styles.fieldLabelStyle}>{setting.label}</label>
                          <ScriptedEventsEditor
                            value={shownEvents}
                            scenarioValue={scenarioEvents}
                            isGame={isGame}
                            overridden={!isGame || overridden}
                            world={world}
                            styles={styles}
                            onChange={(next) => setFeature(definition.key, { [setting.key]: next })}
                            onUseScenarioDefault={() => setFeature(definition.key, { [setting.key]: undefined })}
                            onStartOverride={() => setFeature(definition.key, { [setting.key]: cloneScenario() })}
                          />
                          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.72rem", marginTop: "0.3rem" }}>{setting.description}</div>
                        </div>
                      );
                    }
                    // A choice of named levels (Player focus). One button per
                    // option, and on a game a "Scenario default" button beside
                    // them, exactly as the on/off row above reads.
                    if (setting.type === "choice") {
                      const scenarioChoice = String(base[definition.key][setting.key] ?? setting.defaultValue);
                      const scenarioLabel = setting.options.find((option) => option.value === scenarioChoice)?.label ?? scenarioChoice;
                      const selected = isGame ? (override[setting.key] ?? "") : String(effective[definition.key][setting.key] ?? "");
                      const shown = setting.options.find((option) => option.value === (selected || scenarioChoice));
                      return (
                        <div key={setting.key}>
                          <label style={styles.fieldLabelStyle}>{setting.label}</label>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                            {isGame && (
                              <button type="button" className="oh-tap-row" style={choice(!overridden)} onClick={() => setFeature(definition.key, { [setting.key]: undefined })}>
                                Scenario default ({scenarioLabel})
                              </button>
                            )}
                            {setting.options.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className="oh-tap-row"
                                style={choice(selected === option.value || (!isGame && effective[definition.key][setting.key] === option.value))}
                                onClick={() => setFeature(definition.key, { [setting.key]: option.value })}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.72rem", marginTop: "0.3rem" }}>
                            {shown?.description ? `${shown.label}: ${shown.description} ` : ""}{setting.description}
                          </div>
                        </div>
                      );
                    }
                    // A text setting (the director's priority rules). A game's
                    // blank follows the scenario, exactly as a blank number does.
                    if (setting.type === "text") {
                      const scenarioText = String(base[definition.key][setting.key] ?? "");
                      // Shown as TYPED, not as normalized: the normalizer trims, and
                      // a field that trims on every keystroke cannot hold the space
                      // between two words. The store trims when it saves.
                      const typed = features?.[definition.key]?.[setting.key];
                      const shown = typeof typed === "string" ? typed : value;
                      return (
                        <div key={setting.key}>
                          <label style={styles.fieldLabelStyle}>{setting.label}</label>
                          <textarea
                            data-no-translate
                            rows={setting.rows || 4}
                            maxLength={setting.maxLength || 2000}
                            style={{ ...styles.inputStyle, fontFamily: "inherit", lineHeight: 1.45, minHeight: "5rem", resize: "vertical", width: "100%" }}
                            value={shown}
                            placeholder={isGame ? (scenarioText || "Following the scenario, which sets none") : ""}
                            onChange={(event) => {
                              const raw = event.target.value;
                              setFeature(definition.key, { [setting.key]: isGame && raw.trim() === "" ? undefined : raw });
                            }}
                          />
                          {isGame && (
                            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.3rem" }}>
                              <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.74rem" }}>
                                {overridden ? "This game's own rules replace the scenario's." : "Following the scenario"}
                              </span>
                              {overridden && (
                                <button type="button" className="oh-tap-row" style={{ ...choice(false), minHeight: touch ? undefined : "1.7rem", padding: "0 0.55rem" }} onClick={() => setFeature(definition.key, { [setting.key]: undefined })}>
                                  Use scenario default
                                </button>
                              )}
                            </div>
                          )}
                          {definition.key === "direction" && setting.key === "scriptedEvents" && (
                            <ScriptedEventsCheck
                              text={shown || (isGame ? scenarioText : "")}
                              currentDate={currentDate}
                              includeOrigin={firstSkipAhead}
                              isGame={isGame}
                            />
                          )}
                          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.72rem", marginTop: "0.3rem" }}>{setting.description}</div>
                        </div>
                      );
                    }
                    // A scenario's number is shown as TYPED, like its text: the
                    // normalized value clamps and rounds, so each keystroke of
                    // "60" into a 40..250 field read 40, then 400 → 250. The raw
                    // text is kept while typing (the store normalizes on save)
                    // and settles to the clamped value when the field is left.
                    const typedNumber = isGame ? undefined : features?.[definition.key]?.[setting.key];
                    const shownNumber = typeof typedNumber === "string" ? typedNumber : value;
                    return (
                      <div key={setting.key}>
                        <label style={styles.fieldLabelStyle}>{setting.label}</label>
                        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                          <input
                            type="number"
                            min={setting.min}
                            max={setting.max}
                            step={setting.step}
                            style={{ ...styles.inputStyle, width: "7rem" }}
                            value={shownNumber}
                            placeholder={isGame ? String(base[definition.key][setting.key]) : ""}
                            onChange={(event) => {
                              const raw = event.target.value;
                              if (isGame && raw === "") { setFeature(definition.key, { [setting.key]: undefined }); return; }
                              if (!isGame) { setFeature(definition.key, { [setting.key]: raw }); return; }
                              const next = Number(raw);
                              if (Number.isFinite(next)) setFeature(definition.key, { [setting.key]: next });
                            }}
                            onBlur={() => {
                              // effective holds the setting normalized: clamped, rounded, a
                              // blank back to the scenario's value or the default.
                              if (!isGame && typeof typedNumber === "string") setFeature(definition.key, { [setting.key]: effective[definition.key][setting.key] });
                              else if (overridden && effective[definition.key][setting.key] !== override[setting.key]) setFeature(definition.key, { [setting.key]: effective[definition.key][setting.key] });
                            }}
                          />
                          <span style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.8rem" }}>{setting.unit}</span>
                          {isGame && (
                            <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.74rem" }}>
                              {overridden ? `Scenario default: ${base[definition.key][setting.key]}` : "Following the scenario"}
                            </span>
                          )}
                          {overridden && (
                            <button type="button" className="oh-tap-row" style={{ ...choice(false), minHeight: touch ? undefined : "1.7rem", padding: "0 0.55rem" }} onClick={() => setFeature(definition.key, { [setting.key]: undefined })}>
                              Use scenario default
                            </button>
                          )}
                        </div>
                        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.72rem", marginTop: "0.3rem" }}>{setting.description}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FeaturesSectionEditor;
