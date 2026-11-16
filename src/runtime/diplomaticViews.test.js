/*! Open Historia — the diplomatic map's views, tested © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOC_COLORS,
  DIPLO_UNKNOWN,
  REGIME_COLORS,
  RELATION_COLORS,
  WAR_SIDE_COLORS,
  puppetShade,
} from "./diplomaticPalette.js";
import { buildDiplomaticView, defaultInstitutionId, diplomaticTieOf, liveWarsOf } from "./diplomaticViews.js";
import { institutionsForMap, politicalActorsForMap, powerTiersForMap } from "./diplomaticWorldSlices.js";

const LANDED = ["France", "Germany", "Italy", "Spain", "Poland", "Austria", "Russia", "Ukraine", "Belarus", "Portugal", "Monaco"];
const view = (options) => buildDiplomaticView({ playerCountry: "France", landedOwners: LANDED, ...options });
const ids = (built) => built.legend.entries.map((entry) => entry.id);

test("the legend lists only what is on the map, each with how many countries are in it", () => {
  const built = view({
    world: {
      wars: [{ id: "w", title: "War of Words", status: "active", sideA: ["France"], sideB: ["Germany"] }],
      relations: [{ a: "France", b: "Spain", score: -40 }, { a: "France", b: "Italy", score: -45 }],
    },
  });
  assert.deepEqual(ids(built), ["self", "war", "strained", "unknown"]);
  assert.deepEqual(built.legend.entries.map((entry) => entry.count), [1, 1, 2, LANDED.length - 4]);
  // A swatch is the colour of the fill.
  for (const entry of built.legend.entries) assert.equal(entry.color, RELATION_COLORS[entry.id]);
  assert.equal(built.colorOf("Spain"), RELATION_COLORS.strained);
  // The counts add up to the countries on the map.
  assert.equal(built.legend.entries.reduce((sum, entry) => sum + entry.count, 0), LANDED.length);
});

test("relations: lines run from the focus to its allies and enemies, and its fronts are lit", () => {
  const built = view({
    world: {
      wars: [{ id: "w", status: "active", sideA: ["France", "Spain"], sideB: ["Germany"] }, { id: "c", status: "ceasefire", sideA: ["France"], sideB: ["Italy"] }],
      agreements: [{ status: "active", type: "guarantee", parties: ["France", "Poland"] }, { status: "active", type: "trade_economic", parties: ["France", "Portugal"] }],
    },
  });
  const lines = Object.fromEntries(built.lines.map((line) => [line.to, line.kind]));
  assert.deepEqual(lines, { Germany: "war", Italy: "ceasefire", Spain: "ally", Poland: "ally" });
  assert.ok(built.lines.every((line) => line.from === "France"));
  assert.deepEqual(built.frontPairs.sort(), ["France\u001fGermany", "France\u001fItaly"]);
  assert.equal(built.hatchOf("Italy", "ITA.1_1"), "ceasefire");
  assert.equal(built.legend.entries.find((entry) => entry.id === "ceasefire").hatch, "ceasefire");
});

test("relations: the tooltip says the tie in a short line, by name", () => {
  const built = view({
    world: {
      agreements: [{ status: "active", type: "mutual_defense", title: "Paris Pact", parties: ["France", "Poland"] }],
      institutions: [{ id: "nato", shortName: "NATO", kind: "security_alliance", status: "active", members: [{ polity: "France", status: "member" }, { polity: "Italy", status: "member" }] }],
      relations: [{ a: "France", b: "Spain", score: -72 }],
    },
  });
  assert.deepEqual(diplomaticTieOf(built, "Poland"), ["Mutual defence", "Paris Pact"]);
  assert.deepEqual(diplomaticTieOf(built, "Italy"), ["Mutual defence", "NATO"]);
  assert.deepEqual(diplomaticTieOf(built, "Spain"), ["Hostile", "−72"]);
  assert.deepEqual(diplomaticTieOf(built, "Portugal"), ["No record", ""]);
  assert.deepEqual(diplomaticTieOf(built, "France"), ["Focus country", ""]);
});

test("wars: every war, each side its own colour, multi-member sides together, ceasefires hatched", () => {
  const wars = [
    { id: "a", title: "Eastern War", status: "active", sideA: ["Russia", "Belarus"], sideB: ["Ukraine", "Poland"] },
    { id: "b", title: "Alpine Quarrel", status: "ceasefire", sideA: ["Italy"], sideB: ["Austria"] },
    { id: "z", title: "Old War", status: "ended", sideA: ["Spain"], sideB: ["Portugal"] },
  ];
  const built = view({ view: "wars", world: { wars } });
  assert.deepEqual(built.legend.wars.map((war) => war.label), ["Eastern War", "Alpine Quarrel"]);
  assert.equal(built.colorOf("Russia"), WAR_SIDE_COLORS[0][0]);
  assert.equal(built.colorOf("Belarus"), WAR_SIDE_COLORS[0][0]);
  assert.equal(built.colorOf("Ukraine"), WAR_SIDE_COLORS[0][1]);
  assert.equal(built.colorOf("Poland"), WAR_SIDE_COLORS[0][1]);
  assert.equal(built.colorOf("Italy"), WAR_SIDE_COLORS[1][0]);
  assert.equal(built.colorOf("Spain"), DIPLO_UNKNOWN, "an ended war colours no one");
  assert.equal(built.hatchOf("Italy", "x"), "ceasefire");
  assert.equal(built.hatchOf("Russia", "x"), "");
  assert.deepEqual(built.legend.wars[0].sides.map((side) => [side.names, side.count]), [[["Russia", "Belarus"], 2], [["Ukraine", "Poland"], 2]]);
  assert.equal(built.legend.wars[1].status, "ceasefire");
  assert.ok(built.frontPairs.includes("Russia\u001fUkraine") && built.frontPairs.includes("Austria\u001fItaly"));
  assert.deepEqual(ids(built), ["none"], "the countries at peace, counted");
  assert.deepEqual(diplomaticTieOf(built, "Belarus"), ["At war", "Eastern War"]);
  assert.deepEqual(diplomaticTieOf(built, "Austria"), ["Ceasefire", "Alpine Quarrel"]);
});

test("wars: a war picked in the legend comes first, its fronts alone lit", () => {
  const wars = [
    { id: "a", title: "First", status: "active", sideA: ["Russia"], sideB: ["Ukraine"] },
    { id: "b", title: "Second", status: "active", sideA: ["Ukraine"], sideB: ["Poland"] },
  ];
  assert.equal(view({ view: "wars", world: { wars } }).colorOf("Ukraine"), WAR_SIDE_COLORS[0][1]);
  const focused = view({ view: "wars", world: { wars }, focusWarId: "b" });
  assert.equal(focused.colorOf("Ukraine"), WAR_SIDE_COLORS[1][0], "Ukraine drawn as a side of the war picked");
  assert.deepEqual(focused.frontPairs, ["Poland\u001fUkraine"]);
  assert.equal(liveWarsOf([{ status: "active", sideA: ["X"], sideB: [] }]).length, 0, "a war needs two sides");
});

test("blocs: members, associates, candidates, observers and the suspended look different; the members outlined as one", () => {
  const institutions = [{
    id: "eu",
    name: "European Union",
    shortName: "EU",
    kind: "political_union",
    status: "active",
    members: [
      { polity: "France", status: "member" },
      { polity: "Germany", status: "member" },
      { polity: "Italy", status: "associate" },
      { polity: "Ukraine", status: "candidate" },
      { polity: "Monaco", status: "observer" },
      { polity: "Poland", status: "suspended" },
    ],
  }];
  const built = view({ view: "blocs", institutionId: "eu", world: { institutions } });
  assert.deepEqual(ids(built), ["member", "associate", "candidate", "observer", "suspended", "none"]);
  assert.equal(built.colorOf("Germany"), BLOC_COLORS.member);
  assert.equal(new Set(["member", "associate", "candidate", "observer", "suspended", "none"].map((status) => BLOC_COLORS[status])).size, 6);
  assert.equal(built.hatchOf("Ukraine", "x"), "candidate");
  assert.equal(built.hatchOf("Poland", "x"), "suspended");
  assert.equal(built.areaOf("France"), "EU");
  assert.equal(built.areaOf("Italy"), "EU");
  assert.equal(built.areaOf("Ukraine"), "", "a candidate is not inside the outline");
  assert.deepEqual(diplomaticTieOf(built, "Ukraine"), ["Candidate", "EU"]);
  assert.deepEqual(diplomaticTieOf(built, "Spain"), ["Not a member", "EU"]);
});

test("blocs: the default is the player's largest institution; a world without institutions says so", () => {
  const institutions = [
    { id: "small", shortName: "Small", status: "active", members: [{ polity: "France", status: "member" }, { polity: "Spain", status: "member" }] },
    { id: "big", shortName: "Big", status: "active", members: [{ polity: "France", status: "member" }, { polity: "Spain", status: "member" }, { polity: "Italy", status: "member" }] },
    { id: "bigger", shortName: "Not Ours", status: "active", members: ["Italy", "Spain", "Russia", "Belarus"].map((polity) => ({ polity, status: "member" })) },
    { id: "watching", shortName: "Watched", status: "active", members: ["Italy", "Spain", "Russia", "Belarus", "Austria"].map((polity) => ({ polity, status: "member" })).concat([{ polity: "France", status: "observer" }]) },
  ];
  assert.equal(defaultInstitutionId(institutions, "France"), "big");
  assert.equal(defaultInstitutionId(institutions, "Portugal"), "");
  const none = view({ view: "blocs", world: { institutions: [] } });
  assert.equal(none.noInstitutions, true);
  assert.equal(view({ view: "blocs", world: { institutions } }).noInstitutions, false);
});

test("government: coloured by enums alone, never by the words of a value", () => {
  const politicalActors = {
    france: { regimeCharacter: "democratic", representation: "electoral", ideologyFamily: "socialDemocracy" },
    germany: { regimeCharacter: "Democratic republic", representation: "parliament", ideologyFamily: "liberal" },
    russia: { regimeCharacter: "authoritarian", representation: "party_state", ideologyFamily: "nationalPopulism" },
  };
  const regime = view({ view: "government", governmentAxis: "regime", world: { politicalActors } });
  assert.equal(regime.colorOf("France"), REGIME_COLORS.democratic);
  assert.equal(regime.colorOf("Germany"), REGIME_COLORS.unknown, "a value the enum does not name is no value");
  assert.equal(regime.colorOf("Russia"), REGIME_COLORS.authoritarian);
  const ideology = view({ view: "government", governmentAxis: "ideology", world: { politicalActors } });
  assert.equal(ideology.infoOf("France").category, "socialDemocracy");
  assert.equal(ideology.infoOf("Germany").category, "unknown");
  const representation = view({ view: "government", governmentAxis: "representation", world: { politicalActors } });
  assert.equal(representation.infoOf("Russia").category, "party_state");
  assert.equal(representation.infoOf("Germany").category, "unknown");
  const power = view({ view: "government", governmentAxis: "power", world: { powerStatus: { russia: "major-power", germany: "great power" } } });
  assert.equal(power.infoOf("Russia").category, "major-power");
  assert.equal(power.infoOf("Germany").category, "unknown");
});

test("government: a puppet in its overlord's colour family, hatched; occupied land hatched and counted", () => {
  const politicalActors = { france: { regimeCharacter: "democratic" }, monaco: { regimeCharacter: "theocratic" } };
  const built = view({
    view: "government",
    world: {
      politicalActors,
      puppets: [{ overlord: "France", puppet: "Monaco", status: "active", kind: "protectorate", secrecy: "open" }],
      regionSovereigntyOverrides: { "UKR.1_1": "Ukraine", "UKR.2_1": "Ukraine" },
      regionOwnershipOverrides: { "UKR.1_1": "Russia", "UKR.2_1": "Ukraine" },
    },
  });
  assert.equal(built.colorOf("Monaco"), puppetShade(REGIME_COLORS.democratic));
  assert.notEqual(built.colorOf("Monaco"), REGIME_COLORS.democratic);
  assert.equal(built.hatchOf("Monaco", "MCO.1_1"), "puppet");
  assert.deepEqual(diplomaticTieOf(built, "Monaco"), ["Puppet", "France"]);
  assert.equal(built.hatchOf("Russia", "UKR.1_1"), "occupied");
  assert.equal(built.hatchOf("Ukraine", "UKR.2_1"), "");
  const democratic = built.legend.entries.find((entry) => entry.id === "democratic");
  assert.equal(democratic.count, 2, "the puppet counts with its overlord's kind");
  assert.deepEqual(democratic.colors.sort(), [REGIME_COLORS.democratic, puppetShade(REGIME_COLORS.democratic)].sort());
  assert.equal(built.legend.entries.find((entry) => entry.id === "hatch:puppet").count, 1);
  assert.equal(built.legend.entries.find((entry) => entry.id === "hatch:occupied").count, 1);
  // Outside the Government view occupation is the stripes' business, not a hatch.
  assert.equal(view({ world: { regionSovereigntyOverrides: { "UKR.1_1": "Ukraine" } } }).hatchOf("Russia", "UKR.1_1"), "");
});

test("the map store keeps the political world's public enums only", () => {
  const actors = politicalActorsForMap({
    byPolity: {
      France: {
        polityKey: "France",
        politicalSystem: { regimeCharacter: "democratic", representation: "electoral", type: "republic" },
        government: { form: "Semi-presidential republic", rulingPartyIds: ["p1"] },
        parties: [{ id: "p1", name: "Renaissance", ideologyFamily: "socialLiberalism", privateNotes: "x" }],
        leader: { name: "A. Leader" },
        disposition: { aggression: 90 },
        pressures: [{ text: "secret" }],
        traits: ["paranoid"],
        perceptions: { Germany: { trust: 10 } },
        approval: 30,
        stability: 40,
      },
    },
  });
  assert.deepEqual(actors, { france: { regimeCharacter: "democratic", representation: "electoral", ideologyFamily: "socialLiberalism" } });
  const text = JSON.stringify(actors);
  for (const hidden of ["disposition", "pressures", "traits", "perceptions", "approval", "stability", "secret", "paranoid", "Semi-presidential"]) {
    assert.ok(!text.includes(hidden), hidden);
  }
  assert.deepEqual(powerTiersForMap({ byPolity: { France: { tier: "major-power", lastUpdatedRound: 2 }, france: { tier: "minor-power", lastUpdatedRound: 9 } } }), { france: "minor-power" });
  assert.deepEqual(institutionsForMap({ byId: { eu: { name: "European Union", shortName: "EU", kind: "political_union", status: "active", charter: { secret: 1 }, members: [{ polity: "France", status: "Member", role: "leader" }] } } }), [
    { id: "eu", name: "European Union", shortName: "EU", kind: "political_union", status: "active", members: [{ polity: "France", status: "member" }] },
  ]);
});
