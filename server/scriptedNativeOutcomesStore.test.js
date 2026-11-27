/*! Open Historia - N031 authored outcome portability. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeWorldState, normalizeEvents, applyEventImpactsToWorld } from "../src/runtime/gameState.js";
import { normalizeScriptedEvents } from "./gameFeatures.js";
import { capitalCityId } from "../src/runtime/capitalSeats.js";
import { buildLookupContext } from "../src/Game/AI/lookupTools.js";
import { prepareNativeScriptedOutcomes, bindNativeScriptedOutcomes, verifyNativeScriptedRecords, verifyNativeScriptedOutcomes } from "../src/Game/AI/scriptedNativeOutcomes.js";
import { applyNativeCapitalOutcomes } from "../src/Game/AI/scriptedCapitalRelocation.js";
import { applyWarUpdates, settleWarLedger } from "../src/Game/AI/nativeWarLedger.js";
import { applyDiplomaticUpdates } from "../src/Game/AI/nativeDiplomaticDirector.js";
import { ensureScriptedEventsWithImpacts } from "../src/Game/AI/scriptedEventImpacts.js";
import { giveSegmentEventIds } from "../src/Game/AI/ledgerPins.js";
import { planScriptedEvents, commitScriptedEventPlan } from "../src/Game/AI/scriptedEventResolution.js";

test("N031 native outcomes and receipts survive atomic desktop commit, export/import and restoration",async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"oh-scripted-outcomes-"));
 process.env.OH_DATA_DIR=dir;
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=await import("./libraryStore.js");
 const gameId=store.createGame({id:"scripted-outcomes-qa",name:"Scripted Outcomes QA",setActive:true}).game.id;
 const date="1914-03-21";
 const world=normalizeWorldState({customRegions:true,customCities:true,ownerCodes:["Germany","Denmark","France","Belgium"],polityOverrides:Object.fromEntries(["Germany","Denmark","France","Belgium"].map(name=>[name,{code:name,name,status:"active"}])),regionOwnershipOverrides:{berlin:"Germany",munich:"Germany",den:"Denmark",fra:"France",bel:"Belgium"},countryStats:{Germany:{capital:"Berlin",government:"Empire"}}});
 const base={actions:[],chat:[],colors:{},events:[],game:{country:"Germany",round:1,gameDate:"1914-03-20",scriptedEventState:{}},world};
 store.writeRuntimeTurnState(base);
 const coords=[[13,52],[11,48],[12,55],[2,48],[4,50]];
 const catalog=Object.entries(world.regionOwnershipOverrides).map(([id,country],i)=>{const [x,y]=coords[i];return {id,country,geometry:{type:"Polygon",coordinates:[[[x-.4,y-.4],[x+.4,y-.4],[x+.4,y+.4],[x-.4,y+.4],[x-.4,y-.4]]]}}});
 const context=buildLookupContext({world,regions:catalog,cities:[{name:"Berlin",coordinates:coords[0],capital:"primary"},{name:"Munich",coordinates:coords[1]}]});
 const beats=normalizeScriptedEvents([
  {id:"war",date,text:"War declared.",impactRows:[{type:"start_war",actor:"Germany",opponent:"Denmark"}]},
  {id:"puppet",date,text:"Protectorate established.",impactRows:[{type:"install_puppet",overlord:"France",polity:"Belgium",kind:"protectorate",loyalty:"45",secrecy:"open"}]},
  {id:"capital",date,text:"Capital relocated.",impactRows:[{type:"relocate_capital",polity:"Germany",cityId:capitalCityId("Munich",coords[1]),cityName:"Munich"}]},
 ]);
 const plan=planScriptedEvents(beats,{world,playerPolities:["Germany"]});
 const req=prepareNativeScriptedOutcomes(plan.eligible,world,{regionCatalog:catalog,cityContext:context});
 const candidate={events:ensureScriptedEventsWithImpacts([],plan.eligible).events};
 giveSegmentEventIds(candidate.events);
 const bound=bindNativeScriptedOutcomes(candidate,plan.eligible,req,world);
 settleWarLedger(candidate,{world});
 verifyNativeScriptedRecords(bound,candidate,world);
 const events=normalizeEvents(candidate.events);
 const impacted=applyEventImpactsToWorld({world,events,colors:{},regionCatalog:catalog}).world;
 const capital=applyNativeCapitalOutcomes(bound,impacted);
 const war=applyWarUpdates({world:capital,events,updates:candidate.warUpdates,stopDate:date,round:2}).world;
 const next=applyDiplomaticUpdates({world:war,events,puppetUpdates:candidate.puppetUpdates,stopDate:date,round:2,regionCatalog:catalog}).world;
 const receipts=commitScriptedEventPlan({},plan,{throughDate:date}).state;
 verifyNativeScriptedOutcomes(bound,next,events);
 store.writeRuntimeTurnState({...base,events,game:{...base.game,round:2,gameDate:date,scriptedEventState:receipts},world:next});
 const exported=store.exportGameBundle(gameId);
 const imported=store.importGameBundle(JSON.parse(JSON.stringify(exported))).game.id;
 const check=data=>{
  verifyNativeScriptedOutcomes(bound,normalizeWorldState(data.world),normalizeEvents(data.events));
  assert.equal(Object.keys(data.game.scriptedEventState).length,3);
  assert.equal(planScriptedEvents(beats,{world:data.world,resolvedState:data.game.scriptedEventState}).eligible.length,0);
 };
 check(exported.data);
 check(store.exportGameBundle(imported).data);
 store.setActiveGame(gameId);
 store.writeRuntimeTurnState(base);
 const restored=store.exportGameBundle(gameId).data;
 assert.equal(restored.world.countryStats.Germany.capital,"Berlin");
 assert.equal(restored.world.wars.length,0);
 assert.equal(restored.world.puppets.length,0);
 assert.deepEqual(restored.game.scriptedEventState,{});
 check(store.exportGameBundle(imported).data);
});
