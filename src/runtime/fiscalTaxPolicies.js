/*! Open Historia - bounded nominal tax-policy enactment, repeal and daily accrual.
 * Estimated revenue foregone is not an actual Treasury debit, cash balance,
 * GDP change, deficit-rate edit or new borrowing. Source amounts and terms
 * must be explicitly evidenced; absence is never interpreted as zero.
 */
import { compareGameDates, diffGameDays, isCanonicalGameDate } from './gameDates.js';
import { collectActiveScenarioPolityKeys } from './scenarioPolities.js';

const own = (v,k) => Object.prototype.hasOwnProperty.call(v,k);
const record = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const identity = s => typeof s === 'string' && s.trim() === s && s.length >= 1 && s.length <= 128;
const reasonValid = s => typeof s === 'string' && s.trim() === s && s.length >= 8 && s.length <= 240;
const isoCurrency = s => typeof s === 'string' && /^[A-Z]{3}$/.test(s);
const validAmount = n => typeof n === 'number' && Number.isFinite(n) && n > 0
  && n <= 100_000_000_000 && Number.isSafeInteger(Math.round(n * 100))
  && Math.abs(n * 100 - Math.round(n * 100)) < 0.000001;
const moneyCents = n => BigInt(Math.round(n * 100));
const money = cents => Number(cents) / 100;
const exactAccrual = (amount, fromDate, through, endDate) => {
  const whole = diffGameDays(fromDate,endDate);
  const elapsed = diffGameDays(fromDate,through);
  if (!(whole >= 1 && whole <= 240) || !(elapsed >= 0 && elapsed <= whole)) {
    throw new Error('Invalid fiscal tax-policy accrual interval');
  }
  return money(moneyCents(amount) * BigInt(elapsed) / BigInt(whole));
};
const VALID_FIELDS = new Set(['id','polity','currency','amount','startDate','endDate',
  'authorizedAt','authorizedEventId','reason','accruedThrough','accruedAmount',
  'status','repealedAt','repealEventId','repealReason']);

export const normalizeFiscalTaxPolicies = input => {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 64) throw new Error('Invalid fiscal tax-policy ledger');
  const seen = new Set();
  return input.map(p => {
    if (!record(p) || Object.keys(p).some(k=>!VALID_FIELDS.has(k))
      || !identity(p.id) || seen.has(p.id) || !identity(p.polity)
      || !isoCurrency(p.currency) || !validAmount(p.amount)
      || !isCanonicalGameDate(p.startDate) || !isCanonicalGameDate(p.endDate)
      || !isCanonicalGameDate(p.authorizedAt) || !identity(p.authorizedEventId)
      || !reasonValid(p.reason) || !isCanonicalGameDate(p.accruedThrough)
      || compareGameDates(p.startDate,p.authorizedAt) < 0
      || compareGameDates(p.accruedThrough,p.startDate) < 0
      || compareGameDates(p.accruedThrough,p.endDate) > 0
      || !['scheduled','active','expired','repealed'].includes(p.status)) {
      throw new Error('Invalid fiscal tax-policy canonical authorization or identity');
    }
    seen.add(p.id);
    const duration = diffGameDays(p.startDate,p.endDate);
    if (duration < 1 || duration > 240 || p.accruedAmount !== exactAccrual(p.amount,
      p.startDate,p.accruedThrough,p.endDate)) {
      throw new Error('Fiscal tax-policy accrual mismatch or invalid duration');
    }
    const repealed = p.status === 'repealed';
    const repealKeys = ['repealedAt','repealEventId','repealReason'];
    if (repealed !== repealKeys.every(k=>own(p,k))
      || (!repealed && repealKeys.some(k=>own(p,k)))
      || (repealed && (!isCanonicalGameDate(p.repealedAt) || !identity(p.repealEventId)
        || !reasonValid(p.repealReason)
        || compareGameDates(p.repealedAt,p.authorizedAt) < 0
        || compareGameDates(p.accruedThrough,p.repealedAt) > 0))
      || (!repealed && p.status !== (p.accruedThrough === p.startDate
        ? 'scheduled' : p.accruedThrough === p.endDate ? 'expired' : 'active'))) {
      throw new Error('Fiscal tax-policy status and repeal mismatch');
    }
    return { id:p.id,polity:p.polity,currency:p.currency,amount:p.amount,
      startDate:p.startDate,endDate:p.endDate,authorizedAt:p.authorizedAt,
      authorizedEventId:p.authorizedEventId,reason:p.reason,
      accruedThrough:p.accruedThrough,accruedAmount:p.accruedAmount,status:p.status,
      ...(repealed ? {repealedAt:p.repealedAt,repealEventId:p.repealEventId,
        repealReason:p.repealReason} : {}) };
  });
};

export const TAX_POLICY_OPS = Object.freeze(['enact-tax-holiday','repeal-tax-holiday']);

