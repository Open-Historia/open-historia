/*! Open Historia - finite Project Finance receipt ledger. AGPL-3.0-or-later (see LICENSE). */
// Pure accounting core, deliberately not an authorization or persistence API.
// The trusted command intake must establish exact identities, source evidence,
// human/counterparty consent and canonical equivalence. No prose, display FX,
// raw AI balances or unapproved requests can manufacture a receipt.
// All monetary quantities here are safe integer minor units; the accounting
// unit is cents of constant 2026 USD. Contract units are separately recorded.
import { compareGameDates, diffGameDays, gameDateDayNumber, normalizeGameDate } from "./gameDates.js";

export const PROJECT_FINANCE_VERSION = 1;
export const FINANCE_RECEIPTS_MAX = 100_000;
const MAX_AMOUNT = Number.MAX_SAFE_INTEGER;
const RATE_DENOMINATOR = 3_650_000n; // basis points * 365 days
const fail = message => { throw new Error("Project Finance: " + message); };
const owns = (value, key) => Object.hasOwn(value, key);
const record = v => v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v, keys) => {
  if (!record(v) || Object.keys(v).length !== keys.length || keys.some(k => !owns(v,k))) fail("invalid receipt fields");
};
const id = (v,max=240) => {
  if (typeof v !== "string" || !v.length || v.length > max || v !== v.trim() || /[\u0000-\u001f]/.test(v)) fail("invalid identifier");
  return v;
};
const text = (v, max=1000) => {
  if (typeof v !== "string" || !v.trim() || v.length > max) fail("missing or oversized contract information");
  return v;
};
const date = v => {
  if (typeof v!=="string" || !v || normalizeGameDate(v)!==v || !Number.isFinite(gameDateDayNumber(v))) fail("noncanonical date");
  return v;
};
const integer = (v, min=0, max=MAX_AMOUNT) => {
  if (!Number.isSafeInteger(v) || v < min || v > max) fail("invalid or overflowing amount");
  return v;
};
const add = (a,b) => integer(a+b);
const before = (a,b) => compareGameDates(a,b)<0;
const after = (a,b) => compareGameDates(a,b)>0;
const min = Math.min;
const commandTypes = new Set(["authorize","draw","allocate","release","return"]);
const fields = {
  authorize:["mandateId","sourceEventId","borrower","lenderKind","lenderId","currency","minorDigits","originalLimitMinor","limitMinor","equivalenceBasis","annualRateBps","maturity","repaymentSource","projectIds"],
  draw:["mandateId","sourceEventId","originalMinor","amountMinor","eligibleFrom","supplierId","projectId"],
  allocate:["mandateId","bucketId","projectId","amountMinor"],
  release:["mandateId","bucketId","amountMinor"],
  return:["mandateId","sourceEventId","bucketId","amountMinor"],
  cost:["bucketId","projectId","amountMinor"],
  service:["interestMinor","principalMinor"],
};
const baseFields=["id","type","facilityId","date"];
const canonicalReceipt = raw => {
  if (!record(raw) || typeof raw.type!=="string" || !owns(fields,raw.type)) fail("unknown receipt kind");
  const keys=[...baseFields,...fields[raw.type]];
  exact(raw,keys);
  const r=Object.fromEntries(keys.map(k=>[k,raw[k]]));
  id(r.id,commandTypes.has(r.type)?240:512);id(r.facilityId);date(r.date);
  if(commandTypes.has(r.type) && /^(cost|service):/.test(r.id))fail("reserved engine receipt identifier");
  if (commandTypes.has(r.type)) id(r.mandateId);
  if (owns(r,"sourceEventId")) id(r.sourceEventId);
  if (owns(r,"amountMinor")) integer(r.amountMinor,1);
  if (owns(r,"bucketId")) id(r.bucketId);
  if (r.type==="authorize") {
    id(r.borrower);id(r.lenderId);
    if (!["polity","institution"].includes(r.lenderKind) || (r.lenderKind==="polity" && r.lenderId===r.borrower)) fail("invalid lender");
    text(r.currency,48);integer(r.minorDigits,0,6);
    integer(r.originalLimitMinor,1);integer(r.limitMinor,1);
    text(r.equivalenceBasis);
    integer(r.annualRateBps,0,10_000);
    date(r.maturity);
    if (!after(r.maturity,r.date) || r.repaymentSource!=="projectAllowance") fail("unsupported maturity or repayment source");
    if (!Array.isArray(r.projectIds) || !r.projectIds.length || r.projectIds.length>64) fail("missing or excessive eligible projects");
    r.projectIds=r.projectIds.map(projectId=>id(projectId));
    if (new Set(r.projectIds).size!==r.projectIds.length) fail("duplicate eligible project");
  } else if (r.type==="draw") {
    integer(r.originalMinor,1);date(r.eligibleFrom);
    if (!after(r.eligibleFrom,r.date)) fail("draw cannot fund pre-disbursement days");
    if (r.supplierId!==null) id(r.supplierId);
    if (r.projectId!==null) id(r.projectId);
    if (r.supplierId!==null && r.projectId===null) fail("supplier payment requires earmarked project");
  } else if (r.type==="allocate" || r.type==="cost") id(r.projectId);
  else if (r.type==="service") {
    integer(r.interestMinor);integer(r.principalMinor);
    if (!add(r.interestMinor,r.principalMinor)) fail("empty repayment");
  }
  if(r.type==="cost" && r.id!=="cost:"+r.date+":"+r.bucketId)fail("invalid cost receipt identity");
  if(r.type==="service" && r.id!=="service:"+r.date+":"+r.facilityId)fail("invalid service receipt identity");
  return r;
};
const receiptKey = r => JSON.stringify(r);
const state = () => ({ receipts:[], ids:new Map(), mandates:new Set(), facilities:new Map(), lastDate:"" });
const accrue = (f, through) => {
  const days=diffGameDays(f.accruedThrough,through);
  if (!Number.isSafeInteger(days) || days<0) fail("out-of-order accrual");
  const numerator=BigInt(f.outstandingMinor)*BigInt(f.terms.annualRateBps)*BigInt(days)+f.interestCarry;
  const due=Number(numerator/RATE_DENOMINATOR);
  f.interestDueMinor=add(f.interestDueMinor,integer(due));
  f.interestCarry=numerator%RATE_DENOMINATOR;
  f.accruedThrough=through;
};
// Each draw uses the same independently approved accounting equivalence.
// Cumulative half-up rounding avoids creating extra cents by splitting draws.
const equivalent = (terms, cumulative) => {
  const numerator=BigInt(terms.limitMinor)*BigInt(cumulative);
  const denominator=BigInt(terms.originalLimitMinor);
  return integer(Number((2n*numerator+denominator)/(2n*denominator)));
};
export const projectFinanceDrawAmount = (facility,originalMinor) => {
  integer(originalMinor,1);
  const original=add(facility.drawnOriginalMinor,originalMinor);
  if(original>facility.terms.originalLimitMinor)fail("credit limit exceeded");
  return integer(equivalent(facility.terms,original)-facility.drawnMinor,1);
};
const bucket = (f,id) => {
  const b=f.buckets.get(id);
  if (!b) fail("unknown funding bucket");
  return b;
};
const projectEligible = (f, projectId) => {
  if(!f.terms.projectIds.includes(projectId)) fail("project outside authorized facility");
};
const consume = (b,n) => {
  if(n>b.remainingMinor) fail("insufficient finite proceeds");
  b.remainingMinor-=n;
};
const newBucket = (f,r,{projectId=null,supplierId=null,eligibleFrom}) => {
  f.buckets.set(r.id,{id:r.id,projectId,supplierId,eligibleFrom,remainingMinor:r.amountMinor});
};
const apply = (s,r) => {
  const prior=s.ids.get(r.id);
  if (prior) {
    if(receiptKey(prior)!==receiptKey(r)) fail("conflicting receipt identity");
    return false;
  }
  if(s.receipts.length>=FINANCE_RECEIPTS_MAX) fail("receipt capacity reached; no history discarded");
  if(s.lastDate&&before(r.date,s.lastDate)) fail("out-of-order receipt");
  if(commandTypes.has(r.type)&&s.mandates.has(r.mandateId)) fail("mandate already settled");
  let f=s.facilities.get(r.facilityId);
  if(r.type==="authorize") {
    if(f) fail("facility already exists");
    f={terms:r,drawnOriginalMinor:0,drawnMinor:0,outstandingMinor:0,interestDueMinor:0,interestPaidMinor:0,principalPaidMinor:0,costAppliedMinor:0,returnedMinor:0,interestCarry:0n,accruedThrough:r.date,buckets:new Map()};
    s.facilities.set(r.facilityId,f);
  } else {
    if(!f) fail("unknown facility");
    accrue(f,r.date);
    if(r.type==="draw") {
      if(!before(r.date,f.terms.maturity)) fail("draw at or after maturity");
      const original=add(f.drawnOriginalMinor,r.originalMinor);
      if(original>f.terms.originalLimitMinor) fail("credit limit exceeded");
      const cumulative=equivalent(f.terms,original);
      if(cumulative-f.drawnMinor!==r.amountMinor || cumulative>f.terms.limitMinor) fail("draw does not match approved accounting equivalence");
      if(r.projectId!==null) projectEligible(f,r.projectId);
      f.drawnOriginalMinor=original;f.drawnMinor=cumulative;
      f.outstandingMinor=add(f.outstandingMinor,r.amountMinor);
      newBucket(f,r,{projectId:r.projectId,supplierId:r.supplierId,eligibleFrom:r.eligibleFrom});
    } else if(r.type==="allocate" || r.type==="release") {
      const b=bucket(f,r.bucketId);
      if(b.supplierId!==null) fail("supplier prepayment cannot be reallocated as cash");
      if(r.type==="allocate") {
        if(b.projectId!==null) fail("allocation requires unallocated proceeds");
        projectEligible(f,r.projectId);
      } else if(b.projectId===null) fail("release requires allocated proceeds");
      consume(b,r.amountMinor);
      newBucket(f,r,{projectId:r.type==="allocate"?r.projectId:null,eligibleFrom:b.eligibleFrom});
    } else if(r.type==="return") {
      const b=bucket(f,r.bucketId);
      if(b.supplierId!==null || b.projectId!==null || before(r.date,b.eligibleFrom)) fail("return requires available unallocated cash");
      if(r.amountMinor>f.outstandingMinor) fail("return exceeds outstanding principal");
      consume(b,r.amountMinor);
      f.outstandingMinor-=r.amountMinor;f.returnedMinor=add(f.returnedMinor,r.amountMinor);
    } else if(r.type==="cost") {
      const b=bucket(f,r.bucketId);
      if(b.projectId!==r.projectId || before(r.date,b.eligibleFrom)) fail("cost outside earmark or eligibility");
      consume(b,r.amountMinor);
      f.costAppliedMinor=add(f.costAppliedMinor,r.amountMinor);
    } else if(r.type==="service") {
      if(before(r.date,f.terms.maturity)) fail("repayment before contractual maturity");
      if(r.interestMinor>f.interestDueMinor || r.principalMinor>f.outstandingMinor ||
        (r.principalMinor>0 && r.interestMinor!==f.interestDueMinor)) fail("repayment exceeds liability or skips interest");
      f.interestDueMinor-=r.interestMinor;f.outstandingMinor-=r.principalMinor;
      f.interestPaidMinor=add(f.interestPaidMinor,r.interestMinor);
      f.principalPaidMinor=add(f.principalPaidMinor,r.principalMinor);
    }
  }
  s.receipts.push(r);s.ids.set(r.id,r);s.lastDate=r.date;
  if(commandTypes.has(r.type))s.mandates.add(r.mandateId);
  return true;
};
const replay = ledger => {
  const s=state();
  if(ledger===undefined) return s; // legacy save has no finance, never inferred
  exact(ledger,["version","receipts"]);
  if(ledger.version!==PROJECT_FINANCE_VERSION || !Array.isArray(ledger.receipts) || ledger.receipts.length>FINANCE_RECEIPTS_MAX) fail("unsupported or oversized ledger");
  for(const raw of ledger.receipts) if(!apply(s,canonicalReceipt(raw))) fail("duplicate stored receipt");
  return s;
};
const serialize = s => ({version:PROJECT_FINANCE_VERSION,receipts:s.receipts.map(r=>({...r,...(r.projectIds?{projectIds:[...r.projectIds]}:{})}))});
export const normalizeProjectFinance = ledger => serialize(replay(ledger));

