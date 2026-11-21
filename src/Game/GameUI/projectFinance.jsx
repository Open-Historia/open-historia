/*! Open Historia - Projects financing review and ledger. AGPL-3.0-or-later. */
import React,{useEffect,useMemo,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {captureFinanceReview,commitFinanceReview} from "../../runtime/projectFinanceReview.js";
import {financeSourceText} from "../../runtime/projectFinanceWorld.js";
import {projectFinanceSnapshot,projectFinanceDrawAmount} from "../../runtime/projectFinance.js";
import {projectOwnerOf,ownerMeans} from "../../runtime/projectEngine.js";
import {isProjectOpen,isBelief} from "../../runtime/projects.js";
import {formatEconomicDisplayValue} from "../../runtime/economicDisplayCurrency.js";
import {compareGameDates,addGameDays} from "../../runtime/gameDates.js";
import {reviewRecordedLoan} from "../AI/projectFinanceReview.js";
import {uiString} from "../../runtime/translator.js";
import {APP_HEIGHT, SAFE_TOP, SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT} from "../../runtime/mobileUi.js";

const field={border:"1px solid var(--oh-ui-line,#394653)",background:"var(--oh-ui-overlay-card,#202c38)",borderRadius:8,color:"inherit",padding:"0.55rem 0.7rem",font:"inherit",minWidth:0,colorScheme:"dark",width:"100%",boxSizing:"border-box"};
const button={...field,width:"auto",cursor:"pointer",fontWeight:700,minHeight:"2.35rem"};
const muted={color:"var(--oh-ui-muted,#a9b6c5)",fontSize:"0.78rem",lineHeight:1.5};
const card={border:"1px solid var(--oh-ui-line,#394653)",borderRadius:10,padding:"0.85rem",display:"grid",gap:"0.65rem",background:"var(--oh-ui-overlay-card,#182530)"};
const flex={display:"flex",alignItems:"center",gap:"0.55rem",flexWrap:"wrap"};
const grid={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,205px),1fr))",gap:"0.7rem"};
const blank={sourceId:"",lenderId:"",currency:"",minorDigits:"2",originalLimit:"",limit:"",basis:"",rate:"",maturity:"",projectIds:[],projectId:"",originalDraw:"",supplier:"",payment:"cash",debtTreatment:"",amount:"",bucketId:""};
const minor=(text,digits=2,allowZero=false)=>{
  if(!Number.isInteger(digits)||digits<0||digits>6||typeof text!=="string"||text.length>40||!/^\d+(?:\.\d+)?$/.test(text.trim()))throw new Error("Enter an exact decimal amount without thousands separators.");
  const [whole,fraction=""]=text.trim().split(".");
  if(fraction.length>digits)throw new Error("The amount has too many decimal places for the selected denomination.");
  const n=Number(BigInt(whole)*10n**BigInt(digits)+BigInt(fraction.padEnd(digits,"0")||"0"));
  if(!Number.isSafeInteger(n)||n<0||(!allowZero&&!n))throw new Error("Enter a positive amount within the accounting range.");
  return n;
};
const major=(n,d=2)=>{const s=String(n).padStart(d+1,"0");return d?s.slice(0,-d)+"."+s.slice(-d):s;};
const Label=({name,children})=><label style={{display:"grid",gap:4,fontSize:"0.79rem",minWidth:0}}><span>{uiString(name)}</span>{children}</label>;

