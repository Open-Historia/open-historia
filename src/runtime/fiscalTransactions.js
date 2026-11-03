/*! Open Historia - first-class, dated nominal fiscal commitments.
 * This ledger records public authorizations, evidenced already-budgeted payments,
 * and cancellation. It is NOT the GDP, public-debt, cash or tax-accrual owner.
 * An AI-created Project is never an implicit financial authorization or payment.
 */
import { compareGameDates, isCanonicalGameDate } from './gameDates.js';
import { collectActiveScenarioPolityKeys, createScenarioPolityResolver } from './scenarioPolities.js';
import { TAX_POLICY_OPS, applyFiscalTaxPolicyOps, normalizeFiscalTaxPolicies } from './fiscalTaxPolicies.js';
import { renamePolityInWorld, samePolityName } from '../../server/polityRename.js';

const plain = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const own = (v,k) => Object.prototype.hasOwnProperty.call(v,k);
const id = v => typeof v === 'string' && v.trim() === v && v.length >= 1 && v.length <= 128;
const reason = v => typeof v === 'string' && v.trim() === v && v.length >= 8 && v.length <= 240;
const currency = v => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
const kinds = new Set(['grant','relief','procurement','transfer']);
const funding = 'already-budgeted';
const max = 100_000_000_000;
const amountValid = n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= max
  && Number.isSafeInteger(Math.round(n * 100)) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const cents = n => Math.round(n * 100);
const amountFromCents = n => n / 100;
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const AUTHOR_KEYS = new Set(['id','polity','kind','currency','authorizedAmount',
  'authorizedAt','authorizedEventId','reason','projectId','paidAmount','payments',
  'status','cancelledAt','cancelledEventId','cancellationReason']);
const PAY_KEYS = new Set(['amount','date','eventId','funding','reason']);

export const normalizeFiscalTransactions = (input) => {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 128) throw new Error('Invalid fiscal transactions ledger');
  const seen = new Set();
  return input.map(raw => {
    if (!plain(raw) || Object.keys(raw).some(k=>!AUTHOR_KEYS.has(k))
      || !id(raw.id) || seen.has(raw.id) || !id(raw.polity)
      || !kinds.has(raw.kind) || !currency(raw.currency)
      || !amountValid(raw.authorizedAmount) || !isCanonicalGameDate(raw.authorizedAt)
      || !id(raw.authorizedEventId) || !reason(raw.reason)
      || (own(raw,'projectId') && !id(raw.projectId))
      || !Array.isArray(raw.payments) || raw.payments.length > 48) {
      throw new Error('Invalid canonical fiscal transaction identity, denomination or authorization');
    }
    seen.add(raw.id);
    const seenPayments = new Set();
    let paidCents = 0;
    const payments = raw.payments.map(payment => {
      if (!plain(payment) || Object.keys(payment).some(k=>!PAY_KEYS.has(k))
        || !amountValid(payment.amount) || !isCanonicalGameDate(payment.date)
        || compareGameDates(payment.date,raw.authorizedAt) < 0
        || !id(payment.eventId) || seenPayments.has(payment.eventId)
        || payment.funding !== funding || !reason(payment.reason)) {
        throw new Error('Invalid or duplicated fiscal payment receipt');
      }
      seenPayments.add(payment.eventId);
      paidCents += cents(payment.amount);
      return { amount: payment.amount, date: payment.date, eventId: payment.eventId,
        funding, reason: payment.reason };
    });
    if (!Number.isSafeInteger(paidCents) || paidCents > cents(raw.authorizedAmount)
      || raw.paidAmount !== amountFromCents(paidCents)
      || !['authorized','partially-paid','paid','cancelled'].includes(raw.status)) {
      throw new Error('Invalid fiscal payment balance or status mismatch');
    }
    const isCancelled = raw.status === 'cancelled';
    const cancelledKeys = ['cancelledAt','cancelledEventId','cancellationReason'];
    if (isCancelled !== cancelledKeys.every(k=>own(raw,k))
      || (!isCancelled && cancelledKeys.some(k=>own(raw,k)))
      || (isCancelled && (!isCanonicalGameDate(raw.cancelledAt) || !id(raw.cancelledEventId)
        || !reason(raw.cancellationReason)
        || compareGameDates(raw.cancelledAt,raw.authorizedAt) < 0
        || payments.some(payment=>compareGameDates(payment.date,raw.cancelledAt) > 0)))
      || (!isCancelled && raw.status !== (paidCents === 0 ? 'authorized'
        : paidCents === cents(raw.authorizedAmount) ? 'paid' : 'partially-paid'))) {
      throw new Error('Invalid fiscal transaction status or cancellation');
    }
    return { id: raw.id, polity: raw.polity, kind: raw.kind,
      currency: raw.currency, authorizedAmount: raw.authorizedAmount,
      authorizedAt: raw.authorizedAt, authorizedEventId: raw.authorizedEventId,
      reason: raw.reason, ...(raw.projectId ? { projectId: raw.projectId } : {}),
      paidAmount: raw.paidAmount, payments, status: raw.status,
      ...(isCancelled ? { cancelledAt: raw.cancelledAt,
        cancelledEventId: raw.cancelledEventId, cancellationReason: raw.cancellationReason } : {}) };
  });
};

