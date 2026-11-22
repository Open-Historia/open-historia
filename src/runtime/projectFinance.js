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

const fail = (message) => {
  throw new Error(`Project Finance: ${message}`);
};

const owns = (value, key) => Object.hasOwn(value, key);

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const assertExactFields = (value, keys) => {
  if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some((key) => !owns(value, key))) {
    fail("invalid receipt fields");
  }
};

const assertIdentifier = (value, maxLength = 240) => {
  if (typeof value !== "string" || !value.length || value.length > maxLength || value !== value.trim() || /[\u0000-\u001f]/.test(value)) {
    fail("invalid identifier");
  }
  return value;
};

const assertContractText = (value, maxLength = 1000) => {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    fail("missing or oversized contract information");
  }
  return value;
};

const assertCanonicalDate = (value) => {
  if (typeof value !== "string" || !value || normalizeGameDate(value) !== value || !Number.isFinite(gameDateDayNumber(value))) {
    fail("noncanonical date");
  }
  return value;
};

const assertSafeInteger = (value, minValue = 0, maxValue = MAX_AMOUNT) => {
  if (!Number.isSafeInteger(value) || value < minValue || value > maxValue) {
    fail("invalid or overflowing amount");
  }
  return value;
};

const addMinor = (left, right) => assertSafeInteger(left + right);
const isBeforeDate = (left, right) => compareGameDates(left, right) < 0;
const isAfterDate = (left, right) => compareGameDates(left, right) > 0;

const COMMAND_TYPES = new Set(["authorize", "draw", "allocate", "release", "return"]);

const RECEIPT_FIELDS = {
  authorize: [
    "mandateId", "sourceEventId", "borrower", "lenderKind", "lenderId",
    "currency", "minorDigits", "originalLimitMinor", "limitMinor",
    "equivalenceBasis", "annualRateBps", "maturity", "repaymentSource", "projectIds",
  ],
  draw: ["mandateId", "sourceEventId", "originalMinor", "amountMinor", "eligibleFrom", "supplierId", "projectId"],
  allocate: ["mandateId", "bucketId", "projectId", "amountMinor"],
  release: ["mandateId", "bucketId", "amountMinor"],
  return: ["mandateId", "sourceEventId", "bucketId", "amountMinor"],
  cost: ["bucketId", "projectId", "amountMinor"],
  service: ["interestMinor", "principalMinor"],
};

const BASE_FIELDS = ["id", "type", "facilityId", "date"];

