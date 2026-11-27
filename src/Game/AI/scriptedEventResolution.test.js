import assert from "node:assert/strict";
import test from "node:test";
import { humanCountriesOf, setHostingSharedGame } from "../../runtime/humanPolities.js";
import { firstSkipIncludesScriptedOrigin, scriptedBeatsInSpan } from "./worldDirection.js";
import {
  commitScriptedEventPlan,
  evaluateScriptedEventCondition,
  evaluateScriptedEventConditions,
  normalizeScriptedEventState,
  planScriptedEvents,
  replanAfterSkippedScriptedBeats,
} from "./scriptedEventResolution.js";

const event = (id, trigger = { mode: "rules", operator: "all", conditions: [], percent: 100 }, date = "1914-03-21") => ({
  id, date, title: id, text: `${id} happens.`, trigger,
});

const world = {
  polityOverrides: {
    GBR: { code: "GBR", name: "United Kingdom", status: "active" },
    GER: { code: "GER", name: "German Empire", status: "active" },
    FRA: { code: "FRA", name: "France", status: "active" },
    GONE: { code: "GONE", name: "Gone", status: "dissolved" },
  },
  politicalActors: {
    byPolity: {
      GBR: { name: "United Kingdom" },
      GER: { name: "German Empire" },
    },
  },
  wars: [
    { id: "war-balkan", status: "active" },
    { id: "war-ended", status: "ended" },
  ],
  institutions: {
    byId: {
      "triple-entente": {
        id: "triple-entente",
        status: "active",
        members: [
          { polity: "GBR", status: "member", role: "member" },
          { polity: "GER", status: "observer", role: "member" },
        ],
      },
    },
  },
  puppets: [
    { id: "rel-1", overlord: "GER", puppet: "GBR", kind: "client", status: "active" },
  ],
};

test("rules with no conditions and 100 percent preserve Always exactly-once behavior", () => {
  const first = planScriptedEvents([event("always")], { world, resolvedState: {} });
  assert.deepEqual(first.eligible.map((row) => row.id), ["always"]);
  const committed = commitScriptedEventPlan({}, first, { throughDate: "1914-03-21" });
  assert.equal(committed.state.always.outcome, "fired");

  const second = planScriptedEvents([event("always")], { world, resolvedState: committed.state });
  assert.deepEqual(second.eligible, []);
  assert.deepEqual(second.resolutions, []);
});

test("Chance is rolled once for a held attempt, then persisted after the accepted segment", () => {
  let rolls = 0;
  const chance = event("chance", { mode: "rules", operator: "all", conditions: [], percent: 25 });

  const first = planScriptedEvents([chance], {
    world,
    resolvedState: {},
    pendingState: {},
    random: () => { rolls += 1; return 0.10; },
  });
  assert.equal(rolls, 1);
  assert.equal(first.eligible.length, 1);

  const retry = planScriptedEvents([chance], {
    world,
    resolvedState: {},
    pendingState: first.pendingState,
    random: () => { rolls += 1; return 0.99; },
  });
  assert.equal(rolls, 1, "a held-segment retry must reuse the first roll");
  assert.equal(retry.eligible.length, 1);

  const committed = commitScriptedEventPlan({}, retry, { throughDate: "1914-03-21" });
  assert.equal(committed.state.chance.outcome, "fired");
  assert.equal(committed.state.chance.roll, 0.10);

  const afterReload = planScriptedEvents([chance], {
    world,
    resolvedState: normalizeScriptedEventState(committed.state),
    random: () => { rolls += 1; return 0.99; },
  });
  assert.equal(rolls, 1, "a persisted outcome must never reroll after reload");
  assert.deepEqual(afterReload.eligible, []);
});