const checkOp = op => {
  if (!plain(op) || !['authorize','pay','cancel'].includes(op.op)
    || !id(op.id) || !reason(op.reason)) throw new Error('Invalid fiscal operation');
  const keys = op.op === 'authorize'
    ? ['op','id','polity','kind','amount','currency','reason','projectId']
    : op.op === 'pay' ? ['op','id','amount','funding','reason'] : ['op','id','reason'];
  if (Object.keys(op).some(key=>!keys.includes(key))) throw new Error('Unknown fiscal operation field');
  if (op.op === 'authorize' && (!id(op.polity) || !kinds.has(op.kind)
    || !amountValid(op.amount) || !currency(op.currency)
    || (own(op,'projectId') && !id(op.projectId)))) {
    throw new Error('Invalid fiscal authorization amount, currency or kind');
  }
  if (op.op === 'pay' && (!amountValid(op.amount) || op.funding !== funding)) {
    throw new Error('Invalid fiscal payment amount or funding: only established already-budgeted payments are supported');
  }
};

// Apply in memory to a DETACHED world. Caller commits the resulting world and
// its canonical event together. No effects are derived from narration/projects.
// No borrowing or budget-rate mutation is authorized by a nominal payment.
export const applyFiscalTransactionOps = (world, ops, {
  eventId, date, resolvePolity = x => x,
} = {}) => {
  if (!Array.isArray(ops) || ops.length > 8 || !id(eventId) || !isCanonicalGameDate(date)) {
    throw new Error('Fiscal operations require a dated accepted event and at most eight operations');
  }
  const previous = normalizeFiscalTransactions(world?.fiscalTransactions);
  if (!ops.length) return { ...world, fiscalTransactions: previous };
  const active = new Set(collectActiveScenarioPolityKeys(world));
  let next = previous.map(row=>({ ...row, payments: [...row.payments] }));
  const touched = new Set();
  for (const op of ops) {
    checkOp(op);
    if (touched.has(op.id)) throw new Error('Duplicate fiscal transaction operation in one event');
    touched.add(op.id);
    const index = next.findIndex(row=>row.id === op.id);
    if (op.op === 'authorize') {
      const polity = resolvePolity(op.polity);
      if (!active.has(polity)) throw new Error('Fiscal authorization references an unknown or inactive polity');
      if (op.projectId) {
        const project = world?.projects?.find(row=>row?.id === op.projectId);
        if (!project || resolvePolity(project.ownerCode) !== polity) {
          throw new Error('Fiscal authorization references an unknown or foreign project');
        }
      }
      const candidate = { id: op.id, polity, kind: op.kind,
        currency: op.currency, authorizedAmount: op.amount,
        authorizedAt: date, authorizedEventId: eventId, reason: op.reason,
        ...(op.projectId ? { projectId: op.projectId } : {}),
        paidAmount: 0, payments: [], status: 'authorized' };
      if (index !== -1) {
        // Authorization identity is immutable; later payments/cancellation are
        // legitimate descendants of the very same accepted event. Replaying
        // it must preserve all those receipts, never reset or reject them.
        const present = next[index];
        const sameAuthorization = present.id === candidate.id && present.polity === candidate.polity
          && present.kind === candidate.kind && present.currency === candidate.currency
          && present.authorizedAmount === candidate.authorizedAmount
          && present.authorizedAt === candidate.authorizedAt
          && present.authorizedEventId === candidate.authorizedEventId
          && present.reason === candidate.reason && present.projectId === candidate.projectId;
        if (!sameAuthorization) throw new Error('Different fiscal authorization conflicts with existing ID');
        continue;
      }
      if (next.length >= 128) throw new Error('Fiscal transaction ledger capacity exceeded');
      next.push(candidate);
    } else {
      if (index === -1) throw new Error('Unknown fiscal transaction reference');
      const prior = next[index];
      if (op.op === 'pay') {
        const existing = prior.payments.find(row=>row.eventId === eventId);
        const pay = { amount: op.amount, date, eventId, funding, reason: op.reason };
        if (existing) {
          if (!same(existing,pay)) throw new Error('Fiscal payment replay conflicts with stored receipt');
          continue;
        }
        if (prior.status === 'cancelled') throw new Error('Cannot pay cancelled fiscal transaction');
        if (compareGameDates(date,prior.authorizedAt) < 0
          || (prior.payments.length && compareGameDates(date,prior.payments.at(-1).date) < 0)) {
          throw new Error('Fiscal payment date is before its authorization or prior payment');
        }
        const total = cents(prior.paidAmount) + cents(op.amount);
        if (total > cents(prior.authorizedAmount)) throw new Error('Fiscal payment would exceed authorized amount or fully paid commitment');
        if (prior.payments.length >= 48) throw new Error('Fiscal payment receipt capacity exceeded');
        next[index] = { ...prior, paidAmount: amountFromCents(total),
          payments: [...prior.payments,pay],
          status: total === cents(prior.authorizedAmount) ? 'paid' : 'partially-paid' };
      } else {
        if (prior.status === 'cancelled') {
          if (prior.cancelledEventId !== eventId || prior.cancelledAt !== date
            || prior.cancellationReason !== op.reason) throw new Error('Fiscal cancellation replay conflicts with stored record');
          continue;
        }
        if (prior.status === 'paid') throw new Error('Cannot cancel a fully paid fiscal transaction');
        if (compareGameDates(date,prior.authorizedAt) < 0
          || (prior.payments.length && compareGameDates(date,prior.payments.at(-1).date) < 0)) {
          throw new Error('Fiscal cancellation date precedes known financial activity');
        }
        next[index] = { ...prior, status:'cancelled', cancelledAt: date,
          cancelledEventId: eventId, cancellationReason: op.reason };
      }
    }
  }
  next = normalizeFiscalTransactions(next);
  return { ...world, fiscalTransactions: next };
};


