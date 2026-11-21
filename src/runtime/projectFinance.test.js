/*! Open Historia - N010 finite project financing regressions. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import { appendProjectFinanceCommand, normalizeProjectFinance, projectFinanceSnapshot, openProjectFinanceClock } from "./projectFinance.js";
import { tickProjects, monthlyProjectBudget, ownerMeans, normalizeProjectPlan } from "./projectEngine.js";

// Synthetic accounting equivalence and tranche, NOT a claim about the 1912
// Bulgarian loan. The signed source event gave no tranche amount or USD value.
const owner="Kingdom of Bulgaria";
const terms=(overrides={})=>({id:"signature",type:"authorize",facilityId:"facility-f",date:"1912-02-09",
  mandateId:"mandate-sign",sourceEventId:"signed-event",borrower:owner,lenderKind:"polity",lenderId:"France",
  currency:"Bulgarian lev",minorDigits:2,originalLimitMinor:14_000_000_000,limitMinor:200_000_000,
  equivalenceBasis:"Synthetic explicitly authorized fixture: not a historical FX rate",
  annualRateBps:400,maturity:"1914-02-09",repaymentSource:"projectAllowance",
  projectIds:["rail","readiness"],...overrides});
const draw=(overrides={})=>({id:"tranche",type:"draw",facilityId:"facility-f",date:"1912-02-09",
  mandateId:"mandate-draw",sourceEventId:"disbursement-event",originalMinor:7_000_000_000,
  amountMinor:100_000_000,eligibleFrom:"1912-02-16",supplierId:null,projectId:"rail",...overrides});
const append=(ledger,receipt)=>appendProjectFinanceCommand(ledger,receipt,{authorize:r=>assert.deepEqual(r,receipt)===undefined});
const signed=()=>append(undefined,terms());
const funded=overrides=>append(signed(),draw(overrides));
const summary=(ledger,d="1912-02-15")=>projectFinanceSnapshot(ledger,d)[0];

test("signed limit creates neither spendable credit nor native principal; legacy records have no inferred loans",()=>{
  const f=summary(signed());
  assert.equal(f.undrawnMinor,200_000_000);
  assert.equal(f.outstandingMinor,0);
  assert.equal(f.remainingMinor,0);
  assert.equal(f.interestDueMinor,0);
  assert.deepEqual(normalizeProjectFinance(undefined),{version:1,receipts:[]});
  assert.throws(()=>normalizeProjectFinance(null),/fields/);
  assert.throws(()=>normalizeProjectFinance({version:1,receipts:[],balance:42}),/fields/);
});
test("commands require exact approval and consent through intake, not a claimed boolean or free prose",()=>{
  assert.throws(()=>appendProjectFinanceCommand(undefined,terms()),/authorized/);
  assert.throws(()=>appendProjectFinanceCommand(undefined,terms(),{authorize:()=>false}),/refused/);
  assert.throws(()=>append(undefined,{...terms(),approved:true}),/fields/);
  assert.throws(()=>append(undefined,{description:"a loan was signed",amountMinor:100}),/kind/);
  assert.throws(()=>append(undefined,terms({limitMinor:undefined})),/amount/);
  assert.throws(()=>append(undefined,terms({equivalenceBasis:""})),/contract information/);
  assert.throws(()=>append(undefined,terms({date:" 1912-02-09"})),/date/);
});
test("draws conserve original limit and accounting equivalence, exact retries cannot mint additional funds",()=>{
  const base=signed(),receipt=draw(),next=append(base,receipt);
  assert.equal(base.receipts.length,1);
  assert.deepEqual(append(next,receipt),next);
  assert.throws(()=>append(next,{...receipt,amountMinor:1}),/conflicting receipt/);
  assert.throws(()=>append(next,{...receipt,id:"second"}),/mandate already settled/);
  assert.throws(()=>append(base,draw({originalMinor:14_000_000_001})),/credit limit/);
  assert.throws(()=>append(base,draw({amountMinor:7_000_000_000})),/equivalence/);
  assert.throws(()=>append(base,draw({amountMinor:100_000_000.5})),/amount/);
  assert.throws(()=>append(base,draw({eligibleFrom:"1912-02-09"})),/pre-disbursement/);
  assert.throws(()=>append(base,draw({projectId:"other"})),/outside authorized/);
  assert.equal(summary(next).undrawnMinor,100_000_000);
  assert.equal(summary(next).outstandingMinor,100_000_000);
  assert.equal(summary(next).remainingMinor,100_000_000);
  const second=append(next,draw({id:"second",mandateId:"mandate-second",sourceEventId:"second-event",originalMinor:7_000_000_000}));
  assert.equal(summary(second).undrawnMinor,0);
  assert.throws(()=>append(second,draw({id:"third",mandateId:"mandate-third"})),/credit limit/);
});
test("splitting draws cannot round extra accounting cents into existence",()=>{
  const base=append(undefined,terms({originalLimitMinor:3,limitMinor:4}));
  const r=(n,amount)=>draw({id:"d"+n,mandateId:"m"+n,originalMinor:1,amountMinor:amount});
  const first=append(base,r(1,1)),second=append(first,r(2,2)),last=append(second,r(3,1));
  assert.equal(summary(last).drawnMinor,4);
  assert.throws(()=>append(first,r(2,1)),/equivalence/);
});
test("unallocated facilities are not available to the clock; allocation, release and return conserve receipts",()=>{
  const f=funded({projectId:null});
  const clock=openProjectFinanceClock(f,{fromDate:"1912-02-15",toDate:"1912-02-16"});
  assert.equal(clock.fund(owner,"rail","1912-02-16",5_000),0);
  assert.deepEqual(clock.finish().ledger,f);
  const allocation={id:"alloc",type:"allocate",facilityId:"facility-f",date:"1912-02-15",mandateId:"alloc-m",bucketId:"tranche",projectId:"rail",amountMinor:25_000_000};
  const allocated=append(f,allocation);
  assert.throws(()=>append(f,{...allocation,amountMinor:100_000_001}),/insufficient/);
  const released=append(allocated,{id:"release",type:"release",facilityId:"facility-f",date:"1912-02-15",mandateId:"release-m",bucketId:"alloc",amountMinor:10_000_000});
  assert.equal(summary(released).remainingMinor,100_000_000);
  const returned=append(released,{id:"return",type:"return",facilityId:"facility-f",date:"1912-02-16",mandateId:"return-m",sourceEventId:"refund",bucketId:"release",amountMinor:10_000_000});
  const s=summary(returned,"1912-02-16");
  assert.equal(s.remainingMinor,90_000_000);
  assert.equal(s.outstandingMinor,90_000_000);
  assert.equal(s.undrawnMinor,100_000_000,"not revolving");
});
test("supplier-direct money is earmarked prepayment, never unrestricted cash or a second payment",()=>{
  assert.throws(()=>funded({supplierId:"Krupp",projectId:null}),/requires earmarked/);
  const f=funded({supplierId:"Krupp"});
  assert.throws(()=>append(f,{id:"release",type:"release",facilityId:"facility-f",date:"1912-02-15",mandateId:"m",bucketId:"tranche",amountMinor:1}),/supplier prepayment/);
  const c=openProjectFinanceClock(f,{fromDate:"1912-02-09",toDate:"1912-02-23"});
  assert.equal(c.fund(owner,"rail","1912-02-10",10_000),0);
  assert.equal(c.fund(owner,"readiness","1912-02-16",10_000),0);
  assert.equal(c.fund("France","rail","1912-02-16",10_000),0);
  assert.equal(c.fund(owner,"rail","1912-02-16",10_000),10_000);
  assert.throws(()=>c.fund(owner,"rail","1912-02-16",1),/already settled/);
  const result=c.finish(),s=result.snapshot[0];
  assert.equal(s.costAppliedMinor,10_000);assert.equal(s.remainingMinor,99_990_000);
  assert.equal(s.outstandingMinor,100_000_000);
  assert.equal(s.buckets[0].supplierId,"Krupp");
  assert.deepEqual(normalizeProjectFinance(JSON.parse(JSON.stringify(result.ledger))),result.ledger);
  assert.throws(()=>openProjectFinanceClock(result.ledger,{fromDate:"1912-02-15",toDate:"1912-02-23"}),/overlaps/);
});
test("interest uses actual days, service pays interest first, insufficient budget remains arrears",()=>{
  const f=append(append(undefined,terms({date:"1912-01-01",maturity:"1912-02-01",originalLimitMinor:100_000,limitMinor:100_000,annualRateBps:3650})),
    draw({date:"1912-01-01",eligibleFrom:"1912-01-02",originalMinor:100_000,amountMinor:100_000}));
  assert.equal(summary(f,"1912-01-31").interestDueMinor,3000);
  assert.equal(summary(f,"1912-01-31").arrearsInterestMinor,0);
  const c=openProjectFinanceClock(f,{fromDate:"1912-01-31",toDate:"1912-02-02"});
  assert.equal(c.service(owner,"1912-02-01",2000),2000);
  assert.throws(()=>c.service(owner,"1912-02-01",2000),/already serviced/);
  assert.equal(c.service(owner,"1912-02-02",10_000),10_000);
  const s=c.finish().snapshot[0];
  assert.equal(s.interestPaidMinor,3200);
  assert.equal(s.principalPaidMinor,8800);
  assert.equal(s.outstandingMinor,91_200);
  assert.equal(s.arrearsPrincipalMinor,91_200);
  assert.equal(s.arrearsInterestMinor,0);
  assert.equal(s.remainingMinor,100_000,"service does not double spend project proceeds");
});
test("malformed saves and spoofed engine receipts fail closed without dropping liabilities",()=>{
  const base=funded(),bad=structuredClone(base);bad.receipts.push({...bad.receipts[1]});
  assert.throws(()=>normalizeProjectFinance(bad),/duplicate stored/);
  const cost={id:"cost:1912-02-16:tranche",type:"cost",date:"1912-02-16",facilityId:"facility-f",bucketId:"tranche",projectId:"rail",amountMinor:1};
  assert.throws(()=>append(base,cost),/authorized financing command/);
  assert.throws(()=>normalizeProjectFinance({version:1,receipts:[...base.receipts,{...cost,amountMinor:100_000_001}]}),/insufficient/);
  assert.throws(()=>normalizeProjectFinance({version:1,receipts:[...base.receipts,{...cost,id:"forged"}]}),/identity/);
});
const sheet={stability:50,economy:{gdp:1_819_561_375,budgetBalance:-2.8,publicDebt:87,gdpGrowth:0}};
const world={countryStats:{[owner]:sheet}};
const project=(id,monthlyCost,funding,overrides={})=>({id,name:id,ownerCode:owner,status:"active",funding,progress:0,spent:0,adjustments:[],plan:normalizeProjectPlan({durationDays:365,monthlyCost}),...overrides});
const board=()=>[project("readiness",6_000_000,"high"),project("rail",4_500_000,"low",{status:"stalled",stallReason:"funds",starvedDays:30}),project("wire",250_000,"low")];
const tick=(finance,fromDate="1912-02-15",toDate="1912-02-22",projects=board(),w=world)=>tickProjects({finance,world:w,projects,host:owner,fromDate,toDate,round:10});
test("Bulgaria synthetic eligible rail tranche restores actual project expenditure and work without increasing recurring allowance",()=>{
  const b=board(),finance=funded(),before=JSON.stringify([b,finance,world]);
  const ordinary=tick(undefined),result=tick(finance,undefined,undefined,b);
  assert.equal(ordinary.projects[1].spent,0);
  assert.equal(result.projects[0].spent,ordinary.projects[0].spent);
  assert.equal(result.projects[1].spent,525_000);
  assert.equal(result.projects[1].status,"active");
  assert.ok(result.projects[1].progress>0);
  assert.equal(result.projects[2].spent,0);
  assert.equal(result.finance.snapshot[0].remainingMinor,47_500_000);
  assert.equal(result.finance.snapshot[0].costAppliedMinor,52_500_000);
  assert.equal(result.finance.snapshot[0].outstandingMinor,100_000_000);
  assert.equal(ownerMeans(world,owner,b,owner).budget,monthlyProjectBudget(sheet));
  assert.equal(result.projects[1].targetDate,"","do not extrapolate finite proceeds forever");
  assert.equal(JSON.stringify([b,finance,world]),before);
  assert.deepEqual(tick(finance,undefined,undefined,b),result,"forecast and apply are equal");
  // Credit exhaustion on following days cannot perpetually increase allowance.
  const later=tick(result.finance.ledger,"1912-02-22","1912-03-02",result.projects);
  assert.equal(later.finance.snapshot[0].remainingMinor,0);
  assert.equal(later.projects[1].spent,1_000_000);
});
test("same-day scene and delayed eligibility never pay previous days; a funded project may advance despite unknown GDP",()=>{
  const f=funded();
  const same=tick(f,"1912-02-15","1912-02-15");
  assert.deepEqual(same.finance.ledger,f);
  const early=tick(f,"1912-02-09","1912-02-15");
  assert.equal(early.projects[1].spent,0);
  assert.deepEqual(early.finance.ledger,f);
  const noGdp=tick(f,undefined,undefined,board(),{});
  assert.equal(noGdp.projects[0].spent,0);
  assert.equal(noGdp.projects[1].spent,525_000);
  assert.throws(()=>tick(f,undefined,undefined,board(),{projectFundingMode:"nonmonetary"}),/not available/);
});
test("repayment draws only on the recurring allowance even without any running project",()=>{
  const f=append(append(undefined,terms({maturity:"1912-02-16"})),draw({eligibleFrom:"1912-02-16"}));
  const result=tick(f,"1912-02-15","1912-02-16",[]);
  const s=result.finance.snapshot[0];
  assert.ok(s.principalPaidMinor>0);
  assert.ok(s.interestPaidMinor>0);
  assert.ok(s.principalPaidMinor+s.interestPaidMinor<=monthlyProjectBudget(sheet)*100/30);
  assert.equal(s.remainingMinor,100_000_000);
  const empty=tick(f,"1912-02-15","1912-02-16",[],{});
  assert.equal(empty.finance.snapshot[0].principalPaidMinor,0);
  assert.equal(empty.finance.snapshot[0].arrearsPrincipalMinor,100_000_000);
});

test("undrawn authorization has no effect on allowance, project expenditure, progress or finish estimates",()=>{
  const ordinary=tick(undefined);
  const withAgreement=tick(signed());
  assert.deepEqual(withAgreement.projects,ordinary.projects);
  assert.deepEqual(withAgreement.outcomes,ordinary.outcomes);
  assert.deepEqual(withAgreement.finance.ledger,signed());
});
test("independent borrowers, exact identities and partitioned clocks cannot duplicate financing",()=>{
  const secondOwner="France";
  const first=funded();
  const combined=append(append(first,terms({id:"second-sign",facilityId:"facility-fr",mandateId:"m-fr-sign",borrower:secondOwner,lenderId:"Britain",projectIds:["rail-fr"]})),draw({id:"fr-tranche",facilityId:"facility-fr",mandateId:"m-fr-draw",projectId:"rail-fr"}));
  const b=[...board(),{...project("rail-fr",4_500_000,"low"),ownerCode:secondOwner}];
  const whole=tick(combined,"1912-02-15","1912-02-22",b,world);
  const firstHalf=tick(combined,"1912-02-15","1912-02-18",b,world);
  const secondHalf=tick(firstHalf.finance.ledger,"1912-02-18","1912-02-22",firstHalf.projects,world);
  assert.deepEqual(whole.finance,secondHalf.finance);
  assert.deepEqual(whole.projects.map(p=>p.spent),secondHalf.projects.map(p=>p.spent));
  assert.equal(whole.projects.find(p=>p.id==="rail").spent,525_000);
  assert.equal(whole.projects.find(p=>p.id==="rail-fr").spent,525_000);
  const alias=board().map(p=>({...p,ownerCode:"KINGDOM OF BULGARIA"}));
  assert.throws(()=>tick(first,undefined,undefined,alias),/identity/);
});
