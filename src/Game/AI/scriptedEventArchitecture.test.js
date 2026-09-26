import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const featuresEditor = fs.readFileSync(new URL("../GameUI/FeaturesSectionEditor.jsx", import.meta.url), "utf8");
const scriptedEditor = fs.readFileSync(new URL("../GameUI/ScriptedEventsEditor.jsx", import.meta.url), "utf8");
const libraryBar = fs.readFileSync(new URL("../GameUI/libraryBar.jsx", import.meta.url), "utf8");
const serverFeatures = fs.readFileSync(new URL("../../../server/gameFeatures.js", import.meta.url), "utf8");

test("time skips gate authored beats natively before prompting and persist accepted resolutions", () => {
  assert.match(gameplay, /planScriptedEvents\(/);
  assert.match(gameplay, /scriptedPlan\.eligible/);
  assert.match(gameplay, /buildScriptedEventsInstruction\(scriptedBeats\)/);
  assert.match(gameplay, /commitScriptedEventPlan\(/);
  assert.match(gameplay, /scriptedEventState:\s*state\.scriptedEventState/);
  assert.match(gameplay, /scriptedEventState:\s*normalizeScriptedEventState\(/);
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
  assert.match(scriptedEditor, /Political World exists for polity/);
  assert.match(scriptedEditor, /Polity has institution status/);
  assert.match(scriptedEditor, /Polity is subordinate to polity/);
  assert.doesNotMatch(scriptedEditor, /War ID/);
});