// Exact authorization comes from the trusted caller, never a flag supplied
// by the model. The authorizer receives the immutable validated receipt and
// current facility, and must return true only for the matching native mandate.
// Engine cost and service receipts cannot enter through this command door.
export const appendProjectFinanceCommand = (ledger, raw, {authorize}={}) => {
  const s=replay(ledger),r=canonicalReceipt(raw);
  if(!commandTypes.has(r.type) || typeof authorize!=="function") fail("no authorized financing command");
  const terms=s.facilities.get(r.facilityId)?.terms;
  if(authorize(structuredClone(r),terms?structuredClone(terms):null)!==true) fail("financing mandate refused");
  apply(s,r);
  return serialize(s);
};
const summarize = (s,through) => {
  date(through);
  if(s.lastDate&&before(through,s.lastDate)) fail("snapshot predates receipts");
  return [...s.facilities.values()].map(f=>{
    accrue(f,through);
    const buckets=[...f.buckets.values()].map(b=>({...b}));
    const remainingMinor=buckets.reduce((sum,b)=>add(sum,b.remainingMinor),0);
    if(add(add(remainingMinor,f.costAppliedMinor),f.returnedMinor)!==f.drawnMinor ||
      add(add(f.outstandingMinor,f.principalPaidMinor),f.returnedMinor)!==f.drawnMinor) fail("unbalanced receipt ledger");
    return {terms:structuredClone(f.terms),drawnOriginalMinor:f.drawnOriginalMinor,drawnMinor:f.drawnMinor,
      undrawnMinor:f.terms.limitMinor-f.drawnMinor,outstandingMinor:f.outstandingMinor,
      interestDueMinor:f.interestDueMinor,interestPaidMinor:f.interestPaidMinor,principalPaidMinor:f.principalPaidMinor,
      arrearsPrincipalMinor:before(through,f.terms.maturity)?0:f.outstandingMinor,
      arrearsInterestMinor:before(through,f.terms.maturity)?0:f.interestDueMinor,
      costAppliedMinor:f.costAppliedMinor,returnedMinor:f.returnedMinor,remainingMinor,buckets};
  });
};
export const projectFinanceSnapshot = (ledger,through) => summarize(replay(ledger),through);

