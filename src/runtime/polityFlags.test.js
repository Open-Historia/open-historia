// Run: node --test src/runtime/polityFlags.test.js
//
// Which flag a polity shows (polityFlags.js). The order is: a custom flag from
// the game's flags.json, then the flag on the polity record, then a single
// explicit map reference, then a stock country the record points at without
// ambiguity. A polity with no record at all keeps the plain stock path.

import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeFlagMap,
  resolveChosenPolityFlag,
  resolvePolityFlag,
  resolveWritablePolityKey,
} from "./polityFlags.js";

const FRANCE_FLAG = "https://flagcdn.com/fr.svg";
const GERMANY_FLAG = "https://flagcdn.com/de.svg";
const MONGOLIA_FLAG = "https://flagcdn.com/mn.svg";
const FACTION_FLAG = "data:image/png;base64,FACTION";

const worldWith = (polityOverrides) => ({ polityOverrides });

test("a custom flag wins over the record's flag and its map reference", () => {
  const world = worldWith({
    "French Republic": { name: "French Republic", flag: "data:legacy", mapRefs: { gadm0: ["FRA"] } },
  });
  const flag = resolvePolityFlag({ polity: "French Republic", world, flags: { "French Republic": "data:custom" } });
  assert.deepEqual(flag, { imageUrl: "data:custom", polityKey: "French Republic", source: "custom" });
});

test("a custom flag stored under an alias still finds the polity", () => {
  const world = worldWith({ "French Republic": { name: "French Republic", aliases: ["Marianne"] } });
  const flag = resolvePolityFlag({ polity: { polityKey: "French Republic" }, world, flags: { Marianne: "data:alias" } });
  assert.equal(flag.source, "custom");
  assert.equal(flag.imageUrl, "data:alias");
  assert.equal(flag.polityKey, "French Republic");
});

test("with no custom flag, the record's own flag is used", () => {
  const world = worldWith({
    "French Republic": { name: "French Republic", flag: "data:legacy", mapRefs: { gadm0: ["FRA"] } },
  });
  const flag = resolvePolityFlag({ polity: "French Republic", world });
  assert.deepEqual(flag, { imageUrl: "data:legacy", polityKey: "French Republic", source: "legacy-polity" });
});

test("a single map reference gives its stock flag", () => {
  const world = worldWith({ "Frankish Realm": { name: "Frankish Realm", mapRefs: { gadm0: ["fra", "FRA"] } } });
  const flag = resolvePolityFlag({ polity: "Frankish Realm", world });
  assert.deepEqual(flag, { imageUrl: FRANCE_FLAG, mapCode: "FRA", polityKey: "Frankish Realm", source: "map-ref" });
});

test("two map references pick no flag rather than an arbitrary one", () => {
  const world = worldWith({ "Frankish Realm": { name: "Frankish Realm", mapRefs: { gadm0: ["FRA", "DEU"] } } });
  const flag = resolvePolityFlag({ polity: "Frankish Realm", world });
  assert.deepEqual(flag, { imageUrl: null, polityKey: "Frankish Realm", source: "none" });
});

test("a record that names one stock country unambiguously gets that country's flag", () => {
  const world = worldWith({ Mongolia: { name: "Mongolia", color: "#123456" } });
  const flag = resolvePolityFlag({ polity: "Mongolia", world });
  assert.deepEqual(flag, {
    imageUrl: MONGOLIA_FLAG,
    mapCode: "MNG",
    source: "stock-record-identity",
    polityKey: "Mongolia",
  });
});

test("a record whose code and name point at different stock countries gets no stock flag", () => {
  const world = worldWith({ "Odd Union": { name: "Odd Union", code: "DEU", aliases: ["Mongolia"] } });
  const flag = resolvePolityFlag({ polity: "Odd Union", world });
  assert.equal(flag.source, "none");
  assert.equal(flag.imageUrl, null);
});

