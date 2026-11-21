/*! Open Historia - authoritative authored native ledger outcomes. AGPL-3.0-or-later. */
// Authored rows are scenario data, not additional writable event-impact families.
// Receipts are ephemeral until the ordinary atomic turn commit succeeds.
import { impactRowProblems, nativeScriptedImpactRows } from "../../../server/scriptedImpacts.js";
import { resolveScriptedPolityIdentity } from "./scriptedEventResolution.js";
import { beatIsWritten } from "./worldDirection.js";
import { applyWarUpdates, decodeWarUpdates } from "./nativeWarLedger.js";
import { applyPuppetUpdates, decodePuppetUpdates, landedPolityCheck } from "./nativeDiplomaticDirector.js";
import { contentWarId, warPolityName } from "../../runtime/warRecord.js";
import { prepareCapitalRelocation, bindCapitalRelocation, verifyCapitalRelocationRecord, applyNativeCapitalOutcomes, verifyCapitalRelocation } from "./scriptedCapitalRelocation.js";
import { compareGameDates } from "../../runtime/gameDates.js";

const list=value=>Array.isArray(value)?value:[];
const clean=value=>String(value??"").trim();
const fail=(beat,reason)=>{throw new Error('Scripted event "'+(beat.title||beat.beatId||beat.id)+'" ('+beat.date+'): '+reason);};
const identity=(world,key)=>resolveScriptedPolityIdentity(world,key);
const same=(world,a,b)=>Boolean(identity(world,a))&&identity(world,a)===identity(world,b);
const opposing=(world,war,a,b)=>(
 (list(war.sideA??war.actors).some(p=>same(world,p,a))&&list(war.sideB??war.opponents).some(p=>same(world,p,b)))||
 (list(war.sideB??war.opponents).some(p=>same(world,p,a))&&list(war.sideA??war.actors).some(p=>same(world,p,b)))
);
const warName=(world,key)=>warPolityName(world?.polityOverrides?.[key]?.name||key);
const source=(row,eventId)=>list(row?.sourceEventIds).includes(eventId);
const activePuppets=world=>list(world?.puppets).filter(p=>p.status==="active");

// Coverage is checked against the actual committed date window, including
// fallback/non-validator paths. A missing or duplicated requirement is fatal.
export const verifyNativeScriptedCoverage=(beats,requirements)=>{
 const expected=list(beats).flatMap(beat=>nativeScriptedImpactRows(beat).map(({row,key})=>({beat,key,type:row.type})));
 const actual=list(requirements);
 for(const {beat,key,type} of expected){
  if(actual.filter(req=>req.beatId===beat.id&&req.key===key&&req.type===type&&req.date===beat.date).length!==1)
   fail(beat,"The accepted segment is missing an exact native outcome receipt.");
 }
 if(actual.length!==expected.length)throw new Error("The accepted segment contains unexpected native scripted outcome receipts.");
};

export const hasNativeCapitalOutcomes=beats=>list(beats).some(beat=>nativeScriptedImpactRows(beat).some(({row})=>row.type==="relocate_capital"));
export const hasNativeScriptedOutcomes=beats=>list(beats).some(beat=>nativeScriptedImpactRows(beat).length);

// Description from authored rows only. No request spent to interpret a row.
export const describeNativeScriptedOutcomes=beat=>nativeScriptedImpactRows(beat).map(({row})=>
 row.type==="start_war"
  ? (row.actor||"(missing country)")+" declares war on "+(row.opponent||"(missing country)")
  : row.type==="relocate_capital" ? (row.polity||"(missing country)")+" moves its capital to "+(row.cityName||row.cityId)
  : (row.polity||"(missing country)")+" becomes the "+row.kind+" of "+(row.overlord||"(missing overlord)")+" (loyalty "+row.loyalty+", "+row.secrecy+")"
).join("; ");

