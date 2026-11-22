import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const featuresEditor = fs.readFileSync(new URL("../GameUI/FeaturesSectionEditor.jsx", import.meta.url), "utf8");
const scriptedEditor = fs.readFileSync(new URL("../GameUI/ScriptedEventsEditor.jsx", import.meta.url), "utf8");
const libraryBar = fs.readFileSync(new URL("../GameUI/libraryBar.jsx", import.meta.url), "utf8");
const serverFeatures = fs.readFileSync(new URL("../../../server/gameFeatures.js", import.meta.url), "utf8");

test("time skips gate authored beats natively before prompting and persist accepted resolutions", () => {
  assert.ok(gameplay.includes("firstSkipIncludesScriptedOrigin("));
  assert.ok(gameplay.includes("includeOrigin: includeOriginScripted"));
  // Every fired beat is the period's, the start day's too: the prehistory is
  // not searched for a beat's words (they are matched by id: worldDirection.js).
  assert.ok(gameplay.includes("const scriptedBeats = scriptedPlan.eligible;"));
  assert.equal(gameplay.includes("scriptedBeatsNotAlreadyWritten"), false);
  assert.equal(gameplay.includes("simulationHistory).length === 0 && segmentIndex === 0"), false);
  assert.match(gameplay, /planScriptedEvents\(/);
  assert.match(gameplay, /scriptedPlan\.eligible/);
  assert.match(gameplay, /buildScriptedEventsInstruction\(scriptedBeats, \{ language: scriptedLanguage \}\)/);
  assert.match(gameplay, /commitScriptedEventPlan\(/);
  assert.match(gameplay, /scriptedEventState:\s*state\.scriptedEventState/);
  assert.match(gameplay, /scriptedEventState:\s*normalizeScriptedEventState\(/);
});

// The event that tells a beat names its id in scriptedBeat: accepted on every
// skip's answer, sent to the games whose scenario has scripted events, after
// the load-bearing warId, combatants and impacts, and never to the Game Master.
test("an event's scriptedBeat is checked on every skip, sent where the scenario has scripted events, and placed last", async () => {
  const { GAMEPLAY_SCHEMAS, SCRIPTED_BEAT_FIELD, getGameplayTool, withScriptedBeat } = await import("./gameplaySchemas.js");
  assert.equal(SCRIPTED_BEAT_FIELD, "scriptedBeat");
  assert.ok(GAMEPLAY_SCHEMAS.jumpForward.properties.events.items.properties.scriptedBeat);
  const lean = getGameplayTool("jumpForward");
  assert.equal("scriptedBeat" in lean.schema.properties.events.items.properties, false, "a game without scripted events pays nothing for it");
  const sent = withScriptedBeat(lean);
  const keys = Object.keys(sent.schema.properties.events.items.properties);
  assert.equal(keys.at(-1), "scriptedBeat");
  assert.ok(keys.indexOf("impacts") < keys.indexOf("scriptedBeat") && keys.indexOf("combatants") < keys.indexOf("scriptedBeat") && keys.indexOf("warId") < keys.indexOf("scriptedBeat"));
  assert.deepEqual(sent.schema.properties.events.items.properties.scriptedBeat, { type: "string", description: "Only on the event that tells a scripted event: that entry's id." });
  assert.equal(withScriptedBeat(sent), sent, "once is enough");
  assert.equal(withScriptedBeat(getGameplayTool("gameMaster")), getGameplayTool("gameMaster"), "not a skip's tool");
  assert.match(gameplay, /const beatTool = JUMP_TASK_KEYS\.has\(taskKey\) && normalizeArray\(getActiveWorldDirection\(\)\?\.scriptedEvents\)\.length \? withScriptedBeat\(featureTool\) : featureTool;/);
  assert.match(gameplay, /withOccupationSettlements\(beatTool, variables\.occupationGroups\) : beatTool;/);
});

test("the Features editor delegates scripted event arrays to a dedicated world-aware list editor", () => {
  assert.match(serverFeatures, /type:\s*"scripted-events"/);
  assert.match(serverFeatures, /normalizeScriptedEvents/);
  assert.match(serverFeatures, /"at_least"/);
  assert.match(featuresEditor, /ScriptedEventsEditor/);
  assert.match(featuresEditor, /setting\.type === "scripted-events"/);
  assert.match(featuresEditor, /world=\{world\}/);
  assert.match(libraryBar, /world=\{details\?\.data\?\.world \?\? \{\}\}/);
  assert.match(scriptedEditor, /Chance after conditions pass/);
  assert.match(scriptedEditor, /Polity has Political World data/);
  assert.match(scriptedEditor, /Polity has institution status/);
  assert.match(scriptedEditor, /Polity is subordinate to polity/);
  assert.doesNotMatch(scriptedEditor, /War ID/);
});
