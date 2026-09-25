/*! Open Historia — shared Political Decision Context (Continuum Phase009A) */

import {
  derivePoliticalDecisionAuthority,
  getPoliticalProfile,
  getPoliticalProfileKey,
} from "../../runtime/politicalActors.js";
import {
  buildPoliticalKnowledgeView,
  POLITICAL_KNOWLEDGE_LEVELS,
} from "../../runtime/politicalKnowledge.js";
import {
  normalizePoliticalPressureState,
  POLITICAL_PRESSURE_AXES,
} from "../../runtime/politicalPressure.js";
import { institutionsForPolity } from "../../runtime/institutions.js";
import { institutionLifecycleCasesForPolity } from "../../runtime/institutionLifecycleCore.js";
import { powerDecisionProfileForPolity } from "../../runtime/powerStatus.js";

export const POLITICAL_DECISION_CONTEXT_VERSION = 5;
export const POLITICAL_DECISION_CURRENT_STATE_AUTHORITY_RULE = "CURRENT-STATE AUTHORITY: this capsule is the actor's canonical current political state. Scenario/world-before-round-one temperament is starting context only; if it conflicts with this capsule, use this capsule for present decision behavior. Preserve objective canon unchanged.";
export const DEFAULT_POLITICAL_DECISION_MAX_ACTORS = 8;
export const DEFAULT_POLITICAL_DECISION_MAX_CHARS = 5600;
export const DEFAULT_POLITICAL_DECISION_SET_PER_ACTOR_MAX_CHARS = 2600;
export const DEFAULT_POLITICAL_DECISION_SET_MAX_CHARS = 18000;

const DEFAULT_LIMITS = Object.freeze({
  traits: 8,
  goals: 6,
  fears: 6,
  ambitions: 6,
  domesticPressures: 6,
  pressureIssues: 6,
  governingEntities: 4,
  oppositionEntities: 4,
  perceptions: 4,
  relations: 6,
  agreements: 6,
  wars: 4,
  institutions: 8,
  institutionLifecycleCases: 6,
});

const cloneValue = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const clippedText = (value, maxChars = 320) => clean(value).slice(0, Math.max(0, Number(maxChars) || 0));
const lower = (value) => clean(value).toLocaleLowerCase();
const array = (value) => Array.isArray(value) ? value : [];
const boundedArray = (value, limit) => array(value).slice(0, Math.max(0, Number(limit) || 0));
const boundedRecordEntries = (value, limit) =>
  Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value : {})
    .slice(0, Math.max(0, Number(limit) || 0));

const tokenKey = (value) => clean(value)
  .toLocaleLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^\p{L}\p{N}]+/gu, "");

const titleCaseMetric = (value) => clean(value)
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .replace(/[_-]+/g, " ")
  .replace(/\b\w/g, (char) => char.toLocaleUpperCase());

const officeholderName = (value) => {
  if (typeof value === "string") return clean(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return clean(value.name || value.id);
};

const projectOfficeholder = (value) => {
  if (typeof value === "string") return clippedText(value, 160);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = clippedText(value.name || value.id, 160);
  if (!name) return null;
  return {
    ...(clippedText(value.id, 120) ? { id: clippedText(value.id, 120) } : {}),
    name,
    ...(clippedText(value.title || value.role, 160) ? { title: clippedText(value.title || value.role, 160) } : {}),
  };
};

const projectPoliticalSystem = (value) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    ...(clippedText(source.type, 120) ? { type: clippedText(source.type, 120) } : {}),
    ...(clippedText(source.representation, 120) ? { representation: clippedText(source.representation, 120) } : {}),
    ...(clippedText(source.label, 180) ? { label: clippedText(source.label, 180) } : {}),
  };
};

const projectGovernment = (value) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const approval = Number(source.approval);
  const stability = Number(source.stability);
  return {
    ...(clippedText(source.form, 220) ? { form: clippedText(source.form, 220) } : {}),
    ...(clippedText(source.ideology, 320) ? { ideology: clippedText(source.ideology, 320) } : {}),
    ...(clippedText(source.status, 160) ? { status: clippedText(source.status, 160) } : {}),
    ...(projectOfficeholder(source.headOfState) ? { headOfState: projectOfficeholder(source.headOfState) } : {}),
    ...(projectOfficeholder(source.headOfGovernment) ? { headOfGovernment: projectOfficeholder(source.headOfGovernment) } : {}),
    ...(clippedText(source.coalitionName, 220) ? { coalitionName: clippedText(source.coalitionName, 220) } : {}),
    ...(Number.isFinite(approval) ? { approval: Math.max(0, Math.min(100, approval)) } : {}),
    ...(Number.isFinite(stability) ? { stability: Math.max(0, Math.min(100, stability)) } : {}),
    rulingPartyIds: array(source.rulingPartyIds).map((entry) => clippedText(entry, 120)).filter(Boolean).slice(0, 12),
    coalitionPartyIds: array(source.coalitionPartyIds).map((entry) => clippedText(entry, 120)).filter(Boolean).slice(0, 12),
    rulingParties: array(source.rulingParties).map((entry) => clippedText(entry, 180)).filter(Boolean).slice(0, 12),
    coalition: array(source.coalition).map((entry) => clippedText(entry, 180)).filter(Boolean).slice(0, 12),
  };
};

const projectDecisionAuthority = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const primary = projectOfficeholder(value.primary);
  if (!primary) return null;
  return {
    primary,
    role: clippedText(value.role, 80),
    model: clippedText(value.model, 120),
    basis: clippedText(value.basis, 120),
    confidence: clippedText(value.confidence, 40),
    participants: array(value.participants).slice(0, 4).map((entry) => ({
      officeholder: projectOfficeholder(entry?.officeholder),
      role: clippedText(entry?.role, 80),
    })).filter((entry) => entry.officeholder),
  };
};

const boundedMetricRecord = (value, limit, depth = 0) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3) return {};
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, Math.max(0, Number(limit) || 0))) {
    const key = clippedText(rawKey, 120);
    if (!key) continue;
    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      const nested = boundedMetricRecord(rawValue, 8, depth + 1);
      if (Object.keys(nested).length) out[key] = nested;
      continue;
    }
    if (Array.isArray(rawValue)) {
      const rows = rawValue.map((entry) => clippedText(entry, 160)).filter(Boolean).slice(0, 8);
      if (rows.length) out[key] = rows;
      continue;
    }
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      out[key] = Math.max(-100, Math.min(100, Math.round(rawValue * 10) / 10));
      continue;
    }
    if (typeof rawValue === "boolean") {
      out[key] = rawValue;
      continue;
    }
    const text = clippedText(rawValue, 180);
    if (text) out[key] = text;
  }
  return out;
};

const qualitativeBand = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return clean(value);
  if (number >= 85) return "very high";
  if (number >= 65) return "high";
  if (number >= 40) return "moderate";
  if (number >= 20) return "low";
  return "very low";
};

const signedDirection = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  if (number >= 60) return "strongly positive";
  if (number >= 20) return "positive";
  if (number <= -60) return "strongly negative";
  if (number <= -20) return "negative";
  return "mixed/neutral";
};

const conciseList = (value, limit) => boundedArray(value, limit).map((entry) => clippedText(entry, 320)).filter(Boolean);

const samePolity = (world, left, right) => {
  const leftText = clean(left);
  const rightText = clean(right);
  if (!leftText || !rightText) return false;
  if (tokenKey(leftText) === tokenKey(rightText)) return true;
  const leftActor = getPoliticalProfile(world, leftText);
  const rightActor = getPoliticalProfile(world, rightText);
  return Boolean(leftActor && rightActor && leftActor === rightActor);
};