// A temporary clock is pure relative to its input. Forecast and apply can
// independently call it over the same base; only the accepted turn may persist
// the returned ledger. One dated cost receipt per bucket and day, and one
// service receipt per facility and day. Exhausted buckets cannot pay again.
export const openProjectFinanceClock = (ledger,{fromDate,toDate}={}) => {
  const s=replay(ledger);
  date(fromDate);date(toDate);
  if(before(toDate,fromDate) || (s.lastDate&&after(s.lastDate,fromDate))) fail("clock overlaps committed receipts");
  const consumed=new Set(),serviced=new Set();
  let clockDate=fromDate, finished=false;
  const day = d => {
    date(d);
    if(finished||!after(d,fromDate)||after(d,toDate)||before(d,clockDate)) fail("clock date outside period");
    clockDate=d;
  };
  const available = (owner,projectId,d) => {
    day(d);
    let amount=0;
    for(const f of s.facilities.values()) if(f.terms.borrower===owner)
      for(const b of f.buckets.values()) if(b.projectId===projectId&&!before(d,b.eligibleFrom))
        amount=add(amount,b.remainingMinor);
    return amount;
  };
  const fund = (owner,projectId,d,dueMinor) => {
    day(d);integer(dueMinor);id(owner);id(projectId);
    const key=JSON.stringify([owner,projectId,d]);
    if(consumed.has(key)) fail("project already settled on this day");
    consumed.add(key);
    let left=dueMinor;
    for(const f of s.facilities.values()) {
      if(f.terms.borrower!==owner) continue;
      for(const b of f.buckets.values()) {
        if(!left)break;
        if(b.projectId!==projectId||before(d,b.eligibleFrom)||!b.remainingMinor)continue;
        const amountMinor=min(left,b.remainingMinor);
        apply(s,canonicalReceipt({id:"cost:"+d+":"+b.id,type:"cost",facilityId:f.terms.facilityId,date:d,bucketId:b.id,projectId,amountMinor}));
        left-=amountMinor;
      }
    }
    return dueMinor-left;
  };
  const service = (owner,d,poolMinor) => {
    day(d);id(owner);integer(poolMinor);
    const key=JSON.stringify([owner,d]);
    if(serviced.has(key)) fail("owner already serviced on this day");
    serviced.add(key);
    let left=poolMinor;
    for(const f of s.facilities.values()) {
      if(!left)break;
      if(f.terms.borrower!==owner||before(d,f.terms.maturity))continue;
      accrue(f,d);
      const interestMinor=min(left,f.interestDueMinor);
      const principalMinor=min(left-interestMinor,f.outstandingMinor);
      if(interestMinor||principalMinor) {
        apply(s,canonicalReceipt({id:"service:"+d+":"+f.terms.facilityId,type:"service",facilityId:f.terms.facilityId,date:d,interestMinor,principalMinor}));
        left-=interestMinor+principalMinor;
      }
    }
    return poolMinor-left;
  };
  // A signed but undrawn facility is metadata, not a funding or service
  // obligation. Fully settled facilities with no eligible funds are likewise
  // inert for the clock; their immutable receipts remain in the ledger.
  const borrowers=[...new Set([...s.facilities.values()].filter(f=>
    f.outstandingMinor>0 || f.interestDueMinor>0 ||
    [...f.buckets.values()].some(b=>b.projectId!==null&&b.remainingMinor>0)
  ).map(f=>f.terms.borrower))];
  return {borrowers,available,fund,service,finish:()=>{
    if(finished)fail("clock already finished");
    finished=true;
    const snapshot=summarize(s,toDate);
    return {ledger:serialize(s),snapshot};
  }};
};
