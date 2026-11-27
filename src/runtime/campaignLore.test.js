/*! Open Historia - N034 native lore projection regressions. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import { buildCampaignLore, campaignLoreMarkdown, campaignLoreFileName } from "./campaignLore.js";

const archive={version:1,sourceEventId:"early",startedOn:"1912-01-31",title:"Council",premise:"Negotiations",firstOpening:"A letter arrives.",request:"Read the letter.",endedBy:"player",beats:[{choice:"Read it.",summary:"The envoy answers.",before:"A letter arrives.",offered:["Read it.","Wait."]}]};
const fixture=()=>({
  metadata:{name:"Germany / 1912",scenario:"The Great War",apiKey:"metadata-secret"},
  game:{country:"Germany",startDate:"1912-01-01",gameDate:"1912-02-01",round:14,apiKey:"game-secret"},
  events:[
    {id:"late",date:"1912-02-01",title:"Late event",description:"Latest recorded event.",impacts:{secret:"impact-secret"},npcReaction:{secret:"npc-secret"}},
    {id:"early",date:"1912-01-02",title:"Early event",description:"Earlier words exactly.",concerns:["Germany"]},
    {id:"outcome",date:"1912-01-31",title:"Council ends",kind:"interactive",description:"Agreed.",interactiveTranscript:archive,playerRelated:true},
    {id:"private",date:"1912-01-12",title:"private-event-secret",audience:["France"]},
    {id:"spy",date:"1912-01-14",title:"spy-secret",source:"espionage"},
    {id:"old-scene",date:"1912-01-15",title:"Old scene",kind:"interactive"},
    {title:"Old undated record",description:"Only the text survives."},
  ],
  actions:[{id:"own",title:"Orders",text:"Make a speech",status:"planned"},{id:"other",ownerCode:"France",text:"other-order-secret"},{id:"done",text:"Negotiate",status:"resolved",resolvedRound:4}],
  chats:[{id:"my-thread",title:"Paris",countries:[{code:"France",name:"France",token:"country-secret"}],messages:[{id:"reply",role:"assistant",speaker:"President",text:"We agree in principle.",time:"1912-01-10",memorySummary:"memory-secret"},{id:"hidden-reply",eventId:"private",text:"hidden-message-secret",time:"1912-01-12"}]},
    {id:"foreign",player:"France",messages:[{text:"foreign-chat-secret"}]}, {id:"retired",retiredFor:["Germany"],messages:[{text:"retired-secret"}]}],
  advisor:[{role:"advisor",id:"reply-a",text:"Try a compromise.",time:"1912-01-15",memory:"advisor-memory-secret"},{role:"advisor-seats",seats:{France:[{text:"seat-secret"}]}},{role:"user",text:"partial-secret",streaming:true},{role:"error",text:"provider-error-secret"}],
  world:{simulationHistory:[{eventIds:["late"]}],historyDocument:{text:"fold-secret"},spy:{code:"spy-state-secret"},activeInteractive:{opening:"unfinished-secret"},
   wars:[{id:"war",title:"War",status:"active",sideA:["Germany"],sideB:["France"],sourceEventIds:["private","early"],note:"war-note-secret"}],
   projects:[{id:"p",ownerCode:"Germany",name:"Railways",secrecy:"public",progress:0,plan:{secret:"project-plan-secret"}},{id:"foreign-p",ownerCode:"France",name:"foreign-project-secret",secrecy:"secret"},{id:"private-p",ownerCode:"Germany",name:"Private programme",secrecy:"secret"}],
   countryStats:{Germany:{economy:{gdp:100,gdpGrowth:0},population:{total:1000},technical:{secret:"stat-secret"}},France:{economy:{gdp:999}}},
   playerGoals:{Germany:{text:"Peace",date:"1912-01-01"}},
  },
});
test("N034: export all retained public events chronologically, independent of recent-turn index, without writing input",()=>{
  const input=fixture(),before=JSON.stringify(input);
  const lore=buildCampaignLore(input);
  assert.deepEqual(lore.events.map(e=>e.id),["early","old-scene","outcome","late",undefined]);
  assert.equal(lore.coverage.undatedEvents,1);
  assert.equal(lore.events[2].transcriptStatus,"excluded");
  assert.equal(lore.events[1].transcriptStatus,"unavailable");
  assert.deepEqual(lore.actions,[]);
  assert.deepEqual(lore.diplomacy,[]);
  assert.deepEqual(lore.advisor,[]);
  assert.equal(lore.snapshot.projects.length,1);
  assert.equal(lore.snapshot.playerMetrics.economy.gdpGrowth,0);
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(buildCampaignLore(input),lore);
  assert.doesNotMatch(JSON.stringify(lore),/[a-z-]+-secret|unfinished-secret/);
});
test("N034: opt-in private material keeps only own retained conversations and native accepted moves",()=>{
  const lore=buildCampaignLore(fixture(),{actions:true,conversations:true,transcripts:true});
  assert.deepEqual(lore.actions.map(a=>a.id),["own","done"]);
  assert.equal(lore.actions[1].resolvedRound,4);
  assert.equal(lore.diplomacy.length,1);
  assert.equal(lore.diplomacy[0].messages.length,1);
  assert.equal(lore.advisor.length,1);
  assert.deepEqual(lore.events.find(e=>e.id==="outcome").interactiveTranscript,archive);
  assert.equal(lore.snapshot.projects.length,2);
  assert.deepEqual(lore.snapshot.wars[0].sourceEventIds,["early"]);
  assert.equal(lore.snapshot.standingGoal.text,"Peace");
  assert.doesNotMatch(JSON.stringify(lore),/[a-z-]+-secret|unfinished-secret/);
  const text=campaignLoreMarkdown(lore);
  assert.match(text,/Earlier words exactly\./);
  assert.match(text,/Accepted choice\n\n~~~|Accepted choice\n\n```/);
  assert.match(text,/Read it\./);
  assert.match(text,/We agree in principle\./);
  assert.doesNotMatch(text,/[a-z-]+-secret|unfinished-secret/);
  assert.equal(campaignLoreFileName(lore),"Germany-1912-lore-1912-02-01.md");
});
test("N034: transcript attached to a hidden source is not exported even when requested",()=>{
  const input=fixture();input.events.find(e=>e.id==="outcome").interactiveTranscript={...archive,sourceEventId:"private"};
  const lore=buildCampaignLore(input,{transcripts:true});
  const event=lore.events.find(e=>e.id==="outcome");
  assert.equal(event.transcriptStatus,"excluded");
  assert.equal("interactiveTranscript" in event,false);
});
test("N034: selection is exact and calendar-aware, including BC and equal dates",()=>{
  const input={game:{country:"Rome",gameDate:"0001-01-01"},events:[{id:"b",date:"-0218-02-01",concerns:["Rome"]},{id:"a",date:"-0300-02-01",playerRelated:true},{id:"c",date:"-0218-02-01",title:"Rome in prose only"},{id:"d",date:"-0218-02-01",combatants:["Rome"]}]};
  assert.deepEqual(buildCampaignLore(input).events.map(e=>e.id),["a","b","c","d"]);
  assert.deepEqual(buildCampaignLore(input,{scope:"player",from:"-0218-01-01",to:"-0218-12-31"}).events.map(e=>e.id),["b","d"]);
  assert.throws(()=>buildCampaignLore(input,{from:"2026-01-01",to:"1912-01-01"}),/valid campaign date range/);
  assert.throws(()=>buildCampaignLore(input,{to:"0002-01-01"}),/recorded campaign date/);
});
test("N034: old wrapped ledgers and long exports preserve available records and escape Markdown structure",()=>{
  const tick="`".repeat(4);
  const lore=buildCampaignLore({game:{country:"Rome",gameDate:"1912-01-01"},events:{events:["Legacy event",{headline:"<script> # heading",summary:"First\n"+tick+"\nLast",date:"1912-01-01"},...Array.from({length:1000},(_,i)=>({id:"e"+i,date:"1912-01-01",title:"Event "+i}))]}});
  assert.equal(lore.events.length,1002);
  assert.equal(lore.events.at(-1).title,"Legacy event");
  assert.equal(lore.events.at(-1).id,undefined);
  const md=campaignLoreMarkdown(lore);
  assert.match(md,/Event 999/);
  assert.ok(md.includes("\\<script\\>"));
  assert.ok(md.includes(tick+"`text\nFirst\n"+tick+"\nLast"));
  assert.equal(buildCampaignLore({game:{}}).events.length,0);
});
