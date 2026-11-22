/*! Open Historia - native Project Finance world and debt ownership. AGPL-3.0-or-later. */
import { appendProjectFinanceCommand, normalizeProjectFinance, projectFinanceSnapshot } from "./projectFinance.js";
import { mergeCountryStatPatch } from "./countryStats.js";
import { addGameDays, compareGameDates, normalizeGameDate } from "./gameDates.js";
import { buildOwnerAliasMap, createOwnerResolver, toCountryName } from "./ownerNames.js";
import { projectFundingMode, projectOwnerOf } from "./projectEngine.js";
import { isBelief, isProjectOpen } from "./projects.js";
import { buildPolityIdentityIndex, resolvePolityIdentity } from "./polityIdentity.js";
import COUNTRY_NAMES from "./generated/countryNames.js";

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

const fail = (message) => {
  throw new Error(`Project Finance: ${message}`);
};

const own = (value, key) => Object.hasOwn(value ?? {}, key);

const parseMinorBigInt = (value) => {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) fail("unsafe accounting amount");
    return BigInt(value);
  }
  if (typeof value === "string" && /^(?:0|[1-9]\d{0,30})$/.test(value)) {
    return BigInt(value);
  }
  fail("unsafe accounting amount");
};

const serializeMinor = (value) => (value <= MAX_SAFE_BIGINT ? Number(value) : value.toString());

const lastReceiptDate = (ledger) => ledger?.receipts?.at(-1)?.date;

const principalByOwner = (ledger) => {
  const totals = new Map();
  const latestDate = lastReceiptDate(ledger);
  if (!latestDate) return totals;
  for (const facility of projectFinanceSnapshot(ledger, latestDate)) {
    if (facility.drawnMinor > 0) {
      const prior = totals.get(facility.terms.borrower) ?? 0n;
      totals.set(facility.terms.borrower, prior + BigInt(facility.outstandingMinor));
    }
  }
  return totals;
};

const baselineGDP = (sheet) => {
  const gdp = sheet?.economy?.gdp;
  if (typeof gdp !== "number" || !Number.isFinite(gdp) || gdp <= 0) {
    fail("a known positive GDP is required for fiscal settlement");
  }
  return gdp;
};

// Compute aggregate debt in cents using BigInt so large economies (>$90T
// aggregate debt) never overflow Number.MAX_SAFE_INTEGER when stored or summed.
// Note: `gdp * rate` is evaluated in IEEE-754 float64 (~15-17 significant digits),
// which is already more precise than assessed macro GDP/debt-ratio estimates.
const assessedPrincipalBigInt = (sheet) => {
  const gdp = baselineGDP(sheet);
  const rate = sheet?.economy?.publicDebt;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1000) {
    fail("a known aggregate public debt baseline is required");
  }
  const product = Math.round(gdp * rate);
  if (!Number.isFinite(product) || product < 0) {
    fail("missing or invalid assessed fiscal baseline");
  }
  return BigInt(Math.trunc(product));
};

const derivedSheet = (sheet, otherMinorBig, nativeMinorBig) => {
  const gdp = baselineGDP(sheet);
  const totalMinorBig = otherMinorBig + nativeMinorBig;
  // GDP is in dollars and principal in cents, so % GDP = cents / GDP.
  const ratio = Number(totalMinorBig) / gdp;
  if (!Number.isFinite(ratio) || ratio > 1000) {
    fail("tracked aggregate debt exceeds the supported Stats range");
  }
  return { ...sheet, economy: { ...sheet.economy, publicDebt: ratio } };
};