export const ProjectFinancePanel=({displayCurrency,onClose})=>{
  const dialog=useRef(null),mounted=useRef(false),abort=useRef(null);
  const [review,setReview]=useState(null),[busy,setBusy]=useState(true),[status,setStatus]=useState("");
  const [mode,setMode]=useState("list"),[facilityId,setFacilityId]=useState(""),[form,setForm]=useState(blank),[query,setQuery]=useState("");
  const [confirmed,setConfirmed]=useState(false),[draft,setDraft]=useState(null),[aiBusy,setAiBusy]=useState(false),[stale,setStale]=useState(false);
  const committing=useRef(false);
  const refresh=async()=>{
    setBusy(true);setStatus("");setStale(false);setConfirmed(false);
    try{const data=await captureFinanceReview();if(mounted.current)setReview(data);}
    catch(e){if(mounted.current){setReview(null);setStatus(e.message);}}
    finally{if(mounted.current)setBusy(false);}
  };
  useEffect(()=>{
    const el=dialog.current;mounted.current=true;el?.showModal();void refresh();
    return()=>{mounted.current=false;abort.current?.abort();if(el?.open)el.close();};
  },[]);
  useEffect(()=>{
    const invalidate=()=>{if(!committing.current){setStale(true);setConfirmed(false);abort.current?.abort();}};
    const close=()=>onClose();
    for(const event of ["oh:runtime-json-updated","oh:rolled-back","oh:unseen-events-changed"])window.addEventListener(event,invalidate);
    window.addEventListener("oh:active-game-changed",close);
    return()=>{for(const event of ["oh:runtime-json-updated","oh:rolled-back","oh:unseen-events-changed"])window.removeEventListener(event,invalidate);window.removeEventListener("oh:active-game-changed",close);};
  },[onClose]);
  const facilities=useMemo(()=>review?projectFinanceSnapshot(review.world.projectFinance,review.game.gameDate).filter(f=>f.terms.borrower===review.actor):[],[review]);
  const projects=useMemo(()=>review?(review.world.projects??[]).filter(p=>projectOwnerOf(p,review.actor)===review.actor&&isProjectOpen(p)&&!isBelief(p)&&p.plan?.monthlyCost>0):[],[review]);
  const lenders=useMemo(()=>review?[...new Set([...Object.keys(review.world.polityOverrides??{}),...Object.keys(review.world.countryStats??{})])].filter(n=>n!==review.actor).sort((a,b)=>a.localeCompare(b)):[],[review]);
  const f=facilities.find(x=>x.terms.facilityId===facilityId);
  const source=review?.events.find(e=>e.id===form.sourceId);
  const needsSource=["authorize","draw","return"].includes(mode);
  const sourceRows=useMemo(()=>review?[...review.events].filter(e=>!query||String(e.title+" "+e.description).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>compareGameDates(b.date,a.date)):[],[review,query]);
  const update=(key,value)=>{
    // Do not leave extracted values from a different source in a new review.
    if(key==="sourceId"){setDraft(null);setForm(old=>({...old,...(mode==="authorize"?{lenderId:"",currency:"",minorDigits:"2",originalLimit:"",limit:"",basis:"",rate:"",maturity:""}:mode==="draw"?{originalDraw:"",supplier:"",payment:"cash",debtTreatment:""}:{}),sourceId:value}));}
    else setForm(old=>({...old,[key]:value}));
    setConfirmed(false);setStatus("");
  };
  const switchMode=(next,facility=null,bucket=null)=>{
    setMode(next);setFacilityId(facility?.terms.facilityId||"");setQuery("");setDraft(null);setConfirmed(false);setStatus("");
    setForm({...blank,...(facility?{sourceId:next==="draw"?facility.terms.sourceEventId:"",projectId:facility.terms.projectIds.length===1?facility.terms.projectIds[0]:""}:{}),bucketId:bucket?.id||""});
  };
  const amountDisplay=n=>formatEconomicDisplayValue(n/100,displayCurrency,{compact:false});
  const canon=n=>"$"+(n/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const projectName=id=>review?.world.projects?.find(p=>p.id===id)?.name||id;
  const drawPreview=()=>{
    if(!f||mode!=="draw")return null;
    try{return projectFinanceDrawAmount(f,minor(form.originalDraw,f.terms.minorDigits));}catch{return null;}
  };
  const extract=async()=>{
    if(!source||aiBusy||stale||busy)return;
    const controller=new AbortController();abort.current=controller;setAiBusy(true);setStatus("");setConfirmed(false);
    try{
      const d=await reviewRecordedLoan(source,{signal:controller.signal});
      if(!mounted.current||controller.signal.aborted)return;
      setDraft(d);
      setForm(old=>({...old,...(mode==="authorize"?{lenderId:lenders.includes(d.lender)?d.lender:old.lenderId,currency:d.currency||old.currency,
        originalLimit:d.originalLimit||old.originalLimit,rate:d.annualRate||old.rate,maturity:d.maturity||old.maturity}:
        {supplier:d.supplier||old.supplier,payment:d.supplier?"supplier":old.payment})}));
    }catch(e){if(mounted.current&&!controller.signal.aborted)setStatus(e.message);}
    finally{if(abort.current===controller)abort.current=null;if(mounted.current)setAiBusy(false);}
  };
  const commit=async()=>{
    if(!review||stale||busy||aiBusy||!confirmed||committing.current)return;
    try{
      const evidence=source?{sourceId:source.id,expectedSource:financeSourceText(source)}:{};
      let command={type:mode,confirmed:true,...evidence};
      if(needsSource&&!source)throw new Error("Select the recorded agreement or disbursement event.");
      if(mode==="authorize"){
        const digits=form.minorDigits.trim()===""?NaN:Number(form.minorDigits);
        command={...command,lenderId:form.lenderId,projectIds:form.projectIds,currency:form.currency.trim(),minorDigits:digits,
          originalLimitMinor:minor(form.originalLimit,digits),limitMinor:minor(form.limit),equivalenceBasis:form.basis.trim(),
          annualRateBps:minor(form.rate,2,true),maturity:form.maturity};
      }else if(mode==="draw"){
        if(!f)throw new Error("Select a facility.");
        const originalMinor=minor(form.originalDraw,f.terms.minorDigits);
        command={...command,facilityId,projectId:form.projectId||null,originalMinor,amountMinor:projectFinanceDrawAmount(f,originalMinor),
          supplierId:form.payment==="supplier"?form.supplier.trim():null,debtTreatment:form.debtTreatment};
      }else{
        if(!f)throw new Error("Select a facility.");
        command={...command,id:"finance:"+crypto.randomUUID(),facilityId,bucketId:form.bucketId,amountMinor:minor(form.amount)};
        if(mode==="allocate")command.projectId=form.projectId;
      }
      committing.current=true;setBusy(true);setStatus("");
      await commitFinanceReview(review,command);
      if(mounted.current){setMode("list");setForm(blank);await refresh();setStatus("Financing record saved.");}
    }catch(e){if(mounted.current)setStatus(e.message);}
    finally{committing.current=false;if(mounted.current)setBusy(false);}
  };
  const input=(key,placeholder="",props={})=><input style={field} value={form[key]} placeholder={placeholder} disabled={busy||aiBusy} onChange={e=>update(key,e.target.value)} {...props}/>;
  const select=(key,choices,empty)=><select style={field} value={form[key]} disabled={busy||aiBusy} onChange={e=>update(key,e.target.value)}><option value="">{uiString(empty)}</option>{choices.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>;
  const mayEdit=review&&!stale&&!busy&&!aiBusy;
  const means=review?ownerMeans(review.world,review.actor,review.world.projects,review.actor):null;
  return createPortal(<dialog ref={dialog} aria-label="Project Finance" onCancel={e=>{e.preventDefault();if(!committing.current)onClose();}} style={{border:"1px solid var(--oh-ui-line,#394653)",borderRadius:14,background:"var(--oh-ui-panel,#14202d)",color:"var(--oh-ui-text,#f1f5f9)",position:"fixed",inset:0,margin:"auto",width:"51.25rem",maxWidth:`calc(100vw - 1.5rem - ${SAFE_LEFT} - ${SAFE_RIGHT})`,maxHeight:`calc(${APP_HEIGHT} - 1.5rem - ${SAFE_TOP} - ${SAFE_BOTTOM})`,padding:0,overflow:"auto",boxShadow:"0 24px 80px #0008",fontFamily:"inherit"}}>
    <style>{'dialog[aria-label="Project Finance"]::backdrop { background: rgba(0,0,0,.66); }'}</style>
    <header style={{...flex,position:"sticky",top:0,zIndex:2,background:"var(--oh-ui-panel,#14202d)",borderBottom:"1px solid var(--oh-ui-line,#394653)",padding:"0.9rem 1.1rem",justifyContent:"space-between"}}>
      <div><strong style={{fontSize:"1.1rem"}}>Project Finance</strong><div style={muted}>Recorded agreements, finite funds and debt service</div></div>
      <button style={button} disabled={committing.current} onClick={onClose}>Close</button>
    </header>
    <main style={{padding:"1rem 1.1rem",display:"grid",gap:"0.85rem",fontSize:"0.88rem"}}>
      {busy&&!review&&<div role="status">Loading financing record...</div>}
      {status&&<div role="status" style={{...muted,border:"1px solid var(--oh-ui-line,#394653)",borderRadius:8,padding:"0.65rem"}}>{status}</div>}
      {stale&&<div style={card}><strong>Campaign changed</strong><span style={muted}>Refresh before confirming any financial record.</span><button style={button} disabled={busy||aiBusy} onClick={async()=>{switchMode("list");await refresh();}}>Refresh record</button></div>}
      {!review&&!busy&&<button style={button} onClick={refresh}>Refresh record</button>}
      {review&&mode==="list"&&<>
        <div style={grid}>
          <div style={card}><span style={muted}>Estimated recurring allowance / month</span><strong>{means?.budget==null?"Not assessed":amountDisplay(Math.round(means.budget*100))}</strong></div>
          <div style={card}><span style={muted}>Outstanding tracked loan principal</span><strong>{amountDisplay(facilities.reduce((n,x)=>n+x.outstandingMinor,0))}</strong></div>
        </div>
        <div style={muted}>Loan proceeds are a finite stock, not an increase to the monthly allowance. At maturity, recorded interest and principal are serviced from the authorized project allowance. Shortfalls remain arrears. Only recorded agreements may be booked; negotiations alone do not create funds. Completion estimates are withheld while finite funding or debt service can change the pace. Campaigns with finance records cannot be hosted as shared games yet.</div>
        {facilities.map(x=><section style={card} key={x.terms.facilityId}>
          <div style={{...flex,justifyContent:"space-between"}}><strong>{x.terms.lenderId}</strong><span style={muted}>{x.drawnMinor?"Disbursed":"Signed, undrawn"}</span></div>
          <div><strong data-no-translate>{major(x.terms.originalLimitMinor,x.terms.minorDigits)} {x.terms.currency}</strong><div style={muted}>Original contractual denomination</div></div>
          <div style={grid}>{[
            ["Authorized equivalent",amountDisplay(x.terms.limitMinor)],["Undrawn credit",amountDisplay(x.undrawnMinor)],
            ["Remaining project funds",amountDisplay(x.remainingMinor)],["Applied to eligible costs",amountDisplay(x.costAppliedMinor)],
            ["Principal outstanding",amountDisplay(x.outstandingMinor)],["Accrued interest",amountDisplay(x.interestDueMinor)],
            ["Principal repaid",amountDisplay(x.principalPaidMinor)],["Interest paid",amountDisplay(x.interestPaidMinor)],
            ["Principal and interest arrears",amountDisplay(x.arrearsPrincipalMinor+x.arrearsInterestMinor)],["Maturity",x.terms.maturity]
          ].map(([k,v])=><div key={k}><div style={muted}>{k}</div><strong data-no-translate>{v}</strong></div>)}</div>
          <div style={muted}>Annual interest: {x.terms.annualRateBps/100}% · Actual/365 · Single maturity. Source: {review.events.find(e=>e.id===x.terms.sourceEventId)?.title||x.terms.sourceEventId}</div>
          <div style={muted}>Eligible projects: {x.terms.projectIds.map(projectName).join(", ")}</div>
          {x.buckets.filter(b=>b.remainingMinor>0).map(b=><div key={b.id} style={{...card,padding:"0.6rem"}}>
            <div style={flex}><strong>{amountDisplay(b.remainingMinor)}</strong><span style={muted}>{b.supplierId?"Supplier prepayment: "+b.supplierId:b.projectId?"Earmarked cash":"Unallocated cash"}</span></div>
            <div style={muted}>{b.projectId?projectName(b.projectId):"Not assigned to a project"} · Eligible from {b.eligibleFrom}</div>
            {!b.supplierId&&<div style={flex}>{b.projectId?<button style={button} disabled={!mayEdit} onClick={()=>switchMode("release",x,b)}>Release earmark</button>:<>
              <button style={button} disabled={!mayEdit} onClick={()=>switchMode("allocate",x,b)}>Allocate funds</button>
              <button style={button} disabled={!mayEdit} onClick={()=>switchMode("return",x,b)}>Record returned funds</button>
            </>}</div>}
          </div>)}
          {x.undrawnMinor>0&&compareGameDates(review.game.gameDate,x.terms.maturity)<0&&<div><button style={button} disabled={!mayEdit} onClick={()=>switchMode("draw",x)}>Review disbursement</button></div>}
          <details style={muted}><summary>Accounting basis and receipt history</summary><p>{x.terms.equivalenceBasis}</p>{review.world.projectFinance.receipts.filter(r=>r.facilityId===x.terms.facilityId).slice(-30).map(r=><div key={r.id} data-no-translate>{r.date} · {r.type} · {r.amountMinor?canon(r.amountMinor):r.type==="service"?canon(r.interestMinor+r.principalMinor):r.sourceEventId||""}</div>)}<span>Showing up to 30 latest receipts; all are retained in the save.</span></details>
        </section>)}
        {!facilities.length&&<div style={card}><strong>No recorded facilities</strong><span style={muted}>Select a completed loan agreement from your campaign's events and review its exact terms. Unknown amounts must remain unbooked.</span></div>}
        <button style={button} disabled={!mayEdit||!projects.length} onClick={()=>switchMode("authorize")}>Review signed agreement</button>
      </>}
      {review&&mode!=="list"&&<>
        <div style={flex}><button style={button} disabled={busy||aiBusy} onClick={()=>switchMode("list")}>Back to financing</button><strong>{({authorize:"Signed agreement",draw:"Actual disbursement",allocate:"Allocate funds",release:"Release earmark",return:"Return unallocated funds"})[mode]}</strong></div>
        {needsSource&&<section style={card}>
          <Label name="Find recorded source"><input style={field} value={query} disabled={busy||aiBusy} onChange={e=>setQuery(e.target.value)} placeholder="Search recorded event titles or text..."/></Label>
          <Label name="Source event">{select("sourceId",[...(source&&!sourceRows.some(e=>e.id===source.id)?[[source.id,source.date+" - "+source.title]]:[]),...sourceRows.map(e=>[e.id,e.date+" - "+e.title])],"Select source event")}</Label>
          {source&&<div style={{...muted,whiteSpace:"pre-wrap",maxHeight:"12rem",overflowY:"auto",overflowWrap:"anywhere"}} data-no-translate>{source.description}</div>}
          {source&&mode!=="return"&&<div style={flex}><button style={button} disabled={!mayEdit} onClick={extract}>Extract recorded terms with AI</button>{aiBusy&&<button style={button} onClick={()=>abort.current?.abort()}>Cancel</button>}<span style={muted}>Optional provider request. Draft only; no money is booked.</span></div>}
          {draft&&<div style={muted}>Review draft against source. {draft.evidence?<><div data-no-translate>{draft.evidence}</div><div data-no-translate>{draft.conditions}</div></>:"No verifiable loan terms extracted."} {mode==="draw"&&(draft.originalDraw?<div>AI-suggested original amount: <strong data-no-translate>{draft.originalDraw}</strong>. Enter it only if the source explicitly records that payment.</div>:<strong>Tranche amount not established; do not estimate it.</strong>)}</div>}
        </section>}
        {mode==="authorize"&&<section style={card}>
          <div style={grid}>
            <Label name="Registered lender">{select("lenderId",lenders.map(n=>[n,n]),"Select foreign lender")}</Label>
            <Label name="Contract currency">{input("currency","e.g. Bulgarian lev")}</Label>
            <Label name="Contract decimal places">{input("minorDigits","2",{type:"number",min:0,max:6,step:1})}</Label>
            <Label name="Signed credit limit (original currency)">{input("originalLimit","Exact recorded amount",{inputMode:"decimal"})}</Label>
            <Label name="Canonical equivalent (constant 2026 USD)">{input("limit","Independently assessed equivalent",{inputMode:"decimal"})}</Label>
            <Label name="Annual interest (%)">{input("rate","Exact annual percentage",{inputMode:"decimal"})}</Label>
            <Label name="Maturity (game date)">{input("maturity","YYYY-MM-DD")}</Label>
          </div>
          <Label name="Basis of the agreed accounting equivalent"><textarea style={{...field,minHeight:64}} value={form.basis} disabled={busy||aiBusy} onChange={e=>update("basis",e.target.value)} placeholder="Record the evidence or approved valuation basis; display currency is not historical FX."/></Label>
          <div style={muted}>Restricted eligible projects</div>
          {projects.map(p=><label key={p.id} style={flex}><input type="checkbox" checked={form.projectIds.includes(p.id)} disabled={busy||aiBusy} onChange={e=>update("projectIds",e.target.checked?[...form.projectIds,p.id]:form.projectIds.filter(id=>id!==p.id))}/><span>{p.name}</span></label>)}
          <div style={muted}>This records a non-revolving signed limit only. It does not add funds or debt. Authorizing the facility also authorizes service from the recurring project allowance at its stated maturity. Installment/refinancing contracts require separate review and are not supported yet.</div>
        </section>}
        {mode==="draw"&&f&&<section style={card}>
          <div style={muted}>Undrawn credit: {amountDisplay(f.undrawnMinor)} · Contract denomination: {f.terms.currency}</div>
          <Label name="Actual disbursed amount (original currency)">{input("originalDraw","Exact recorded tranche",{inputMode:"decimal"})}</Label>
          <Label name="Payment route">{select("payment",[["cash","Cash proceeds"],["supplier","Direct supplier prepayment"]],"Select payment route")}</Label>
          {form.payment==="supplier"&&<Label name="Recorded supplier">{input("supplier","Contract supplier designation")}</Label>}
          <Label name="Earmark">{select("projectId",projects.filter(p=>f.terms.projectIds.includes(p.id)).map(p=>[p.id,p.name]),"Unallocated cash (not automatically spent)")}</Label>
          <div style={muted}>Canonical accounting payment: <strong>{drawPreview()===null?"Not established":canon(drawPreview())}</strong> · Eligible from {addGameDays(review.game.gameDate,1)}</div>
          <Label name="Debt treatment">{select("debtTreatment",[["alreadyIncluded","Already included in recorded national debt (reconcile only)"],["additional","Not included in recorded national debt (add once)"]],"Confirm reconciliation treatment")}</Label>
          <div style={muted}>Current aggregate national debt: {review.world.countryStats?.[review.actor]?.economy?.publicDebt??"Not assessed"}% of GDP. Confirm the source establishes both the actual transfer and the chosen payment route and project. A supplier prepayment cannot be withdrawn as cash.</div>
        </section>}
        {["allocate","release","return"].includes(mode)&&f&&<section style={card}>
          <div style={muted}>Available in selected bucket: {amountDisplay(f.buckets.find(b=>b.id===form.bucketId)?.remainingMinor||0)}</div>
          <Label name="Accounting amount (constant 2026 USD)">{input("amount","Exact amount",{inputMode:"decimal"})}</Label>
          {mode==="allocate"&&<Label name="Eligible project">{select("projectId",projects.filter(p=>f.terms.projectIds.includes(p.id)).map(p=>[p.id,p.name]),"Select project")}</Label>}
          {mode==="return"&&<div style={muted}>Return records an actual confirmed refund to the lender and reduces outstanding principal. It does not reopen the non-revolving credit limit.</div>}
        </section>}
        <label style={{...flex,alignItems:"flex-start"}}><input type="checkbox" disabled={!mayEdit} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span style={{flex:1}}>{needsSource?"I confirm the recorded source establishes consent and the exact terms or actual payment specified here. I authorize this accounting record for my government.":"I authorize this exact allocation change for my government."}</span></label>
        <button style={{...button,fontWeight:800}} disabled={!mayEdit||!confirmed||(needsSource&&!source)} onClick={commit}>{busy?"Saving...":"Confirm financing record"}</button>
      </>}
    </main>
  </dialog>,document.body);
};
