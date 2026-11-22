import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  generatedWorldReplacementId,
  settleGeneratedWorldReplacement,
  assertGeneratedWorldScenarioSaveAllowed,
} from "./scenarioWorldReplacement.js";

const empty = JSON.parse(readFileSync(new URL("../../server/seed/default/world.json",import.meta.url),"utf8"));
const established = {
  ...empty,
  politicalActors:{schemaVersion:3,byPolity:{Belgium:{polityKey:"Belgium",government:{form:"Monarchy"}}}},
  relations:[{a:"Belgium",b:"Germany",score:10}],
  countryStats:{Belgium:{economy:{gdp:3}}},
  agreements:[{id:"old",parties:["Belgium"]}],
  institutions:{schemaVersion:3,byId:{old:{id:"old"}}},
  wars:[{id:"old-war"}],
  powerStatus:{schemaVersion:1,byPolity:{Belgium:{}}},
  prehistory:{version:1,events:[{id:"old-event"}]},
  scenarioFronts:[{id:"old-front"}],
  regionSovereigntyOverrides:{"old-region":"Belgium"},
  simulationRules:"Old 1912 narrative",
  startingTimelineText:"Old historic opening",
};
test("new generated-world intent persists in the working map and settlement respects a newer generation",()=>{
  const old={metadata:{name:"A",generatedWorldReplacementId:"gen-1"}};
  const next={metadata:{name:"B",generatedWorldReplacementId:"gen-2"}};
  assert.equal(generatedWorldReplacementId(old),"gen-1");
  assert.equal(generatedWorldReplacementId({}),"");
  const settled=settleGeneratedWorldReplacement(old,"gen-1");
  assert.equal(generatedWorldReplacementId(settled),"");
  // The native map-document update *merges* metadata. Omitting this key on
  // Save would leave the old marker persisted, even after React clears it.
  assert.equal(Object.hasOwn(settled.metadata,"generatedWorldReplacementId"),true);
  assert.equal(settled.metadata.generatedWorldReplacementId,null);
  assert.equal(settled.metadata.name,"A");
  assert.equal(generatedWorldReplacementId(settleGeneratedWorldReplacement(next,"gen-1")),"gen-2");
  assert.equal(generatedWorldReplacementId(old),"gen-1","Settlement must not mutate original");
});
test("new-world scenario Save refuses retained political/history owners rather than silently corrupting canon",()=>{
  assert.throws(()=>assertGeneratedWorldScenarioSaveAllowed(established,true),/cannot|incompatible|established/i);
  for(const [key,value] of [
    ["politicalActors",{schemaVersion:3,byPolity:{A:{polityKey:"A"}}}],
    ["relations",[{a:"A",b:"B",score:0}]],
    ["countryStats",{A:{}}],
    ["agreements",[{id:"old"}]],
    ["institutions",{byId:{old:{}}}],
    ["wars",[{id:"old"}]],
    ["powerStatus",{byPolity:{A:{}}}],
    ["prehistory",{events:[{id:"old"}]}],
    ["scenarioFronts",[{id:"old"}]],
    ["regionSovereigntyOverrides",{"reg-x":"A"}],
    ["simulationRules","Retain this rule"],
    ["startingTimelineText","Retain this era"],
  ]) {
    assert.throws(()=>assertGeneratedWorldScenarioSaveAllowed({...empty,[key]:value},true),/incompatible|established|cannot/i,key);
  }
});
test("ordinary map edits leave existing canonical state alone; fresh scenario generation is admissible",()=>{
  assert.doesNotThrow(()=>assertGeneratedWorldScenarioSaveAllowed(established,false));
  assert.doesNotThrow(()=>assertGeneratedWorldScenarioSaveAllowed(empty,true));
  assert.throws(()=>assertGeneratedWorldScenarioSaveAllowed(null,true),/unavailable|invalid/i);
});
test("explicit generated-world provenance reaches scenario Save and settles only on accepted write",()=>{
  const planner=readFileSync(new URL("./fmgReplacementPlan.js",import.meta.url),"utf8");
  const workshop=readFileSync(new URL("./MapEditor.jsx",import.meta.url),"utf8");
  const host=readFileSync(new URL("../Game/GameUI/libraryBar.jsx",import.meta.url),"utf8");
  assert.match(planner,/generatedWorldReplacementId:/,"Generator must stamp a new world, rather than infer from a blank map");
  assert.match(workshop,/generatedWorldReplacement:\s*Boolean\(generatedWorldReplacementId\(d\.doc\)\)/,"Scenario Save must explicitly carry replacement intent");
  assert.match(workshop,/settleGeneratedWorldReplacement\(/,"Only accepted Save may clear the pending intent");
  assert.match(workshop,/flushSync\(/,"Authoring settlement must commit before a fast Apply/Exit unmount");
  assert.match(workshop,/await saveNowRef\.current\(\)/,"Do not leave the accepted marker only in the working-map autosave debounce");
  assert.match(workshop,/beforePlay:\s*async\s*\(applied\)/,"Apply & Play must durably settle before game activation unmounts the Workshop");
  const playCallback=host.indexOf("await beforePlay?.(applied)");
  const gameActivation=host.indexOf("await playAppliedMap(scenario, scenarioId, seed, applied.scenarioCountry)");
  assert.ok(playCallback>0&&gameActivation>playCallback,"Apply must await the local settlement before unmounting");
  const guard=host.indexOf("assertGeneratedWorldScenarioSaveAllowed(currentWorld, seed.generatedWorldReplacement)");
  const save=host.indexOf("const savedScenarioDetails = await saveScenario(scenarioId");
  assert.ok(guard>0 && save>guard,"Canonical scenario guard must execute before any Save or asset write");
});
