/*! Open Historia — native political behavioral disposition engine (Continuum) */

import {
  normalizePoliticalActorRecord,
  normalizePoliticalActors,
  normalizePoliticalBehavioralDisposition,
} from "./politicalActors.js";
import { normalizePoliticalPressureState } from "./politicalPressure.js";
import { applyPoliticalActorOperations, POLITICAL_ACTOR_OPS } from "./politicalActorOps.js";
import { canonicalPoliticalTraitKey } from "./politicalTraitRegistry.js";

export const POLITICAL_DISPOSITION_RESULT_VERSION = 1;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round1 = (value) => Math.round(Number(value) * 10) / 10;
const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const metricKey = (value) => clean(value).toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");

const traitMetricFromRecord = (record, canonicalKey) => {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  for (const [key, raw] of Object.entries(record)) {
    if (canonicalPoliticalTraitKey(key) !== canonicalKey) continue;
    const number = finite(raw);
    if (number == null) continue;
    return clamp(number, 0, 100);
  }
  return null;
};

const add = (bucket, target, weight = 1) => {
  const score = finite(target);
  const w = finite(weight);
  if (score == null || w == null || w <= 0) return;
  bucket.total += clamp(score, 0, 100) * w;
  bucket.weight += w;
};

const resolve = (bucket) => bucket.weight > 0 ? round1(clamp(bucket.total / bucket.weight, 0, 100)) : null;
const makeBuckets = () => ({
  assertiveness: { total: 0, weight: 0 },
  riskTolerance: { total: 0, weight: 0 },
  escalationPressure: { total: 0, weight: 0 },
  compromisePressure: { total: 0, weight: 0 },
  regimeVulnerability: { total: 0, weight: 0 },
  deterrenceSensitivity: { total: 0, weight: 0 },
  opportunityPerception: { total: 0, weight: 0 },
  threatPerception: { total: 0, weight: 0 },
});

const pressureMagnitude = (state, key) => {
  const issue = state?.issues?.[key];
  if (!issue) return null;
  return round1(clamp(Math.max(Number(issue.salience) || 0, Number(issue.strain) || 0), 0, 100));
};

const directionalPressure = (state, key) => {
  const issue = state?.issues?.[key];
  if (!issue) return null;
  const salience = clamp(Number(issue.salience) || 0, 0, 100);
  const lean = clamp(Number(issue.lean) || 0, -100, 100);
  return round1(clamp(50 + ((salience * lean) / 200), 0, 100));
};

const averagePressureStrain = (state) => {
  const issues = Object.values(state?.issues || {});
  if (!issues.length) return null;
  const weighted = issues
    .map((issue) => ({
      strain: clamp(Number(issue?.strain) || 0, 0, 100),
      weight: Math.max(10, clamp(Number(issue?.salience) || 0, 0, 100)),
    }));
  const weight = weighted.reduce((sum, row) => sum + row.weight, 0);
  if (!weight) return null;
  return round1(weighted.reduce((sum, row) => sum + (row.strain * row.weight), 0) / weight);
};

const collectPerceptionMetrics = (value, output = [], depth = 0) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3) return output;
  for (const [key, raw] of Object.entries(value).slice(0, 32)) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      collectPerceptionMetrics(raw, output, depth + 1);
      continue;
    }
    const number = finite(raw);
    if (number == null) continue;
    output.push({ key: metricKey(key), value: number });
  }
  return output;
};

const averageNamedPerception = (perceptions, aliases, { invert = false } = {}) => {
  const aliasSet = new Set(aliases.map(metricKey));
  const values = collectPerceptionMetrics(perceptions)
    .filter((entry) => aliasSet.has(entry.key))
    .map((entry) => clamp(entry.value, 0, 100));
  if (!values.length) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return round1(invert ? 100 - average : average);
};

const governingSupport = (actor) => {
  const government = actor?.government && typeof actor.government === "object" ? actor.government : {};
  const ids = new Set([
    ...(Array.isArray(government.rulingPartyIds) ? government.rulingPartyIds : []),
    ...(Array.isArray(government.coalitionPartyIds) ? government.coalitionPartyIds : []),
  ]);
  if (!ids.size) return null;
  const values = (Array.isArray(actor?.parties) ? actor.parties : [])
    .filter((party) => ids.has(party?.id))
    .map((party) => finite(party?.support?.percent))
    .filter((value) => value != null);
  if (!values.length) return null;
  return round1(clamp(values.reduce((sum, value) => sum + value, 0), 0, 100));
};

