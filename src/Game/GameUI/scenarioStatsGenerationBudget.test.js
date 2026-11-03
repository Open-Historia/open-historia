import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BATCH_COUNTRIES, MAX_CALLS_PER_RUN, DEFAULT_CALLS_PER_RUN,
  HIGH_COST_CONFIRM_THRESHOLD, validScenarioStatsCallBudget,
  scenarioStatsGenerationCandidates, scenarioStatsGenerationQueue, scenarioStatsPlannedCalls, scenarioStatsNeedsCostConfirmation,
  scenarioStatsFailedCallProposals,
} from "./scenarioStatsGenerationBudget.js";

test("a creator can explicitly budget beyond ten requests without an unbounded charge", () => {
  assert.equal(DEFAULT_CALLS_PER_RUN, 10);
  assert.equal(MAX_BATCH_COUNTRIES, 3);
  assert.equal(MAX_CALLS_PER_RUN, 100);
  assert.equal(HIGH_COST_CONFIRM_THRESHOLD, 10);
  for (const budget of [1, 10, 11, 25, 68, 100]) {
    assert.equal(validScenarioStatsCallBudget(budget), true);
  }
  for (const budget of [0, -1, 1.5, 101, Infinity, NaN, "12", "", null]) {
    assert.equal(validScenarioStatsCallBudget(budget), false);
    assert.throws(() => scenarioStatsGenerationQueue([], budget), RangeError);
  }
});

test("failed-only generation targets rejected slots without erasing valid unapproved proposals", () => {
  const coverage = [
    {code:"STP", status:"incomplete"}, {code:"CAN", status:"ready"},
    {code:"COD",status:"missing"}, {code:"TLS",status:"ready"}, {code:"PER",status:"missing"},
  ];
  const failed = {STP:{error:"invalid numeric publicDebt"},COD:{error:"missing fiscal field"}};
  const proposals = {...failed, CAN:{sheet:{economy:{publicDebt:30}},selected:true},
    TLS:{error:"old error",sheet:{economy:{publicDebt:40}}}};
  const before = structuredClone(proposals);
  assert.deepEqual(scenarioStatsGenerationCandidates(coverage,proposals,{retryFailedOnly:true}).map(x=>x.code),
    ["STP","COD"], "even a ready-country previous failure can be retried, but not valid sheets");
  assert.deepEqual(proposals,before,"selecting retry candidates never clears approved or pending data");
  assert.deepEqual(scenarioStatsGenerationCandidates(coverage,proposals,{onlyMissing:false}).map(x=>x.code),
    ["PER"], "ordinary Generate keeps excluding all existing proposal rows");
  assert.deepEqual(scenarioStatsGenerationCandidates(coverage,proposals,{selectedOnly:true,activeCode:"COD"}),
    [], "Generate selected retains the existing explicit retry-later boundary");
  const retryQueue = scenarioStatsGenerationQueue(
    scenarioStatsGenerationCandidates(coverage,proposals,{retryFailedOnly:true}),1);
  assert.equal(scenarioStatsPlannedCalls(retryQueue),1);
  assert.equal(scenarioStatsNeedsCostConfirmation(retryQueue),false);
  assert.deepEqual(scenarioStatsGenerationCandidates([],proposals,{retryFailedOnly:true}),[]);
  assert.deepEqual(scenarioStatsGenerationCandidates(coverage,null,{retryFailedOnly:true}),[]);
});

test("request budget maps to bounded three-country batches with consent based on actual calls", () => {
  const countries = Array.from({length: 202}, (_, index) => ({code: `p${index}`}));
  const defaultQueue = scenarioStatsGenerationQueue(countries, 10);
  assert.equal(defaultQueue.length, 30);
  assert.equal(scenarioStatsPlannedCalls(defaultQueue), 10);
  assert.equal(scenarioStatsNeedsCostConfirmation(defaultQueue), false);
  const extended = scenarioStatsGenerationQueue(countries, 68);
  assert.equal(extended.length, 202);
  assert.equal(scenarioStatsPlannedCalls(extended), 68);
  assert.equal(scenarioStatsNeedsCostConfirmation(extended), true);
  assert.deepEqual(extended, countries, "all countries are requested in canonical queue order");
  const smallSelection = scenarioStatsGenerationQueue(countries.slice(0, 4), 100);
  assert.equal(scenarioStatsPlannedCalls(smallSelection), 2);
  assert.equal(scenarioStatsNeedsCostConfirmation(smallSelection), false,
    "high budget alone must not force a warning for only two paid calls");
  assert.equal(scenarioStatsGenerationQueue(countries, 1).length, 3);
  assert.equal(scenarioStatsGenerationQueue(countries, 11).length, 33);
  assert.equal(scenarioStatsGenerationQueue(countries, 100).length, 202);
});

test("a failed provider batch stays explicitly retryable without erasing valid pending proposals", () => {
  const requested = [{code:"TLS",name:"Timor-Leste"}, {code:"STP",name:"São Tomé and Príncipe"}];
  const previous = { CAN:{sheet:{economy:{publicDebt:25}},selected:true} };
  const sources = {TLS:{economy:{publicDebt:0}}, STP:{economy:{publicDebt:70}}};
  const before=structuredClone({requested,previous,sources});
  const rows = scenarioStatsFailedCallProposals(requested,sources,"Provider tool schema rejected");
  assert.deepEqual(Object.keys(rows),["TLS","STP"]);
  assert.match(rows.TLS.error,/Provider tool schema rejected/);
  assert.equal(rows.TLS.sheet,undefined);
  assert.equal(rows.TLS.prior,JSON.stringify(sources.TLS));
  const all={...previous,...rows};
  assert.deepEqual(scenarioStatsGenerationCandidates([
    {code:"TLS",status:"incomplete"},{code:"STP",status:"missing"},{code:"CAN",status:"ready"},
  ], all,{retryFailedOnly:true}).map(row=>row.code),["TLS","STP"]);
  assert.deepEqual(all.CAN,previous.CAN,"the valid review candidate must remain pending");
  assert.deepEqual({requested,previous,sources},before,"the failure mapper must not mutate game or UI input");
  assert.deepEqual(scenarioStatsFailedCallProposals([],sources,"Error"),{});
});