// One event can author both expenditure commitments and temporary tax
// policies. Disjoint typed owners share the event identity and cannot reuse
// an ID for incompatible programme families.
export const applyFiscalEventOps = (world, ops, options = {}) => {
  if (!Array.isArray(ops) || ops.length > 8) {
    throw new Error('Fiscal operations must be an array of at most eight');
  }
  const taxOps = ops.filter(op => TAX_POLICY_OPS.includes(op?.op));
  const commitmentOps = ops.filter(op => !TAX_POLICY_OPS.includes(op?.op));
  const taxLedger = normalizeFiscalTaxPolicies(world?.fiscalTaxPolicies);
  const committed = normalizeFiscalTransactions(world?.fiscalTransactions);
  const allIds = ops.map(op=>op?.id);
  if (new Set(allIds).size !== allIds.length) {
    throw new Error('Duplicate fiscal operation identity in one event');
  }
  const commitmentIds = new Set(committed.map(row=>row.id));
  const taxIds = new Set(taxLedger.map(row=>row.id));
  if (taxOps.some(op => commitmentIds.has(op.id)) || commitmentOps.some(op => taxIds.has(op.id))) {
    throw new Error('Fiscal transaction ID already belongs to another policy family');
  }
  let next = world;
  if (commitmentOps.length) next = applyFiscalTransactionOps(next, commitmentOps, options);
  if (taxOps.length) next = applyFiscalTaxPolicyOps(next, taxOps, options);
  return next;
};

// In Apply, polityChanges re-key a live country before the event's fiscalOps.
 // Preview must project the SAME canonical rename, not reject a grant under the
 // newly established name. Only an already-active polity can be re-keyed here:
 // creating/restoring a new country is a separate native lifecycle contract,
 // not permission for this fiscal preflight to mint a phantom actor.
