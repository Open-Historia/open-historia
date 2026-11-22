import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_SEMANTIC_DAY_ONE_FACTS, normalizeScenarioPrehistory, prehistoryPayload } from "../src/runtime/scenarioPrehistory.js";
import { dayOneEditorProblems } from "../src/runtime/scenarioPrehistoryDayOne.js";
import { PREGAME_BOOTSTRAP_CONTRACT_VERSION, compilePregameBootstrapCandidate, validatePregameBootstrapCandidateShape } from "../src/Game/AI/pregameBootstrapCompiler.js";
import { PREGAME_HISTORY_SCHEMA, decodePregameHistoryTransportPayload, normalizeGameplayPayload, validateGameplayPayload } from "../src/Game/AI/gameplaySchemas.js";
import { normalizeWorldState } from "../src/runtime/gameState.js";

const START="1930-01-01";
const names=Array.from({length:24},(_,i)=>"Polity "+(i+1));
const allPairs=names.flatMap((a,i)=>names.slice(i+1).map(b=>({a,b})));
const facts=allPairs.slice(0,MAX_SEMANTIC_DAY_ONE_FACTS).map(({a,b},i)=>({ref:"f"+(i+1),kind:"relation",a,b,score:(i%201)-100,summary:"Authored relation "+(i+1),sourceEventRefs:["e1"]}));
const world={ownerCodes:names,polityOverrides:Object.fromEntries(names.map(name=>[name,{name,status:"active"}])),relations:[],agreements:[],wars:[],storylines:[],puppets:[]};
const events=[{id:"prehistory-cap-event",ref:"e1",date:"1929-01-01",title:"Diplomatic groundwork",description:"Relations established before the scenario opens."}];
const record=normalizeScenarioPrehistory({events,updates:{canonicalUpdates:facts}});
const candidate=rows=>({contractVersion:PREGAME_BOOTSTRAP_CONTRACT_VERSION,facts:rows});
const compile=(rows,base=world)=>compilePregameBootstrapCandidate({candidate:candidate(rows),world:base,startDate:START,eventIdsByRef:new Map([["e1",events[0].id]])});

test("Day-one expansion preserves the full 256 facts in draft, normalized record, provider transport, payload and compiler",()=>{
 assert.equal(MAX_SEMANTIC_DAY_ONE_FACTS,256);
 assert.equal(PREGAME_HISTORY_SCHEMA.properties.canonicalUpdates.maxItems,MAX_SEMANTIC_DAY_ONE_FACTS);
 assert.deepEqual(record.updates.canonicalUpdates,facts);
 assert.deepEqual(normalizeScenarioPrehistory(record,{draft:true}).updates.canonicalUpdates,facts);
 assert.deepEqual(prehistoryPayload(record,{startDate:START}).canonicalUpdates,facts);
 const decoded=decodePregameHistoryTransportPayload({eventsJson:JSON.stringify(events.map(({id,...e})=>e)),summary:"Diplomatic groundwork.",canonicalUpdatesJson:JSON.stringify(facts)});
 assert.equal(decoded.error,"");
 const payload=normalizeGameplayPayload("pregameHistory",decoded.payload);
 assert.equal(validateGameplayPayload("pregameHistory",payload).valid,true);
 assert.deepEqual(payload.canonicalUpdates,facts);
 assert.deepEqual(dayOneEditorProblems(record,{startDate:START,world,verifyWorld:true}),[]);
 const result=compile(facts);
 assert.equal(result.ok,true,result.error);
 assert.equal(result.receipt.facts.length,facts.length);
 assert.equal(result.projectedWorld.relations.length,256);
 const last=result.projectedWorld.relations.find(r=>r.summary===facts.at(-1).summary);
 assert.ok(last,"last fact is not truncated at either old cap");
 assert.equal(last.score,facts.at(-1).score);
 const restored=normalizeWorldState(JSON.parse(JSON.stringify(result.projectedWorld)));
 assert.deepEqual(restored.relations,result.projectedWorld.relations);
 const overflow=[...facts,{ref:"overflow",kind:"relation",...allPairs[256],score:0}];
 assert.match(validatePregameBootstrapCandidateShape(candidate(overflow)),/at most 256/);
 const invalid={...payload,canonicalUpdates:overflow};
 assert.equal(validateGameplayPayload("pregameHistory",invalid).valid,false);
 const baseline={...world,relations:[{id:"existing",...allPairs[256],score:1,summary:"Existing authority"}]};
 const crowded=compile(facts,baseline);
 assert.equal(crowded.ok,false,"canonical ledger capacity must not silently evict an existing pair");
 assert.match(crowded.error,/evict|lost|capacity|limit/i);
});

test("Day-one 256-fact scenario roundtrip and fresh-game seed preserve all authored references",async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"oh-day-one-capacity-"));
 process.env.OH_DATA_DIR=dir;
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=await import("./libraryStore.js");
 const id=store.createScenario({id:"day-one-capacity",name:"Day One Capacity QA"}).scenario.id;
 store.updateScenario(id,{world:{...world,customRegions:true,prehistory:record}});
 const exported=store.exportScenarioBundle(id);
 const importedId=store.importScenarioBundle(JSON.parse(JSON.stringify(exported))).scenario.id;
 const imported=store.getScenarioDetails(importedId).data.world;
 const game=store.createGame({id:"day-one-capacity-game",name:"Day One Capacity Game",scenarioId:importedId});
 const seeded=store.getGameDetails(game.game.id).data.world;
 for(const base of [imported,seeded]){
   const payload=prehistoryPayload(base.prehistory,{startDate:START});
   assert.deepEqual(payload.canonicalUpdates,facts);
   const result=compile(payload.canonicalUpdates,base);
   assert.equal(result.ok,true,result.error);
   assert.equal(result.receipt.facts.length,256);
   assert.equal(result.projectedWorld.relations.length,256);
 }
});
