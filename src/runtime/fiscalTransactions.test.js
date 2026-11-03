import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFiscalTransactionOps, normalizeFiscalTransactions, validateFiscalEventOperations } from './fiscalTransactions.js';

const base = () => ({ fiscalTransactions: [], ownerCodes: ['Alba'], projects: [] });
const authorize = { op: 'authorize', id: 'hurricane-relief', polity: 'Alba',
  kind: 'grant', amount: 600_000_000, currency: 'USD',
  reason: 'Legislature appropriated emergency relief, not yet paid' };
const date = '2026-01-15';
const apply = (world, ops, eventId = 'bill-1', at = date) =>
  applyFiscalTransactionOps(world, ops, { eventId, date: at, resolvePolity: x => x });

test('authorized nominal relief survives normalization and does not imply a Treasury payment', () => {
  const source = base();
  const after = apply(source, [authorize]);
  assert.deepEqual(source.fiscalTransactions, []);
  const entry = after.fiscalTransactions[0];
  assert.equal(entry.status, 'authorized');
  assert.equal(entry.authorizedAmount, 600_000_000);
  assert.equal(entry.paidAmount, 0);
  assert.deepEqual(entry.payments, []);
  assert.equal(entry.authorizedEventId, 'bill-1');
  assert.deepEqual(normalizeFiscalTransactions(after.fiscalTransactions), after.fiscalTransactions);
  assert.equal(after.countryStats, undefined, 'an appropriation cannot create a national fiscal baseline');
  assert.deepEqual(apply(after, [authorize]).fiscalTransactions, after.fiscalTransactions,
    'replaying an identical accepted authorization is idempotent');
  assert.throws(() => apply(after, [{ ...authorize, amount: 700_000_000 }]), /conflict|different/i);
});

test('only explicitly evidenced partial payments enter the payment ledger, and replay never doubles them', () => {
  const first = apply(base(), [authorize]);
  const pay = { op: 'pay', id: authorize.id, amount: 200_000_000,
    funding: 'already-budgeted', reason: 'Certified transfer released' };
  const after = apply(first, [pay], 'payment-1', '2026-02-01');
  assert.equal(after.fiscalTransactions[0].paidAmount, 200_000_000);
  assert.equal(after.fiscalTransactions[0].status, 'partially-paid');
  assert.equal(after.fiscalTransactions[0].payments[0].eventId, 'payment-1');
  assert.deepEqual(apply(after, [pay], 'payment-1', '2026-02-01').fiscalTransactions, after.fiscalTransactions);
  const complete = apply(after, [{ ...pay, amount: 400_000_000 }], 'payment-2', '2026-02-15');
  assert.equal(complete.fiscalTransactions[0].status, 'paid');
  assert.equal(complete.fiscalTransactions[0].paidAmount, 600_000_000);
  assert.throws(() => apply(complete, [{ ...pay, amount: 1 }], 'payment-3', '2026-02-20'), /exceed|fully paid/i);
  assert.deepEqual(normalizeFiscalTransactions(complete.fiscalTransactions), complete.fiscalTransactions);
});

test('cancellation preserves historical paid amounts and stops all future disbursement', () => {
  const first = apply(base(), [authorize]);
  const partial = apply(first, [{ op:'pay', id: authorize.id, amount: 100_000_000,
    funding:'already-budgeted', reason:'First tranche delivered' }], 'paid-1', '2026-02-01');
  const stopped = apply(partial, [{ op:'cancel', id: authorize.id, reason:'Programme terminated' }],
    'cancel-1', '2026-02-02');
  assert.equal(stopped.fiscalTransactions[0].status, 'cancelled');
  assert.equal(stopped.fiscalTransactions[0].paidAmount, 100_000_000);
  assert.equal(stopped.fiscalTransactions[0].payments.length, 1);
  assert.deepEqual(apply(stopped, [{ op:'cancel', id: authorize.id, reason:'Programme terminated' }],
    'cancel-1', '2026-02-02').fiscalTransactions, stopped.fiscalTransactions);
  assert.throws(() => apply(stopped, [{ op:'pay', id: authorize.id, amount: 1,
    funding:'already-budgeted', reason:'Late attempted payment' }], 'late-1', '2026-02-03'), /cancelled/i);
});

