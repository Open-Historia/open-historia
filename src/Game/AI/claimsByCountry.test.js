/*! Open Historia — claims withdrawn from a whole country in one entry: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/claimsByCountry.test.js
//
// "make it so events can remove all claims on territory on a country" (the
// owner, 2026-11-09), after a player's removal of a dissolved polity's claims
// cleared "only ... around 70 regions": the model can only write so many
// entries, one per region. One entry now does it, with no cap.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applyEventImpactsToWorld } from "../../runtime/gameState.js";
import { countryClaimWithdrawals } from "./claimsByCountry.js";
import { validateGameplayPayload } from "./gameplaySchemas.js";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

// Ruritania holds 250 regions; Borduria and Carpania claim all of them.
const regions = Array.from({ length: 250 }, (_, index) => ({ id: `r${index}`, name: `Province ${index}` }));
const claimants = () => Object.fromEntries(regions.map((region) => [region.id, ["Borduria", "Carpania"]]));
const world = () => ({
  regionOwnershipOverrides: Object.fromEntries(regions.map((region) => [region.id, "Ruritania"])),
  regionClaimants: claimants(),
});
const withdraw = (claim) => countryClaimWithdrawals(claim, {
  regions,
  claimantsOf: (id) => claimants()[id] ?? [],
  isClaimant: (name) => name.toLowerCase() === String(claim.claimantCode).toLowerCase(),
});
const apply = (entries, base = world()) => applyEventImpactsToWorld({
  events: [{ id: "e1", date: "2026-01-01", title: "Claims settled", description: "x", impacts: { regionClaims: entries } }],
  world: base,
}).world;

test("every claimant's claims on the country, cleared fully, all 250 regions", () => {
  const entries = withdraw({ regionId: "Ruritania", claimantCode: "Ruritania", drop: true, allClaimants: true });
  assert.equal(entries.length, 250);
  const next = apply(entries);
  assert.deepEqual(next.regionClaimants, {});
  assert.equal(next.settledRegionClaims.length, 250);
});

test("one claimant's claims only: the other claimant's stay", () => {
  const entries = withdraw({ regionId: "Ruritania", claimantCode: "Borduria", drop: true });
  assert.equal(entries.length, 250);
  const next = apply(entries);
  assert.equal(Object.keys(next.regionClaimants).length, 250);
  assert.ok(Object.values(next.regionClaimants).every((names) => names.length === 1 && names[0] === "Carpania"));
});

test("a withdrawal touches only regions with a claim to withdraw, and asserts nothing", () => {
  const some = countryClaimWithdrawals({ regionId: "x", claimantCode: "Borduria", drop: true }, {
    regions,
    claimantsOf: (id) => (id === "r3" ? ["Borduria"] : []),
    isClaimant: (name) => name === "Borduria",
  });
  assert.deepEqual(some.map((entry) => entry.regionId), ["r3"]);
  assert.deepEqual(countryClaimWithdrawals({ regionId: "x", claimantCode: "Borduria" }, { regions, claimantsOf: () => ["Borduria"] }), []);
});

test("allClaimants keeps an occupation's stripe, which is no claim", () => {
  const base = world();
  base.regionOwnershipOverrides.r0 = "Borduria";
  base.regionSovereigntyOverrides = { r0: "Ruritania" };
  base.regionClaimants.r0 = ["Ruritania", "Carpania"];
  const next = apply([{ regionId: "r0", claimantCode: "", drop: true, allClaimants: true }], base);
  assert.deepEqual(next.regionClaimants.r0, ["Ruritania"]);
});

test("the entry is the skip's own regionClaims shape, with one new flag, and the resolver expands \"country: <name>\" with it", () => {
  const verdict = validateGameplayPayload("jumpForward", {
    events: [{ date: "2026-01-02", title: "Claims settled", description: "x", impacts: { regionClaims: [{ regionId: "country: Ruritania", claimantCode: "Ruritania", drop: true, allClaimants: true }] } }],
    stopDate: "2026-01-31",
    summary: "x",
  });
  assert.equal(verdict.valid, true, verdict.error);
  assert.match(gameplay, /if \(typeof claim\.regionId === "string" && plainRegionRef\(claim\.regionId\)\.kind === "country"\) claimedCountries\.set\(claim, plainRegionRef\(claim\.regionId\)\.text\);/);
  assert.match(gameplay, /const regions = countryClaimWithdrawals\(claim, \{\r?\n\s+regions: regionsOwnedBy\(country\),/);
  assert.match(gameplay, /To end claims on a whole country in one entry, never region by region: regionId \\"country: <name>\\", drop true/);
});