test("conditions are checked before chance and a failed condition never consumes a roll", () => {
  let rolls = 0;
  const conditionalChance = event("conditional-chance", {
    mode: "rules",
    operator: "all",
    conditions: [
      { type: "polity_exists", polityId: "GBR" },
      { type: "institution_has_polity", institutionId: "triple-entente", polityId: "GONE" },
    ],
    percent: 50,
  });
  const plan = planScriptedEvents([conditionalChance], {
    world,
    random: () => { rolls += 1; return 0; },
  });
  assert.equal(rolls, 0);
  assert.deepEqual(plan.eligible, []);
});

test("rules can fire on at least N of M conditions regardless of which conditions matched", () => {
  const twoOfThree = event("two-of-three", {
    mode: "rules",
    operator: "at_least",
    requiredCount: 2,
    conditions: [
      { type: "polity_exists", polityId: "GBR" },
      { type: "polity_exists", polityId: "GER" },
      { type: "polity_exists", polityId: "GONE" },
    ],
    percent: 100,
  });
  const evaluation = evaluateScriptedEventConditions(twoOfThree.trigger, world);
  assert.equal(evaluation.matched, true);
  assert.equal(evaluation.matchedCount, 2);
  assert.equal(evaluation.requiredCount, 2);
  assert.deepEqual(planScriptedEvents([twoOfThree], { world }).eligible.map((row) => row.id), ["two-of-three"]);
});

test("safe authoring predicates read Political World, membership status and puppet canon by exact ids", () => {
  assert.equal(evaluateScriptedEventCondition({ type: "political_actor_exists", polityId: "GBR" }, world).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "political_actor_not_exists", polityId: "FRA" }, world).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "political_actor_not_exists", polityId: "GONE" }, world).matched, false, "negative relationship predicates fail closed when the polity itself is absent");
  assert.equal(evaluateScriptedEventCondition({ type: "institution_member_status", institutionId: "triple-entente", polityId: "GER", status: "observer" }, world).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "polity_subordinate_to", polityId: "GBR", overlordId: "GER" }, world).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "polity_subordinate_to", polityId: "GBR", overlordId: "GER", kind: "client" }, world).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "polity_subordinate_to", polityId: "GBR", overlordId: "GER", kind: "satellite" }, world).matched, false);
  assert.equal(evaluateScriptedEventCondition({ type: "polity_not_subordinate_to", polityId: "GER", overlordId: "GBR" }, world).matched, true);
});

test("legacy war predicates remain readable but malformed predicates still fail closed", () => {
  assert.equal(evaluateScriptedEventConditions({
    operator: "all",
    conditions: [
      { type: "polity_not_exists", polityId: "GONE" },
      { type: "war_not_active", warId: "war-ended" },
      { type: "institution_has_polity", institutionId: "triple-entente", polityId: "GBR" },
    ],
  }, world).matched, true);

  assert.equal(evaluateScriptedEventConditions({
    operator: "all",
    conditions: [{ type: "polity_exists", polityId: "" }],
  }, world).matched, false);

  assert.equal(evaluateScriptedEventConditions({
    operator: "any",
    conditions: [{ type: "future_predicate_we_do_not_support", value: "x" }],
  }, world).matched, false);
});

test("a false dated condition is terminal and does not wake up later", () => {
  const conditional = event("curragh", {
    mode: "rules",
    operator: "all",
    conditions: [{ type: "institution_exists", institutionId: "future-institution" }],
    percent: 100,
  });
  const first = planScriptedEvents([conditional], { world });
  assert.deepEqual(first.eligible, []);
  const committed = commitScriptedEventPlan({}, first, { throughDate: "1914-03-21" });
  assert.equal(committed.state.curragh.outcome, "skipped");

  const changedWorld = {
    ...world,
    institutions: {
      byId: {
        ...world.institutions.byId,
        "future-institution": { id: "future-institution", status: "active", members: [] },
      },
    },
  };
  const later = planScriptedEvents([conditional], { world: changedWorld, resolvedState: committed.state });
  assert.deepEqual(later.eligible, [], "a condition that was false on its date stays skipped");
});