// The editor may retain incomplete rows while an author is working. An eligible
// beat with such a row must never silently turn into prose-only history.
export const prepareNativeScriptedOutcomes=(beats,world,{regionCatalog=[],cityContext=null}={})=>{
 const requirements=[];
 let preview=world;
 for(const beat of [...list(beats)].sort((a,b)=>compareGameDates(a.date,b.date))){
  const rows=nativeScriptedImpactRows(beat);
  if(rows.filter(({row})=>row.type==="start_war").length>1)fail(beat,"Only one war declaration may be attached to one event.");
  for(const {row,key} of rows){
   const missing=impactRowProblems(row);
   if(missing.length)fail(beat,"Incomplete or invalid "+row.type+" fields: "+missing.join(", ")+".");
   if(row.type==="relocate_capital"){
    const req=prepareCapitalRelocation({type:row.type,beatId:beat.id,title:beat.title,date:beat.date,key},row,preview,cityContext);
    if(requirements.some(p=>p.type==="relocate_capital"&&p.a===req.a))fail(beat,"Only one capital relocation per polity in a turn is supported.");
    preview=applyNativeCapitalOutcomes([{...req,eventId:"scripted-preview:"+beat.id+":"+key}],preview,{preview:true});
    requirements.push(req);
    continue;
   }
   const a=identity(preview,row.type==="start_war"?row.actor:row.overlord);
   const b=identity(preview,row.type==="start_war"?row.opponent:row.polity);
   if(!a||!b||a===b)fail(beat,"Both sides must name different active polities known to the campaign.");
   const landed=landedPolityCheck(preview,regionCatalog);
   const exists=key=>Boolean(preview?.polityOverrides?.[key]||list(preview?.ownerCodes).some(id=>same(preview,id,key))||landed?.(key));
   if(!exists(a)||!exists(b))fail(beat,"The selected polities are not present in the current campaign.");
   const req={type:row.type,beatId:beat.id,title:beat.title,date:beat.date,key,a,b};
   const eventId="scripted-preview:"+beat.id+":"+key;
   const event={id:eventId,date:beat.date,title:beat.title,description:beat.text};
   if(row.type==="start_war"){
    if(list(preview?.wars).some(w=>w.status!=="ended"&&opposing(preview,w,a,b)))fail(beat,"These countries are already opposing sides of a live war.");
    req.actor=warName(preview,a);req.opponent=warName(preview,b);
    if(!same(preview,req.actor,a)||!same(preview,req.opponent,b))fail(beat,"War names cannot be resolved to the selected stable identities.");
    req.warId=contentWarId({sideA:[req.actor],sideB:[req.opponent],startedDate:beat.date});
    if(list(preview?.wars).some(w=>w.id===req.warId))fail(beat,"The authored war identity is already in use.");
    req.warTitle=clean(row.warTitle).replace(/[;~|]/g,"-");
    const merge=applyWarUpdates({world:preview,updates:[warRecord(req,eventId)],events:[event],stopDate:beat.date});
    if(merge.appliedIds.length!==1)fail(beat,"Native war creation refused the declaration.");
    preview=merge.world;
   }else{
    if(!landed||!landed(b))fail(beat,"The subordinate must retain territory; the map must be available.");
    if(activePuppets(preview).some(p=>same(preview,p.puppet,b)||same(preview,p.puppet,a)))fail(beat,"A selected country already has an overlord; release the existing arrangement first.");
    req.kind=row.kind;req.loyalty=Number(row.loyalty);req.secrecy=row.secrecy;
    const merge=applyPuppetUpdates({world:preview,updates:[puppetRecord(req,eventId)],events:[event],stopDate:beat.date,regionCatalog});
    if(merge.dropped.length||merge.appliedIds.length!==1)fail(beat,merge.dropped[0]?.reason||"Native subordination refused the arrangement.");
    preview=merge.world;
   }
   verifyNativeScriptedOutcomes([{...req,eventId}],preview,[event],{checkEventWar:false});
   requirements.push(req);
  }
 }
 return requirements;
};

const warRecord=(req,eventId)=>({
 id:req.warId,op:"start",actors:[req.actor],opponents:[req.opponent],eventIds:[eventId],eventIndexes:[],
 note:req.warTitle?"Title: "+req.warTitle+"; Authored scenario declaration.":"Authored scenario declaration.",
});
const puppetRecord=(req,eventId)=>({
 id:"scripted-puppet:"+req.beatId+":"+req.key,op:"install",overlord:req.a,puppet:req.b,
 kind:req.kind,loyalty:req.loyalty,secrecy:req.secrecy,eventIds:[eventId],eventIndexes:[],note:"Authored scenario subordination.",
});

