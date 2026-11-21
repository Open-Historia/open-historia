/*! Open Historia - scenario-authored capital relocation. AGPL-3.0-or-later. */
import { cityReference, normalizeCapitalMap, capitalNameForReference } from "../../runtime/capitalSeats.js";
import { applyCountryStatPatchToWorld, normalizeWorldState } from "../../runtime/gameState.js";
import { resolveScriptedPolityIdentity } from "./scriptedEventResolution.js";
import { waterTypeIds } from "../../runtime/regionTypes.js";
const list=v=>Array.isArray(v)?v:[];
const fold=v=>String(v??"").trim().replace(/\s+/g," ").toLowerCase();
const fail=(req,reason)=>{throw new Error('Scripted capital relocation "'+(req.title||req.beatId)+'": '+reason);};
const identity=(world,key)=>resolveScriptedPolityIdentity(world,key);
const same=(world,a,b)=>Boolean(identity(world,a))&&identity(world,a)===identity(world,b);

export const prepareCapitalRelocation=(req,row,world,context)=>{
 const country=identity(world,row.polity);
 if(!country)fail(req,"Select an active polity known to this campaign.");
 const entries=list(context?.cityRows).map(city=>({city,ref:cityReference(city)})).filter(x=>x.ref);
 const unique=ref=>entries.filter(x=>fold(x.ref.baseName)===fold(ref.baseName)).length===1;
 const matches=entries.filter(x=>x.ref.id===row.cityId);
 if(matches.length!==1||!unique(matches[0].ref))fail(req,"Select one unambiguous city from the scenario map.");
 const isWater=waterTypeIds(world?.regionTypes);
 const owned=entry=>{
  const region=context.regionOfCity(entry.city);
  return region?.geometry&&!isWater.has(region.typeId)&&same(world,region.owner,country)&&(!region.sovereign||same(world,region.sovereign,country))?region:null;
 };
 const target=matches[0],region=owned(target);
 if(!region)fail(req,"The selected city must lie inside a rendered, controlled and legally held land region of the polity.");
 const previous=world.countryStats?.[country]||{};
 const prior=normalizeCapitalMap(previous.capitalMap);
 let former=null;
 if(prior?.current){
  const candidates=entries.filter(x=>x.ref.id===prior.current.id);
  if(candidates.length!==1||!unique(candidates[0].ref))fail(req,"The former capital map reference is no longer uniquely resolvable.");
  former=candidates[0];
 }else{
  const named=entries.filter(x=>[x.ref.name,x.ref.baseName].some(n=>fold(n)===fold(previous.capital))&&owned(x));
  if(named.length>1)fail(req,"The former capital is ambiguous.");
  former=named[0]||entries.filter(x=>["primary","capital","true","yes","1"].includes(fold(x.ref.capital))&&owned(x))
    .sort((a,b)=>b.ref.population-a.ref.population||a.ref.id.localeCompare(b.ref.id))[0]||null;
 }
 if(former&&!unique(former.ref))fail(req,"The former capital marker has an ambiguous original name.");
 if(former?.ref.id===target.ref.id)fail(req,"The city is already the capital.");
 const retired=[...list(prior?.retired),...(former?[former.ref.baseName]:[])];
 return {...req,a:country,name:target.ref.name,ref:{id:target.ref.id,baseName:target.ref.baseName,regionId:region.id},
  retired,baseOwner:region.owner,baseSovereign:region.sovereign||region.owner};
};

const liveOwner=(world,req,key,fallback)=>Object.hasOwn(world?.[key]||{},req.ref.regionId)?world[key][req.ref.regionId]:fallback;
const liveCapital=(world,req)=>{
 const country=identity(world,req.a);
 if(!country||!same(world,liveOwner(world,req,"regionOwnershipOverrides",req.baseOwner),country)||
    !same(world,liveOwner(world,req,"regionSovereigntyOverrides",req.baseSovereign),country))
  fail(req,"The destination is no longer held by the polity.");
 return {country,name:capitalNameForReference(world,req.ref,req.name)};
};

// Bind the authoritative name to the existing country-stat impact. The map
// reference itself is attached by the native writer, never accepted from AI.
export const bindCapitalRelocation=(event,req,world)=>{
 const changes=list(event.impacts?.polityChanges);
 let found=false;
 const next=changes.map(change=>{
  if(!same(world,change.code,req.a))return change;
  if(change.operation==="dissolve"||change.operation==="create")fail(req,"Conflicting polity lifecycle in the authored event.");
  if(!found){found=true;return {...change,stats:{...change.stats,capital:req.name}};}
  if(change.stats&&Object.hasOwn(change.stats,"capital")){
   const stats={...change.stats};delete stats.capital;return {...change,stats};
  }
  return change;
 });
 if(!found)next.push({operation:"update",code:req.a,stats:{capital:req.name}});
 event.impacts={...event.impacts,polityChanges:next};
};
export const verifyCapitalRelocationRecord=(req,event,world)=>{
 const matches=list(event?.impacts?.polityChanges).filter(c=>same(world,c.code,req.a)&&Object.hasOwn(c.stats||{},"capital"));
 if(matches.length!==1||matches[0].stats.capital!==req.name)fail(req,"The canonical capital patch was removed or changed.");
};

export const applyNativeCapitalOutcomes=(requirements,world,{preview=false}={})=>{
 const rows=list(requirements).filter(req=>req.type==="relocate_capital");
 if(!rows.length)return world;
 const next=normalizeWorldState(world);
 const seen=new Set();
 for(const req of rows){
  const {country,name}=liveCapital(next,req);
  if(seen.has(country))fail(req,"Multiple capital relocations for the same polity in one turn are not supported.");
  seen.add(country);
  const existing=next.countryStats?.[country];
  if(!preview&&existing?.capital!==req.name&&existing?.capital!==name)fail(req,"The event's capital stat patch did not apply exactly.");
  const capitalMap=normalizeCapitalMap({current:{...req.ref,sourceEventId:req.eventId},retired:req.retired});
  applyCountryStatPatchToWorld(next,country,{capital:name},{nativeCapitalMap:capitalMap});
  verifyCapitalRelocation(req,next);
 }
 return next;
};
export const verifyCapitalRelocation=(req,world)=>{
 const {country,name}=liveCapital(world,req);
 const sheet=world.countryStats?.[country];
 const map=normalizeCapitalMap(sheet?.capitalMap);
 if(sheet?.capital!==name||map?.current?.id!==req.ref.id||map.current.regionId!==req.ref.regionId||
    map.current.sourceEventId!==req.eventId||list(req.retired).filter(n=>fold(n)!==fold(req.ref.baseName)).some(n=>!list(map.retired).includes(fold(n))))
  fail(req,"The canonical seat / map reference did not apply.");
};
