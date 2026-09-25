/*! Open Historia — background political pressure ledger (Continuum) */

export const POLITICAL_PRESSURE_STATE_VERSION = 1;

// Known axes are documentation and editor affordances, not an exhaustive allow-list.
// Scenarios may define additional sparse issue keys. Positive/negative describe the
// direction encoded by `lean`; salience/strain are independent magnitudes.
export const POLITICAL_PRESSURE_AXES = Object.freeze({
  immigration: Object.freeze({ negative: "more open", positive: "more restrictive" }),
  sovereignty: Object.freeze({ negative: "deeper integration", positive: "greater national sovereignty" }),
  security: Object.freeze({ negative: "restraint/de-escalation", positive: "hardline/security-first" }),
  national_identity: Object.freeze({ negative: "cosmopolitan/pluralist", positive: "nationalist/identity-first" }),
  social_order: Object.freeze({ negative: "social liberalisation", positive: "traditional/order-first" }),
  economic_intervention: Object.freeze({ negative: "market-oriented", positive: "state intervention/redistribution" }),
  inequality: Object.freeze({ negative: "accept existing distribution", positive: "redistribution/economic equality" }),
  corruption: Object.freeze({ negative: "status quo tolerance", positive: "anti-corruption/reform demand" }),
  institutional_trust: Object.freeze({ negative: "institutional confidence", positive: "institutional distrust" }),
  regionalism: Object.freeze({ negative: "centralisation", positive: "regional autonomy/devolution" }),
  religion: Object.freeze({ negative: "secularisation", positive: "greater religious/traditional role" }),
  environment: Object.freeze({ negative: "growth/resource priority", positive: "environmental protection" }),
  authoritarianism: Object.freeze({ negative: "liberal checks/pluralism", positive: "strong executive/order" }),
  reform: Object.freeze({ negative: "institutional continuity", positive: "institutional reform/change" }),
  war_weariness: Object.freeze({ negative: "continued mobilisation/escalation", positive: "peace/de-escalation demand" }),
  economic_stress: Object.freeze({ negative: "economic confidence", positive: "economic anxiety/distress" }),
  cost_of_living: Object.freeze({ negative: "price stability", positive: "cost-of-living pressure" }),
  unemployment: Object.freeze({ negative: "labour-market confidence", positive: "employment insecurity" }),
});

const ISSUE_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_ISSUES = 24;
const MAX_RECENT_SOURCES = 4;
const DEFAULT_PERSISTENCE = 0.72;
const DROP_EPSILON = 0.15;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const round1 = (value) => Math.round(Number(value) * 10) / 10;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clampPercent = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? round1(clamp(number, 0, 100)) : fallback;
};
const clampLean = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? round1(clamp(number, -100, 100)) : fallback;
};
const clampPersistence = (value, fallback = DEFAULT_PERSISTENCE) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(clamp(number, 0, 1) * 1000) / 1000 : fallback;
};

const normalizeIssueKey = (value) => {
  const key = clean(value).toLocaleLowerCase().replace(/[\s.]+/g, "_");
  return ISSUE_KEY_PATTERN.test(key) ? key : "";
};

const normalizeSource = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = clean(value.kind || value.sourceKind || value.type).slice(0, 40);
  const id = clean(value.id || value.sourceId).slice(0, 120);
  const date = clean(value.date).slice(0, 32);
  const note = clean(value.note).slice(0, 180);
  if (!kind && !id && !date && !note) return null;
  return {
    ...(kind ? { kind } : {}),
    ...(id ? { id } : {}),
    ...(date ? { date } : {}),
    ...(note ? { note } : {}),
  };
};