export const financeLenderOptions = (world, actor = "") => {
  const resolve = createOwnerResolver(buildOwnerAliasMap(world?.polityOverrides));
  const actorKey = actor ? resolve(actor) : "";
  const polityMap = new Map();
  const isDissolved = (key) => String(world?.polityOverrides?.[key]?.status ?? "").toLowerCase() === "dissolved";

  for (const [rawKey, override] of Object.entries(world?.polityOverrides ?? {})) {
    const resolved = resolve(rawKey);
    if (resolved && !isDissolved(resolved)) {
      polityMap.set(resolved, override?.name || world?.polityOverrides?.[resolved]?.name || resolved);
    }
  }
  for (const key of Object.keys(world?.countryStats ?? {})) {
    const resolved = resolve(key);
    if (resolved && !isDissolved(resolved)) {
      polityMap.set(resolved, world?.polityOverrides?.[resolved]?.name || resolved);
    }
  }
  const identity = buildPolityIdentityIndex(world ?? {});
  for (const key of identity.ownershipCounts?.keys?.() ?? []) {
    const resolved = resolve(toCountryName(key));
    if (resolved && !isDissolved(resolved)) {
      polityMap.set(resolved, world?.polityOverrides?.[resolved]?.name || resolved);
    }
  }
  if (!world?.customRegions) {
    for (const key of new Set(Object.values(COUNTRY_NAMES))) {
      const result = resolvePolityIdentity(key, world ?? {}, {
        identityIndex: identity,
        requireActive: true,
        allowUnknown: false,
        allowStockBase: true,
      });
      if (result.resolved && !isDissolved(result.resolved)) {
        polityMap.set(result.resolved, world?.polityOverrides?.[result.resolved]?.name || result.resolved);
      }
    }
  }
  if (actorKey) polityMap.delete(actorKey);

  const polities = [...polityMap]
    .map(([id, label]) => ({ kind: "polity", id, label }))
    .sort((left, right) => left.label.localeCompare(right.label));

  const institutionsById = world?.institutions?.byId ?? world?.institutions ?? {};
  const institutions = Object.entries(institutionsById)
    .filter(([, row]) => row && typeof row === "object" && !Array.isArray(row) && typeof row.name === "string" && row.name.trim() && String(row.status ?? "").toLowerCase() !== "dissolved")
    .map(([id, row]) => ({ kind: "institution", id: row.id || id, label: row.name.trim() }))
    .sort((left, right) => left.label.localeCompare(right.label));

  return { polities, institutions };
};

// Read boundary. Never reconstruct a residual from a displayed ratio on load:
// it must have been explicitly established when the first draw was booked.
export const financeWorldFields = (world) => {
  if (!own(world, "projectFinance")) {
    if (own(world, "projectFinanceDebt")) fail("debt baseline without receipt journal");
    return {};
  }
  const ledger = normalizeProjectFinance(world.projectFinance);
  if (projectFundingMode(world) === "nonmonetary" && ledger.receipts.length) {
    fail("monetary financing in a non-monetary campaign");
  }
  const principals = principalByOwner(ledger);
  const rows = world.projectFinanceDebt;
  if (!Array.isArray(rows) || rows.length !== principals.size) {
    fail("missing or inconsistent residual debt ledger");
  }
  const seen = new Set();
  const countryStats = { ...world.countryStats };
  const debt = rows.map((row) => {
    if (
      !row || typeof row !== "object" || Object.keys(row).length !== 2
      || typeof row.owner !== "string" || !principals.has(row.owner) || seen.has(row.owner)
    ) {
      fail("unresolved or duplicate borrower debt baseline");
    }
    seen.add(row.owner);
    const otherMinorBig = parseMinorBigInt(row.otherMinor);
    // A defeated polity can lose its economic sheet; its recorded claim
    // survives. No fabricated GDP or ratio when the denominator is lost.
    if (own(countryStats, row.owner) && typeof countryStats[row.owner]?.economy?.gdp === "number" && countryStats[row.owner].economy.gdp > 0) {
      countryStats[row.owner] = derivedSheet(countryStats[row.owner], otherMinorBig, principals.get(row.owner));
    }
    return { owner: row.owner, otherMinor: serializeMinor(otherMinorBig) };
  });
  return { projectFinance: ledger, projectFinanceDebt: debt, countryStats };
};

// Only a genuine changed aggregate estimate reconciles other debt. The exact
// native principal is never replaced by an estimate. An unchanged value from a
// complete Stats response does not rebase principal as GDP drifts. GDP-only
// growth/refresh changes the denominator, not this monetary liability.
// If an external estimate (AI stats, peace treaty, agreement, cheat) drops
// below recorded native principal, floor residual other-debt at 0 instead of
// aborting the turn — native loan principal remains fully intact in publicDebt.
export const mergeFinanceAwareCountryStat = (world, country, patch, options = {}) => {
  const prior = world.countryStats?.[country];
  const next = mergeCountryStatPatch(prior, patch, options);
  if (!next || !own(world, "projectFinance")) return next;
  const row = world.projectFinanceDebt?.find((entry) => entry.owner === country);
  if (!row) return next;
  const nativePrincipal = principalByOwner(world.projectFinance).get(country);
  if (nativePrincipal === undefined) fail("missing tracked principal");

  let otherMinorBig = parseMinorBigInt(row.otherMinor);
  if (!(next.economy?.gdp > 0)) {
    if (own(patch?.economy, "publicDebt") && next.economy?.publicDebt !== prior?.economy?.publicDebt) {
      fail("cannot reconcile debt without assessed GDP");
    }
    return next;
  }
  if (own(patch?.economy, "publicDebt") && next.economy?.publicDebt !== prior?.economy?.publicDebt) {
    const assessedTotal = assessedPrincipalBigInt(next);
    otherMinorBig = assessedTotal > nativePrincipal ? assessedTotal - nativePrincipal : 0n;
  }
  const sheet = derivedSheet(next, otherMinorBig, nativePrincipal);
  const serializedOther = serializeMinor(otherMinorBig);
  world.projectFinanceDebt = world.projectFinanceDebt.map((entry) => (
    entry === row ? { owner: country, otherMinor: serializedOther } : entry
  ));
  return sheet;
};