test("a planned chance beyond an auto-stop date is not committed", () => {
  const chance = event("later", { mode: "rules", operator: "all", conditions: [], percent: 100 }, "1914-04-01");
  const plan = planScriptedEvents([chance], { world, random: () => 0 });
  const before = commitScriptedEventPlan({}, plan, { throughDate: "1914-03-22" });
  assert.deepEqual(before.state, {});
});

test("region-control predicates use live overrides before authored base ownership and fail closed when unknown", () => {
  const controlled = { ...world, regionOwnershipOverrides: { R1: "GER" } };
  assert.equal(evaluateScriptedEventCondition({ type: "polity_controls_region", polityId: "GER", regionId: "R1", baseOwner: "FRA" }, controlled).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "polity_controls_region", polityId: "FRA", regionId: "R1", baseOwner: "FRA" }, controlled).matched, false);
  assert.equal(evaluateScriptedEventCondition({ type: "polity_not_controls_region", polityId: "GER", regionId: "R2", baseOwner: "FRA" }, controlled).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "polity_not_controls_region", polityId: "GER", regionId: "UNKNOWN" }, controlled).matched, false);
});

test("scripted-event dependency negatives stay false until the referenced event actually resolves", () => {
  const unresolved = { scriptedEventState: {} };
  assert.equal(evaluateScriptedEventCondition({ type: "scripted_event_skipped", eventId: "prior" }, world, unresolved).matched, false);
  assert.equal(evaluateScriptedEventCondition({ type: "scripted_outcome_not_selected", eventId: "prior", outcomeId: "b" }, world, unresolved).matched, false);
  const resolved = { scriptedEventState: { prior: { outcome: "fired", selectedOutcomeId: "a" } } };
  assert.equal(evaluateScriptedEventCondition({ type: "scripted_event_fired", eventId: "prior" }, world, resolved).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "scripted_outcome_selected", eventId: "prior", outcomeId: "a" }, world, resolved).matched, true);
  assert.equal(evaluateScriptedEventCondition({ type: "scripted_outcome_not_selected", eventId: "prior", outcomeId: "b" }, world, resolved).matched, true);
});

test("one weighted branch outcome is selected once and survives retry plus save reload", () => {
  let rolls = 0;
  const branched = { ...event("election"), textMode: "exact", outcomes: [
    { id: "a", title: "A wins", text: "Candidate A wins.", weight: 25 },
    { id: "b", title: "B wins", text: "Candidate B wins.", weight: 75 },
  ] };
  const first = planScriptedEvents([branched], { world, random: () => { rolls += 1; return 0.8; } });
  assert.equal(first.eligible.length, 1);
  assert.equal(first.eligible[0].selectedOutcomeId, "b");
  assert.equal(first.eligible[0].text, "Candidate B wins.");
  assert.equal(first.eligible[0].parentText, branched.text, "the selected branch keeps the parent event context beside its own text");
  assert.equal(first.eligible[0].textMode, "exact", "the selected outcome inherits the parent event wording mode");
  assert.equal(rolls, 1, "100% trigger consumes no roll; only the branch selection rolls");
  const retry = planScriptedEvents([branched], { world, pendingState: first.pendingState, random: () => { rolls += 1; return 0; } });
  assert.equal(retry.eligible[0].selectedOutcomeId, "b");
  assert.equal(rolls, 1, "held retry must not reroll branch selection");
  const committed = commitScriptedEventPlan({}, retry, { throughDate: "1914-03-21" });
  assert.equal(committed.state.election.selectedOutcomeId, "b");
  assert.equal(committed.fired[0].selectedOutcomeId, "b");
  assert.equal(committed.fired[0].text, "Candidate B wins.", "fallback/engine insertion must keep the selected branch, not the parent event text");
  const afterReload = planScriptedEvents([branched], { world, resolvedState: normalizeScriptedEventState(committed.state), random: () => { rolls += 1; return 0; } });
  assert.deepEqual(afterReload.eligible, []);
  assert.equal(rolls, 1);
});

