/*! Open Historia - Campaign Lore preview and export. AGPL-3.0-or-later. */
import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { APP_HEIGHT, SAFE_TOP, SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT } from "../../runtime/mobileUi.js";
import { copyToClipboard } from "../../runtime/clipboard.js";
import { saveTextToDisk } from "../../runtime/saveFile.js";
import { captureCampaignLore } from "../../runtime/campaignLoreRead.js";
import { campaignLoreMarkdown, campaignLoreFileName, LORE_DEFAULT_OPTIONS } from "../../runtime/campaignLore.js";
import { getLibraryState } from "../../runtime/library.js";
import { inSharedGame } from "../../multiplayer/client/sharedGameBridge.js";
import { isSimulationBusy } from "../AI/simulationStatus.js";
import { planCampaignChronicle, generateCampaignChronicle, campaignChronicleMarkdown, CHRONICLE_MAX_INPUT_BYTES } from "../AI/campaignChronicle.js";

const field={border:"1px solid var(--oh-ui-line, #394653)",background:"var(--oh-ui-overlay-card, #202c38)",borderRadius:8,color:"inherit",padding:"0.55rem 0.7rem",font:"inherit",minWidth:0,colorScheme:"dark"};
const button={...field,cursor:"pointer",fontWeight:700,minHeight:"2.5rem"};
const muted={color:"var(--oh-ui-muted, #a9b6c5)",fontSize:"0.78rem",lineHeight:1.5};
const PAGE_SIZE=30;