export const refreshFinanceDebtRatios = (world) => {
  if (own(world, "projectFinance")) {
    Object.assign(world, financeWorldFields(world));
  }
  return world;
};

// Rekey current party references only. Contract denominations, receipt IDs,
// exact source IDs, original dates and accounting amounts are not changed.
export const resolveFinanceParties = (ledger, resolve) => {
  if (ledger === undefined) return undefined;
  const clean = normalizeProjectFinance(ledger);
  return normalizeProjectFinance({
    ...clean,
    receipts: clean.receipts.map((receipt) => (
      receipt.type !== "authorize"
        ? receipt
        : {
          ...receipt,
          borrower: resolve(receipt.borrower),
          lenderId: receipt.lenderKind === "polity" ? resolve(receipt.lenderId) : receipt.lenderId,
        }
    )),
  });
};

// The accepted turn may rename polities, but must not replace the finance base
// with an unrelated journal. A1 books only explicit approvals BETWEEN turns;
// same-turn AI proposals are not receipts. Clock results are merged atomically
// with the advanced board and existing residual (not a second aggregate delta).
export const settleFinanceClockWorld = (base, after, result) => {
  if (!result) {
    if (own(after, "projectFinance") !== own(base, "projectFinance")) {
      fail("finance changed during the turn");
    }
    return after;
  }
  const resolve = createOwnerResolver(buildOwnerAliasMap(after.polityOverrides));
  const rebased = resolveFinanceParties(base.projectFinance, resolve);
  if (JSON.stringify(rebased) !== JSON.stringify(after.projectFinance)) {
    fail("finance changed during the turn");
  }
  return refreshFinanceDebtRatios({
    ...after,
    projectFinance: resolveFinanceParties(result.ledger, resolve),
  });
};

export const financeReviewStamp = (world, game) => {
  const resolve = createOwnerResolver(buildOwnerAliasMap(world.polityOverrides));
  const actor = resolve(toCountryName(game.country));
  const economy = world.countryStats?.[actor]?.economy;
  return {
    country: game.country,
    round: game.round,
    date: game.gameDate,
    ledger: JSON.stringify(world.projectFinance ?? null),
    baseline: JSON.stringify([economy?.gdp, economy?.publicDebt, world.projectFinanceDebt ?? []]),
  };
};

export const financeSourceText = (event) => JSON.stringify([event?.id, event?.date, event?.title, event?.description]);

export const eligibleFinanceSource = (event, actor, resolve = (value) => value) => Boolean(
  event?.id
  && event?.date
  && typeof event.description === "string"
  && event.description.trim()
  && event.playerRelated
  && !event.audience?.length
  && event.kind !== "espionage"
  && (
    !event.agency?.principal
    || [
      event.agency.principal,
      event.agency.sovereignPolity,
      ...(event.agency.sovereignActors ?? []).map((row) => row.polity),
    ].some((name) => name && resolve(name) === actor)
  ),
);

const requireOwnedPaidProject = (world, projectId, actor) => {
  const rows = (world.projects ?? []).filter(
    (project) => project.id === projectId && projectOwnerOf(project, actor) === actor,
  );
  if (rows.length !== 1 || isBelief(rows[0]) || !isProjectOpen(rows[0]) || !(rows[0].plan?.monthlyCost > 0)) {
    fail("select an existing paid project belonging to your government");
  }
  return rows[0];
};

