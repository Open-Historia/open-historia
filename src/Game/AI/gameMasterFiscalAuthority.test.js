import test from "node:test";
import assert from "node:assert/strict";
import { GAME_MASTER_SCHEMA, decodeGameMasterTransportPayload, validateGameplayPayload } from "./gameplaySchemas.js";
import { validateGameMasterStatsAuthority } from "./gameMasterValidation.js";
import { planStatsEventEffect } from "../../runtime/statsEventEffects.js";
import { mergeCountryStatPatch } from "../../runtime/countryStats.js";
import { advanceNativeFiscalClock } from "../../runtime/statsFiscalClock.js";

const source = () => mergeCountryStatPatch(null, {
  territorialComponents: [{ geography: "United States", group: "core",
    population: 300_000_000, gdpPerCapita: 50_000 }],
  economy: { budgetBalance: -3, publicDebt: 45 },
  continuity: { assessedDate: "2016-01-01" },
});
const fiscalEvent = {
  date: "2016-01-15", title: "Federal relief authorized",
  description: "A relief programme is authorized, with future disbursements to follow.",
  impacts: { projectOps: [{
    op: "create", name: "Federal Disaster Relief", kind: "project",
    ownerCode: "United States", summary: "Grant administration is established.",
    progress: 10,
  }] },
};

test("GM shallow transport accepts explicit nominal fiscal authorization but not invented funding fields", () => {
  const grant = {
    date: "2016-01-15", title: "Hurricane relief grant appropriated",
    description: "The government authorizes $600m emergency relief without claiming immediate payment.",
    economicAccounting: { status: "unquantified",
      reason: "Authorization has no separate national GDP or new-debt entry." },
    impacts: { fiscalOps: [{ op: "authorize", id: "storm-relief-grant",
      polity: "United States", kind: "relief", amount: 600_000_000, currency: "USD",
      reason: "Enacted emergency grant appropriation, payment pending" }] },
  };
  const transport = (event) => ({
    mode: "world-intervention", summary: "Relief legislation entered canon.",
    eventsJson: JSON.stringify([event]), territorialScopesJson: "[]", countryStatPatchesJson: "[]",
    storylineUpdatesJson: "[]", warUpdatesJson: "[]", relationUpdatesJson: "[]",
    agreementUpdatesJson: "[]", puppetUpdatesJson: "[]", diplomaticOutreachJson: "[]",
  });
  const decoded = decodeGameMasterTransportPayload(transport(grant));
  assert.equal(decoded.error, "");
  assert.equal(validateGameplayPayload("gameMaster",decoded.payload).valid,true);
  assert.equal(decoded.payload.events[0].impacts.fiscalOps[0].amount,600_000_000);
  assert.deepEqual(decoded.payload.events[0].impacts.polityChanges,undefined);
  assert.deepEqual(decoded.payload.countryStatPatches,[]);
  assert.equal(validateGameplayPayload("gameMaster",
    decodeGameMasterTransportPayload(transport({
      ...grant, impacts: { fiscalOps: [{...grant.impacts.fiscalOps[0],
        newDebtPercentGdp: 2 }] },
    })).payload).valid,false);
});

test("a GM project-only fiscal Preview is not a secretly booked Treasury transaction", () => {
  const response = {
    mode: "world-intervention", summary: "A disaster-relief programme is authorized.",
    eventsJson: JSON.stringify([fiscalEvent]),
    territorialScopesJson: "[]", countryStatPatchesJson: "[]",
    storylineUpdatesJson: "[]", warUpdatesJson: "[]",
    relationUpdatesJson: "[]", agreementUpdatesJson: "[]",
    puppetUpdatesJson: "[]", diplomaticOutreachJson: "[]",
  };
  const decoded = decodeGameMasterTransportPayload(response);
  assert.equal(decoded.error, "");
  assert.equal(validateGameplayPayload("gameMaster", decoded.payload).valid, true);
  assert.equal(validateGameMasterStatsAuthority(decoded.payload, { mode: "world-intervention" }), "");
  assert.deepEqual(decoded.payload.events[0].impacts.polityChanges, undefined,
    "project authorization does not imply applied revenue/spending");
  assert.deepEqual(decoded.payload.countryStatPatches, []);
  const project = GAME_MASTER_SCHEMA.properties.events.items.properties.impacts.properties.projectOps.items;
  assert.equal(project.properties.budgetBalanceDelta, undefined);
  assert.equal(project.properties.taxRevenueDelta, undefined);
  assert.equal(project.additionalProperties, false);
});

test("GM intervention cannot treat a current-budget baseline override as policy expenditure", () => {
  const candidate = {
    events: [{ date: "2016-01-15", title: "Tax relief", description: "Tax holiday enacted." }],
    countryStatPatches: [{ country: "United States",
      patch: { economy: { budgetBalance: -5 } }, eventIndexes: [0],
      reason: "Tax holiday" }],
  };
  assert.match(validateGameMasterStatsAuthority(candidate, { mode: "world-intervention" }),
    /countryStatPatches.*Direct mode/);
  assert.equal(validateGameMasterStatsAuthority(candidate, { mode: "direct" }), "");
});

