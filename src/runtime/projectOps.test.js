/*! Open Historia — portions (project op application tests) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
// Run with `npm ci && node --test src/runtime/projectOps.test.js`. The pure
// derived-state helpers are tested separately in projects.test.js, which stays
// import-free and runs in a bare checkout.
import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEventImpactsToWorld,
  applyProjectOps,
  applyProjectOpsToWorld,
  normalizeWorldState,
} from "./gameState.js";

const standingWatch = {
  op: "create",
  name: "Operation Standing Watch",
  summary: "Permanent North Sea patrol.",
  kind: "operation",
  ongoing: true,
  secrecy: "covert",
  tags: ["naval", "military"],
  progress: 35,
  status: "stalled",
  startedAt: "2030-01-01",
  milestones: [{ title: "Annual drill", date: "2034-06-01", repeat: "annual" }],
};

const open = (ops = [standingWatch], ctx = { date: "2033-01-01" }) => applyProjectOps([], ops, ctx);

// A jump that merely MENTIONS a running operation used to reset everything the
// model had not bothered to restate: ongoing back to false, progress to 0,
// status to active, secrecy to public, tags emptied, an operation demoted to a
// project. The create branch spread the whole normalized op over the existing
// entry instead of merging the fields it actually carried.
test("a passing restatement preserves everything it did not mention", () => {
  const before = open()[0];
  const after = applyProjectOps(
    [before],
    [{ op: "create", name: "Operation Standing Watch", summary: "The patrol continues." }],
    { date: "2034-01-01", round: 70 },
  )[0];

  assert.equal(after.ongoing, true, "ongoing was reset");
  assert.equal(after.progress, 35, "progress was reset");
  assert.equal(after.status, "stalled", "status was reset");
  assert.equal(after.secrecy, "covert", "secrecy was reset");
  assert.deepEqual(after.tags, ["naval", "military"], "tags were emptied");
  assert.equal(after.kind, "operation", "an operation was demoted to a project");
  assert.equal(after.startedAt, "2030-01-01");
  assert.equal(after.milestones.length, 1);
  assert.equal(after.milestones[0].repeat, "annual");

  // What it DID send is applied, and identity survives.
  assert.equal(after.summary, "The patrol continues.");
  assert.equal(after.id, before.id);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.updatedRound, 70, "a mention still counts as being touched");
});

test("a restatement that means to change things still can", () => {
  const before = open()[0];
  const after = applyProjectOps([before], [{
    op: "create", name: "Operation Standing Watch", summary: "s",
    ongoing: false, targetDate: "2040-01-01", progress: 60, status: "active", secrecy: "public",
  }], {})[0];

  assert.equal(after.ongoing, false);
  assert.equal(after.targetDate, "2040-01-01");
  assert.equal(after.progress, 60);
  assert.equal(after.status, "active");
  assert.equal(after.secrecy, "public");
});

test("an explicitly emptied list is still an instruction, not an omission", () => {
  const before = open()[0];
  assert.deepEqual(applyProjectOps([before], [{ op: "create", name: before.name, tags: [] }], {})[0].tags, []);
});

test("a genuinely new project still receives its defaults", () => {
  const fresh = applyProjectOps([], [{ op: "create", name: "Fresh", summary: "s" }], {})[0];
  assert.equal(fresh.status, "active");
  assert.equal(fresh.progress, 0);
  assert.equal(fresh.ongoing, false);
  assert.equal(fresh.secrecy, "public");
});

// The staged event reveal replays events straight out of events.json, so an op
// that has been normalized and JSON round-tripped must merge exactly as the
// original did. A Set of provided fields would have serialised to {} here and
// quietly restored the destructive behaviour.
test("a persisted, replayed op merges the same as a fresh one", () => {
  const world = normalizeWorldState({ projects: open() });
  const event = {
    id: "e1", date: "2034-01-01", title: "The patrol continues", description: "d",
    impacts: { projectOps: [{ op: "create", name: "Operation Standing Watch", summary: "A mention." }] },
  };

  const fresh = applyEventImpactsToWorld({ world, events: [event], round: 70 }).world.projects[0];
  const replayed = applyEventImpactsToWorld({
    world, events: JSON.parse(JSON.stringify([event])), round: 70,
  }).world.projects[0];

  assert.equal(fresh.ongoing, true);
  assert.equal(replayed.ongoing, true, "ongoing lost on replay");
  assert.equal(replayed.progress, 35, "progress lost on replay");
  assert.equal(replayed.kind, "operation");
});

test("every other op leaves ongoing alone", () => {
  const before = open()[0];
  for (const op of [
    { op: "update", name: before.name, progress: 50 },
    { op: "update", name: before.name, status: "active" },
    { op: "update", name: before.name, lastUpdate: "Something happened." },
    { op: "milestone", name: before.name, milestone: { title: "Review", date: "2035-01-01" } },
  ]) {
    assert.equal(applyProjectOps([before], [op], {})[0].ongoing, true, JSON.stringify(op));
  }
  // Only an explicit instruction undoes it: `ongoing` is deliberately sticky, so
  // a chatty simulation cannot quietly put an end date back on a standing effort.
  assert.equal(applyProjectOps([before], [{ op: "update", name: before.name, ongoing: false }], {})[0].ongoing, false);
});

test("marking a milestone done keeps its date and note", () => {
  // normalizeProjectMilestone fills every field, so spreading it over the entry
  // erased the date and note whenever the model marked something done the
  // natural way: {"title":"...","status":"done"}.
  const before = applyProjectOps([], [{
    op: "create", name: "P", summary: "s",
    milestones: [{ title: "Sea trials", date: "2033-11-04", note: "At Faslane." }],
  }], {})[0];
  const after = applyProjectOps([before], [{
    op: "milestone", name: "P", milestone: { title: "Sea trials", status: "done" },
  }], { date: "2033-11-06" })[0];

  assert.equal(after.milestones[0].status, "done");
  assert.equal(after.milestones[0].date, "2033-11-04", "the due date was erased");
  assert.equal(after.milestones[0].note, "At Faslane.", "the note was erased");
});

test("a recurring milestone rolls instead of retiring", () => {
  const before = open()[0];
  const after = applyProjectOps([before], [{
    op: "milestone", name: before.name, milestone: { title: "Annual drill", status: "done" },
  }], { date: "2034-06-03" })[0];

  assert.equal(after.milestones[0].date, "2035-06-01", "did not roll to the next occurrence");
  assert.equal(after.milestones[0].status, "pending");
  assert.equal(after.milestones[0].completedCount, 1);
  assert.equal(after.milestones[0].lastCompletedAt, "2034-06-03");
});

test("ending a project keeps it on the board; only remove erases", () => {
  const before = open()[0];
  for (const [op, status] of [["complete", "complete"], ["cancel", "cancelled"], ["fail", "failed"]]) {
    const after = applyProjectOps([before], [{ op, name: before.name }], {});
    assert.equal(after.length, 1, `op "${op}" removed the entry`);
    assert.equal(after[0].status, status);
  }
  assert.equal(applyProjectOps([before], [{ op: "remove", name: before.name }], {}).length, 0);
});

// PROJECT_FIELD_ALIASES documents the field names the normalizer accepts, and the
// create path has always honoured them. The update path matched canonical keys
// only, so the natural thing for a model to write changed nothing at all — and the
// advisor's ```projects block, which every button on the Projects panel drives,
// has no schema to keep it to canonical names.
test("an update op is applied through the same field aliases create accepts", () => {
  const before = open()[0];
  const after = applyProjectOps([before], [{
    op: "update",
    name: before.name,
    description: "Hull complete; fitting out begins.",
    dueDate: "2038-03-01",
    owner: "Germany",
    type: "project",
    classification: "restricted",
    startDate: "2029-05-05",
    progress: 55,
    ongoing: false,
  }], { date: "2034-01-01" })[0];

  assert.equal(after.summary, "Hull complete; fitting out begins.", "description alias dropped");
  assert.equal(after.targetDate, "2038-03-01", "dueDate alias dropped");
  assert.equal(after.ownerCode, "Germany", "owner alias dropped");
  assert.equal(after.kind, "project", "type alias dropped");
  assert.equal(after.secrecy, "restricted", "classification alias dropped");
  assert.equal(after.startedAt, "2029-05-05", "startDate alias dropped");
  assert.equal(after.progress, 55, "canonical field stopped working");
});

// A model asked to mark a checkpoint reached writes "completed" or "achieved" about
// as often as it writes "done". An unrecognised value fell through to the "pending"
// default, which is not a no-op: the merge assigned it unconditionally, so the op
// meant to confirm a checkpoint pushed it back to pending — while still counting as
// a change, so the advisor's receipt card reported an update that never happened.
test("milestone status synonyms mark a checkpoint reached", () => {
  const before = open([{ ...standingWatch, milestones: [{ title: "Sea trials", date: "2034-06-01" }] }])[0];

  for (const status of ["done", "complete", "completed", "achieved", "reached"]) {
    const after = applyProjectOps([before], [{
      op: "milestone", name: before.name, milestone: { title: "Sea trials", status },
    }], { date: "2034-06-03" })[0];
    assert.equal(after.milestones[0].status, "done", `status "${status}" did not mark it done`);
    assert.equal(after.nextMilestone, null, `status "${status}" left it outstanding`);
  }

  for (const status of ["missed", "slipped", "late"]) {
    const after = applyProjectOps([before], [{
      op: "milestone", name: before.name, milestone: { title: "Sea trials", status },
    }], { date: "2034-06-03" })[0];
    assert.equal(after.milestones[0].status, "missed", `status "${status}" did not mark it missed`);
  }
});

// The other half of that fix: an op that only re-dates or annotates a checkpoint
// carries no status, and normalizeProjectMilestone fills every field — so without
// the statusProvided flag the merge would silently un-complete it.
test("a milestone op with no status leaves the status alone", () => {
  const done = applyProjectOps(
    open([{ ...standingWatch, milestones: [{ title: "Sea trials", date: "2034-06-01" }] }]),
    [{ op: "milestone", name: standingWatch.name, milestone: { title: "Sea trials", status: "done" } }],
    { date: "2034-06-03" },
  );
  assert.equal(done[0].milestones[0].status, "done");

  const redated = applyProjectOps(done, [{
    op: "milestone", name: standingWatch.name, milestone: { title: "Sea trials", date: "2034-11-01" },
  }], { date: "2034-07-01" })[0];

  assert.equal(redated.milestones[0].status, "done", "re-dating un-completed the checkpoint");
  assert.equal(redated.milestones[0].date, "2034-11-01", "the new date was not applied");
});

// updatedRound is the only thing deriveProjectFlags uses to decide a programme has
// gone quiet, so an op batch that carries a round has to stamp it whichever verb it
// used — otherwise the advisor updates a project and the card still reads stale.
test("every op stamps updatedRound when the caller supplies a round", () => {
  const before = { ...open()[0], updatedRound: 5 };
  const cases = [
    ["update", { op: "update", name: before.name, lastUpdate: "Fitting out." }],
    ["create-as-restatement", { op: "create", name: before.name, summary: "The patrol continues." }],
    ["milestone", { op: "milestone", name: before.name, milestone: { title: "Annual drill", status: "done" } }],
    ["complete", { op: "complete", name: before.name }],
  ];

  for (const [label, op] of cases) {
    const after = applyProjectOps([before], [op], { date: "2034-06-03", round: 12 })[0];
    assert.equal(after.updatedRound, 12, `op "${label}" did not stamp the round`);
  }
});

// A model writes {"title":"Annual drill","repeat":"annual"} with no date more or
// less constantly. advanceRecurringDate cannot roll from nothing, so the roll was
// declined and the commitment was marked done and quietly retired for good —
// despite carrying the very flag that says it never finishes.
test("an undated recurring milestone rolls from the date it was performed", () => {
  const before = open([{
    ...standingWatch,
    milestones: [{ title: "Annual drill", repeat: "annual" }],
  }])[0];
  assert.equal(before.milestones[0].date, "", "the fixture should start undated");

  const after = applyProjectOps([before], [{
    op: "milestone", name: before.name, milestone: { title: "Annual drill", status: "done" },
  }], { date: "2034-06-03" })[0];

  assert.equal(after.milestones[0].date, "2035-06-03", "did not roll to a next occurrence");
  assert.equal(after.milestones[0].status, "pending", "a standing commitment was retired");
  assert.equal(after.milestones[0].completedCount, 1);
  assert.equal(after.milestones[0].lastCompletedAt, "2034-06-03");
});

// The roll must not fire twice for one performance. A dated milestone still
// anchors on its own date, so the annual drill on 1 June stays on 1 June.
test("a dated recurring milestone still keeps its own day of the year", () => {
  const before = open()[0];
  const after = applyProjectOps([before], [{
    op: "milestone", name: before.name, milestone: { title: "Annual drill", status: "done" },
  }], { date: "2034-06-03" })[0];
  assert.equal(after.milestones[0].date, "2035-06-01");
});

// --- onComplete: projects that actually change the world --------------------
//
// Issue #7. A project had no effect of its own: the close branch set a status,
// pinned progress to 100 and wrote a note, and that was all. So a rename project
// could reach 100% with the country still called what it always was, and an
// annexation could finish without the border ever moving. These pin the whole
// contract: effects fire on completion, exactly once, and never on a cancel or a
// fail.

const annexation = (onComplete) => ({
  op: "create",
  name: "Northern Question",
  summary: "Obtain the northern marches.",
  status: "active",
  progress: 60,
  onComplete,
});

const renameRuritania = {
  polityChanges: [{ code: "Ruritania", name: "Federal Republic of Ruritania" }],
};

const eventWith = (projectOps, impacts = {}) => ({
  date: "2030-06-01",
  title: "The question is settled",
  description: "test",
  impacts: { projectOps, ...impacts },
});

const worldWith = (projects) => normalizeWorldState({ projects });

test("onComplete survives a create and canonicalises its owners", () => {
  const project = applyProjectOps([], [annexation({
    polityChanges: [{ code: "ESP", name: "Spanish Republic" }],
    regionTransfers: [{ regionId: "ESP.1_1", toCode: "ESP" }],
  })])[0];

  assert.equal(project.onComplete.polityChanges[0].code, "Spain", "a bare GADM code must fold to the country name");
  assert.equal(project.onComplete.regionTransfers[0].toCode, "Spain");
  assert.equal(project.onCompleteAppliedAt, "", "nothing has fired yet");
});

test("an onComplete carrying nothing usable normalizes to null, not an empty bag", () => {
  const project = applyProjectOps([], [annexation({ polityChanges: [null, {}], regionTransfers: ["nope"] })])[0];
  assert.equal(project.onComplete, null);
});

// The actual issue-#7 regression. Note the assertion on the KEY: polityOverrides
// is keyed by the polity's stable identity and the new name is a display layer,
// so a rename that moved the key would split one country into two.
test("completing a project applies its onComplete rename under the ORIGINAL key", () => {
  const world = worldWith(applyProjectOps([], [annexation(renameRuritania)]));
  const { world: next } = applyEventImpactsToWorld({
    events: [eventWith([{ op: "complete", name: "Northern Question", note: "Done." }])],
    world,
  });

  assert.equal(next.polityOverrides.Ruritania.name, "Federal Republic of Ruritania");
  assert.equal("Federal Republic of Ruritania" in next.polityOverrides, false, "the key must not move");
  assert.equal(next.projects[0].status, "complete");
  assert.ok(next.projects[0].onCompleteAppliedAt, "the latch must be stamped");
});

test("replaying the same completion does not apply the effects twice", () => {
  const world = worldWith(applyProjectOps([], [annexation({
    regionTransfers: [{ regionId: "RUR.1_1", toCode: "Ruritania" }],
  })]));
  const event = eventWith([{ op: "complete", name: "Northern Question" }]);

  const { world: once } = applyEventImpactsToWorld({ events: [event], world });
  const stamped = once.projects[0].onCompleteAppliedAt;
  once.regionOwnershipOverrides["RUR.1_1"] = "Someone Else";

  const { world: twice } = applyEventImpactsToWorld({ events: [event], world: once });
  assert.equal(twice.regionOwnershipOverrides["RUR.1_1"], "Someone Else", "the transfer fired a second time");
  assert.equal(twice.projects[0].onCompleteAppliedAt, stamped);
});

for (const op of ["cancel", "fail"]) {
  test("op " + op + " never releases onComplete effects", () => {
    const world = worldWith(applyProjectOps([], [annexation(renameRuritania)]));
    const { world: next } = applyEventImpactsToWorld({
      events: [eventWith([{ op, name: "Northern Question", note: "Called off." }])],
      world,
    });

    assert.deepEqual(next.polityOverrides, {}, "a project that did not succeed must change nothing");
    assert.equal(next.projects[0].onCompleteAppliedAt, "");
    assert.equal(next.projects[0].progress, 60, "the real progress figure is the informative one");
  });
}

// The shape a model actually writes at least as often as an explicit close op.
test("an update carrying status complete releases the effects too", () => {
  const world = worldWith(applyProjectOps([], [annexation(renameRuritania)]));
  const { world: next } = applyEventImpactsToWorld({
    events: [eventWith([{ op: "update", name: "Northern Question", status: "complete" }])],
    world,
  });

  assert.equal(next.polityOverrides.Ruritania.name, "Federal Republic of Ruritania");
  assert.ok(next.projects[0].onCompleteAppliedAt);
});

// Pins the fold-before-alias-rebuild ordering: released polityChanges are merged
// into the event's own list BEFORE the owner resolver is rebuilt, so the event's
// other impacts may already speak the name the completion introduces.
test("an event may use the name its completed project introduces", () => {
  const world = worldWith(applyProjectOps([], [annexation(renameRuritania)]));
  const { world: next } = applyEventImpactsToWorld({
    events: [eventWith(
      [{ op: "complete", name: "Northern Question" }],
      { regionTransfers: [{ regionId: "RUR.2_1", toCode: "Federal Republic of Ruritania" }] },
    )],
    world,
  });

  assert.equal(next.regionOwnershipOverrides["RUR.2_1"], "Ruritania", "the transfer minted a phantom polity");
});

test("onComplete region effects clear the dispute they settle", () => {
  const world = normalizeWorldState({
    projects: applyProjectOps([], [annexation({ regionTransfers: [{ regionId: "RUR.1_1", toCode: "Ruritania" }] })]),
    regionClaimants: { "RUR.1_1": ["Ruritania"] },
  });
  const { world: next } = applyEventImpactsToWorld({
    events: [eventWith([{ op: "complete", name: "Northern Question" }])],
    world,
  });

  assert.equal(next.regionOwnershipOverrides["RUR.1_1"], "Ruritania");
  assert.equal("RUR.1_1" in next.regionClaimants, false);
});

// The pre-scan that releases the effects and the applier that stamps the latch
// must resolve an op to the SAME entry, or the effects fire for one project and
// are marked spent on another.
test("a completion matched by name alone fires and latches the same entry", () => {
  const world = worldWith(applyProjectOps([], [annexation(renameRuritania)]));
  const { world: next } = applyEventImpactsToWorld({
    events: [eventWith([{ op: "complete", name: "northern question" }])],
    world,
  });

  assert.equal(next.polityOverrides.Ruritania.name, "Federal Republic of Ruritania");
  assert.ok(next.projects[0].onCompleteAppliedAt);
});

// ONLY AN EVENT MAY CHANGE THE WORLD. The advisor reports and plans; the
// simulation enacts. Its fences (chart/actions/senddraft/deploy/projects) touch no
// border and no polity identity, and onComplete must not become a side door around
// that — otherwise "rename us" is answered by opening a project with a
// polityChanges payload and closing it a reply later, renaming the country from a
// chat window with no jump and nothing in the record to explain it.
test("the non-event door REFUSES to complete a project that would change the world", () => {
  const world = worldWith(applyProjectOps([], [annexation(renameRuritania)]));
  const result = applyProjectOpsToWorld({ ops: [{ op: "complete", name: "Northern Question" }], world });

  assert.deepEqual(result.world.polityOverrides, {}, "the advisor renamed a polity from chat");
  assert.equal(result.world.projects[0].status, "active", "the project must stay open for the simulation to close");
  assert.deepEqual(result.deferredProjectIds, [result.world.projects[0].id]);
});

// Refusing to CLOSE it is not a reason to lose everything else the reply said.
test("a refused completion still applies the rest of the batch", () => {
  const world = worldWith(applyProjectOps([], [annexation(renameRuritania)]));
  const { world: next } = applyProjectOpsToWorld({
    ops: [
      { op: "update", name: "Northern Question", progress: 95, lastUpdate: "The delegation has signed." },
      { op: "complete", name: "Northern Question" },
    ],
    world,
  });

  assert.equal(next.projects[0].progress, 95);
  assert.equal(next.projects[0].lastUpdate, "The delegation has signed.");
  assert.equal(next.projects[0].status, "active");
});

// The ordinary case is untouched: a project with no world-changing payload closes
// from chat exactly as it always did.
test("the non-event door still closes an ordinary project", () => {
  const world = worldWith(open());
  const { deferredProjectIds, world: next } = applyProjectOpsToWorld({
    ops: [{ op: "complete", name: "Operation Standing Watch", note: "Stood down." }],
    world,
  });

  assert.equal(next.projects[0].status, "complete");
  assert.deepEqual(deferredProjectIds, []);
});

// The deferred project is closed by the next EVENT, and the effects land there.
test("the simulation closes what the advisor deferred, and the effects land then", () => {
  const world = worldWith(applyProjectOps([], [annexation(renameRuritania)]));
  const { world: afterChat } = applyProjectOpsToWorld({ ops: [{ op: "complete", name: "Northern Question" }], world });
  const { world: afterJump } = applyEventImpactsToWorld({
    events: [eventWith([{ op: "complete", name: "Northern Question", note: "Ratified." }])],
    world: afterChat,
  });

  assert.equal(afterJump.polityOverrides.Ruritania.name, "Federal Republic of Ruritania");
  assert.equal(afterJump.projects[0].status, "complete");
});

// --- priority: the one field on this board the player authors ---------------

test("priority defaults to normal and accepts the synonyms a model writes", () => {
  assert.equal(applyProjectOps([], [standingWatch])[0].priority, "normal");

  const raised = applyProjectOps(open(), [{ op: "update", name: "Operation Standing Watch", priority: "critical" }]);
  assert.equal(raised[0].priority, "high");

  const dropped = applyProjectOps(raised, [{ op: "update", name: "Operation Standing Watch", priority: "low" }]);
  assert.equal(dropped[0].priority, "low");
});

// The player sets this; a jump that merely mentions the operation must not wipe it.
test("a passing restatement preserves a priority the player set", () => {
  const raised = applyProjectOps(open(), [{ op: "update", name: "Operation Standing Watch", priority: "high" }]);
  const after = applyProjectOps(
    raised,
    [{ op: "create", name: "Operation Standing Watch", summary: "The patrol continues." }],
    { date: "2034-01-01", round: 70 },
  )[0];

  assert.equal(after.priority, "high");
});

// Regression: no EVENT could close a project at all.
//
// normalizeEventImpacts rewrites {"op":"complete"} to {"op":"close","status":
// "complete"} on the way into events.json; applyProjectOps then re-normalizes
// defensively (it must — the advisor hands it an unnormalized block); and
// normalizeProjectOp had no branch for "close", so it returned null and the op
// was dropped. A jump narrating a programme finishing left it active at 60%, and
// cancel and fail went the same way. Only the advisor path worked, because its
// ops pass through the normalizer exactly once.
for (const [op, status] of [["complete", "complete"], ["cancel", "cancelled"], ["fail", "failed"]]) {
  test("an event can " + op + " a project (its op survives a second normalize)", () => {
    const world = normalizeWorldState({ projects: open() });
    const { world: next } = applyEventImpactsToWorld({
      events: [{
        date: "2034-01-01",
        title: "It ends",
        description: "test",
        impacts: { projectOps: [{ op, name: "Operation Standing Watch", note: "How it ended." }] },
      }],
      world,
    });

    assert.equal(next.projects[0].status, status);
    assert.equal(next.projects[0].lastUpdate, "How it ended.");
  });
}

// Every op normalizeProjectOp EMITS must survive being passed back through it —
// that is the invariant the bug above broke, and the one worth pinning.
test("normalized ops are idempotent: re-applying a normalized batch is a no-op", () => {
  const world = normalizeWorldState({ projects: open() });
  const event = {
    date: "2034-01-01",
    title: "It ends",
    description: "test",
    impacts: { projectOps: [{ op: "complete", name: "Operation Standing Watch" }] },
  };
  const { world: once } = applyEventImpactsToWorld({ events: [event], world });
  assert.equal(once.projects[0].status, "complete");

  // A close aimed at an already-closed project changes nothing but must still be
  // understood rather than dropped.
  const { world: twice } = applyEventImpactsToWorld({ events: [event], world: once });
  assert.equal(twice.projects[0].status, "complete");
});

// --- whose project it is ----------------------------------------------------
//
// The board tracks other powers' programmes because the player's services have
// learned of them. The player's two levers — priority and abandon — are things a
// government does to its OWN work, so the panel hides them on a foreign card and
// this door refuses the op behind them. Both matter: the card renders off a 5s
// poll, and a project that changes hands between the render and the click must not
// slip an Abandon through on somebody else's shipyard.

const rivalProgramme = {
  op: "create",
  name: "Kestrel Rocket Programme",
  summary: "Their long-range rocket effort.",
  ownerCode: "Ruritania",
  status: "active",
  progress: 40,
};

const ownProgramme = {
  op: "create",
  name: "Project Leviathan",
  summary: "Our own ship programme.",
  status: "active",
  progress: 20,
};

test("the player's door refuses to abandon another power's programme", () => {
  const world = worldWith(applyProjectOps([], [rivalProgramme]));
  const { refusedProjectIds, world: next } = applyProjectOpsToWorld({
    actor: "player",
    ops: [{ op: "cancel", name: "Kestrel Rocket Programme", note: "Abandoned by the player." }],
    playerCountry: "Spain",
    world,
  });

  assert.equal(next.projects[0].status, "active", "a rival's programme was called off from the panel");
  assert.deepEqual(refusedProjectIds, [next.projects[0].id]);
});

test("the player's door refuses to set a priority on another power's programme", () => {
  const world = worldWith(applyProjectOps([], [rivalProgramme]));
  const { refusedProjectIds, world: next } = applyProjectOpsToWorld({
    actor: "player",
    ops: [{ op: "update", name: "Kestrel Rocket Programme", priority: "high" }],
    playerCountry: "Spain",
    world,
  });

  assert.equal(next.projects[0].priority, "normal");
  assert.equal(refusedProjectIds.length, 1);
});

// The levers still work on their own work — both when the entry names the player
// and when it carries no owner at all, which is how the model writes theirs.
test("the player's door still steers their own work, named or unnamed", () => {
  const world = worldWith(applyProjectOps([], [
    ownProgramme,
    { ...ownProgramme, name: "Project Titan", ownerCode: "Spain" },
  ]));
  const { refusedProjectIds, world: next } = applyProjectOpsToWorld({
    actor: "player",
    ops: [
      { op: "update", name: "Project Leviathan", priority: "high" },
      { op: "cancel", name: "Project Titan", note: "Abandoned by the player." },
    ],
    playerCountry: "Spain",
    world,
  });

  assert.deepEqual(refusedProjectIds, []);
  assert.equal(next.projects[0].priority, "high");
  assert.equal(next.projects[1].status, "cancelled");
  assert.equal(next.projects[1].progress, 20, "an abandoned project keeps the progress it reached");
});

// A renamed polity is the case that would have hurt most: the model writes the
// name the story now uses, and without the fold the player's OWN programme files
// itself under a country that does not exist and loses both levers.
test("an owner written as a polity's display name folds back to the polity", () => {
  const world = normalizeWorldState({
    polityOverrides: { Ruritania: { code: "Ruritania", name: "Federal Republic of Ruritania" } },
  });
  const { world: next } = applyProjectOpsToWorld({
    ops: [{ ...rivalProgramme, ownerCode: "Federal Republic of Ruritania" }],
    world,
  });

  assert.equal(next.projects[0].ownerCode, "Ruritania", "the display name minted a second power");
});

test("an update that re-owns a project folds the new owner too", () => {
  const world = normalizeWorldState({
    polityOverrides: { Ruritania: { code: "Ruritania", name: "Federal Republic of Ruritania" } },
    projects: applyProjectOps([], [ownProgramme]),
  });
  const { world: next } = applyProjectOpsToWorld({
    ops: [{ op: "update", name: "Project Leviathan", owner: "Federal Republic of Ruritania" }],
    world,
  });

  assert.equal(next.projects[0].ownerCode, "Ruritania");
});

// Reporting on a rival's programme is the whole reason foreign entries exist, and
// the advisor's door is not the player's.
test("the advisor's door updates a foreign programme freely", () => {
  const world = worldWith(applyProjectOps([], [rivalProgramme]));
  const { refusedProjectIds, world: next } = applyProjectOpsToWorld({
    ops: [{ op: "update", name: "Kestrel Rocket Programme", progress: 65, lastUpdate: "Static firing observed." }],
    playerCountry: "Spain",
    world,
  });

  assert.deepEqual(refusedProjectIds, []);
  assert.equal(next.projects[0].progress, 65);
});

// Closed work has no levers for anyone, which canPlayerDirect already said — but
// the door must agree, or a stale card could re-cancel a finished project and
// restamp its updatedAt for nothing.
test("the player's door refuses a lever on their own CLOSED project", () => {
  const world = worldWith(applyProjectOps([], [{ ...ownProgramme, status: "complete" }]));
  const { refusedProjectIds } = applyProjectOpsToWorld({
    actor: "player",
    ops: [{ op: "update", name: "Project Leviathan", priority: "high" }],
    playerCountry: "Spain",
    world,
  });

  assert.equal(refusedProjectIds.length, 1);
});