test("later due events in the same plan can depend on the selected outcome of an earlier event", () => {
  const primary = { ...event("primary", undefined, "1914-03-20"), outcomes: [
    { id: "reformer", text: "The reformer wins.", weight: 1 },
    { id: "hardliner", text: "The hardliner wins.", weight: 0 },
  ] };
  const followup = event("followup", { mode: "rules", operator: "all", conditions: [
    { type: "scripted_outcome_selected", eventId: "primary", outcomeId: "reformer" },
  ], percent: 100 }, "1914-03-21");
  const plan = planScriptedEvents([primary, followup], { world, random: () => 0.2 });
  assert.deepEqual(plan.eligible.map((row) => row.id), ["primary", "followup"]);
});

test("Swan Lake-style first-day chain resolves all authored beats after pregame bootstrap", () => {
  const start = "1991-08-19";
  const startGame = { startDate: start, gameDate: start, round: 1 };
  const bootstrap = { simulationHistory: [{
    date: start, fromDate: "1985-03-11", toDate: start, mode: "pregame", source: "scenario",
  }] };
  const beats = [
    event("overnight-plan", undefined, start),
    { ...event("emergency-announcement", undefined, start), outcomes: [
      { id: "constitutional", text: "The committee follows constitutional limits.", weight: 100 },
      { id: "unconstitutional", text: "The committee seizes extra powers.", weight: 0 },
    ] },
    event("swan-lake-broadcast", undefined, start),
    event("ukrainian-response", { mode: "rules", operator: "all", percent: 100, conditions: [
      { type: "scripted_event_fired", eventId: "emergency-announcement" },
    ] }, "1991-08-20"),
    event("march-on-moscow", { mode: "rules", operator: "all", percent: 100, conditions: [
      { type: "scripted_outcome_selected", eventId: "emergency-announcement", outcomeId: "constitutional" },
    ] }, "1991-08-21"),
    event("final-condemnation", { mode: "rules", operator: "all", percent: 100, conditions: [
      { type: "scripted_event_fired", eventId: "ukrainian-response" },
    ] }, "1991-08-21"),
  ];
  const due = scriptedBeatsInSpan(beats, {
    originDate: start,
    targetDate: "1991-08-26",
    includeOrigin: firstSkipIncludesScriptedOrigin({
      game: startGame, world: bootstrap, originDate: start, segmentIndex: 0,
    }),
  });
  assert.equal(due.length, 6, "pregame history cannot discard the three start-day beats");
  const plan = planScriptedEvents(due, { world, random: () => 0.99 });
  assert.deepEqual(plan.eligible.map((row) => row.id), beats.map((row) => row.id));
  assert.equal(plan.eligible[1].selectedOutcomeId, "constitutional", "the zero-weight alternative cannot be selected");
  const committed = commitScriptedEventPlan({}, plan, { throughDate: "1991-08-26" });
  assert.equal(committed.fired.length, 6);
  assert.equal(committed.skipped.length, 0);
  assert.equal(Object.keys(committed.state).length, 6);
  assert.equal(planScriptedEvents(due, { world, resolvedState: committed.state }).eligible.length, 0,
    "reload never reruns the completed scenario chain");
});

test("a branch with no positive-weight outcome fails closed", () => {
  const branched = { ...event("bad-branch"), outcomes: [
    { id: "a", text: "A", weight: 0 },
    { id: "b", text: "B", weight: -4 },
  ] };
  const plan = planScriptedEvents([branched], { world, random: () => 0 });
  assert.deepEqual(plan.eligible, []);
  assert.equal(plan.resolutions[0].outcome, "skipped");
});

