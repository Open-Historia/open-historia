import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFiscalTaxPolicies, applyFiscalTaxPolicyOps, advanceFiscalTaxPolicyClock } from './fiscalTaxPolicies.js';
const state = () => ({ ownerCodes:['Alba'], fiscalTaxPolicies:[] });
const enact = { op:'enact-tax-holiday', id:'payroll-holiday', polity:'Alba',
  amount:2_000_000_000,currency:'USD',startDate:'2026-01-01',endDate:'2026-04-01',
  reason:'Enacted 90-day payroll tax relief with a $2bn total forecast' };
const event = (world, ops, eventId='law-1', date='2026-01-01') =>
  applyFiscalTaxPolicyOps(world,ops,{eventId,date,resolvePolity:x=>x});
const accrue = (world,a,b) => advanceFiscalTaxPolicyClock(world,{fromDate:a,toDate:b});
test('an enacted nominal tax holiday starts at zero, expires after its bounded window, never writes Stats',()=>{
 const original=state();
 const first=event(original,[enact]);
 assert.equal(first.fiscalTaxPolicies[0].accruedAmount,0);
 assert.equal(first.fiscalTaxPolicies[0].status,'scheduled');
 assert.deepEqual(original.fiscalTaxPolicies,[]);
 const complete=accrue(first,'2026-01-01','2026-04-01');
 assert.equal(complete.fiscalTaxPolicies[0].accruedAmount,2_000_000_000);
 assert.equal(complete.fiscalTaxPolicies[0].status,'expired');
 assert.deepEqual(normalizeFiscalTaxPolicies(complete.fiscalTaxPolicies),complete.fiscalTaxPolicies);
 assert.equal(complete.countryStats,undefined,'nominal forecast never invents GDP or debt');
 assert.deepEqual(accrue(complete,'2026-04-01','2026-06-01'),complete);
});
test('cumulative rounding gives exact same receipts over whole versus split turns and repeated periods',()=>{
 const first=event(state(),[enact]);
 const whole=accrue(first,'2026-01-01','2026-04-01');
 const s1=accrue(first,'2026-01-01','2026-02-01');
 const s2=accrue(s1,'2026-02-01','2026-03-01');
 const s3=accrue(s2,'2026-03-01','2026-04-01');
 assert.deepEqual(s3.fiscalTaxPolicies,whole.fiscalTaxPolicies);
 assert.deepEqual(accrue(s3,'2026-01-01','2026-04-01'),s3);
});
test('repeal stops accrual, preserves previous foregone revenue, and replay does not reset it',()=>{
 const enacted=event(state(),[enact]);
 const through=accrue(enacted,'2026-01-01','2026-02-14');
 const cancelled=event(through,[{op:'repeal-tax-holiday',id:enact.id,
   reason:'Legislature revoked further relief'}],'repeal-1','2026-02-15');
 assert.equal(cancelled.fiscalTaxPolicies[0].status,'repealed');
 assert.equal(cancelled.fiscalTaxPolicies[0].accruedAmount,through.fiscalTaxPolicies[0].accruedAmount);
 assert.deepEqual(accrue(cancelled,'2026-02-15','2026-04-01'),cancelled);
 assert.deepEqual(event(cancelled,[enact]).fiscalTaxPolicies,cancelled.fiscalTaxPolicies);
 assert.deepEqual(event(cancelled,[{op:'repeal-tax-holiday',id:enact.id,
   reason:'Legislature revoked further relief'}],'repeal-1','2026-02-15').fiscalTaxPolicies,
   cancelled.fiscalTaxPolicies);
 assert.throws(()=>event(cancelled,[{...enact,amount:3_000_000_000}]),/conflict/i);
});
test('unsupported amounts, backdates, terms, references, forged state and bogus currency fail closed',()=>{
 assert.throws(()=>event(state(),[{...enact,amount:'2000000000'}]),/amount/i);
 assert.throws(()=>event(state(),[{...enact,amount:Infinity}]),/amount/i);
 assert.throws(()=>event(state(),[{...enact,amount:1e12}]),/amount/i);
 assert.throws(()=>event(state(),[{...enact,currency:'DOLLARS'}]),/currency/i);
 assert.throws(()=>event(state(),[{...enact,endDate:'2028-01-01'}]),/duration|window/i);
 assert.throws(()=>event(state(),[{...enact,startDate:'2025-01-01'}]),/before|start/i);
 assert.throws(()=>event(state(),[{...enact,polity:'Ghost'}]),/polity/i);
 assert.throws(()=>event(state(),[{...enact,taxDebtDelta:2}]),/field/i);
 assert.throws(()=>event(state(),[{op:'repeal-tax-holiday',id:'missing',reason:'Not found'}]),/unknown/i);
 const first=event(state(),[enact]);
 assert.throws(()=>normalizeFiscalTaxPolicies(first.fiscalTaxPolicies.map(row=>({
   ...row,accruedAmount:100_000_000
 }))),/accrual|mismatch/i);
 assert.throws(()=>event(first,[{op:'repeal-tax-holiday',id:enact.id,
   reason:'Backdated repeal'}],'repeal-1','2025-12-01'),/before|date/i);
});

test('a GM repeal on the already-accrued current campaign date preserves that day and stops future accrual',()=>{
  const start=event(state(),[enact]);
  const through=accrue(start,'2026-01-01','2026-02-15');
  const repeal={op:'repeal-tax-holiday',id:enact.id,
    reason:'Legislature repeals the exemption effective after todays reading'};
  const removed=event(through,[repeal],'current-day-repeal','2026-02-15');
  assert.equal(removed.fiscalTaxPolicies[0].status,'repealed');
  assert.equal(removed.fiscalTaxPolicies[0].accruedAmount,through.fiscalTaxPolicies[0].accruedAmount);
  assert.deepEqual(accrue(removed,'2026-02-15','2026-04-01'),removed);
});
