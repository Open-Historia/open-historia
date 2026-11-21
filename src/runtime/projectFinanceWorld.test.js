/*! Open Historia - native Project Finance authority and turn regressions. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWorldState, advanceProjectsInWorld, applyCountryStatPatchToWorld } from "./gameState.js";
import { bookProjectFinance, financeReviewStamp, financeSourceText, mergeFinanceAwareCountryStat, refreshFinanceDebtRatios } from "./projectFinanceWorld.js";
import { normalizeProjectPlan } from "./projectEngine.js";
import { projectFinanceSnapshot, projectFinanceDrawAmount } from "./projectFinance.js";
import { renamePolityInWorld } from "../../server/polityRename.js";

const owner="Kingdom of Bulgaria", lender="French Republic", rail="rail";
const game={country:owner,gameDate:"1912-02-15",round:9};
const event={id:"signed",title:"Loan agreed",date:"1912-02-09",description:"France signs an exact fictional loan and sends its first tranche.",playerRelated:true,agency:{principal:owner}};
const later={...event,id:"second",date:"1912-02-16",description:"A second tranche is transferred."};
const source=(e=event)=>({sourceId:e.id,expectedSource:financeSourceText(e),confirmed:true});
const receipt={type:"authorize",...source(),projectIds:[rail],lenderId:lender,currency:"lev",minorDigits:2,originalLimitMinor:14_000_000_000,
  limitMinor:200_000_000,equivalenceBasis:"Synthetic approved equivalence for test only",annualRateBps:400,maturity:"1912-02-24"};
const sheet={stability:50,economy:{gdp:1_819_561_375,gdpGrowth:0,publicDebt:87,budgetBalance:-2.8}};
const fixture=()=>normalizeWorldState({polityOverrides:{[owner]:{code:owner,name:owner},[lender]:{code:lender,name:lender}},
  countryStats:{[owner]:sheet},projects:[{id:rail,name:"Railway",ownerCode:owner,status:"stalled",stallReason:"funds",funding:"low",progress:0,spent:0,plan:normalizeProjectPlan({durationDays:365,monthlyCost:4_500_000})}]});
const book=(w,command,g=game,events=[event,later],overrides={})=>bookProjectFinance({world:w,game:g,events,command,expected:financeReviewStamp(w,g),...overrides});
const signature=()=>book(fixture(),receipt);
const draw=(w,overrides={})=>({type:"draw",...source(),facilityId:w.projectFinance.receipts[0].facilityId,projectId:rail,supplierId:"Supplier A",originalMinor:7_000_000_000,amountMinor:100_000_000,debtTreatment:"alreadyIncluded",...overrides});
const funded=()=>{const w=signature();return book(w,draw(w));};
const outstanding=(w,date=game.gameDate)=>projectFinanceSnapshot(w.projectFinance,date)[0];
test("source-linked, authorized booking preserves historical aggregate debt when principal was already counted",()=>{
  const w=fixture(),before=JSON.stringify(w),signed=book(w,receipt);
  assert.equal(w.projectFinance,undefined);
  assert.equal(JSON.stringify(w),before);
  assert.deepEqual(signed.countryStats,w.countryStats);
  assert.deepEqual(signed.projectFinanceDebt,[]);
  const next=book(signed,draw(signed));
  assert.equal(next.countryStats[owner].economy.publicDebt,87);
  assert.equal(next.projectFinanceDebt[0].otherMinor,Math.round(sheet.economy.gdp*87)-100_000_000);
  assert.equal(outstanding(next).outstandingMinor,100_000_000);
  assert.equal(outstanding(next).remainingMinor,100_000_000);
  assert.equal(next.projects[0].spent,0);
  assert.deepEqual(normalizeWorldState(JSON.parse(JSON.stringify(next))).projectFinance,next.projectFinance);
  const missing={...next};delete missing.projectFinanceDebt;
  assert.throws(()=>normalizeWorldState(missing),/residual debt/);
});
test("new borrowing increases the aggregate exactly once and the draft cannot invent proceeds",()=>{
  const w=signature(),next=book(w,draw(w,{debtTreatment:"additional"}));
  assert.equal(next.countryStats[owner].economy.publicDebt,87+100_000_000/sheet.economy.gdp);
  assert.throws(()=>book(next,draw(next)),/already been booked/);
  assert.throws(()=>book(w,draw(w,{originalMinor:undefined})),/amount/);
  assert.throws(()=>book(w,draw(w,{amountMinor:100_000_001})),/equivalence/);
  assert.equal(projectFinanceDrawAmount(outstanding(w),7_000_000_000),100_000_000);
});
test("native intake refuses non-owner, stale, unrevealed, shared, forged or private source changes",()=>{
  const w=fixture();
  assert.throws(()=>book(w,{...receipt,confirmed:false}),/authorization/);
  assert.throws(()=>book(w,{...receipt,expectedSource:"different"}),/source event/);
  assert.throws(()=>book(w,receipt,game,[{...event,audience:[owner]}]),/source event/);
  assert.throws(()=>book(w,receipt,game,[{...event,agency:{principal:lender}}]),/source event/);
  assert.throws(()=>book(w,{...receipt,lenderId:"invented lender"}),/registered foreign/);
  assert.throws(()=>book(w,{...receipt,projectIds:["not a project"]}),/existing paid project/);
  assert.throws(()=>book(w,receipt,game,[event],{shared:true}),/single-player/);
  assert.throws(()=>book(w,receipt,game,[event],{unseen:true}),/fully revealed/);
  assert.throws(()=>book(w,receipt,game,[event],{expected:{...financeReviewStamp(w,game),round:10}}),/changed/);
  const stale=financeReviewStamp(w,game);
  const latest={...w,countryStats:{[owner]:{...w.countryStats[owner],economy:{...w.countryStats[owner].economy,publicDebt:88}}}};
  assert.throws(()=>book(latest,receipt,game,[event],{expected:stale}),/changed/);
});
test("GDP drift and identical Stats refresh preserve exact loan stock and residual; new aggregate estimates reconcile without duplication",()=>{
  const world=funded(),base=world.projectFinanceDebt[0].otherMinor,principal=100_000_000;
  const updated=applyCountryStatPatchToWorld(world,owner,{economy:{gdp:2_000_000_000,publicDebt:87}});
  assert.equal(world.projectFinanceDebt[0].otherMinor,base);
  assert.equal(updated.economy.publicDebt,(base+principal)/updated.economy.gdp);
  // The worker calls the same helper, then puts the returned sheet.
  world.countryStats[owner]=mergeFinanceAwareCountryStat(world,owner,{economy:{publicDebt:90}});
  assert.equal(world.projectFinanceDebt[0].otherMinor,Math.round(90*world.countryStats[owner].economy.gdp)-principal);
  assert.equal(world.countryStats[owner].economy.publicDebt,90);
  assert.throws(()=>applyCountryStatPatchToWorld(world,owner,{economy:{publicDebt:0}}),/below recorded/);
  const old=world.projectFinanceDebt[0].otherMinor;
  world.countryStats[owner]={...world.countryStats[owner],economy:{...world.countryStats[owner].economy,gdp:3_000_000_000}};
  refreshFinanceDebtRatios(world);
  assert.equal(world.countryStats[owner].economy.publicDebt,(old+principal)/3_000_000_000);
});
test("accepted-turn settlement commits costs and exact debt service with the board; undo input remains unchanged",()=>{
  const w=funded(),before=JSON.stringify(w);
  const step=(base,end,start=game.gameDate,after=base)=>advanceProjectsInWorld({baseWorld:base,world:after,fromDate:start,toDate:end,host:owner,round:10});
  const first=step(w,"1912-02-22");
  assert.equal(first.world.projects[0].spent,525_000,"credit pays the due cost once, not in addition to a full base payment");
  assert.equal(outstanding(first.world,"1912-02-22").costAppliedMinor,52_500_000);
  const next=step(first.world,"1912-02-25","1912-02-22");
  const balance=outstanding(next.world,"1912-02-25");
  assert.ok(balance.principalPaidMinor>0);
  assert.equal(next.world.projectFinanceDebt[0].otherMinor,w.projectFinanceDebt[0].otherMinor);
  assert.equal(next.world.countryStats[owner].economy.publicDebt,(next.world.projectFinanceDebt[0].otherMinor+balance.outstandingMinor)/next.world.countryStats[owner].economy.gdp);
  assert.equal(JSON.stringify(w),before);
  assert.deepEqual(step(w,"1912-02-22"),first);
  assert.throws(()=>step(w,"1912-02-22",game.gameDate,signature()),/finance changed/);
});
test("owner rename during accepted turn preserves identity and settlement; no foreign project can receive a borrower allocation",()=>{
  const w=funded(),newOwner="Bulgarian Kingdom";
  const after=renamePolityInWorld(w,owner,newOwner).world;
  const step=advanceProjectsInWorld({baseWorld:w,world:after,fromDate:game.gameDate,toDate:"1912-02-22",host:owner,round:10});
  assert.equal(step.world.projectFinance.receipts[0].borrower,newOwner);
  assert.equal(step.world.projectFinanceDebt[0].owner,newOwner);
  assert.equal(step.world.projectFinance.receipts[0].id,w.projectFinance.receipts[0].id);
  assert.equal(outstanding(step.world,"1912-02-22").costAppliedMinor,52_500_000);
  assert.equal(step.world.projects[0].ownerCode,newOwner);
  const foreign={...signature(),projects:[{...w.projects[0],ownerCode:lender}]};
  assert.throws(()=>book(foreign,draw(foreign)),/existing paid project/);
});
test("unallocated cash, explicit allocation/release and principal return use existing debt authority",()=>{
  const s=signature(),w=book(s,draw(s,{supplierId:null,projectId:null}));
  const f=outstanding(w),id=f.terms.facilityId;
  const a=book(w,{type:"allocate",id:"finance:allocation:1",facilityId:id,bucketId:f.buckets[0].id,projectId:rail,amountMinor:20_000_000,confirmed:true});
  const released=book(a,{type:"release",id:"finance:allocation:2",facilityId:id,bucketId:"finance:allocation:1",amountMinor:10_000_000,confirmed:true});
  const g={...game,gameDate:"1912-02-16",round:10};
  const returned=book(released,{type:"return",...source(later),facilityId:id,bucketId:"finance:allocation:2",amountMinor:10_000_000},g);
  assert.equal(outstanding(returned,g.gameDate).outstandingMinor,90_000_000);
  assert.equal(returned.projectFinanceDebt[0].otherMinor,w.projectFinanceDebt[0].otherMinor);
  assert.equal(returned.countryStats[owner].economy.publicDebt,87-10_000_000/sheet.economy.gdp);
});
