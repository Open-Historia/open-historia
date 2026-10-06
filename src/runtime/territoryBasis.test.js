// Run: node --test src/runtime/territoryBasis.test.js
//
// Runs without node_modules: territoryBasis.js is import-free.
//
// The rule these pin: a border moves only when the ground is held or the other
// side agreed. A transfer that ADMITS it is only a claim becomes a claim — the
// region goes disputed instead of changing colour — and one that admits it is a
// threat or a raid moves nothing. An entry that says nothing about its basis is
// applied exactly as before, because this game's territorial bugs have been
// borders that failed to move, and an unlabelled transfer must never join them.

import test from "node:test";
import assert from "node:assert/strict";

import {
  TERRITORY_BASIS_ENUM,
  TERRITORY_BASIS_MOVES_MAP,
  TERRITORY_BASIS_NO_CONTROL,
  basisBecomesClaim,
  basisMovesTheMap,
  describeBasisAction,
  normalizeTerritoryBasis,
  sameRegionChange,
  screenTerritoryBasis,
} from "./territoryBasis.js";

test("the vocabulary is the two lists and nothing else", () => {
  assert.deepEqual(TERRITORY_BASIS_ENUM, [...TERRITORY_BASIS_MOVES_MAP, ...TERRITORY_BASIS_NO_CONTROL]);
  assert.equal(new Set(TERRITORY_BASIS_ENUM).size, TERRITORY_BASIS_ENUM.length);
});

test("a basis is folded to the vocabulary, and an unknown word is treated as absent", () => {
  assert.equal(normalizeTerritoryBasis("Treaty"), "treaty");
  assert.equal(normalizeTerritoryBasis("  OCCUPATION "), "occupation");
  assert.equal(normalizeTerritoryBasis("declaration"), "claim");
  assert.equal(normalizeTerritoryBasis("ultimatum"), "threat");
  assert.equal(normalizeTerritoryBasis("liberation"), "occupation");
  assert.equal(normalizeTerritoryBasis("vibes"), "");
  assert.equal(normalizeTerritoryBasis(""), "");
  assert.equal(normalizeTerritoryBasis(undefined), "");
});

test("an entry with no basis moves the map, exactly as it did before the field existed", () => {
  assert.equal(basisMovesTheMap(""), true);
  assert.equal(basisMovesTheMap(undefined), true);
  assert.equal(basisMovesTheMap("vibes"), true);
  for (const basis of TERRITORY_BASIS_MOVES_MAP) assert.equal(basisMovesTheMap(basis), true, basis);
  for (const basis of TERRITORY_BASIS_NO_CONTROL) assert.equal(basisMovesTheMap(basis), false, basis);
  assert.equal(basisBecomesClaim("claim"), true);
  assert.equal(basisBecomesClaim("proclamation"), true);
  assert.equal(basisBecomesClaim("raid"), false);
});

test("a transfer that admits it is only a claim becomes the receiver's claim", () => {
  const screened = screenTerritoryBasis({
    regionTransfers: [
      { regionId: "ETH.11_1", regionName: "Tigray", fromCode: "Ethiopia", toCode: "Italy", basis: "claim", note: "Rome proclaims it" },
      { regionId: "ETH.1_1", regionName: "Addis Ababa", fromCode: "Ethiopia", toCode: "Italy", basis: "occupation" },
    ],
  });
  assert.deepEqual(screened.regionTransfers.map((entry) => entry.regionId), ["ETH.1_1"]);
  assert.deepEqual(screened.regionClaims, [
    { claimantCode: "Italy", note: "Rome proclaims it", regionId: "ETH.11_1", regionName: "Tigray" },
  ]);
  assert.deepEqual(screened.actions, [
    { basis: "claim", family: "regionTransfers", outcome: "claimed", region: "Tigray", toCode: "Italy", wholeCountry: false },
  ]);
});

test("a threat or a raid moves nothing and asserts nothing", () => {
  const screened = screenTerritoryBasis({
    regionTransfers: [{ regionId: "POL.11_1", toCode: "Germany", basis: "threat" }],
    regionControlOps: [{ op: "control", regionId: "POL.12_1", fromCode: "Poland", toCode: "Germany", basis: "raid" }],
  });
  assert.deepEqual(screened.regionTransfers, []);
  assert.deepEqual(screened.regionControlOps, []);
  assert.deepEqual(screened.regionClaims, []);
  assert.deepEqual(screened.actions.map((action) => action.outcome), ["refused", "refused"]);
});

