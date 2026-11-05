/*! Open Historia — country picker list tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Reported: every country listed three times in the diplomacy and spy pickers;
// searching a country sometimes did not show it; clicking a country listed it as
// selected without highlighting it. All of that follows from duplicate NAMES in
// the list, because the pickers key their tiles and their selection by name.

import assert from "node:assert/strict";
import test from "node:test";

import { dedupeByName, mergeCountryOverrides } from "./countryList.js";

const tiles = [
  { code: "DEU", name: "Germany" },
  { code: "FRA", name: "France" },
  { code: "ITA", name: "Italy" },
];

test("the reported bug: a name-keyed override no longer mints a twin", () => {
  // Exactly the shape found in real saves: keyed by name, carrying no code.
  const out = mergeCountryOverrides(tiles, { Germany: { note: "unified" }, Italy: {} });
  assert.deepEqual(out.map((c) => c.name), ["France", "Germany", "Italy"]);
  assert.equal(out.filter((c) => c.name === "Germany").length, 1);
  // The tile's real code survives — the override only ever described that entry.
  assert.equal(out.find((c) => c.name === "Germany").code, "DEU");
});

test("a rename updates the entry in place instead of splitting it", () => {
  const out = mergeCountryOverrides(tiles, { Germany: { name: "German Reich" } });
  assert.deepEqual(out.map((c) => c.name), ["France", "German Reich", "Italy"]);
  assert.equal(out.find((c) => c.name === "German Reich").code, "DEU", "keeps its tile code through a rename");
  assert.equal(out.some((c) => c.name === "Germany"), false, "the old name is gone, not duplicated");
});

test("a polity the AI invented is added, identified by its name", () => {
  const out = mergeCountryOverrides(tiles, { "Free Bavaria": { name: "Free Bavaria" } });
  assert.equal(out.length, 4);
  const added = out.find((c) => c.name === "Free Bavaria");
  assert.equal(added.code, "Free Bavaria", "no tile code exists, so the name is the identity");
});

test("an override carrying a real code still matches by code", () => {
  const out = mergeCountryOverrides(tiles, { anything: { code: "FRA", name: "French Republic" } });
  assert.equal(out.filter((c) => c.code === "FRA").length, 1);
  assert.equal(out.find((c) => c.code === "FRA").name, "French Republic");
});

test("a nameless override does not degrade a proper name to its key", () => {
  const out = mergeCountryOverrides(tiles, { DEU: {} });
  assert.equal(out.find((c) => c.code === "DEU").name, "Germany");
});

test("a campaign's worth of overrides yields no duplicate names", () => {
  // 85 overrides in one real save. Every one of them used to add a twin.
  const overrides = Object.fromEntries(tiles.map((c) => [c.name, { note: "x" }]));
  const out = mergeCountryOverrides(tiles, overrides);
  assert.equal(out.length, tiles.length);
  assert.equal(new Set(out.map((c) => c.name.toLowerCase())).size, out.length);
});

test("case and padding do not sneak a duplicate through", () => {
  const out = mergeCountryOverrides(tiles, { "  germany  ": { name: "  Germany  " } });
  assert.equal(out.filter((c) => c.name.trim() === "Germany").length, 1);
});

test("malformed input is survivable", () => {
  assert.deepEqual(mergeCountryOverrides(null, null), []);
  assert.deepEqual(mergeCountryOverrides(tiles, "nonsense").map((c) => c.name), ["France", "Germany", "Italy"]);
  assert.deepEqual(mergeCountryOverrides([{ name: "" }, null, { code: "X" }], {}), []);
  // An override with nothing usable is skipped rather than adding a blank row.
  assert.equal(mergeCountryOverrides(tiles, { "": {} }).length, 3);
});

test("dedupeByName is the picker's last line of defence", () => {
  const dupes = [{ code: "DEU", name: "Germany" }, { code: "Germany", name: "Germany" }, { code: "FRA", name: "France" }];
  assert.deepEqual(dedupeByName(dupes).map((c) => c.code), ["DEU", "FRA"], "the first wins, so a real code is kept");
  assert.deepEqual(dedupeByName(null), []);
});

import { holdsLand, landHolderNames, mergeStockAndDeclaredPolities, pickableCountries } from "./countryList.js";

// The Fault Lines map names its Russia "Russian Federation"; the tiles say
// "Russia". One polity, one picker entry, under the scenario's name.
test("a stock country folds onto the declared polity that carries its code", () => {
  const stockCodes = {
    "Russian Federation": "RUS",
    "West Germany": "DEU",
    "East Germany": "DEU",
    Russia: "RUS",
    Germany: "DEU",
    "United States": "USA",
  };
  const resolvers = {
    resolveStockCountryCode: (token) => stockCodes[String(token ?? "").trim()] ?? null,
    // A stock name is its own base; a declared name is itself.
    resolvePolityIdentity: (token) => ({ resolved: String(token ?? "").trim() }),
  };
  const merged = mergeStockAndDeclaredPolities(
    [
      { code: "RUS", name: "Russia" },
      { code: "USA", name: "United States" },
      { code: "DEU", name: "Germany" },
    ],
    {
      polityOverrides: {
        "Russian Federation": { code: "Russian Federation", name: "Russian Federation" },
        "West Germany": { code: "West Germany", name: "West Germany" },
        "East Germany": { code: "East Germany", name: "East Germany" },
        Atlantis: { code: "Atlantis", name: "Atlantis" },
      },
    },
    resolvers,
  );
  const names = merged.map((entry) => entry.name);
  assert.ok(!names.includes("Russia"), "the stock short name is gone");
  assert.deepEqual(merged.find((entry) => entry.name === "Russian Federation"), { code: "RUS", name: "Russian Federation" });
  // Two regimes on one homeland stay distinct, and the stock country stays too:
  // nothing can say which of them "is" Germany.
  assert.ok(names.includes("Germany") && names.includes("West Germany") && names.includes("East Germany"));
  assert.ok(names.includes("Atlantis"), "an invented polity is listed beside the stock list");
  assert.ok(names.includes("United States"));
  assert.equal(new Set(names.map((name) => name.toLowerCase())).size, names.length, "no duplicates");
});

// An absorbed country stayed in the pickers because nothing asked the map: the
// British Empire held all of Australia's regions and Australia was still listed.
test("landHolderNames reads who holds land from overrides, baked owners and sovereigns", () => {
  const regions = [
    { id: "AUS.1_1", country: "Australia" },
    { id: "AUS.2_1", country: "Australia" },
    { id: "FRA.1_1", country: "France" },
    { id: "UKR.1_1", country: "Ukraine" },
  ];
  const world = {
    regionOwnershipOverrides: { "AUS.1_1": "British Empire", "AUS.2_1": "British Empire", "UKR.1_1": "Russia" },
    regionSovereigntyOverrides: { "UKR.1_1": "Ukraine" },
  };
  const holders = landHolderNames(regions, world);
  assert.deepEqual([...holders].sort(), ["british empire", "france", "russia", "ukraine"]);
  assert.equal(holdsLand({ name: "Australia", code: "AUS" }, holders), false);
  assert.equal(holdsLand({ name: "Ukraine" }, holders), true, "an occupied homeland still counts");
});

test("on a hand-drawn world a stock region with no override holds nothing", () => {
  const regions = [{ id: "AUS.1_1", country: "Australia" }, { id: "drawn-1", country: "Albion" }];
  const holders = landHolderNames(regions, { customRegions: true, regionOwnershipOverrides: {} });
  assert.deepEqual([...holders], ["albion"]);
});

test("with no catalog to read, the pickers hide no one", () => {
  assert.equal(landHolderNames([], {}), null);
  const countries = [{ name: "Australia" }, { name: "France" }];
  assert.deepEqual(pickableCountries(countries, { holders: null, world: {} }), countries);
});

// A hand-drawn map (Game of Thrones, 298 AC) listed China, Ghana and every other
// stock country in its pickers, the GM panel and the AI's lookups: the stock
// tiles were merged in whatever map the world was drawn on. On a hand-drawn
// world a stock country is listed only when the map gives it land or the
// scenario declares it.
const stockResolvers = {
  resolveStockCountryCode: (token) => ({ China: "CHN", France: "FRA", Ghana: "GHA" })[String(token ?? "").trim()] ?? null,
  resolvePolityIdentity: (token) => ({ resolved: String(token ?? "").trim() }),
};
const stock = [{ code: "CHN", name: "China" }, { code: "FRA", name: "France" }, { code: "GHA", name: "Ghana" }];

test("on a hand-drawn world the stock countries are left out", () => {
  const merged = mergeStockAndDeclaredPolities(stock, {
    customRegions: true,
    regionOwnershipOverrides: { reg_got_0001: "House Stark", reg_got_0002: "The Crown" },
    polityOverrides: { "House Stark": { name: "House Stark" }, "The Crown": { name: "The Crown" } },
  }, stockResolvers);
  assert.deepEqual(merged.map((entry) => entry.name), ["House Stark", "The Crown"]);
});

test("on a hand-drawn world a stock country the map gives land, or the scenario declares, stays", () => {
  const merged = mergeStockAndDeclaredPolities(stock, {
    customRegions: true,
    regionOwnershipOverrides: { r1: "France", r2: "Atlantis" },
    regionSovereigntyOverrides: {},
    polityOverrides: { Atlantis: { name: "Atlantis" }, Ghana: { name: "Ghana" } },
  }, stockResolvers);
  const names = merged.map((entry) => entry.name);
  assert.ok(names.includes("France"), "holds a region on this map");
  assert.ok(names.includes("Ghana"), "declared by the scenario");
  assert.ok(!names.includes("China"));
  assert.deepEqual(merged.find((entry) => entry.name === "France"), { code: "FRA", name: "France" }, "keeps its stock code for flags");
});

test("a world drawn on the stock regions keeps the stock list", () => {
  const onStock = mergeStockAndDeclaredPolities(stock, {
    customRegions: true,
    regionOwnershipOverrides: { "FRA.1_1": "Atlantis" },
    polityOverrides: { Atlantis: { name: "Atlantis" } },
  }, stockResolvers);
  assert.equal(onStock.length, 4);
  const plain = mergeStockAndDeclaredPolities(stock, {}, stockResolvers);
  assert.equal(plain.length, 3);
});
