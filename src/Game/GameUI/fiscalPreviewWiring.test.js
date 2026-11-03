import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFiscalPreviewRows } from '../../runtime/fiscalTransactions.js';
import { countImpactOps, otherImpactFamilies } from './gmPreviewOps.js';
import { GAME_MASTER_SCHEMA } from '../AI/gameplaySchemas.js';

const read = path => readFileSync(new URL(path,import.meta.url),'utf8');

test('GM schema and read-only preview preserve the exact fiscal stages and amounts',()=>{
  const schema = GAME_MASTER_SCHEMA.properties.events.items.properties.impacts.properties.fiscalOps;
  assert.equal(schema.maxItems,8);
  assert.deepEqual(schema.items.anyOf.map(option => option.properties.op.enum[0]),[
    'authorize','pay','cancel','enact-tax-holiday','repeal-tax-holiday']);
  const world={ownerCodes:['Alba'],projects:[],fiscalTransactions:[]};
  const events=[
    {id:'grant-evt',date:'2026-01-01',impacts:{fiscalOps:[{op:'authorize',id:'grant',
      polity:'Alba',kind:'grant',currency:'USD',amount:400_000_000,
      reason:'Legislature approved the cybersecurity grants'}]}},
    {id:'pay-evt',date:'2026-02-01',impacts:{fiscalOps:[{op:'pay',id:'grant',
      amount:150_000_000,funding:'already-budgeted',
      reason:'Independent budgeted transfer receipt received'}]}},
  ];
  const rows=buildFiscalPreviewRows(world,events);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row=>[row.operation,row.amount,row.currency,row.status]),
    [['authorize',400_000_000,'USD','authorized'],['pay',150_000_000,'USD','partially-paid']]);
  assert.equal(rows[1].remainingAmount,250_000_000);
  assert.equal(world.fiscalTransactions.length,0);
  assert.equal(countImpactOps(events).other,0,'fiscal transactions have a dedicated preview section');
  assert.deepEqual(otherImpactFamilies(events),[]);
});

test('GM Preview and Apply use the same native fiscal validation and show a visible payment review',()=>{
  const gameplay=read('../AI/gameplay.js');
  const ui=read('./cheats.jsx');
  const native=read('../../runtime/gameState.js');
  assert.match(gameplay,/validateFiscalEventOperations\(world, candidate\?\.events\)/);
  assert.match(gameplay,/fiscalPreviewRows = buildFiscalPreviewRows\(bundle\.world, events\)/);
  assert.match(gameplay,/fiscalPreviewRows,/);
  assert.match(ui,/data-gm-fiscal-preview="true"/);
  assert.match(ui,/Already-budgeted payment receipt; no new debt booked/);
  assert.match(native,/applyFiscalEventOps\(nextWorld, event\.impacts\.fiscalOps/);
});

test('GM Preview makes the enacted tax forecast and repeal distinguishable from a Treasury payment',()=>{
  const world={ownerCodes:['Alba'],projects:[],fiscalTransactions:[],fiscalTaxPolicies:[]};
  const tax={op:'enact-tax-holiday',id:'holiday',polity:'Alba',
    amount:2_000_000_000,currency:'USD',startDate:'2026-01-01',endDate:'2026-04-01',
    reason:'Enacted payroll relief with a legislated total estimate'};
  const events=[
    {id:'tax-law',date:'2026-01-01',impacts:{fiscalOps:[tax]}},
    {id:'repeal-law',date:'2026-02-01',impacts:{fiscalOps:[{op:'repeal-tax-holiday',
      id:'holiday',reason:'Legislature rescinds the outstanding tax relief'}]}},
  ];
  const preview=buildFiscalPreviewRows(world,events);
  assert.equal(preview.length,2);
  assert.deepEqual(preview.map(r=>[r.operation,r.kind,r.currency,r.status]),[
    ['enact-tax-holiday','tax-holiday','USD','scheduled'],
    ['repeal-tax-holiday','tax-holiday','USD','repealed'],
  ]);
  assert.equal(preview[1].amount,null,'repeal has no fabricated cash amount');
  assert.equal(preview[1].remainingAmount,2_000_000_000,'no time passes during GM preview');
  assert.equal(world.fiscalTaxPolicies.length,0);
  const ui=read('./cheats.jsx');
  assert.match(ui,/Remaining nominal tax forecast withdrawn/);
  assert.match(ui,/Revenue-foregone FORECAST only/);
  assert.match(ui,/row.operation === "repeal-tax-holiday"/);
});