const canonicalPolityLabel = (world, polityKey) => {
  const actor = getPoliticalProfile(world, polityKey);
  if (!actor) return clean(polityKey);
  const actorKey = getPoliticalProfileKey(world, polityKey);
  const override = actorKey ? world?.polityOverrides?.[actorKey] : null;
  return clean(override?.name || actor.name || actor.polityKey || actorKey || polityKey);
};

const normalizeLimits = (limits = {}) => {
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const number = Number(limits?.[key]);
    out[key] = Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
  }
  return out;
};

const selectEntityRows = (actor, limits) => {
  const government = actor?.government && typeof actor.government === "object" ? actor.government : {};
  const rulingIds = new Set([
    ...array(government.rulingPartyIds).map(clean),
    ...array(government.coalitionPartyIds).map(clean),
  ].filter(Boolean));

  const parties = array(actor?.parties);
  const powerBlocs = [...array(actor?.powerBlocs)];
  const entityRow = (entity, kind) => {
    const support = Number(entity?.support?.percent);
    const influence = Number(entity?.influence?.percent);
    return {
      kind,
      id: clean(entity?.id),
      name: clippedText(entity?.name || entity?.id, 180),
      ideology: clippedText(entity?.ideology, 240),
      ...(Number.isFinite(support) ? { supportPercent: Math.max(0, Math.min(100, support)) } : {}),
      ...(Number.isFinite(influence) ? { influencePercent: Math.max(0, Math.min(100, influence)) } : {}),
      ...(clippedText(entity?.influence?.label, 120) ? { influenceLabel: clippedText(entity.influence.label, 120) } : {}),
      ...(clippedText(entity?.internalPressure, 240) ? { internalPressure: clippedText(entity.internalPressure, 240) } : {}),
      ...(clippedText(entity?.privateGoal, 240) ? { privateGoal: clippedText(entity.privateGoal, 240) } : {}),
      ...(clippedText(entity?.internalStrategy, 240) ? { internalStrategy: clippedText(entity.internalStrategy, 240) } : {}),
      goals: conciseList(entity?.goals, 4),
      publicPriorities: conciseList(entity?.publicPriorities, 4),
      publicForeignPolicy: conciseList(entity?.publicForeignPolicy, 4),
      ...(clippedText(entity?.publicDescription, 280) ? { publicDescription: clippedText(entity.publicDescription, 280) } : {}),
    };
  };

  const governingParties = parties.filter((party) =>
    rulingIds.has(clean(party?.id)) || party?.ruling === true || party?.coalition === true,
  );
  const oppositionParties = parties.filter((party) => !governingParties.includes(party));

  const sortByVisibleWeight = (left, right) => {
    const weight = (entry) => {
      const support = Number(entry?.support?.percent);
      const influence = Number(entry?.influence?.percent);
      if (Number.isFinite(support)) return support;
      if (Number.isFinite(influence)) return influence;
      return -1;
    };
    return weight(right) - weight(left);
  };

  const governing = [
    ...governingParties.sort(sortByVisibleWeight).map((entry) => entityRow(entry, "party")),
    ...powerBlocs
      .filter((bloc) => /government|ruling|royal|court|military|presidium|leadership/i.test(
        `${clean(bloc?.status)} ${clean(bloc?.kind)} ${clean(bloc?.name)}`,
      ))
      .sort(sortByVisibleWeight)
      .map((entry) => entityRow(entry, "power_bloc")),
  ].filter((entry) => entry.name).slice(0, limits.governingEntities);

  const governingIds = new Set(governing.map((entry) => `${entry.kind}:${entry.id || tokenKey(entry.name)}`));
  const opposition = [
    ...oppositionParties.sort(sortByVisibleWeight).map((entry) => entityRow(entry, "party")),
    ...powerBlocs.sort(sortByVisibleWeight).map((entry) => entityRow(entry, "power_bloc")),
  ].filter((entry) => entry.name)
    .filter((entry) => !governingIds.has(`${entry.kind}:${entry.id || tokenKey(entry.name)}`))
    .slice(0, limits.oppositionEntities);

  return { governing, opposition };
};

const selectPressureIssues = (actor, limit) => {
  const state = normalizePoliticalPressureState(actor?.politicalPressures);
  return Object.entries(state.issues || {})
    .map(([issue, value]) => ({
      issue,
      salience: Number(value?.salience) || 0,
      strain: Number(value?.strain) || 0,
      lean: Number(value?.lean) || 0,
      momentum: Number(value?.momentum) || 0,
      persistence: Number(value?.persistence) || 0,
      recentSources: cloneValue(array(value?.recentSources).slice(0, 2)),
    }))
    .sort((left, right) =>
      (right.salience + right.strain) - (left.salience + left.strain) ||
      Math.abs(right.lean) - Math.abs(left.lean) ||
      left.issue.localeCompare(right.issue),
    )
    .slice(0, limit);
};

const pressureDirectionText = (row) => {
  const axis = POLITICAL_PRESSURE_AXES[row.issue];
  if (!axis || Math.abs(Number(row.lean) || 0) < 20) return "mixed/no strong directional lean";
  return Number(row.lean) > 0 ? axis.positive : axis.negative;
};

const perceptionEntries = (world, actor, counterpartPolity, limit) => {
  const entries = Object.entries(
    actor?.perceptions && typeof actor.perceptions === "object" && !Array.isArray(actor.perceptions)
      ? actor.perceptions
      : {},
  );
  if (!entries.length) return [];

  const counterpart = clean(counterpartPolity);
  const counterpartActor = counterpart ? getPoliticalProfile(world, counterpart) : null;
  const matchesCounterpart = ([target]) => {
    if (!counterpart) return false;
    if (tokenKey(target) === tokenKey(counterpart)) return true;
    const targetActor = getPoliticalProfile(world, target);
    return Boolean(counterpartActor && targetActor && counterpartActor === targetActor);
  };

  const ordered = counterpart
    ? [...entries.filter(matchesCounterpart), ...entries.filter((entry) => !matchesCounterpart(entry))]
    : entries;

  return ordered.slice(0, limit).map(([target, metrics]) => ({
    target: clean(target),
    metrics: boundedMetricRecord(metrics, 8),
    focusedCounterpart: counterpart ? matchesCounterpart([target, metrics]) : false,
  }));
};

const dispositionRecord = (actor) => {
  const source = actor?.behavioralDisposition && typeof actor.behavioralDisposition === "object" && !Array.isArray(actor.behavioralDisposition)
    ? actor.behavioralDisposition
    : {};
  const out = {};
  for (const key of [
    "assertiveness",
    "riskTolerance",
    "escalationPressure",
    "compromisePressure",
    "regimeVulnerability",
    "deterrenceSensitivity",
    "opportunityPerception",
    "threatPerception",
  ]) {
    const number = Number(source[key]);
    if (Number.isFinite(number)) out[key] = Math.max(0, Math.min(100, number));
  }
  if (clean(source.updatedAt)) out.updatedAt = clean(source.updatedAt);
  return out;
};

const normalizeRelationStatus = (value, score = 0) => {
  const status = clean(value);
  if (status) return status;
  const number = Number(score);
  if (!Number.isFinite(number)) return "neutral";
  if (number >= 60) return "friendly";
  if (number >= 25) return "cordial";
  if (number >= -10) return "neutral";
  if (number >= -30) return "cautious";
  if (number >= -60) return "strained";
  if (number > -90) return "hostile";
  return "rival";
};

