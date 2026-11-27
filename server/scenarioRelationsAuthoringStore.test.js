import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {planReviewedStartingRelationEdit,applyStartingRelationEdits} from "../src/Editor/scenarioStartingRelations.js";
import {normalizeWorldState} from "../src/runtime/gameState.js";
test("N022 scenario manager and Map Editor share one persisted relation ledger across export/import and fresh games",async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"oh-scenario-relations-"));
 process.env.OH_DATA_DIR=dir;
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=await import("./libraryStore.js");
 const id=store.createScenario({id:"relation-qa",name:"Relation QA"}).scenario.id;
 const choices=["Latvia","Estonia","Lithuania"].map(key=>({key}));
 const world={customRegions:true,ownerCodes:choices.map(c=>c.key),polityOverrides:Object.fromEntries(choices.map(c=>[c.key,{name:c.key,status:"active"}])),relations:[{id:"existing",a:"Latvia",b:"Estonia",score:5,summary:"Old"},{id:"unrelated",a:"Lithuania",b:"Estonia",score:20,summary:"Keep this"}],agreements:[{id:"trade",title:"Trade",parties:["Latvia","Lithuania"],type:"trade_economic",status:"active"}]};
 const initial=store.updateScenario(id,{world}).data.world;
 const existing=initial.relations.find(r=>r.id==="existing");
 const edit=planReviewedStartingRelationEdit(initial.relations,{a:"Latvia",b:"Estonia",score:0,summary:"Commercial ties despite political differences."},existing,choices);
 assert.equal(edit.ok,true);
 const saved=store.updateScenario(id,{worldPatch:{relations:edit.relations}}).data.world;
 assert.deepEqual(saved.agreements,initial.agreements);
 assert.deepEqual(saved.relations.find(r=>r.id==="unrelated"),initial.relations.find(r=>r.id==="unrelated"));
 const map=applyStartingRelationEdits(saved.relations,[{a:"Estonia",b:"Latvia",score:-30}],choices);
 assert.equal(map.ok,true);
 store.updateScenario(id,{worldPatch:{relations:map.relations}});
 const clone=store.importScenarioBundle(JSON.parse(JSON.stringify(store.exportScenarioBundle(id)))).scenario.id;
 const imported=store.getScenarioDetails(clone).data.world;
 const game=store.createGame({id:"relation-game",name:"Relation Game",scenarioId:clone});
 const started=normalizeWorldState(store.getGameDetails(game.game.id).data.world);
 for(const w of [imported,started]){
   const row=w.relations.find(r=>r.id==="existing");
   assert.equal(row.summary,"Commercial ties despite political differences.");
   assert.equal(row.score,-30);
   assert.equal(w.relations.length,2);
 }
 assert.equal(initial.relations.find(r=>r.id==="existing").summary,"Old");
});
