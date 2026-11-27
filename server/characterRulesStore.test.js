/*! Open Historia - N036 contact permission portability. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createAdvisorContact,reviseAdvisorContact,advisorRecipientForReply,characterMayReadSimulationRules,ADVISOR_RECIPIENT_TYPES} from "../src/runtime/advisorThreads.js";
import {buildCharacterSystemPrompt} from "../src/Game/AI/characterConversations.js";

test("scenario rules permission survives desktop save/export/import, revocation and independent contacts",async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"oh-character-rules-"));
 process.env.OH_DATA_DIR=dir;
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=await import("./libraryStore.js");
 const id=store.createGame({id:"character-rules-qa",name:"Character Rules QA",setActive:true}).game.id;
 const ruler={id:"advisor-foreign-qa",name:"George V",title:"King",recipientType:ADVISOR_RECIPIENT_TYPES.FOREIGN_OFFICIAL};
 const citizen={id:"advisor-citizen-qa",name:"Arthur",title:"Shopkeeper",recipientType:ADVISOR_RECIPIENT_TYPES.CIVILIAN};
 let rows=createAdvisorContact([], {...ruler,canReadSimulationRules:true});
 rows=createAdvisorContact(rows,citizen);
 rows.push({id:"earlier-message",role:"advisor",threadId:ruler.id,text:"Earlier lore dialogue."});
 store.writeRuntimeJsonAsset("advisor",rows);
 const rules="QA-only authored lore.";
 const inspect=(saved,contact)=>buildCharacterSystemPrompt({recipient:advisorRecipientForReply(saved,contact.id,contact),simulationRules:rules});
 const clone=store.importGameBundle(JSON.parse(JSON.stringify(store.exportGameBundle(id)))).game.id;
 const imported=store.exportGameBundle(clone).data.advisor;
 assert.equal(inspect(imported,ruler).includes(rules),true);
 assert.equal(inspect(imported,{...citizen,canReadSimulationRules:true}).includes(rules),false);
 store.setActiveGame(id);
 rows=reviseAdvisorContact(store.readRuntimeJsonAsset("advisor").data,ruler.id,{...ruler,canReadSimulationRules:false});
 store.writeRuntimeJsonAsset("advisor",rows);
 const reloaded=store.readRuntimeJsonAsset("advisor").data;
 assert.equal(characterMayReadSimulationRules(reloaded[0]),false);
 assert.equal(inspect(reloaded,{...ruler,canReadSimulationRules:true}).includes(rules),false);
 assert.equal(reloaded.find(m=>m.id==="earlier-message").text,"Earlier lore dialogue.");
 assert.equal(inspect(store.exportGameBundle(clone).data.advisor,ruler).includes(rules),true);
});
