/*! Open Historia — the places events list, answered before anyone asks: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/lookupPlacesNamed.test.js
//
// placesListed replaces a lookup round — a whole extra request — with looking
// up the places the events list in their own `places` field, and the regions
// their operations name. What it hands over is used to fill in fromCode, the
// losing side of a control change, so a wrong controller here becomes a wrong
// border on the map. Each place is found by its exact name as the kind it was
// given; it used to be found in the events' words, which missed every name in
// a sentence written without spaces and found map names inside other words.

import test from "node:test";
import assert from "node:assert/strict";

import { buildLookupContext, placesListed } from "./lookupTools.js";
import { readEventPlace } from "./eventPlaces.js";

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
    { id: "r-salmon", name: "Salmon", owner: "United States", geometry: square(-114, 45) },
    { id: "r-crimea", name: "Crimea", owner: "Russian Federation", geometry: square(33, 44) },
    { id: "r-zaporizhia", name: "Zaporizhzhia", owner: "Ukraine", geometry: square(35, 47) },
    { id: "r-georgia-us", name: "Georgia", owner: "United States", geometry: square(-84, 32) },
    { id: "r-georgia-adj", name: "Georgia", owner: "Georgia", geometry: square(42, 41) },
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

const listed = (...written) => written.map(readEventPlace).filter(Boolean);

test("a listed region comes back with who controls it, who lawfully owns it, and who claims it", () => {
  assert.deepEqual(placesListed(context, listed("region: Luhansk Oblast", "region: Crimea")), [
    { place: "Luhansk Oblast", kind: "region", controller: "Luhansk People's Republic", lawfulOwner: "Ukraine" },
    { place: "Crimea", kind: "region", controller: "Russian Federation", lawfulOwner: "Ukraine", claimants: ["Ukraine"] },
  ]);
});

test("a city answers with the region it stands in and that region's controller", () => {
  assert.deepEqual(placesListed(context, listed("city: Mariupol, country: Ukraine")), [
    { place: "Mariupol", kind: "city", region: "Donetsk Oblast", controller: "Ukraine" },
  ]);
  // Under an alias, too, reported as the event wrote it.
  const [alias] = placesListed(context, listed("city: Melitopolis"));
  assert.equal(alias.place, "Melitopolis");
  assert.equal(alias.region, "Zaporizhzhia");
});

test("a city the map has no region for is said to be off the map rather than guessed", () => {
  assert.deepEqual(placesListed(context, listed("city: Atlantis")), [
    { place: "Atlantis", kind: "city", region: "not on this map" },
  ]);
});

test("a place is found by its own name only: Ossetia is not South Ossetia, and words are never read", () => {
  assert.deepEqual(placesListed(context, listed("region: South Ossetia")).map((place) => place.place), ["South Ossetia"]);
  assert.deepEqual(placesListed(context, listed("region: Ossetia")).map((place) => place.controller), ["Russian Federation"]);
  // A name with no kind is not looked up at all (eventPlaces.js): "the salmon
  // run" is a thing an event may be about, and the map has a region called Salmon.
  assert.deepEqual(placesListed(context, listed("salmon run", "Salmon")), []);
  // Nor is a kind that is no region or city.
  assert.deepEqual(placesListed(context, listed("country: Ukraine", "unit: 3rd Army")), []);
  // A name the map does not have is left out.
  assert.deepEqual(placesListed(context, listed("region: Donbas")), []);
});

test("an alias finds its region, reported under the name the event used", () => {
  assert.deepEqual(placesListed(context, listed("region: Donetsk")), [
    { place: "Donetsk", kind: "region", region: "Donetsk Oblast", controller: "Ukraine" },
  ]);
});

test("accents and case are folded on both sides", () => {
  assert.equal(placesListed(context, listed("region: ZAPORÍZHZHIA"))[0]?.region, "Zaporizhzhia");
});

test("two regions of one name: the country written beside it decides, or neither is taken", () => {
  assert.deepEqual(placesListed(context, listed("region: Georgia, country: United States")).map((place) => place.controller), ["United States"]);
  assert.deepEqual(placesListed(context, listed("region: Georgia, country: Georgia")).map((place) => place.controller), ["Georgia"]);
  assert.deepEqual(placesListed(context, listed("region: Georgia")), []);
});

test("an operation's region is looked up by its name or the map's id for it", () => {
  const entries = [{ kind: "region", name: "r-crimea", country: "" }, { kind: "region", name: "Luhansk Oblast", country: "" }];
  assert.deepEqual(placesListed(context, entries).map((place) => [place.place, place.region ?? place.place, place.controller]), [
    ["r-crimea", "Crimea", "Russian Federation"],
    ["Luhansk Oblast", "Luhansk Oblast", "Luhansk People's Republic"],
  ]);
});

test("a map named in another script is read the same way, in any language", () => {
  const cyrillic = buildLookupContext({
    regions: [
      { id: "r-krym", name: "Крым", owner: "Российская Федерация", geometry: square(33, 44) },
      { id: "r-donetsk", name: "Донецкая область", aliases: ["Донецк"], owner: "Украина", geometry: square(37, 47) },
    ],
    world: { regionClaimants: { "r-krym": ["Украина"] } },
    cities: [{ name: "Севастополь", coordinates: [33.5, 44.6] }, { name: "Мариуполь", coordinates: [37.5, 47.1] }],
  });
  assert.deepEqual(placesListed(cyrillic, listed("city: Мариуполь", "region: Донецкая область", "region: Крым", "city: СЕВАСТОПОЛЬ")), [
    { place: "Мариуполь", kind: "city", region: "Донецкая область", controller: "Украина" },
    { place: "Донецкая область", kind: "region", controller: "Украина" },
    { place: "Крым", kind: "region", controller: "Российская Федерация", claimants: ["Украина"] },
    { place: "СЕВАСТОПОЛЬ", kind: "city", region: "Крым", controller: "Российская Федерация", claimants: ["Украина"] },
  ]);

  // A name in a script written without spaces is found as surely as any other:
  // reading an event's words for it found nothing in a sentence like
  // "示威者聚集在香港特别行政区政府总部外。".
  const chinese = buildLookupContext({
    regions: [{ id: "r-hk", name: "香港特别行政区", owner: "中国", geometry: square(114, 22) }],
    world: {},
    cities: [],
  });
  assert.deepEqual(placesListed(chinese, listed("region: 香港特别行政区")), [
    { place: "香港特别行政区", kind: "region", controller: "中国" },
  ]);
});

test("places come back in the order listed, each once, and capped", () => {
  const places = placesListed(context, listed("region: Crimea", "region: Luhansk Oblast", "region: Crimea", "region: Ossetia"));
  assert.deepEqual(places.map((place) => place.place), ["Crimea", "Luhansk Oblast", "Ossetia"]);
  assert.equal(placesListed(context, listed("region: Crimea", "region: Luhansk Oblast", "region: Ossetia"), { limit: 2 }).length, 2);
});

test("nothing listed, nothing back", () => {
  assert.deepEqual(placesListed(context, []), []);
  assert.deepEqual(placesListed(context, null), []);
  assert.deepEqual(placesListed(null, listed("region: Crimea")), []);
});