const normalizeRecentSources = (value) => {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const source = normalizeSource(raw);
    if (!source) continue;
    const key = `${source.kind || ""}|${source.id || ""}|${source.date || ""}|${source.note || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
    if (out.length >= MAX_RECENT_SOURCES) break;
  }
  return out;
};

export const normalizePoliticalPressureIssue = (value) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const out = {
    salience: clampPercent(source.salience),
    lean: clampLean(source.lean ?? source.direction),
    strain: clampPercent(source.strain),
    persistence: clampPersistence(source.persistence),
    momentum: clampLean(source.momentum),
  };
  const recentSources = normalizeRecentSources(source.recentSources || source.sources);
  if (recentSources.length) out.recentSources = recentSources;
  return out;
};

export const normalizePoliticalPressureState = (value) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sourceIssues = source.issues && typeof source.issues === "object" && !Array.isArray(source.issues)
    ? source.issues
    : {};
  const issues = {};
  for (const [rawKey, rawIssue] of Object.entries(sourceIssues).slice(0, MAX_ISSUES)) {
    const key = normalizeIssueKey(rawKey);
    if (!key) continue;
    const issue = normalizePoliticalPressureIssue(rawIssue);
    if (issue.salience <= DROP_EPSILON && issue.strain <= DROP_EPSILON && Math.abs(issue.lean) <= DROP_EPSILON) continue;
    issues[key] = issue;
  }
  const updatedAt = clean(source.updatedAt).slice(0, 32);
  return {
    schemaVersion: POLITICAL_PRESSURE_STATE_VERSION,
    ...(updatedAt ? { updatedAt } : {}),
    issues,
  };
};

export const normalizePoliticalPressureSignal = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const issue = normalizeIssueKey(value.issue || value.key);
  if (!issue) return null;

  const salience = clampPercent(value.salience ?? value.salienceDelta ?? value.intensity, 0);
  const strain = clampPercent(value.strain ?? value.strainDelta, 0);
  const lean = clampLean(value.lean ?? (Number.isFinite(Number(value.direction)) ? Number(value.direction) * 100 : 0));
  const persistence = clampPersistence(value.persistence);
  const source = normalizeSource(value.source || {
    kind: value.sourceKind,
    id: value.sourceId,
    date: value.date,
    note: value.note,
  });

  if (salience <= 0 && strain <= 0) return null;
  return {
    issue,
    salience,
    strain,
    lean,
    persistence,
    ...(source ? { source } : {}),
  };
};

const decayFactorForMonths = (persistence, months) => {
  if (months <= 0) return 1;
  // Persistence is the fraction retained after one month. 0.72 therefore means
  // a transient issue loses 28% per month unless refreshed by the world.
  return Math.pow(clampPersistence(persistence), months);
};

const decayIssue = (issue, months) => {
  const current = normalizePoliticalPressureIssue(issue);
  if (months <= 0) return current;
  const factor = decayFactorForMonths(current.persistence, months);
  const salience = round1(current.salience * factor);
  const strain = round1(current.strain * factor);
  const lean = salience > DROP_EPSILON ? round1(current.lean * factor) : 0;
  return {
    ...current,
    salience,
    strain,
    lean,
    momentum: round1(salience - current.salience),
  };
};

const mergeRecentSource = (existing, source) => {
  if (!source) return normalizeRecentSources(existing);
  return normalizeRecentSources([source, ...(Array.isArray(existing) ? existing : [])]);
};

const applySignalToIssue = (issue, signal) => {
  const current = normalizePoliticalPressureIssue(issue);
  const addedSalience = clampPercent(signal.salience);
  const nextSalience = clampPercent(current.salience + addedSalience);
  const nextStrain = clampPercent(current.strain + clampPercent(signal.strain));

  // Direction is weighted by the amount of issue salience contributing it. A
  // non-directional shock (lean 0) can make an issue important without forcing a
  // policy direction; later response logic can use strain/incumbency separately.
  const currentWeight = Math.max(0, current.salience);
  const signalWeight = Math.max(0, addedSalience);
  const weightedLean = currentWeight + signalWeight > 0
    ? ((current.lean * currentWeight) + (clampLean(signal.lean) * signalWeight)) / (currentWeight + signalWeight)
    : 0;

  return {
    salience: nextSalience,
    lean: clampLean(weightedLean),
    strain: nextStrain,
    persistence: Math.max(current.persistence, clampPersistence(signal.persistence)),
    momentum: round1(nextSalience - current.salience),
    ...(mergeRecentSource(current.recentSources, signal.source).length
      ? { recentSources: mergeRecentSource(current.recentSources, signal.source) }
      : {}),
  };
};

export const advancePoliticalPressureState = (
  inputState,
  { months = 0, signals = [], updatedAt = "" } = {},
) => {
  const current = normalizePoliticalPressureState(inputState);
  const nextIssues = {};

  for (const [key, issue] of Object.entries(current.issues)) {
    const decayed = decayIssue(issue, Math.max(0, Number(months) || 0));
    if (decayed.salience > DROP_EPSILON || decayed.strain > DROP_EPSILON || Math.abs(decayed.lean) > DROP_EPSILON) {
      nextIssues[key] = decayed;
    }
  }

  for (const rawSignal of Array.isArray(signals) ? signals : []) {
    const signal = normalizePoliticalPressureSignal(rawSignal);
    if (!signal) continue;
    nextIssues[signal.issue] = applySignalToIssue(nextIssues[signal.issue], signal);
  }

  const hasIssues = Object.keys(nextIssues).length > 0;
  const next = normalizePoliticalPressureState({
    schemaVersion: POLITICAL_PRESSURE_STATE_VERSION,
    ...(hasIssues ? { updatedAt: clean(updatedAt) || current.updatedAt } : {}),
    issues: nextIssues,
  });

  return next;
};

const statesEqual = (left, right) => JSON.stringify(normalizePoliticalPressureState(left)) === JSON.stringify(normalizePoliticalPressureState(right));

// Compact batch contract intended for a Web Worker. It accepts only Political
// Actor pressure snapshots plus already-derived signals — never map geometry,
// chats, full event prose, or the complete world object.
export const advancePoliticalPressureBatch = ({ actorsByPolity = {}, signalsByPolity = {}, months = 0, updatedAt = "" } = {}) => {
  const patchesByPolity = {};
  const polityKeys = new Set([
    ...Object.keys(actorsByPolity && typeof actorsByPolity === "object" ? actorsByPolity : {}),
    ...Object.keys(signalsByPolity && typeof signalsByPolity === "object" ? signalsByPolity : {}),
  ]);

  for (const polityKey of [...polityKeys].sort((a, b) => a.localeCompare(b))) {
    const actor = actorsByPolity?.[polityKey];
    // Never mint a Political Actor merely because a pressure signal names an
    // unknown polity. Actor creation belongs to the canonical Political Actors
    // layer / generator.
    if (!actor || typeof actor !== "object" || Array.isArray(actor)) continue;

    const before = normalizePoliticalPressureState(actor.politicalPressures);
    const after = advancePoliticalPressureState(before, {
      months,
      signals: signalsByPolity?.[polityKey],
      updatedAt,
    });
    if (!statesEqual(before, after)) patchesByPolity[polityKey] = after;
  }

  return {
    schemaVersion: POLITICAL_PRESSURE_STATE_VERSION,
    updatedAt: clean(updatedAt),
    patchesByPolity,
    changedPolities: Object.keys(patchesByPolity).length,
  };
};

export const politicalPressureDebugSummary = (state) => {
  const normalized = normalizePoliticalPressureState(state);
  return Object.entries(normalized.issues)
    .sort(([, left], [, right]) => right.salience - left.salience)
    .slice(0, 8)
    .map(([issue, value]) => ({
      issue,
      salience: value.salience,
      lean: value.lean,
      strain: value.strain,
      momentum: value.momentum,
    }));
};