test("N031 player-control conditions use canonical identities and fail closed",()=>{
 const positive={type:"polity_player_controlled",polityId:"GER"};
 const negative={...positive,type:"polity_not_player_controlled"};
 const match=(condition,playerPolities)=>evaluateScriptedEventCondition(condition,world,{playerPolities}).matched;
 assert.equal(match(positive,["German Empire"]),true);
 assert.equal(match(negative,["German Empire"]),false);
 assert.equal(match(negative,["France"]),true);
 for(const seats of [undefined,[],["unknown-country"],["France","unknown-country"]]){
  assert.equal(match(positive,seats),false);
  assert.equal(match(negative,seats),false);
 }
 for(const polityId of ["","invented","GONE"]){
  assert.equal(match({...negative,polityId},["France"]),false);
  assert.equal(match({...positive,polityId},["France"]),false);
 }
 const custom={...world,customRegions:true};
 assert.equal(evaluateScriptedEventCondition({...negative,polityId:"Japan"},custom,{playerPolities:["France"]}).matched,false);
});
test("N031 uses real shared host seats, not a saved stale multiplayer roster; skipped elections stay skipped",()=>{
 const game={country:"France",humanCountries:["France","German Empire"]};
 const beat=event("election",{mode:"rules",operator:"all",conditions:[{type:"polity_not_player_controlled",polityId:"GER"}],percent:100});
 setHostingSharedGame(false);
 assert.equal(planScriptedEvents([beat],{world,playerPolities:humanCountriesOf(game)}).eligible.length,1);
 try{
  setHostingSharedGame(true,{host:"France"});
  const plan=planScriptedEvents([beat],{world,playerPolities:humanCountriesOf(game)});
  assert.equal(plan.eligible.length,0);
  const receipt=commitScriptedEventPlan({},plan,{throughDate:beat.date});
  assert.equal(receipt.state.election.outcome,"skipped");
  assert.equal(planScriptedEvents([beat],{world,playerPolities:["France"],resolvedState:receipt.state}).eligible.length,0);
 }finally{setHostingSharedGame(false);}
 const war=event("war",{mode:"rules",operator:"all",conditions:[
  {type:"polity_not_player_controlled",polityId:"GER"},{type:"polity_not_player_controlled",polityId:"GBR"}],percent:100});
 assert.equal(planScriptedEvents([war],{world,playerPolities:["FRA"]}).eligible.length,1);
 assert.equal(planScriptedEvents([war],{world,playerPolities:["GBR"]}).eligible.length,0);
});

test("N031 exact owner identities work on legacy custom maps; dissolved and ambiguous registry identities fail closed",()=>{
 const legacy={customRegions:true,ownerCodes:["Hill Kingdom","Valley Republic"],regionOwnershipOverrides:{"hill-1":"Hill Kingdom"}};
 const condition={type:"polity_not_player_controlled",polityId:"Hill Kingdom"};
 assert.equal(evaluateScriptedEventCondition(condition,legacy,{playerPolities:["Valley Republic"]}).matched,true);
 assert.equal(evaluateScriptedEventCondition(condition,legacy,{playerPolities:["Hill Kingdom"]}).matched,false);
 const dissolved={...legacy,polityOverrides:{"Hill Kingdom":{code:"Hill Kingdom",name:"Hill Kingdom",status:"dissolved"}}};
 assert.equal(evaluateScriptedEventCondition(condition,dissolved,{playerPolities:["Valley Republic"]}).matched,false);
 const ambiguous={...world,polityOverrides:{...world.polityOverrides,A:{name:"Shared name",status:"active"},B:{name:"Shared name",status:"active"}}};
 assert.equal(evaluateScriptedEventCondition({...condition,polityId:"Shared name"},ambiguous,{playerPolities:["France"]}).matched,false);
});

test("N031 a known dissolved human seat in MP does not break player-control checks for surviving polities", () => {
  const mpWorld = {
    polityOverrides: {
      GER: { code: "GER", name: "German Empire", status: "active" },
      FRA: { code: "FRA", name: "France", status: "active" },
      GONE: { code: "GONE", name: "Dissolved Seat", status: "dissolved" },
    },
  };
  assert.equal(
    evaluateScriptedEventCondition({ type: "polity_player_controlled", polityId: "FRA" }, mpWorld, { playerPolities: ["FRA", "GONE"] }).matched,
    true,
  );
  assert.equal(
    evaluateScriptedEventCondition({ type: "polity_not_player_controlled", polityId: "GER" }, mpWorld, { playerPolities: ["FRA", "GONE"] }).matched,
    true,
  );
  assert.equal(
    evaluateScriptedEventCondition({ type: "polity_player_controlled", polityId: "GER" }, mpWorld, { playerPolities: ["FRA", "GONE"] }).matched,
    false,
  );
});