// The candidate already has its model ledger links pinned by ID. Author rows
// replace duplicate model starts, not independent declarations elsewhere.
export const bindNativeScriptedOutcomes=(candidate,beats,requirements,world)=>{
 const events=list(candidate.events);
 const bound=[];
 const authoredWars=[],authoredPuppets=[];
 let wars=decodeWarUpdates(candidate.warUpdates,{limit:Infinity});
 let puppets=decodePuppetUpdates(candidate.puppetUpdates,{limit:Infinity});
 for(const req of list(requirements)){
  const beat=list(beats).find(b=>b.id===req.beatId);
  const matches=events.filter(event=>beatIsWritten(beat,[event]));
  if(matches.length!==1||!clean(matches[0].id))fail(req,"The authored outcome needs exactly one event with a stable ID.");
  const event=matches[0],eventId=event.id;
  // Date is a native authoring contract for this outcome, even in generated text mode.
  event.date=req.date;
  if(req.type==="start_war"){
   const duplicates=wars.filter(w=>w.op==="start"&&(opposing(world,w,req.a,req.b)||list(w.eventIds).includes(eventId)));
   const replaced=new Set(duplicates.filter(w=>opposing(world,w,req.a,req.b)).map(w=>w.id));
   // A start for an unrelated pair on this same event is not a second authored war.
   wars=wars.filter(w=>!duplicates.includes(w)).map(w=>replaced.has(w.id)?{...w,id:req.warId}:w);
   for(const other of events){
    if(other!==event&&replaced.has(other.warId)){
     if(compareGameDates(other.date,req.date)<0)fail(req,"A generated war event precedes the authored declaration.");
     other.warId=req.warId;
    }
   }
   event.warId=req.warId;
   event.combatants=[req.actor,req.opponent];
   authoredWars.push(warRecord(req,eventId));
  }else if(req.type==="relocate_capital"){
   bindCapitalRelocation(event,req,world);
  }else{
   // Remove the model's duplicate install and competing operation attached
   // to the authored event. Native checks still handle other dated operations.
   puppets=puppets.filter(p=>!same(world,p.puppet,req.b)||(!list(p.eventIds).includes(eventId)&&p.op!=="install"));
   authoredPuppets.push(puppetRecord(req,eventId));
  }
  bound.push({...req,eventId});
 }
 if(bound.some(r=>r.type==="start_war"))candidate.warUpdates=[...authoredWars,...wars];
 if(bound.some(r=>r.type==="install_puppet"))candidate.puppetUpdates=[...authoredPuppets,...puppets];
 return bound;
};

// Prove the author row survived the ordinary ledger settlement/limits, before
// segment acceptance. Do not trust a count of applied records alone.
export const verifyNativeScriptedRecords=(requirements,candidate,world)=>{
 for(const req of list(requirements)){
  const events=list(candidate.events).filter(e=>e.id===req.eventId&&e.date===req.date);
  if(events.length!==1)fail(req,"The authored source event was removed or changed.");
  if(req.type==="start_war"){
   const records=list(candidate.warUpdates).filter(w=>w.id===req.warId&&w.op==="start"&&list(w.eventIds).includes(req.eventId));
   if(records.length!==1||records[0].actors.length!==1||records[0].opponents.length!==1||
      !same(world,records[0].actors[0],req.a)||!same(world,records[0].opponents[0],req.b)||events[0].warId!==req.warId)
    fail(req,"Native war settlement did not retain the exact authored declaration.");
  }else if(req.type==="relocate_capital"){
   verifyCapitalRelocationRecord(req,events[0],world);
  }else{
   const records=list(candidate.puppetUpdates).filter(p=>p.op==="install"&&list(p.eventIds).includes(req.eventId)&&same(world,p.puppet,req.b));
   if(records.length!==1||!same(world,records[0].overlord,req.a)||records[0].kind!==req.kind||
      records[0].loyalty!==req.loyalty||records[0].secrecy!==req.secrecy)
    fail(req,"Native diplomatic settlement did not retain the exact authored installation.");
  }
 }
};

export const remapNativeScriptedOutcomes=(requirements,idMap)=>{
 return list(requirements).map(req=>{
  const eventId=idMap.get(req.eventId);
  if(!eventId)fail(req,"The authored outcome event was discarded before the canonical commit.");
  return {...req,eventId};
 });
};

// The last gate is on actual canonical ledgers and timeline, not the proposal.
// An author may not receive a successful one-time receipt for an absent effect.
export const verifyNativeScriptedOutcomes=(requirements,world,events,{checkEventWar=true}={})=>{
 for(const req of list(requirements)){
  const matching=list(events).filter(e=>e.id===req.eventId&&e.date===req.date);
  if(matching.length!==1)fail(req,"The authored event is missing from the canonical timeline.");
  if(req.type==="start_war"){
   const war=list(world.wars).find(w=>w.id===req.warId);
   if(!war||war.startedDate!==req.date||!source(war,req.eventId)||
      !list(war.sideA).some(p=>same(world,p,req.a))||!list(war.sideB).some(p=>same(world,p,req.b))||
      (checkEventWar&&matching[0].warId!==req.warId))
    fail(req,"The canonical war declaration was not applied as authored.");
  }else if(req.type==="relocate_capital"){
   verifyCapitalRelocation(req,world);
  }else{
   const puppet=list(world.puppets).find(p=>p.startedDate===req.date&&source(p,req.eventId)&&
     same(world,p.overlord,req.a)&&same(world,p.puppet,req.b)&&p.kind===req.kind&&p.secrecy===req.secrecy&&p.status==="active");
   if(!puppet)fail(req,"The canonical subordination arrangement was not applied as authored.");
  }
 }
};