const canonicalReceipt = (raw) => {
  if (!isRecord(raw) || typeof raw.type !== "string" || !owns(RECEIPT_FIELDS, raw.type)) {
    fail("unknown receipt kind");
  }
  const keys = [...BASE_FIELDS, ...RECEIPT_FIELDS[raw.type]];
  assertExactFields(raw, keys);
  const receipt = Object.fromEntries(keys.map((key) => [key, raw[key]]));
  assertIdentifier(receipt.id, COMMAND_TYPES.has(receipt.type) ? 240 : 512);
  assertIdentifier(receipt.facilityId);
  assertCanonicalDate(receipt.date);

  if (COMMAND_TYPES.has(receipt.type) && /^(cost|service):/.test(receipt.id)) {
    fail("reserved engine receipt identifier");
  }
  if (COMMAND_TYPES.has(receipt.type)) assertIdentifier(receipt.mandateId);
  if (owns(receipt, "sourceEventId")) assertIdentifier(receipt.sourceEventId);
  if (owns(receipt, "amountMinor")) assertSafeInteger(receipt.amountMinor, 1);
  if (owns(receipt, "bucketId")) assertIdentifier(receipt.bucketId);

  if (receipt.type === "authorize") {
    assertIdentifier(receipt.borrower);
    assertIdentifier(receipt.lenderId);
    if (!["polity", "institution"].includes(receipt.lenderKind) || (receipt.lenderKind === "polity" && receipt.lenderId === receipt.borrower)) {
      fail("invalid lender");
    }
    assertContractText(receipt.currency, 48);
    assertSafeInteger(receipt.minorDigits, 0, 6);
    assertSafeInteger(receipt.originalLimitMinor, 1);
    assertSafeInteger(receipt.limitMinor, 1);
    assertContractText(receipt.equivalenceBasis);
    assertSafeInteger(receipt.annualRateBps, 0, 10_000);
    assertCanonicalDate(receipt.maturity);
    if (!isAfterDate(receipt.maturity, receipt.date) || receipt.repaymentSource !== "projectAllowance") {
      fail("unsupported maturity or repayment source");
    }
    if (!Array.isArray(receipt.projectIds) || !receipt.projectIds.length || receipt.projectIds.length > 64) {
      fail("missing or excessive eligible projects");
    }
    receipt.projectIds = receipt.projectIds.map((projectId) => assertIdentifier(projectId));
    if (new Set(receipt.projectIds).size !== receipt.projectIds.length) {
      fail("duplicate eligible project");
    }
  } else if (receipt.type === "draw") {
    assertSafeInteger(receipt.originalMinor, 1);
    assertCanonicalDate(receipt.eligibleFrom);
    if (!isAfterDate(receipt.eligibleFrom, receipt.date)) {
      fail("draw cannot fund pre-disbursement days");
    }
    if (receipt.supplierId !== null) assertIdentifier(receipt.supplierId);
    if (receipt.projectId !== null) assertIdentifier(receipt.projectId);
    if (receipt.supplierId !== null && receipt.projectId === null) {
      fail("supplier payment requires earmarked project");
    }
  } else if (receipt.type === "allocate" || receipt.type === "cost") {
    assertIdentifier(receipt.projectId);
  } else if (receipt.type === "service") {
    assertSafeInteger(receipt.interestMinor);
    assertSafeInteger(receipt.principalMinor);
    if (!addMinor(receipt.interestMinor, receipt.principalMinor)) {
      fail("empty repayment");
    }
  }

  if (receipt.type === "cost" && receipt.id !== `cost:${receipt.date}:${receipt.bucketId}`) {
    fail("invalid cost receipt identity");
  }
  if (receipt.type === "service" && receipt.id !== `service:${receipt.date}:${receipt.facilityId}`) {
    fail("invalid service receipt identity");
  }
  return receipt;
};

const receiptSignature = (receipt) => JSON.stringify(receipt);

const createLedgerState = () => ({
  receipts: [],
  ids: new Map(),
  mandates: new Set(),
  facilities: new Map(),
  lastDate: "",
});

const accrueInterest = (facility, throughDate) => {
  const days = diffGameDays(facility.accruedThrough, throughDate);
  if (!Number.isSafeInteger(days) || days < 0) {
    fail("out-of-order accrual");
  }
  const numerator = (
    BigInt(facility.outstandingMinor)
    * BigInt(facility.terms.annualRateBps)
    * BigInt(days)
    + facility.interestCarry
  );
  const dueMinor = Number(numerator / RATE_DENOMINATOR);
  facility.interestDueMinor = addMinor(facility.interestDueMinor, assertSafeInteger(dueMinor));
  facility.interestCarry = numerator % RATE_DENOMINATOR;
  facility.accruedThrough = throughDate;
};

// Each draw uses the same independently approved accounting equivalence.
// Cumulative half-up rounding avoids creating extra cents by splitting draws.
const cumulativeEquivalentMinor = (terms, cumulativeOriginalMinor) => {
  const numerator = BigInt(terms.limitMinor) * BigInt(cumulativeOriginalMinor);
  const denominator = BigInt(terms.originalLimitMinor);
  return assertSafeInteger(Number((2n * numerator + denominator) / (2n * denominator)));
};

