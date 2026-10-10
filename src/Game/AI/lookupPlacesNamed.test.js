/*! Open Historia — places a text names, answered before anyone asks: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/lookupPlacesNamed.test.js
//
// placesNamedIn replaces a lookup round — a whole extra request — with reading
// the events the way a reader would. What it hands over is used to fill in
// fromCode, the losing side of a control change, so a wrong controller here
// becomes a wrong border on the map. The cases below are the ways a name match
// goes wrong: a short name inside a longer one, a name inside another word, an
// accent, and a city that is not a region.

import test from "node:test";
import assert from "node:assert/strict";

import { buildLookupContext, placesNamedIn } from "./lookupTools.js";

const square = (west, south, size = 1) => ({
  type: "Polygon",
  coordinates: [[[west, south], [west + size, south], [west + size, south + size], [west, south + size], [west, south]]],
});

const context = buildLookupContext({
  regions: [
    { id: "r-donetsk", name: "Donetsk Oblast", aliases: ["Donetsk"], owner: "Ukraine", geometry: square(37, 47) },
    { id: "r-luhansk", name: "Luhansk Oblast", owner: "Ukraine", geometry: square(39, 48) },
    { id: "r-ossetia-s", name: "South Ossetia", owner: "Georgia", geometry: square(43, 42) },
    { id: "r-ossetia-n", name: "Ossetia", owner: "Russian Federation", geometry: square(44, 43) },
    { id: "r-ob", name: "Ob", owner: "Russian Federation", geometry: square(70, 60) },
    { id: "r-oman", name: "Oman", owner: "Oman", geometry: square(56, 21) },
    { id: "r-crimea", name: "Crimea", owner: "Russian Federation", geometry: square(33, 44) },
    { id: "r-zaporizhia", name: "Zaporizhzhia", owner: "Ukraine", geometry: square(35, 47) },
  ],
  world: {
    regionOwnershipOverrides: { "r-luhansk": "Luhansk People's Republic" },
    regionSovereigntyOverrides: { "r-luhansk": "Ukraine", "r-crimea": "Ukraine" },
    regionClaimants: { "r-crimea": ["Ukraine"] },
  },
  cities: [
    { name: "Mariupol", coordinates: [37.5, 47.1] },
    { name: "Atlantis", coordinates: [-40, 30] },
    { name: "Melitopol", coordinates: [35.4, 47.2], aliases: ["Melitopolis"] },
  ],
});

test("a named region comes back with who controls it, who lawfully owns it, and who claims it", () => {
  const places = placesNamedIn(context, "Separatist columns enter Luhansk Oblast while Crimea stays quiet.");
  assert.deepEqual(places, [
    { place: "Luhansk Oblast", kind: "region", controller: "Luhansk People's Republic", lawfulOwner: "Ukraine" },
    { place: "Crimea", kind: "region", controller: "Russian Federation", lawfulOwner: "Ukraine", claimants: ["Ukraine"] },
  ]);
});

test("a city answers with the region it stands in and that region's controller", () => {
  assert.deepEqual(placesNamedIn(context, "Shelling resumes around Mariupol."), [
    { place: "Mariupol", kind: "city", region: "Donetsk Oblast", controller: "Ukraine" },
  ]);
  // Under an alias, too, reported as the text spelled it.
  assert.equal(placesNamedIn(context, "The garrison of Melitopolis surrenders.")[0].place, "Melitopolis");
  assert.equal(placesNamedIn(context, "The garrison of Melitopolis surrenders.")[0].region, "Zaporizhzhia");
});

test("a city the map has no region for is said to be off the map rather than guessed", () => {
  assert.deepEqual(placesNamedIn(context, "An expedition reaches Atlantis."), [
    { place: "Atlantis", kind: "city", region: "not on this map" },
  ]);
});

test("the longer name wins: South Ossetia is not also Ossetia", () => {
  const places = placesNamedIn(context, "Georgian police withdraw from South Ossetia.");
  assert.deepEqual(places.map((place) => place.place), ["South Ossetia"]);
  // But both are named when the text names both.
  const both = placesNamedIn(context, "Refugees cross from South Ossetia into Ossetia.");
  assert.deepEqual(both.map((place) => place.place), ["South Ossetia", "Ossetia"]);
});

test("an alias finds its region, reported under the word the text used", () => {
  const places = placesNamedIn(context, "Fighting around Donetsk intensifies.");
  assert.deepEqual(places, [{ place: "Donetsk", kind: "region", region: "Donetsk Oblast", controller: "Ukraine" }]);
});

test("whole words only, and never a name of three letters or fewer", () => {
  assert.deepEqual(placesNamedIn(context, "Romania observes the obvious: nobody obeys."), []);
  assert.deepEqual(placesNamedIn(context, "Barges move down the Ob."), []);
  assert.equal(placesNamedIn(context, "Talks open in Oman.").length, 1);
});

test("accents and case are folded on both sides", () => {
  assert.equal(placesNamedIn(context, "ZAPORÍZHZHIA falls silent.")[0]?.place, "Zaporizhzhia");
});

test("places come back in the order the text names them, each once, and capped", () => {
  const places = placesNamedIn(context, "From Crimea to Luhansk Oblast and back to Crimea, then Oman.");
  assert.deepEqual(places.map((place) => place.place), ["Crimea", "Luhansk Oblast", "Oman"]);
  assert.equal(placesNamedIn(context, "Crimea, Luhansk Oblast, Oman.", { limit: 2 }).length, 2);
});

test("nothing to read, nothing back", () => {
  assert.deepEqual(placesNamedIn(context, ""), []);
  assert.deepEqual(placesNamedIn(context, null), []);
  assert.deepEqual(placesNamedIn(null, "Crimea"), []);
});
