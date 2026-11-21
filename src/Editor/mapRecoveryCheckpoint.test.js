import test from "node:test";
import assert from "node:assert/strict";
import { createVerifiedMapRecovery, verifyRecoverySnapshot } from "./mapRecoveryCheckpoint.js";
const original = () => ({
  id:"active",
  metadata:{name:"1912 Test",kind:"import-world",customBackground:{kind:"plain"}},
  regions:{type:"FeatureCollection",features:[
    {type:"Feature",id:"reg_a",geometry:{type:"Polygon",coordinates:[[[0,0],[1,0],[1,1],[0,0]]]},properties:{owner:"A"}},
    {type:"Feature",id:"reg_b",geometry:{type:"Polygon",coordinates:[[[1,0],[2,0],[2,1],[1,0]]]},properties:{owner:"B"}},
  ]},
  features:[{id:"city_1",name:"Test"}],units:[{id:"unit_1"}],
  polities:{A:{name:"A"}},groups:{G:{name:"G"}},relationEdits:[],relations:[],
  types:[{id:"land"}],tags:{A:["historical"]},flags:{},colorOverrides:{},
  puppets:[],terrainAreas:[],fortifications:[],climateZones:[],freezingRegions:[],
  ownerSchema:4,
  actorGovernmentEdits:[{polity:"A",form:"Constitutional monarchy"}],
});
test("recovery rejects lost government intent or altered projection/background before replacement",async()=>{
  const before=original();
  before.metadata.projection={kind:"equirectangular",scale:3};
  for(const mutate of [
    (saved)=>{delete saved.actorGovernmentEdits;},
    (saved)=>{saved.actorGovernmentEdits[0].form="Republic";},
    (saved)=>{saved.metadata.projection.scale=8;},
    (saved)=>{delete saved.metadata.customBackground;},
  ]) {
    const damaged=structuredClone(before);
    mutate(damaged);
    assert.equal(verifyRecoverySnapshot(before,damaged),false);
    await assert.rejects(createVerifiedMapRecovery({
      payload:before,reason:"province import",save:async()=>({id:"checkpoint"}),load:async()=>damaged,
    }),/could not be verified/);
  }
});
test("recovery creates an independent persisted map and readback proves geometry and registries",async()=>{
  const before=original();
  let stored;
  const verified=await createVerifiedMapRecovery({
    payload:before,reason:"province import",now:"2026-11-21T10:11:12Z",
    save:async(id,data)=>{assert.equal(id,null);stored=structuredClone(data);return {id:"checkpoint_1"};},
    load:async(id)=>{assert.equal(id,"checkpoint_1");return structuredClone({...stored,id});},
  });
  assert.equal(verified.id,"checkpoint_1");
  assert.equal(verified.regions,2);
  assert.match(verified.name,/before province import/);
  assert.equal(before.id,"active");
  assert.equal(before.metadata.name,"1912 Test");
  assert.equal(stored.id,null);
});
test("recovery refuses missing, truncated or altered data before any map replacement",async()=>{
  const before=original();
  assert.equal(verifyRecoverySnapshot(before,{...before,regions:{type:"FeatureCollection",features:[]}}),false);
  const altered=structuredClone(before);
  altered.regions.features[0].geometry.coordinates[0][1][0]=99;
  assert.equal(verifyRecoverySnapshot(before,altered),false);
  const dropped=structuredClone(before);
  dropped.units=[];
  assert.equal(verifyRecoverySnapshot(before,dropped),false);
  const missing=structuredClone(before);
  delete missing.tags;
  assert.equal(verifyRecoverySnapshot(before,missing),false);
  await assert.rejects(createVerifiedMapRecovery({
    payload:before,reason:"generation",
    save:async()=>({id:"snapshot"}),
    load:async()=>altered,
  }),/could not be verified/);
  await assert.rejects(createVerifiedMapRecovery({
    payload:before,reason:"generation",save:async()=>({}),load:async()=>before,
  }),/not acknowledged/);
  await assert.rejects(createVerifiedMapRecovery({
    payload:{...before,regions:null},reason:"import",save:async()=>({id:"x"}),load:async()=>before,
  }),/complete recoverable/);
});