test('invalid references, backdates, unpriced funding and duplicate operations fail closed', () => {
  const source = apply(base(), [authorize]);
  assert.throws(() => apply(base(), [{ ...authorize, amount: '600000000' }]), /amount/i);
  assert.throws(() => apply(base(), [{ ...authorize, currency: 'unknown' }]), /currency/i);
  assert.throws(() => apply(base(), [{ ...authorize, polity: 'Nonexistent' }]), /polity|country/i);
  assert.throws(() => apply(base(), [{ ...authorize, projectId: 'missing' }]), /project/i);
  assert.throws(() => apply(source, [{ op:'pay', id:'missing', amount:1, funding:'already-budgeted',
    reason:'Unknown reference' }]), /unknown/i);
  assert.throws(() => apply(source, [{ op:'pay', id:authorize.id, amount:1,
    funding:'new-debt', reason:'No GDP/currency authority' }]), /funding/i);
  assert.throws(() => apply(source, [{ op:'pay', id:authorize.id, amount:1,
    funding:'already-budgeted', reason:'Backdated payment' }], 'backdate', '2025-12-31'), /before|date/i);
  assert.throws(() => apply(source, [{ op:'pay', id:authorize.id, amount:1,
    funding:'already-budgeted', reason:'Duplicate' }, { op:'pay', id:authorize.id, amount:1,
    funding:'already-budgeted', reason:'Duplicate' }], 'duplicate'), /duplicate/i);
  assert.throws(() => normalizeFiscalTransactions([{ ...source.fiscalTransactions[0],
    paidAmount: 400, payments: [] }]), /invalid|mismatch/i);
});

test('preview preflight validates sequential event references without mutating live state', () => {
  const world = base();
  const events = [
    { id:'a',date:'2026-01-15',impacts:{fiscalOps:[authorize]} },
    { id:'b',date:'2026-02-01',impacts:{fiscalOps:[{op:'pay',id:authorize.id,
      amount:125_000_000,funding:'already-budgeted',
      reason:'Independently confirmed first relief tranche'}]} },
  ];
  assert.equal(validateFiscalEventOperations(world,events),'');
  assert.equal(world.fiscalTransactions.length,0);
  assert.match(validateFiscalEventOperations(world,[events[1]]),
    /events\[0\].*unknown fiscal transaction/i);
  assert.match(validateFiscalEventOperations(world,[events[0],{...events[1],date:'2025-01-01'}]),
    /before.*authoriz/i);
  assert.match(validateFiscalEventOperations(world,[events[0],{...events[1],
    impacts:{fiscalOps:[{...events[1].impacts.fiscalOps[0],funding:'new-debt'}]}}]),
    /funding/i);
});

test('replay of the original authorization after payment or cancellation preserves every later receipt',()=>{
  const first=apply(base(),[authorize]);
  const paid=apply(first,[{op:'pay',id:authorize.id,amount:100_000_000,
    funding:'already-budgeted',reason:'Audited payment receipt'}],'paid-event','2026-02-01');
  assert.deepEqual(apply(paid,[authorize]).fiscalTransactions,paid.fiscalTransactions);
  const cancelled=apply(paid,[{op:'cancel',id:authorize.id,
    reason:'Undisbursed relief authority terminated'}],'cancel-event','2026-02-02');
  assert.deepEqual(apply(cancelled,[authorize]).fiscalTransactions,cancelled.fiscalTransactions);
  assert.throws(()=>apply(cancelled,[{...authorize,currency:'EUR'}]),/conflict|different/i);
});
