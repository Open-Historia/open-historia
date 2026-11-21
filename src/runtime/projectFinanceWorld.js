/*! Open Historia - native Project Finance world and debt ownership. AGPL-3.0-or-later. */
import { appendProjectFinanceCommand, normalizeProjectFinance, projectFinanceSnapshot } from "./projectFinance.js";
import { mergeCountryStatPatch } from "./countryStats.js";
import { addGameDays, compareGameDates, normalizeGameDate } from "./gameDates.js";
import { buildOwnerAliasMap, createOwnerResolver, toCountryName } from "./ownerNames.js";
import { projectFundingMode, projectOwnerOf } from "./projectEngine.js";
import { isBelief, isProjectOpen } from "./projects.js";

const fail = message => { throw new Error("Project Finance: "+message); };
const own = (v,k) => Object.hasOwn(v??{},k);
const integer = v => {
  if(!Number.isSafeInteger(v)||v<0)fail("unsafe accounting amount");
  return v;
};
const amount = v => {
  if(!Number.isFinite(v)||v<0)fail("missing or invalid assessed fiscal baseline");
  return integer(Math.round(v));
};
const lastDate = ledger => ledger?.receipts?.at(-1)?.date;
const principalByOwner = ledger => {
  const totals=new Map();
  if(!lastDate(ledger))return totals;
  for(const f of projectFinanceSnapshot(ledger,lastDate(ledger))) {
    if(f.drawnMinor>0)totals.set(f.terms.borrower,integer((totals.get(f.terms.borrower)??0)+f.outstandingMinor));
  }
  return totals;
};
const baselineGDP = sheet => {
  const n=sheet?.economy?.gdp;
  if(typeof n!=="number"||!Number.isFinite(n)||n<=0)fail("a known positive GDP is required for fiscal settlement");
  return n;
};
const assessedPrincipal = sheet => {
  const gdp=baselineGDP(sheet),rate=sheet?.economy?.publicDebt;
  if(typeof rate!=="number"||!Number.isFinite(rate)||rate<0||rate>1000)fail("a known aggregate public debt baseline is required");
  return amount(gdp*rate);
};
const derivedSheet = (sheet,otherMinor,nativeMinor) => {
  const gdp=baselineGDP(sheet), total=integer(otherMinor+nativeMinor);
  // GDP is in dollars and principal in cents, so % GDP = cents / GDP.
  const ratio=total/gdp;
  if(!Number.isFinite(ratio)||ratio>1000)fail("tracked aggregate debt exceeds the supported Stats range");
  return {...sheet,economy:{...sheet.economy,publicDebt:ratio}};
};

// Read boundary. Never reconstruct a residual from a displayed ratio on load:
// it must have been explicitly established when the first draw was booked.
export const financeWorldFields = world => {
  if(!own(world,"projectFinance")) {
    if(own(world,"projectFinanceDebt"))fail("debt baseline without receipt journal");
    return {};
  }
  const ledger=normalizeProjectFinance(world.projectFinance);
  if(projectFundingMode(world)==="nonmonetary"&&ledger.receipts.length)fail("monetary financing in a non-monetary campaign");
  const principals=principalByOwner(ledger);
  const rows=world.projectFinanceDebt;
  if(!Array.isArray(rows)||rows.length!==principals.size)fail("missing or inconsistent residual debt ledger");
  const seen=new Set(), countryStats={...world.countryStats};
  const debt=rows.map(row=>{
    if(!row||typeof row!=="object"||Object.keys(row).length!==2||typeof row.owner!=="string"||
      !principals.has(row.owner)||seen.has(row.owner))fail("unresolved or duplicate borrower debt baseline");
    seen.add(row.owner);
    const otherMinor=integer(row.otherMinor);
    // A defeated polity can lose its economic sheet; its recorded claim
    // survives. No fabricated GDP or ratio when the denominator is lost.
    if(own(countryStats,row.owner)&&typeof countryStats[row.owner]?.economy?.gdp==="number"&&countryStats[row.owner].economy.gdp>0)
      countryStats[row.owner]=derivedSheet(countryStats[row.owner],otherMinor,principals.get(row.owner));
    return {owner:row.owner,otherMinor};
  });
  return {projectFinance:ledger,projectFinanceDebt:debt,countryStats};
};