test("native accepted borrowing mutates a debt stock, never the annual fiscal rate", () => {
  const before = source();
  const plan = planStatsEventEffect({
    effect: {
      debtFinancedOutlayPercentGdp: 0.5,
      debtFinancedOutlayCause: "relief",
      reason: "Confirmed 0.5% GDP debt-financed immediate relief",
    },
    sheet: before, eventId: "relief-event-1", eventDate: "2016-01-15",
  });
  assert.deepEqual(plan.patch.economy, { publicDebt: 45.5 });
  const after = mergeCountryStatPatch(before, plan.patch);
  assert.equal(after.economy.budgetBalance, -3);
  assert.equal(after.economy.publicDebt, 45.5);
  assert.equal(after.economy.gdp, before.economy.gdp);
});

test("debt-financed effects cannot spend against a future-dated national fiscal baseline", () => {
  const before = source();
  assert.throws(() => planStatsEventEffect({
    effect: {
      debtFinancedOutlayPercentGdp: 0.5, debtFinancedOutlayCause: "relief",
      reason: "Proposed historical relief before the nation's established fiscal assessment",
    },
    sheet: before, eventId: "historical-outlay", eventDate: "2015-12-31",
  }), /cannot precede.*fiscal assessment/i,
  "an event before a recorded national assessment cannot treat that future debt/GDP stock as its own");
  assert.equal(before.economy.publicDebt, 45);
  assert.equal(before.economy.budgetBalance, -3);
  assert.deepEqual(planStatsEventEffect({
    effect: {
      debtFinancedOutlayPercentGdp: 0.5, debtFinancedOutlayCause: "relief",
      reason: "Fiscal relief after the nation's established national assessment",
    },
    sheet: before, eventId: "current-outlay", eventDate: "2016-01-01",
  }).patch.economy, { publicDebt: 45.5 });
});

test("fiscal rate changes require a dated source; unsupported tax fields fail closed", () => {
  const before = source();
  assert.throws(() => planStatsEventEffect({
    effect: { taxRevenueDelta: -2_000_000_000, reason: "Payroll tax holiday" },
    sheet: before, eventId: "tax-1", eventDate: "2016-01-15",
  }), /Unknown Statistics effect field/);
  const changedWithoutAssessment = mergeCountryStatPatch(before, {
    economy: { budgetBalance: -5 },
  });
  assert.equal(changedWithoutAssessment.continuity.assessedDate, "2016-01-01");
  const world = {
    ownerCodes: ["United States"],
    countryStats: { "United States": changedWithoutAssessment },
  };
  const later = advanceNativeFiscalClock(world, {
    baselineWorld: world, fromDate: "2016-02-01", toDate: "2016-03-01",
  });
  assert.equal(later.countryStats["United States"].economy.budgetBalance, -5,
    "the existing annual rate is retained; never derive a dollar-valued tax change");
});

test("GM fiscal transport accepts bounded enacted tax relief but rejects invented cash or debt fields",()=>{
  const grant = {
    date:"2016-01-15",title:"Congress enacts payroll tax relief",
    description:"The enacted law provides a temporary exemption, estimated at $2bn across its stated term.",
    economicAccounting:{status:"unquantified",reason:"Only nominal prospective foregone revenue is known."},
    impacts:{fiscalOps:[{op:"enact-tax-holiday",id:"payroll-exemption",
      polity:"United States",amount:2_000_000_000,currency:"USD",
      startDate:"2016-01-15",endDate:"2016-04-15",
      reason:"Approved total revenue-foregone forecast for enacted three-month exemption"}]},
  };
  const transport = entry => ({
    mode:"world-intervention",summary:"Temporary payroll tax relief enacted.",
    eventsJson:JSON.stringify([entry]),territorialScopesJson:"[]",
    countryStatPatchesJson:"[]",storylineUpdatesJson:"[]",warUpdatesJson:"[]",
    relationUpdatesJson:"[]",agreementUpdatesJson:"[]",
    puppetUpdatesJson:"[]",diplomaticOutreachJson:"[]",
  });
  const decoded=decodeGameMasterTransportPayload(transport(grant));
  assert.equal(decoded.error,"");
  const checked=validateGameplayPayload("gameMaster",decoded.payload);
  assert.equal(checked.valid,true,checked.error);
  assert.equal(decoded.payload.events[0].impacts.fiscalOps[0].amount,2_000_000_000);
  assert.deepEqual(decoded.payload.countryStatPatches,[]);
  const unsupported={...grant,impacts:{fiscalOps:[{...grant.impacts.fiscalOps[0],
    nominalToGdpPercent:3}]}};
  assert.equal(validateGameplayPayload("gameMaster",
    decodeGameMasterTransportPayload(transport(unsupported)).payload).valid,false);
});
