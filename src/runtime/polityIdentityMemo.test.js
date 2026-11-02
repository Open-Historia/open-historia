import assert from "node:assert/strict";
import test from "node:test";

import { buildPolityIdentityIndex, resolvePolityIdentity } from "./polityIdentity.js";

// The name folds remember their answers (2026-10-24). A remembered answer must
// be the answer: the same resolution on a first and a later asking, for names
// that differ only in what the fold removes, and after the store is emptied.
const world = {
  polityOverrides: {
    "Kingdom of Spain": { name: "Kingdom of Spain", aliases: ["Spain"], status: "active" },
    "Carlist Spain": { name: "Carlist Spain", status: "active" },
    "Empire of Brazil": { name: "Empire of Brazil", aliases: ["Brasil"], status: "active" },
    "Ottoman Empire": { name: "Ottoman Empire", status: "active" },
  },
  regionOwnershipOverrides: { R1: "Kingdom of Spain", R2: "Carlist Spain", R3: "Empire of Brazil", R4: "Ottoman Empire" },
};

const ask = (token) => resolvePolityIdentity(token, world).resolved;

test("a name resolves the same on every asking", () => {
  const tokens = ["Spain", "kingdom of spain", "  Kingdom   of  Spain ", "Kingdom of Spain", "Brasil", "Empire of Brazil", "Brazil", "the Ottoman Empire", "Ottoman", "Carlist Spain", "Nowhere"];
  const first = tokens.map(ask);
  const again = tokens.map(ask);
  assert.deepEqual(again, first);
  assert.equal(ask("  Kingdom   of  Spain "), "Kingdom of Spain");
  assert.equal(ask("Brasil"), "Empire of Brazil");
});

test("a given index answers as a fresh one", () => {
  const index = buildPolityIdentityIndex(world);
  for (const token of ["Spain", "Brasil", "Ottoman", "Carlist Spain", "Nowhere", ""]) {
    assert.deepEqual(resolvePolityIdentity(token, world, { identityIndex: index }), resolvePolityIdentity(token, world));
  }
});

test("many distinct names, past what the store keeps, still resolve", () => {
  for (let i = 0; i < 25000; i += 1) ask(`Polity number ${i}`);
  assert.equal(ask("Spain"), "Kingdom of Spain");
  assert.equal(ask("Brasil"), "Empire of Brazil");
});

// The index counts every region's owner once, for its own counts and its polities' (whether one holds land is
// what keeps a lapsed name active: a polity with regions is current whatever its status says).
test("an index's polities are counted from the same regions as the index", () => {
  const held = {
    polityOverrides: {
      Aland: { name: "Aland", status: "active" },
      "Old Aland": { name: "Old Aland", status: "dissolved" },
      Borduria: { name: "Borduria", status: "dissolved" },
    },
    regionOwnershipOverrides: { R1: "Aland", R2: " Aland ", R3: "Borduria", R4: "", R5: "Syldavia" },
  };
  const index = buildPolityIdentityIndex(held);
  assert.deepEqual([...index.ownershipCounts], [["Aland", 2], ["Borduria", 1], ["Syldavia", 1]]);
  const declared = Object.fromEntries(index.declared.map((entry) => [entry.canonical, [entry.ownedRegions, entry.active]]));
  assert.deepEqual(declared, { Aland: [2, true], "Old Aland": [0, false], Borduria: [1, true] });
});