// Only a genuine changed aggregate estimate reconciles other debt. The exact
// native principal is never replaced by an estimate. An unchanged value from a
// complete Stats response does not rebase principal as GDP drifts. GDP-only
// growth/refresh changes the denominator, not this monetary liability.
export const mergeFinanceAwareCountryStat = (world,country,patch,options={}) => {
  const prior=world.countryStats?.[country];
  const next=mergeCountryStatPatch(prior,patch,options);
  if(!next || !own(world,"projectFinance"))return next;
  const row=world.projectFinanceDebt?.find(r=>r.owner===country);
  if(!row)return next;
  const native=principalByOwner(world.projectFinance).get(country);
  if(native===undefined)fail("missing tracked principal");
  let other=row.otherMinor;
  if(!(next.economy?.gdp>0)) {
    if(own(patch?.economy,"publicDebt")&&next.economy?.publicDebt!==prior?.economy?.publicDebt)fail("cannot reconcile debt without assessed GDP");
    return next;
  }
  if(own(patch?.economy,"publicDebt")&&next.economy?.publicDebt!==prior?.economy?.publicDebt) {
    const total=assessedPrincipal(next);
    if(total<native)fail("the estimated aggregate debt is below recorded native loan principal");
    other=total-native;
  }
  const sheet=derivedSheet(next,other,native);
  world.projectFinanceDebt=world.projectFinanceDebt.map(r=>r===row?{owner:country,otherMinor:other}:r);
  return sheet;
};
export const refreshFinanceDebtRatios = world => {
  if(own(world,"projectFinance"))Object.assign(world,financeWorldFields(world));
  return world;
};

// Rekey current party references only. Contract denominations, receipt IDs,
// exact source IDs, original dates and accounting amounts are not changed.
export const resolveFinanceParties = (ledger,resolve) => {
  if(ledger===undefined)return undefined;
  const clean=normalizeProjectFinance(ledger);
  return normalizeProjectFinance({...clean,receipts:clean.receipts.map(r=>r.type!=="authorize"?r:{
    ...r,borrower:resolve(r.borrower),lenderId:r.lenderKind==="polity"?resolve(r.lenderId):r.lenderId,
  })});
};

// The accepted turn may rename polities, but must not replace the finance base
// with an unrelated journal. A1 books only explicit approvals BETWEEN turns;
// same-turn AI proposals are not receipts. Clock results are merged atomically
// with the advanced board and existing residual (not a second aggregate delta).
export const settleFinanceClockWorld = (base,after,result) => {
  if(!result) {
    if(own(after,"projectFinance")!==own(base,"projectFinance"))fail("finance changed during the turn");
    return after;
  }
  const resolve=createOwnerResolver(buildOwnerAliasMap(after.polityOverrides));
  const rebased=resolveFinanceParties(base.projectFinance,resolve);
  if(JSON.stringify(rebased)!==JSON.stringify(after.projectFinance))fail("finance changed during the turn");
  return refreshFinanceDebtRatios({...after,projectFinance:resolveFinanceParties(result.ledger,resolve)});
};

export const financeReviewStamp = (world,game) => {
  const resolve=createOwnerResolver(buildOwnerAliasMap(world.polityOverrides));
  const actor=resolve(toCountryName(game.country)), economy=world.countryStats?.[actor]?.economy;
  return {country:game.country,round:game.round,date:game.gameDate,ledger:JSON.stringify(world.projectFinance??null),
    baseline:JSON.stringify([economy?.gdp,economy?.publicDebt,world.projectFinanceDebt??[]])};
};
export const financeSourceText = event => JSON.stringify([event?.id,event?.date,event?.title,event?.description]);
export const eligibleFinanceSource = (event,actor,resolve=x=>x) =>
  Boolean(event?.id&&event?.date&&typeof event.description==="string"&&event.description.trim()&&
    event.playerRelated&&!event.audience?.length&&event.kind!=="espionage"&&
    (!event.agency?.principal || [event.agency.principal,event.agency.sovereignPolity,...(event.agency.sovereignActors??[]).map(r=>r.polity)].some(n=>n&&resolve(n)===actor)));

