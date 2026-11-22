/*! Open Historia - Country Editor custom Stats V2 regression. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  countryCustomStatEditFromForm,
  countryCustomStatFormFromSheet,
} from "./countryEditorStats.js";
import { mergeCountryStatPatch } from "../../runtime/countryStats.js";

const definition = {
  custom: true,
  sections: [
    {key:"population",label:"Population",stats:[
      {key:"totalPopulation",label:"Total population",kind:"number",decimals:0,minimum:0},
    ]},
    {key:"national",label:"National",stats:[
      {key:"nationalStability",label:"National stability",kind:"index"},
      {key:"intelligenceService",label:"Intelligence service",kind:"index"},
      {key:"customMetric",label:"Author-owned metric",kind:"number",decimals:2,minimum:-10,maximum:1000},
    ]},
    {key:"economy",label:"Economy",stats:[
      {key:"gdp",label:"GDP",kind:"currency",decimals:1,minimum:0},
      {key:"budgetBalance",label:"Budget balance",kind:"percentage",decimals:1,minimum:-1000,maximum:1000},
    ]},
  ],
};
const sheet = {
  population:{total:142985311}, economy:{gdp:1793750000000,publicDebt:32,budgetBalance:7},
  customStats:{totalPopulation:142985311,nationalStability:62,intelligenceService:98,gdp:1793750000000,
    budgetBalance:7,customMetric:0,obsoleteMetric:401},
  continuity:{assessedRound:324,customStatFingerprint:"recorded-source"},
  statsSchemaVersion:5,
};

test("custom sheet with no territorialComponents exposes its exact authored values, including true zero and unset",()=>{
  const form=countryCustomStatFormFromSheet({sheet,definition,liveIntelligence:75});
  assert.equal(form.totalPopulation,"142985311");
  assert.equal(form.gdp,"1793750000000");
  assert.equal(form.customMetric,"0");
  assert.equal(form.intelligenceService,"75","National panel uses the native live intelligence rating");
  assert.equal(Object.hasOwn(form,"obsoleteMetric"),false);
  assert.deepEqual(countryCustomStatEditFromForm({form,loaded:form,definition,liveIntelligence:75}),
    {patch:null,intelligenceRating:null});
});

test("editing one custom metric preserves hidden backend, unknown custom metrics and continuity",()=>{
  const loaded=countryCustomStatFormFromSheet({sheet,definition,liveIntelligence:75});
  const form={...loaded,nationalStability:"80"};
  const {patch,intelligenceRating}=countryCustomStatEditFromForm({form,loaded,definition,liveIntelligence:75});
  assert.deepEqual(patch,{customStats:{nationalStability:80}});
  assert.equal(intelligenceRating,null);
  const next=mergeCountryStatPatch(sheet,patch);
  assert.equal(next.customStats.nationalStability,80);
  assert.equal(next.customStats.customMetric,0);
  assert.equal(next.customStats.obsoleteMetric,401);
  assert.deepEqual(next.population,sheet.population);
  assert.equal(next.economy.gdp,sheet.economy.gdp);
  assert.equal(next.continuity.customStatFingerprint,sheet.continuity.customStatFingerprint);
  assert.equal(next.territorialComponents,undefined);
});

test("GDP visibly changes only the explicitly chosen custom metric, never silently changes hidden native backend",()=>{
  const loaded=countryCustomStatFormFromSheet({sheet,definition,liveIntelligence:75});
  const {patch}=countryCustomStatEditFromForm({loaded,form:{...loaded,gdp:"1850000000000"},definition,liveIntelligence:75});
  assert.deepEqual(patch,{customStats:{gdp:1850000000000}});
  const next=mergeCountryStatPatch(sheet,patch);
  assert.equal(next.customStats.gdp,1850000000000);
  assert.equal(next.economy.gdp,1793750000000);
});

test("native Intelligence Service editing targets live rating instead of misleading obsolete custom copy",()=>{
  const loaded=countryCustomStatFormFromSheet({sheet,definition,liveIntelligence:75});
  const result=countryCustomStatEditFromForm({loaded,form:{...loaded,intelligenceService:"83"},definition,liveIntelligence:75});
  assert.deepEqual(result,{patch:null,intelligenceRating:83});
  const noRatingLoaded=countryCustomStatFormFromSheet({sheet,definition,liveIntelligence:null});
  assert.equal(noRatingLoaded.intelligenceService,"98");
  assert.deepEqual(countryCustomStatEditFromForm({
    loaded:noRatingLoaded,form:{...noRatingLoaded,intelligenceService:"85"},definition,liveIntelligence:null,
  }),{patch:{customStats:{intelligenceService:85}},intelligenceRating:null});
});

test("custom metric validation is fail-closed for blank, range, nonfinite, and unsupported precision",()=>{
  const loaded=countryCustomStatFormFromSheet({sheet,definition});
  const changed=(key,value)=>countryCustomStatEditFromForm({
    loaded,form:{...loaded,[key]:value},definition,
  });
  assert.throws(()=>changed("nationalStability",""),/cannot be cleared/);
  assert.throws(()=>changed("nationalStability","140"),/between 0 and 100/);
  assert.throws(()=>changed("customMetric","1.234"),/at most 2 decimal/);
  assert.throws(()=>changed("customMetric","Infinity"),/must be a number/);
  assert.deepEqual(changed("customMetric","-4.75").patch,{customStats:{customMetric:-4.75}});
  assert.deepEqual(changed("customMetric","0").patch,null,"unchanged explicit zero must not generate a patch");
});

test("blank custom-era metrics are not automatically filled; only explicitly entered ones are written",()=>{
  const minimal={customStats:{nationalStability:20}};
  const loaded=countryCustomStatFormFromSheet({sheet:minimal,definition});
  assert.equal(loaded.gdp,"");
  assert.equal(loaded.customMetric,"");
  const edited=countryCustomStatEditFromForm({loaded,form:{...loaded,customMetric:"0"},definition});
  assert.deepEqual(edited.patch,{customStats:{customMetric:0}});
  assert.equal(Object.hasOwn(edited.patch.customStats,"gdp"),false);
});

test("the old standard Stats editor is not replaced by custom mode",()=>{
  const standard={custom:false,sections:[]};
  assert.deepEqual(countryCustomStatFormFromSheet({sheet,definition:standard}),{});
  assert.deepEqual(countryCustomStatEditFromForm({form:{gdp:"10"},definition:standard}),
    {patch:null,intelligenceRating:null});
});
