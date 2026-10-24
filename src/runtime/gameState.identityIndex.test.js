import assert from "node:assert/strict";
import test from "node:test";

import { normalizeWorldState } from "./gameState.js";

// A time skip on a phone froze the page for minutes (2026-10-23): every
// relation and agreement row resolved its names by building the whole
// polity identity index again, reading every polity and every region's owner,
// and the game normalises the world hundreds of times in one skip. One pass
// over this world took 10 s on a desktop before; it takes well under a tenth
// of a second now.
const bigWorld = () => {
  const names = Array.from({ length: 300 }, (_, i) => `Kingdom of Testland ${i}`);
  const polityOverrides = {};
  names.forEach((name, i) => { polityOverrides[name] = { name, aliases: [`Testland ${i}`], status: "active" }; });
  const regionOwnershipOverrides = {};
  for (let region = 0; region < 6000; region += 1) regionOwnershipOverrides[`R${region}`] = names[region % names.length];
  return {
    names,
    world: {
      polityOverrides,
      regionOwnershipOverrides,
      
      agreements: Array.from({ length: 200 }, (_, i) => ({ id: `a${i}`, type: "alliance", parties: [names[i % 300], `Testland ${(i * 7 + 3) % 300}`], status: "active", startedDate: "1836-01-01" })),
      relations: Array.from({ length: 200 }, (_, i) => ({ a: names[i % 300], b: `Testland ${(i * 11 + 5) % 300}`, score: 10 })),
    },
  };
};

test("a world with many polities and diplomatic rows is normalised in one quick pass", () => {
  const { world } = bigWorld();
  normalizeWorldState(world);
  const started = performance.now();
  normalizeWorldState(world);
  const took = performance.now() - started;
  assert.ok(took < 3000, `one pass took ${Math.round(took)} ms`);
});

test("the rows still resolve each name, an alias included, to the polity it means", () => {
  const { names, world } = bigWorld();
  const next = normalizeWorldState(world);
  const agreement = next.agreements.find((row) => row.id === "a1");
  assert.ok(agreement, "the agreement is kept");
  assert.deepEqual([...agreement.parties].sort(), [names[1], names[10]].sort());
});