export const applyFiscalTaxPolicyOps = (world, ops, { eventId,date,resolvePolity=x=>x }={}) => {
  if (!Array.isArray(ops) || ops.length > 8 || !identity(eventId) || !isCanonicalGameDate(date)) {
    throw new Error('Fiscal tax-policy operations require a dated accepted event');
  }
  let rows = normalizeFiscalTaxPolicies(world?.fiscalTaxPolicies);
  if (!ops.length) return { ...world,fiscalTaxPolicies:rows };
  const active = new Set(collectActiveScenarioPolityKeys(world));
  const touched = new Set();
  for (const op of ops) {
    if (!record(op) || !TAX_POLICY_OPS.includes(op.op) || !identity(op.id)
      || !reasonValid(op.reason) || touched.has(op.id)) {
      throw new Error('Invalid or duplicate fiscal tax-policy operation');
    }
    touched.add(op.id);
    const keys = op.op === 'enact-tax-holiday'
      ? ['op','id','polity','amount','currency','startDate','endDate','reason']
      : ['op','id','reason'];
    if (Object.keys(op).some(k=>!keys.includes(k))) throw new Error('Unknown fiscal tax-policy operation field');
    const index = rows.findIndex(row=>row.id === op.id);
    if (op.op === 'enact-tax-holiday') {
      const polity = resolvePolity(op.polity);
      if (!identity(polity) || !active.has(polity)) throw new Error('Unknown or inactive tax-policy polity');
      if (!validAmount(op.amount)) throw new Error('Invalid tax-policy nominal amount');
      if (!isoCurrency(op.currency)) throw new Error('Invalid tax-policy currency');
      if (!isCanonicalGameDate(op.startDate) || !isCanonicalGameDate(op.endDate)
        || compareGameDates(op.startDate,date) < 0) {
        throw new Error('Fiscal tax-policy start date precedes authorization or is invalid');
      }
      const duration = diffGameDays(op.startDate,op.endDate);
      if (duration < 1 || duration > 240) throw new Error('Fiscal tax-policy window must last 1..240 days');
      const record = { id:op.id,polity,currency:op.currency,amount:op.amount,
        startDate:op.startDate,endDate:op.endDate,reason:op.reason,
        authorizedAt:date,authorizedEventId:eventId,
        accruedThrough:op.startDate,accruedAmount:0,status:'scheduled' };
      if (index !== -1) {
        const previous = rows[index];
        for (const key of ['id','polity','currency','amount','startDate','endDate','reason',
          'authorizedAt','authorizedEventId']) {
          if (previous[key] !== record[key]) throw new Error('Fiscal tax-policy authorization conflict');
        }
        continue;
      }
      if (rows.length >= 64) throw new Error('Fiscal tax-policy capacity exceeded');
      rows = [...rows,record];
    } else {
      if (index < 0) throw new Error('Unknown fiscal tax-policy reference');
      const prior = rows[index];
      if (prior.status === 'repealed') {
        if (prior.repealedAt !== date || prior.repealEventId !== eventId
          || prior.repealReason !== op.reason) {
          throw new Error('Fiscal tax-policy repeal replay conflict');
        }
        continue;
      }
      if (compareGameDates(date,prior.authorizedAt) < 0
        || compareGameDates(date,prior.accruedThrough) < 0) {
        throw new Error('Fiscal tax-policy repeal date precedes established authority or accrual');
      }
      if (prior.status === 'expired') throw new Error('Cannot repeal expired tax policy');
      rows = rows.map((row,i)=>i === index ? {
        ...prior,status:'repealed',repealedAt:date,repealEventId:eventId,repealReason:op.reason,
      } : row);
    }
  }
  return { ...world, fiscalTaxPolicies: normalizeFiscalTaxPolicies(rows) };
};

// For each elapsed interval (fromDate,toDate], calculate the cumulative
// nominal forecast at the new endpoint, using integer cents/BigInt. Replay and
// re-partition preserve exactly the same amount even when cent rounding matters.
// Does not alter countryStats.economy, cash, taxes, deficit, or debt.
export const advanceFiscalTaxPolicyClock = (world,{fromDate,toDate}={}) => {
  const policies = normalizeFiscalTaxPolicies(world?.fiscalTaxPolicies);
  if (!policies.length) return world;
  if (!isCanonicalGameDate(fromDate) || !isCanonicalGameDate(toDate)
    || diffGameDays(fromDate,toDate) < 0) throw new Error('Invalid fiscal tax-policy clock interval');
  let changed = false;
  const next = policies.map(p => {
    if (p.status === 'repealed' || p.status === 'expired') return p;
    const through = compareGameDates(toDate,p.endDate) > 0 ? p.endDate : toDate;
    if (compareGameDates(through,p.accruedThrough) <= 0) return p;
    const accruedAmount = exactAccrual(p.amount,p.startDate,through,p.endDate);
    changed = true;
    return { ...p,accruedThrough:through,accruedAmount,
      status:through === p.endDate ? 'expired':'active' };
  });
  return changed ? { ...world,fiscalTaxPolicies:normalizeFiscalTaxPolicies(next) } : world;
};
