import assert from "node:assert/strict";
import { test } from "node:test";
import { areaRegionsFor, baseCountryOf, buildAreaIndex, findArea, readAreaName, splitTerritories } from "./namedAreas.js";

// The built-in map in small: a region is held by `country` and belongs, by
// geography, to the country its code names.
const NAMES = { USA: "United States", PRI: "Puerto Rico", GRL: "Greenland", DNK: "Denmark", UKR: "Ukraine", RUS: "Russia", CZE: "Czechia" };
const toName = (code) => NAMES[code] ?? code;
const CATALOG = [
    { id: "1", name: "Atlanta", country: "United States", countryCode: "USA" },
    { id: "2", name: "Savannah", country: "United States", countryCode: "USA" },
    { id: "760", name: "Puerto Rico", country: "United States", countryCode: "PRI" },
    { id: "4709", name: "Nuuk", country: "Denmark", countryCode: "GRL" },
    { id: "4710", name: "Sermersooq", country: "Denmark", countryCode: "GRL" },
    { id: "50", name: "Copenhagen", country: "Denmark", countryCode: "DNK" },
    { id: "60", name: "Kerch", country: "Russia", countryCode: "UKR" },
    { id: "61", name: "Kyiv", country: "Ukraine", countryCode: "UKR" },
    { id: "70", name: "Moscow", country: "Russia", countryCode: "RUS" },
    { id: "80", name: "Brno", country: "Czech Republic", countryCode: "CZE" },
];

test("a region belongs to the country its code names, whoever holds it", () => {
    assert.equal(baseCountryOf(CATALOG[3], toName), "Greenland");
    assert.equal(baseCountryOf(CATALOG[0], toName), "United States");
    // A code nothing can name says nothing: a hand-drawn map's region is of the
    // country the map bakes in.
    assert.equal(baseCountryOf({ id: "x", country: "Gondor", countryCode: "X01" }, toName), "Gondor");
    assert.equal(baseCountryOf({ id: "y", country: "Gondor" }, toName), "Gondor");
});

test("an area is found by its name, with or without an article, or by a code", () => {
    const index = buildAreaIndex(CATALOG, { toName });
    assert.deepEqual(findArea(index, "Greenland", { toName }).regions.map((region) => region.id), ["4709", "4710"]);
    assert.equal(findArea(index, "greenland", { toName }).name, "Greenland");
    assert.equal(findArea(index, "the United States", { toName }).regions.length, 2);
    assert.equal(findArea(index, "PRI", { toName }).name, "Puerto Rico");
    assert.equal(findArea(index, "Atlantis", { toName }), null);
    assert.equal(findArea(index, "", { toName }), null);
});

test("\"country: <name>\" is read as the whole polity or as the area", () => {
    // The losing side itself: the whole of its land, as it always was.
    assert.equal(readAreaName({ tagged: true, named: { isArea: true, isOwner: true, holdsLand: true }, loser: { given: true, sameAsNamed: true } }), "country");
    assert.equal(readAreaName({ tagged: true, named: { isArea: true, isOwner: true, holdsLand: true }, loser: {} }), "country");
    // A territory, which is no polity: its regions.
    assert.equal(readAreaName({ tagged: true, named: { isArea: true }, loser: { given: true } }), "area");
    assert.equal(readAreaName({ tagged: true, named: { isArea: true }, loser: {} }), "area");
    // Beside a different losing side it is never that side's whole country:
    // "country: Ukraine" from Russia is the Ukrainian land Russia holds.
    assert.equal(readAreaName({ tagged: true, named: { isArea: true, isOwner: true, holdsLand: true }, loser: { given: true } }), "area");
    // A polity the map knows, with no land of its name anywhere: nothing moves.
    assert.equal(readAreaName({ tagged: true, named: { isOwner: true, holdsLand: true }, loser: { given: true } }), "none");
    // A name the map does not know at all is left to the older rule.
    assert.equal(readAreaName({ tagged: true, named: {}, loser: { given: true } }), "country");
});

test("a bare name is an area only where it is no polity with land", () => {
    assert.equal(readAreaName({ named: { isArea: true } }), "area");
    assert.equal(readAreaName({ named: { isArea: true, isOwner: true, holdsLand: false } }), "area");
    assert.equal(readAreaName({ named: { isArea: true, isOwner: true, holdsLand: true } }), "none");
    assert.equal(readAreaName({ named: {} }), "none");
});

test("an area moves only what the losing side holds of it", () => {
    const index = buildAreaIndex(CATALOG, { toName });
    const holderKeyOf = (id) => CATALOG.find((region) => region.id === id).country.toLowerCase();
    const ids = (area, options) => areaRegionsFor(area, { holderKeyOf, ...options }).map((region) => region.id);
    // Ukraine from Russia: Kerch, and not Kyiv, and nothing else of Russia's.
    assert.deepEqual(ids(findArea(index, "Ukraine"), { fromKey: "russia", toKey: "ukraine" }), ["60"]);
    assert.deepEqual(ids(findArea(index, "Greenland"), { fromKey: "denmark", toKey: "united states" }), ["4709", "4710"]);
    // No losing side named: all of it the receiver does not hold already.
    assert.deepEqual(ids(findArea(index, "Ukraine"), { toKey: "ukraine" }), ["60"]);
    // The losing side holds none of it.
    assert.deepEqual(ids(findArea(index, "Greenland"), { fromKey: "russia", toKey: "united states" }), []);
});

const withBase = (rows) => rows.map((region) => ({ ...region, base: baseCountryOf(region, toName) }));
const heldBy = (owner) => withBase(CATALOG.filter((region) => region.country === owner));
const POLITIES = new Set(["united states", "denmark", "russia", "ukraine", "czech republic"]);
const split = (owner) => splitTerritories(heldBy(owner), { ownerKey: owner.toLowerCase(), isPolity: (key) => POLITIES.has(key) });

test("a territory is an area that is not the power's own and that no polity is named after", () => {
    const usa = split("United States");
    assert.deepEqual(usa.home.map((region) => region.name), ["Atlanta", "Savannah"]);
    assert.deepEqual(usa.territories.map((territory) => [territory.name, territory.regions.length]), [["Puerto Rico", 1]]);
    assert.deepEqual(split("Denmark").territories.map((territory) => [territory.name, territory.regions.length]), [["Greenland", 2]]);
});

test("land taken from a country of the game stays in the list by name", () => {
    const russia = split("Russia");
    assert.deepEqual(russia.home.map((region) => region.name).sort(), ["Kerch", "Moscow"]);
    assert.deepEqual(russia.territories, []);
});

test("a power whose map name differs from its country's is not its own territory", () => {
    // "Czech Republic" holds regions whose country is "Czechia".
    const czech = split("Czech Republic");
    assert.deepEqual(czech.home.map((region) => region.name), ["Brno"]);
    assert.deepEqual(czech.territories, []);
});
