/*! Open Historia — the puppet states off switch © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/puppetStatesOff.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  describePuppetBriefing,
  livePuppetsFor,
  puppetBriefingFor,
  puppetStatesEnabled,
  puppetSummaryFor,
  setPuppetStatesEnabled,
  visiblePuppetsFor,
} from "./puppets.js";
import { applyDiplomaticUpdates, buildBoundedDiplomaticContext } from "../Game/AI/nativeDiplomaticDirector.js";

// A scenario may switch the whole system off, and a game cloned from it may
// decide for itself (server/gameFeatures.js, "Puppet states"). What that must
// mean: no surface shows a subordination, no prompt mentions one, nothing new
// can be installed — and NOTHING IS ERASED, so a game switched back on finds
// its ledger as it left it.

const rows = [{
  id: "p1",
  overlord: "USSR",
  puppet: "Poland",
  kind: "satellite",
  loyalty: 40,
  secrecy: "open",
  knownTo: [],
  status: "active",
  startedDate: "1945-06-28",
}];

const world = () => ({ puppets: rows.map((row) => ({ ...row })) });

// The switch is module state, so every test puts it back: a leaked "off" would
// silently empty the rest of the suite's ledgers.
const withSystemOff = (body) => {
  setPuppetStatesEnabled(false);
  try {
    body();
  } finally {
    setPuppetStatesEnabled(true);
  }
};

test("on by default, so tests and the harness run with the whole system", () => {
  assert.equal(puppetStatesEnabled(), true);
  assert.equal(visiblePuppetsFor(world(), "USSR").length, 1);
});

test("every read goes quiet at once when the system is off", () => {
  withSystemOff(() => {
    assert.equal(puppetStatesEnabled(), false);
    // The Overlord is the viewer who can see the most, so it is the one worth
    // checking: if USSR sees nothing, nobody does.
    assert.deepEqual(visiblePuppetsFor(world(), "USSR"), []);
    assert.deepEqual(livePuppetsFor(world(), "USSR"), []);
    // The panel and the map card.
    assert.equal(puppetSummaryFor(world(), "USSR", "Poland"), null);
    assert.equal(puppetSummaryFor(world(), "Poland", "Poland"), null);
    // The advisor's prompt and every leader's briefing.
    assert.deepEqual(puppetBriefingFor(world(), "USSR", { present: ["Poland"] }), { own: [], learned: [] });
    assert.equal(describePuppetBriefing(puppetBriefingFor(world(), "USSR"), "USSR"), "");
  });
});

test("switching back on finds the ledger exactly as it was", () => {
  const saved = world();
  withSystemOff(() => {
    assert.deepEqual(visiblePuppetsFor(saved, "USSR"), []);
  });
  const [row] = visiblePuppetsFor(saved, "USSR");
  assert.equal(row.puppet, "Poland");
  assert.equal(row.role, "overlord");
  assert.equal(row.loyaltyBand, "Restless");
});

test("the simulator is never told the concept exists", () => {
  const bundle = { puppets: rows, polities: [{ name: "USSR" }, { name: "Poland" }] };
  const on = buildBoundedDiplomaticContext(bundle, { playerPolity: "USSR", focusActors: ["Poland"] });
  assert.match(on.text, /SUBORDINATIONS \(who directs whom\)/);

  const off = buildBoundedDiplomaticContext(bundle, { playerPolity: "USSR", focusActors: ["Poland"], puppetStates: false });
  // Not "nobody directs anybody" — the section is gone, so the model has no
  // vocabulary to narrate a subordination the engine would refuse to record.
  assert.doesNotMatch(off.text, /SUBORDINATION/i);
  assert.doesNotMatch(off.text, /Puppet/i);
  assert.deepEqual(off.puppets, []);
  // The rest of the ledger is untouched by the switch.
  assert.match(off.text, /BILATERAL RELATIONS/);
  assert.match(off.text, /FORMAL AGREEMENTS/);
});

test("no install lands while the system is off", () => {
  // The same compact line, the same world, the switch the only difference —
  // and the "on" half is what proves the "off" half is about the switch.
  const before = {
    polityOverrides: { USSR: { code: "USSR", name: "USSR" }, Poland: { code: "Poland", name: "Poland" } },
    regionOwnershipOverrides: { r1: "USSR", r2: "Poland" },
    relations: [],
    agreements: [],
    puppets: [],
  };
  const events = [{
    id: "e1",
    date: "1945-06-28",
    title: "A government is installed",
    description: "Soviet forces install a friendly government in Warsaw.",
    kind: "diplomacy",
  }];
  const line = "install~USSR~Poland~satellite~40~open~1~Provisional government seated";
  const merge = (extra) => applyDiplomaticUpdates({
    world: before,
    relationUpdates: [],
    agreementUpdates: [],
    puppetUpdates: line,
    events,
    stopDate: "1945-06-28",
    round: 1,
    ...extra,
  });

  const on = merge({});
  assert.equal(on.appliedPuppetIds.length, 1);
  assert.equal(on.world.puppets[0].puppet, "Poland");

  const off = merge({ puppetStates: false });
  assert.deepEqual(off.appliedPuppetIds, []);
  assert.deepEqual(off.world.puppets ?? [], []);
});

test("a standing arrangement brews no coup while the system is off", () => {
  // applyPuppetUpdates seeds a rising off rows ALREADY in the ledger, not just
  // off this pass's updates — which is why the pass is skipped whole rather
  // than handed an empty list. A game that switched the system off with a
  // seething puppet standing must not go on plotting inside it.
  const seething = [{ ...rows[0], loyalty: 3 }];
  const before = { puppets: seething, polities: [{ name: "USSR" }, { name: "Poland" }] };
  const off = applyDiplomaticUpdates({
    world: before,
    relationUpdates: [],
    agreementUpdates: [],
    puppetUpdates: [],
    refusedDemands: [{ overlord: "USSR", puppet: "Poland" }],
    events: [],
    stopDate: "1950-01-01",
    round: 4,
    puppetStates: false,
  });
  assert.deepEqual(off.puppetStorylineSeeds, []);
  assert.equal(off.refusedDemandCount, 0);
  // And the refusal cost nothing: the loyalty on the row is where it was.
  assert.equal(off.world.puppets[0].loyalty, 3);

  // The same world with the system on is what proves the test is not vacuous.
  const on = applyDiplomaticUpdates({
    world: before,
    relationUpdates: [],
    agreementUpdates: [],
    puppetUpdates: [],
    refusedDemands: [{ overlord: "USSR", puppet: "Poland" }],
    events: [],
    stopDate: "1950-01-01",
    round: 4,
  });
  assert.ok(on.puppetStorylineSeeds.length > 0, "a seething puppet has a rising building against it");
});
