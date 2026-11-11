// Run: node --test src/Game/AI/featuresOffPrompts.test.js
//
// "features disabled in scenarios and stuff should not have the stuff about them in the system prompts" (the owner,
// 2026-11-11). Groups, social media and the war parts already left their blocks out; what was still sent with a
// feature off: the espionage fields of every answer (spyOps, spiesOnPlayer, agentReports, polityChanges.intelligence),
// the intelligence rating's block and template line, air and naval unit types and the blockade posture without air
// units or navies, and aircraft among a strike's weapons without air units.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { getGameplayTool, withoutEspionage, withWarParts } from "./gameplaySchemas.js";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// Every property path of a schema, and every enum beside its path.
const paths = (schema, at = "$", out = { props: [], enums: {} }) => {
  if (!schema || typeof schema !== "object") return out;
  if (Array.isArray(schema)) { schema.forEach((entry) => paths(entry, at, out)); return out; }
  if (Array.isArray(schema.enum)) out.enums[at] = schema.enum;
  for (const [field, entry] of Object.entries(schema.properties ?? {})) {
    out.props.push(`${at}.${field}`);
    paths(entry, `${at}.${field}`, out);
  }
  for (const key of ["items", "anyOf", "oneOf", "allOf", "additionalProperties"]) if (schema[key]) paths(schema[key], key === "items" ? `${at}[]` : at, out);
  return out;
};
const requiredEverywhere = (schema, out = []) => {
  if (!schema || typeof schema !== "object") return out;
  if (Array.isArray(schema)) { schema.forEach((entry) => requiredEverywhere(entry, out)); return out; }
  if (Array.isArray(schema.required)) out.push(...schema.required);
  for (const value of Object.values(schema)) if (value && typeof value === "object") requiredEverywhere(value, out);
  return out;
};

test("espionage off: a time skip is offered no spy orders, no spies at the player and no intelligence rating", () => {
  const tool = getGameplayTool("jumpForward");
  const before = paths(tool.schema).props;
  assert.ok(before.includes("$.spiesOnPlayer") && before.includes("$.events[].impacts.spyOps") && before.includes("$.events[].impacts.polityChanges[].intelligence"), "the full contract has them");

  const shown = withoutEspionage(tool);
  const after = paths(shown.schema).props;
  for (const gone of ["$.spiesOnPlayer", "$.agentReports", "$.events[].impacts.spyOps", "$.events[].impacts.polityChanges[].intelligence"]) {
    assert.ok(!after.includes(gone), `${gone} is not offered`);
  }
  assert.ok(after.includes("$.events[].impacts.polityChanges[].reputation"), "reputation stays");
  assert.deepEqual(after.filter((path) => !before.includes(path)), [], "nothing is added");
  // What goes is those fields and what lies inside them, nothing else.
  const removed = ["$.agentReports", "$.events[].impacts.polityChanges[].intelligence", "$.events[].impacts.spyOps", "$.spiesOnPlayer"];
  for (const path of before.filter((entry) => !after.includes(entry))) {
    assert.ok(removed.some((root) => path === root || path.startsWith(`${root}[]`) || path.startsWith(`${root}.`)), `${path} goes only with a field espionage owns`);
  }
  for (const field of ["spyOps", "spiesOnPlayer", "agentReports"]) assert.ok(!requiredEverywhere(shown.schema).includes(field), `${field} is not required`);
  assert.ok(paths(tool.schema).props.includes("$.spiesOnPlayer"), "the shared contract is untouched");

  // A task that has an "intelligence" field of its own keeps it: only polityChanges' goes.
  assert.ok(paths(withoutEspionage(getGameplayTool("intelligenceAssessment")).schema).props.includes("$.intelligence"));
});

