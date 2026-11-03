// Run: node --test src/Game/AI/countryStatsIdentityIndex.test.js
//
// The Stats worker resolved every polity token by building the whole identity
// index again, reading every polity and every region's owner. A 7-day skip in
// the native app spent over 4 s of the worker in countOwnedRegions
// (2026-10-28). One index per world now serves the whole pass.

import test from "node:test";
import assert from "node:assert/strict";

import { prepareCountryStatsKernel } from "./countryStatsWorkerKernel.js";

const bigBundle = () => {
  const names = Array.from({ length: 300 }, (_, i) => `Kingdom of Testland ${i}`);
  const polityOverrides = {};
  names.forEach((name, i) => { polityOverrides[name] = { name, aliases: [`Testland ${i}`], status: "active" }; });
  const regionOwnershipOverrides = {};
  for (let region = 0; region < 6000; region += 1) regionOwnershipOverrides[`R${region}`] = names[region % names.length];
  const events = Array.from({ length: 64 }, (_, i) => ({
    id: `e${i}`,
    date: "1836-01-02",
    title: `Trade and tariffs between Testland ${i % 300} and Testland ${(i + 1) % 300}`,
    description: "Markets moved and the treasury answered.",
    combatants: [`Testland ${i % 300}`, `Testland ${(i * 7) % 300}`],
    impacts: {
      polityChanges: [{ code: `Testland ${i % 300}`, stats: { gdp: 1 } }],
      regionTransfers: [{ fromCode: `Testland ${i % 300}`, toCode: `Testland ${(i + 3) % 300}` }],
      regionControlOps: [{ fromCode: `Testland ${i % 300}`, toCode: `Testland ${(i + 5) % 300}`, actorCode: `Testland ${(i + 9) % 300}` }],
    },
  }));
  return { names, bundle: { world: { polityOverrides, regionOwnershipOverrides }, events } };
};

test("a Stats pass over a world with many polities and regions is quick", async () => {
  const { names, bundle } = bigBundle();
  await prepareCountryStatsKernel({ bundle, code: names[3] });
  const started = performance.now();
  await prepareCountryStatsKernel({ bundle, code: names[3] });
  const took = performance.now() - started;
  assert.ok(took < 1500, `one pass took ${Math.round(took)} ms`);
});

test("the pass still finds the target's economic events by any of its names", async () => {
  const { names, bundle } = bigBundle();
  const prepared = await prepareCountryStatsKernel({ bundle, code: names[3] });
  const relevant = prepared.middle.rawEconomicEvidence.relevantIds;
  assert.ok(relevant.includes("e3"), `the event naming Testland 3 by its alias is found (${relevant.join(", ")})`);
  assert.match(prepared.dossier, /Kingdom of Testland 3/);
});