const requireExactSource = ({ events, sourceId, expectedSource, currentDate, actor, resolve }) => {
  const matches = events.filter((event) => event.id === sourceId);
  const event = matches[0];
  if (
    matches.length !== 1
    || !eligibleFinanceSource(event, actor, resolve)
    || financeSourceText(event) !== expectedSource
    || normalizeGameDate(event.date) !== event.date
    || compareGameDates(event.date, currentDate) > 0
  ) {
    fail("source event is unavailable, changed or not a recorded event of your government");
  }
  return event;
};

const buildReceiptId = (type, sourceId) => {
  if (typeof sourceId !== "string" || sourceId.length > 180) {
    fail("source identity too long");
  }
  return `finance:${type}:${sourceId}`;
};

const validateLender = (world, lenderKind, party, actor, resolve) => {
  const options = financeLenderOptions(world, actor);
  if (lenderKind === "institution") {
    const match = options.institutions.find((row) => row.id === party);
    if (!match) fail("select a registered foreign lender");
    return { lenderKind: "institution", lenderId: match.id };
  }
  const lender = resolve(party);
  if (!lender || lender === actor || !options.polities.some((row) => row.id === lender)) {
    fail("select a registered foreign lender");
  }
  return { lenderKind: "polity", lenderId: lender };
};

const appendAuthorizedReceipt = (ledger, receipt) => appendProjectFinanceCommand(ledger, receipt, {
  // This door is called ONLY from an explicit player confirmation against a
  // freshly read campaign and exact source. The model cannot call this door.
  authorize: (candidate) => (
    Object.keys(receipt).length === Object.keys(candidate).length
    && Object.entries(receipt).every(([key, value]) => JSON.stringify(value) === JSON.stringify(candidate[key]))
  ),
});