const exactProject = (world,projectId,actor) => {
  const rows=(world.projects??[]).filter(p=>p.id===projectId&&projectOwnerOf(p,actor)===actor);
  if(rows.length!==1||isBelief(rows[0])||!isProjectOpen(rows[0])||!(rows[0].plan?.monthlyCost>0))fail("select an existing paid project belonging to your government");
  return rows[0];
};
const exactSource = ({events,sourceId,expectedSource,currentDate,actor,resolve}) => {
  const matches=events.filter(e=>e.id===sourceId);
  const event=matches[0];
  if(matches.length!==1||!eligibleFinanceSource(event,actor,resolve)||financeSourceText(event)!==expectedSource||
    normalizeGameDate(event.date)!==event.date||compareGameDates(event.date,currentDate)>0)
    fail("source event is unavailable, changed or not a recorded event of your government");
  return event;
};
const receiptId = (type,sourceId) => {
  if(typeof sourceId!=="string"||sourceId.length>180)fail("source identity too long");
  return "finance:"+type+":"+sourceId;
};
const validateParty = (world,party,actor,resolve) => {
  const lender=resolve(party);
  if(!lender||lender===actor||!own(world.polityOverrides,lender)&&!own(world.countryStats,lender))fail("select a registered foreign lender");
  return lender;
};
const append = (ledger,receipt) => appendProjectFinanceCommand(ledger,receipt,{
  // This door is called ONLY from an explicit player confirmation against a
  // freshly read campaign and exact source. The model cannot call this door.
  authorize: candidate=>Object.keys(receipt).length===Object.keys(candidate).length && Object.entries(receipt).every(([key,value])=>JSON.stringify(value)===JSON.stringify(candidate[key])),
});