test("the record's code alone is a bridge to its stock flag", () => {
  const world = worldWith({ "Weimar Republic": { name: "Weimar Republic", code: "DEU" } });
  const flag = resolvePolityFlag({ polity: "Weimar Republic", world });
  assert.equal(flag.source, "stock-record-identity");
  assert.equal(flag.imageUrl, GERMANY_FLAG);
  assert.equal(flag.polityKey, "Weimar Republic");
});

test("a stock country with no record keeps its built-in flag", () => {
  const flag = resolvePolityFlag({ polity: "France", world: {} });
  assert.deepEqual(flag, { imageUrl: FRANCE_FLAG, mapCode: "FRA", polityKey: "France", source: "stock" });
});

test("an invented polity with no record and no flag has none", () => {
  const flag = resolvePolityFlag({ polity: "Kingdom of Nowhere", world: {} });
  assert.deepEqual(flag, { imageUrl: null, polityKey: "", source: "none" });
  assert.deepEqual(resolvePolityFlag(), { imageUrl: null, polityKey: "", source: "none" });
});

test("flag keys are moved onto the polity's stable key, and the stable key wins", () => {
  const world = worldWith({ "French Republic": { name: "French Republic", aliases: ["Marianne"] } });
  assert.deepEqual(
    canonicalizeFlagMap({ Marianne: "data:alias", "French Republic": "data:canonical", Elsewhere: "data:x", Empty: "" }, world),
    { "French Republic": "data:canonical", Elsewhere: "data:x" },
  );
  assert.deepEqual(canonicalizeFlagMap(null, world), {});
});

test("a flag is written under the polity's stable key, or the name given when there is none", () => {
  const world = worldWith({ "French Republic": { name: "French Republic", aliases: ["Marianne"] } });
  assert.equal(resolveWritablePolityKey("Marianne", world), "French Republic");
  assert.equal(resolveWritablePolityKey({ name: "Kingdom of Nowhere" }, world), "Kingdom of Nowhere");
  assert.equal(resolveWritablePolityKey(" ", world), "");
});

test("a landless faction keeps the flag written to flags.json for it", () => {
    const world = { polityOverrides: { "Free Kurdish Front": { name: "Free Kurdish Front" } } };
    const flags = { "Free Kurdish Front": FACTION_FLAG };
    const polity = { polityKey: "Free Kurdish Front", code: "Free Kurdish Front", name: "Free Kurdish Front" };
    const chosen = resolveChosenPolityFlag({ polity, world, flags });
    assert.equal(chosen.source, "custom");
    assert.equal(chosen.imageUrl, FACTION_FLAG);
});

test("a flag set on the polity's record counts as chosen", () => {
    const world = { polityOverrides: { "Army of the Andes": { name: "Army of the Andes", flag: FACTION_FLAG } } };
    const polity = { polityKey: "Army of the Andes", code: "Army of the Andes", name: "Army of the Andes" };
    const chosen = resolveChosenPolityFlag({ polity, world, flags: {} });
    assert.equal(chosen.source, "legacy-polity");
    assert.equal(chosen.imageUrl, FACTION_FLAG);
});

test("a flag derived from a map reference or a stock code is not chosen", () => {
    const world = { polityOverrides: { "French Resistance": { name: "French Resistance", mapRefs: { gadm0: ["FRA"] } } } };
    const polity = { polityKey: "French Resistance", code: "French Resistance", name: "French Resistance" };
    assert.equal(resolvePolityFlag({ polity, world, flags: {} }).source, "map-ref");
    const chosen = resolveChosenPolityFlag({ polity, world, flags: {} });
    assert.equal(chosen.source, "none");
    assert.equal(chosen.imageUrl, null);

    const stock = resolvePolityFlag({ polity: { polityKey: "FRA", code: "FRA", name: "France" }, world: {}, flags: {} });
    assert.equal(stock.source, "stock");
    assert.equal(resolveChosenPolityFlag({ polity: { polityKey: "FRA", code: "FRA", name: "France" }, world: {}, flags: {} }).imageUrl, null);
});