test("replanAfterSkippedScriptedBeats clears stale dirty pending entries before Phase 2 for out-of-order [A, C, B] chains", () => {
  const beatA = event("A", { mode: "rules", operator: "all", conditions: [], percent: 100 }, "1914-03-21");
  const beatB = event("B", { mode: "rules", operator: "all", conditions: [{ type: "scripted_event_fired", eventId: "A" }], percent: 100 }, "1914-03-21");
  const beatC = event("C", { mode: "rules", operator: "all", conditions: [{ type: "scripted_event_fired", eventId: "B" }], percent: 100 }, "1914-03-21");
  const outOfOrder = [beatA, beatC, beatB];

  // Cached pendingState already holds { A: fired, B: fired, C: fired } while
  // the same-date input array places C before B.
  const cachedAllFired = {
    A: { outcome: "fired" },
    B: { outcome: "fired" },
    C: { outcome: "fired" },
  };
  const initialPlan = planScriptedEvents(outOfOrder, { world, pendingState: cachedAllFired, random: () => 0 });
  assert.deepEqual(
    initialPlan.resolutions.map((r) => [r.event.id, r.outcome]),
    [["A", "fired"], ["C", "fired"], ["B", "fired"]],
  );

  // If A is later skipped while preservedPending still holds { A: fired, B: fired, C: fired },
  // C must not read stale nextPending.B = fired and survive as fired.
  const replanned = replanAfterSkippedScriptedBeats(
    outOfOrder,
    initialPlan,
    [{ beat: beatA, reason: "impact skipped" }],
    { world, random: () => 0, preservedPending: cachedAllFired },
  );
  const outcomesById = Object.fromEntries(replanned.resolutions.map((r) => [r.event.id, r.outcome]));
  assert.deepEqual(outcomesById, { A: "skipped", B: "skipped", C: "skipped" });

  // Conversely, when preservedPending already matches the post-skip chain
  // (B requires A skipped; C requires B fired), fixpoint Phase 2 restores C's cached branch.
  const altB = event("B", { mode: "rules", operator: "all", conditions: [{ type: "scripted_event_skipped", eventId: "A" }], percent: 100 }, "1914-03-21");
  const altC = {
    ...event("C", { mode: "rules", operator: "all", conditions: [{ type: "scripted_event_fired", eventId: "B" }], percent: 100 }, "1914-03-21"),
    outcomes: [
      { id: "branch-1", text: "Branch 1", weight: 50 },
      { id: "branch-2", text: "Branch 2", weight: 50 },
    ],
  };
  const altChain = [beatA, altC, altB];
  const preservedAfterSkip = {
    A: { outcome: "skipped", reason: "impact skipped" },
    B: { outcome: "fired" },
    C: { outcome: "fired", selectedOutcomeId: "branch-2" },
  };
  const altInitial = planScriptedEvents(altChain, { world, random: () => 0 });
  const restoredPlan = replanAfterSkippedScriptedBeats(
    altChain,
    altInitial,
    [{ beat: beatA, reason: "impact skipped" }],
    { world, random: () => 0, preservedPending: preservedAfterSkip },
  );
  const restoredById = Object.fromEntries(restoredPlan.resolutions.map((r) => [r.event.id, r]));
  assert.equal(restoredById.A.outcome, "skipped");
  assert.equal(restoredById.B.outcome, "fired");
  assert.equal(restoredById.C.outcome, "fired");
  assert.equal(restoredById.C.selectedOutcomeId, "branch-2");
});
