import test from "node:test";
import assert from "node:assert/strict";
import { stageExplicitNativeStatsBinding } from "./statsExplicitNativeBinding.js";
import { nationalStatsAuthoringContract, assertNoLegacyNativeStatCopies } from "./statsMetricBindings.js";
import { serializeStatSheet } from "./statIndexDefinitions.js";

const custom = () => ({
  custom: true, version: 2,
  sections: [{key:"economy",label:"Economy",stats:[
    {key:"gdp",label:"Legacy GDP",kind:"currency",prefix:"€",minimum:0},
    {key:"inflation",label:"Legacy inflation",kind:"percentage",suffix:"%",minimum:0,maximum:100},
    {key:"other",label:"Custom industrial series",kind:"number"},
  ]}],
  dashboard:{version:1,widgets:[
    {id:"gdpOne",source:"custom:gdp",style:"value",page:"overview",x:0,y:0,w:3,h:1},
    {id:"gdpTwo",source:"custom:gdp",style:"value",page:"overview",x:3,y:0,w:3,h:1},
    {id:"other",source:"custom:other",style:"value",page:"details",x:0,y:0,w:3,h:1},
  ]},
});
const oldCountry = {economy:{gdp:328_800_000_000,inflation:0},
  customStats:{gdp:324_000_000_000,inflation:2.5,other:12}};

test("Czech-style explicit GDP choice changes display owner only, preserving country values and dashboard arrangement",()=>{
  const input=custom(), old=structuredClone(input);
  const world=structuredClone(oldCountry);
  const next=stageExplicitNativeStatsBinding(input,{key:"gdp",nativeMetric:"gdp"});
  assert.deepEqual(input,old,"staging may not mutate current authoring definition");
  assert.deepEqual(oldCountry,world,"staging may not touch canonical or custom readings");
  assert.equal(next.sections[0].stats[0].nativeMetric,"gdp");
  assert.deepEqual(next.dashboard.widgets.map(w=>w.source),
    ["native:gdp","native:gdp","custom:other"]);
  assert.deepEqual(next.dashboard.widgets.map(w=>[w.id,w.x,w.w]),
    [["gdpOne",0,3],["gdpTwo",3,3],["other",0,3]]);
  assert.equal(next.sections[0].stats[1].nativeMetric,undefined);
  assert.deepEqual(serializeStatSheet(next),next,"saved representation survives definition serialization");
  assert.deepEqual(nationalStatsAuthoringContract(next).boundRows,
    [{key:"gdp",nativeMetric:"gdp"}]);
  assert.throws(()=>assertNoLegacyNativeStatCopies(next,oldCountry),/review its migration/,
    "previous custom data must still be archived in second, separately approved step");
});

test("native inflation chosen explicitly replaces misleading legacy 0..100 bounds without modifying native zero",()=>{
  const next=stageExplicitNativeStatsBinding(custom(),{key:"inflation",nativeMetric:"inflation"});
  const row=next.sections[0].stats[1];
  assert.equal(row.minimum,-1000);
  assert.equal(row.maximum,1000);
  assert.equal(row.nativeMetric,"inflation");
  assert.equal(oldCountry.economy.inflation,0);
  assert.equal(oldCountry.customStats.inflation,2.5);
});

test("ambiguous cards, unknown identities, kind mismatch and invalid definitions fail closed",()=>{
  const def=custom();
  for(const [key,nativeMetric] of [["xyz","gdp"],["gdp","fictionalField"],["gdp","inflation"],["other","publicDebt"]]){
    assert.throws(()=>stageExplicitNativeStatsBinding(def,{key,nativeMetric}));
  }
  const bound=stageExplicitNativeStatsBinding(def,{key:"gdp",nativeMetric:"gdp"});
  assert.throws(()=>stageExplicitNativeStatsBinding(bound,{key:"gdp",nativeMetric:"gdp"}),/already/);
  assert.throws(()=>stageExplicitNativeStatsBinding({custom:false,sections:[]},{key:"gdp",nativeMetric:"gdp"}),/custom/);
  assert.equal(def.sections[0].stats[0].nativeMetric,undefined);
});