test("only a control flip is screened; a contest is already the middle state", () => {
  const contest = { op: "contest", regionId: "POL.11_1", fromCode: "Poland", actorCode: "Germany", basis: "raid" };
  const clear = { op: "clear_contest", regionId: "POL.11_1", claimantCode: "Germany", basis: "threat" };
  const screened = screenTerritoryBasis({ regionControlOps: [contest, clear] });
  assert.deepEqual(screened.regionControlOps, [contest, clear]);
  assert.deepEqual(screened.actions, []);
});

test("a claim on a whole country is refused, not striped across every province", () => {
  const screened = screenTerritoryBasis({
    regionTransfers: [{ regionId: "Austria", fromCode: "Austria", toCode: "Germany", wholeCountry: true, basis: "claim" }],
  });
  assert.deepEqual(screened.regionTransfers, []);
  assert.deepEqual(screened.regionClaims, []);
  assert.equal(screened.actions[0].outcome, "refused");
  assert.equal(screened.actions[0].region, "all of Austria");
});

test("a claim the event already records is not recorded twice", () => {
  const screened = screenTerritoryBasis({
    regionTransfers: [{ regionId: "ETH.11_1", toCode: "Italy", basis: "claim" }],
    regionClaims: [{ regionId: "eth.11_1", claimantCode: "italy" }],
  });
  assert.equal(screened.regionClaims.length, 1);
  assert.equal(screened.actions[0].outcome, "claimed");
});

test("screening is idempotent, so the apply path can run it again as a net", () => {
  const first = screenTerritoryBasis({
    regionTransfers: [
      { regionId: "ETH.11_1", toCode: "Italy", basis: "claim" },
      { regionId: "ETH.1_1", toCode: "Italy", basis: "treaty" },
      { regionId: "ETH.2_1", toCode: "Italy" },
    ],
  });
  const second = screenTerritoryBasis(first);
  assert.deepEqual(second.actions, []);
  assert.deepEqual(second.regionTransfers, first.regionTransfers);
  assert.deepEqual(second.regionClaims, first.regionClaims);
});

test("the inputs are never mutated", () => {
  const transfers = Object.freeze([Object.freeze({ regionId: "ETH.11_1", toCode: "Italy", basis: "claim" })]);
  const claims = Object.freeze([]);
  assert.doesNotThrow(() => screenTerritoryBasis({ regionTransfers: transfers, regionClaims: claims }));
});

test("malformed entries pass through for the normalizers to judge", () => {
  const screened = screenTerritoryBasis({ regionTransfers: [null, "x", { basis: "claim" }], regionControlOps: "nope" });
  // The object with a claim basis but no region or receiver cannot become a
  // claim, so it is refused; the non-objects are left for normalization.
  assert.deepEqual(screened.regionTransfers, [null, "x"]);
  assert.deepEqual(screened.regionControlOps, []);
  assert.equal(screened.actions[0].outcome, "refused");
});

test("the sentence names the event, the region, the receiver and what happened instead", () => {
  const claimed = describeBasisAction(
    { basis: "claim", family: "regionTransfers", outcome: "claimed", region: "Tigray", toCode: "Italy" },
    { eventTitle: "Rome proclaims an empire" },
  );
  assert.match(claimed, /^Event "Rome proclaims an empire": the transfer of Tigray to Italy/);
  assert.match(claimed, /recorded as Italy's claim on Tigray/);

  const refused = describeBasisAction(
    { basis: "raid", family: "regionControlOps", outcome: "refused", region: "Danzig", toCode: "Germany" },
  );
  assert.match(refused, /^control of Danzig to Germany carried basis "raid"/);
  assert.match(refused, /nothing changed on the map/);
});

// Seen in a live check (2026-09-29): a Scene where Burkinabe troops captured
// Djenne got a contest and a capture of Djenne from the territory Director, and
// the region never changed hands. Both go to Burkina Faso, so the resolver kept
// the first and dropped the capture as its duplicate. They are different changes.
test("a contest and a capture of one region by one side are two changes, not a duplicate", () => {
  const contest = { op: "contest", regionId: "3977", toCode: "Burkina Faso" };
  const capture = { op: "control", regionId: "3977", toCode: "Burkina Faso" };
  assert.equal(sameRegionChange(contest, capture), false);
  assert.equal(sameRegionChange(capture, { ...capture, note: "again" }), true);
  const treaty = { regionId: "3975", toCode: "Burkina Faso", basis: "treaty" };
  assert.equal(sameRegionChange(treaty, { regionId: "3975", toCode: "burkina faso" }, (name) => name.toLowerCase()), true);
  assert.equal(sameRegionChange(treaty, { ...treaty, toCode: "Mali" }), false);
});