export const projectFinanceDrawAmount = (facility, originalMinor) => {
  assertSafeInteger(originalMinor, 1);
  const nextOriginalMinor = addMinor(facility.drawnOriginalMinor, originalMinor);
  if (nextOriginalMinor > facility.terms.originalLimitMinor) {
    fail("credit limit exceeded");
  }
  return assertSafeInteger(cumulativeEquivalentMinor(facility.terms, nextOriginalMinor) - facility.drawnMinor, 1);
};

const requireBucket = (facility, bucketId) => {
  const bucket = facility.buckets.get(bucketId);
  if (!bucket) fail("unknown funding bucket");
  return bucket;
};

const assertProjectEligible = (facility, projectId) => {
  if (!facility.terms.projectIds.includes(projectId)) {
    fail("project outside authorized facility");
  }
};

const consumeBucket = (bucket, amountMinor) => {
  if (amountMinor > bucket.remainingMinor) {
    fail("insufficient finite proceeds");
  }
  bucket.remainingMinor -= amountMinor;
};

const openBucket = (facility, receipt, { projectId = null, supplierId = null, eligibleFrom }) => {
  facility.buckets.set(receipt.id, {
    id: receipt.id,
    projectId,
    supplierId,
    eligibleFrom,
    remainingMinor: receipt.amountMinor,
  });
};

