/*! Open Historia — Listen in: what the model is told about the place: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/listenInContext.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { describeListenInPlace, listenInPlaceLabel, listenInRequest } from "./listenInContext.js";

const bavaria = { regionId: "DEU.2_1", regionName: "Bayern", polity: "Germany", polityKey: "Germany" };
const germany = { polity: "Germany", polityKey: "Germany" };

test("a place is named the way a sentence needs it", () => {
  assert.equal(listenInPlaceLabel(bavaria), "Bayern, in Germany");
  assert.equal(listenInPlaceLabel({ regionId: "R1", regionName: "The Wastes" }), "The Wastes");
  assert.equal(listenInPlaceLabel(germany), "Germany");
  assert.equal(listenInPlaceLabel(null), "");
  assert.equal(listenInRequest(bavaria), "Show what people in Bayern (Germany) are posting today.");
  assert.equal(listenInRequest({ regionId: "R1", regionName: "The Wastes" }), "Show what people in The Wastes are posting today.");
  assert.equal(listenInRequest(germany), "Show what people across Germany are posting today.");
});

test("a region is described by who holds it, what is in it and what lies beside it", () => {
  const text = describeListenInPlace({
    place: bavaria,
    region: {
      id: "DEU.2_1", name: "Bayern", owner: "Germany", sovereign: "Germany", claimants: [],
      cities: [{ name: "München", population: 1488000 }, { name: "Nürnberg", population: 0 }],
      neighbours: [{ id: "a", name: "Hessen", owner: "Germany" }, { id: "b", name: "Tirol", owner: "Austria" }, { id: "c", name: "Salzburg", owner: "Austria" }],
    },
  });
  assert.deepEqual(text.split("\n"), [
    "Place: Bayern, a region held by Germany.",
    "Towns and cities here: München (1,488,000), Nürnberg.",
    "Next to it: Hessen (Germany); Tirol, Salzburg (Austria).",
    "The posts come from people living in Bayern. What happens in the rest of Germany reaches them as news.",
  ]);
});

test("an occupied, claimed region under a group says so", () => {
  const region = {
    owner: "Russia", sovereign: "Ukraine", claimants: ["Ukraine", "Russia", "Donetsk Republic"],
    controlledByGroup: { name: "The Night Wolves", description: "a biker militia that runs the checkpoints" },
    cities: [{ name: "Donetsk", population: 900000, capital: true }],
    neighbours: [{ name: "No Man's Land", owner: "unowned" }],
  };
  const place = { regionId: "UKR.5_1", regionName: "Donetsk", polity: "Russia", polityKey: "Russia" };
  const lines = describeListenInPlace({ place, region }).split("\n");
  assert.equal(lines[0], "Place: Donetsk, a region held by Russia.");
  assert.equal(lines[1], "By right it belongs to Ukraine; Russia holds it.");
  assert.equal(lines[2], "Also claimed by Donetsk Republic.");
  assert.equal(lines[3], "On the ground it is run by The Night Wolves, which is not a country: a biker militia that runs the checkpoints.");
  assert.equal(lines[4], "Towns and cities here: Donetsk (900,000, capital).");
  assert.equal(lines[5], "Next to it: No Man's Land (held by no country).");
  // With groups switched off for the game, the group is not mentioned.
  assert.ok(!describeListenInPlace({ place, region, groupsOn: false }).includes("Night Wolves"));
});

test("a region nobody holds, and one the map could not describe, still have a place line", () => {
  assert.equal(
    describeListenInPlace({ place: { regionId: "R1", regionName: "The Wastes" }, region: { owner: "unowned", sovereign: "unowned" } }),
    "Place: The Wastes, a region that no country holds.\nThe posts come from people living in The Wastes.",
  );
  assert.equal(
    describeListenInPlace({ place: bavaria, region: null }).split("\n")[0],
    "Place: Bayern, a region held by Germany.",
  );
  assert.equal(describeListenInPlace({ place: null }), "");
});

test("a country is described as its own people know it", () => {
  const text = describeListenInPlace({
    place: germany,
    country: {
      name: "Germany",
      aliases: ["Federal Republic of Germany"],
      note: "Reunified in 1990",
      politics: {
        government: { form: "federal parliamentary republic", headOfState: { name: "Joachim Gauck", title: "President" }, headOfGovernment: { name: "Angela Merkel", title: "Chancellor" } },
        parties: [
          { name: "CDU", ideology: "Christian democracy", ruling: true, support: { percent: 33.6 } },
          { name: "SPD", coalition: true },
          { name: "" },
        ],
      },
      economy: "GDP-eq €3.1T; unemployment 6.1%",
      relationWithPlayer: { player: "France", status: "friendly" },
      overlords: [],
      puppets: [{ name: "Luxembourg", kind: "client" }],
      groups: ["The Hanse Cartel"],
    },
  });
  assert.deepEqual(text.split("\n"), [
    "Place: the whole of Germany. The posts come from all over the country, town and countryside alike.",
    "",
    "About Germany, as its own people know it:",
    "Also called Federal Republic of Germany.",
    "Reunified in 1990.",
    "Government: federal parliamentary republic.",
    "In office: head of state Joachim Gauck (President); head of government Angela Merkel (Chancellor).",
    "Parties: CDU (Christian democracy, in government, 34% support); SPD (in the governing coalition).",
    "Economy: GDP-eq €3.1T; unemployment 6.1%.",
    "It openly holds Luxembourg (client state).",
    "Part of its land is run by The Hanse Cartel, which is not a country.",
    "Its relations with France, the country the player leads, are friendly.",
  ]);
});

test("the player's own country is told apart, and a puppet's open overlord is named", () => {
  const own = describeListenInPlace({ place: germany, country: { name: "Germany", isPlayer: true, relationWithPlayer: { player: "Germany", status: "friendly" } } });
  assert.ok(own.endsWith("This is the country the player leads: what its government has done is what the player ordered."));
  assert.ok(!own.includes("relations with"));
  const puppet = describeListenInPlace({
    place: { polity: "Poland", polityKey: "Poland" },
    country: { name: "Poland", politics: { leader: "Bolesław Bierut" }, overlords: [{ name: "Soviet Union", kind: "satellite" }] },
  });
  assert.ok(puppet.includes("Leader: Bolesław Bierut."));
  assert.ok(puppet.includes("Poland is a puppet state of Soviet Union, openly."));
});

test("a country nothing is known about adds nothing", () => {
  assert.equal(
    describeListenInPlace({ place: germany, country: { name: "Germany" } }),
    "Place: the whole of Germany. The posts come from all over the country, town and countryside alike.",
  );
});

// The region's facts come from the same code that answers the AI's region_info
// lookup (lookupTools.js): this is that answer, read by the description.
test("what the map's own region lookup answers is what the description reads", async () => {
  const { buildLookupContext, executeLookup } = await import("./lookupTools.js");
  const square = (x, y) => ({ type: "Polygon", coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] });
  const context = buildLookupContext({
    regions: [
      { id: "ukr-kharkiv", name: "Kharkiv", geometry: square(36, 49) },
      { id: "ukr-zap", name: "Zaporizhzhia", geometry: square(35, 47) },
      { id: "ukr-dnipro", name: "Dnipro", geometry: square(35, 48) },
      { id: "rus-belgorod", name: "Belgorod", geometry: square(36, 50) },
    ],
    world: {
      regionOwnershipOverrides: { "ukr-kharkiv": "Ukraine", "ukr-zap": "Russian Federation", "ukr-dnipro": "Ukraine", "rus-belgorod": "Russian Federation" },
      regionSovereigntyOverrides: { "ukr-zap": "Ukraine" },
      regionClaimants: { "ukr-zap": ["Ukraine"] },
      groups: { "Free Cossacks": { name: "Free Cossacks", description: "an irregular host holding the river crossings" } },
      groupAreas: { "ukr-zap": "Free Cossacks" },
    },
    cities: [{ name: "Kharkiv", coordinates: [36.25, 49.99], population: 1430000, capital: "" }],
  });

  const kharkiv = describeListenInPlace({
    place: { regionId: "ukr-kharkiv", regionName: "Kharkiv", polity: "Ukraine", polityKey: "Ukraine" },
    region: executeLookup(context, "region_info", { regionId: "ukr-kharkiv" }),
  }).split("\n");
  assert.equal(kharkiv[0], "Place: Kharkiv, a region held by Ukraine.");
  assert.equal(kharkiv[1], "Towns and cities here: Kharkiv (1,430,000).");
  assert.match(kharkiv[2], /^Next to it: .*Belgorod \(Russian Federation\)/);

  const zap = describeListenInPlace({
    // The card that was clicked still said Ukraine; the map says who holds it.
    place: { regionId: "ukr-zap", regionName: "Zaporizhzhia", polity: "Russian Federation", polityKey: "Russian Federation" },
    region: executeLookup(context, "region_info", { regionId: "ukr-zap" }),
  });
  assert.ok(zap.includes("Place: Zaporizhzhia, a region held by Russian Federation."));
  assert.ok(zap.includes("By right it belongs to Ukraine; Russian Federation holds it."));
  assert.ok(zap.includes("On the ground it is run by Free Cossacks, which is not a country: an irregular host holding the river crossings."));
  // Ukraine is the sovereign, so its claim is not listed a second time.
  assert.ok(!zap.includes("Also claimed by"));
});