const boundedDiplomaticProjection = (world, actorPolity, counterpartPolity, limits) => {
  const relations = array(world?.relations)
    .filter((relation) => relation && typeof relation === "object")
    .filter((relation) =>
      samePolity(world, relation?.a, actorPolity) ||
      samePolity(world, relation?.b, actorPolity),
    )
    .filter((relation) => !counterpartPolity ||
      samePolity(world, relation?.a, counterpartPolity) ||
      samePolity(world, relation?.b, counterpartPolity),
    )
    .map((relation) => {
      const numeric = Number(relation?.score);
      const score = Number.isFinite(numeric) ? Math.max(-100, Math.min(100, numeric)) : null;
      return {
        ...(clippedText(relation?.id, 160) ? { id: clippedText(relation.id, 160) } : {}),
        a: clippedText(canonicalPolityLabel(world, relation?.a), 180),
        b: clippedText(canonicalPolityLabel(world, relation?.b), 180),
        ...(score == null ? {} : { score }),
        status: normalizeRelationStatus(relation?.status, score ?? 0),
        ...(clippedText(relation?.summary, 240) ? { summary: clippedText(relation.summary, 240) } : {}),
        ...(clippedText(relation?.lastUpdatedDate, 40) ? { lastUpdatedDate: clippedText(relation.lastUpdatedDate, 40) } : {}),
      };
    })
    .slice(0, Math.max(limits.relations, counterpartPolity ? 1 : 0));

  const agreements = array(world?.agreements)
    .filter((agreement) => agreement && typeof agreement === "object")
    .filter((agreement) => ["active", "suspended", ""].includes(lower(agreement?.status)))
    .filter((agreement) => array(agreement?.parties).some((party) => samePolity(world, party, actorPolity)))
    .filter((agreement) => !counterpartPolity ||
      array(agreement?.parties).some((party) => samePolity(world, party, counterpartPolity)),
    )
    .slice(0, Math.max(limits.agreements, counterpartPolity ? 1 : 0));

  return { relations, agreements };
};

const relationForPair = (world, relations, actorPolity, counterpartPolity) =>
  array(relations).find((relation) =>
    (samePolity(world, relation?.a, actorPolity) && samePolity(world, relation?.b, counterpartPolity)) ||
    (samePolity(world, relation?.b, actorPolity) && samePolity(world, relation?.a, counterpartPolity)),
  ) || null;

const agreementRows = (world, agreements, actorPolity, counterpartPolity, limit) =>
  array(agreements)
    .filter((agreement) => {
      const parties = array(agreement?.parties);
      const actorPresent = parties.some((party) => samePolity(world, party, actorPolity));
      if (!actorPresent) return false;
      return counterpartPolity
        ? parties.some((party) => samePolity(world, party, counterpartPolity))
        : true;
    })
    .slice(0, limit)
    .map((agreement) => ({
      id: clean(agreement?.id),
      type: clean(agreement?.type),
      status: clean(agreement?.status),
      title: clean(agreement?.title),
      terms: clean(agreement?.terms).slice(0, 360),
      parties: array(agreement?.parties)
        .map((party) => clippedText(canonicalPolityLabel(world, party), 180))
        .filter(Boolean)
        .slice(0, 12),
    }));

const warRows = (world, actorPolity, counterpartPolity, limit) =>
  array(world?.wars)
    .filter((war) => ["active", "ceasefire"].includes(lower(war?.status)))
    .map((war) => {
      const sideA = array(war?.sideA);
      const sideB = array(war?.sideB);
      const actorInA = sideA.some((party) => samePolity(world, party, actorPolity));
      const actorInB = sideB.some((party) => samePolity(world, party, actorPolity));
      if (!actorInA && !actorInB) return null;

      const counterpartInA = counterpartPolity
        ? sideA.some((party) => samePolity(world, party, counterpartPolity))
        : false;
      const counterpartInB = counterpartPolity
        ? sideB.some((party) => samePolity(world, party, counterpartPolity))
        : false;
      if (counterpartPolity && !counterpartInA && !counterpartInB) return null;

      const relationship = counterpartPolity
        ? ((actorInA && counterpartInB) || (actorInB && counterpartInA) ? "belligerents" : "co-belligerents")
        : "actor-involved";

      return {
        id: clean(war?.id || war?.warId),
        status: clean(war?.status),
        title: clean(war?.title || war?.name),
        sideA: sideA.map((party) => clippedText(canonicalPolityLabel(world, party), 180)).filter(Boolean).slice(0, 12),
        sideB: sideB.map((party) => clippedText(canonicalPolityLabel(world, party), 180)).filter(Boolean).slice(0, 12),
        startedAt: clean(war?.startedAt || war?.startDate || war?.date),
        relationship,
      };
    })
    .filter(Boolean)
    .slice(0, limit);

const knowledgeSummaryLines = (knowledge) => {
  if (!knowledge || typeof knowledge !== "object") return ["No counterpart Political Knowledge view is available."];
  const publicView = knowledge.public || {};
  const government = publicView.government || {};
  const politicalSystem = publicView.politicalSystem || {};
  const lines = [];
  const system = [clean(politicalSystem.type), clean(politicalSystem.representation)].filter(Boolean).join(" / ");
  if (system) lines.push(`Public political system: ${system}`);
  if (clean(government.form)) lines.push(`Public government: ${clean(government.form)}`);
  if (clean(government.ideology)) lines.push(`Public government ideology: ${clean(government.ideology)}`);
  const headOfState = officeholderName(government.headOfState);
  const headOfGovernment = officeholderName(government.headOfGovernment);
  if (headOfState) lines.push(`Public head of state: ${headOfState}`);
  if (headOfGovernment && headOfGovernment !== headOfState) lines.push(`Public head of government: ${headOfGovernment}`);
  const parties = array(publicView.parties).slice(0, 4).map((party) => clean(party?.name)).filter(Boolean);
  const blocs = array(publicView.powerBlocs).slice(0, 4).map((bloc) => clean(bloc?.name)).filter(Boolean);
  const goals = conciseList(publicView.goals, 4);
  if (parties.length) lines.push(`Public parties: ${parties.join(", ")}`);
  if (blocs.length) lines.push(`Public power blocs: ${blocs.join(", ")}`);
  if (goals.length) lines.push(`Public stated goals: ${goals.join("; ")}`);
  if (knowledge.intelligence) {
    const intel = knowledge.intelligence;
    if (clean(intel.summary)) lines.push(`Intelligence assessment: ${clean(intel.summary)}`);
    for (const finding of array(intel.findings).slice(0, 4)) {
      if (clean(finding?.text)) lines.push(`Intelligence finding: ${clean(finding.text)}`);
    }
    if (clean(intel.confidence)) lines.push(`Intelligence confidence: ${clean(intel.confidence)}`);
    if (intel.stale === true) lines.push("Intelligence status: stale/last-known assessment");
  }
  return lines.length ? lines : ["No material public political facts are available for the counterpart."];
};

const entityLine = (entity) => {
  const bits = [entity.name];
  if (entity.ideology) bits.push(entity.ideology);
  if (Number.isFinite(entity.supportPercent)) bits.push(`${entity.supportPercent}% support`);
  if (Number.isFinite(entity.influencePercent)) bits.push(`${entity.influencePercent}% influence`);
  else if (entity.influenceLabel) bits.push(`${entity.influenceLabel} influence`);
  if (entity.publicDescription) bits.push(entity.publicDescription);
  if (array(entity.goals).length) bits.push(`goals: ${entity.goals.join("; ")}`);
  if (array(entity.publicPriorities).length) bits.push(`priorities: ${entity.publicPriorities.join("; ")}`);
  if (array(entity.publicForeignPolicy).length) bits.push(`foreign policy: ${entity.publicForeignPolicy.join("; ")}`);
  if (entity.internalPressure) bits.push(`internal pressure: ${entity.internalPressure}`);
  if (entity.privateGoal) bits.push(`private goal: ${entity.privateGoal}`);
  if (entity.internalStrategy) bits.push(`internal strategy: ${entity.internalStrategy}`);
  return `- ${bits.join(" | ")}`;
};

