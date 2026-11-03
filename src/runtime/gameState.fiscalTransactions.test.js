import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorldState, applyEventImpactsToWorld, normalizeEvents } from './gameState.js';
import { validateGameplayPayload, JUMP_FORWARD_SCHEMA, getGameplayTool } from '../Game/AI/gameplaySchemas.js';
import { validateFiscalEventOperations, buildFiscalPreviewRows } from './fiscalTransactions.js';

const base = () => ({ ownerCodes:['Alba'], polityOverrides:{Alba:{name:'Alba',code:'Alba'}},
  projects: [], fiscalTransactions:[] });
const op = {op:'authorize',id:'grant-400m',polity:'Alba',kind:'grant',
  amount:400_000_000,currency:'USD',reason:'Parliament approved a cyber grant programme'};
const event = (id, date, fiscalOps) => ({id,date,title:'Public fiscal transaction',
  description:'The treasury approved or recorded the specified fiscal operation.',
  economicAccounting:{status:'unquantified',reason:'Nominal authorization is not a GDP or debt mutation.'},
  impacts:{fiscalOps}});

test('the actual native event writer persists authorization, disbursement and cancellation without GDP fabrication', () => {
 const original=base();
 const a=event('authorize-evt','2026-01-01',[op]);
 const first=applyEventImpactsToWorld({world:original,events:[a]}).world;
 assert.equal(first.fiscalTransactions.length,1);
 assert.equal(first.fiscalTransactions[0].status,'authorized');
 assert.equal(original.fiscalTransactions.length,0);
 assert.deepEqual(normalizeWorldState(first).fiscalTransactions,first.fiscalTransactions);
 assert.deepEqual(normalizeEvents([a])[0].impacts.fiscalOps,[op]);
 assert.deepEqual(applyEventImpactsToWorld({world:first,events:[a]}).world.fiscalTransactions,first.fiscalTransactions);
 const pay=event('pay-evt','2026-02-01',[{op:'pay',id:'grant-400m',amount:150_000_000,
   funding:'already-budgeted',reason:'Audited transfer confirmed as previously budgeted'}]);
 const second=applyEventImpactsToWorld({world:first,events:[pay]}).world;
 assert.equal(second.fiscalTransactions[0].paidAmount,150_000_000);
 assert.equal(second.fiscalTransactions[0].payments[0].eventId,'pay-evt');
 const cancel=event('cancel-evt','2026-03-01',[{op:'cancel',id:'grant-400m',
   reason:'The remaining grant authority was revoked'}]);
 const third=applyEventImpactsToWorld({world:second,events:[cancel]}).world;
 assert.equal(third.fiscalTransactions[0].status,'cancelled');
 assert.equal(third.fiscalTransactions[0].paidAmount,150_000_000);
 assert.equal(third.countryStats.Alba,undefined,'nominal amounts must not write GDP or public debt');
 assert.deepEqual(normalizeWorldState(third).fiscalTransactions,third.fiscalTransactions);
});

test('lean jump provider grammar stays bounded while native accepted-event validation recognizes fiscalOps', () => {
 const provider = getGameplayTool('jumpForward').schema.properties.events.items.properties.impacts.properties;
 assert.equal(Object.hasOwn(provider,'fiscalOps'), false);
 assert.ok(JSON.stringify(getGameplayTool('jumpForward').schema).length < 28200,
   'never weaken the existing provider budget to make fiscalOps fit');
 assert.equal(JUMP_FORWARD_SCHEMA.properties.events.items.properties.impacts.properties.fiscalOps.maxItems,8);
});

test('event transaction schema supports typed operations without arbitrary fiscal fields',()=>{
 const cases=[
   [event('a','2026-01-01',[op]),true],
   [event('a','2026-01-01',[{op:'pay',id:'grant-400m',amount:1,
       funding:'already-budgeted',reason:'Verified existing-budget tranche'}]),true],
   [event('a','2026-01-01',[{op:'cancel',id:'grant-400m',reason:'Programme stopped'}]),true],
   [event('a','2026-01-01',[{...op,taxRevenueDelta:-2_000_000_000}]),false],
   [event('a','2026-01-01',[{op:'pay',id:'grant-400m',amount:1,
       funding:'new-debt',reason:'Not established'}]),false],
 ];
 for(const [entry,accepted] of cases){
   const res=validateGameplayPayload('jumpForward',{events:[entry],stopDate:'2026-02-01',summary:'Fiscal event.'});
   assert.equal(res.valid,accepted,JSON.stringify(entry.impacts.fiscalOps));
 }
});