// Explicit manual reconciliation of an already recorded agreement or tranche.
// The human confirms the selected source establishes consent and exact terms;
// this is not a prose parser that can author a new loan. One signature and one
// disbursement per source event in V1 (separate identities, no double booking).
export const bookProjectFinance = ({ world, game, events, command, expected, shared = false, unseen = false } = {}) => {
  if (shared || unseen || world.activeInteractive || projectFundingMode(world) !== "gdp-proxy") {
    fail("finance changes require a fully revealed single-player campaign outside a scene");
  }
  const resolve = createOwnerResolver(buildOwnerAliasMap(world.polityOverrides));
  const actor = resolve(toCountryName(game.country));
  const currentDate = game.gameDate;
  if (!actor || !currentDate || !expected || Object.entries(financeReviewStamp(world, game)).some(([key, value]) => expected[key] !== value)) {
    fail("campaign or financing record changed; reopen the review");
  }
  if (!command || command.confirmed !== true) {
    fail("explicit government authorization is required");
  }

  let ledger = world.projectFinance;
  const debt = (world.projectFinanceDebt ?? []).map((row) => ({ ...row }));
  const principalBefore = principalByOwner(ledger).get(actor) ?? 0n;

  const requireUnbookedSource = () => {
    const sourceEvent = requireExactSource({
      events,
      sourceId: command.sourceId,
      expectedSource: command.expectedSource,
      currentDate,
      actor,
      resolve,
    });
    if (world.projectFinance?.receipts?.some((receipt) => receipt.type === command.type && receipt.sourceEventId === sourceEvent.id)) {
      fail("this source has already been booked");
    }
    return sourceEvent;
  };

  if (command.type === "authorize") {
    const event = requireUnbookedSource();
    const facilityId = buildReceiptId("facility", event.id);
    if (!Array.isArray(command.projectIds) || !command.projectIds.length) {
      fail("select eligible projects");
    }
    for (const projectId of command.projectIds) {
      requireOwnedPaidProject(world, projectId, actor);
    }
    if (compareGameDates(command.maturity, currentDate) <= 0) {
      fail("past-maturity reconciliation needs a separately reviewed repayment history");
    }
    const { lenderKind, lenderId } = validateLender(
      world,
      command.lenderKind === "institution" ? "institution" : "polity",
      command.lenderId,
      actor,
      resolve,
    );
    // Stamp booking receipts with currentDate (matching allocate/release/return
    // and eligibleFrom) so booking an earlier event after a time skip or
    // allocation never violates chronological receipt ordering.
    const receipt = {
      id: buildReceiptId("authorize", event.id),
      type: "authorize",
      facilityId,
      date: currentDate,
      mandateId: buildReceiptId("mandate-authorize", event.id),
      sourceEventId: event.id,
      borrower: actor,
      lenderKind,
      lenderId,
      currency: command.currency,
      minorDigits: command.minorDigits,
      originalLimitMinor: command.originalLimitMinor,
      limitMinor: command.limitMinor,
      equivalenceBasis: command.equivalenceBasis,
      annualRateBps: command.annualRateBps,
      maturity: command.maturity,
      repaymentSource: "projectAllowance",
      projectIds: command.projectIds,
    };
    ledger = appendAuthorizedReceipt(ledger, receipt);
  } else if (command.type === "draw") {
    const event = requireUnbookedSource();
    const facility = projectFinanceSnapshot(ledger, currentDate).find(
      (entry) => entry.terms.facilityId === command.facilityId && entry.terms.borrower === actor,
    );
    if (!facility) fail("facility not owned by the current government");
    const projectId = command.projectId;
    if (projectId !== null) requireOwnedPaidProject(world, projectId, actor);
    if (!["alreadyIncluded", "additional"].includes(command.debtTreatment)) {
      fail("explicit aggregate-debt reconciliation is required");
    }
    const receipt = {
      id: buildReceiptId("draw", event.id),
      type: "draw",
      facilityId: facility.terms.facilityId,
      date: currentDate,
      mandateId: buildReceiptId("mandate-draw", event.id),
      sourceEventId: event.id,
      originalMinor: command.originalMinor,
      amountMinor: command.amountMinor,
      eligibleFrom: addGameDays(currentDate, 1),
      supplierId: command.supplierId,
      projectId,
    };
    ledger = appendAuthorizedReceipt(ledger, receipt);
    const principalAfter = principalByOwner(ledger).get(actor) ?? 0n;
    const delta = principalAfter - principalBefore;
    const existingRow = debt.find((row) => row.owner === actor);
    let otherMinorBig = existingRow
      ? parseMinorBigInt(existingRow.otherMinor)
      : assessedPrincipalBigInt(world.countryStats?.[actor]);
    if (command.debtTreatment === "alreadyIncluded") {
      if (delta > otherMinorBig) {
        fail("confirmed included principal exceeds the untracked aggregate debt");
      }
      otherMinorBig -= delta;
    }
    const serializedOther = serializeMinor(otherMinorBig);
    if (existingRow) existingRow.otherMinor = serializedOther;
    else debt.push({ owner: actor, otherMinor: serializedOther });
  } else if (["allocate", "release", "return"].includes(command.type)) {
    const facility = projectFinanceSnapshot(ledger, currentDate).find(
      (entry) => entry.terms.facilityId === command.facilityId && entry.terms.borrower === actor,
    );
    if (!facility) fail("facility not owned by the current government");
    const bucket = facility.buckets.find((entry) => entry.id === command.bucketId);
    if (!bucket) fail("unknown funding bucket");
    const id = command.type === "return" ? buildReceiptId("return", requireUnbookedSource().id) : command.id;
    if (typeof id !== "string" || !id.startsWith("finance:")) {
      fail("invalid native confirmation identity");
    }
    const receipt = {
      id,
      type: command.type,
      facilityId: facility.terms.facilityId,
      date: currentDate,
      mandateId: id,
      bucketId: bucket.id,
      amountMinor: command.amountMinor,
    };
    if (command.type === "allocate") {
      requireOwnedPaidProject(world, command.projectId, actor);
      receipt.projectId = command.projectId;
    }
    if (command.type === "return") {
      receipt.sourceEventId = command.sourceId;
    }
    ledger = appendAuthorizedReceipt(ledger, receipt);
  } else {
    fail("unsupported financing command");
  }

  return refreshFinanceDebtRatios({ ...world, projectFinance: ledger, projectFinanceDebt: debt });
};

// A model may suggest terms but these records remain a player's explicit
// reconciliation. Show public debt as an aggregate including tracked principal.
export const projectFinancePrompt = (ledger) => {
  if (!lastReceiptDate(ledger)) return "";
  const totals = principalByOwner(ledger);
  if (!totals.size) return "";
  return (
    "Native Project Finance tracks exact loan principal separately. Public debt estimates are aggregate, INCLUDING outstanding native principal: "
    + [...totals].map(([owner, minor]) => `${owner} ${Number(minor) / 100} constant 2026 USD`).join("; ")
    + ". Do not narrate or apply a second draw, repayment, loan-funded cost or debt change for a settlement already owned by this native clock. This period's automatic repayments are applied by the engine after event estimates; do not anticipate them in publicDebt updates."
  );
};
