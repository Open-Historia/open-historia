/*! Open Historia - public statement and Rostra regression coverage. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEvents, normalizeWorldState } from "./gameState.js";
import { normalizePublicDraft, planPublicPublication, normalizePublicStatement, pendingPublicStatements, nextPublicStatementCursor, publicStatementContext, assertPublicStatementsRetained, planPublicCancellation, canCancelPublicStatement, permitsPublicDraft, findPublicDraftReply } from "./publicCommunications.js";
import { advisorRostraContext } from "./advisorRostra.js";
import { parseAdvisorReply } from "../Game/GameUI/advisorReply.js";
import { buildCampaignLore, campaignLoreMarkdown } from "./campaignLore.js";
const game={country:"Bulgaria",gameDate:"1912-02-15",round:9};
const world={polityOverrides:{Bulgaria:{code:"Bulgaria",name:"Kingdom of Bulgaria",status:"active"},Iran:{code:"Iran",name:"Iran",status:"active"}},countryStats:{Bulgaria:{leader:"Ferdinand I"}},institutions:{byId:{eu:{id:"eu",name:"European Union",status:"active"}}},simulationHistory:[{mode:"jump",round:9,fromDate:"1912-02-08",toDate:game.gameDate,eventIds:["earlier"]}],socialFeed:[]};
const draft={title:"Address to the nation",body:"Citizens,\n\nWe seek peace. We will not attack.",audience:{kind:"domestic",target:""}};
const expected={country:game.country,date:game.gameDate,round:game.round};
const publish=(overrides={})=>planPublicPublication({events:[],world,game,draft,draftId:"reply:public:0",expected,confirmed:true,...overrides});
test("public publication records exact text and audience, no order, Rostra post or fiscal mutation",()=>{
 const before=JSON.stringify(world);const result=publish(),e=result.events[0],s=normalizePublicStatement(e);
 assert.equal(s.body,draft.body);assert.equal(s.issuer,"Ferdinand I, Leader of Kingdom of Bulgaria");
 assert.equal(e.source,"player-publication");assert.equal(e.date,game.gameDate);assert.equal(s.round,9);
 assert.equal(e.audience,undefined,"public reach is not a private visibility list");
 assert.deepEqual(e.impacts,{});
 assert.deepEqual(result.world.simulationHistory[0].eventIds,["earlier",e.id]);
 assert.deepEqual(result.world.socialFeed,[]);
 assert.equal(JSON.stringify(world),before);
 const normalized=normalizeEvents(result.events);
 assert.deepEqual(normalizePublicStatement(normalized[0]),s);
 assertPublicStatementsRetained(result.events,normalized);
 assertPublicStatementsRetained(normalized,normalizeEvents(normalized));
 assert.throws(()=>assertPublicStatementsRetained(result.events,[]),/lost/);
 assert.equal(publish({events:normalized}),null,"same draft retry does not append");
 assert.throws(()=>publish({events:normalized,draft:{...draft,body:"Different"}}),/already published/);
 assert.throws(()=>publish({events:normalized,draftId:"different"}),/identical/);
 const lore=buildCampaignLore({game,world:result.world,events:normalized});
 assert.equal(lore.events[0].publicStatement.body,draft.body);
 assert.match(campaignLoreMarkdown(lore),/Official public statement/);
});
test("typed foreign population, worldwide and institution audiences use existing IDs, never a fictitious polity",()=>{
 for(const audience of [{kind:"foreign-public",target:"Iran"},{kind:"worldwide",target:""},{kind:"institution",target:"eu"}]){
  const p=publish({draft:{...draft,audience}});assert.deepEqual(p.events[0].publicStatement.audience,audience);assert.equal(p.events[0].audience,undefined);
 }
 assert.throws(()=>publish({draft:{...draft,audience:{kind:"foreign-public",target:"invented"}}}),/existing public audience/);
 assert.throws(()=>publish({draft:{...draft,audience:{kind:"foreign-public",target:"Bulgaria"}}}),/existing public audience/);
 assert.throws(()=>publish({draft:{...draft,audience:{kind:"institution",target:"missing"}}}),/existing public audience/);
 assert.throws(()=>publish({confirmed:false}),/confirmed/);
 assert.throws(()=>publish({expected:{...expected,round:8}}),/Campaign changed/);
 assert.equal(normalizePublicDraft({...draft,body:"x".repeat(4001)}),null);
});
test("ordinary accepted skips consume pending public-context boundary, scenes do not; cursor survives loss of recent history",()=>{
 const result=publish();const ev=result.events;
 assert.equal(pendingPublicStatements(ev,result.world,game).length,1);
 assert.match(publicStatementContext(ev,result.world,game,{onlyPending:true}),/not orders/);
 assert.equal(nextPublicStatementCursor(ev,result.world,"interactive",10),undefined);
 assert.equal(nextPublicStatementCursor(ev,result.world,"jump",10),10);
 assert.equal(nextPublicStatementCursor(ev,result.world,"auto",10),10);
 const advanced=normalizeWorldState({...result.world,publicStatementCursor:10,simulationHistory:[]});
 assert.equal(pendingPublicStatements(ev,advanced,{...game,round:23}).length,0);
 assert.equal(publicStatementContext(ev,advanced,{...game,round:23},{onlyPending:true}),"");
 assert.match(publicStatementContext(ev,advanced,{...game,round:23}),/Citizens/);
});
test("start-day publication links a native history record; pending cap fails closed",()=>{
 let current={...world,simulationHistory:[]},events=[];
 for(let i=0;i<4;i++){const p=publish({world:current,events,draftId:"direct:"+i,draft:{...draft,title:"Address "+i}});current=p.world;events=p.events;}
 assert.equal(current.simulationHistory.length,1);assert.equal(current.simulationHistory[0].eventIds.length,4);
 assert.throws(()=>publish({world:current,events,draftId:"direct:4",draft:{...draft,title:"Another"}}),/four pending/);
});
test("Advisor fence prepares only a draft; streaming, bad recipient kind, and malformed text cannot create a native event",()=>{
 const fence="I prepared the address.\n\n```publicstatement\n"+JSON.stringify([draft])+"\n```";
 const reply=parseAdvisorReply(fence);
 assert.deepEqual(reply.publicDrafts,[draft]);assert.equal(reply.text,"I prepared the address.");
 assert.equal(parseAdvisorReply(fence,{streaming:true}).publicDrafts,null);
 assert.equal(parseAdvisorReply(fence.slice(0,-3)).publicDrafts,null);
 assert.equal(parseAdvisorReply("I published a speech.").publicDrafts,null);
 assert.equal(parseAdvisorReply(fence.replace('"domestic"','"private"')).publicDrafts[0],null);
});
test("Rostra briefing reflects retained post engagement, quote identity and unavailable originals; disabled is empty",()=>{
 const feed=[{id:"p1",kind:"player",author:"King",country:"Bulgaria",text:"Our railway",date:game.gameDate,round:9},
 {id:"p2",kind:"voice",author:"Reporter",country:"Iran",text:"Response to railway",quote:"p1",date:game.gameDate,round:9},
 {id:"p3",kind:"voice",author:"Another",country:"Iran",text:"Old quote",quote:"p999",date:game.gameDate,round:9}];
 assert.equal(advisorRostraContext({feed,round:9,enabled:false}),"");
 const context=advisorRostraContext({feed,round:9,query:"railway",enabled:true});
 assert.match(context,/"id":"p1"/);assert.match(context,/"likes":0/);assert.match(context,/"quote":"p1"/);assert.match(context,/Original is outside the retained feed/);
 assert.match(context,/not individual actions or approval/);
});

test("native issuer choices distinguish formal head of state, prime minister and government",()=>{
 const political={...world,politicalActors:{byPolity:{Bulgaria:{polityKey:"Bulgaria",leader:"Tsar Ferdinand I",government:{headOfState:"Tsar Ferdinand I",headOfGovernment:"Ivan Geshov",status:"active"}}}}};
 assert.equal(publish({world:political}).events[0].publicStatement.issuer,"Tsar Ferdinand I, Head of state");
 assert.equal(publish({world:political,draft:{...draft,issuerId:"head-of-government"}}).events[0].publicStatement.issuer,"Ivan Geshov, Head of government");
 assert.equal(publish({world:political,draft:{...draft,issuerId:"government"}}).events[0].publicStatement.issuer,"Government of Kingdom of Bulgaria");
 assert.throws(()=>publish({world:political,draft:{...draft,issuerId:"leader"}}),/existing issuing office/);
 assert.equal(normalizePublicDraft({...draft,issuerId:"foreign-ruler"}),null);
});
test("historical retired polity retained in statistics is not an available public audience",()=>{
 const retired={...world,customRegions:true,polityOverrides:{...world.polityOverrides,Iran:{code:"Iran",name:"Iran",status:"dissolved"}},countryStats:{...world.countryStats,Iran:{leader:"Former ruler"}}};
 assert.throws(()=>publish({world:retired,draft:{...draft,audience:{kind:"foreign-public",target:"Iran"}}}),/existing public audience/);
});

test("cancel unconsumed statement atomically unlinks only its receipt and permanently cancels the draft",()=>{
 const published=publish(),e=published.events[0],before=JSON.stringify(published);
 const args={...published,game,expected,draftId:"reply:public:0",confirmed:true};
 assert.equal(canCancelPublicStatement(e,published.world,game),true);
 const result=planPublicCancellation(args);
 assert.deepEqual(result.events,[]);
 assert.deepEqual(result.world.simulationHistory[0].eventIds,["earlier"]);
 assert.deepEqual(result.world.cancelledPublicDrafts,["reply:public:0"]);
 assert.deepEqual(normalizeWorldState(result.world).cancelledPublicDrafts,["reply:public:0"]);
 assert.equal(publicStatementContext(result.events,result.world,game,{onlyPending:true}),"");
 assert.equal(JSON.stringify(published),before);
 assert.equal(planPublicCancellation({...args,...result}),null);
 assert.throws(()=>publish({...result}),/cancelled/);
 assert.throws(()=>planPublicCancellation({...args,world:{...published.world,publicStatementCursor:10}}),/history/);
 assert.throws(()=>planPublicCancellation({...args,game:{...game,round:10,gameDate:"1912-02-22"},expected:{...expected,round:10,date:"1912-02-22"}}),/history/);
 const noHistory=publish({world:{...world,simulationHistory:[]}});
 assert.equal(planPublicCancellation({...args,...noHistory}).world.simulationHistory.length,0);
 const unpublished=planPublicCancellation({...args,events:[],world});
 assert.deepEqual(unpublished.world.cancelledPublicDrafts,["reply:public:0"]);
});

test("N035 uses one authority boundary for domestic minister drafts, not chief-only execution",()=>{
 const contact={role:"advisor-contact",id:"advisor-testchat",name:"TEST CHAT",title:"Advisor",recipientType:"advisor-minister"};
 const msg={role:"advisor",id:"reply-denmark",threadId:contact.id,text:"Draft"};
 const chief={...msg,id:"reply-chief",threadId:"chief"};
 const saved=[contact,msg,chief];
 assert.equal(permitsPublicDraft("chief",null),true);
 assert.equal(permitsPublicDraft(contact.id,contact),true);
 assert.equal(findPublicDraftReply(saved,contact.id,msg.id),msg);
 assert.equal(findPublicDraftReply(saved,"chief",chief.id),chief);
 assert.throws(()=>findPublicDraftReply(saved,"chief",msg.id),/no longer available/);
 assert.throws(()=>findPublicDraftReply(saved,contact.id,chief.id),/no longer available/);
 assert.throws(()=>findPublicDraftReply([...saved,msg],contact.id,msg.id),/no longer available/);
 for(const type of ["foreign-official","citizen-civilian","other-character","invented"]){
   const c={...contact,recipientType:type};
   assert.equal(permitsPublicDraft(c.id,c),false);
   assert.throws(()=>findPublicDraftReply([c,msg],c.id,msg.id),/active domestic/);
 }
 assert.equal(permitsPublicDraft(contact.id,{...contact,archived:true}),false);
 assert.throws(()=>findPublicDraftReply([{...contact,archived:true},msg],contact.id,msg.id),/active domestic/);
 assert.equal(permitsPublicDraft("advisor-group-test",contact,{meetingMode:true}),false);
 for(const options of [{sharedGame:true},{meetingMode:true},{discussionOnly:true}])assert.equal(permitsPublicDraft(contact.id,contact,options),false);
 assert.equal(permitsPublicDraft("chief",contact),false);
});

test("assertPublicStatementsRetained tolerates non-array input and unclosed publicstatement fence reports problem when not streaming", () => {
  assert.doesNotThrow(() => assertPublicStatementsRetained(null, []));
  assert.doesNotThrow(() => assertPublicStatementsRetained(undefined, undefined));
  const published = publish();
  assert.doesNotThrow(() => assertPublicStatementsRetained(published.events, [], { allowedRemovedIds: [published.events[0].id] }));

  const unclosed = "Draft below.\n\n```publicstatement\n[{\"title\":\"Cut off\"";
  const finished = parseAdvisorReply(unclosed, { streaming: false });
  assert.equal(finished.publicDrafts, null);
  assert.equal(finished.text, "Draft below.");
  assert.ok(finished.publicProblems.some((p) => /cut off/i.test(p)));
  const midStream = parseAdvisorReply(unclosed, { streaming: true });
  assert.equal(midStream.publicProblems.length, 0);

  // Prose mentioning the fence token inline (not as an opening fence line) stays intact.
  const prose = "Use ```publicstatement blocks only when proposing a speech.";
  assert.equal(parseAdvisorReply(prose, { streaming: false }).text, prose);

  // Build >16 posts (using valid Rostra p<N> IDs) so only genuine relevance matches can promote an old post above the 16-post recency cap.
  const oldRailway = { id: "p1", kind: "voice", author: "A", country: "Bulgaria", text: "Railways expand fast across the frontier", date: "1912-01-01", round: 1 };
  const oldCjk = { id: "p2", kind: "voice", author: "B", country: "Japan", text: "東京の鉄道計画が承認された", date: "1912-01-02", round: 1 };
  const filler = Array.from({ length: 18 }, (_, index) => ({
    id: `p${index + 10}`,
    kind: "voice",
    author: `Speaker ${index}`,
    country: "Iran",
    text: `Harvest ledger entry number ${index}`,
    date: game.gameDate,
    round: 9,
  }));
  const bigFeed = [oldRailway, oldCjk, ...filler];

  // Querying a JSON key ("date") must NOT boost irrelevant old posts ahead of recent posts.
  const dateCtx = advisorRostraContext({ feed: bigFeed, round: 9, query: "date", enabled: true });
  assert.doesNotMatch(dateCtx, /"id":"p1"/);
  assert.doesNotMatch(dateCtx, /"id":"p2"/);

  // Singular/plural prefix matching promotes the old railway post; CJK substring & unspaced sentence queries promote the old Tokyo post.
  const railCtx = advisorRostraContext({ feed: bigFeed, round: 9, query: "railway", enabled: true });
  assert.match(railCtx, /"id":"p1"/);
  const cjkCtx = advisorRostraContext({ feed: bigFeed, round: 9, query: "東京", enabled: true });
  assert.match(cjkCtx, /"id":"p2"/);
  const cjkSentenceCtx = advisorRostraContext({ feed: bigFeed, round: 9, query: "東京の鉄道計画について教えて", enabled: true });
  assert.match(cjkSentenceCtx, /"id":"p2"/);
});