test('malformed fiscal event must fail detached world application rather than disappearing',()=>{
 assert.throws(()=>applyEventImpactsToWorld({world:base(),events:[event('bad','2026-01-01',
   [{op:'pay',id:'missing',amount:12,funding:'already-budgeted',reason:'Unknown'}])]}),
   /fiscal|unknown/i);
 // A save's malformed ledger row is dropped on read, not made unloadable (review of beta-stats-v2, 2026-11-03).
 assert.deepEqual(normalizeWorldState({...base(),fiscalTransactions:[{id:'invalid'}]}).fiscalTransactions,[]);
});

test('accepted fiscal tax policy accrues in game reducer at day boundaries and replays safely',()=>{
 const start=base();
 const law={op:'enact-tax-holiday',id:'payroll-relief',polity:'Alba',
   currency:'USD',amount:2_000_000_000,startDate:'2026-01-01',
   endDate:'2026-04-01',reason:'A legislated ninety-day payroll tax exemption'};
 const a=event('tax-law','2026-01-01',[law]);
 const short=applyEventImpactsToWorld({world:start,events:[a],
   fiscalPeriod:{fromDate:'2026-01-01',toDate:'2026-02-01'}}).world;
 assert.equal(short.fiscalTaxPolicies.length,1);
 assert.ok(short.fiscalTaxPolicies[0].accruedAmount > 0);
 const whole=applyEventImpactsToWorld({world:start,events:[a],
   fiscalPeriod:{fromDate:'2026-01-01',toDate:'2026-04-01'}}).world;
 assert.equal(whole.fiscalTaxPolicies[0].accruedAmount,2_000_000_000);
 const split=applyEventImpactsToWorld({world:short,events:[],
   fiscalPeriod:{fromDate:'2026-02-01',toDate:'2026-04-01'}}).world;
 assert.deepEqual(split.fiscalTaxPolicies,whole.fiscalTaxPolicies);
 assert.deepEqual(normalizeWorldState(whole).fiscalTaxPolicies,whole.fiscalTaxPolicies);
 assert.equal(whole.countryStats.Alba,undefined);
 const replay=applyEventImpactsToWorld({world:whole,events:[a]}).world;
 assert.deepEqual(replay.fiscalTaxPolicies,whole.fiscalTaxPolicies);
});

test('repeal on its civil date excludes that date and never rewrites previous days',()=>{
 const law=event('law','2026-01-01',[{op:'enact-tax-holiday',id:'tax',
   polity:'Alba',amount:1_000_000,currency:'EUR',startDate:'2026-01-01',
   endDate:'2026-04-01',reason:'Legislated temporary payroll tax reduction'}]);
 const cancel=event('repeal','2026-02-15',[{op:'repeal-tax-holiday',id:'tax',
   reason:'Parliament repealed the remaining temporary exemption'}]);
 const source=base();
 const withEvents=applyEventImpactsToWorld({world:source,events:[law,cancel],
   fiscalPeriod:{fromDate:'2026-01-01',toDate:'2026-04-01'}}).world;
 const prior=applyEventImpactsToWorld({world:source,events:[law],
   fiscalPeriod:{fromDate:'2026-01-01',toDate:'2026-02-14'}}).world;
 assert.equal(withEvents.fiscalTaxPolicies[0].accruedAmount,
   prior.fiscalTaxPolicies[0].accruedAmount);
 assert.equal(withEvents.fiscalTaxPolicies[0].status,'repealed');
 assert.deepEqual(applyEventImpactsToWorld({world:withEvents,events:[],
   fiscalPeriod:{fromDate:'2026-04-01',toDate:'2026-05-01'}}).world.fiscalTaxPolicies,
   withEvents.fiscalTaxPolicies);
});

test('GM mode records a future policy but never silently advances game time',()=>{
 const source=base();
 const a=event('law','2026-01-01',[{op:'enact-tax-holiday',id:'tax',
   polity:'Alba',amount:100_000,currency:'USD',startDate:'2026-01-01',
   endDate:'2026-03-01',reason:'Authorized term-limited national tax relief'}]);
 const after=applyEventImpactsToWorld({world:source,events:[a]}).world;
 assert.equal(after.fiscalTaxPolicies[0].accruedAmount,0);
 assert.equal(after.fiscalTaxPolicies[0].status,'scheduled');
});