// Explicit manual reconciliation of an already recorded agreement or tranche.
// The human confirms the selected source establishes consent and exact terms;
// this is not a prose parser that can author a new loan. One signature and one
// disbursement per source event in V1 (separate identities, no double booking).
export const bookProjectFinance = ({world,game,events,command,expected,shared=false,unseen=false}={}) => {
  if(shared||unseen||world.activeInteractive||projectFundingMode(world)!=="gdp-proxy")fail("finance changes require a fully revealed single-player campaign outside a scene");
  const resolve=createOwnerResolver(buildOwnerAliasMap(world.polityOverrides));
  const actor=resolve(toCountryName(game.country)),currentDate=game.gameDate;
  if(!actor||!currentDate||!expected||Object.entries(financeReviewStamp(world,game)).some(([k,v])=>expected[k]!==v))fail("campaign or financing record changed; reopen the review");
  if(!command||command.confirmed!==true)fail("explicit government authorization is required");
  let ledger=world.projectFinance, debt=(world.projectFinanceDebt??[]).map(r=>({...r}));
  const before=principalByOwner(ledger).get(actor)??0;
  const source=()=>{
    const e=exactSource({events,sourceId:command.sourceId,expectedSource:command.expectedSource,currentDate,actor,resolve});
    if(world.projectFinance?.receipts?.some(r=>r.type===command.type&&r.sourceEventId===e.id))fail("this source has already been booked");
    return e;
  };
  if(command.type==="authorize") {
    const event=source(),facilityId=receiptId("facility",event.id);
    if(!Array.isArray(command.projectIds)||!command.projectIds.length)fail("select eligible projects");
    for(const projectId of command.projectIds)exactProject(world,projectId,actor);
    if(compareGameDates(command.maturity,currentDate)<=0)fail("past-maturity reconciliation needs a separately reviewed repayment history");
    const lenderId=validateParty(world,command.lenderId,actor,resolve);
    const r={id:receiptId("authorize",event.id),type:"authorize",facilityId,date:event.date,
      mandateId:receiptId("mandate-authorize",event.id),sourceEventId:event.id,borrower:actor,lenderKind:"polity",lenderId,
      currency:command.currency,minorDigits:command.minorDigits,originalLimitMinor:command.originalLimitMinor,limitMinor:command.limitMinor,
      equivalenceBasis:command.equivalenceBasis,annualRateBps:command.annualRateBps,maturity:command.maturity,
      repaymentSource:"projectAllowance",projectIds:command.projectIds};
    ledger=append(ledger,r);
  } else if(command.type==="draw") {
    const event=source();
    const facility=projectFinanceSnapshot(ledger,currentDate).find(f=>f.terms.facilityId===command.facilityId&&f.terms.borrower===actor);
    if(!facility)fail("facility not owned by the current government");
    const projectId=command.projectId;
    if(projectId!==null)exactProject(world,projectId,actor);
    if(!["alreadyIncluded","additional"].includes(command.debtTreatment))fail("explicit aggregate-debt reconciliation is required");
    const r={id:receiptId("draw",event.id),type:"draw",facilityId:facility.terms.facilityId,date:event.date,
      mandateId:receiptId("mandate-draw",event.id),sourceEventId:event.id,originalMinor:command.originalMinor,
      amountMinor:command.amountMinor,eligibleFrom:addGameDays(currentDate,1),supplierId:command.supplierId,projectId};
    ledger=append(ledger,r);
    const after=principalByOwner(ledger).get(actor);
    const delta=after-before;
    const row=debt.find(r=>r.owner===actor);
    let other=row?row.otherMinor:assessedPrincipal(world.countryStats?.[actor]);
    if(command.debtTreatment==="alreadyIncluded"){
      if(delta>other)fail("confirmed included principal exceeds the untracked aggregate debt");
      other-=delta;
    }
    if(row)row.otherMinor=other;
    else debt.push({owner:actor,otherMinor:other});
  } else if(["allocate","release","return"].includes(command.type)){
    const facility=projectFinanceSnapshot(ledger,currentDate).find(f=>f.terms.facilityId===command.facilityId&&f.terms.borrower===actor);
    if(!facility)fail("facility not owned by the current government");
    const bucket=facility.buckets.find(b=>b.id===command.bucketId);
    if(!bucket)fail("unknown funding bucket");
    const id=command.type==="return"?receiptId("return",source().id):command.id;
    if(typeof id!=="string"||!id.startsWith("finance:"))fail("invalid native confirmation identity");
    const r={id,type:command.type,facilityId:facility.terms.facilityId,date:currentDate,mandateId:id,
      bucketId:bucket.id,amountMinor:command.amountMinor};
    if(command.type==="allocate"){exactProject(world,command.projectId,actor);r.projectId=command.projectId;}
    if(command.type==="return")r.sourceEventId=command.sourceId;
    ledger=append(ledger,r);
  } else fail("unsupported financing command");
  return refreshFinanceDebtRatios({...world,projectFinance:ledger,projectFinanceDebt:debt});
};

// A model may suggest terms but these records remain a player's explicit
// reconciliation. Show public debt as an aggregate including tracked principal.
export const projectFinancePrompt = ledger => {
  if(!lastDate(ledger))return "";
  const totals=principalByOwner(ledger);
  if(!totals.size)return "";
  return "Native Project Finance tracks exact loan principal separately. Public debt estimates are aggregate, INCLUDING outstanding native principal: "+
    [...totals].map(([owner,n])=>owner+" "+(n/100)+" constant 2026 USD").join("; ")+
    ". Do not narrate or apply a second draw, repayment, loan-funded cost or debt change for a settlement already owned by this native clock. This period's automatic repayments are applied by the engine after event estimates; do not anticipate them in publicDebt updates.";
};