const applyReceipt = (ledgerState, receipt) => {
  const prior = ledgerState.ids.get(receipt.id);
  if (prior) {
    if (receiptSignature(prior) !== receiptSignature(receipt)) {
      fail("conflicting receipt identity");
    }
    return false;
  }
  if (ledgerState.receipts.length >= FINANCE_RECEIPTS_MAX) {
    fail("receipt capacity reached; no history discarded");
  }
  if (ledgerState.lastDate && isBeforeDate(receipt.date, ledgerState.lastDate)) {
    fail("out-of-order receipt");
  }
  if (COMMAND_TYPES.has(receipt.type) && ledgerState.mandates.has(receipt.mandateId)) {
    fail("mandate already settled");
  }

  let facility = ledgerState.facilities.get(receipt.facilityId);
  if (receipt.type === "authorize") {
    if (facility) fail("facility already exists");
    facility = {
      terms: receipt,
      drawnOriginalMinor: 0,
      drawnMinor: 0,
      outstandingMinor: 0,
      interestDueMinor: 0,
      interestPaidMinor: 0,
      principalPaidMinor: 0,
      costAppliedMinor: 0,
      returnedMinor: 0,
      interestCarry: 0n,
      accruedThrough: receipt.date,
      buckets: new Map(),
    };
    ledgerState.facilities.set(receipt.facilityId, facility);
  } else {
    if (!facility) fail("unknown facility");
    accrueInterest(facility, receipt.date);

    if (receipt.type === "draw") {
      if (!isBeforeDate(receipt.date, facility.terms.maturity)) {
        fail("draw at or after maturity");
      }
      const nextOriginalMinor = addMinor(facility.drawnOriginalMinor, receipt.originalMinor);
      if (nextOriginalMinor > facility.terms.originalLimitMinor) {
        fail("credit limit exceeded");
      }
      const nextCumulativeMinor = cumulativeEquivalentMinor(facility.terms, nextOriginalMinor);
      if (nextCumulativeMinor - facility.drawnMinor !== receipt.amountMinor || nextCumulativeMinor > facility.terms.limitMinor) {
        fail("draw does not match approved accounting equivalence");
      }
      if (receipt.projectId !== null) assertProjectEligible(facility, receipt.projectId);
      facility.drawnOriginalMinor = nextOriginalMinor;
      facility.drawnMinor = nextCumulativeMinor;
      facility.outstandingMinor = addMinor(facility.outstandingMinor, receipt.amountMinor);
      openBucket(facility, receipt, {
        projectId: receipt.projectId,
        supplierId: receipt.supplierId,
        eligibleFrom: receipt.eligibleFrom,
      });
    } else if (receipt.type === "allocate" || receipt.type === "release") {
      const sourceBucket = requireBucket(facility, receipt.bucketId);
      if (sourceBucket.supplierId !== null) {
        fail("supplier prepayment cannot be reallocated as cash");
      }
      if (receipt.type === "allocate") {
        if (sourceBucket.projectId !== null) fail("allocation requires unallocated proceeds");
        assertProjectEligible(facility, receipt.projectId);
      } else if (sourceBucket.projectId === null) {
        fail("release requires allocated proceeds");
      }
      consumeBucket(sourceBucket, receipt.amountMinor);
      openBucket(facility, receipt, {
        projectId: receipt.type === "allocate" ? receipt.projectId : null,
        eligibleFrom: sourceBucket.eligibleFrom,
      });
    } else if (receipt.type === "return") {
      const sourceBucket = requireBucket(facility, receipt.bucketId);
      if (sourceBucket.supplierId !== null || sourceBucket.projectId !== null || isBeforeDate(receipt.date, sourceBucket.eligibleFrom)) {
        fail("return requires available unallocated cash");
      }
      if (receipt.amountMinor > facility.outstandingMinor) {
        fail("return exceeds outstanding principal");
      }
      consumeBucket(sourceBucket, receipt.amountMinor);
      facility.outstandingMinor -= receipt.amountMinor;
      facility.returnedMinor = addMinor(facility.returnedMinor, receipt.amountMinor);
    } else if (receipt.type === "cost") {
      const sourceBucket = requireBucket(facility, receipt.bucketId);
      if (sourceBucket.projectId !== receipt.projectId || isBeforeDate(receipt.date, sourceBucket.eligibleFrom)) {
        fail("cost outside earmark or eligibility");
      }
      consumeBucket(sourceBucket, receipt.amountMinor);
      facility.costAppliedMinor = addMinor(facility.costAppliedMinor, receipt.amountMinor);
    } else if (receipt.type === "service") {
      if (isBeforeDate(receipt.date, facility.terms.maturity)) {
        fail("repayment before contractual maturity");
      }
      if (
        receipt.interestMinor > facility.interestDueMinor
        || receipt.principalMinor > facility.outstandingMinor
        || (receipt.principalMinor > 0 && receipt.interestMinor !== facility.interestDueMinor)
      ) {
        fail("repayment exceeds liability or skips interest");
      }
      facility.interestDueMinor -= receipt.interestMinor;
      facility.outstandingMinor -= receipt.principalMinor;
      facility.interestPaidMinor = addMinor(facility.interestPaidMinor, receipt.interestMinor);
      facility.principalPaidMinor = addMinor(facility.principalPaidMinor, receipt.principalMinor);
    }
  }

  ledgerState.receipts.push(receipt);
  ledgerState.ids.set(receipt.id, receipt);
  ledgerState.lastDate = receipt.date;
  if (COMMAND_TYPES.has(receipt.type)) {
    ledgerState.mandates.add(receipt.mandateId);
  }
  return true;
};

const replayLedger = (ledger) => {
  const ledgerState = createLedgerState();
  if (ledger === undefined) return ledgerState; // legacy save has no finance, never inferred
  assertExactFields(ledger, ["version", "receipts"]);
  if (
    ledger.version !== PROJECT_FINANCE_VERSION
    || !Array.isArray(ledger.receipts)
    || ledger.receipts.length > FINANCE_RECEIPTS_MAX
  ) {
    fail("unsupported or oversized ledger");
  }
  for (const raw of ledger.receipts) {
    if (!applyReceipt(ledgerState, canonicalReceipt(raw))) {
      fail("duplicate stored receipt");
    }
  }
  return ledgerState;
};

const serializeLedger = (ledgerState) => ({
  version: PROJECT_FINANCE_VERSION,
  receipts: ledgerState.receipts.map((receipt) => ({
    ...receipt,
    ...(receipt.projectIds ? { projectIds: [...receipt.projectIds] } : {}),
  })),
});

