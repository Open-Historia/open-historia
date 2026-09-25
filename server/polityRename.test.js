/*! Open Historia — polity re-keying tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test server/polityRename.test.js
//
// Renaming a country re-keys it everywhere. These pin the pass over every
// store, the refusal to merge two countries, the former names that keep old
// references folding onto the country, the stock map's baked regions, the
// Workshop document, and the engine paths that reach the rename: an event's
// polityChanges, a save whose display name still differed from its key, the
// alias map, and the scenario's starting tags.

import test from "node:test";
import assert from "node:assert/strict";

import {
  displayNameMigrations,
  expandBakedRegionsForRename,
  findPolityKey,
  renamePolityInActions,
  renamePolityInChats,
  renamePolityInColors,
  renamePolityInDocument,
  renamePolityInFlags,
  renamePolityInGame,
  renamePolityInWorld,
  samePolityName,
} from "./polityRename.js";
import { applyEventImpactsToWorld, normalizeWorldState } from "../src/runtime/gameState.js";
import { buildOwnerAliasMap, canonicalOwnerName } from "../src/runtime/ownerNames.js";
import { resolveAllCountryTags, resolveCountryTags } from "../src/runtime/countryTags.js";

const world = () => ({
  polityOverrides: {
    Borduria: { aliases: ["Bordurian State"], code: "Borduria", color: "#112233", name: "Borduria", note: "A small kingdom." },
    Syldavia: { aliases: [], code: "Syldavia", color: "#445566", name: "Syldavia", note: "" },
  },
  regionOwnershipOverrides: { r1: "Borduria", r2: "Borduria", r3: "Syldavia" },
  regionSovereigntyOverrides: { r2: "Borduria" },
  regionClaimants: { r3: ["Borduria"], r4: ["Syldavia", "Borduria"] },
  units: [
    { id: "u1", ownerCode: "Borduria", name: "1st Army", type: "infantry", lat: 47.1, lng: 19.2, strength: 100, status: "idle" },
    { id: "u2", ownerCode: "Syldavia", name: "Guard", type: "infantry", lat: 46.1, lng: 18.2, strength: 100, status: "idle" },
  ],
  markers: [{ id: "m1", ownerCode: "Borduria", name: "Fort", kind: "fortification", lat: 47.0, lng: 19.0 }],
  spies: [{ id: "s1", owner: "Borduria", target: "Syldavia", status: "live" }, { id: "s2", owner: "Syldavia", target: "Borduria", status: "live" }],
  wars: [{ id: "w1", sideA: ["Borduria"], sideB: ["Syldavia"], status: "active", startedDate: "1919-01-01" }],
  relations: [{ id: "rel1", a: "Borduria", b: "Syldavia", status: "hostile" }],
  agreements: [{ id: "ag1", parties: ["Borduria", "Syldavia"], guarantor: "Borduria", type: "alliance", status: "active" }],
  storylines: [{ id: "st1", title: "Border feud", status: "active", participants: ["Borduria", "Syldavia"] }],
  projects: [{ id: "p1", ownerCode: "Borduria", name: "Dam", kind: "project", status: "active" }],
  countryStats: { Borduria: { population: 5 } },
  countryTags: { Borduria: ["monarchy"] },
  internationalReputation: { Borduria: 40, Syldavia: 60 },
  intelligence: { Borduria: 55 },
  playerGoals: { Borduria: { text: "Take the Syldavian coast", round: 2 } },
});

test("a rename re-keys every store that carried the old name and keeps it as a former name", () => {
  const { world: next, from, to } = renamePolityInWorld(world(), "Borduria", "Bordurian Republic");
  assert.equal(from, "Borduria");
  assert.equal(to, "Bordurian Republic");
  assert.equal("Borduria" in next.polityOverrides, false, "the old key is gone");
  const record = next.polityOverrides["Bordurian Republic"];
  assert.equal(record.code, "Bordurian Republic");
  assert.equal(record.name, "Bordurian Republic", "the name IS the key");
  assert.equal(record.note, "A small kingdom.", "the rest of the record travels");
  assert.deepEqual(record.formerNames, ["Borduria"]);
  assert.ok(record.aliases.includes("Borduria") && record.aliases.includes("Bordurian State"));
  assert.deepEqual(next.regionOwnershipOverrides, { r1: "Bordurian Republic", r2: "Bordurian Republic", r3: "Syldavia" });
  assert.deepEqual(next.regionSovereigntyOverrides, { r2: "Bordurian Republic" });
  assert.deepEqual(next.regionClaimants, { r3: ["Bordurian Republic"], r4: ["Syldavia", "Bordurian Republic"] });
  assert.deepEqual(next.units.map((unit) => unit.ownerCode), ["Bordurian Republic", "Syldavia"]);
  assert.equal(next.markers[0].ownerCode, "Bordurian Republic");
  assert.deepEqual(next.spies.map((spy) => [spy.owner, spy.target]), [["Bordurian Republic", "Syldavia"], ["Syldavia", "Bordurian Republic"]]);
  assert.deepEqual(next.wars[0].sideA, ["Bordurian Republic"]);
  assert.deepEqual([next.relations[0].a, next.relations[0].b], ["Bordurian Republic", "Syldavia"]);
  assert.deepEqual(next.agreements[0].parties, ["Bordurian Republic", "Syldavia"]);
  assert.equal(next.agreements[0].guarantor, "Bordurian Republic");
  assert.deepEqual(next.storylines[0].participants, ["Bordurian Republic", "Syldavia"]);
  assert.equal(next.projects[0].ownerCode, "Bordurian Republic");
  assert.deepEqual(next.countryStats, { "Bordurian Republic": { population: 5 } });
  assert.deepEqual(next.countryTags, { "Bordurian Republic": ["monarchy"] });
  assert.deepEqual(next.internationalReputation, { "Bordurian Republic": 40, Syldavia: 60 });
  assert.deepEqual(next.intelligence, { "Bordurian Republic": 55 });
  assert.deepEqual(next.playerGoals, { "Bordurian Republic": { text: "Take the Syldavian coast", round: 2 } }, "the standing goal follows its country");
  assert.deepEqual(world().units[0].ownerCode, "Borduria", "the input world is not mutated");
});

test("a second rename keeps every former name, and a name that only differs in case or accents is the same country", () => {
  const once = renamePolityInWorld(world(), "Borduria", "Bordurian Republic").world;
  const twice = renamePolityInWorld(once, "bordurian republic", "People's Republic of Borduria");
  assert.equal(twice.from, "Bordurian Republic", "the old name is found without regard to case");
  const record = twice.world.polityOverrides["People's Republic of Borduria"];
  assert.deepEqual(record.formerNames, ["Borduria", "Bordurian Republic"]);
  assert.ok(samePolityName("Côte d'Ivoire", "cote divoire"));
  assert.equal(findPolityKey(world().polityOverrides, "SYLDAVIA"), "Syldavia");
});

test("a rename never merges two countries, and needs both names", () => {
  assert.throws(() => renamePolityInWorld(world(), "Borduria", "Syldavia"), /already the name of another polity/);
  assert.throws(() => renamePolityInWorld(world(), "", "X"), /needs the polity's current name/);
  assert.throws(() => renamePolityInDocument({ polities: { A: { name: "A" }, B: { name: "B" } } }, "A", "b"), /already the name/);
});

test("the stores the world does not hold follow the rename: colours, flags, the game's polity, chats and orders", () => {
  assert.deepEqual(renamePolityInColors({ Borduria: [1, 2, 3], Syldavia: [4, 5, 6] }, "Borduria", "Bordurian Republic"), { "Bordurian Republic": [1, 2, 3], Syldavia: [4, 5, 6] });
  assert.deepEqual(renamePolityInFlags({ Borduria: "data:flag" }, "Borduria", "Bordurian Republic"), { "Bordurian Republic": "data:flag" });
  assert.deepEqual(renamePolityInGame({ country: "Borduria", round: 2 }, "Borduria", "Bordurian Republic"), { country: "Bordurian Republic", round: 2 });
  const game = { country: "Syldavia" };
  assert.equal(renamePolityInGame(game, "Borduria", "Bordurian Republic"), game, "another polity's game is the same object");
  const chats = renamePolityInChats([{ id: "c1", countries: [{ code: "", name: "Borduria" }, "Syldavia"] }], "Borduria", "Bordurian Republic");
  assert.deepEqual(chats[0].countries, [{ code: "", name: "Bordurian Republic" }, "Syldavia"]);
  const actions = renamePolityInActions([{ id: "a1", participants: ["Borduria"], invitees: ["Syldavia", "Borduria"] }], "Borduria", "Bordurian Republic");
  assert.deepEqual(actions[0].participants, ["Bordurian Republic"]);
  assert.deepEqual(actions[0].invitees, ["Syldavia", "Bordurian Republic"]);
});

test("on a stock map the baked regions of a renamed country get an override, and overridden ones are left alone", () => {
  const regions = [
    { id: "USA.1_1", country: "United States of America" },
    { id: "USA.2_1", country: "United States of America" },
    { id: "CAN.1_1", country: "Canada" },
  ];
  const next = expandBakedRegionsForRename({ regionOwnershipOverrides: { "USA.2_1": "Republic of Texas" } }, regions, "United States of America", "American Federation");
  assert.deepEqual(next.regionOwnershipOverrides, { "USA.1_1": "American Federation", "USA.2_1": "Republic of Texas" });
  const untouched = { regionOwnershipOverrides: {} };
  assert.equal(expandBakedRegionsForRename(untouched, regions, "Nobody", "Anyone"), untouched);
});

test("the Workshop document re-keys its registry, colours, flags, tags and city markers together", () => {
  const doc = {
    polities: { Austria: { name: "Austria", aliases: [], note: "Habsburg" }, Bavaria: { name: "Bavaria", aliases: [] } },
    colorOverrides: { Austria: [1, 2, 3] },
    flags: { Austria: "data:png" },
    tags: { Austria: ["monarchy"], Bavaria: ["catholic"] },
    features: [{ id: "f1", name: "Vienna", country: "Austria", owner: "Austria" }, { id: "f2", name: "Munich", country: "Bavaria", owner: null }],
  };
  const next = renamePolityInDocument(doc, "Austria", "Austria-Hungary");
  assert.deepEqual(Object.keys(next.polities).sort(), ["Austria-Hungary", "Bavaria"]);
  assert.equal(next.polities["Austria-Hungary"].note, "Habsburg");
  assert.equal("formerNames" in next.polities["Austria-Hungary"], false, "a Workshop rename keeps no old name");
  assert.deepEqual(next.colorOverrides, { "Austria-Hungary": [1, 2, 3] });
  assert.deepEqual(next.flags, { "Austria-Hungary": "data:png" });
  assert.deepEqual(next.tags, { "Austria-Hungary": ["monarchy"], Bavaria: ["catholic"] });
  assert.deepEqual(next.features.map((feature) => [feature.country, feature.owner]), [["Austria-Hungary", "Austria-Hungary"], ["Bavaria", null]]);
  assert.equal(doc.polities.Austria.name, "Austria", "the input document is not mutated");
});

test("an event's polityChanges rename re-keys the world, and a transfer to the new name in the same event lands on it", () => {
  const { world: next, renamedPolities } = applyEventImpactsToWorld({
    colors: { Borduria: [1, 2, 3] },
    events: [{
      id: "e1",
      date: "1920-05-01",
      title: "Republic",
      description: "The monarchy falls.",
      impacts: {
        polityChanges: [{ operation: "rename", code: "Borduria", name: "Bordurian Republic", color: "#ff0000" }],
        regionTransfers: [{ regionId: "r3", fromCode: "Syldavia", toCode: "Bordurian Republic" }],
      },
    }],
    world: normalizeWorldState(world()),
  });
  assert.deepEqual(renamedPolities, [{ from: "Borduria", to: "Bordurian Republic" }]);
  assert.equal("Borduria" in next.polityOverrides, false);
  assert.equal(next.polityOverrides["Bordurian Republic"].name, "Bordurian Republic");
  assert.deepEqual(next.polityOverrides["Bordurian Republic"].formerNames, ["Borduria"]);
  assert.equal(next.polityOverrides["Bordurian Republic"].color, "#ff0000", "the same entry's other fields apply to the new key");
  assert.equal(next.regionOwnershipOverrides.r1, "Bordurian Republic");
  assert.equal(next.regionOwnershipOverrides.r3, "Bordurian Republic", "the transfer in the same event went to the renamed polity");
  assert.equal(next.units.find((unit) => unit.id === "u1")?.ownerCode, "Bordurian Republic");
  assert.equal(next.internationalReputation["Bordurian Republic"], 40);
  assert.equal(Object.keys(next.polityOverrides).some((key) => key !== "Bordurian Republic" && key !== "Syldavia"), false, "no phantom polity");
});

test("an update that carries a new name is a rename too, and the next event may use either name", () => {
  const { world: next } = applyEventImpactsToWorld({
    colors: {},
    events: [
      { id: "e1", date: "1933-03-01", title: "Reich", description: "", impacts: { polityChanges: [{ code: "Borduria", name: "Greater Borduria" }] } },
      { id: "e2", date: "1933-04-01", title: "March", description: "", impacts: { regionTransfers: [{ regionId: "r3", fromCode: "Syldavia", toCode: "Borduria" }] } },
    ],
    world: normalizeWorldState(world()),
  });
  assert.equal(next.regionOwnershipOverrides.r3, "Greater Borduria", "the old name still folds onto the renamed country");
  assert.equal("Borduria" in next.polityOverrides, false);
});

test("a save whose record still shows a display name over its key is re-keyed on the next apply", () => {
  const stale = normalizeWorldState({
    ...world(),
    polityOverrides: { ...world().polityOverrides, Borduria: { ...world().polityOverrides.Borduria, name: "Bordurian Republic" } },
  });
  const { world: next, renamedPolities } = applyEventImpactsToWorld({ colors: { Borduria: [9, 9, 9] }, events: [], world: stale });
  assert.deepEqual(renamedPolities, [{ from: "Borduria", to: "Bordurian Republic" }]);
  assert.equal(next.regionOwnershipOverrides.r1, "Bordurian Republic");
  assert.equal(next.polityOverrides["Bordurian Republic"].name, "Bordurian Republic");
  assert.deepEqual(displayNameMigrations({ polityOverrides: { A: { name: "B" }, B: { name: "B" } } }), [], "a name another record answers to is left alone");
  assert.deepEqual(
    displayNameMigrations({ polityOverrides: { Prussia: { name: "Germany" }, Ruritania: { name: "Kingdom of Ruritania" } } }, { isReserved: (name) => name === "Germany" }),
    [{ from: "Ruritania", to: "Kingdom of Ruritania" }],
    "a real country's name on another record is not taken by the migration",
  );
  assert.deepEqual(
    displayNameMigrations({ polityOverrides: { "Third Reich": { name: "Germany", formerNames: ["Germany"] } } }, { isReserved: (name) => name === "Germany" }),
    [{ from: "Third Reich", to: "Germany" }],
    "unless it was this polity's own name before",
  );
});

test("the alias map folds a former name onto the renamed country, even a real country's name, unless that country is itself alive", () => {
  const next = renamePolityInWorld(normalizeWorldState({
    polityOverrides: { Germany: { code: "Germany", name: "Germany", aliases: [], color: "", note: "" } },
    regionOwnershipOverrides: { "DEU.1_1": "Germany" },
  }), "Germany", "Third Reich").world;
  const aliases = buildOwnerAliasMap(next.polityOverrides);
  assert.equal(canonicalOwnerName("Germany", aliases), "Third Reich", "the former real-country name is this country");
  assert.equal(canonicalOwnerName("DEU", aliases), "Third Reich", "so is its code");
  const contested = buildOwnerAliasMap({
    ...next.polityOverrides,
    Germany: { code: "Germany", name: "Germany", aliases: [], color: "", note: "" },
  });
  assert.equal(canonicalOwnerName("Germany", contested), "Germany", "a live polity keeps its own name");
});

test("a renamed country keeps the starting tags the scenario keyed by its old name", () => {
  const base = { Germany: ["militarist"], France: ["republic"] };
  const next = renamePolityInWorld(normalizeWorldState({
    polityOverrides: { Germany: { code: "Germany", name: "Germany", aliases: [], color: "", note: "" } },
  }), "Germany", "Third Reich").world;
  assert.deepEqual(resolveCountryTags(base, next, "Third Reich"), ["militarist"]);
  assert.deepEqual(resolveAllCountryTags(base, next), { "Third Reich": ["militarist"], France: ["republic"] });
  const live = { ...next, countryTags: { "Third Reich": ["fascist"] } };
  assert.deepEqual(resolveCountryTags(base, live, "Third Reich"), ["fascist"], "the AI's live tags still win");
});

test("a leftover under the new name, an unused stock colour, never repaints the renamed country", () => {
  // A game's colours hold the stock palette beside its own polities', keyed by
  // names no polity holds, so "Kingdom of Spain" renamed "Spain" meets one.
  assert.deepEqual(renamePolityInColors({ "Kingdom of Spain": [9, 9, 9], Spain: [1, 2, 3], France: [4, 5, 6] }, "Kingdom of Spain", "Spain"), { Spain: [9, 9, 9], France: [4, 5, 6] });
  assert.deepEqual(renamePolityInColors({ Spain: [1, 2, 3], "Kingdom of Spain": [9, 9, 9] }, "Kingdom of Spain", "Spain"), { Spain: [9, 9, 9] }, "whichever comes first in the file");
  assert.deepEqual(renamePolityInColors({ "Kingdom of Spain": [9, 9, 9], spain: [1, 2, 3] }, "Kingdom of Spain", "Spain"), { Spain: [9, 9, 9] }, "a leftover spelled differently is the same name");
  assert.deepEqual(renamePolityInColors({ Spain: [1, 2, 3], France: [4, 5, 6] }, "Kingdom of Spain", "Spain"), { France: [4, 5, 6] }, "a country with no colour of its own does not take the leftover's");
  assert.deepEqual(renamePolityInColors({ "kingdom of spain": [8, 8, 8], "Kingdom of Spain": [9, 9, 9] }, "Kingdom of Spain", "Spain"), { Spain: [9, 9, 9] }, "its exact old key wins over another spelling of it");
  assert.deepEqual(Object.keys(renamePolityInColors({ Andorra: [0, 0, 0], "Kingdom of Spain": [9, 9, 9], France: [4, 5, 6] }, "Kingdom of Spain", "Spain")), ["Andorra", "Spain", "France"], "the renamed entry keeps its place");
  assert.deepEqual(renamePolityInFlags({ "Kingdom of Spain": "data:own", Spain: "data:stock" }, "Kingdom of Spain", "Spain"), { Spain: "data:own" });
});

test("the world's own figures, tags, rating and goal win over leftovers under the new name", () => {
  const next = renamePolityInWorld({
    ...world(),
    countryStats: { Borduria: { population: 5 }, "Bordurian Republic": { population: 999 } },
    countryTags: { "Bordurian Republic": ["leftover"] },
    internationalReputation: { "Bordurian Republic": 99, Borduria: 40, Syldavia: 60 },
    intelligence: { Borduria: 55, "bordurian republic": 1 },
    playerGoals: { "Bordurian Republic": { text: "Someone else's goal" }, Borduria: { text: "Take the Syldavian coast", round: 2 } },
  }, "Borduria", "Bordurian Republic").world;
  assert.deepEqual(next.countryStats, { "Bordurian Republic": { population: 5 } });
  assert.deepEqual(next.countryTags, {}, "a leftover never becomes the country's, even where it had none");
  assert.deepEqual(next.internationalReputation, { "Bordurian Republic": 40, Syldavia: 60 });
  assert.deepEqual(next.intelligence, { "Bordurian Republic": 55 });
  assert.deepEqual(next.playerGoals, { "Bordurian Republic": { text: "Take the Syldavian coast", round: 2 } });
});

test("an event that renames a country onto a stock colour's name keeps the country's colour, or gives it the event's", () => {
  const rename = (extra = {}) => applyEventImpactsToWorld({
    colors: { Borduria: [1, 2, 3], "Bordurian Republic": [200, 200, 200] },
    events: [{ id: "e1", date: "1920-05-01", title: "Republic", description: "", impacts: { polityChanges: [{ operation: "rename", code: "Borduria", name: "Bordurian Republic", ...extra }] } }],
    world: normalizeWorldState(world()),
  }).colors;
  const kept = rename();
  assert.deepEqual(kept["Bordurian Republic"], [1, 2, 3]);
  assert.equal("Borduria" in kept, false);
  assert.deepEqual(rename({ color: "#ff0000" })["Bordurian Republic"], [255, 0, 0], "a colour the event gives it still wins");
});

test("the Workshop's rename keeps the country's own colour, flag and tags over leftovers", () => {
  const next = renamePolityInDocument({
    polities: { Austria: { name: "Austria", aliases: [] } },
    colorOverrides: { Austria: [1, 2, 3], "Austria-Hungary": [7, 7, 7] },
    flags: { "Austria-Hungary": "data:leftover" },
    tags: { Austria: ["monarchy"], "austria-hungary": ["leftover"] },
  }, "Austria", "Austria-Hungary");
  assert.deepEqual(next.colorOverrides, { "Austria-Hungary": [1, 2, 3] });
  assert.deepEqual(next.flags, {});
  assert.deepEqual(next.tags, { "Austria-Hungary": ["monarchy"] });
});

// The user (2026-09-24): "when renaming a country in the map editor, it shouldnt
// save the previous names". Nothing in the document refers to the old name after
// the rename, so the record keeps none — not as a former name, not as an alias —
// including names an earlier rename had saved. A rename in play still keeps them.
test("a Workshop rename keeps no previous name, while a rename in play does", () => {
  const doc = {
    polities: {
      Prussia: { name: "Prussia", code: "Prussia", aliases: ["Prussia", "Brandenburg", "Borussia"], formerNames: ["Brandenburg"], status: "active", note: "" },
    },
  };
  const renamed = renamePolityInDocument(doc, "Prussia", "German Empire").polities["German Empire"];
  assert.equal("formerNames" in renamed, false);
  assert.deepEqual(renamed.aliases, ["Borussia"], "an alias that was never its name stays");
  assert.equal(renamed.name, "German Empire");
  assert.equal(renamed.code, "German Empire");
  const twice = renamePolityInDocument(renamePolityInDocument(doc, "Prussia", "German Empire"), "German Empire", "Reich").polities.Reich;
  assert.equal("formerNames" in twice, false, "renaming again leaves nothing behind either");
  assert.deepEqual(twice.aliases, ["Borussia"]);

  const world = renamePolityInWorld({ polityOverrides: { Prussia: { name: "Prussia", aliases: [] } } }, "Prussia", "German Empire").world;
  assert.deepEqual(world.polityOverrides["German Empire"].formerNames, ["Prussia"], "history made in play still folds onto the country");
});