test("air units or navies off: no unit is raised as one, and without a navy nothing blockades", () => {
  for (const task of ["jumpForward", "idleDiplomacy", "unitDirector"]) {
    const tool = getGameplayTool(task);
    const types = (shown) => Object.entries(paths(shown.schema).enums).filter(([path]) => /unit\.type$/.test(path)).map(([, values]) => values);
    const postures = (shown) => Object.entries(paths(shown.schema).enums).filter(([path]) => /posture$/.test(path)).map(([, values]) => values);
    assert.ok(types(tool).length > 0, `${task} has unit types`);
    assert.equal(withWarParts(tool), tool, "with both on, the same tool");

    const noAir = withWarParts(tool, { air: false });
    for (const values of types(noAir)) assert.deepEqual(values, ["infantry", "armor", "naval", "artillery", "garrison"]);
    for (const values of postures(noAir)) assert.ok(values.includes("blockade"), "a navy still blockades");

    const noNavy = withWarParts(tool, { navies: false });
    for (const values of types(noNavy)) assert.deepEqual(values, ["infantry", "armor", "air", "artillery", "garrison"]);
    for (const values of postures(noNavy)) assert.deepEqual(values, ["holding", "massing", "patrol", "transit", "exercise", "withdrawing", "assaulting"]);

    for (const values of types(tool)) assert.ok(values.includes("air") && values.includes("naval"), "the shared contract is untouched");
  }
});

test("the game shows each task's contract without what is off, the background batch's too", () => {
  const gameplay = read("./gameplay.js");
  assert.match(gameplay, /const withoutFeaturesOff = \(tool\) => \{\n\s*const spied = isActiveFeatureEnabled\("espionage"\) \? tool : withoutEspionage\(tool\);\n\s*const posted = isActiveFeatureEnabled\("socialMedia"\) \? spied : withSocialPosts\(spied, false\);\n\s*return withWarParts\(posted, \{ air: airOn\(\), navies: naviesOn\(\) \}\);/);
  // The breadth repair asks with the skip's contract through forActiveFeatures alone: no posts there either.
  assert.match(gameplay, /taskKey: "worldBreadthRepair",\n\s*tool: forActiveFeatures\(getGameplayTool\("jumpForward"\)\)/);
  assert.match(gameplay, /withEventAudience\(withoutFeaturesOff\(grouped\)/);
  assert.match(gameplay, /schema: withoutFeaturesOff\(getGameplayTool\(job\.taskKey\)\)\?\.schema/);
});

test("espionage off: no intelligence rating is shown or explained, and the template speaks of reputation alone", () => {
  const gameplay = read("./gameplay.js");
  assert.match(gameplay, /if \(wants\("playerPolityIntelligenceContext"\) && isActiveFeatureEnabled\("espionage"\)\)/);
  assert.match(gameplay, /intelligence \? "\[Standing and Intelligence\]" : "\[Standing\]"/);
  // The [Intelligence Services] block of an order's turn has nothing to show then either.
  assert.match(gameplay, /const intelligenceContext = normalizeString\(variables\.playerPolityIntelligenceContext\);\n\s*if \(intelligenceContext\)/);

  const prompts = JSON.parse(read("./defaultPrompts.json"));
  const line = "a polity's reputation and intelligence rating change through polityChanges";
  for (const task of ["jumpForward", "autoJumpForward"]) assert.ok(prompts.tasks[task].includes(line), `${task} still words it so`);
  assert.ok(gameplay.includes(`template.replace("${line}", "a polity's reputation changes through polityChanges")`));
  assert.match(gameplay, /const promptTemplate = withoutEspionageWords\(/);
});

test("air units off: a strike's weapons are missiles only", () => {
  const gameplay = read("./gameplay.js");
  const levers = gameplay.match(/"• strikes: [^\n]*",/)?.[0] ?? "";
  const replaced = levers
    .replace("a missile launch or a bombing run the event tells of", "a missile launch the event tells of")
    .replace(" | nuclear bomber (these three are nuclear)", " (these two are nuclear)")
    .replace(" | bombing run.", ".")
    .replace("how many missiles or aircraft", "how many missiles");
  assert.notEqual(replaced, levers);
  assert.match(replaced, /weapon: silo missile \| submarine missile \(these two are nuclear\) \| missile strike\. from:/);
  assert.doesNotMatch(replaced, /bomber|bombing run|aircraft/);
  for (const piece of ["a missile launch or a bombing run the event tells of", " | nuclear bomber (these three are nuclear)", " | bombing run.", "how many missiles or aircraft"]) {
    assert.ok(gameplay.includes(`.replace("${piece}"`), `jumpLevers replaces ${piece}`);
  }
});