// This engine intentionally does NOT parse ideology/goals/fears/ambitions prose.
// Those semantic facts stay separate for the later World Director projection.
// C4 only composes already-structured canonical inputs into a bounded current
// disposition vector that future AI context can consume qualitatively.
export const derivePoliticalDispositionForActor = (inputActor, { polityKey = "", updatedAt = "" } = {}) => {
  const actor = normalizePoliticalActorRecord(inputActor, polityKey);
  if (!actor) return null;

  const buckets = makeBuckets();
  const traits = actor.traits && typeof actor.traits === "object" ? actor.traits : {};
  const pressures = normalizePoliticalPressureState(actor.politicalPressures);
  const government = actor.government && typeof actor.government === "object" ? actor.government : {};

  const riskTolerance = traitMetricFromRecord(traits, "riskTolerance");
  const recklessness = traitMetricFromRecord(traits, "recklessness");
  const caution = traitMetricFromRecord(traits, "caution");
  const opportunism = traitMetricFromRecord(traits, "opportunism");
  const militarism = traitMetricFromRecord(traits, "militarism");
  const conciliatory = traitMetricFromRecord(traits, "conciliatory");
  const pragmatism = traitMetricFromRecord(traits, "pragmatism");
  const paranoia = traitMetricFromRecord(traits, "paranoia");
  const vindictiveness = traitMetricFromRecord(traits, "vindictiveness");
  const consensus = traitMetricFromRecord(traits, "consensusDriven");

  add(buckets.riskTolerance, riskTolerance, 1.0);
  add(buckets.riskTolerance, recklessness, 0.55);
  if (caution != null) add(buckets.riskTolerance, 100 - caution, 0.65);

  add(buckets.assertiveness, riskTolerance, 0.25);
  add(buckets.assertiveness, opportunism, 0.5);
  add(buckets.assertiveness, militarism, 0.55);
  add(buckets.assertiveness, recklessness, 0.25);
  if (conciliatory != null) add(buckets.assertiveness, 100 - conciliatory, 0.3);
  if (consensus != null) add(buckets.assertiveness, 100 - consensus, 0.2);

  add(buckets.escalationPressure, militarism, 0.45);
  add(buckets.escalationPressure, vindictiveness, 0.35);
  add(buckets.escalationPressure, paranoia, 0.25);
  add(buckets.escalationPressure, recklessness, 0.2);
  if (conciliatory != null) add(buckets.escalationPressure, 100 - conciliatory, 0.4);

  add(buckets.compromisePressure, conciliatory, 0.6);
  add(buckets.compromisePressure, pragmatism, 0.35);
  add(buckets.compromisePressure, caution, 0.4);
  add(buckets.compromisePressure, consensus, 0.35);
  if (riskTolerance != null) add(buckets.compromisePressure, 100 - riskTolerance, 0.2);

  add(buckets.deterrenceSensitivity, caution, 0.55);
  add(buckets.deterrenceSensitivity, pragmatism, 0.25);
  if (riskTolerance != null) add(buckets.deterrenceSensitivity, 100 - riskTolerance, 0.45);
  if (recklessness != null) add(buckets.deterrenceSensitivity, 100 - recklessness, 0.35);

  add(buckets.opportunityPerception, opportunism, 0.65);
  add(buckets.opportunityPerception, riskTolerance, 0.15);
  add(buckets.threatPerception, paranoia, 0.35);

  const securityDirection = directionalPressure(pressures, "security");
  const securityMagnitude = pressureMagnitude(pressures, "security");
  const warWeariness = pressureMagnitude(pressures, "war_weariness");
  const economicStress = pressureMagnitude(pressures, "economic_stress");
  const costOfLiving = pressureMagnitude(pressures, "cost_of_living");
  const unemployment = pressureMagnitude(pressures, "unemployment");
  const institutionalTrust = pressureMagnitude(pressures, "institutional_trust");
  const genericStrain = averagePressureStrain(pressures);

  add(buckets.assertiveness, securityDirection, 0.35);
  add(buckets.escalationPressure, securityDirection, 0.55);
  add(buckets.threatPerception, securityMagnitude, 0.55);
  add(buckets.deterrenceSensitivity, securityMagnitude, 0.2);
  if (warWeariness != null) {
    add(buckets.escalationPressure, 100 - warWeariness, 0.6);
    add(buckets.compromisePressure, warWeariness, 0.7);
    add(buckets.deterrenceSensitivity, warWeariness, 0.5);
  }

  const approval = finite(government.approval);
  const stability = finite(government.stability);
  if (approval != null) add(buckets.regimeVulnerability, 100 - clamp(approval, 0, 100), 0.65);
  if (stability != null) add(buckets.regimeVulnerability, 100 - clamp(stability, 0, 100), 0.9);
  if (genericStrain != null) add(buckets.regimeVulnerability, genericStrain, 0.45);
  add(buckets.regimeVulnerability, institutionalTrust, 0.65);
  add(buckets.regimeVulnerability, economicStress, 0.3);
  add(buckets.regimeVulnerability, costOfLiving, 0.3);
  add(buckets.regimeVulnerability, unemployment, 0.25);

  const govSupport = governingSupport(actor);
  if (govSupport != null) {
    // Electoral support is only a weak structural clue, not a government
    // confidence vote. Healthy pluralist governments can govern well below 50%.
    const supportVulnerability = clamp(120 - (govSupport * 2), 0, 100);
    add(buckets.regimeVulnerability, supportVulnerability, 0.25);
  }

  const explicitThreat = averageNamedPerception(actor.perceptions, ["threat", "threatEstimate", "hostility", "hostilityEstimate"]);
  const explicitOpportunity = averageNamedPerception(actor.perceptions, ["opportunity", "opportunityEstimate", "weakness", "vulnerability"]);
  const lowCohesionOpportunity = averageNamedPerception(actor.perceptions, ["cohesionEstimate", "cohesion"], { invert: true });
  add(buckets.threatPerception, explicitThreat, 0.75);
  add(buckets.opportunityPerception, explicitOpportunity, 0.75);
  add(buckets.opportunityPerception, lowCohesionOpportunity, 0.35);

  const out = {};
  for (const [key, bucket] of Object.entries(buckets)) {
    const value = resolve(bucket);
    if (value != null) out[key] = value;
  }
  if (!Object.keys(out).length) return null;
  const date = clean(updatedAt || pressures.updatedAt).slice(0, 32);
  if (date) out.updatedAt = date;
  return normalizePoliticalBehavioralDisposition(out);
};

