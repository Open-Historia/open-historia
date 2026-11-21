/*! Open Historia - N034 desktop-store read-only export regression. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeEvents } from "../src/runtime/gameState.js";
import { captureCampaignLore } from "../src/runtime/campaignLoreRead.js";
import { campaignLoreMarkdown } from "../src/runtime/campaignLore.js";
import { planCampaignChronicle,generateCampaignChronicle } from "../src/Game/AI/campaignChronicle.js";

test("N034 exports earlier committed history and accepted scene transcript without changing desktop campaign data",async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"oh-lore-"));
 process.env.OH_DATA_DIR=dir;
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=await import("./libraryStore.js");
 const gameId=store.createGame({id:"lore-qa",name:"Lore QA",setActive:true}).game.id;
 const source={id:"old",kind:"world",date:"1912-01-01",title:"Old meeting",description:"An envoy visits."};
 const transcript={version:1,sourceEventId:"old",startedOn:"1912-02-01",title:"A letter",premise:"Meeting",firstOpening:"The envoy enters.",request:"Listen",endedBy:"scene",beats:[{choice:"Ask",summary:"The envoy replies.",before:"The envoy enters.",offered:["Ask","Leave"]}]};
 const outcome={id:"new",kind:"interactive",date:"1912-02-01",title:"Meeting ends",interactiveTranscript:transcript};
 store.writeRuntimeTurnState({actions:[],chat:[],colors:{},events:normalizeEvents([source,outcome]),game:{country:"Germany",round:15,gameDate:"1912-02-01",startDate:"1912-01-01"},world:{ownerSchema:4,customRegions:true,simulationHistory:[{mode:"jump",round:15,fromDate:"1912-01-31",toDate:"1912-02-01",eventIds:["new"]}]}});
 const keys=["game","world","events","actions","chat"];
 const before=JSON.stringify(keys.map(key=>store.readRuntimeJsonAsset(key).data));
 const reads=[];
 const lore=await captureCampaignLore({transcripts:true},{
  library:()=>({activeGameId:gameId,activeGame:{id:gameId,name:"Lore QA"}}),
  endpoints:Object.fromEntries(keys.map(key=>[key,key])),read:async key=>{reads.push(key);return store.readRuntimeJsonAsset(key).data;},
  unseen:()=>new Set(),shared:()=>false,busy:()=>false,target:new EventTarget(),
 });
 assert.deepEqual(reads,["game","world","events","game"]);
 assert.deepEqual(lore.events.map(e=>e.id),["old","new"]);
 assert.deepEqual(lore.events[1].interactiveTranscript,transcript);
 const md=campaignLoreMarkdown(lore);assert.match(md,/An envoy visits/);assert.match(md,/The envoy replies/);
 const plan=planCampaignChronicle(lore);
 await generateCampaignChronicle(plan,{call:async()=>({toolInput:{sections:[{title:"Meeting",text:"The envoy visits.",references:["E1","E2"]}]}})});
 assert.equal(JSON.stringify(keys.map(key=>store.readRuntimeJsonAsset(key).data)),before);
});
