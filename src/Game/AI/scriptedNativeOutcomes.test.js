/*! Open Historia - N031 authored outcome regression tests. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeScriptedEvents } from "../../../server/gameFeatures.js";
import { impactRowProblems, nativeScriptedImpactRows } from "../../../server/scriptedImpacts.js";
import { normalizeWorldState, normalizeEvents } from "../../runtime/gameState.js";
import { planScriptedEvents, commitScriptedEventPlan } from "./scriptedEventResolution.js";
import { ensureScriptedEventsWithImpacts, buildScriptedImpactsInstruction } from "./scriptedEventImpacts.js";
import { prepareNativeScriptedOutcomes, bindNativeScriptedOutcomes, verifyNativeScriptedRecords, verifyNativeScriptedOutcomes, remapNativeScriptedOutcomes, verifyNativeScriptedCoverage } from "./scriptedNativeOutcomes.js";
import { settleWarLedger, applyWarUpdates } from "./nativeWarLedger.js";
import { applyDiplomaticUpdates } from "./nativeDiplomaticDirector.js";
import { giveSegmentEventIds, pinLedgersToEvents } from "./ledgerPins.js";
import { journalTurn, truncateTurn } from "./intervene.js";

const world=normalizeWorldState({
 customRegions:true,
 polityOverrides:Object.fromEntries(["Germany","Denmark","France","Belgium"].map(name=>[name,{code:name,name,status:"active"}])),
 regionOwnershipOverrides:{ger:"Germany",den:"Denmark",fra:"France",bel:"Belgium"},
 ownerCodes:["Germany","Denmark","France","Belgium"]
});
const regionCatalog=Object.entries(world.regionOwnershipOverrides).map(([id,country])=>({id,country}));
const date="1914-03-21";
const declaration={type:"start_war",actor:"Germany",opponent:"Denmark",warTitle:"Northern War"};
const install={type:"install_puppet",polity:"Belgium",overlord:"France",kind:"protectorate",loyalty:"45",secrecy:"open"};
const beat=(id,rows,extra={})=>normalizeScriptedEvents([{id,date,text:id+" happens.",impactRows:rows,...extra}])[0];
const prepare=(beats,w=world)=>prepareNativeScriptedOutcomes(beats,w,{regionCatalog});
const pipeline=(beats,{base=world,events=[],warUpdates=[],puppetUpdates=[]}={})=>{
 const req=prepare(beats,base);
 const candidate={events,warUpdates,puppetUpdates};
 pinLedgersToEvents(candidate);
 candidate.events=ensureScriptedEventsWithImpacts(candidate.events,beats).events;
 giveSegmentEventIds(candidate.events);
 const bound=bindNativeScriptedOutcomes(candidate,beats,req,base);
 settleWarLedger(candidate,{world:base});
 verifyNativeScriptedRecords(bound,candidate,base);
 const war=applyWarUpdates({world:base,updates:candidate.warUpdates,events:candidate.events,stopDate:date,round:2});
 const diplomacy=applyDiplomaticUpdates({world:war.world,puppetUpdates:candidate.puppetUpdates,events:candidate.events,stopDate:date,round:2,regionCatalog});
 verifyNativeScriptedOutcomes(bound,diplomacy.world,normalizeEvents(candidate.events));
 return {candidate,bound,world:diplomacy.world};
};

test("N031 structural rows survive normalization and selected outcome without writing parallel impacts",()=>{
 const event=beat("branch",[declaration],{outcomes:[{id:"yes",text:"Protectorate installed.",weight:1,impactRows:[install]},{id:"no",text:"Nothing changes.",weight:0,impactRows:[{...install,polity:"Denmark"}]}]});
 assert.deepEqual(normalizeScriptedEvents([event]),[event]);
 assert.equal(event.impacts,undefined);
 const plan=planScriptedEvents([event],{world,random:()=>0});
 assert.equal(plan.eligible[0].selectedOutcomeId,"yes");
 assert.deepEqual(nativeScriptedImpactRows(plan.eligible[0]).map(x=>x.row),[declaration,install]);
 assert.match(buildScriptedImpactsInstruction(plan.eligible),/Germany declares war on Denmark/);
 assert.match(buildScriptedImpactsInstruction(plan.eligible),/Belgium becomes the protectorate of France/);
});

test("N031 missing model event gets exact native war and puppet records, source IDs and date",()=>{
 const beats=[beat("war",[declaration]),beat("subordinate",[install])];
 const before=JSON.stringify(world);
 const result=pipeline(beats);
 assert.equal(JSON.stringify(world),before);
 assert.equal(result.world.wars.length,1);
 assert.equal(result.world.wars[0].title,"Northern War");
 assert.equal(result.world.wars[0].status,"active");
 assert.deepEqual(result.world.wars[0].sideA,["Germany"]);
 assert.deepEqual(result.world.wars[0].sideB,["Denmark"]);
 assert.equal(result.world.puppets.length,1);
 assert.equal(result.world.puppets[0].loyalty,45);
 assert.deepEqual(result.world.regionOwnershipOverrides,world.regionOwnershipOverrides);
 const plan=planScriptedEvents(beats,{world});
 const receipt=commitScriptedEventPlan({},plan,{throughDate:date});
 assert.equal(planScriptedEvents(beats,{world:result.world,resolvedState:receipt.state}).eligible.length,0);
});

test("N031 replaces an AI duplicate instead of granting extra belligerents",()=>{
 const events=[{id:"war-card",date:"1914-03-20",title:"War",description:"War begins.",scriptedBeat:"war",warId:"ai-war",combatants:["Germany","Denmark","France"]}];
 const result=pipeline([beat("war",[declaration])],{events,warUpdates:[{id:"ai-war",op:"start",actors:["Germany","France"],opponents:["Denmark"],eventIds:["war-card"]}]});
 assert.equal(result.world.wars.length,1);
 assert.deepEqual(result.world.wars[0].sideA,["Germany"]);
 assert.equal(result.world.wars[0].startedDate,date);
 assert.equal(result.candidate.events[0].warId,result.world.wars[0].id);
});

test("N031 refuses malformed, self, duplicate, landless and competing arrangements before commit",()=>{
 for(const row of [{...declaration,opponent:"Germany"},{...declaration,opponent:"Uninvented country"},{...install,loyalty:"101"},{...install,kind:"unknown"},{...install,overlord:"Belgium"},{...install,secrecy:""}]){
   assert.throws(()=>prepare([beat("invalid",[row])]),/Scripted event/);
 }
 assert.ok(impactRowProblems({...install,loyalty:""}).includes("loyalty"));
 assert.throws(()=>prepare([beat("two-wars",[declaration,{...declaration,actor:"France"}])]),/Only one war/);
 const live=pipeline([beat("war",[declaration]),beat("subordinate",[install])]).world;
 assert.throws(()=>prepare([beat("again",[declaration])],live),/already opposing/);
 assert.throws(()=>prepare([beat("again",[install])],live),/already has an overlord/);
 assert.throws(()=>prepare([beat("cycle",[{...install,polity:"France",overlord:"Belgium"}])],live),/already has an overlord/);
 assert.throws(()=>prepareNativeScriptedOutcomes([beat("unmapped",[install])],world),/retain territory/);
});

test("N031 skipped event and territory contest alone create no war; final proof refuses missing receipts",()=>{
 const event=beat("war",[declaration],{trigger:{mode:"rules",operator:"all",percent:100,conditions:[{type:"polity_not_player_controlled",polityId:"Germany"}]}});
 const plan=planScriptedEvents([event],{world,playerPolities:["Germany"]});
 assert.equal(plan.eligible.length,0);
 assert.deepEqual(prepare(plan.eligible),[]);
 assert.equal(pipeline([beat("contest",[{type:"contest",actor:"Germany",regions:[{id:"den",name:"Denmark"}]}])]).world.wars.length,0);
 const result=pipeline([beat("war",[declaration])]);
 assert.throws(()=>verifyNativeScriptedOutcomes(result.bound,world,result.candidate.events),/not applied/);
 assert.throws(()=>verifyNativeScriptedOutcomes(result.bound,result.world,[]),/missing/);
 assert.throws(()=>remapNativeScriptedOutcomes(result.bound,new Map()),/discarded/);
 assert.throws(()=>verifyNativeScriptedRecords(result.bound,{...result.candidate,warUpdates:[]},world),/did not retain/);
});

test("N031 requires exact native receipts for every fired selected row",()=>{
 const beats=[beat("war",[declaration]),beat("subordinate",[install])];
 const {bound}=pipeline(beats);
 verifyNativeScriptedCoverage(beats,bound);
 assert.throws(()=>verifyNativeScriptedCoverage(beats,[]),/missing/);
 assert.throws(()=>verifyNativeScriptedCoverage(beats,[bound[0],bound[0],bound[1]]),/missing/);
 assert.throws(()=>verifyNativeScriptedCoverage([],bound),/unexpected/);
});

test("N031 Intervene keeps a native outcome and its once-only receipt together",()=>{
 const result=pipeline([beat("war",[declaration])]);
 const source=result.candidate.events[0];
 const journal=journalTurn({events:[{id:"earlier",date:"1914-03-20"},source,{id:"later",date:"1914-03-22"}],warUpdates:result.candidate.warUpdates,scriptedNativeOutcomes:result.bound,scriptedEventState:{war:{date,outcome:"fired",mode:"rules"}}});
 const before=truncateTurn(journal,1,{originDate:"1914-03-19"});
 assert.equal(before.result.warUpdates.length,0);
 assert.deepEqual(before.result.scriptedEventState,{});
 const after=truncateTurn(journal,2,{originDate:"1914-03-19"});
 assert.equal(after.result.warUpdates.length,1);
 assert.equal(after.result.scriptedEventState.war.outcome,"fired");
 assert.equal(after.result.scriptedNativeOutcomes.length,1);
 assert.throws(()=>truncateTurn({...journal,events:[{id:"same-day",date},source]},1,{originDate:"1914-03-19"}),/cannot split a day/);
});

test("N031 partitionPreparedNativeScriptedOutcomes skips inapplicable beats on world-state drift without blocking valid beats", async () => {
  const { partitionPreparedNativeScriptedOutcomes } = await import("./scriptedNativeOutcomes.js");
  const live = pipeline([beat("existing-war", [declaration])]).world;
  const driftedBeat = beat("drifted-war", [declaration]);
  const validBeat = beat("valid-subordinate", [install]);
  const partitioned = partitionPreparedNativeScriptedOutcomes([driftedBeat, validBeat], live, { regionCatalog });
  assert.equal(partitioned.skippedBeats.length, 1);
  assert.equal(partitioned.skippedBeats[0].beat.id, "drifted-war");
  assert.equal(partitioned.eligibleBeats.length, 1);
  assert.equal(partitioned.eligibleBeats[0].id, "valid-subordinate");
  assert.equal(partitioned.requirements.length, 1);
  assert.equal(partitioned.requirements[0].beatId, "valid-subordinate");

  // Running ensureScriptedEventsWithImpacts + bindNativeScriptedOutcomes on activeDue (eligibleBeats)
  // never force-inserts the skipped beat into candidate.events.
  const candidate = { events: [], warUpdates: [], puppetUpdates: [] };
  candidate.events = ensureScriptedEventsWithImpacts(candidate.events, partitioned.eligibleBeats).events;
  giveSegmentEventIds(candidate.events);
  const bound = bindNativeScriptedOutcomes(candidate, partitioned.eligibleBeats, partitioned.requirements, live);
  assert.equal(candidate.events.length, 1);
  assert.equal(candidate.events[0].scriptedBeat, "valid-subordinate");
  assert.equal(bound.length, 1);
  verifyNativeScriptedCoverage(partitioned.eligibleBeats, bound);
});

test("N031 replanAfterSkippedScriptedBeats re-evaluates same-segment scripted_event_fired chains without rerolling unrelated beats", async () => {
  const { replanAfterSkippedScriptedBeats } = await import("./scriptedEventResolution.js");
  const { partitionPreparedNativeScriptedOutcomes } = await import("./scriptedNativeOutcomes.js");
  const live = pipeline([beat("existing-war", [declaration])]).world;
  const drifted = beat("drifted-war", [declaration]);
  const dependentFired = beat("follows-war", [], {
    date: "1914-03-22",
    trigger: { mode: "conditional", operator: "all", conditions: [{ type: "scripted_event_fired", eventId: "drifted-war" }] },
  });
  const dependentSkipped = beat("fallback-after-skip", [], {
    date: "1914-03-22",
    trigger: { mode: "conditional", operator: "all", conditions: [{ type: "scripted_event_skipped", eventId: "drifted-war" }] },
  });
  const unrelatedChance = beat("coin-flip", [], {
    date: "1914-03-23",
    trigger: { mode: "chance", percent: 50 },
  });

  const events = [drifted, dependentFired, dependentSkipped, unrelatedChance];
  const initialPlan = planScriptedEvents(events, { world: live, random: () => 0.1 });
  assert.deepEqual(initialPlan.eligible.map((e) => e.id), ["drifted-war", "follows-war", "coin-flip"]);

  const partitioned = partitionPreparedNativeScriptedOutcomes(initialPlan.eligible, live, { regionCatalog });
  assert.equal(partitioned.skippedBeats.length, 1);

  // Replan with random=() => 0.99 to prove unrelatedChance keeps its cached 0.1 roll!
  const reconciled = replanAfterSkippedScriptedBeats(events, initialPlan, partitioned.skippedBeats, {
    world: live,
    random: () => 0.99,
  });
  assert.deepEqual(reconciled.eligible.map((e) => e.id), ["fallback-after-skip", "coin-flip"]);
  const committed = commitScriptedEventPlan({}, reconciled, { throughDate: "1914-03-25" });
  assert.equal(committed.state["drifted-war"].outcome, "skipped");
  assert.equal(committed.state["follows-war"].outcome, "skipped");
  assert.equal(committed.state["fallback-after-skip"].outcome, "fired");
  assert.equal(committed.state["coin-flip"].outcome, "fired");
});

test("N031 replanAfterSkippedScriptedBeats preserves cached Chance/weighted rolls on auto early-stop when dependencies match", async () => {
  const { replanAfterSkippedScriptedBeats } = await import("./scriptedEventResolution.js");
  const { partitionPreparedNativeScriptedOutcomes } = await import("./scriptedNativeOutcomes.js");
  const live = pipeline([beat("existing-war", [declaration])]).world;

  // Two drifted beats on different dates, plus a Chance beat gated on the first one.
  const driftedEarly = beat("drifted-early", [declaration], { date: "1914-03-10" });
  const dependentChance = beat("chance-after-early", [], {
    date: "1914-03-15",
    trigger: {
      mode: "rules",
      operator: "all",
      percent: 50,
      conditions: [{ type: "scripted_event_skipped", eventId: "drifted-early" }],
    },
  });
  const driftedLate = beat("drifted-late", [declaration], { date: "1914-03-25" });

  const events = [driftedEarly, dependentChance, driftedLate];
  const initialPlan = planScriptedEvents(events, { world: live, random: () => 0.1 });
  const prePartition = partitionPreparedNativeScriptedOutcomes(initialPlan.eligible, live, { regionCatalog });
  assert.equal(prePartition.skippedBeats.length, 2);

  // Pre-prompt fixpoint replanning unlocks dependentChance with random=0.1 -> fired.
  const preReconciled = replanAfterSkippedScriptedBeats(events, initialPlan, prePartition.skippedBeats, {
    world: live,
    random: () => 0.1,
  });
  assert.deepEqual(preReconciled.eligible.map((e) => e.id), ["chance-after-early"]);

  // Auto mode stops at 1914-03-20 (between driftedEarly and driftedLate).
  // Re-running with random=0.99 and preservedPending MUST NOT re-roll dependentChance!
  const earlyCommitPlan = replanAfterSkippedScriptedBeats(events, initialPlan, [prePartition.skippedBeats[0]], {
    world: live,
    random: () => 0.99,
    preservedPending: preReconciled.pendingState,
  });
  assert.equal(earlyCommitPlan.eligible.some((e) => e.id === "chance-after-early"), true);
  const committed = commitScriptedEventPlan({}, earlyCommitPlan, { throughDate: "1914-03-20" });
  assert.equal(committed.state["drifted-early"].outcome, "skipped");
  assert.equal(committed.state["chance-after-early"].outcome, "fired");
  assert.equal(committed.state["drifted-late"], undefined);
});

test("N031 priorRequirements partitions cross-segment relocate_capital conflicts and replan handles scripted_outcome_selected chains", async () => {
  const { replanAfterSkippedScriptedBeats } = await import("./scriptedEventResolution.js");
  const { partitionPreparedNativeScriptedOutcomes } = await import("./scriptedNativeOutcomes.js");
  const { capitalCityId } = await import("../../runtime/capitalSeats.js");
  const { buildLookupContext } = await import("./lookupTools.js");

  // 1) Cross-segment priorRequirements blocks a second relocate_capital for the same polity in segment 1.
  const polygon = (x, y) => ({ type: "Polygon", coordinates: [[[x - 1, y - 1], [x + 1, y - 1], [x + 1, y + 1], [x - 1, y + 1], [x - 1, y - 1]]] });
  const capRegions = [
    { id: "berlin", country: "Germany", geometry: polygon(13, 52) },
    { id: "munich", country: "Germany", geometry: polygon(11, 48) },
    { id: "hamburg", country: "Germany", geometry: polygon(10, 53) },
  ];
  const capWorld = normalizeWorldState({
    customRegions: true,
    customCities: true,
    polityOverrides: { Germany: { code: "Germany", name: "Germany", status: "active" } },
    regionOwnershipOverrides: { berlin: "Germany", munich: "Germany", hamburg: "Germany" },
    countryStats: { Germany: { capital: "Berlin" } },
  });
  const cityContext = buildLookupContext({
    world: capWorld,
    regions: capRegions,
    cities: [
      { name: "Berlin", aliases: [], coordinates: [13, 52], capital: "primary", population: 1000 },
      { name: "Munich", aliases: [], coordinates: [11, 48], capital: "", population: 500 },
      { name: "Hamburg", aliases: [], coordinates: [10, 53], capital: "", population: 900 },
    ],
  });
  const seg0Beat = beat("move-munich", [{ type: "relocate_capital", polity: "Germany", cityId: capitalCityId("Munich", [11, 48]), cityName: "Munich" }], { date: "1914-03-10" });
  const seg1Beat = beat("move-hamburg", [{ type: "relocate_capital", polity: "Germany", cityId: capitalCityId("Hamburg", [10, 53]), cityName: "Hamburg" }], { date: "1914-03-20" });
  const seg0 = partitionPreparedNativeScriptedOutcomes([seg0Beat], capWorld, { regionCatalog: capRegions, cityContext });
  assert.equal(seg0.eligibleBeats.length, 1);
  assert.equal(seg0.requirements.length, 1);
  const seg1 = partitionPreparedNativeScriptedOutcomes([seg1Beat], capWorld, {
    regionCatalog: capRegions,
    cityContext,
    priorRequirements: seg0.requirements,
  });
  assert.equal(seg1.eligibleBeats.length, 0);
  assert.equal(seg1.skippedBeats.length, 1);
  assert.match(seg1.skippedBeats[0].reason, /Only one capital relocation/);

  // 2) replanAfterSkippedScriptedBeats re-evaluates scripted_outcome_selected & scripted_outcome_not_selected.
  const live = pipeline([beat("existing-war", [declaration])]).world;
  const branchedDrifted = beat("branched-war", [], {
    date: "1914-03-10",
    outcomes: [
      { id: "opt1", text: "War starts.", weight: 1, impactRows: [declaration] },
    ],
  });
  const needsOpt1 = beat("after-opt1", [], {
    date: "1914-03-12",
    trigger: { mode: "conditional", operator: "all", conditions: [{ type: "scripted_outcome_selected", eventId: "branched-war", outcomeId: "opt1" }] },
  });
  const needsNotOpt1 = beat("after-not-opt1", [], {
    date: "1914-03-12",
    trigger: { mode: "conditional", operator: "all", conditions: [{ type: "scripted_outcome_not_selected", eventId: "branched-war", outcomeId: "opt1" }] },
  });
  const events = [branchedDrifted, needsOpt1, needsNotOpt1];
  const initialPlan = planScriptedEvents(events, { world: live, random: () => 0 });
  assert.deepEqual(initialPlan.eligible.map((e) => e.id), ["branched-war", "after-opt1"]);
  const part = partitionPreparedNativeScriptedOutcomes(initialPlan.eligible, live, { regionCatalog });
  const replanned = replanAfterSkippedScriptedBeats(events, initialPlan, part.skippedBeats, { world: live });
  assert.deepEqual(replanned.eligible.map((e) => e.id), ["after-not-opt1"]);
});
