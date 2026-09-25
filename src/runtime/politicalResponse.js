/*! Open Historia — causal background political response engine (Continuum) */

import {
  normalizePoliticalActorRecord,
  POLITICAL_REPRESENTATIONS,
} from "./politicalActors.js";
import { normalizePoliticalPressureState } from "./politicalPressure.js";
import { POLITICAL_ACTOR_OPS } from "./politicalActorOps.js";

export const POLITICAL_RESPONSE_RESULT_VERSION = 1;

// One response invocation is one background political tick. Phase005C3 owns the
// clock/cadence; this layer deliberately does not decide when a month has passed.
const MAX_ENTITY_MOVE_PER_TICK = 2.5;
const SCORE_LIMIT = 1.5;
const EPSILON = 0.05;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const round1 = (value) => Math.round(Number(value) * 10) / 10;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const asArray = (value) => Array.isArray(value) ? value : [];
const numericPercent = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, 0, 100) : null;
};

const stableHash = (value) => {
  let hash = 2166136261;
  for (const char of String(value ?? "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

// Tiny deterministic variation prevents every equally-configured actor from
// moving in perfect lockstep without introducing reload-sensitive randomness.
// It scales a causal response only; it can never create movement from zero.
const deterministicVariation = (seed) => 0.97 + ((stableHash(seed) % 601) / 10000);

const profileMetric = (profile, key, fallback) => {
  const number = Number(profile?.[key]);
  return Number.isFinite(number) ? clamp(number, 0, 100) : fallback;
};

const governingExposureForParty = (party) => {
  if (party?.ruling === true) return 1;
  if (party?.coalition === true) return 0.65;
  return 0;
};

const issueContribution = ({ pressure, responseIssue, entityKind, governingExposure }) => {
  const sensitivity = numericPercent(responseIssue?.sensitivity) ?? 50;
  const sensitivityFactor = sensitivity / 100;
  if (sensitivityFactor <= 0) return 0;

  const salience = numericPercent(pressure?.salience) ?? 0;
  const strain = numericPercent(pressure?.strain) ?? 0;
  const lean = clamp(Number(pressure?.lean) || 0, -100, 100);
  const momentum = clamp(Number(pressure?.momentum) || 0, -100, 100);
  const position = clamp(Number(responseIssue?.position) || 0, -100, 100);
  const strainResponse = clamp(Number(responseIssue?.strainResponse) || 0, -100, 100);

  // Rising/falling issue salience modifies the strength of an already-causal
  // response, but never changes its direction by itself.
  const trendFactor = clamp(1 + (momentum / 400), 0.75, 1.25);
  const importance = (salience / 100) * sensitivityFactor * trendFactor;
  const directionalFit = (lean / 100) * (position / 100);
  const directional = importance * directionalFit;
  const strainMagnitude = (strain / 100) * sensitivityFactor;
  const authoredStrain = strainMagnitude * (strainResponse / 100) * 0.65;

  if (entityKind !== "party") return directional + authoredStrain;

  // Generic electoral context: sustained strain hurts governing parties and
  // creates a smaller opening for opposition actors that are actually engaged
  // with the issue. This is intentionally weaker than authored issue fit.
  if (governingExposure > 0) {
    return directional + authoredStrain - (strainMagnitude * 0.55 * governingExposure);
  }

  const oppositionOpportunity = strainMagnitude
    * 0.12
    * (0.5 + (0.5 * Math.max(0, directionalFit)));
  return directional + authoredStrain + oppositionOpportunity;
};

const responseDeltaForEntity = ({ polityKey, entityKind, entity, pressures, updatedAt }) => {
  const profile = entity?.politicalResponse;
  const responseIssues = profile?.issues && typeof profile.issues === "object" && !Array.isArray(profile.issues)
    ? profile.issues
    : {};
  if (!Object.keys(responseIssues).length) return 0;

  let score = 0;
  let matchedIssues = 0;
  const governingExposure = entityKind === "party" ? governingExposureForParty(entity) : 0;

  for (const [issueKey, responseIssue] of Object.entries(responseIssues)) {
    const pressure = pressures?.issues?.[issueKey];
    if (!pressure) continue;
    matchedIssues += 1;
    score += issueContribution({
      pressure,
      responseIssue,
      entityKind,
      governingExposure,
    });
  }

  if (!matchedIssues || Math.abs(score) <= Number.EPSILON) return 0;

  score = clamp(score, -SCORE_LIMIT, SCORE_LIMIT);

  const organization = profileMetric(profile, "organization", 50);
  const credibility = profileMetric(profile, "credibility", 50);
  const inertia = profileMetric(profile, "inertia", 70);
  const resilience = profileMetric(profile, "resilience", 50);

  // Neutral authored values produce ~1x capacity. Inertia damps both directions;
  // resilience only dampens losses, so it cannot create gains on its own.
  const capacityFactor = (0.75 + (organization / 200)) * (0.75 + (credibility / 200));
  const inertiaFactor = 0.45 + (((100 - inertia) / 100) * 0.55);
  const resilienceFactor = score < 0 ? 0.75 + (((100 - resilience) / 100) * 0.25) : 1;
  const variation = deterministicVariation(`${polityKey}|${entityKind}|${entity.id}|${updatedAt}`);

  const delta = score
    * 2.2
    * capacityFactor
    * inertiaFactor
    * resilienceFactor
    * variation;

  return round1(clamp(delta, -MAX_ENTITY_MOVE_PER_TICK, MAX_ENTITY_MOVE_PER_TICK));
};

const rebalanceCompetitivePercentages = (entries) => {
  if (!entries.length) return [];
  const initialTotal = entries.reduce((sum, entry) => sum + entry.before, 0);
  const ceiling = Math.max(100, initialTotal);
  let next = entries.map((entry) => ({
    ...entry,
    after: round1(clamp(entry.before + entry.directDelta, 0, 100)),
  }));

  const nextTotal = next.reduce((sum, entry) => sum + entry.after, 0);
  if (nextTotal > ceiling + EPSILON && nextTotal > 0) {
    const scale = ceiling / nextTotal;
    next = next.map((entry) => ({
      ...entry,
      after: round1(clamp(entry.after * scale, 0, 100)),
    }));
  }

  return next;
};

const partyResponseForActor = ({ actor, polityKey, pressures, updatedAt }) => {
  const entries = [];
  for (const party of asArray(actor.parties)) {
    const before = numericPercent(party?.support?.percent);
    // Government membership does not imply a percentage. Parties without a
    // canonical numeric support snapshot remain unquantified rather than
    // receiving a fabricated value during a background tick.
    if (before == null) continue;
    entries.push({
      id: clean(party.id),
      before,
      directDelta: responseDeltaForEntity({
        polityKey,
        entityKind: "party",
        entity: party,
        pressures,
        updatedAt,
      }),
    });
  }

  if (!entries.some((entry) => Math.abs(entry.directDelta) >= EPSILON)) return [];
  return rebalanceCompetitivePercentages(entries)
    .filter((entry) => Math.abs(entry.after - entry.before) >= EPSILON)
    .map((entry) => ({
      kind: "party",
      id: entry.id,
      from: round1(entry.before),
      to: round1(entry.after),
      delta: round1(entry.after - entry.before),
      directDelta: entry.directDelta,
    }));
};

const partyInfluenceResponseForActor = ({ actor, polityKey, pressures, updatedAt }) => {
  const entries = [];
  for (const party of asArray(actor.parties)) {
    const before = numericPercent(party?.influence?.percent);
    if (before == null) continue;
    entries.push({
      id: clean(party.id),
      before,
      directDelta: responseDeltaForEntity({
        polityKey,
        entityKind: "party",
        entity: party,
        pressures,
        updatedAt,
      }),
    });
  }

  if (!entries.some((entry) => Math.abs(entry.directDelta) >= EPSILON)) return [];
  return rebalanceCompetitivePercentages(entries)
    .filter((entry) => Math.abs(entry.after - entry.before) >= EPSILON)
    .map((entry) => ({
      kind: "party-influence",
      id: entry.id,
      from: round1(entry.before),
      to: round1(entry.after),
      delta: round1(entry.after - entry.before),
      directDelta: entry.directDelta,
    }));
};

const powerBlocResponseForActor = ({ actor, polityKey, pressures, updatedAt }) => {
  const entries = [];
  for (const bloc of asArray(actor.powerBlocs)) {
    const before = numericPercent(bloc?.influence?.percent);
    // Qualitative-only influence is valid canonical state. Do not manufacture a
    // numeric percentage merely so background simulation can move it.
    if (before == null) continue;
    entries.push({
      id: clean(bloc.id),
      before,
      directDelta: responseDeltaForEntity({
        polityKey,
        entityKind: "power-bloc",
        entity: bloc,
        pressures,
        updatedAt,
      }),
    });
  }

  if (!entries.some((entry) => Math.abs(entry.directDelta) >= EPSILON)) return [];
  return rebalanceCompetitivePercentages(entries)
    .filter((entry) => Math.abs(entry.after - entry.before) >= EPSILON)
    .map((entry) => ({
      kind: "power-bloc",
      id: entry.id,
      from: round1(entry.before),
      to: round1(entry.after),
      delta: round1(entry.after - entry.before),
      directDelta: entry.directDelta,
    }));
};

export const advancePoliticalResponseForActor = (
  inputActor,
  { polityKey = "", updatedAt = "" } = {},
) => {
  const actor = normalizePoliticalActorRecord(inputActor, polityKey);
  if (!actor) return { polityKey: clean(polityKey), changes: [], operations: [] };

  const key = clean(actor.polityKey || polityKey);
  const pressures = normalizePoliticalPressureState(actor.politicalPressures);
  if (!Object.keys(pressures.issues).length) return { polityKey: key, changes: [], operations: [] };

  const tickId = clean(updatedAt || pressures.updatedAt);
  const representation = clean(actor?.politicalSystem?.representation);
  let changes = [];
  if (representation === POLITICAL_REPRESENTATIONS.ELECTORAL) {
    changes = partyResponseForActor({ actor, polityKey: key, pressures, updatedAt: tickId });
  } else if (representation === POLITICAL_REPRESENTATIONS.PARTY_STATE) {
    changes = asArray(actor.powerBlocs).length
      ? powerBlocResponseForActor({ actor, polityKey: key, pressures, updatedAt: tickId })
      : partyInfluenceResponseForActor({ actor, polityKey: key, pressures, updatedAt: tickId });
  } else if (representation && representation !== POLITICAL_REPRESENTATIONS.NONE) {
    changes = powerBlocResponseForActor({ actor, polityKey: key, pressures, updatedAt: tickId });
  }

  const operations = changes.map((change) => {
    if (change.kind === "party") {
      return {
        op: POLITICAL_ACTOR_OPS.SET_PARTY_SUPPORT,
        polityKey: key,
        partyId: change.id,
        percent: change.to,
      };
    }
    if (change.kind === "party-influence") {
      return {
        op: POLITICAL_ACTOR_OPS.SET_PARTY_INFLUENCE,
        polityKey: key,
        partyId: change.id,
        percent: change.to,
      };
    }
    return {
      op: POLITICAL_ACTOR_OPS.SET_POWER_BLOC_INFLUENCE,
      polityKey: key,
      blocId: change.id,
      percent: change.to,
    };
  });

  return { polityKey: key, changes, operations };
};

// Pure batch calculation only. It does not mutate world state, create actors,
// write saves, schedule ticks, or emit timeline events. The future political
// clock owns invocation; callers commit `operations` through politicalActorOps.
export const advancePoliticalResponseBatch = ({ actorsByPolity = {}, updatedAt = "" } = {}) => {
  const source = actorsByPolity && typeof actorsByPolity === "object" && !Array.isArray(actorsByPolity)
    ? actorsByPolity
    : {};
  const operations = [];
  const changesByPolity = {};

  for (const polityKey of Object.keys(source).sort((left, right) => left.localeCompare(right))) {
    const result = advancePoliticalResponseForActor(source[polityKey], { polityKey, updatedAt });
    if (!result.changes.length) continue;
    changesByPolity[polityKey] = result.changes;
    operations.push(...result.operations);
  }

  return {
    schemaVersion: POLITICAL_RESPONSE_RESULT_VERSION,
    updatedAt: clean(updatedAt),
    operations,
    changesByPolity,
    changedPolities: Object.keys(changesByPolity).length,
    changedEntities: operations.length,
  };
};