const comparableDisposition = (value) => JSON.stringify(normalizePoliticalBehavioralDisposition(value));

export const advancePoliticalDispositionBatch = ({ actorsByPolity = {}, updatedAt = "" } = {}) => {
  const operations = [];
  const dispositionsByPolity = {};
  const source = actorsByPolity && typeof actorsByPolity === "object" && !Array.isArray(actorsByPolity)
    ? actorsByPolity
    : {};

  for (const polityKey of Object.keys(source).sort((left, right) => left.localeCompare(right))) {
    const actor = source[polityKey];
    if (!actor || typeof actor !== "object" || Array.isArray(actor)) continue;
    const next = derivePoliticalDispositionForActor(actor, { polityKey, updatedAt });
    const before = normalizePoliticalBehavioralDisposition(actor.behavioralDisposition);
    if (comparableDisposition(before) === comparableDisposition(next)) continue;
    operations.push({
      op: POLITICAL_ACTOR_OPS.SET_BEHAVIORAL_DISPOSITION,
      polityKey,
      state: next,
    });
    if (next) dispositionsByPolity[polityKey] = next;
  }

  return {
    schemaVersion: POLITICAL_DISPOSITION_RESULT_VERSION,
    updatedAt: clean(updatedAt),
    operations,
    dispositionsByPolity,
    changedPolities: operations.length,
  };
};

// Round-Zero / Political World Apply boundary. Political Actors become live canon
// here with native C4 already materialized, rather than waiting for a later
// pressure update or semantic mutation to happen to touch the actor. The helper
// is intentionally pure with respect to the caller: it clones the owning Political
// Actor ledger, derives only from canonical structured Political Actor inputs, and
// commits through the
// existing Political Actor operation seam. No provider/model dependency belongs
// in this path.
export const initializePoliticalDispositionsForWorld = (world = {}, { updatedAt = "" } = {}) => {
  const sourceWorld = world && typeof world === "object" && !Array.isArray(world) ? world : {};
  const nextWorld = {
    ...sourceWorld,
    politicalActors: normalizePoliticalActors(sourceWorld.politicalActors),
  };

  const batch = advancePoliticalDispositionBatch({
    actorsByPolity: nextWorld.politicalActors.byPolity,
    updatedAt: clean(updatedAt),
  });
  const application = applyPoliticalActorOperations(nextWorld, batch.operations);
  if (application.failed) {
    const firstError = application.results.find((entry) => entry?.error)?.error || "unknown Political Actor operation failure";
    throw new Error(`Initial political disposition materialization failed: ${firstError}`);
  }

  return {
    world: nextWorld,
    ...batch,
    applied: application.applied,
  };
};