test('same-event polity rename plus fiscal authorization has Preview/Apply parity',()=>{
  const entry={...event('regime-and-grant','2026-01-15',[{...op,polity:'Albian Republic'}]),
    impacts:{fiscalOps:[{...op,polity:'Albian Republic'}],
      polityChanges:[{operation:'update',code:'Alba',name:'Albian Republic'}]}};
  const actual=applyEventImpactsToWorld({world:base(),events:[entry]}).world;
  assert.equal(actual.fiscalTransactions[0].polity,'Albian Republic',
    'the actual event writer recognizes the newly re-keyed country');
  assert.equal(validateFiscalEventOperations(base(),[entry]),'',
    'Preview must not reject an authorization the native same-event reducer admits');
});

test('GM read-only fiscal Preview follows previous and same-event polity renames without ledger mutation',()=>{
  const renamed={...event('rename','2026-01-15',[]),impacts:{
    polityChanges:[{operation:'update',code:'Alba',name:'Albian Republic'}],
    fiscalOps:[]}};
  const law=event('grant-law','2026-01-16',[{...op,polity:'Alba'}]);
  const paid=event('grant-paid','2026-02-01',[{op:'pay',id:'grant-400m',
    amount:100_000_000,funding:'already-budgeted',
    reason:'Explicit previously budgeted transfer verified'}]);
  const source=base();
  assert.equal(validateFiscalEventOperations(source,[renamed,law,paid]),'');
  const preview=buildFiscalPreviewRows(source,[renamed,law,paid]);
  assert.deepEqual(preview.map(row=>[row.operation,row.polity,row.paidAmount]),[
    ['authorize','Albian Republic',0],['pay','Albian Republic',100_000_000]]);
  assert.equal(source.polityOverrides.Alba.name,'Alba','Preview never mutates the source world');
  const actual=applyEventImpactsToWorld({world:source,events:[renamed,law,paid]}).world;
  assert.equal(actual.fiscalTransactions[0].polity,'Albian Republic');
  assert.equal(actual.fiscalTransactions[0].paidAmount,100_000_000);
  assert.deepEqual(actual.fiscalTransactions[0].payments.map(row=>row.eventId),['grant-paid']);
});

test('a non-fiscal event cannot acquire a new fiscal preflight rejection or mutate its source',()=>{
  const source={...base(),ownerCodes:['Alba','Beta'],
    polityOverrides:{Alba:{name:'Alba',code:'Alba'},Beta:{name:'Beta',code:'Beta'}}};
  const collision={id:'ordinary-rename',date:'2026-01-02',impacts:{
    polityChanges:[{operation:'update',code:'Alba',name:'Beta'}]}};
  assert.equal(validateFiscalEventOperations(source,[collision]),'',
    'purely non-fiscal world events retain their established validation boundaries');
  assert.deepEqual(buildFiscalPreviewRows(source,[collision]),[]);
  assert.deepEqual(Object.keys(source.polityOverrides),['Alba','Beta']);
});

// Review of beta-stats-v2 (2026-11-03): breadth-repair events joined a skip's answer after its own, out of date order,
// and the fiscal clock threw, failing the turn after its one request was spent. Out of order, undated or past the
// period, an event now accrues as of the latest day reached.
test('fiscal accrual takes events out of order or outside the period without failing the turn',()=>{
 const law={op:'enact-tax-holiday',id:'payroll-relief',polity:'Alba',
   currency:'USD',amount:2_000_000_000,startDate:'2026-01-10',
   endDate:'2026-04-01',reason:'A legislated payroll tax exemption for the spring'};
 const events=[event('late','2026-02-20',[]),event('tax-law','2026-01-10',[law]),
   event('after','2026-05-01',[]),{...event('undated','',[]),date:''}];
 const world=applyEventImpactsToWorld({world:base(),events,
   fiscalPeriod:{fromDate:'2026-01-01',toDate:'2026-03-01'}}).world;
 assert.equal(world.fiscalTaxPolicies.length,1);
 assert.ok(world.fiscalTaxPolicies[0].accruedAmount >= 0);
});