export const normalizeProjectFinance = (ledger) => serializeLedger(replayLedger(ledger));

// Exact authorization comes from the trusted caller, never a flag supplied
// by the model. The authorizer receives the immutable validated receipt and
// current facility, and must return true only for the matching native mandate.
// Engine cost and service receipts cannot enter through this command door.
export const appendProjectFinanceCommand = (ledger, raw, { authorize } = {}) => {
  const ledgerState = replayLedger(ledger);
  const receipt = canonicalReceipt(raw);
  if (!COMMAND_TYPES.has(receipt.type) || typeof authorize !== "function") {
    fail("no authorized financing command");
  }
  const existingTerms = ledgerState.facilities.get(receipt.facilityId)?.terms;
  if (authorize(structuredClone(receipt), existingTerms ? structuredClone(existingTerms) : null) !== true) {
    fail("financing mandate refused");
  }
  applyReceipt(ledgerState, receipt);
  return serializeLedger(ledgerState);
};

const summarizeLedger = (ledgerState, throughDate) => {
  assertCanonicalDate(throughDate);
  if (ledgerState.lastDate && isBeforeDate(throughDate, ledgerState.lastDate)) {
    fail("snapshot predates receipts");
  }
  return [...ledgerState.facilities.values()].map((facility) => {
    accrueInterest(facility, throughDate);
    const buckets = [...facility.buckets.values()].map((bucket) => ({ ...bucket }));
    const remainingMinor = buckets.reduce((sum, bucket) => addMinor(sum, bucket.remainingMinor), 0);
    if (
      addMinor(addMinor(remainingMinor, facility.costAppliedMinor), facility.returnedMinor) !== facility.drawnMinor
      || addMinor(addMinor(facility.outstandingMinor, facility.principalPaidMinor), facility.returnedMinor) !== facility.drawnMinor
    ) {
      fail("unbalanced receipt ledger");
    }
    const pastMaturity = !isBeforeDate(throughDate, facility.terms.maturity);
    return {
      terms: structuredClone(facility.terms),
      drawnOriginalMinor: facility.drawnOriginalMinor,
      drawnMinor: facility.drawnMinor,
      undrawnMinor: facility.terms.limitMinor - facility.drawnMinor,
      outstandingMinor: facility.outstandingMinor,
      interestDueMinor: facility.interestDueMinor,
      interestPaidMinor: facility.interestPaidMinor,
      principalPaidMinor: facility.principalPaidMinor,
      arrearsPrincipalMinor: pastMaturity ? facility.outstandingMinor : 0,
      arrearsInterestMinor: pastMaturity ? facility.interestDueMinor : 0,
      costAppliedMinor: facility.costAppliedMinor,
      returnedMinor: facility.returnedMinor,
      remainingMinor,
      buckets,
    };
  });
};

export const projectFinanceSnapshot = (ledger, throughDate) => summarizeLedger(replayLedger(ledger), throughDate);