export const CampaignLorePanel=({campaignId, gameName, scenarioName, countryName, startDate, currentDate, onClose})=>{
  const dialog=useRef(null);
  const request=useRef(0);
  const mounted=useRef(false);
  const chronicleAbort=useRef(null);
  const [options,setOptions]=useState({...LORE_DEFAULT_OPTIONS,to:currentDate||""});
  const [snapshot,setSnapshot]=useState(null);
  const [status,setStatus]=useState("");
  const [busy,setBusy]=useState(false);
  const [page,setPage]=useState(0);
  const [textPage,setTextPage]=useState(0);
  const [stale,setStale]=useState(false);
  const [chronicle,setChronicle]=useState(null);
  const [chronicleBusy,setChronicleBusy]=useState(false);
  const [chronicleStatus,setChronicleStatus]=useState("");
  const [requests,setRequests]=useState(0);
  useEffect(()=>{
    const el=dialog.current;
    mounted.current=true;
    el?.showModal();
    return ()=>{mounted.current=false; chronicleAbort.current?.abort(); if(el?.open)el.close();};
  },[]);
  useEffect(()=>{
    const invalidate=()=>{setStale(true);chronicleAbort.current?.abort();};
    const close=()=>onClose();
    window.addEventListener("oh:runtime-json-updated",invalidate);
    window.addEventListener("oh:rolled-back",invalidate);
    window.addEventListener("oh:active-game-changed",close);
    return ()=>{
      window.removeEventListener("oh:runtime-json-updated",invalidate);
      window.removeEventListener("oh:rolled-back",invalidate);
      window.removeEventListener("oh:active-game-changed",close);
    };
  },[onClose]);
  const clearChronicle=()=>{setChronicle(null);setChronicleStatus("");setRequests(0);};
  const change=(key,value)=>{setOptions(old=>({...old,[key]:value}));setSnapshot(null);clearChronicle();setStatus("");setPage(0);setTextPage(0);};
  const update=async()=>{
    const seq=++request.current;
    setBusy(true);setSnapshot(null);clearChronicle();setStatus("");setStale(false);setPage(0);setTextPage(0);
    try {
      const lore=await captureCampaignLore(options);
      if(!mounted.current||seq!==request.current)return;
      if(getLibraryState().activeGameId!==campaignId || inSharedGame())throw new Error("Campaign changed. Reopen Campaign Lore.");
      setSnapshot(lore);
    }catch(error){if(mounted.current&&seq===request.current)setStatus(error?.message||"Unable to read campaign history.");}
    finally{if(mounted.current&&seq===request.current)setBusy(false);}
  };
  const markdown=useMemo(()=>snapshot?campaignLoreMarkdown(snapshot):"",[snapshot]);
  const bytes=useMemo(()=>new TextEncoder().encode(markdown).length,[markdown]);
  const plan=useMemo(()=>snapshot?planCampaignChronicle(snapshot):null,[snapshot]);
  const valid=()=>snapshot && !stale && !busy && !isSimulationBusy() && getLibraryState().activeGameId===campaignId && !inSharedGame();
  const runChronicle=async()=>{
    if(!valid()||!plan?.fits||chronicleAbort.current)return;
    const controller=new AbortController();
    chronicleAbort.current=controller;
    setChronicleBusy(true);clearChronicle();
    try{
      const result=await generateCampaignChronicle(plan,{signal:controller.signal,onRequest:()=>{if(mounted.current&&!controller.signal.aborted)setRequests(n=>n+1);}});
      if(mounted.current&&!controller.signal.aborted&&getLibraryState().activeGameId===campaignId&&!inSharedGame()&&!isSimulationBusy())setChronicle(result);
    }catch(error){
      if(mounted.current)setChronicleStatus(controller.signal.aborted?"Chronicle cancelled. The native record remains available.":error?.message||"Chronicle generation failed. The native record remains available.");
    }finally{
      if(chronicleAbort.current===controller)chronicleAbort.current=null;
      if(mounted.current)setChronicleBusy(false);
    }
  };
  const saveChronicle=async(copyOnly)=>{
    if(!valid()||!chronicle)return;
    const content=campaignChronicleMarkdown(chronicle);
    try{
      if(copyOnly)setChronicleStatus(await copyToClipboard(content)?"Copied AI chronicle.":"Clipboard unavailable. Download the chronicle instead.");
      else{await saveTextToDisk(content,campaignLoreFileName(snapshot).replace(/\.md$/,"-chronicle.md"),"text/markdown;charset=utf-8");setChronicleStatus("Chronicle export prepared.");}
    }catch(error){setChronicleStatus(error?.message||"Unable to export the chronicle.");}
  };
  const download=async(format)=>{
    if(!valid()){setStatus("Refresh the preview before exporting.");return;}
    try{
      const json=format==="json";
      await saveTextToDisk(json?JSON.stringify(snapshot,null,2)+"\n":markdown,campaignLoreFileName(snapshot,format),json?"application/json":"text/markdown;charset=utf-8");
      setStatus("Export prepared.");
    }catch(error){setStatus(error?.message||"Unable to save the record.");}
  };
  const copy=async()=>{
    if(!valid()){setStatus("Refresh the preview before exporting.");return;}
    setStatus(await copyToClipboard(markdown)?"Copied campaign record.":"Clipboard unavailable. Download Markdown instead.");
  };
  const disabled=!snapshot||busy||stale;
  const close=()=>{request.current++;chronicleAbort.current?.abort();onClose();};
  return createPortal(<dialog ref={dialog} aria-label="Campaign Lore" onCancel={event=>{event.preventDefault();close();}} style={{position:"fixed",inset:0,margin:"auto",padding:0,width:"56rem",maxWidth:`calc(100vw - 1.5rem - ${SAFE_LEFT} - ${SAFE_RIGHT})`,maxHeight:`calc(${APP_HEIGHT} - 1.5rem - ${SAFE_TOP} - ${SAFE_BOTTOM})`,border:"1px solid var(--oh-ui-line, #415264)",borderRadius:14,background:"var(--oh-ui-panel, #14202d)",color:"var(--oh-ui-text, #f1f5f9)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <style>{'dialog[aria-label="Campaign Lore"]::backdrop { background: rgba(0,0,0,.66); }'}</style>
    <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",padding:"1rem 1.2rem",borderBottom:"1px solid var(--oh-ui-line, #394653)"}}>
      <div><div style={{fontSize:"1.15rem",fontWeight:850}}>Campaign Lore</div><div style={muted}>Read and export your campaign's recorded history.</div></div>
      <button type="button" onClick={close} style={button}>Close</button>
    </header>
    <div style={{overflowY:"auto",minHeight:0,padding:"1rem 1.2rem",display:"grid",gap:"1rem"}}>
      <section style={{display:"grid",gap:"0.3rem"}}>
        <strong data-no-translate>{gameName}</strong>
        <span style={muted} data-no-translate>{[scenarioName,countryName,startDate&&currentDate?startDate+" - "+currentDate:currentDate].filter(Boolean).join(" · ")}</span>
        <span style={muted}>Native record · No AI requests · Not a reloadable save</span>
      </section>
      <section style={{display:"grid",gap:"0.7rem",padding:"0.85rem",border:"1px solid var(--oh-ui-line, #394653)",borderRadius:10}}>
        <strong>Export coverage</strong>
        <label style={{display:"grid",gap:4}}>History scope<select style={field} disabled={busy||chronicleBusy} value={options.scope} onChange={e=>change("scope",e.target.value)}><option value="global">World history</option><option value="player">Player-focused history</option></select></label>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(9rem,1fr))",gap:"0.65rem"}}>
          <label style={{display:"grid",gap:4}}>From game date<input style={field} disabled={busy||chronicleBusy} placeholder="All retained dates" value={options.from} onChange={e=>change("from",e.target.value)} /></label>
          <label style={{display:"grid",gap:4}}>Through game date<input style={field} disabled={busy||chronicleBusy} placeholder="Current game date" value={options.to} onChange={e=>change("to",e.target.value)} /></label>
        </div>
        {[
          ["snapshot","Current world snapshot"],
          ["actions","My retained orders, private projects and standing goal"],
          ["conversations","My advisor and diplomatic conversations"],
          ["transcripts","Completed interactive event transcripts"],
        ].map(([key,label])=><label key={key} style={{display:"flex",alignItems:"flex-start",gap:"0.55rem",fontSize:"0.85rem"}}><input type="checkbox" disabled={busy||chronicleBusy} checked={options[key]} onChange={e=>change(key,e.target.checked)} />{label}</label>)}
        <div style={muted}>Private sections are optional. Intelligence and hidden seat records are excluded. Review any personal text before sharing.</div>
        <button type="button" disabled={busy||chronicleBusy} onClick={update} style={{...button,background:"var(--oh-ui-active, #30455c)"}}>{busy?"Reading campaign…":snapshot?"Refresh preview":"Generate preview"}</button>
      </section>
      {stale&&snapshot&&<div role="status" style={muted}>The campaign changed. Refresh the preview before exporting.</div>}
      {snapshot&&<section style={{display:"grid",gap:"0.65rem"}}>
        <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",justifyContent:"space-between",gap:"0.5rem"}}>
          <strong>Recorded chronology</strong><span data-no-translate style={muted}>{snapshot.coverage.eventCount} events · {Math.round(bytes/1024)} KiB (Markdown)</span>
        </div>
        <div style={muted}>The download contains all selected records, not just this preview page.</div>
        <div style={{display:"flex",gap:"0.5rem",alignItems:"center",justifyContent:"space-between"}}>
          <button type="button" style={button} disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous</button>
          <span data-no-translate style={muted}>{page+1} / {Math.max(1,Math.ceil(snapshot.events.length/PAGE_SIZE))}</span>
          <button type="button" style={button} disabled={(page+1)*PAGE_SIZE>=snapshot.events.length} onClick={()=>setPage(p=>p+1)}>Next</button>
        </div>
        {!snapshot.events.length&&<div style={muted}>No matching retained events.</div>}
        {snapshot.events.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map((event,index)=><details key={event.id+":"+index} style={{border:"1px solid var(--oh-ui-line, #394653)",padding:"0.65rem",borderRadius:8}}>
          <summary style={{cursor:"pointer",fontSize:"0.86rem"}}><span data-no-translate>{event.date||"Undated"} - {event.title||"Untitled event"}</span></summary>
          <div data-no-translate style={{fontSize:"0.85rem",whiteSpace:"pre-wrap",overflowWrap:"anywhere",lineHeight:1.6,paddingTop:"0.6rem"}}>{event.description}</div>
          {event.interactiveTranscript&&<div style={muted}>Completed transcript included in export.</div>}
        </details>)}
        <div style={muted}><span>Optional records included:</span> <span data-no-translate>{snapshot.actions.length} orders · {snapshot.diplomacy.length} diplomatic threads · {snapshot.advisor.length} advisor messages</span></div>
        <details><summary style={{cursor:"pointer",fontSize:"0.82rem"}}>Full record text preview</summary>
          <div style={muted}>Review the exact Markdown export, including selected private material. Pages here are only for reading; downloads contain the entire selected record.</div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"0.5rem",margin:"0.5rem 0"}}>
            <button type="button" style={button} disabled={textPage===0} onClick={()=>setTextPage(p=>p-1)}>Previous</button>
            <span data-no-translate style={muted}>{textPage+1} / {Math.max(1,Math.ceil(markdown.length/12000))}</span>
            <button type="button" style={button} disabled={(textPage+1)*12000>=markdown.length} onClick={()=>setTextPage(p=>p+1)}>Next</button>
          </div>
          <pre data-no-translate style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:"0.8rem",maxHeight:"20rem",overflowY:"auto",margin:0,padding:"0.6rem",border:"1px solid var(--oh-ui-line, #394653)",borderRadius:8}}>{markdown.slice(textPage*12000,(textPage+1)*12000)}</pre>
        </details>
        <details><summary style={{cursor:"pointer",fontSize:"0.82rem"}}>Coverage and limitations</summary><ul style={muted}>{snapshot.coverage.limitations.map(text=><li key={text} data-no-translate>{text}</li>)}</ul></details>
      </section>}
      {snapshot&&<section style={{display:"grid",gap:"0.7rem",padding:"0.85rem",border:"1px solid var(--oh-ui-line, #394653)",borderRadius:10}}>
        <strong>AI-generated campaign chronicle</strong>
        <div style={muted}>Optional narrative summary of the selected record. Generation sends these selected records to your configured AI provider. One generation request, with normal configured provider fallback and retry behavior; this may consume more than one provider request. Normal AI telemetry settings apply.</div>
        {!plan?.fits&&<div style={muted}>The selected record exceeds the AI input limit. Narrow the dates or deselect optional sections. Your native export is not limited.</div>}
        <div style={muted}><span>AI input size:</span> <span data-no-translate>{Math.ceil((plan?.bytes||0)/1024)} / {CHRONICLE_MAX_INPUT_BYTES/1024} KiB</span></div>
        <div style={{display:"flex",flexWrap:"wrap",gap:"0.5rem",alignItems:"center"}}>
          <button type="button" disabled={disabled||chronicleBusy||!plan?.fits} onClick={runChronicle} style={button}>{chronicleBusy?"Generating chronicle…":"Generate AI chronicle"}</button>
          {chronicleBusy&&<button type="button" style={button} onClick={()=>chronicleAbort.current?.abort()}>Cancel</button>}
          {(chronicleBusy||requests>0)&&<span style={muted}>Provider requests: <span data-no-translate>{requests}</span></span>}
        </div>
        {chronicleStatus&&<div role="status" style={muted}>{chronicleStatus}</div>}
        {chronicle&&!stale&&<div style={{display:"grid",gap:"0.8rem"}}>
          <div style={muted}>AI-generated summary. References checked against the source record; narrative claims are not independently fact-checked.</div>
          <div style={muted}><span>Referenced source records:</span> <span data-no-translate>{chronicle.referencedCount} / {chronicle.suppliedCount}</span></div>
          {chronicle.sections.map((section,index)=><section key={index} style={{borderTop:"1px solid var(--oh-ui-line, #394653)",paddingTop:"0.7rem"}}>
            <div data-no-translate style={{fontWeight:800}}>{section.title}</div>
            <p data-no-translate style={{fontSize:"0.86rem",lineHeight:1.65,whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{section.text}</p>
            <div style={muted}>Sources: <span data-no-translate>{section.references.join(", ")}</span></div>
          </section>)}
          <details><summary>Source reference index</summary><ul style={muted}>{chronicle.sources.map(source=><li key={source.ref} data-no-translate>{source.ref}: {source.title} {source.titleDate||""} {source.sourceId||""}</li>)}</ul></details>
          <div style={{display:"flex",flexWrap:"wrap",gap:"0.5rem"}}>
            <button type="button" disabled={disabled||chronicleBusy} style={button} onClick={()=>saveChronicle(false)}>Download chronicle</button>
            <button type="button" disabled={disabled||chronicleBusy} style={button} onClick={()=>saveChronicle(true)}>Copy chronicle</button>
          </div>
        </div>}
      </section>}
      {status&&<div role="status" style={muted}>{status}</div>}
    </div>
    <footer style={{display:"flex",flexWrap:"wrap",gap:"0.5rem",padding:"0.85rem 1.2rem",borderTop:"1px solid var(--oh-ui-line, #394653)"}}>
      <button type="button" disabled={disabled} onClick={()=>download("md")} style={{...button,background:"var(--oh-ui-active, #30455c)",opacity:disabled?0.5:1}}>Download Markdown</button>
      <button type="button" disabled={disabled} onClick={()=>download("json")} style={{...button,opacity:disabled?0.5:1}}>Download JSON</button>
      <button type="button" disabled={disabled} onClick={copy} style={{...button,opacity:disabled?0.5:1}}>Copy record</button>
    </footer>
  </dialog>,document.body);
};
export default CampaignLorePanel;
