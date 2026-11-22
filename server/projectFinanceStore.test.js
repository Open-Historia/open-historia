/*! Open Historia - finance desktop persistence, portability and restore regression. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {normalizeWorldState,normalizeEvents,advanceProjectsInWorld} from "../src/runtime/gameState.js";
import {bookProjectFinance,financeReviewStamp,financeSourceText} from "../src/runtime/projectFinanceWorld.js";
import {projectFinanceSnapshot} from "../src/runtime/projectFinance.js";

test("N010 native finance settlement travels atomically with the accepted board and export/import generation",async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"oh-finance-"));
 process.env.OH_DATA_DIR=dir;t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=await import("./libraryStore.js");
 const gameId=store.createGame({id:"finance-qa",name:"Synthetic Finance QA",setActive:true}).game.id;
 const owner="Germany",lender="France",game={country:owner,startDate:"1912-01-01",gameDate:"1912-02-15",round:9};
 const events=normalizeEvents([{id:"signed",kind:"economy",date:"1912-02-15",title:"Synthetic loan signed and paid",description:"France agrees and pays 1 million USD for railway work.",playerRelated:true}]);
 const world=normalizeWorldState({ownerSchema:4,customRegions:true,polityOverrides:{France:{code:lender,name:lender}},countryStats:{Germany:{economy:{gdp:1e9,publicDebt:40,budgetBalance:0},stability:50}},
 projects:[{id:"rail",name:"Rail",ownerCode:owner,status:"active",funding:"normal",plan:{durationDays:100,monthlyCost:3e6},spent:0,progress:0}]});
 const base={actions:[],chat:[],colors:{},events,game,world};store.writeRuntimeTurnState(base);
 const make=(w,fields)=>bookProjectFinance({world:w,game,events,expected:financeReviewStamp(w,game),command:{...fields,sourceId:"signed",expectedSource:financeSourceText(events[0]),confirmed:true}});
 const signed=make(world,{type:"authorize",lenderId:lender,projectIds:["rail"],currency:"USD",minorDigits:2,originalLimitMinor:100_000_000,limitMinor:100_000_000,equivalenceBasis:"Synthetic approved equivalence",annualRateBps:400,maturity:"1914-02-15"});
 const funded=make(signed,{type:"draw",facilityId:signed.projectFinance.receipts[0].facilityId,projectId:"rail",supplierId:null,originalMinor:100_000_000,amountMinor:100_000_000,debtTreatment:"additional"});
 store.writeRuntimeTurnState({...base,world:funded});
 const read=normalizeWorldState(store.readRuntimeJsonAsset("world").data);
 assert.deepEqual(read.projectFinance,funded.projectFinance);
 const tick=advanceProjectsInWorld({baseWorld:read,world:read,host:owner,fromDate:game.gameDate,toDate:"1912-02-22",round:10});
 const accepted={...base,game:{...game,gameDate:"1912-02-22",round:10},world:tick.world};
 store.writeRuntimeTurnState(accepted);
 const saved=normalizeWorldState(store.readRuntimeJsonAsset("world").data);
 assert.equal(projectFinanceSnapshot(saved.projectFinance,"1912-02-22")[0].costAppliedMinor,70_000_000);
 assert.equal(saved.projects[0].spent,700_000);
 const exported=store.exportGameBundle(gameId),imported=store.importGameBundle(JSON.parse(JSON.stringify(exported))).game.id;
 const importedWorld=normalizeWorldState(store.exportGameBundle(imported).data.world);
 assert.deepEqual(importedWorld.projectFinance,saved.projectFinance);
 assert.deepEqual(importedWorld.projectFinanceDebt,saved.projectFinanceDebt);
 store.setActiveGame(gameId);store.writeRuntimeTurnState({...base,world:funded});
 assert.deepEqual(store.readRuntimeJsonAsset("world").data.projectFinance,funded.projectFinance);
 assert.equal(store.readRuntimeJsonAsset("world").data.projects[0].spent,0);
 store.writeRuntimeTurnState(base);
 assert.equal("projectFinance" in store.readRuntimeJsonAsset("world").data,false);
 assert.deepEqual(store.exportGameBundle(imported).data.world.projectFinance,saved.projectFinance);
});
