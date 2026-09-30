/*! Open Historia — a game with groups switched off never offers them to the model: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/groupsSwitchedOff.test.js
//
// Groups are a feature a scenario can switch off (server/gameFeatures.js). Off,
// the model must not be offered them anywhere, not merely have what it writes
// left out afterwards:
//   - the time skip's tool has no groupOps field, and neither does anything else
//     it is built from; the Game Master's transport never had one;
//   - the lines that teach groupOps go from the skip's levers and from the Game
//     Master's contract (rule 5A and the field's shape), and nothing else does;
//   - the narrator's lookup functions say nothing of groups, list_regions takes
//     no group, and no answer names a group or its area;
//   - the target dossier leaves out the groups in a country's land.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getGameplayTool, validateGameplayPayload, withoutGroupOps } from "./gameplaySchemas.js";
import { LOOKUP_TOOLS, LOOKUP_TOOLS_WITHOUT_GROUPS, buildLookupContext, executeLookup, lookupToolsFor } from "./lookupTools.js";
import { buildTargetLedgerLines } from "./targetDossier.js";
import { withoutGroupOpsLines } from "../../runtime/groups.js";
import { normalizeWorldState } from "../../runtime/gameState.js";

const mentionsGroups = (value) => /groupOps|\bgroups?\b/i.test(JSON.stringify(value));

test("the time skip's tool offers no groupOps with groups off, and keeps every other field", () => {
  for (const taskKey of ["jumpForward", "autoJumpForward"]) {
    const tool = getGameplayTool(taskKey);
    const without = withoutGroupOps(tool);
    assert.ok(JSON.stringify(tool.schema).includes("groupOps"), `${taskKey} offers it while groups are on`);
    assert.equal(JSON.stringify(without.schema).includes("groupOps"), false, taskKey);
    assert.equal(without.name, tool.name);
    const impacts = without.schema.properties.events.items.properties.impacts.properties;
    const before = tool.schema.properties.events.items.properties.impacts.properties;
    assert.deepEqual(Object.keys(impacts), Object.keys(before).filter((key) => key !== "groupOps"));
    assert.deepEqual(impacts.regionTransfers, before.regionTransfers, "the other families are untouched");
    assert.ok(JSON.stringify(tool.schema).includes("groupOps"), "the shared tool itself is not changed");
  }
  // A skip written with the narrowed tool still validates.
  const payload = {
    events: [{ date: "1830-03-01", title: "The court recalls its envoy", description: "The envoy left the capital.", impacts: { regionTransfers: [] } }],
    stopDate: "1830-03-31",
    summary: "A quiet month.",
  };
  assert.equal(validateGameplayPayload("jumpForward", payload).valid, true);
});

test("the Game Master's transport and tools without a schema pass through", () => {
  const gm = getGameplayTool("gameMaster");
  assert.equal(JSON.stringify(gm.schema).includes("groupOps"), false, "its events are JSON text, taught by the prompt");
  assert.deepEqual(withoutGroupOps(gm).schema, gm.schema);
  assert.equal(withoutGroupOps(null), null);
  const bare = { name: "raw" };
  assert.equal(withoutGroupOps(bare), bare);
});

test("the lines that teach groupOps go, and nothing else does", () => {
  const levers = ["[Levers]", "• markerOps {…}", "• groupOps {\"op\":\"take\"}", "• actionIds: …"].join("\n");
  assert.equal(withoutGroupOpsLines(levers), ["[Levers]", "• markerOps {…}", "• actionIds: …"].join("\n"));
  assert.equal(withoutGroupOpsLines("No groups here."), "No groups here.");
  assert.equal(withoutGroupOpsLines(null), "");
});

test("the Game Master's contract loses rule 5A and the groupOps shape, and every other rule stays", () => {
  // gameplayPrompts.js imports JSON node cannot load bare, so its template is
  // read from the source; the helper is what the game calls on it.
  const source = readFileSync(new URL("./gameplayPrompts.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const template = source.match(/NATIVE_GAME_MASTER_PROMPT = `([\s\S]*?)`;/)?.[1];
  assert.ok(template && template.includes("5A. impacts.groupOps"), "the contract teaches groups while they are on");
  const without = withoutGroupOpsLines(template);
  assert.equal(/groupOps|\bgroups?\b/i.test(without), false, "no word of groups is left");
  assert.equal(template.split("\n").length - without.split("\n").length, 2, "rule 5A and the field's shape, no more");
  for (const rule of ["5. impacts.regionClaims", "6. impacts.polityChanges", "- regionClaims:", "- regionControlOps:"]) {
    assert.ok(without.includes(rule), rule);
  }
});

const REGIONS = [
  { id: "syr-1", name: "Idlib", owner: "Syria", adjacencies: ["syr-2"] },
  { id: "syr-2", name: "Aleppo", owner: "Syria", adjacencies: ["syr-1"] },
];
const WORLD = {
  regionOwnershipOverrides: {},
  polityOverrides: {},
  groups: { "Hayat Tahrir al-Sham": { name: "Hayat Tahrir al-Sham", description: "An Islamist coalition.", color: "#16a34a" } },
  groupAreas: { "syr-1": "Hayat Tahrir al-Sham" },
};

test("the narrator's lookups say nothing of groups while they are off", () => {
  assert.equal(lookupToolsFor({ groups: true }), LOOKUP_TOOLS);
  assert.equal(lookupToolsFor(), LOOKUP_TOOLS);
  assert.equal(lookupToolsFor({ groups: false }), LOOKUP_TOOLS_WITHOUT_GROUPS);
  assert.deepEqual(LOOKUP_TOOLS_WITHOUT_GROUPS.map((tool) => tool.name), LOOKUP_TOOLS.map((tool) => tool.name));
  assert.ok(mentionsGroups(LOOKUP_TOOLS), "they do while groups are on");
  for (const tool of LOOKUP_TOOLS_WITHOUT_GROUPS) assert.equal(mentionsGroups(tool), false, tool.name);
  const listRegions = LOOKUP_TOOLS_WITHOUT_GROUPS.find((tool) => tool.name === "list_regions");
  assert.deepEqual(Object.keys(listRegions.schema.properties), ["owner", "offset", "limit"]);
  assert.ok(listRegions.description.endsWith("regionClaims."), listRegions.description);
});

test("no lookup answer names a group or its area while groups are off", () => {
  const on = buildLookupContext({ regions: REGIONS, world: WORLD, player: "Syria" });
  const off = buildLookupContext({ regions: REGIONS, world: WORLD, player: "Syria", groups: false });
  assert.equal(executeLookup(on, "region_info", { regionId: "syr-1" }).controlledByGroup?.name, "Hayat Tahrir al-Sham");
  assert.equal("controlledByGroup" in executeLookup(off, "region_info", { regionId: "syr-1" }), false);
  assert.equal(mentionsGroups(executeLookup(off, "map_around", { regionId: "syr-2", steps: 1 })), false);
  assert.ok(executeLookup(off, "list_regions", { group: "Hayat Tahrir al-Sham" }).error);
  assert.deepEqual(executeLookup(off, "list_groups", {}).groups, []);
  assert.equal(WORLD.groupAreas["syr-1"], "Hayat Tahrir al-Sham", "the world itself keeps them");
});

test("the target dossier leaves out the groups in a country's land while they are off", () => {
  const world = normalizeWorldState({
    polityOverrides: { Syria: { code: "Syria", name: "Syria" } },
    regionOwnershipOverrides: { "syr-1": "Syria" },
    groups: WORLD.groups,
    groupAreas: WORLD.groupAreas,
  });
  const line = (lines) => lines.find((entry) => entry.startsWith("Groups controlling")) ?? "";
  assert.equal(line(buildTargetLedgerLines(world, "Syria")), "Groups controlling part of its land: Hayat Tahrir al-Sham (1 region).");
  assert.equal(line(buildTargetLedgerLines(world, "Syria", { groups: false })), "");
});
