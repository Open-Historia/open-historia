/*! Open Historia — Game Master preview and apply check tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/gameMasterValidation.test.js
//
// These checks decide what a GM console edit writes to canon, and a GM edit
// cannot be rolled back like a turn: a wrong rejection blocks the edit, a
// wrong acceptance keeps a bad one for good.

import assert from "node:assert/strict";
import test from "node:test";

import {
  gameMasterPolityKey,
  gameMasterStateFingerprint,
  normalizeGameMasterPolityLifecycle,
  validateGameMasterBreakawaySovereignty,
  validateGameMasterChronology,
  validateGameMasterPolityLifecycle,
  verifyGameMasterTerritoryPostconditions,
} from "./gameMasterValidation.js";

const polityChange = (operation, code, extra = {}) => ({ operation, code, ...extra });
const withChanges = (...changes) => ({ events: [{ date: "1915-06-01", title: "Edit", impacts: { polityChanges: changes } }] });
const active = (...names) => new Set(names.map(gameMasterPolityKey));

// 1915: the Russian Empire holds the Polish lands; Poland is a known but
// dormant identity in the campaign's own registry.
const world1915 = {
  polityOverrides: {
    "Russian Empire": { status: "active" },
    "German Empire": { status: "active" },
    Poland: { status: "dissolved" },
  },
  regionOwnershipOverrides: { "POL.1_1": "Russian Empire", "DEU.1_1": "German Empire" },
};

test("creating a known dormant polity becomes a restore (1915 Poland)", () => {
  const candidate = withChanges(polityChange("create", "Poland", { name: "Kingdom of Poland" }));
  const base = active("Russian Empire", "German Empire");
  normalizeGameMasterPolityLifecycle(candidate, world1915, base);
  const [change] = candidate.events[0].impacts.polityChanges;
  assert.equal(change.operation, "restore");
  assert.equal(change.code, "Poland");
  assert.equal(change.name, "Kingdom of Poland", "the authored display name is kept");
  assert.equal(validateGameMasterPolityLifecycle(candidate, world1915, base), "");
});

test("a genuinely new polity stays a create", () => {
  const candidate = withChanges(polityChange("create", "Regency Council of Lithuania"));
  normalizeGameMasterPolityLifecycle(candidate, world1915, active("Russian Empire"));
  assert.equal(candidate.events[0].impacts.polityChanges[0].operation, "create");
  assert.equal(validateGameMasterPolityLifecycle(candidate, world1915, active("Russian Empire")), "");
});

test("the lifecycle check rejects a create or restore of an active polity and an update of an inactive one", () => {
  const base = active("Russian Empire", "German Empire");
  assert.match(
    validateGameMasterPolityLifecycle(withChanges(polityChange("create", "German Empire")), world1915, base),
    /polityChanges\[0\] tries to CREATE "German Empire", but it already resolves to active polity "German Empire"/,
  );
  assert.match(
    validateGameMasterPolityLifecycle(withChanges(polityChange("restore", "Russian Empire")), world1915, base),
    /tries to RESTORE "Russian Empire", but "Russian Empire" is already active/,
  );
  assert.match(
    validateGameMasterPolityLifecycle(withChanges(polityChange("update", "Poland")), world1915, base),
    /tries to UPDATE "Poland", but that polity is not currently active/,
  );
});

test("the lifecycle check follows the transaction in order", () => {
  const base = active("Russian Empire");
  // Restored first, then updated in the same transaction: fine.
  assert.equal(validateGameMasterPolityLifecycle(
    withChanges(polityChange("restore", "Poland"), polityChange("update", "Poland")), world1915, base), "");
  // Dissolved first, then updated: the update targets an inactive polity.
  assert.match(validateGameMasterPolityLifecycle(
    withChanges(polityChange("dissolve", "Russian Empire"), polityChange("update", "Russian Empire")), world1915, base),
  /polityChanges\[1\] tries to UPDATE "Russian Empire"/);
});

const breakaway = (transfer) => ({
  events: [{
    date: "1915-06-01",
    title: "Rising",
    impacts: {
      polityChanges: [polityChange("create", "Free Silesia")],
      regionTransfers: [transfer],
    },
  }],
  warUpdates: [{ op: "start", actors: ["Free Silesia"], opponents: ["German Empire"] }],
});

test("a newborn breakaway may not receive legal sovereignty from the power it is fighting", () => {
  assert.match(
    validateGameMasterBreakawaySovereignty(breakaway({ regionId: "DEU.1_1", fromCode: "German Empire", toCode: "Free Silesia" })),
    /regionTransfers\[0\] attempts to transfer LEGAL sovereignty from "German Empire" to newly created belligerent "Free Silesia"/,
  );
  // From a third party, not the opponent: allowed.
  assert.equal(validateGameMasterBreakawaySovereignty(breakaway({ regionId: "POL.1_1", fromCode: "Russian Empire", toCode: "Free Silesia" })), "");
  // No war started with the newborn polity: allowed (a negotiated creation).
  const peaceful = breakaway({ regionId: "DEU.1_1", fromCode: "German Empire", toCode: "Free Silesia" });
  peaceful.warUpdates = [];
  assert.equal(validateGameMasterBreakawaySovereignty(peaceful), "");
  // No polity created at all: nothing to check.
  assert.equal(validateGameMasterBreakawaySovereignty({ events: [], warUpdates: [] }), "");
});

test("GM Apply never advances time: future-dated events may not carry canonical effects", () => {
  const game = { gameDate: "1915-06-01" };
  const future = (impacts, extra = {}) => ({ events: [{ date: "1915-07-01", title: "Later", impacts }], ...extra });
  assert.match(
    validateGameMasterChronology(future({ polityChanges: [polityChange("update", "German Empire")] }), game),
    /\$\.events\[0\] is dated 1915-07-01, after the current game date 1915-06-01, but it establishes canonical state changes/,
  );
  assert.match(
    validateGameMasterChronology(future({}, { relationUpdates: [{ eventIndexes: [0] }] }), game),
    /after the current game date/,
    "a linked ledger update counts as an effect",
  );
  assert.match(
    validateGameMasterChronology(future({ regionControlOps: [{ op: "control", regionId: "POL.1_1", toCode: "German Empire" }] }), game),
    /after the current game date/,
    "a future-dated occupation is a canonical effect too",
  );
  assert.equal(validateGameMasterChronology(future({}), game), "", "a future-dated note with no effects is allowed");
  assert.equal(validateGameMasterChronology({ events: [{ date: "1915-06-01", impacts: { unitOps: [{}] } }] }, game), "");
  // BC dates are ordered by the calendar.
  assert.equal(validateGameMasterChronology({ events: [{ date: "-0300-01-01", impacts: { unitOps: [{}] } }] }, { gameDate: "-0218-01-01" }), "");
  assert.match(validateGameMasterChronology({ events: [{ date: "-0200-01-01", impacts: { unitOps: [{}] } }] }, { gameDate: "-0218-01-01" }),
    /after the current game date -0218-01-01/);
  assert.equal(validateGameMasterChronology({ events: [{ date: "1999-01-01", impacts: { unitOps: [{}] } }] }, { gameDate: "Third Age 3019" }), "",
    "a prose-dated game is not checked");
});

test("the post-apply check finds a territorial edit that did not take effect", () => {
  const events = [{
    impacts: {
      regionTransfers: [{ regionId: "POL.1_1", toCode: "Poland" }],
      regionControlOps: [{ op: "contest", regionId: "POL.1_1", actorCode: "Poland" }],
      regionClaims: [{ regionId: "DEU.1_1", claimantCode: "Poland" }],
    },
  }];
  const applied = {
    ...world1915,
    regionOwnershipOverrides: { ...world1915.regionOwnershipOverrides, "POL.1_1": "Poland" },
    regionClaimants: { "DEU.1_1": ["Poland"] },
  };
  assert.equal(verifyGameMasterTerritoryPostconditions(events, applied), "", "a contest by the new controller is moot");
  assert.match(verifyGameMasterTerritoryPostconditions(events, world1915),
    /territorial operation 0:0 did not take effect for POL\.1_1 \(expected Poland, found Russian Empire\)/);
  assert.match(verifyGameMasterTerritoryPostconditions(events, { ...applied, regionClaimants: {} }),
    /claim operation 0:0 did not take effect for DEU\.1_1 \(claim missing for Poland\)/);
  assert.match(verifyGameMasterTerritoryPostconditions([{ impacts: { regionControlOps: [{ op: "control", toCode: "Poland" }] } }], applied),
    /de-facto control operation 0:0 has no canonical region id/);
});

test("the state fingerprint changes when anything the preview read changes", () => {
  const game = { country: "German Empire", gameDate: "1915-06-01", round: 3 };
  const world = {
    ...world1915,
    relations: [{ a: "German Empire", b: "Russian Empire", score: -80, status: "war" }],
    storylines: [{ id: "eastern-front", title: "Eastern Front", status: "active", participants: ["German Empire"] }],
  };
  const events = [{ id: "e1", date: "1915-05-01", title: "Gorlice", description: "Breakthrough." }];
  const base = gameMasterStateFingerprint({ game, world, events });
  assert.equal(gameMasterStateFingerprint({ game, world, events }), base, "stable for the same state");
  assert.notEqual(gameMasterStateFingerprint({
    game, events,
    world: { ...world, relations: [{ ...world.relations[0], score: -20, status: "tense" }] },
  }), base, "a relation changed");
  assert.notEqual(gameMasterStateFingerprint({
    game, events,
    world: { ...world, storylines: [{ ...world.storylines[0], status: "resolved" }] },
  }), base, "a storyline changed");
  assert.notEqual(gameMasterStateFingerprint({
    game, world,
    events: [...events, { id: "e2", date: "1915-06-01", title: "New", description: "" }],
  }), base, "an event was added");
  assert.notEqual(gameMasterStateFingerprint({ game: { ...game, gameDate: "1915-06-02" }, world, events }), base, "the date moved");
});
