import test from "node:test";
import assert from "node:assert/strict";
import { planGeneratedMapReplacement } from "./fmgReplacementPlan.js";

const seed=()=>({
  regions:{type:"FeatureCollection",features:[{type:"Feature",properties:{id:"r1",owner:"New polity"},geometry:{type:"Polygon",coordinates:[[[0,0],[5,0],[5,5],[0,0]]]}}]},
  polities:[{code:"New polity",name:"New polity",color:"#112233"}],
  colors:{"New polity":[17,34,51]},
  cities:{type:"FeatureCollection",features:[{type:"Feature",properties:{city:"Capital",capital:"primary",population:600},geometry:{type:"Point",coordinates:[3,3]}}]},
  background:{geojson:{type:"FeatureCollection",features:[]}},
});
test("replacing a world plans complete isolated canonical state without stale previous-country references",()=>{
  const existing={
    id:"work_id",metadata:{name:"Old world",author:"Creator",customBackground:{kind:"plain"}},
    polities:{Old:{name:"Old"}},groups:{OldGroup:{name:"OldGroup"}},
    puppets:[{subject:"Old"}],relations:[{a:"Old",b:"Other",score:-40}],
    units:[{id:"old_unit"}],terrainAreas:[{id:"old_terrain"}],flags:{Old:"old_flag"},
  };
  const plan=planGeneratedMapReplacement(seed(),existing,()=>"fresh_city");
  assert.equal(plan.document.id,existing.id);
  assert.equal(plan.document.metadata.name,"Old world");
  assert.equal(plan.document.metadata.author,"Creator");
  assert.equal(plan.document.metadata.kind,"blank");
  assert.deepEqual(Object.keys(plan.document.polities),["New polity"]);
  assert.deepEqual(plan.document.puppets,[]);
  assert.deepEqual(plan.document.relations,[]);
  assert.deepEqual(plan.document.units,[]);
  assert.deepEqual(plan.document.terrainAreas,[]);
  assert.deepEqual(plan.document.flags,{});
  assert.deepEqual(plan.document.features[0].tags,["city","capital"]);
  assert.equal(plan.regions.features[0].properties.id,"r1");
  assert.equal(plan.background.kind,"vector");
  assert.deepEqual(Object.keys(existing.polities),["Old"],"planning must not modify the previous document");
});
test("FMG plan refuses orphan owners, duplicate IDs, incomplete backgrounds, invalid city coordinates",()=>{
  const other=seed();other.regions.features[0].properties.owner="Ghost";
  assert.throws(()=>planGeneratedMapReplacement(other,{metadata:{name:"X"}}),/without a matching polity/);
  const dup=seed();dup.regions.features.push(structuredClone(dup.regions.features[0]));
  assert.throws(()=>planGeneratedMapReplacement(dup,{}),/duplicate region/);
  const noBackground=seed();noBackground.background={};
  assert.throws(()=>planGeneratedMapReplacement(noBackground,{}),/background are incomplete/);
  const badCity=seed();badCity.cities.features[0].geometry.coordinates=[NaN,5];
  assert.throws(()=>planGeneratedMapReplacement(badCity,{}),/invalid city/);
});