const previewFiscalPolityRenames = (source, event) => {
  let next = source;
  for (const change of Array.isArray(event?.impacts?.polityChanges) ? event.impacts.polityChanges : []) {
    const operation = change?.operation || "update";
    if (!["update", "rename"].includes(operation) || !id(change?.code) || !id(change?.name)) continue;
    const from = createScenarioPolityResolver(next)(change.code);
    if (!from || samePolityName(from, change.name)
      || !collectActiveScenarioPolityKeys(next).includes(from)) continue;
    next = renamePolityInWorld(next, from, change.name).world;
  }
  return next;
};

// Preview and Apply validate against the same reducer rules. This is a dry
// sequence of ONLY fiscal operations: it never writes world state or derives
// payment from prose/project progress. A projectId must already be canonical;
// a same-event newly-created project can instead be linked on a later event.
export const validateFiscalEventOperations = (world, events) => {
  // This validator must never impose a new fiscal rule on an ordinary event
  // that contains no fiscal mutation. World/lifecycle validation remains with
  // its existing owner, including unsupported rename retries.
  const hasFiscalOps = Array.isArray(events) && events.some(event => {
    const ops = event?.impacts?.fiscalOps;
    return ops !== undefined && (!Array.isArray(ops) || ops.length > 0);
  });
  if (!hasFiscalOps) return "";
  let candidate = { ...world, fiscalTransactions: normalizeFiscalTransactions(world?.fiscalTransactions),
    fiscalTaxPolicies: normalizeFiscalTaxPolicies(world?.fiscalTaxPolicies) };
  for (const [index,event] of (Array.isArray(events) ? events : []).entries()) {
    const ops = event?.impacts?.fiscalOps;
    try {
      candidate = previewFiscalPolityRenames(candidate, event);
      if (ops === undefined || (Array.isArray(ops) && ops.length === 0)) continue;
      candidate = applyFiscalEventOps(candidate, ops, {
        eventId: event?.id || `preview-fiscal-event-${index + 1}`,
        date: event?.date, resolvePolity: createScenarioPolityResolver(candidate),
      });
    } catch (error) {
      return `$.events[${index}].impacts.fiscalOps: ${error?.message || String(error)}`;
    }
  }
  return "";
};


// A read-only GM presentation of exactly what this native ledger would admit.
// The returned amount is always nominal currency, NEVER a debt/GDP prediction.
export const buildFiscalPreviewRows = (world, events) => {
  if (!Array.isArray(events) || !events.some(event => event?.impacts?.fiscalOps?.length)) return [];
  let candidate = { ...world, fiscalTransactions: normalizeFiscalTransactions(world?.fiscalTransactions),
    fiscalTaxPolicies: normalizeFiscalTaxPolicies(world?.fiscalTaxPolicies) };
  const rows = [];
  for (const [eventIndex,event] of (Array.isArray(events) ? events : []).entries()) {
    candidate = previewFiscalPolityRenames(candidate, event);
    const ops = event?.impacts?.fiscalOps;
    if (!ops?.length) continue;
    candidate = applyFiscalEventOps(candidate, ops, {
      eventId: event?.id || `preview-fiscal-event-${eventIndex + 1}`,
      date: event?.date, resolvePolity: createScenarioPolityResolver(candidate),
    });
    for (const op of ops) {
      const tax = TAX_POLICY_OPS.includes(op.op);
      const state = tax ? candidate.fiscalTaxPolicies.find(row=>row.id === op.id)
        : candidate.fiscalTransactions.find(row=>row.id === op.id);
      rows.push(tax ? {
        eventIndex, date:event.date, operation:op.op, id:op.id,
        polity:state.polity, kind:'tax-holiday', currency:state.currency,
        amount:op.op === 'repeal-tax-holiday' ? null : state.amount,
        authorizedAmount:state.amount, paidAmount:null,
        accruedAmount:state.accruedAmount,
        remainingAmount:amountFromCents(cents(state.amount) - cents(state.accruedAmount)),
        status:state.status, startDate:state.startDate, endDate:state.endDate,
        funding:null, reason:op.reason,
      } : {
        eventIndex, date: event.date, operation: op.op, id: op.id,
        polity: state.polity, kind: state.kind, currency: state.currency,
        amount: op.op === 'cancel' ? null : op.amount,
        authorizedAmount: state.authorizedAmount, paidAmount: state.paidAmount,
        remainingAmount: amountFromCents(cents(state.authorizedAmount) - cents(state.paidAmount)),
        status: state.status, funding: op.op === 'pay' ? op.funding : null,
        reason: op.reason,
      });
    }
  }
  return rows;
};
