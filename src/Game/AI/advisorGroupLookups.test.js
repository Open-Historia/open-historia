/*! Open Historia — the advisor asks for the groups: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/advisorGroupLookups.test.js
//
// The advisor was never told which groups exist or where they control: the
// narrator's tasks read them in their prompts, and the player sees them on the
// map, but the advisor only met a group when an event happened to name one. It
// now has two lookup functions for them (lookupTools.js GROUP_LOOKUP_TOOLS),
// called when a conversation turns to them (main.jsx advisorGroupLookups).
// What has to hold:
//   - list_groups names every group exactly, says what it is, how many regions
//     it controls and in which countries, and can keep to one country;
//   - group_info gives one group in full, found by its exact name, any case, or
//     a former name, with every region and the country it belongs to;
//   - an area row the map does not draw is left out rather than named by id;
//   - the narrator's own lookup list does not grow;
//   - an endpoint that refuses the functions still gets every answer, as text.

import test from "node:test";
import assert from "node:assert/strict";

import { GROUP_LOOKUP_TOOLS, GROUP_LOOKUP_TOOL_NAMES, LOOKUP_TOOLS, buildLookupContext, executeLookup } from "./lookupTools.js";
import { viewerAudience } from "./audience.js";
import { appendLookupRound, flattenLookupRounds } from "./toolTurns.js";

const PLAYER = "Republic of Korea";

const REGIONS = [
  { id: "syr-1", name: "Idlib", owner: "Syria" },
  { id: "syr-2", name: "Aleppo", owner: "Syria" },
  { id: "syr-3", name: "Deir ez-Zor", owner: "Syria" },
  { id: "irq-1", name: "Anbar", owner: "Iraq" },
  { id: "mex-1", name: "Sinaloa", owner: "Mexico" },
];

const WORLD = {
  regionOwnershipOverrides: {},
  polityOverrides: {},
  groups: {
    "Hayat Tahrir al-Sham": { name: "Hayat Tahrir al-Sham", description: "An Islamist coalition holding the north-west.", color: "#16a34a", formerNames: ["Jabhat al-Nusra"] },
    "Islamic State": { name: "Islamic State", description: "A jihadist insurgency across the desert.", color: "#111827" },
    "Sinaloa Cartel": { name: "Sinaloa Cartel", description: "", color: "#e11d48" },
    "Quiet Circle": { name: "Quiet Circle", description: "A secret society with no ground of its own.", color: "#3b82f6" },
  },
  groupAreas: {
    "syr-1": "Hayat Tahrir al-Sham",
    "syr-2": "Hayat Tahrir al-Sham",
    "syr-3": "Islamic State",
    "irq-1": "Islamic State",
    "mex-1": "Sinaloa Cartel",
    // A region this map does not draw (a stale row): never named by its id.
    "gone-9": "Islamic State",
  },
};

const ask = (name, args = {}, world = WORLD) => executeLookup(
  buildLookupContext({ regions: REGIONS, world, player: PLAYER, audience: viewerAudience([PLAYER]) }),
  name,
  args,
);

test("the advisor's group functions are their own, and the narrator's list does not grow", () => {
  assert.deepEqual(GROUP_LOOKUP_TOOL_NAMES, ["list_groups", "group_info"]);
  assert.ok(GROUP_LOOKUP_TOOLS.every((tool) => tool.description && tool.schema?.type === "object"));
  assert.ok(!LOOKUP_TOOLS.some((tool) => GROUP_LOOKUP_TOOL_NAMES.includes(tool.name)), "the jump carries the groups in its prompt already");
});

test("list_groups: every group by its exact name, what it is, and where it controls", () => {
  const { groups } = ask("list_groups");
  assert.deepEqual(groups.map((group) => group.name), ["Hayat Tahrir al-Sham", "Islamic State", "Sinaloa Cartel", "Quiet Circle"]);
  const isis = groups.find((group) => group.name === "Islamic State");
  assert.equal(isis.description, "A jihadist insurgency across the desert.");
  assert.equal(isis.regionsControlled, 2, "the row the map does not draw is not counted");
  assert.deepEqual(isis.inCountries, [{ country: "Iraq", regions: 1 }, { country: "Syria", regions: 1 }]);
  const quiet = groups.find((group) => group.name === "Quiet Circle");
  assert.equal(quiet.regionsControlled, 0);
  assert.deepEqual(quiet.inCountries, []);
  assert.equal("description" in groups.find((group) => group.name === "Sinaloa Cartel"), false, "no empty description");
});

test("list_groups keeps to one country when asked, by the country's exact name", () => {
  assert.deepEqual(ask("list_groups", { country: "Syria" }).groups.map((group) => group.name), ["Hayat Tahrir al-Sham", "Islamic State"]);
  assert.deepEqual(ask("list_groups", { country: "syria" }).groups.map((group) => group.name), ["Hayat Tahrir al-Sham", "Islamic State"], "the map's own spelling, whatever the case");
  const none = ask("list_groups", { country: "Iceland" });
  assert.deepEqual(none.groups, []);
  assert.match(none.note, /No group controls any region of Iceland/);
  const empty = ask("list_groups", {}, { ...WORLD, groups: {}, groupAreas: {} });
  assert.deepEqual(empty.groups, []);
  assert.match(empty.note, /no groups/);
});

test("group_info: one group in full, by its exact name, any case or a former name", () => {
  const hts = ask("group_info", { name: "Hayat Tahrir al-Sham" });
  assert.equal(hts.name, "Hayat Tahrir al-Sham");
  assert.equal(hts.description, "An Islamist coalition holding the north-west.");
  assert.deepEqual(hts.formerNames, ["Jabhat al-Nusra"]);
  assert.equal(hts.regionsControlled, 2);
  assert.deepEqual(hts.regions, [{ id: "syr-1", name: "Idlib", owner: "Syria" }, { id: "syr-2", name: "Aleppo", owner: "Syria" }]);
  assert.equal(ask("group_info", { name: "hayat tahrir al-sham" }).name, "Hayat Tahrir al-Sham");
  assert.equal(ask("group_info", { name: "Jabhat al-Nusra" }).name, "Hayat Tahrir al-Sham", "found by the name it had");
  const unknown = ask("group_info", { name: "Wagner" });
  assert.match(unknown.error, /No group named "Wagner"/);
  assert.deepEqual(unknown.groups, ["Hayat Tahrir al-Sham", "Islamic State", "Sinaloa Cartel", "Quiet Circle"]);
});

test("an endpoint that refused the functions still reads every answer, as text", () => {
  const question = [{ role: "user", parts: [{ text: "Who holds Idlib?" }] }];
  const history = appendLookupRound(question, [{ id: "call_1", name: "group_info", args: { name: "Hayat Tahrir al-Sham" } }], [
    { id: "call_1", name: "group_info", response: { name: "Hayat Tahrir al-Sham", regions: [{ id: "syr-1", name: "Idlib", owner: "Syria" }] } },
  ]);
  const flat = flattenLookupRounds(history);
  assert.equal(flat.length, 3);
  assert.deepEqual(flat[0], question[0], "a plain turn is left alone");
  assert.equal(flat[1].role, "model");
  assert.match(flat[1].parts[0].text, /^\[Looked up group_info\(name="Hayat Tahrir al-Sham"\)\]$/);
  assert.equal(flat[2].role, "user");
  assert.match(flat[2].parts[0].text, /^\[group_info answered: \{"name":"Hayat Tahrir al-Sham","regions":\[\{"id":"syr-1","name":"Idlib","owner":"Syria"\}\]\}\]$/);
  assert.ok(flat.every((entry) => entry.parts.every((part) => typeof part.text === "string")), "no function parts left");
});
