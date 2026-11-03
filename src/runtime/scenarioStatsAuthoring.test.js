/*! Open Historia — reviewed scenario Statistics authoring, no provider/network dependency. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyScenarioStatsManualEdits, authorApprovedMacroEstimates,
  createReviewedScenarioStatsSheet, scenarioStatsCoverage,
  scenarioStatsEditorValues, scenarioStatsRequiredReady, assertScenarioStatsDefinitionContentsCurrent,
} from './scenarioStatsAuthoring.js';
import { normalizeCountryStatSheet, normalizeCountryStatDemographicEvolution } from './countryStats.js';
import { advanceNativeDemographicClock } from './statsDemographicClock.js';
import { TEMPLATE_WORLD_OVERRIDE_KEYS } from './web/storeConstants.js';
import { buildScenarioStartingStatsTool, interpretScenarioStatsAiResponse } from '../Game/GameUI/scenarioStatsAiResponse.js';

const basis = {
  context:'Synthetic native plan derived from scenario region map',
  plan:[{ geography:'Riga' },{ geography:'Kurzeme' },{ geography:'Latgale' }],
  macroPlan:[
    {index:1,members:[{geography:'Riga',weight:5},{geography:'Kurzeme',weight:3}]},
    {index:2,members:[{geography:'Latgale',weight:2}]},
  ],
};
const proposed = ({ date='2026-01-01', ...overrides }={}) => ({
  capital:'Riga',continent:'Europe',government:'Parliamentary republic',leader:'Scenario leader',stability:75,
  indices:{ sovereignty:88, foodAutonomy:60, energyAutonomy:55, economicIndependence:70, internalSecurity:78, internationalReputation:82 },
  macro:[{index:1,group:'core',population:1200000,gdpPerCapita:25000},
    {index:2,group:'core',population:600000,gdpPerCapita:16000}],
  gdpGrowth:1.2,inflation:2.4,unemployment:6.5,publicDebt:45,budgetBalance:-2,currency:'EUR',
  agriculture:3,industry:24,services:73,
  birthRate:7,deathRate:14,birthTrendPerYear:0.05,deathTrendPerYear:-0.03,
  ...overrides,
});
const sheet = (overrides={}, options={}) => createReviewedScenarioStatsSheet({
  row:proposed(overrides),basis,date:'2026-01-01',...options,
});
const plain = x => JSON.parse(JSON.stringify(x));

test('typed custom tool numbers pass end-to-end into a reviewed map-backed sheet without duplicating native debt',()=>{
  const customKeys=['publicDebt','grain'];
  const target=[{code:'Latvia',name:'Latvia'}];
  const tool=buildScenarioStartingStatsTool(target,{customKeys});
  assert.ok(tool.schema.required.includes('country1CustomStats'));
  const envelope={toolInput:{
    country1Json:JSON.stringify({macro:proposed().macro}),
    country1PublicDebt:45,
    country1BudgetBalance:-2,
    country1CustomStats:{publicDebt:48,grain:0},
  }};
  const interpreted=interpretScenarioStatsAiResponse(envelope,target,{customKeys});
  assert.equal(interpreted.Latvia.error,'');
  const result=createReviewedScenarioStatsSheet({row:interpreted.Latvia.row,basis,date:'2026-01-01',customKeys});
  assert.equal(result.economy.publicDebt,45);
  assert.equal(result.customStats.publicDebt,48);
  assert.equal(result.customStats.grain,0);
  assert.equal(result.population.total,1800000);
  assert.deepEqual(result.territorialComponents.map(c=>c.geography).sort(),['Kurzeme','Latgale','Riga']);
  assert.equal(scenarioStatsRequiredReady(result,customKeys),true);
  assert.throws(()=>createReviewedScenarioStatsSheet({row:{...interpreted.Latvia.row,customStats:{grain:0}},basis,date:'2026-01-01',customKeys}),/publicDebt needs a number/,
    'missing independent custom debt must still fail; no silent substitution from canonical debt');
});

test('a map-backed reviewed proposal is a truly complete native sheet, not just a number display',()=>{
  const result=sheet();
  assert.equal(result.statsSchemaVersion,1);
  assert.equal(result.population.total,1800000);
  assert.deepEqual(result.territorialComponents.map(e=>e.geography).sort(),['Kurzeme','Latgale','Riga']);
  assert.ok(result.economy.gdp>0);
  assert.equal(scenarioStatsRequiredReady(result),true);
  // Scenario-authored continuity is a native world record, not an AI countryStatSheet response.
  // The latter has a separate closed wire schema and must not be loosened for this UI.
  assert.deepEqual(normalizeCountryStatDemographicEvolution(result.continuity.demographicEvolution), result.continuity.demographicEvolution);
  assert.equal(result.continuity.demographicEvolution.birthRate,7);
  assert.equal(result.continuity.demographicEvolution.deathRate,14);
  assert.equal(result.continuity.demographicEvolution.sourceDate,'2026-01-01');
  assert.equal(result.continuity.demographicEvolution.basePopulation,result.population.total);
});

test('the calendar never invents 1913 birth rates for 2026 or vice versa',()=>{
  const modern=sheet();
  const early=createReviewedScenarioStatsSheet({row:proposed({birthRate:25,deathRate:15,birthTrendPerYear:-0.1,deathTrendPerYear:-0.08}),basis,date:'1913-01-01'});
  assert.equal(early.continuity.demographicEvolution.birthRate,25);
  assert.equal(modern.continuity.demographicEvolution.birthRate,7);
  assert.equal(modern.continuity.demographicEvolution.endDate,'2076-01-01');
  assert.equal(early.continuity.demographicEvolution.sourceDate,'1913-01-01');
  const noRates=proposed();
  for (const key of ['birthRate','deathRate','birthTrendPerYear','deathTrendPerYear']) delete noRates[key];
  const withoutRates=createReviewedScenarioStatsSheet({row:noRates,basis,date:'2026-01-01'});
  assert.equal(withoutRates.continuity?.demographicEvolution,undefined);
});

test('malformed generation is fail-closed rather than fabricating provinces or importing alien buckets',()=>{
  assert.throws(()=>sheet({macro:[]}),/Expected 2/);
  assert.throws(()=>sheet({macro:[{index:1,group:'core',population:1,gdpPerCapita:1},{index:1,group:'core',population:1,gdpPerCapita:1}]}),/duplicated/);
  assert.throws(()=>sheet({macro:[{index:1,group:'core',population:1,gdpPerCapita:1},{index:9,group:'core',population:1,gdpPerCapita:1}]}),/outside/);
  assert.throws(()=>createReviewedScenarioStatsSheet({row:proposed(),basis:{plan:[],macroPlan:[]},date:'2026-01-01'}),/no authoritative mapped/);
  assert.throws(()=>sheet({birthRate:7,deathRate:undefined}),/Death rate/);
  assert.throws(()=>sheet({agriculture:10,industry:10,services:10}),/exactly 100/);
});

test('a printed M1 or JSON string 1 is the same native bucket, without changing map authority', () => {
  const canonical = sheet();
  const labelled = sheet({ macro: [
    { ...proposed().macro[0], index: 'M1' },
    { ...proposed().macro[1], index: '2' },
  ] });
  assert.deepEqual(labelled.territorialComponents, canonical.territorialComponents);
  assert.equal(labelled.population.total, canonical.population.total);
  // The one-bucket rejection observed for El Salvador/Bukhara/Jabal Shammar
  // must not be caused merely by the provider serializing the printed ID.
  const soleBasis = {
    plan: [{ geography: 'Mapped country' }],
    macroPlan: [{ index: 1, members: [{ geography: 'Mapped country', weight: 1 }] }],
  };
  for (const index of [1, '1', 'M1']) {
    const generated = createReviewedScenarioStatsSheet({
      row: proposed({ macro: [{ index, group: 'core', population: 10000, gdpPerCapita: 5000 }] }),
      basis: soleBasis, date: '1912-01-01',
    });
    assert.equal(generated.population.total, 10000);
    assert.equal(generated.territorialComponents[0].geography, 'Mapped country');
  }
});

test('untrusted territorial indices remain fail-closed and diagnose actual IDs', () => {
  for (const index of ['M2', '2', 2, 0, '0', null, undefined, 'M01', '01', '1.0', 1.5, 'Riga', 'M9999999999999999999']) {
    assert.throws(
      () => sheet({ macro: [{ ...proposed().macro[0], index }, proposed().macro[1]] }),
      (error) => /Territorial bucket identity/.test(error.message)
        && error.message.includes('Expected [1,2]')
        && error.message.includes('received'),
      `must not accept ${String(index)}`,
    );
  }
  assert.throws(() => sheet({ macro: [
    { ...proposed().macro[0], index: 'M1' },
    { ...proposed().macro[1], index: '1' },
  ] }), /duplicated/);
  const before = proposed();
  const snapshot = JSON.stringify(before);
  sheet({ macro: [
    { ...before.macro[0], index: 'M1' },
    { ...before.macro[1], index: '2' },
  ] });
  assert.equal(JSON.stringify(before), snapshot, 'review normalization must not mutate the AI response');
});

test('uninhabited native regional buckets are valid; negative, fractional and entirely empty populations fail closed',()=>{
  // The live British/French errors do not include raw rejected bucket values.
  // Zero-population territory is supported by the native expansion contract.
  const withEmpty=proposed({macro:[
    {index:1,group:'core',population:1200000,gdpPerCapita:25000},
    {index:2,group:'overseas/dependent',population:0,gdpPerCapita:0},
  ]});
  const generated=createReviewedScenarioStatsSheet({row:withEmpty,basis,date:'2026-01-01'});
  assert.equal(generated.population.total,1200000);
  assert.equal(generated.territorialComponents.find((entry)=>entry.geography==='Latgale').population,0);
  assert.equal(generated.territorialComponents.find((entry)=>entry.geography==='Latgale').gdpPerCapita,1);
  assert.equal(scenarioStatsRequiredReady(generated),true);
  for (const population of [-1,2.5,'0',null]) {
    assert.throws(()=>sheet({macro:[proposed().macro[0],{index:2,group:'core',population,gdpPerCapita:500}]}),/nonnegative whole number/);
  }
  assert.throws(()=>sheet({macro:[
    {index:1,group:'core',population:0,gdpPerCapita:0},
    {index:2,group:'core',population:0,gdpPerCapita:0},
  ]}),/Total proposed territorial population must be a positive whole number/);
});

test('British Empire-like 12-bucket input can contain an empty outlying bucket without inventing people',()=>{
  const many={plan:[],macroPlan:[]};
  const macro=[];
  for(let index=1;index<=12;index++){
    const member={geography:`Mapped province ${index}`,weight:1};
    many.plan.push(member);
    many.macroPlan.push({index,members:[member]});
    macro.push({index,group:'integrated',population:index===12?0:1000,gdpPerCapita:index===12?0:500});
  }
  const result=createReviewedScenarioStatsSheet({row:{macro,customStats:{grain:500},publicDebt:0,budgetBalance:0},basis:many,date:'1912-01-01',customKeys:['grain']});
  assert.equal(result.population.total,11000);
  assert.equal(result.territorialComponents.length,12);
  assert.equal(result.territorialComponents.at(-1).population,0);
  assert.equal(result.territorialComponents.reduce((sum,entry)=>sum+entry.population,0),11000);
});

test('AI filling missing fields keeps a previous author-entered territorial ledger and macro totals',()=>{
  const authored=normalizeCountryStatSheet({
    territorialComponents:[
      {geography:'Riga',group:'core',population:1000000,gdpPerCapita:30000},
      {geography:'Kurzeme',group:'core',population:500000,gdpPerCapita:18000},
      {geography:'Latgale',group:'core',population:200000,gdpPerCapita:12000},
    ],
    economy:{gdpGrowth:4,unemployment:5,currency:'LVL',publicDebt:20},
    capital:'Author capital',
    customStats:{grain:300},
  });
  const result=sheet({capital:'AI capital',gdpGrowth:0.5}, {existing:authored});
  assert.equal(result.capital,'Author capital');
  assert.equal(result.economy.gdpGrowth,4);
  assert.equal(result.economy.currency,'LVL');
  assert.equal(result.population.total,1700000);
  assert.deepEqual(result.territorialComponents,authored.territorialComponents);
  assert.equal(result.customStats.grain,300);
  assert.equal(scenarioStatsRequiredReady(result),true);
});

test('an old authored fixed demographic plan wins over a new AI demographic proposal',()=>{
  const existing=normalizeCountryStatSheet({
    territorialComponents:[{geography:'Riga',group:'core',population:1000000,gdpPerCapita:1000},
      {geography:'Kurzeme',group:'core',population:500000,gdpPerCapita:1000},
      {geography:'Latgale',group:'core',population:500000,gdpPerCapita:1000}],
    continuity:{demographicClock:{sourceDate:'2026-01-01',lastDate:'2026-01-01',endDate:'2027-01-01',
      basePopulation:2000000,birthsPerThousand:13,deathsPerThousand:9,creditedBirths:0,creditedDeaths:0}},
  });
  const result=sheet({}, {existing});
  assert.ok(result.continuity.demographicClock);
  assert.equal(result.continuity.demographicEvolution,undefined);
});

test('an existing ledger referring to deleted or annexed geography is not silently replaced',()=>{
  const old=normalizeCountryStatSheet({territorialComponents:[{geography:'Old province',group:'core',population:1000000,gdpPerCapita:10000}]});
  assert.throws(()=>sheet({}, {existing:old}),/no longer matches the scenario map/);
});

test('scenario coverage distinguishes missing/incomplete/ready countries and custom-sheet requirements',()=>{
  const ready=sheet();
  const world={ownerCodes:['Latvia','Estonia','Lithuania'],countryStats:{Latvia:ready,Estonia:{population:{total:100}}}};
  const options=[{code:'Latvia',name:'Latvia'},{code:'Estonia',name:'Estonia'},{code:'Lithuania',name:'Lithuania'}];
  assert.deepEqual(scenarioStatsCoverage(world,options).map(({status})=>status),['ready','incomplete','missing']);
  assert.equal(scenarioStatsCoverage({...world,countryStats:{Latvia:{customStats:{grain:100}}}},options,{customKeys:['grain']})[0].status,'ready');
  assert.equal(scenarioStatsCoverage({...world,countryStats:{Latvia:{customStats:{grain:100}}}},options,{customKeys:['grain','ships']})[0].status,'incomplete');
});

test('manual editing resizes native territorial population/GDP and retains all geographic IDs',()=>{
  const before=sheet();
  const edits=scenarioStatsEditorValues(before);
  const after=applyScenarioStatsManualEdits({sheet:before,date:'2026-01-01',edits:{...edits,population:1900000,gdp:55000000000,birthRate:6,deathRate:15}});
  assert.equal(after.population.total,1900000);
  assert.ok(Math.abs(after.economy.gdp-55000000000)<5,'rounded native GDP total');
  assert.deepEqual(after.territorialComponents.map(e=>e.geography),before.territorialComponents.map(e=>e.geography));
  assert.equal(after.continuity.demographicEvolution.basePopulation,1900000);
  assert.equal(after.continuity.demographicEvolution.birthRate,6);
  assert.equal(scenarioStatsRequiredReady(after),true);
  assert.equal(before.population.total,1800000,'authoring does not mutate prior baseline');
});

test('manual creation only distributes across supplied canonical geography, no invented territorial ID',()=>{
  const macro=authorApprovedMacroEstimates(basis,1800000,36000000000);
  assert.deepEqual(macro.map(e=>e.index),[1,2]);
  assert.equal(macro.reduce((n,e)=>n+e.population,0),1800000);
  assert.equal(macro[0].gdpPerCapita,20000);
  const result=createReviewedScenarioStatsSheet({row:proposed({macro}),basis,date:'2026-01-01'});
  assert.equal(result.territorialComponents.length,3);
  assert.equal(result.population.total,1800000);
});

test('custom scenario values are persisted and readiness is tied to actual defined keys',()=>{
  const keys=['grain','treasury','ships'];
  const generated=createReviewedScenarioStatsSheet({row:{macro:proposed().macro,customStats:{grain:320,treasury:20,ships:8},publicDebt:0,budgetBalance:0},basis,date:'1300-01-01',customKeys:keys});
  assert.equal(generated.customStats.grain,320);
  assert.equal(scenarioStatsRequiredReady(generated,keys),true);
  const edits=scenarioStatsEditorValues(generated,keys);
  const updated=applyScenarioStatsManualEdits({sheet:generated,edits:{...edits,customStats:{grain:330,treasury:20,ships:8}},date:'1300-01-01',customKeys:keys});
  assert.equal(updated.customStats.grain,330);
  assert.deepEqual(updated.territorialComponents,generated.territorialComponents);
});

test('generated scenario-owned Stats detach into a new game on desktop and web, without writing active game',()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const original={ownerCodes:['Latvia','Estonia'],countryStats:{Latvia:sheet(),Estonia:sheet({birthRate:6,deathRate:13})}};
  for(const file of ['server/libraryStore.js','src/runtime/web/models.js']){
    const src=readFileSync(path.join(root,file),'utf8');
    const prefix=file.startsWith('server/')?'const buildFreshWorldSeedFromScenario =':'export const buildFreshWorldSeedFromScenario =';
    const start=src.indexOf(prefix),end=src.indexOf('\n};',start);
    assert.ok(start>=0&&end>start,`actual ${file} scenario seeding function exists`);
    const fn=vm.runInNewContext(`${src.slice(start,end+3).replace(/^export /,'')}\nbuildFreshWorldSeedFromScenario`,{
      TEMPLATE_WORLD_OVERRIDE_KEYS,cloneJson:structuredClone,
    });
    const actual=plain(fn({baseWorld:{},scenarioWorld:original}));
    assert.deepEqual(actual.countryStats,plain(original.countryStats));
    actual.countryStats.Latvia.population.total=1;
    assert.equal(original.countryStats.Latvia.population.total,1800000);
  }
});

test('an initialized demographic baseline actually drives the native simulation',()=>{
  const initial=sheet();
  const world={ownerCodes:['Latvia'],countryStats:{Latvia:initial}};
  const next=advanceNativeDemographicClock(world,{fromDate:'2026-01-01',toDate:'2027-01-01'});
  assert.ok(next.countryStats.Latvia.population.total<initial.population.total);
  assert.equal(initial.continuity.demographicEvolution.creditedBirths,0);
});


test('actual scenario GeoJSON is the only source of region identities for author proposals',async()=>{
  const {projectCountryStatsScenarioCatalog,buildTargetStatsTerritorialBasisKernel}=await import('../Game/AI/countryStatsWorkerKernel.js');
  const geographic={type:'FeatureCollection',features:[
    {type:'Feature',properties:{id:'Riga',name:'Riga',gid0:'LVA'},geometry:{type:'Polygon',coordinates:[[[23,56],[24,56],[24,57],[23,56]]]}},
    {type:'Feature',properties:{id:'Tallinn',name:'Tallinn',gid0:'EST'},geometry:{type:'Polygon',coordinates:[[[24,58],[25,58],[25,59],[24,58]]]}}
  ]};
  const catalog=projectCountryStatsScenarioCatalog(geographic);
  const world={ownerCodes:['Latvia','Estonia']};
  const latvia=await buildTargetStatsTerritorialBasisKernel({bundle:{world,game:{gameDate:'2026-01-01'},events:[]},code:'Latvia',scenarioCatalog:catalog});
  assert.equal(latvia.plan.length,1);
  assert.equal(latvia.macroPlan.length,1);
  assert.equal(latvia.macroPlan[0].members[0].geography,'Latvia');
  const estimates=authorApprovedMacroEstimates(latvia,1800000,25000000000);
  const reviewed=createReviewedScenarioStatsSheet({row:proposed({macro:estimates}),basis:latvia,date:'2026-01-01'});
  assert.deepEqual(reviewed.territorialComponents.map(row=>row.geography),['Latvia']);
  assert.equal(reviewed.population.total,1800000);
  assert.equal(reviewed.territorialComponents.some(row=>row.geography==='Tallinn'),false);
});

// C2B2A: binding-aware authoring is opt-in and does not change legacy custom
// country sheet semantics before an author chooses a native source.
const bindingFixture = (rows) => ({ custom: true, sections: [{ key: 'national', label: 'National', stats: rows }] });
const metric = (key, kind, nativeMetric) => ({ key, kind, label: key, ...(nativeMetric ? { nativeMetric } : {}) });

test('native-bound GDP and public debt cards need no independent AI generated customStats copies', () => {
  const customDefinition = bindingFixture([
    metric('gdpHero', 'currency', 'gdp'),
    metric('gdpMini', 'currency', 'gdp'),
    metric('debtCard', 'percentage', 'publicDebt'),
    metric('grain', 'number'),
  ]);
  const result = createReviewedScenarioStatsSheet({
    row: { macro: proposed().macro, publicDebt: 45, budgetBalance: -2, customStats: { grain: 300 } },
    basis, date: '2026-01-01', customDefinition,
  });
  assert.ok(result.economy.gdp > 0);
  assert.equal(result.economy.publicDebt, 45);
  assert.deepEqual(result.customStats, { grain: 300 });
  assert.equal(scenarioStatsRequiredReady(result, null, customDefinition), true);
  assert.equal(scenarioStatsRequiredReady({ customStats: { grain: 300 } }, null, customDefinition), false);
  assert.deepEqual(scenarioStatsCoverage({ countryStats: { Latvia: result } }, [{ code: 'Latvia' }], { customDefinition })[0].status, 'ready');
});

test('custom sheet with only native display cards does not require invented custom values', () => {
  const customDefinition = bindingFixture([metric('totalGDP', 'currency', 'gdp'), metric('population', 'number', 'totalPopulation')]);
  const result = createReviewedScenarioStatsSheet({
    row: { macro: proposed().macro, publicDebt: 0, budgetBalance: 0 },
    basis, date: '2026-01-01', customDefinition,
  });
  assert.equal(result.customStats, undefined);
  assert.equal(scenarioStatsRequiredReady(result, null, customDefinition), true);
  assert.equal(result.economy.publicDebt, 0);
});

test('review gate rejects duplicate AI values and old conflicting values without selecting a winner', () => {
  const customDefinition = bindingFixture([metric('gdp', 'currency', 'gdp'), metric('grain', 'number')]);
  const source = { macro: proposed().macro, publicDebt: 45, budgetBalance: -2, customStats: { gdp: 3000000, grain: 5 } };
  assert.throws(() => createReviewedScenarioStatsSheet({ row: source, basis, date: '2026-01-01', customDefinition }), /review its migration/);
  const legacy = sheet({ customStats: { gdp: 200000000, grain: 5 } }, { customKeys: ['gdp', 'grain'] });
  const original = plain(legacy);
  assert.throws(() => createReviewedScenarioStatsSheet({
    row: { ...source, customStats: { grain: 5 } }, basis, date: '2026-01-01', customDefinition, existing: legacy,
  }), /review its migration/);
  assert.deepEqual(legacy, original);
});

test('manual authoring updates independent custom numbers and native budget without writing native-bound custom keys', () => {
  const customDefinition = bindingFixture([metric('gdpHero', 'currency', 'gdp'), metric('grain', 'number')]);
  const original = sheet({ customStats: { grain: 5 } }, { customKeys: ['grain'] });
  const fields = scenarioStatsEditorValues(original, ['grain']);
  fields.customStats.grain = 17;
  fields.gdp = original.economy.gdp + 2000000;
  fields.publicDebt = 0;
  const edited = applyScenarioStatsManualEdits({ sheet: original, edits: fields, date: '2026-01-01', customDefinition });
  assert.deepEqual(edited.customStats, { grain: 17 });
  assert.equal(edited.economy.publicDebt, 0);
  assert.notEqual(edited.economy.gdp, original.economy.gdp);
  assert.equal(scenarioStatsRequiredReady(edited, null, customDefinition), true);
  assert.throws(() => applyScenarioStatsManualEdits({
    sheet: original, edits: { ...fields, customStats: { grain: 17, gdpHero: 1 } }, date: '2026-01-01', customDefinition,
  }), /review its migration/);
});

test('standard definition cannot masquerade as a custom native-binding authoring request', () => {
  const standard = { custom: false, sections: [] };
  assert.throws(() => createReviewedScenarioStatsSheet({ row: proposed(), basis, date: '2026-01-01', customDefinition: standard }), /requires a custom national/);
});

test('AI custom generation may not fabricate native inflation/stability as implicit zeros for a bound card', () => {
  const customDefinition = bindingFixture([metric('prices', 'percentage', 'inflation')]);
  const row = { macro: proposed().macro, publicDebt: 45, budgetBalance: -2 };
  assert.throws(() => createReviewedScenarioStatsSheet({ row, basis, date: '2026-01-01', customDefinition }), /no reviewed starting value/);
  const previous = sheet({}, { existing: null });
  // A previously authored numeric zero is explicit and meaningful, unlike
  // the custom-generator's fallback zero with no scenario provenance.
  assert.equal(previous.economy.inflation, 2.4);
  const next = createReviewedScenarioStatsSheet({ row, basis, date: '2026-01-01', customDefinition, existing: previous });
  assert.equal(next.economy.inflation, 2.4);
});

test('a concurrent Stats asset replacement is detected even when both assetStatus.stats values remain true',()=>{
  const old={custom:true,sections:[{key:'main',label:'Production',stats:[
    {key:'grain',label:'Grain production',kind:'number',minimum:0,maximum:100},
    {key:'debt',label:'Public debt display',kind:'percentage',minimum:0,maximum:100},
  ]}]};
  const changed=structuredClone(old);
  changed.sections[0].stats[1].nativeMetric='publicDebt';
  const bounds=structuredClone(old);
  bounds.sections[0].stats[0].minimum=10;
  assert.doesNotThrow(()=>assertScenarioStatsDefinitionContentsCurrent(old,structuredClone(old)));
  assert.throws(()=>assertScenarioStatsDefinitionContentsCurrent(old,changed),/Statistics definition changed elsewhere/i);
  assert.throws(()=>assertScenarioStatsDefinitionContentsCurrent(old,bounds),/Statistics definition changed elsewhere/i);
  assert.throws(()=>assertScenarioStatsDefinitionContentsCurrent(old,null),/Statistics definition changed elsewhere/i,
    'a missing or unreadable asset may not silently authorize a save');
  assert.equal(old.sections[0].stats[0].minimum,0);
  assert.equal(changed.sections[0].stats[1].nativeMetric,'publicDebt');
});

test('custom scenario manual editor can amend native inflation, unemployment and GDP growth without writing custom aliases', () => {
  const customDefinition = bindingFixture([metric('grain', 'number')]);
  const original = sheet({ customStats: { grain: 5 } }, { customKeys: ['grain'] });
  const fields = scenarioStatsEditorValues(original, ['grain']);
  fields.inflation = -1.3;
  fields.unemployment = 17;
  fields.gdpGrowth = -2.1;
  const edited = applyScenarioStatsManualEdits({ sheet: original, edits: fields, date: '1991-08-18', customDefinition });
  assert.equal(edited.economy.inflation, -1.3);
  assert.equal(edited.economy.unemployment, 17);
  assert.equal(edited.economy.gdpGrowth, -2.1);
  assert.deepEqual(edited.customStats, { grain: 5 });
  assert.deepEqual(edited.territorialComponents, original.territorialComponents);
  assert.equal(original.economy.inflation, 0, "the source fixture\u0027s native zero remains unmodified");
  const blank = applyScenarioStatsManualEdits({ sheet: original,
    edits: { ...fields, inflation: '', unemployment: '', gdpGrowth: '' },
    date: '1991-08-18', customDefinition });
  assert.equal(blank.economy.inflation, original.economy.inflation);
  assert.equal(blank.economy.unemployment, original.economy.unemployment);
  assert.equal(blank.economy.gdpGrowth, original.economy.gdpGrowth);
  const zero = applyScenarioStatsManualEdits({ sheet: original,
    edits: { ...fields, inflation: 0, unemployment: 0, gdpGrowth: 0 },
    date: '1991-08-18', customDefinition });
  assert.equal(zero.economy.inflation, 0);
  assert.equal(zero.economy.unemployment, 0);
  assert.equal(zero.economy.gdpGrowth, 0);
  assert.throws(() => applyScenarioStatsManualEdits({ sheet: original,
    edits: { ...fields, inflation: 'unknown' }, date: '1991-08-18', customDefinition }), /Inflation/);
});

test('orphan demographic trend is rejected instead of silently clearing or ignoring canonical plans', () => {
  const original = sheet();
  const edits = scenarioStatsEditorValues(original);
  const orphan = { ...edits, birthRate: "", deathRate: "", birthTrendPerYear: -0.15, deathTrendPerYear: "" };
  assert.throws(() => applyScenarioStatsManualEdits({ sheet: original, edits: orphan, date: "2026-01-01" }),
    /Annual birth\/death trends require both base rates/);
  assert.ok(original.continuity.demographicEvolution);
  const remove = applyScenarioStatsManualEdits({ sheet: original,
    edits: { ...orphan, birthTrendPerYear: "", deathTrendPerYear: "" }, date: "2026-01-01" });
  assert.equal(remove.continuity?.demographicEvolution, undefined);
  const row = proposed();
  for (const key of ["birthRate", "deathRate", "birthTrendPerYear", "deathTrendPerYear"]) delete row[key];
  const uninitialized = createReviewedScenarioStatsSheet({ row, basis, date: "2026-01-01" });
  const orphanNew = { ...scenarioStatsEditorValues(uninitialized), birthRate: "", deathRate: "",
    birthTrendPerYear: "", deathTrendPerYear: -0.05 };
  assert.throws(() => applyScenarioStatsManualEdits({ sheet: uninitialized, edits: orphanNew, date: "2026-01-01" }),
    /Annual birth\/death trends require both base rates/);
  assert.equal(uninitialized.continuity?.demographicEvolution, undefined);
  const unchanged = applyScenarioStatsManualEdits({ sheet: uninitialized,
    edits: { ...orphanNew, deathTrendPerYear: "" }, date: "2026-01-01" });
  assert.equal(unchanged.continuity?.demographicEvolution, undefined);
});
