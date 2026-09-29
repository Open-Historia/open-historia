import test from "node:test";
import assert from "node:assert/strict";
import { resolveChosenPolityFlag, resolvePolityFlag } from "./polityFlags.js";

const FACTION_FLAG = "data:image/png;base64,FACTION";

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
