/*! Open Historia — the world's towns: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/worldCities.test.js
//
// Runs without node_modules, and without the list itself, which is 7.9 MB and
// not in the repository: the entries below are copied from it, in its order.

import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { distanceKm } from "./placement.js";
import { SAME_TOWN_KM, eachWorldCity, indexWorldCities, indexWorldCityBytes } from "./worldCities.js";

const city = (name, lng, lat, population) => ({ name, coord: [lng, lat], population, capital: false, tags: ["city", "small_city"] });
// One town is on the list once for each zoom level its tile sweep found it at,
// coarsest first: Grand Forks twice, Kharkiv three times.
const SEED = [
  city("Zvëzdnyy", null, null, 10),
  city("Grand Forks", -97.09717, 47.91634, 68853),
  city("Kharkiv", 36.21094, 50.00774, 1421125),
  city("Kharkiv", 36.21094, 49.97949, 1421125),
  city("Niagara Falls", -79.01367, 43.08494, 48198),
  city("Egg", 8.70117, 47.30903, 8596),
  city("Springfield", -93.25195, 37.16032, 289041),
  city("Grand Forks", -97.08618, 47.9237, 68853),
  city("Kharkiv", 36.23291, 49.99362, 1421125),
  city("Niagara Falls", -79.01367, 43.09296, 48198),
  city("Niagara Falls", -79.10156, 43.06086, 94415),
  city("Egg", 8.69019, 47.30158, 8596),
  city("Egg", 8.66821, 47.19718, 8596),
  city("Springfield", -93.2959, 37.19533, 289041),
  city("Springfield", -89.65942, 39.77477, 156240),
  city("Springfield", -72.54272, 42.11452, 438889),
  city("São José do Jacuípe", -39.86938, -11.41542, 10187),
  city("Sault Ste. Marie", -84.35303, 46.53619, 72051),
];
const rounded = (towns) => towns.map(([lng, lat]) => [Number(lng.toFixed(5)), Number(lat.toFixed(5))]);

test("a town swept from several tiles is one town, where its finest tile put it", () => {
  const index = indexWorldCities(SEED);
  assert.deepEqual(rounded(index.find("Grand Forks")), [[-97.08618, 47.9237]], "counted as written it would be two towns of one name, and never placed");
  assert.deepEqual(rounded(index.find("Kharkiv")), [[36.23291, 49.99362]]);
  assert.deepEqual(rounded(index.find("Springfield")), [[-93.2959, 37.19533], [-89.65942, 39.77477], [-72.54272, 42.11452]]);
  assert.deepEqual([index.names, index.towns], [7, 11], "eighteen entries, seventeen with a point");
});

test("two towns of one name stay two: across a river with another population, or a little further off with the same", () => {
  const index = indexWorldCities(SEED);
  // New York's and Ontario's, eight kilometres apart.
  assert.deepEqual(rounded(index.find("Niagara Falls")), [[-79.01367, 43.09296], [-79.10156, 43.06086]]);
  assert.ok(distanceKm([-79.01367, 43.09296], [-79.10156, 43.06086]) < SAME_TOWN_KM, "nearer than two readings of one town can be");
  // The nearest pair on the whole list that is not one town read twice.
  assert.deepEqual(rounded(index.find("Egg")), [[8.69019, 47.30158], [8.66821, 47.19718]]);
  assert.ok(distanceKm([8.69019, 47.30158], [8.66821, 47.19718]) > SAME_TOWN_KM);
});

test("a name is found however it is cased, accented or hyphenated, and only as the list spells it", () => {
  const index = indexWorldCities(SEED);
  for (const name of ["São José do Jacuípe", "sao jose do jacuipe", "SAO-JOSE DO JACUIPE", "  São  José do Jacuípe "]) {
    assert.equal(index.find(name).length, 1, name);
  }
  assert.equal(index.find("Sault Ste Marie").length, 1, "a full stop is not part of a name");
  assert.deepEqual(index.find("Grand Fork"), [], "a near miss is not a town: something is about to be put there");
  assert.deepEqual(index.find("Forks"), []);
  assert.deepEqual([index.find(""), index.find(null), index.find(undefined)], [[], [], []]);
});

test("an entry with no point or no name is left out, and what is not a list is an empty one", () => {
  const index = indexWorldCities([
    ...SEED,
    { name: "Nullville", coord: [null, 12], population: 5 },
    { name: "Origin", coord: [0, 0], population: 5 },
    { name: "Offworld", coord: [200, 95], population: 5 },
    { name: "Coordless", population: 5 },
    { name: "   ", coord: [10, 10], population: 5 },
    { coord: [11, 11], population: 5 },
    null,
  ]);
  for (const name of ["Zvëzdnyy", "Nullville", "Origin", "Offworld", "Coordless"]) assert.deepEqual(index.find(name), [], name);
  assert.equal(index.towns, 11);
  for (const notAList of [null, undefined, {}, "<!doctype html>"]) assert.equal(indexWorldCities(notAList).towns, 0);
});

test("the list's seventy thousand names are folded without being remembered", () => {
  // Through the memo (regionMatch.js) they would empty it of the map's own
  // names and stay in it, where nothing can see them from here.
  const source = readFileSync(new URL("./worldCities.js", import.meta.url), "utf8");
  assert.ok(source.includes("const key = foldRegionKeyOnce(city.name);"));
  assert.ok(source.includes("const first = firstOf.get(foldRegionKey(name));"), "a name being looked up is one string, and may be");
});

// --- the file, an entry at a time ---
//
// Parsed whole, the 7.9 MB file is its bytes, fifteen megabytes of string and
// nineteen of objects all at once, on a phone. It is walked instead, and the
// walk has to find exactly the entries a whole parse would.

const bytesOf = (text) => new TextEncoder().encode(text);
const entriesOf = (text) => {
  const seen = [];
  eachWorldCity(bytesOf(text), (entry) => seen.push(entry));
  return seen;
};

test("the file walked an entry at a time is the file parsed whole", () => {
  const awkward = [
    ...SEED,
    city('Quote "Town"', 1, 2, 3),
    city('One quote " and then a bracket ]', 2, 3, 4),
    city("Back\\slash", 3, 4, 5),
    city("Ends in a backslash\\", 5, 6, 7),
    city("Brackets ] [ } { and a comma, in a name", 7, 8, 9),
    city("Ünïcödé 東京 🏙️", 9, 10, 11),
    { name: "Nested", coord: [11, 12], population: 13, more: { deeper: [{ and: "deeper }" }] } },
  ];
  // As the file is written, indented, and with a byte order mark in front.
  const byteOrderMark = String.fromCharCode(0xfeff);
  for (const text of [JSON.stringify(awkward), JSON.stringify(awkward, null, 2), `${byteOrderMark}${JSON.stringify(awkward)}\n`]) {
    assert.deepEqual(entriesOf(text), awkward);
  }
  // Escapes JSON.stringify does not write, and things in a list that are no entry.
  assert.deepEqual(entriesOf('[1, "a [string]", null, {"name":"caf\\u00e9 \\"x\\" \\\\"}, true, ["x"]]'), [{ name: 'café "x" \\' }, ["x"]]);
  assert.deepEqual(rounded(indexWorldCityBytes(bytesOf(JSON.stringify(SEED, null, 1))).find("Grand Forks")), [[-97.08618, 47.9237]]);
  const [walked, parsed] = [indexWorldCityBytes(bytesOf(JSON.stringify(awkward))), indexWorldCities(awkward)];
  assert.deepEqual([walked.names, walked.towns], [parsed.names, parsed.towns]);
  assert.deepEqual(walked.find("Ünïcödé 東京 🏙️"), parsed.find("Ünïcödé 東京 🏙️"));
});

test("what is not a list has no entries, and a list that stops short is not read at all", () => {
  for (const text of ["", "   ", "<!doctype html><title>app</title>", '{"error":"not found"}', '{"cities":[{"name":"A","coord":[1,2]}]}', "null", '"a string"']) {
    assert.deepEqual(entriesOf(text), [], text);
  }
  // Cut off before the closing bracket, between entries, and inside a name:
  // half a list would make the one Springfield it reached look like the only one.
  const whole = JSON.stringify(SEED);
  for (const cut of [whole.slice(0, -1), whole.slice(0, whole.indexOf('{"name":"Springfield"')), whole.slice(0, whole.indexOf("Kharkiv") + 3)]) {
    assert.throws(() => indexWorldCityBytes(bytesOf(cut)), /stops before it closes/);
  }
  assert.throws(() => entriesOf('[{"name": Grand Forks}]'), SyntaxError, "an entry that is not JSON is JSON.parse's to refuse");
});

// --- reading the list ---

// Each test gets its own copy of the module, so nothing is kept from the last.
let copy = 0;
const freshModule = () => import(`./worldCities.js?copy=${copy++}`);

// fetch answers from the list in turn; each answer is a Response, or an Error
// to reject with.
const withFetch = async (answers, run) => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
    console.warn = originalWarn;
  }
};
const listResponse = () => new Response(JSON.stringify(SEED), { status: 200, headers: { "Content-Type": "application/json" } });

test("the list is read once, from where the game serves it, and kept", async () => {
  const { loadWorldCities } = await freshModule();
  await withFetch([listResponse()], async (calls) => {
    const index = await loadWorldCities();
    assert.equal(index.find("Grand Forks").length, 1);
    assert.equal(await loadWorldCities(), index);
    assert.deepEqual(calls, ["/assets/cities-seed.json"]);
  });
});

test("a list that did not arrive is not kept: the next caller asks again", async () => {
  const { loadWorldCities } = await freshModule();
  const page = new Response("<!doctype html><title>app</title>", { status: 200, headers: { "Content-Type": "text/html" } });
  const empty = new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  const cutShort = new Response(JSON.stringify(SEED).slice(0, -200), { status: 200, headers: { "Content-Type": "application/json" } });
  await withFetch([new TypeError("Failed to fetch"), page, new Response("", { status: 503 }), empty, cutShort, listResponse()], async (calls) => {
    for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(await loadWorldCities(), null);
    assert.equal((await loadWorldCities()).towns, 11);
    assert.equal(calls.length, 6);
  });
});

test("callers that ask at once share one download", async () => {
  const { loadWorldCities } = await freshModule();
  await withFetch([listResponse()], async (calls) => {
    const [first, second] = await Promise.all([loadWorldCities(), loadWorldCities()]);
    assert.equal(first, second);
    assert.equal(first.towns, 11);
    assert.equal(calls.length, 1);
  });
});
