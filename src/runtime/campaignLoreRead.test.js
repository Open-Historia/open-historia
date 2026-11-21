/*! Open Historia - N034 native read-path and stale-campaign regressions. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import { captureCampaignLore } from "./campaignLoreRead.js";
import { readFileSync } from "node:fs";

const fixture=()=>{
  let state={activeGameId:"game-a",activeGame:{id:"game-a",name:"Example"},runtimeScenario:{name:"Test scenario"}};
  let shared=false,busy=false,unseen=new Set();
  const target=new EventTarget();
  const endpoints={game:"a/game",world:"a/world",events:"a/events",actions:"a/actions",chat:"a/chat",advisor:"a/advisor",prompts:"a/prompts"};
  const data={"a/game":{country:"Germany",gameDate:"1912-01-31",startDate:"1912-01-01",round:2},"a/events":[{id:"one",date:"1912-01-02",title:"First"}],"a/world":{simulationHistory:[]},"a/actions":[],"a/chat":[],"a/advisor":[]};
  const reads=[];
  const deps={library:()=>state,shared:()=>shared,busy:()=>busy,unseen:()=>unseen,target,endpoints,read:async(url,options)=>{
    reads.push(url);assert.equal(options.force,true);assert.equal(options.cache,false);return structuredClone(data[url]);
  }};
  return {deps,reads,data,endpoints,target,setState:s=>state=s,setShared:v=>shared=v,setBusy:v=>busy=v,setUnseen:v=>unseen=v};
};
test("N034 intake: read only the requested assets; no full game ZIP or provider settings",async()=>{
  const f=fixture();
  const lore=await captureCampaignLore({},f.deps);
  assert.equal(lore.campaign.name,"Example");
  assert.equal(lore.events[0].id,"one");
  assert.deepEqual(f.reads,["a/game","a/world","a/events","a/game"]);
  f.reads.length=0;
  await captureCampaignLore({actions:true,conversations:true},f.deps);
  assert.deepEqual(f.reads,["a/game","a/world","a/events","a/actions","a/chat","a/advisor","a/game"]);
});
test("N034 intake: fail closed on shared games, simulation, incomplete reveal and missing assets",async()=>{
  const f=fixture();
  f.setShared(true);await assert.rejects(captureCampaignLore({},f.deps),/single-player/);assert.equal(f.reads.length,0);
  f.setShared(false);f.setBusy(true);await assert.rejects(captureCampaignLore({},f.deps),/current simulation/);
  f.setBusy(false);f.setUnseen(new Set(["one"]));await assert.rejects(captureCampaignLore({},f.deps),/revealing/);
  f.setUnseen(new Set());f.data["a/events"]=null;await assert.rejects(captureCampaignLore({},f.deps),/could not be read/);
  f.deps.read=async()=>{throw Error("disk read failed");};await assert.rejects(captureCampaignLore({},f.deps),/disk read failed/);
});
test("N034 intake: switching campaign, same-campaign writes, and undo invalidate the capture",async()=>{
  for(const event of ["oh:active-game-changed","oh:runtime-json-updated","oh:rolled-back","oh:unseen-events-changed"]){
    const f=fixture(),read=f.deps.read;
    f.deps.read=async(url,options)=>{const result=await read(url,options);if(url==="a/events")f.target.dispatchEvent(new Event(event));return result;};
    await assert.rejects(captureCampaignLore({},f.deps),/Campaign changed/);
  }
  const f=fixture(),read=f.deps.read;
  f.deps.read=async(url,options)=>{const result=await read(url,options);if(url==="a/events"){f.endpoints.game="b/game";f.setState({activeGameId:"game-b"});}return result;};
  await assert.rejects(captureCampaignLore({},f.deps),/Campaign changed/);
  assert(!f.reads.includes("b/game"));
});
test("N034 intake: same-campaign generation mismatch is refused",async()=>{
  const f=fixture(),read=f.deps.read;
  f.deps.read=async(url,options)=>{const result=await read(url,options);if(url==="a/events")f.data["a/game"].round++;return result;};
  await assert.rejects(captureCampaignLore({},f.deps),/Campaign changed/);
});
test("N034 UI routes through Game settings, not a new simulation mutation",()=>{
  const ui=readFileSync(new URL("../Game/GameUI/campaignLore.jsx",import.meta.url),"utf8");
  const main=readFileSync(new URL("../Game/GameUI/main.jsx",import.meta.url),"utf8");
  const settings=readFileSync(new URL("../Game/GameUI/settings.jsx",import.meta.url),"utf8");
  assert.match(settings,/title="Game Management"[\s\S]*?title="Campaign Lore"/);
  assert.match(main,/onOpenCampaignLore={!sharedRole && gameEntered/);
  assert.match(ui,/captureCampaignLore\(options\)/);
  assert.match(ui,/saveTextToDisk/);
  assert.match(ui,/copyToClipboard/);
  assert.doesNotMatch(ui,/writeWorldState|simulateTimelineJump|writeCanonicalTurnState|exportGameBundle/);
});
