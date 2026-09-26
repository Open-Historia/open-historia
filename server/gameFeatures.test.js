import test from "node:test";
import assert from "node:assert/strict";
import {
  FEATURE_DEFINITIONS,
  featureDefaults,
  idleDiplomacyChancePerMinute,
  isFeatureEnabled,
  normalizeFeatureOverrides,
  normalizeFeatureSettings,
  playerFocusOf,
  resolveFeatures,
  worldDirectionOf,
  normalizeScriptedEvents,
} from "./gameFeatures.js";

// A feature this file is not about, at its defaults: a complete configuration
// carries every feature, so the exact-object checks below spread it in.
const worldDirection = featureDefaults().worldDirection;
const playerFocus = featureDefaults().playerFocus;
const puppetStates = featureDefaults().puppetStates;
const pregameHistory = featureDefaults().pregameHistory;

test("the defaults switch every feature on with its settings at their defaults", () => {
  const defaults = featureDefaults();
  for (const definition of FEATURE_DEFINITIONS) {
    assert.equal(defaults[definition.key].enabled, true, definition.key);
    for (const setting of definition.settings) {
      assert.equal(defaults[definition.key][setting.key], setting.defaultValue, `${definition.key}.${setting.key}`);
    }
  }
  assert.equal(defaults.idleDiplomacy.averageMinutes, 8);
});

test("a scenario's configuration is made complete, with malformed values replaced", () => {
  const settings = normalizeFeatureSettings({
    espionage: { enabled: "off" },
    idleDiplomacy: { enabled: true, averageMinutes: "not a number" },
    unknownFeature: { enabled: false },
  });
  assert.deepEqual(settings, {
    espionage: { enabled: false },
    idleDiplomacy: { enabled: true, averageMinutes: 8 },
    puppetStates,
    pregameHistory,
    worldDirection,
    playerFocus,
  });
  // The boolean shorthand and clamping to the setting's range.
  assert.deepEqual(normalizeFeatureSettings({ espionage: false, idleDiplomacy: { averageMinutes: 100000 } }), {
    espionage: { enabled: false },
    idleDiplomacy: { enabled: true, averageMinutes: 720 },
    puppetStates,
    pregameHistory,
    worldDirection,
    playerFocus,
  });
  assert.deepEqual(normalizeFeatureSettings("garbage"), featureDefaults());
});

test("pre-game history is on by default, scenario-controlled, and game-overridable", () => {
  const definition = FEATURE_DEFINITIONS.find((entry) => entry.key === "pregameHistory");
  assert.ok(definition, "the Features editor cannot expose pre-game history without a feature definition");
  assert.equal(definition.label, "Pre-game history");
  assert.deepEqual(definition.settings, []);
  assert.equal(featureDefaults().pregameHistory.enabled, true, "existing scenarios keep current behaviour");
  assert.equal(resolveFeatures({ pregameHistory: false }, {}).pregameHistory.enabled, false);
  assert.equal(
    resolveFeatures({ pregameHistory: false }, { pregameHistory: true }).pregameHistory.enabled,
    true,
    "a game can deliberately override its scenario like every other toggleable feature",
  );
});

test("a game's overrides keep only what it set", () => {
  assert.deepEqual(normalizeFeatureOverrides({ espionage: { enabled: false } }), { espionage: { enabled: false } });
  assert.deepEqual(normalizeFeatureOverrides({ idleDiplomacy: { averageMinutes: 30 } }), { idleDiplomacy: { averageMinutes: 30 } });
  assert.deepEqual(normalizeFeatureOverrides({ idleDiplomacy: { enabled: "maybe", averageMinutes: "" } }), {});
  assert.deepEqual(normalizeFeatureOverrides({ espionage: true, nonsense: { enabled: false } }), { espionage: { enabled: true } });
  assert.deepEqual(normalizeFeatureOverrides(null), {});
});

test("a game follows its scenario except where it overrides it", () => {
  const scenario = { espionage: { enabled: false }, idleDiplomacy: { enabled: true, averageMinutes: 20 } };
  assert.deepEqual(resolveFeatures(scenario, {}), normalizeFeatureSettings(scenario));
  const resolved = resolveFeatures(scenario, { espionage: { enabled: true }, idleDiplomacy: { averageMinutes: 5 } });
  assert.equal(resolved.espionage.enabled, true);
  assert.equal(resolved.idleDiplomacy.enabled, true);
  assert.equal(resolved.idleDiplomacy.averageMinutes, 5);
  // A scenario edited later reaches a game that never overrode that field.
  const later = resolveFeatures({ ...scenario, idleDiplomacy: { enabled: false, averageMinutes: 20 } }, { idleDiplomacy: { averageMinutes: 5 } });
  assert.equal(later.idleDiplomacy.enabled, false);
  assert.equal(later.idleDiplomacy.averageMinutes, 5);
});

test("isFeatureEnabled and the idle diplomacy chance read the resolved configuration", () => {
  const resolved = resolveFeatures({ idleDiplomacy: { averageMinutes: 4 } }, {});
  assert.equal(isFeatureEnabled(resolved, "espionage"), true);
  assert.equal(isFeatureEnabled(resolveFeatures({ espionage: false }, {}), "espionage"), false);
  assert.equal(isFeatureEnabled(resolved, "featureNobodyDefined"), true);
  assert.equal(idleDiplomacyChancePerMinute(resolved), 0.25);
  assert.equal(idleDiplomacyChancePerMinute(resolveFeatures({ idleDiplomacy: false }, {})), 0);
  assert.equal(idleDiplomacyChancePerMinute(null), 0);
});