const describeMetricValue = (value, depth = 0) => {
  const number = Number(value);
  if (typeof value !== "boolean" && Number.isFinite(number)) return qualitativeBand(number);
  if (Array.isArray(value)) return value.map((entry) => clippedText(entry, 100)).filter(Boolean).slice(0, 4).join(" / ");
  if (value && typeof value === "object" && depth < 2) {
    return boundedRecordEntries(value, 4)
      .map(([key, nested]) => {
        const described = describeMetricValue(nested, depth + 1);
        return described ? `${titleCaseMetric(key)} ${described}` : "";
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  return clippedText(value, 180);
};

const metricRows = (record, limit) => boundedRecordEntries(record, limit)
  .map(([key, value]) => {
    const described = describeMetricValue(value);
    return described ? `- ${titleCaseMetric(key)}: ${described}` : "";
  })
  .filter(Boolean);

const perceptionLine = (entry) => {
  const metrics = boundedRecordEntries(entry.metrics, 8)
    .map(([key, value]) => {
      const described = describeMetricValue(value);
      return described ? `${titleCaseMetric(key)} ${described}` : "";
    })
    .filter(Boolean);
  return `- ${entry.target}${entry.focusedCounterpart ? " [FOCUS]" : ""}: ${metrics.join(", ") || "recorded perception without bounded metrics"}`;
};

const pressureLine = (row) => {
  const direction = pressureDirectionText(row);
  const momentum = Math.abs(row.momentum) >= 12 ? `; ${signedDirection(row.momentum)} momentum` : "";
  return `- ${titleCaseMetric(row.issue)}: ${qualitativeBand(row.salience)} salience, ${qualitativeBand(row.strain)} strain; pressure leans toward ${direction}${momentum}`;
};

const dispositionLines = (disposition) => Object.entries(disposition)
  .filter(([key]) => key !== "updatedAt")
  .map(([key, value]) => `- ${titleCaseMetric(key)}: ${qualitativeBand(value)}`);

const formatVerboseDecisionContextText = (context, { maxChars }) => {
  const government = context.political.government;
  const system = context.political.politicalSystem;
  const decisionAuthority = context.political.decisionAuthority;
  const actorLabel = context.actorPolity || "Unknown polity";
  const counterpart = context.counterpartPolity;
  const lines = [
    `[Political Decision Context v${POLITICAL_DECISION_CONTEXT_VERSION} — ${actorLabel}]`,
    "KNOWLEDGE BOUNDARY: private political state in this capsule belongs ONLY to the named actor. Use it to model that actor's own reasoning; never treat one polity's hidden traits, pressures, perceptions, or disposition as knowledge possessed by another polity.",
    "REALITY / PERCEPTION RULE: actor perceptions are beliefs and may be wrong. Canonical relations, agreements, and wars below are objective world state for native feasibility/continuity, not proof that the actor perceives them accurately.",
    "This is a read-only projection. It does not authorize changing canonical political state by inference.",
    POLITICAL_DECISION_CURRENT_STATE_AUTHORITY_RULE,
    "",
    "GOVERNMENT & SYSTEM",
    `Political system: ${clean(system.type) || "unspecified"}${clean(system.representation) ? ` / ${clean(system.representation)}` : ""}`,
    `Government form: ${clean(government.form) || "unspecified"}`,
    `Current power tier: ${clean(context.geopolitical?.powerTier) || "minor-power"} (tier follows sovereign capability, not ordinary institution membership)`,
    ...(Number.isFinite(context.geopolitical?.sovereignCapabilityScore)
      ? [`Sovereign capability: ${context.geopolitical.sovereignCapabilityScore}/100`] : []),
    ...(Number.isFinite(context.geopolitical?.strategicWeight)
      ? [`Current strategic weight: ${context.geopolitical.strategicWeight}/100`] : []),
    ...((Number(context.geopolitical?.institutionalLeverageScore) > 0 || Number(context.geopolitical?.strategicActivityScore) > 0)
      ? [`Leverage/relevance add-ons: institutions +${Number(context.geopolitical?.institutionalLeverageScore) || 0}/18; current activity +${Number(context.geopolitical?.strategicActivityScore) || 0}/9`] : []),
    ...(clean(government.status) ? [`Government status: ${clean(government.status)}`] : []),
    `Government ideology: ${clean(government.ideology) || "not canonically specified"}`,
    ...(decisionAuthority ? [
      `Primary political decision-maker (native): ${officeholderName(decisionAuthority.primary)} | ${clean(decisionAuthority.role)} | ${clean(decisionAuthority.model)} | confidence ${clean(decisionAuthority.confidence)}`,
    ] : []),
    `Head of state: ${officeholderName(government.headOfState) || "not specified"}`,
    `Head of government: ${officeholderName(government.headOfGovernment) || "not specified"}`,
    ...(officeholderName(context.political.leader) &&
      ![officeholderName(government.headOfState), officeholderName(government.headOfGovernment)].includes(officeholderName(context.political.leader))
      ? [`Political / supreme leader: ${officeholderName(context.political.leader)}`]
      : []),
    ...(clean(government.coalitionName) ? [`Coalition/bloc label: ${clean(government.coalitionName)}`] : []),
    ...(array(government.rulingParties).length ? [`Ruling parties: ${array(government.rulingParties).map(clean).filter(Boolean).slice(0, 6).join(", ")}`] : []),
    ...(array(government.coalition).length ? [`Coalition parties: ${array(government.coalition).map(clean).filter(Boolean).slice(0, 6).join(", ")}`] : []),
    ...(Number.isFinite(Number(government.approval)) ? [`Government approval: ${qualitativeBand(government.approval)}`] : []),
    ...(Number.isFinite(Number(government.stability)) ? [`Government stability: ${qualitativeBand(government.stability)}`] : []),
    "",
    "LEADERSHIP TENDENCIES",
    ...(
      metricRows(context.political.traits, context.limits.traits).length
        ? metricRows(context.political.traits, context.limits.traits)
        : ["No structured leadership traits are currently canonical."]
    ),
    "",
    "STRATEGIC OUTLOOK",
    `Goals: ${context.political.goals.length ? context.political.goals.join("; ") : "none canonically specified"}`,
    `Fears: ${context.political.fears.length ? context.political.fears.join("; ") : "none canonically specified"}`,
    `Ambitions: ${context.political.ambitions.length ? context.political.ambitions.join("; ") : "none canonically specified"}`,
    "",
    "DOMESTIC POLITICAL PRESSURE",
    ...(context.political.domesticPressures.length
      ? context.political.domesticPressures.map((row) => `- ${row}`)
      : ["No semantic domestic-pressure notes are currently canonical."]),
    ...(context.political.pressureIssues.length
      ? ["Structured current pressure ledger:", ...context.political.pressureIssues.map(pressureLine)]
      : []),
    "",
    "GOVERNING / OPPOSITION ACTORS",
    "Governing side:",
    ...(context.political.entities.governing.length
      ? context.political.entities.governing.map(entityLine)
      : ["- No governing party/power-bloc row resolved from canonical references."]),
    "Opposition / competing actors:",
    ...(context.political.entities.opposition.length
      ? context.political.entities.opposition.map(entityLine)
      : ["- No additional bounded opposition/power-bloc row is canonical."]),
    "",
    "ACTOR PERCEPTIONS (BELIEF, NOT OBJECTIVE TRUTH)",
    ...(context.political.perceptions.length
      ? context.political.perceptions.map(perceptionLine)
      : [counterpart ? `No canonical perception of ${counterpart} is recorded.` : "No structured perceptions are currently canonical."]),
    "",
    "CALCULATED BEHAVIORAL DISPOSITION",
    ...(dispositionLines(context.political.behavioralDisposition).length
      ? dispositionLines(context.political.behavioralDisposition)
      : ["No native behavioral disposition is currently available."]),
  ];

  if (counterpart) {
    lines.push(
      "",
      `COUNTERPART POLITICAL KNOWLEDGE — ${counterpart}`,
      "Only the bounded public/intelligence projection below may be treated as what this actor can know about the counterpart's politics. Counterpart hidden traits/fears/perceptions/disposition are intentionally absent.",
      ...knowledgeSummaryLines(context.counterpartKnowledge),
    );
  }

  lines.push(
    "",
    "FORMAL INSTITUTIONAL POSITION",
    ...(array(context.geopolitical?.institutions).length
      ? array(context.geopolitical.institutions).map((entry) => `- ${entry.name} [${entry.id}] | ${entry.status}${entry.role && entry.role !== "member" ? ` | ${entry.role}` : ""}`)
      : ["No bounded formal institution memberships are currently canonical."]),
    ...(array(context.geopolitical?.institutionLifecycleCases).length
      ? ["Pending institution lifecycle:", ...array(context.geopolitical.institutionLifecycleCases).map((entry) => {
        const fit = [
          entry.politicalCharacter ? `character=${entry.politicalCharacter}` : "",
          array(entry.geographicScope).length ? `scope=${array(entry.geographicScope).join(", ")}` : "",
          array(entry.primaryThreatModel).length ? `threat model=${array(entry.primaryThreatModel).join(", ")}` : "",
          array(entry.purpose).length ? `purpose=${array(entry.purpose).join("; ")}` : "",
          entry.charterNote ? `obligations=${entry.charterNote}` : "",
        ].filter(Boolean).join(" | ");
        return `- ${entry.institutionName} [${entry.institutionId}] | ${entry.kind} | ${entry.status} | requested ${entry.requestedStatus}${fit ? ` | ${fit}` : ""}${entry.reason ? ` | case=${entry.reason}` : ""}`;
      })]
      : []),
    "",
    "OBJECTIVE BILATERAL / CONFLICT CONTEXT",
  );
  if (counterpart) {
    if (context.bilateral.relation) {
      const relation = context.bilateral.relation;
      lines.push(`Relation: ${clean(relation.status) || "tracked"}${Number.isFinite(Number(relation.score)) ? ` (${Number(relation.score) >= 0 ? "+" : ""}${Number(relation.score)})` : ""}${clean(relation.summary) ? ` | ${clean(relation.summary)}` : ""}`);
    } else {
      lines.push("Relation: no canonical bilateral relation is tracked; sparse-ledger absence is not secret hostility or a score of zero.");
    }
  } else {
    lines.push("No single counterpart focus was requested; bounded actor-linked relations, commitments, and conflicts are shown below.");
    lines.push(
      ...(context.bilateral.relations.length
        ? ["Tracked relations:", ...context.bilateral.relations.map((relation) => `- ${clean(relation?.a)} ↔ ${clean(relation?.b)} | ${clean(relation?.status) || "tracked"}${Number.isFinite(Number(relation?.score)) ? ` ${Number(relation.score) >= 0 ? "+" : ""}${Number(relation.score)}` : ""}${clean(relation?.summary) ? ` | ${clean(relation.summary)}` : ""}`)]
        : ["Tracked relations: none in this bounded focus."]),
    );
  }
  lines.push(
    ...(context.bilateral.agreements.length
      ? ["Formal agreements:", ...context.bilateral.agreements.map((agreement) => `- ${agreement.title || agreement.id || "agreement"} | ${agreement.type || "other"} | ${agreement.status || "active"}${agreement.terms ? ` | ${agreement.terms}` : ""}`)]
      : ["Formal agreements: none in this bounded focus."]),
    ...(context.bilateral.wars.length
      ? ["Wars / ceasefires:", ...context.bilateral.wars.map((war) => `- ${war.title || war.id || "war"} | ${war.status || "active"}${war.relationship && war.relationship !== "actor-involved" ? ` | ${war.relationship}` : ""} | ${war.sideA.join(", ")} vs ${war.sideB.join(", ")}`)]
      : ["Wars / ceasefires: none in this bounded focus."]),
  );

  const text = lines.join("\n");
  const cap = Math.max(800, Number(maxChars) || DEFAULT_POLITICAL_DECISION_MAX_CHARS);
  if (text.length <= cap) return text;
  const clipped = text.slice(0, cap);
  const lastBreak = clipped.lastIndexOf("\n");
  return `${clipped.slice(0, lastBreak > cap * 0.75 ? lastBreak : cap).trimEnd()}\n[Political Decision Context truncated at native bound]`;
};


const compactJoined = (values, { limit = 2, itemChars = 150 } = {}) => array(values)
  .map((value) => clippedText(value, itemChars))
  .filter(Boolean)
  .slice(0, limit)
  .join("; ");

// Tight capsules cannot carry every strategic sentence. When the caller knows
// the concrete decision currently being made (for example the player's newest
// diplomatic proposal), use that text only to choose which already-canonical
// actor goals/fears/pressures survive the native character budget. This is a
// projection concern, not political reasoning: it never rewrites or scores the
// actor itself, and falls back to authored order when there is no lexical signal.
const DECISION_FOCUS_STOPWORDS = new Set([
  "about", "after", "again", "against", "also", "among", "because", "been", "before",
  "being", "both", "could", "does", "from", "have", "into", "more", "must", "near",
  "only", "other", "over", "same", "should", "their", "there", "these", "they", "this",
  "those", "through", "under", "very", "while", "with", "would", "your", "ours", "them",
  "than", "then", "that", "such", "will", "shall", "were", "what", "when", "where",
  "which", "whose", "between", "within", "without", "government", "state", "polity",
]);

const decisionFocusTokens = (value) => clean(value)
  .toLocaleLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .match(/[\p{L}\p{N}]+/gu) || [];

const decisionFocusStems = (value) => {
  const out = new Set();
  const add = (term) => {
    if (term.length >= 4 && !DECISION_FOCUS_STOPWORDS.has(term)) out.add(term);
  };
  for (const raw of decisionFocusTokens(value)) {
    add(raw);
    if (raw.length >= 7) {
      if (raw.endsWith("ies")) add(`${raw.slice(0, -3)}y`);
      for (const suffix of ["ments", "ment", "ations", "ation", "ingly", "ing", "edly", "ed", "es", "s"]) {
        if (raw.endsWith(suffix) && raw.length - suffix.length >= 4) {
          add(raw.slice(0, -suffix.length));
          break;
        }
      }
    }
  }
  return out;
};

const sameDecisionFocusFamily = (left, right) => {
  const a = clean(left);
  const b = clean(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  return a.startsWith(b) || b.startsWith(a);
};

const removeIgnoredDecisionFocusTerms = (terms, ignoredTerms) => {
  if (!terms?.size || !ignoredTerms?.size) return terms;
  for (const term of [...terms]) {
    if ([...ignoredTerms].some((ignored) => sameDecisionFocusFamily(term, ignored))) terms.delete(term);
  }
  return terms;
};

const decisionFocusScore = (candidate, focusTerms, ignoredTerms = null) => {
  if (!focusTerms?.size) return 0;
  const candidateTerms = removeIgnoredDecisionFocusTerms(decisionFocusStems(candidate), ignoredTerms);
  if (!candidateTerms.size) return 0;
  let exact = 0;
  let near = 0;
  for (const term of candidateTerms) {
    if (focusTerms.has(term)) {
      exact += 1;
      continue;
    }
    if (term.length < 5) continue;
    for (const focus of focusTerms) {
      if (focus.length < 5) continue;
      if (term.startsWith(focus) || focus.startsWith(term)) {
        near += 1;
        break;
      }
    }
  }
  return exact * 10 + near * 3;
};

const decisionRelevantRows = (values, focusText, limit, ignoredFocusTerms = null) => {
  const cap = Math.max(0, Number(limit) || 0);
  const rows = array(values)
    .map((value, index) => ({ index, text: clippedText(value, 320) }))
    .filter((entry) => entry.text);
  if (!cap || !rows.length) return [];

  const focusTerms = removeIgnoredDecisionFocusTerms(
    decisionFocusStems(clippedText(focusText, 6000)),
    ignoredFocusTerms,
  );
  if (!focusTerms.size) return rows.slice(0, cap).map((entry) => entry.text);

  const ranked = rows
    .map((entry) => ({ ...entry, score: decisionFocusScore(entry.text, focusTerms, ignoredFocusTerms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  if (!ranked.length) return rows.slice(0, cap).map((entry) => entry.text);

  const selected = ranked.slice(0, cap);
  const selectedIndexes = new Set(selected.map((entry) => entry.index));
  for (const entry of rows) {
    if (selected.length >= cap) break;
    if (selectedIndexes.has(entry.index)) continue;
    selected.push({ ...entry, score: 0 });
    selectedIndexes.add(entry.index);
  }
  return selected.map((entry) => entry.text);
};

const compactDecisionRelevantJoined = (values, focusText, { limit = 2, itemChars = 150, ignoredFocusTerms = null } = {}) =>
  decisionRelevantRows(values, focusText, limit, ignoredFocusTerms)
    .map((value) => clippedText(value, itemChars))
    .filter(Boolean)
    .join("; ");

const compactDispositionLine = (disposition) => {
  const labels = [
    ["assertiveness", "assert"],
    ["riskTolerance", "risk"],
    ["escalationPressure", "escalate"],
    ["compromisePressure", "compromise"],
    ["deterrenceSensitivity", "deterrence"],
    ["opportunityPerception", "opportunity"],
    ["threatPerception", "threat"],
  ];
  const bits = labels
    .filter(([key]) => Number.isFinite(Number(disposition?.[key])))
    .map(([key, label]) => `${label} ${qualitativeBand(disposition[key])}`);
  return bits.length ? `Disposition: ${bits.join(" | ")}` : "Disposition: no native C4 available";
};

const compactGoverningEntityLine = (entity) => {
  if (!entity) return "Governing force: unresolved";
  const head = [
    entity.name,
    entity.ideology,
    Number.isFinite(Number(entity.supportPercent)) ? `${entity.supportPercent}% support` : "",
    Number.isFinite(Number(entity.influencePercent)) ? `${entity.influencePercent}% influence` : "",
  ].filter(Boolean).join(" | ");
  const motives = [
    entity.privateGoal ? `private goal: ${clippedText(entity.privateGoal, 170)}` : "",
    entity.internalStrategy ? `strategy: ${clippedText(entity.internalStrategy, 170)}` : "",
    array(entity.publicForeignPolicy).length ? `foreign policy: ${compactJoined(entity.publicForeignPolicy, { limit: 1, itemChars: 170 })}` : "",
    array(entity.goals).length ? `party goal: ${compactJoined(entity.goals, { limit: 1, itemChars: 150 })}` : "",
  ].filter(Boolean);
  return `Governing force: ${head}${motives.length ? ` | ${motives.join(" | ")}` : ""}`;
};

const compactPerceptionLine = (entry) => {
  const metrics = boundedRecordEntries(entry?.metrics, 4)
    .map(([key, value]) => {
      const described = describeMetricValue(value);
      return described ? `${titleCaseMetric(key)} ${described}` : "";
    })
    .filter(Boolean)
    .join(", ");
  return `${entry?.target || "Unknown"}${entry?.focusedCounterpart ? " [FOCUS]" : ""}: ${metrics || "recorded belief"}`;
};

const appendBoundedLine = (lines, line, cap, { reserve = 0 } = {}) => {
  const text = clean(line);
  if (!text) return false;
  const current = lines.join("\n");
  const nextLength = current.length + (current ? 1 : 0) + text.length + reserve;
  if (nextLength > cap) return false;
  lines.push(text);
  return true;
};

// World Director capsules use a deliberately tight per-actor budget. The old
// formatter simply rendered the verbose document and chopped it at N chars,
// which meant rich actors routinely lost C4, governing-party motives and
// perceptions after the Goals/Fears lines. For tight budgets, build a compact
// decision-first capsule instead: behavior and governing motives are placed
// before descriptive detail, and optional rows are omitted whole rather than
// cutting the document at an arbitrary section boundary.
const formatCompactDecisionContextText = (context, { maxChars, decisionFocusText = "" }) => {
  const cap = Math.max(900, Number(maxChars) || DEFAULT_POLITICAL_DECISION_SET_PER_ACTOR_MAX_CHARS);
  const marker = "[Native bounded political capsule; lower-priority detail omitted]";
  const government = context.political.government;
  const system = context.political.politicalSystem;
  const counterpart = context.counterpartPolity;
  const decisionAuthority = context.political.decisionAuthority;
  const ignoredFocusTerms = new Set([
    ...decisionFocusStems(context.actorPolity),
    ...decisionFocusStems(context.counterpartPolity),
  ]);
  const lines = [
    `[Political Decision Context v${POLITICAL_DECISION_CONTEXT_VERSION} — ${context.actorPolity || "Unknown polity"}]`,
    "PRIVATE ACTOR CAPSULE: beliefs may be wrong; do not transfer hidden state to other actors. Objective diplomacy/war canon remains reality.",
    POLITICAL_DECISION_CURRENT_STATE_AUTHORITY_RULE,
  ];

  const systemBits = [
    clean(context.geopolitical?.powerTier)
      ? `power ${clean(context.geopolitical.powerTier)}${Number.isFinite(context.geopolitical?.sovereignCapabilityScore) ? `; sovereign ${context.geopolitical.sovereignCapabilityScore}/100` : ""}${Number.isFinite(context.geopolitical?.strategicWeight) ? `; weight ${context.geopolitical.strategicWeight}/100` : ""}`
      : "",
    clean(system.type),
    clean(government.form),
    clean(government.ideology) ? `ideology ${clean(government.ideology)}` : "",
  ].filter(Boolean).map((value) => clippedText(value, 150));
  appendBoundedLine(lines, `Government: ${systemBits.join(" | ")}`, cap, { reserve: marker.length + 2 });
  if (Number(context.geopolitical?.institutionalLeverageScore) > 0 || Number(context.geopolitical?.strategicActivityScore) > 0) {
    appendBoundedLine(
      lines,
      `Power leverage: institutions +${Number(context.geopolitical?.institutionalLeverageScore) || 0}/18 | current activity +${Number(context.geopolitical?.strategicActivityScore) || 0}/9`,
      cap,
      { reserve: marker.length + 2 },
    );
  }

  appendBoundedLine(
    lines,
    decisionAuthority
      ? `Decision-maker: ${officeholderName(decisionAuthority.primary)} (${clean(decisionAuthority.role)}; ${clean(decisionAuthority.model)}; ${clean(decisionAuthority.confidence)} confidence)`
      : "",
    cap,
    { reserve: marker.length + 2 },
  );

  const leaderBits = [
    officeholderName(government.headOfState) ? `HoS ${officeholderName(government.headOfState)}` : "",
    officeholderName(government.headOfGovernment) ? `HoG ${officeholderName(government.headOfGovernment)}` : "",
    array(government.rulingParties).length ? `ruling ${array(government.rulingParties).map(clean).filter(Boolean).slice(0, 3).join(", ")}` : "",
  ].filter(Boolean);
  appendBoundedLine(lines, leaderBits.length ? `Leadership: ${leaderBits.join(" | ")}` : "", cap, { reserve: marker.length + 2 });

  // Native disposition is more useful to an action-selection model than a long
  // list of raw traits, so place it before strategic prose.
  appendBoundedLine(lines, compactDispositionLine(context.political.behavioralDisposition), cap, { reserve: marker.length + 2 });

  const governing = context.political.entities.governing?.[0];
  appendBoundedLine(lines, compactGoverningEntityLine(governing), cap, { reserve: marker.length + 2 });

  appendBoundedLine(lines, `Goals: ${compactDecisionRelevantJoined(context.political.goals, decisionFocusText, { limit: 2, itemChars: 145, ignoredFocusTerms }) || "none"}`, cap, { reserve: marker.length + 2 });
  appendBoundedLine(lines, `Fears: ${compactDecisionRelevantJoined(context.political.fears, decisionFocusText, { limit: 1, itemChars: 145, ignoredFocusTerms }) || "none"}`, cap, { reserve: marker.length + 2 });
  appendBoundedLine(lines, `Ambitions: ${compactDecisionRelevantJoined(context.political.ambitions, decisionFocusText, { limit: 1, itemChars: 145, ignoredFocusTerms }) || "none"}`, cap, { reserve: marker.length + 2 });

  // Counterpart-focused and first-ranked perceptions are already selected by
  // native relevance logic. Keep up to two if they fit.
  for (const perception of array(context.political.perceptions).slice(0, 2)) {
    if (!appendBoundedLine(lines, `Belief — ${compactPerceptionLine(perception)}`, cap, { reserve: marker.length + 2 })) break;
  }

  if (context.political.domesticPressures.length) {
    appendBoundedLine(lines, `Domestic pressure: ${compactDecisionRelevantJoined(context.political.domesticPressures, decisionFocusText, { limit: 1, itemChars: 160, ignoredFocusTerms })}`, cap, { reserve: marker.length + 2 });
  }

  if (counterpart) {
    const publicKnowledge = knowledgeSummaryLines(context.counterpartKnowledge)
      .map((line) => clean(line.replace(/^[-•]\s*/, "")))
      .filter(Boolean)
      .slice(0, 2)
      .join(" | ");
    appendBoundedLine(lines, publicKnowledge ? `Counterpart public/intel — ${counterpart}: ${clippedText(publicKnowledge, 230)}` : "", cap, { reserve: marker.length + 2 });
  }

  const institutionNames = array(context.geopolitical?.institutions)
    .map((entry) => clean(entry?.shortName || entry?.name || entry?.id))
    .filter(Boolean)
    .slice(0, 6);
  appendBoundedLine(lines, institutionNames.length ? `Institutions: ${institutionNames.join(", ")}` : "", cap, { reserve: marker.length + 2 });

  const relationBits = array(context.bilateral?.relations).slice(0, 3).map((relation) => {
    const other = samePolity({}, relation?.a, context.actorPolity) ? relation?.b : relation?.a;
    const score = Number(relation?.score);
    return `${clean(other)} ${clean(relation?.status) || "tracked"}${Number.isFinite(score) ? ` ${score >= 0 ? "+" : ""}${score}` : ""}`;
  }).filter(Boolean);
  if (counterpart && context.bilateral?.relation) {
    const focused = context.bilateral.relation;
    const alreadyIncluded = array(context.bilateral?.relations).some((relation) => (
      (clean(focused?.id) && clean(relation?.id) === clean(focused.id))
      || (
        (samePolity({}, relation?.a, focused?.a) && samePolity({}, relation?.b, focused?.b))
        || (samePolity({}, relation?.a, focused?.b) && samePolity({}, relation?.b, focused?.a))
      )
    ));
    if (!alreadyIncluded) {
      const score = Number(focused?.score);
      relationBits.unshift(`${counterpart} ${clean(focused?.status) || "tracked"}${Number.isFinite(score) ? ` ${score >= 0 ? "+" : ""}${score}` : ""}`);
    }
  }
  appendBoundedLine(lines, relationBits.length ? `Objective relations: ${relationBits.slice(0, 3).join("; ")}` : "", cap, { reserve: marker.length + 2 });

  // If anything material could not fit, make that explicit without pretending
  // the capsule was complete. Core decision drivers above are always attempted
  // before this marker.
  const fullSignals = [
    context.political.goals.length,
    context.political.fears.length,
    context.political.ambitions.length,
    context.political.entities.governing.length,
    context.political.perceptions.length,
    context.political.domesticPressures.length,
    institutionNames.length,
    relationBits.length,
  ].some(Boolean);
  const text = lines.join("\n");
  if (fullSignals && text.length + marker.length + 1 <= cap) lines.push(marker);
  return lines.join("\n").slice(0, cap);
};

const formatDecisionContextText = (context, { maxChars, decisionFocusText = "" }) => {
  const cap = Math.max(800, Number(maxChars) || DEFAULT_POLITICAL_DECISION_MAX_CHARS);
  if (cap <= 2600) return formatCompactDecisionContextText(context, { maxChars: cap, decisionFocusText });
  return formatVerboseDecisionContextText(context, { maxChars: cap });
};

const safeCounterpartKnowledgeLevel = (level) =>
  [
    POLITICAL_KNOWLEDGE_LEVELS.PUBLIC,
    POLITICAL_KNOWLEDGE_LEVELS.ASSESSED,
    POLITICAL_KNOWLEDGE_LEVELS.CLASSIFIED,
  ].includes(level)
    ? level
    : POLITICAL_KNOWLEDGE_LEVELS.PUBLIC;

/**
 * Build one actor-relative, bounded, read-only political decision capsule.
 *
 * Canonical Political Actors supply the actor's own private/internal political
 * state. Counterpart politics come only through Political Knowledge, while
 * relations/agreements/wars remain objective canonical state. Nothing here
 * mutates world state or creates missing actors.
 */
export const buildPoliticalDecisionContext = (
  worldLike,
  actorPolity,
  {
    counterpartPolity = "",
    knowledgeLevel = POLITICAL_KNOWLEDGE_LEVELS.PUBLIC,
    intelligenceAssessment = null,
    decisionFocusText = "",
    limits: requestedLimits = {},
    maxChars = DEFAULT_POLITICAL_DECISION_MAX_CHARS,
  } = {},
) => {
  const world = worldLike && typeof worldLike === "object" ? worldLike : {};
  const actor = getPoliticalProfile(world, actorPolity);
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) return null;

  const limits = normalizeLimits(requestedLimits);
  const actorLabel = canonicalPolityLabel(world, actorPolity);
  const counterpartLabel = counterpartPolity ? canonicalPolityLabel(world, counterpartPolity) : "";
  const entities = selectEntityRows(actor, limits);
  const pressureIssues = selectPressureIssues(actor, limits.pressureIssues);
  const perceptions = perceptionEntries(world, actor, counterpartPolity, limits.perceptions);
  const behavioralDisposition = dispositionRecord(actor);
  const decisionAuthority = projectDecisionAuthority(derivePoliticalDecisionAuthority(actor));

  const diplomatic = boundedDiplomaticProjection(world, actorPolity, counterpartPolity, limits);

  const counterpartKnowledge = counterpartPolity
    ? buildPoliticalKnowledgeView(world, counterpartPolity, {
        level: safeCounterpartKnowledgeLevel(knowledgeLevel),
        intelligenceAssessment,
      })
    : null;

  const relation = counterpartPolity
    ? relationForPair(world, diplomatic.relations, actorPolity, counterpartPolity)
    : null;
  const agreements = agreementRows(
    world,
    diplomatic.agreements,
    actorPolity,
    counterpartPolity,
    limits.agreements,
  );
  const wars = warRows(world, actorPolity, counterpartPolity, limits.wars);
  const power = powerDecisionProfileForPolity(world, actorPolity);

  const context = {
    schemaVersion: POLITICAL_DECISION_CONTEXT_VERSION,
    actorPolity: actorLabel,
    ...(counterpartLabel ? { counterpartPolity: counterpartLabel } : {}),
    limits,
    political: {
      politicalSystem: projectPoliticalSystem(actor.politicalSystem),
      government: projectGovernment(actor.government),
      decisionAuthority,
      leader: projectOfficeholder(actor.leader),
      traits: boundedMetricRecord(actor.traits, limits.traits),
      goals: conciseList(actor.goals, limits.goals),
      fears: conciseList(actor.fears, limits.fears),
      ambitions: conciseList(actor.ambitions, limits.ambitions),
      domesticPressures: conciseList(actor.domesticPressures, limits.domesticPressures),
      pressureIssues,
      entities,
      perceptions,
      behavioralDisposition,
    },
    geopolitical: {
      powerTier: power.tier,
      sovereignCapabilityScore: power.sovereignCapabilityScore,
      institutionalLeverageScore: power.institutionalLeverageScore,
      strategicActivityScore: power.strategicActivityScore,
      strategicWeight: power.strategicWeight,
      institutions: institutionsForPolity(world, actorPolity, { includeSuspended: true })
        .slice(0, limits.institutions)
        .map(({ institution, member }) => ({
          id: institution.id,
          name: institution.name,
          kind: institution.kind,
          status: member.status,
          role: member.role,
        })),
      institutionLifecycleCases: institutionLifecycleCasesForPolity(world, actorPolity, { pendingOnly: true })
        .slice(0, limits.institutionLifecycleCases || 6)
        .map(({ institution, case: lifecycleCase }) => ({
          institutionId: institution.id,
          institutionName: institution.name,
          kind: lifecycleCase.kind,
          status: lifecycleCase.status,
          requestedStatus: lifecycleCase.requestedStatus,
          reason: clean(lifecycleCase.reason).slice(0, 240),
          purpose: array(institution?.charter?.lifecycle?.purpose).slice(0, 4),
          politicalCharacter: clean(institution?.charter?.lifecycle?.identity?.politicalCharacter).slice(0, 220),
          geographicScope: array(institution?.charter?.lifecycle?.identity?.geographicScope).slice(0, 4),
          primaryThreatModel: array(institution?.charter?.lifecycle?.identity?.primaryThreatModel).slice(0, 4),
          charterNote: clean(institution?.charter?.note).slice(0, 320),
        })),
    },
    ...(counterpartKnowledge ? { counterpartKnowledge: cloneValue(counterpartKnowledge) } : {}),
    bilateral: {
      relation: cloneValue(relation),
      relations: cloneValue(diplomatic.relations.slice(0, limits.relations)),
      agreements,
      wars,
    },
  };

  context.text = formatDecisionContextText(context, { maxChars, decisionFocusText });
  return context;
};

/**
 * Bounded multi-actor wrapper for consumers such as the World Director. Actor
 * capsules remain logically compartmentalized; the text repeats the knowledge
 * boundary so an omniscient simulation call does not turn one actor's private
 * state into another actor's knowledge.
 */
export const buildBoundedPoliticalDecisionContextSet = (
  worldLike,
  {
    actorPolities = [],
    counterpartByActor = {},
    maxActors = DEFAULT_POLITICAL_DECISION_MAX_ACTORS,
    perActorMaxChars = DEFAULT_POLITICAL_DECISION_SET_PER_ACTOR_MAX_CHARS,
    maxTotalChars = DEFAULT_POLITICAL_DECISION_SET_MAX_CHARS,
    limits = {},
    decisionFocusText = "",
  } = {},
) => {
  const contexts = [];
  const omittedActorPolities = [];
  const seen = new Set();
  const actorLimit = Math.max(0, Number(maxActors) || 0);
  const totalCap = Math.max(1200, Number(maxTotalChars) || DEFAULT_POLITICAL_DECISION_SET_MAX_CHARS);
  const envelopeReserve = 360;
  let usedChars = 0;

  for (const rawPolity of array(actorPolities)) {
    const polity = clean(rawPolity);
    if (!polity) continue;
    const actor = getPoliticalProfile(worldLike, polity);
    if (!actor) {
      omittedActorPolities.push(polity);
      continue;
    }
    const key = tokenKey(getPoliticalProfileKey(worldLike, polity) || actor.polityKey || actor.name || polity);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    if (contexts.length >= actorLimit) {
      omittedActorPolities.push(canonicalPolityLabel(worldLike, polity));
      continue;
    }

    const counterpart = counterpartByActor && typeof counterpartByActor === "object"
      ? clean(counterpartByActor[polity] || counterpartByActor[key])
      : "";
    const context = buildPoliticalDecisionContext(worldLike, polity, {
      counterpartPolity: counterpart,
      decisionFocusText,
      limits,
      maxChars: perActorMaxChars,
    });
    if (!context) continue;

    const projected = usedChars + context.text.length + envelopeReserve;
    if (contexts.length > 0 && projected > totalCap) {
      omittedActorPolities.push(context.actorPolity);
      continue;
    }
    contexts.push(context);
    usedChars += context.text.length;
  }

  const text = contexts.length
    ? [
        `[Bounded Political Decision Context Set v${POLITICAL_DECISION_CONTEXT_VERSION}]`,
        "Each capsule contains actor-private state. Never transfer private facts across actors; cross-actor knowledge is limited to each capsule's explicit Political Knowledge and objective bilateral ledger.",
        ...(omittedActorPolities.length
          ? [`Native bound omitted ${omittedActorPolities.length} requested actor(s): ${omittedActorPolities.slice(0, 12).join(", ")}${omittedActorPolities.length > 12 ? ", …" : ""}`]
          : []),
        "",
        ...contexts.flatMap((context, index) => [
          `--- ACTOR CAPSULE ${index + 1}/${contexts.length} ---`,
          context.text,
          "",
        ]),
      ].join("\n").trim()
    : "";

  return {
    schemaVersion: POLITICAL_DECISION_CONTEXT_VERSION,
    contexts,
    omittedActorPolities,
    text: text.length <= totalCap
      ? text
      : (() => {
          const marker = "\n[Political Decision Context set truncated at native bound]";
          return `${text.slice(0, Math.max(0, totalCap - marker.length)).trimEnd()}${marker}`;
        })(),
  };
};