// A temporary clock is pure relative to its input. Forecast and apply can
// independently call it over the same base; only the accepted turn may persist
// the returned ledger. One dated cost receipt per bucket and day, and one
// service receipt per facility and day. Exhausted buckets cannot pay again.
export const openProjectFinanceClock = (ledger, { fromDate, toDate } = {}) => {
  const ledgerState = replayLedger(ledger);
  assertCanonicalDate(fromDate);
  assertCanonicalDate(toDate);
  if (isBeforeDate(toDate, fromDate) || (ledgerState.lastDate && isAfterDate(ledgerState.lastDate, fromDate))) {
    fail("clock overlaps committed receipts");
  }
  const consumed = new Set();
  const serviced = new Set();
  let clockDate = fromDate;
  let finished = false;

  const advanceClockDay = (dayDate) => {
    assertCanonicalDate(dayDate);
    if (finished || !isAfterDate(dayDate, fromDate) || isAfterDate(dayDate, toDate) || isBeforeDate(dayDate, clockDate)) {
      fail("clock date outside period");
    }
    clockDate = dayDate;
  };

  const available = (owner, projectId, dayDate) => {
    advanceClockDay(dayDate);
    let totalAvailable = 0;
    for (const facility of ledgerState.facilities.values()) {
      if (facility.terms.borrower !== owner) continue;
      for (const bucket of facility.buckets.values()) {
        if (bucket.projectId === projectId && !isBeforeDate(dayDate, bucket.eligibleFrom)) {
          totalAvailable = addMinor(totalAvailable, bucket.remainingMinor);
        }
      }
    }
    return totalAvailable;
  };

  const fund = (owner, projectId, dayDate, dueMinor) => {
    advanceClockDay(dayDate);
    assertSafeInteger(dueMinor);
    assertIdentifier(owner);
    assertIdentifier(projectId);
    const key = JSON.stringify([owner, projectId, dayDate]);
    if (consumed.has(key)) fail("project already settled on this day");
    consumed.add(key);

    let remainingDue = dueMinor;
    for (const facility of ledgerState.facilities.values()) {
      if (facility.terms.borrower !== owner) continue;
      for (const bucket of facility.buckets.values()) {
        if (!remainingDue) break;
        if (bucket.projectId !== projectId || isBeforeDate(dayDate, bucket.eligibleFrom) || !bucket.remainingMinor) {
          continue;
        }
        const amountMinor = Math.min(remainingDue, bucket.remainingMinor);
        applyReceipt(ledgerState, canonicalReceipt({
          id: `cost:${dayDate}:${bucket.id}`,
          type: "cost",
          facilityId: facility.terms.facilityId,
          date: dayDate,
          bucketId: bucket.id,
          projectId,
          amountMinor,
        }));
        remainingDue -= amountMinor;
      }
    }
    return dueMinor - remainingDue;
  };

  const service = (owner, dayDate, poolMinor) => {
    advanceClockDay(dayDate);
    assertIdentifier(owner);
    assertSafeInteger(poolMinor);
    const key = JSON.stringify([owner, dayDate]);
    if (serviced.has(key)) fail("owner already serviced on this day");
    serviced.add(key);

    let remainingPool = poolMinor;
    for (const facility of ledgerState.facilities.values()) {
      if (!remainingPool) break;
      if (facility.terms.borrower !== owner || isBeforeDate(dayDate, facility.terms.maturity)) {
        continue;
      }
      accrueInterest(facility, dayDate);
      const interestMinor = Math.min(remainingPool, facility.interestDueMinor);
      const principalMinor = Math.min(remainingPool - interestMinor, facility.outstandingMinor);
      if (interestMinor || principalMinor) {
        applyReceipt(ledgerState, canonicalReceipt({
          id: `service:${dayDate}:${facility.terms.facilityId}`,
          type: "service",
          facilityId: facility.terms.facilityId,
          date: dayDate,
          interestMinor,
          principalMinor,
        }));
        remainingPool -= interestMinor + principalMinor;
      }
    }
    return poolMinor - remainingPool;
  };

  // A signed but undrawn facility is metadata, not a funding or service
  // obligation. Fully settled facilities with no eligible funds are likewise
  // inert for the clock; their immutable receipts remain in the ledger.
  const borrowers = [...new Set(
    [...ledgerState.facilities.values()]
      .filter((facility) => (
        facility.outstandingMinor > 0
        || facility.interestDueMinor > 0
        || [...facility.buckets.values()].some((bucket) => bucket.projectId !== null && bucket.remainingMinor > 0)
      ))
      .map((facility) => facility.terms.borrower),
  )];

  return {
    borrowers,
    available,
    fund,
    service,
    finish: () => {
      if (finished) fail("clock already finished");
      finished = true;
      const snapshot = summarizeLedger(ledgerState, toDate);
      return { ledger: serializeLedger(ledgerState), snapshot };
    },
  };
};