test("legacy scripted-event text migrates to structured Always events without changing its dated beat", () => {
  const events = normalizeScriptedEvents(`
    # comment
    1914-06-28 Archduke Franz Ferdinand is assassinated in Sarajevo.
  `);
  assert.equal(events.length, 1);
  assert.equal(events[0].date, "1914-06-28");
  assert.equal(events[0].text, "Archduke Franz Ferdinand is assassinated in Sarajevo.");
  assert.equal(events[0].trigger.mode, "always");
  assert.match(events[0].id, /^scripted-/);
});

test("structured scripted events keep stable ids and fail-closed trigger data", () => {
  const events = normalizeScriptedEvents([{
    id: "curragh-incident",
    date: "1914-03-21",
    text: "Curragh officers refuse orders.",
    trigger: {
      mode: "conditional",
      operator: "all",
      conditions: [{ type: "polity_exists", polityId: "GBR" }],
    },
  }]);
  assert.equal(events[0].id, "curragh-incident");
  assert.deepEqual(events[0].trigger, {
    mode: "conditional",
    operator: "all",
    conditions: [{ type: "polity_exists", polityId: "GBR" }],
  });
});

// ---- World direction: the director's settings ----

test("world direction ships on, at the built-in pace, with the one-third floor checked and no priority rules", () => {
  assert.deepEqual(featureDefaults().worldDirection, { enabled: true, eventPace: 100, worldShare: 35, priorityRules: "", scriptedEvents: [], territoryTempo: 0 });
  assert.deepEqual(worldDirectionOf(featureDefaults()), { eventPace: 100, worldShare: 35, priorityRules: "", scriptedEvents: [], territoryTempo: 0 });
});

test("its numbers are clamped to their range and rounded to whole percents", () => {
  const settings = normalizeFeatureSettings({ worldDirection: { eventPace: 1000, worldShare: -5 } }).worldDirection;
  assert.equal(settings.eventPace, 250);
  assert.equal(settings.worldShare, 0);
  assert.equal(normalizeFeatureSettings({ worldDirection: { eventPace: "62.4" } }).worldDirection.eventPace, 62);
});

test("priority rules are text: trimmed, line endings normalised, bounded, and never a number", () => {
  const read = (value) => normalizeFeatureSettings({ worldDirection: { priorityRules: value } }).worldDirection.priorityRules;
  assert.equal(read("  No nuclear weapons before 1945.\r\nThe Ottoman Empire endures.  "), "No nuclear weapons before 1945.\nThe Ottoman Empire endures.");
  assert.equal(read(42), "");
  assert.equal(read(null), "");
  assert.equal(read("   "), "");
  assert.equal(read("x".repeat(5000)).length, 2400);
});

test("a game overrides the director field by field, and a blank rule follows the scenario", () => {
  const scenario = { worldDirection: { eventPace: 60, worldShare: 50, priorityRules: "The Tsar survives." } };
  assert.deepEqual(normalizeFeatureOverrides({ worldDirection: { eventPace: 150, priorityRules: "" } }), { worldDirection: { eventPace: 150 } });
  const resolved = resolveFeatures(scenario, { worldDirection: { eventPace: 150, priorityRules: "  " } });
  assert.deepEqual(worldDirectionOf(resolved), { eventPace: 150, worldShare: 50, priorityRules: "The Tsar survives.", scriptedEvents: [], territoryTempo: 0 });
  const own = resolveFeatures(scenario, { worldDirection: { priorityRules: "The Tsar may fall." } });
  assert.equal(worldDirectionOf(own).priorityRules, "The Tsar may fall.");
});

test("world direction switched off is nothing to enforce", () => {
  assert.equal(worldDirectionOf(resolveFeatures({ worldDirection: false }, {})), null);
  assert.equal(worldDirectionOf(resolveFeatures({ worldDirection: { priorityRules: "x" } }, { worldDirection: { enabled: false } })), null);
  assert.equal(worldDirectionOf(null), null);
  assert.equal(worldDirectionOf({}), null);
});

test("Player focus: the scenario sets the default level and a game chooses its own", () => {
  assert.equal(playerFocusOf(featureDefaults()), "balanced");

  const scenario = { playerFocus: { level: "spotlight" } };
  assert.equal(playerFocusOf(resolveFeatures(scenario, null)), "spotlight", "a new game starts where the scenario says");
  assert.equal(playerFocusOf(resolveFeatures(scenario, { playerFocus: { level: "world-first" } })), "world-first", "the player's own choice wins");
  assert.deepEqual(
    normalizeFeatureOverrides({ playerFocus: { level: "focused" } }),
    { playerFocus: { level: "focused" } },
    "a game stores only the level it chose",
  );

  // A level this build does not know (an older scenario, a typo in an import)
  // is not set at all, so the scenario's default or the built-in one stands.
  assert.equal(playerFocusOf(resolveFeatures({ playerFocus: { level: "loudest" } }, null)), "balanced");
  assert.equal(playerFocusOf(resolveFeatures(scenario, { playerFocus: { level: "" } })), "spotlight");
  assert.deepEqual(normalizeFeatureOverrides({ playerFocus: { level: "nonsense" } }), {});

  // The feature has no on/off: it is a choice of level, so an "off" stored by
  // an older build or an import is ignored rather than silently cancelling the
  // player's share.
  assert.equal(playerFocusOf(resolveFeatures({ playerFocus: { enabled: false, level: "focused" } }, null)), "focused");
  assert.deepEqual(normalizeFeatureOverrides({ playerFocus: { enabled: false, level: "focused" } }), { playerFocus: { level: "focused" } });
  assert.equal(featureDefaults().playerFocus.enabled, true);
});
