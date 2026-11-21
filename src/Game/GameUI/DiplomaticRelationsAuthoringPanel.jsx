/*! Open Historia - scenario bilateral relations authoring. AGPL-3.0-or-later. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { authoringCardStyle, authoringCardRow, authoringCardCopy, authoringTitleStyle, authoringDescriptionStyle, authoringMetaStyle, authoringButtonStyle, authoringInputStyle, authoringOptionStyle, authoringLabelStyle, authoringShellStyle, authoringHeaderStyle, authoringCloseStyle, authoringEyebrowStyle, authoringHeadingStyle, authoringSubheadingStyle } from "./scenarioAuthoringStyles.js";
import { authoringSelectedStyle } from "./scenarioAuthoringStyles.js";
import { loadScenarioDetails, saveScenario } from "../../runtime/library.js";
import { collectActiveScenarioPolityKeys } from "../../runtime/scenarioPolities.js";
import { relationBandForScore } from "../../runtime/diplomaticStance.js";
import { MAX_STARTING_RELATIONS, MAX_STARTING_RELATION_SUMMARY, startingRelationOverview, planReviewedStartingRelationEdit } from "../../Editor/scenarioStartingRelations.js";

const choicesFor = world => collectActiveScenarioPolityKeys(world).map(key=>({
  ...world?.polityOverrides?.[key],key,name:world?.polityOverrides?.[key]?.name||key,
})).sort((a,b)=>a.name.localeCompare(b.name));
const panel=authoringCardStyle;
const button=authoringButtonStyle;
const input={...authoringInputStyle,textTransform:"none",letterSpacing:"normal",fontWeight:400};
const muted={fontSize:"0.72rem",color:"var(--oh-grey-muted)",lineHeight:1.5};
const label={...authoringLabelStyle,display:"grid",gap:6};
const option=authoringOptionStyle;
const empty=()=>({a:"",b:"",score:"",summary:"",expected:null});
const formatScore=s=>Number(s)>0?"+"+s:String(s??"");

export default function DiplomaticRelationsAuthoringPanel({details,onDetailsChange}){
 const world=useMemo(()=>details?.data?.world||{},[details?.data?.world]);
 const scenarioId=details?.scenario?.id||"";
 const choices=useMemo(()=>choicesFor(world),[world]);
 const names=new Map(choices.map(c=>[c.key,c.name]));
 const rows=useMemo(()=>startingRelationOverview(world.relations,choices),[world.relations,choices]);
 const [open,setOpen]=useState(false);
 const [query,setQuery]=useState("");
 const [country,setCountry]=useState("");
 const [draft,setDraft]=useState(empty);
 const [dirty,setDirty]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const dialog=useRef(null), trigger=useRef(null), saving=useRef(false);
 useEffect(()=>{
   if(open&&dialog.current&&!dialog.current.open)dialog.current.showModal();
 },[open]);
 const discard=()=>!dirty||window.confirm("Discard unsaved diplomatic relationship edits?");
 const close=()=>{
   if(saving.current||!discard())return;
   dialog.current?.close();setOpen(false);setDirty(false);setDraft(empty());setError("");setMessage("");
   trigger.current?.focus();
 };
 const select=item=>{
   if(saving.current||!discard())return;
   setDraft(item?{a:item.a,b:item.b,score:String(item.row.score??""),summary:String(item.row.summary??""),expected:item.row}:empty());
   setDirty(false);setError("");setMessage("");
 };
 const patch=(field,value)=>{setDraft(old=>({...old,[field]:value}));setDirty(true);setError("");setMessage("");};
 const refresh=async()=>{
   if(saving.current||!discard())return;
   saving.current=true;setBusy(true);setError("");setMessage("");
   try{onDetailsChange?.(await loadScenarioDetails(scenarioId));setDraft(empty());setDirty(false);}
   catch(e){setError(e.message||"Could not refresh diplomatic relations.");}
   finally{saving.current=false;setBusy(false);}
 };
 const save=async(remove=false)=>{
   if(!scenarioId||saving.current||!draft.a||!draft.b)return;
   if(remove&&!draft.expected)return;
   if(remove&&!window.confirm("Unset this relationship? This removes its authored score and description, not treaties or wars."))return;
   saving.current=true;setBusy(true);setError("");setMessage("");
   try{
     const latest=await loadScenarioDetails(scenarioId);
     const current=latest?.data?.world||{};
     const edit={a:draft.a,b:draft.b,score:remove?null:draft.score,
       ...(!remove&&draft.summary!==String(draft.expected?.summary??"")?{summary:draft.summary}:{})};
     const plan=planReviewedStartingRelationEdit(current.relations,edit,draft.expected,choicesFor(current));
     if(!plan.ok)throw new Error(plan.reason);
     const updated=await saveScenario(scenarioId,{worldPatch:{relations:plan.relations}});
     onDetailsChange?.(updated);
     setDraft(empty());setDirty(false);setMessage(remove?"Relationship unset.":"Diplomatic relationship saved.");
   }catch(e){setError(e.message||"Could not save diplomatic relationship.");}
   finally{saving.current=false;setBusy(false);}
 };
 const needle=query.trim().toLowerCase();
 const filtered=rows.filter(item=>(!country||item.a===country||item.b===country)&&
   (!needle||[names.get(item.a),names.get(item.b),item.a,item.b,item.row.summary,relationBandForScore(item.row.score)].join(" ").toLowerCase().includes(needle)))
   .sort((a,b)=>(names.get(a.a)||a.a).localeCompare(names.get(b.a)||b.a)||(names.get(a.b)||a.b).localeCompare(names.get(b.b)||b.b));
 const selectPolity=(field,other)=><select style={input} value={draft[field]} disabled={busy||Boolean(draft.expected)} onChange={e=>patch(field,e.target.value)}>
   <option value="" style={option}>Choose polity</option>
   {choices.filter(c=>c.key!==draft[other]).map(c=><option key={c.key} value={c.key} style={option}>{c.name}</option>)}
 </select>;
 return <section style={panel}>
   <div style={authoringCardRow}>
     <div style={authoringCardCopy}>
       <div style={authoringTitleStyle}>Starting diplomatic relations</div>
       <div style={authoringDescriptionStyle}>Author the bilateral political climate and its historical context. Scores are shared with the Map Editor.</div>
       <div style={authoringMetaStyle}>{rows.length} / {MAX_STARTING_RELATIONS} authored relationships</div>
     </div>
     <button ref={trigger} type="button" style={{...button,flex:"0 0 auto"}} onClick={()=>{setOpen(true);setError("");setMessage("");}}>Manage Diplomatic Relations</button>
   </div>
   {open&&createPortal(<dialog className="oh-scenario-authoring-dialog" ref={dialog} aria-label="Manage Diplomatic Relations" onCancel={e=>{e.preventDefault();close();}}
     style={{...authoringShellStyle,position:"fixed",inset:0,margin:"auto",padding:0,maxWidth:"calc(100vw - 1rem)"}}>
     <header style={authoringHeaderStyle}>
       <div><div style={authoringEyebrowStyle}>Scenario authoring</div><div style={authoringHeadingStyle}>Diplomatic Relations</div><div style={authoringSubheadingStyle}>Starting bilateral scores and descriptions. Unset is unknown; explicit 0 is neutral. Separate from wars, treaties and subordination.</div></div>
       <button type="button" style={authoringCloseStyle} onClick={close} disabled={busy} aria-label="Close diplomatic relations manager">×</button>
     </header>
     <div className="oh-scenario-relation-layout">
       <section className="oh-scenario-relation-list">
         <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
           <button type="button" style={button} onClick={()=>select(null)} disabled={busy}>+ Add relationship</button>
           <button type="button" style={button} onClick={refresh} disabled={busy}>Refresh relations</button>
         </div>
         <label style={label}>Search relationships<input style={input} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search countries or descriptions"/></label>
         <label style={label}>Filter by polity<select style={input} value={country} onChange={e=>setCountry(e.target.value)}>
           <option value="" style={option}>All polities</option>{choices.map(c=><option key={c.key} value={c.key} style={option}>{c.name}</option>)}
         </select></label>
         <div style={muted}>{filtered.length} of {rows.length} relationships</div>
         <div className="oh-scenario-relation-rows">
           {filtered.map(item=><article key={item.index} style={{border:"1px solid var(--oh-grey-border)",background:"var(--oh-grey-surface)",...(item.row===draft.expected?authoringSelectedStyle:{}),borderRadius:10,padding:"0.65rem",minWidth:0}}>
             <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,flexWrap:"wrap"}}>
               <strong style={{fontSize:13,overflowWrap:"anywhere"}}>{names.get(item.a)||item.a} ↔ {names.get(item.b)||item.b}</strong>
               <span style={{fontSize:12,fontWeight:750}}>{formatScore(item.row.score)} · {relationBandForScore(item.row.score)}</span>
             </div>
             {item.row.summary&&<p style={{...muted,overflowWrap:"anywhere",margin:"5px 0"}}>{item.row.summary}</p>}
             {item.editable?<button type="button" disabled={busy} style={{...button,marginTop:6}} onClick={()=>select(item)}>Edit relationship</button>:<div style={muted}>Unresolved or conflicting identity - read only.</div>}
           </article>)}
           {!filtered.length&&<div style={muted}>No matching authored relationships.</div>}
         </div>
       </section>
       <section className="oh-scenario-relation-detail">
         <div style={authoringTitleStyle}>{draft.expected?"Edit relationship":"Add relationship"}</div>
         <label style={label}>First polity{selectPolity("a","b")}</label>
         <label style={label}>Second polity{selectPolity("b","a")}</label>
         <label style={label}>Relationship score (-100 to +100)<input type="number" min="-100" max="100" step="1" style={input} value={draft.score} disabled={busy} onChange={e=>patch("score",e.target.value)} placeholder="Enter a whole number"/></label>
         {draft.score.trim()!==""&&Number.isInteger(Number(draft.score))&&Math.abs(Number(draft.score))<=100&&<div style={muted}>Diplomatic climate: <strong>{relationBandForScore(Number(draft.score))}</strong></div>}
         <label style={label}>Diplomatic description<textarea style={{...input,resize:"vertical",lineHeight:1.5}} rows={5} value={draft.summary} disabled={busy} onChange={e=>patch("summary",e.target.value)} placeholder="Historical context, grievances or reasons for cooperation"/></label>
         <div style={muted}>{draft.summary.length} / {MAX_STARTING_RELATION_SUMMARY} characters for new descriptions. The description becomes native diplomatic context for the simulation.</div>
         <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
           <button type="button" style={button} disabled={busy||!draft.a||!draft.b||!draft.score.trim()} onClick={()=>save()}>Save relationship</button>
           {draft.expected&&<button type="button" style={button} disabled={busy} onClick={()=>save(true)}>Unset relationship</button>}
           <button type="button" style={button} disabled={busy} onClick={()=>select(null)}>Cancel edits</button>
         </div>
         {error&&<div role="alert" style={{color:"#fca5a5",fontSize:12}}>{error}</div>}
         {message&&<div role="status" style={{fontSize:12,color:"var(--oh-grey-text)"}}>{message}</div>}
         {busy&&<div role="status" style={muted}>Saving or refreshing relations...</div>}
       </section>
     </div>
   </dialog>,document.body)}
 </section>;
}
