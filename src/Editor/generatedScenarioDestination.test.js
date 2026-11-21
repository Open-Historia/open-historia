import test from "node:test";
import assert from "node:assert/strict";
import { createFreshScenarioFromGeneratedMap, validateGeneratedScenarioDestination } from "./generatedScenarioDestination.js";

const generated = {
  generatedWorldReplacement: true,
  regions: { type:"FeatureCollection", features:[{type:"Feature",id:"r1",geometry:{type:"Polygon",coordinates:[]},properties:{owner:"A"}}] },
  world:{polityOverrides:{A:{name:"A"}},regionOwnershipOverrides:{r1:"A"}},
};
test("a generated world needs a bounded distinct name and real source provenance",()=>{
  assert.equal(validateGeneratedScenarioDestination(generated,"  A New World  "),"A New World");
  for(const name of ["", "  ", "A", "x".repeat(121), "A\nDifferent World"]) {
    assert.throws(()=>validateGeneratedScenarioDestination(generated,name),/name|characters|line/i,name);
  }
  for(const seed of [{...generated,generatedWorldReplacement:false},{...generated,regions:{features:[]}},{...generated,world:{polityOverrides:{}}}]) {
    assert.throws(()=>validateGeneratedScenarioDestination(seed,"New World"),/generated|regions|polities/i);
  }
  assert.throws(()=>validateGeneratedScenarioDestination({
    ...generated,world:{...generated.world,regionOwnershipOverrides:{r1:"HistoricPolity"}},
  },"New World"),/owner|polity|reference/i,"Do not publish a generated region owned by an unknown historical polity");
  assert.throws(()=>validateGeneratedScenarioDestination({
    ...generated,world:{...generated.world,regionOwnershipOverrides:{missingRegion:"A"}},
  },"New World"),/region|reference/i,"Do not publish ownership of a non-existent generated region");
});
test("destination creates a fresh-canon scenario (never cloning the historical source) and publishes before navigating",async()=>{
  const steps=[];
  const result=await createFreshScenarioFromGeneratedMap({
    seed:generated,
    name:" New World ",
    createScenario:async (options)=>{steps.push(["create",options]);return {scenario:{id:"new-world",name:options.name}};},
    saveMap:async (id,seed)=>{steps.push(["save",id,seed]);return {politicalActors:{byPolity:{}},scenarioCountry:"A"};},
    settleSource:async(applied)=>{steps.push(["settle",applied]);},
    openScenarioEditor:async(id)=>{steps.push(["open",id]);},
  });
  assert.equal(result.scenarioId,"new-world");
  assert.deepEqual(steps.map(([step])=>step),["create","save","settle","open"]);
  assert.deepEqual(steps[0][1],{name:"New World",setActive:false});
  assert.equal(steps[1][1],"new-world");
  assert.equal(steps[1][2],generated);
  assert.deepEqual(result.politicalActors,{byPolity:{}});
});
test("a missing settlement or malformed input fails before scenario creation",async()=>{
  let calls=0;
  await assert.rejects(createFreshScenarioFromGeneratedMap({
    seed:generated,name:"New World",createScenario:async()=>{calls++;return {scenario:{id:"x"}};},
    saveMap:async()=>{},openScenarioEditor:async()=>{},
  }),/settlement|callback|required/i);
  assert.equal(calls,0);
});
test("failed publishing preserves source, never opens editor and reports the created scenario id",async()=>{
  const steps=[];
  const source=structuredClone(generated);
  await assert.rejects(createFreshScenarioFromGeneratedMap({
    seed:generated,name:"New World",
    createScenario:async opts=>{steps.push("create");return {scenario:{id:"new-world",name:opts.name}};},
    saveMap:async()=>{steps.push("save");throw new Error("disk full");},
    settleSource:async()=>steps.push("settle"),
    openScenarioEditor:async()=>steps.push("open"),
  }),/new-world.*disk full|disk full.*new-world/i);
  assert.deepEqual(steps,["create","save"]);
  assert.deepEqual(generated,source);
});
test("a failed local settlement after successful publication must not navigate or report an untouched destination",async()=>{
  const steps=[];
  await assert.rejects(createFreshScenarioFromGeneratedMap({
    seed:generated,name:"New World",
    createScenario:async()=>({scenario:{id:"new-world"}}),
    saveMap:async()=>{steps.push("save");return {scenarioCountry:"A"};},
    settleSource:async()=>{steps.push("settle");throw new Error("local map write failed");},
    openScenarioEditor:async()=>steps.push("open"),
  }),/new-world.*local map write failed|local map write failed.*new-world/i);
  assert.deepEqual(steps,["save","settle"]);
});
