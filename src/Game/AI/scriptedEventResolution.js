/*! Open Historia — native eligibility and exactly-once resolution for scenario scripted events © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

import { resolvePolityIdentity } from "../../runtime/polityIdentity.js";

const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLowerCase();
const array = (value) => Array.isArray(value) ? value : [];
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const dateKey = (iso) => {
  const match = /^(-?)(\d{1,4})-(\d{2})-(\d{2})$/.exec(text(iso));
  if (!match) return null;
  const value = Number(match[2]) * 10000 + Number(match[3]) * 100 + Number(match[4]);
  return match[1] ? -value : value;
};

const activePolityExists = (world, id) => {
  const key = text(id);
  if (!key) return false;
  const overrides = record(world?.polityOverrides);
  if (Object.prototype.hasOwnProperty.call(overrides, key)) {
    return lower(overrides[key]?.status) !== "dissolved";
  }
  if (array(world?.ownerCodes).some((entry) => text(entry) === key)) return true;
  if (Object.prototype.hasOwnProperty.call(record(world?.politicalActors?.byPolity), key)) return true;
  if (Object.prototype.hasOwnProperty.call(record(world?.countryStats), key)) return true;
  if (Object.prototype.hasOwnProperty.call(record(world?.powerStatus?.byPolity), key)) return true;
  return false;
};

const politicalActorExists = (world, id) => {
  const key = text(id);
  if (!key) return false;
  return Object.prototype.hasOwnProperty.call(record(world?.politicalActors?.byPolity), key);
};

// Legacy CSE-v1 compatibility only. New authoring deliberately hides war
// predicates until the canonical war ledger is hardened.
const warIsActive = (world, id) => {
  const key = text(id);
  if (!key) return false;
  return array(world?.wars).some((war) => text(war?.id) === key && lower(war?.status || "active") === "active");
};

const institutionById = (world, id) => {
  const key = text(id);
  if (!key) return null;
  const source = record(world?.institutions);
  const byId = record(source.byId && typeof source.byId === "object" ? source.byId : source);
  const institution = byId[key];
  return institution && typeof institution === "object" && !Array.isArray(institution)
    ? institution
    : null;
};

const institutionExists = (world, id) => {
  const institution = institutionById(world, id);
  return Boolean(institution) && lower(institution?.status || "active") !== "dissolved";
};

const institutionMember = (world, institutionId, polityId) => {
  const institution = institutionById(world, institutionId);
  const polity = text(polityId);
  if (!institution || lower(institution?.status || "active") === "dissolved" || !polity) return null;
  return array(institution.members).find((member) => text(member?.polity) === polity) || null;
};

const institutionHasPolity = (world, institutionId, polityId) => Boolean(
  institutionMember(world, institutionId, polityId),
);

const institutionMemberHasStatus = (world, institutionId, polityId, expectedStatus) => {
  const member = institutionMember(world, institutionId, polityId);
  const status = lower(expectedStatus);
  if (!member || !status) return false;
  return lower(member?.status || "member") === status;
};

const subordinationExists = (world, polityId, overlordId, expectedKind = "") => {
  const polity = text(polityId);
  const overlord = text(overlordId);
  const kind = lower(expectedKind);
  if (!polity || !overlord) return false;
  return array(world?.puppets).some((row) => (
    text(row?.puppet) === polity
    && text(row?.overlord) === overlord
    && lower(row?.status || "active") === "active"
    && (!kind || lower(row?.kind || "client") === kind)
  ));
};

const scriptedResolutionEntry = (state, eventId) => {
  const id = text(eventId);
  return id ? record(state)[id] || null : null;
};

const effectiveRegionController = (world, condition) => {
  const regionId = text(condition?.regionId);
  if (!regionId) return "";
  const overrides = record(world?.regionOwnershipOverrides);
  if (Object.prototype.hasOwnProperty.call(overrides, regionId)) {
    const override = overrides[regionId];
    if (typeof override === "string") return text(override);
    return text(override?.owner || override?.ownerCode || override?.controller || override?.polity);
  }
  return text(condition?.baseOwner);
};

const resolvedScriptedState = (resolvedState, pendingState) => ({
  ...normalizeScriptedEventState(resolvedState),
  ...record(pendingState),
});

export const normalizeScriptedEventState = (value) => {
  const source = record(value);
  const out = {};
  for (const [rawId, rawEntry] of Object.entries(source).slice(-4096)) {
    const id = text(rawId).slice(0, 160);
    const entry = record(rawEntry);
    const outcome = lower(entry.outcome);
    if (!id || !["fired", "skipped"].includes(outcome)) continue;
    const normalized = {
      outcome,
      mode: lower(entry.mode || "always").slice(0, 32),
      date: text(entry.date).slice(0, 24),
      resolvedDate: text(entry.resolvedDate || entry.date).slice(0, 24),
    };
    if (Number.isFinite(Number(entry.roll))) normalized.roll = Math.max(0, Math.min(1, Number(entry.roll)));
    if (Number.isFinite(Number(entry.percent))) normalized.percent = Math.max(0, Math.min(100, Number(entry.percent)));
    if (text(entry.selectedOutcomeId)) normalized.selectedOutcomeId = text(entry.selectedOutcomeId).slice(0, 160);
    if (Number.isFinite(Number(entry.outcomeRoll))) normalized.outcomeRoll = Math.max(0, Math.min(1, Number(entry.outcomeRoll)));
    if (entry.effectiveWeights && typeof entry.effectiveWeights === "object" && !Array.isArray(entry.effectiveWeights)) {
      normalized.effectiveWeights = Object.fromEntries(Object.entries(entry.effectiveWeights).slice(0, 24).map(([key, value]) => [text(key).slice(0, 160), Math.max(0, Number(value) || 0)]));
    }
    out[id] = normalized;
  }
  return out;
};

// Resolve both the target and actual human seats through the canonical identity
// registry. Ambiguous/missing identities cannot satisfy either predicate.
export const resolveScriptedPolityIdentity = (world, value) => {
  if (typeof value !== "string" || !value.trim()) return "";
  const result = resolvePolityIdentity(value, world, {
    allowUnknown: false, requireActive: true, allowStockBase: !world?.customRegions,
  });
  if (result.resolved) {
    return lower(world?.polityOverrides?.[result.resolved]?.status) === "dissolved" ? "" : result.resolved;
  }
  // Legacy custom maps can have an exact owner key but no declared identity.
  // Never override a declared-but-inactive or ambiguous identity with it.
  if (result.status !== "unresolved" || result.candidates.length) return "";
  const key = text(value);
  if (Object.hasOwn(record(world?.polityOverrides), key)) return "";
  const owners = new Set([...array(world?.ownerCodes), ...Object.values(record(world?.regionOwnershipOverrides))]);
  return owners.has(key) ? key : "";
};
export const evaluateScriptedEventCondition = (conditionInput, world = {}, { scriptedEventState = {}, playerPolities = null } = {}) => {
  const condition = record(conditionInput);
  const type = lower(condition.type);

  switch (type) {
  case "polity_exists": {
    if (!text(condition.polityId)) return { matched: false, reason: "missing polity id" };
    return { matched: activePolityExists(world, condition.polityId), reason: "" };
  }
  case "polity_not_exists": {
    if (!text(condition.polityId)) return { matched: false, reason: "missing polity id" };
    return { matched: !activePolityExists(world, condition.polityId), reason: "" };
  }
  case "polity_player_controlled":
  case "polity_not_player_controlled": {
    const target = resolveScriptedPolityIdentity(world, condition.polityId);
    const rawSeats = Array.isArray(playerPolities) ? playerPolities : [];
    if (!target || !rawSeats.length) {
      return { matched: false, reason: "player or target polity identity unavailable" };
    }
    const activeSeats = [];
    for (const rawSeat of rawSeats) {
      const active = resolveScriptedPolityIdentity(world, rawSeat);
      if (active) {
        activeSeats.push(active);
        continue;
      }
      // Distinguish a known dissolved human seat (which no longer controls any
      // country and must not break evaluation for surviving countries in MP)
      // from an unknown or ambiguous identity (which fails closed).
      const dissolvedCheck = resolvePolityIdentity(rawSeat, world, {
        allowUnknown: false,
        requireActive: false,
        allowStockBase: !world?.customRegions,
      });
      const isKnownDissolved = Boolean(
        dissolvedCheck.resolved
        && lower(world?.polityOverrides?.[dissolvedCheck.resolved]?.status) === "dissolved",
      );
      if (!isKnownDissolved) {
        return { matched: false, reason: "player or target polity identity unavailable" };
      }
    }
    const controlled = activeSeats.includes(target);
    return { matched: type === "polity_player_controlled" ? controlled : !controlled, reason: "" };
  }
  case "political_actor_exists": {
    if (!text(condition.polityId)) return { matched: false, reason: "missing polity id" };
    return { matched: politicalActorExists(world, condition.polityId), reason: "" };
  }
  case "political_actor_not_exists": {
    if (!text(condition.polityId)) return { matched: false, reason: "missing polity id" };
    if (!activePolityExists(world, condition.polityId)) return { matched: false, reason: "polity does not exist" };
    return { matched: !politicalActorExists(world, condition.polityId), reason: "" };
  }
  case "war_active": {
    if (!text(condition.warId)) return { matched: false, reason: "missing war id" };
    return { matched: warIsActive(world, condition.warId), reason: "" };
  }
  case "war_not_active": {
    if (!text(condition.warId)) return { matched: false, reason: "missing war id" };
    return { matched: !warIsActive(world, condition.warId), reason: "" };
  }
  case "institution_exists": {
    if (!text(condition.institutionId)) return { matched: false, reason: "missing institution id" };
    return { matched: institutionExists(world, condition.institutionId), reason: "" };
  }
  case "institution_not_exists": {
    if (!text(condition.institutionId)) return { matched: false, reason: "missing institution id" };
    return { matched: !institutionExists(world, condition.institutionId), reason: "" };
  }
  case "institution_has_polity": {
    if (!text(condition.institutionId) || !text(condition.polityId)) {
      return { matched: false, reason: "missing institution or polity id" };
    }
    return { matched: institutionHasPolity(world, condition.institutionId, condition.polityId), reason: "" };
  }
  case "institution_lacks_polity": {
    if (!text(condition.institutionId) || !text(condition.polityId)) {
      return { matched: false, reason: "missing institution or polity id" };
    }
    if (!institutionExists(world, condition.institutionId)) {
      return { matched: false, reason: "institution does not exist" };
    }
    if (!activePolityExists(world, condition.polityId)) {
      return { matched: false, reason: "polity does not exist" };
    }
    return { matched: !institutionHasPolity(world, condition.institutionId, condition.polityId), reason: "" };
  }
  case "institution_member_status": {
    if (!text(condition.institutionId) || !text(condition.polityId) || !text(condition.status)) {
      return { matched: false, reason: "missing institution, polity or status" };
    }
    return {
      matched: institutionMemberHasStatus(world, condition.institutionId, condition.polityId, condition.status),
      reason: "",
    };
  }
  case "polity_subordinate_to": {
    if (!text(condition.polityId) || !text(condition.overlordId)) {
      return { matched: false, reason: "missing subordinate or overlord polity id" };
    }
    return {
      matched: subordinationExists(world, condition.polityId, condition.overlordId, condition.kind),
      reason: "",
    };
  }
  case "polity_not_subordinate_to": {
    if (!text(condition.polityId) || !text(condition.overlordId)) {
      return { matched: false, reason: "missing subordinate or overlord polity id" };
    }
    if (!activePolityExists(world, condition.polityId) || !activePolityExists(world, condition.overlordId)) {
      return { matched: false, reason: "subordinate or overlord polity does not exist" };
    }
    return {
      matched: !subordinationExists(world, condition.polityId, condition.overlordId, condition.kind),
      reason: "",
    };
  }
  case "polity_controls_region":
  case "polity_not_controls_region": {
    if (!text(condition.polityId) || !text(condition.regionId)) return { matched: false, reason: "missing polity or region id" };
    const controller = effectiveRegionController(world, condition);
    if (!controller) return { matched: false, reason: "region controller unavailable" };
    const same = lower(controller) === lower(condition.polityId);
    return { matched: type === "polity_controls_region" ? same : !same, reason: "" };
  }
  case "scripted_event_fired":
  case "scripted_event_skipped": {
    if (!text(condition.eventId)) return { matched: false, reason: "missing scripted event id" };
    const prior = scriptedResolutionEntry(scriptedEventState, condition.eventId);
    if (!prior || !["fired", "skipped"].includes(lower(prior.outcome))) return { matched: false, reason: "referenced scripted event unresolved" };
    return { matched: lower(prior.outcome) === (type === "scripted_event_fired" ? "fired" : "skipped"), reason: "" };
  }
  case "scripted_outcome_selected":
  case "scripted_outcome_not_selected": {
    if (!text(condition.eventId) || !text(condition.outcomeId)) return { matched: false, reason: "missing scripted event or outcome id" };
    const prior = scriptedResolutionEntry(scriptedEventState, condition.eventId);
    if (!prior || !["fired", "skipped"].includes(lower(prior.outcome))) return { matched: false, reason: "referenced scripted event unresolved" };
    if (lower(prior.outcome) !== "fired") return { matched: type === "scripted_outcome_not_selected", reason: "" };
    if (!text(prior.selectedOutcomeId)) return { matched: false, reason: "referenced scripted event has no selected outcome" };
    const selected = text(prior.selectedOutcomeId) === text(condition.outcomeId);
    return { matched: type === "scripted_outcome_selected" ? selected : !selected, reason: "" };
  }
  default:
    return { matched: false, reason: type ? `unsupported condition ${type}` : "missing condition type" };
  }
};

export const evaluateScriptedEventConditions = (triggerInput, world = {}, options = {}) => {
  const trigger = record(triggerInput);
  const conditions = array(trigger.conditions);
  if (!conditions.length) return { matched: false, matchedCount: 0, requiredCount: 0, results: [], reason: "no conditions" };
  const results = conditions.map((condition) => evaluateScriptedEventCondition(condition, world, options));
  const matchedCount = results.filter((entry) => entry.matched).length;
  const rawOperator = lower(trigger.operator).replace(/-/g, "_");
  const operator = ["all", "any", "at_least"].includes(rawOperator) ? rawOperator : "all";
  const requested = Number(trigger.requiredCount ?? trigger.minimum ?? 1);
  const requiredCount = operator === "all"
    ? results.length
    : operator === "any"
      ? 1
      : Math.max(1, Math.min(results.length, Number.isFinite(requested) ? Math.trunc(requested) : 1));
  return {
    matched: matchedCount >= requiredCount,
    matchedCount,
    requiredCount,
    results,
    reason: "",
  };
};

const resolutionFor = (event, world, random, scriptedEventState = {}, playerPolities = null) => {
  const trigger = record(event?.trigger);
  const mode = lower(trigger.mode || "always");

  if (mode === "rules") {
    const conditions = array(trigger.conditions);
    const evaluation = conditions.length
      ? evaluateScriptedEventConditions(trigger, world, { scriptedEventState, playerPolities })
      : { matched: true, matchedCount: 0, requiredCount: 0, results: [], reason: "" };
    const percent = Math.max(0, Math.min(100, Number.isFinite(Number(trigger.percent)) ? Number(trigger.percent) : 100));
    if (!evaluation.matched) {
      return {
        outcome: "skipped",
        mode,
        date: text(event?.date),
        percent,
        reason: "conditions not met",
        event,
      };
    }
    if (percent >= 100) return { outcome: "fired", mode, date: text(event?.date), percent, event };
    if (percent <= 0) return { outcome: "skipped", mode, date: text(event?.date), percent, event };
    const sample = Number(random?.());
    const roll = Number.isFinite(sample) ? Math.max(0, Math.min(0.999999999999, sample)) : 0.5;
    return {
      outcome: roll * 100 < percent ? "fired" : "skipped",
      mode,
      date: text(event?.date),
      roll,
      percent,
      event,
    };
  }

  if (mode === "always") {
    return { outcome: "fired", mode, date: text(event?.date), event };
  }

  if (mode === "chance") {
    const percent = Math.max(0, Math.min(100, Number.isFinite(Number(trigger.percent)) ? Number(trigger.percent) : 50));
    const sample = Number(random?.());
    const roll = Number.isFinite(sample) ? Math.max(0, Math.min(0.999999999999, sample)) : 0.5;
    return {
      outcome: roll * 100 < percent ? "fired" : "skipped",
      mode,
      date: text(event?.date),
      roll,
      percent,
      event,
    };
  }

  if (mode === "conditional") {
    const evaluation = evaluateScriptedEventConditions(trigger, world, { scriptedEventState, playerPolities });
    return {
      outcome: evaluation.matched ? "fired" : "skipped",
      mode,
      date: text(event?.date),
      reason: evaluation.reason,
      event,
    };
  }

  return {
    outcome: "skipped",
    mode: mode || "invalid",
    date: text(event?.date),
    reason: "unsupported trigger mode",
    event,
  };
};

const selectWeightedOutcome = (event, random) => {
  const outcomes = array(event?.outcomes)
    .map((entry) => ({ ...entry, weight: Math.max(0, Number(entry?.weight) || 0) }))
    .filter((entry) => text(entry?.id) && text(entry?.text) && entry.weight > 0);
  if (!outcomes.length) return { error: "no eligible positive-weight outcomes" };
  const weights = Object.fromEntries(outcomes.map((entry) => [text(entry.id), entry.weight]));
  const total = outcomes.reduce((sum, entry) => sum + entry.weight, 0);
  if (!(total > 0)) return { error: "outcome weights total zero" };
  const sample = Number(random?.());
  const roll = Number.isFinite(sample) ? Math.max(0, Math.min(0.999999999999, sample)) : 0.5;
  let cursor = roll * total;
  let selected = outcomes[outcomes.length - 1];
  for (const outcome of outcomes) {
    cursor -= outcome.weight;
    if (cursor < 0) { selected = outcome; break; }
  }
  return { selected, roll, weights };
};

const eventWithSelectedOutcome = (event, resolution) => {
  const selectedId = text(resolution?.selectedOutcomeId);
  if (!selectedId) return event;
  const selected = array(event?.outcomes).find((entry) => text(entry?.id) === selectedId);
  if (!selected) return event;
  return {
    ...event,
    title: text(selected.title) || text(event?.title),
    text: text(selected.text) || text(event?.text),
    selectedOutcomeId: selectedId,
    parentText: text(event?.text),
  };
};

// Planning is deliberately side-effect free with respect to the persisted save.
// `pendingState` is an ephemeral held-turn cache: a failed segment can be retried
// without rerolling Chance or re-evaluating a Conditional event. Only a segment
// that was accepted is committed by commitScriptedEventPlan below.
export const planScriptedEvents = (eventsInput, {
  world = {},
  resolvedState = {},
  pendingState = {},
  playerPolities = null,
  random = Math.random,
} = {}) => {
  const resolved = normalizeScriptedEventState(resolvedState);
  const pending = { ...record(pendingState) };
  const resolutions = [];
  const eligible = [];

  for (const event of array(eventsInput)) {
    const id = text(event?.id);
    if (!id || resolved[id]) continue;

    let resolution = pending[id];
    if (!resolution || !["fired", "skipped"].includes(lower(resolution.outcome))) {
      const stateForConditions = resolvedScriptedState(resolved, pending);
      resolution = resolutionFor(event, world, random, stateForConditions, playerPolities);
      if (resolution.outcome === "fired" && array(event?.outcomes).length) {
        const branch = selectWeightedOutcome(event, random);
        if (branch.error) {
          resolution = { ...resolution, outcome: "skipped", reason: branch.error };
        } else {
          resolution = {
            ...resolution,
            selectedOutcomeId: text(branch.selected.id),
            outcomeRoll: branch.roll,
            effectiveWeights: branch.weights,
          };
        }
      }
      pending[id] = {
        outcome: resolution.outcome,
        mode: resolution.mode,
        date: resolution.date,
        ...(Number.isFinite(resolution.roll) ? { roll: resolution.roll } : {}),
        ...(Number.isFinite(resolution.percent) ? { percent: resolution.percent } : {}),
        ...(text(resolution.selectedOutcomeId) ? { selectedOutcomeId: text(resolution.selectedOutcomeId) } : {}),
        ...(Number.isFinite(resolution.outcomeRoll) ? { outcomeRoll: resolution.outcomeRoll } : {}),
        ...(resolution.effectiveWeights ? { effectiveWeights: resolution.effectiveWeights } : {}),
      };
    } else {
      resolution = { ...resolution, event };
    }

    const withEvent = { ...resolution, event };
    resolutions.push(withEvent);
    if (withEvent.outcome === "fired") eligible.push(eventWithSelectedOutcome(event, withEvent));
  }

  return { eligible, resolutions, pendingState: pending };
};

const SCRIPTED_DEPENDENCY_TYPES = new Set([
  "scripted_event_fired",
  "scripted_event_skipped",
  "scripted_outcome_selected",
  "scripted_outcome_not_selected",
]);

const referencedScriptedEventIds = (event) => {
  const conditions = array(event?.trigger?.conditions);
  const refs = [];
  for (const cond of conditions) {
    if (SCRIPTED_DEPENDENCY_TYPES.has(lower(cond?.type))) {
      const targetId = text(cond?.eventId);
      if (targetId) refs.push(targetId);
    }
  }
  return refs;
};

// When native outcome validation skips one or more beats in the current segment
// due to world-state drift, re-evaluate any same-segment beats whose conditions
// depend on scripted_event_* / scripted_outcome_* for those beats while
// preserving all unrelated cached pending rolls (and reusing cached dependent
// rolls from `preservedPending` whenever their referenced outcomes & branches match).
export const replanAfterSkippedScriptedBeats = (eventsInput, plan, skippedEntries, {
  world = {},
  resolvedState = {},
  playerPolities = null,
  random = Math.random,
  preservedPending = null,
} = {}) => {
  const skipped = array(skippedEntries);
  if (!skipped.length) return plan;
  const skippedMap = new Map(
    skipped
      .map((entry) => [text(entry?.beat?.id), text(entry?.reason)])
      .filter(([id]) => Boolean(id)),
  );
  if (!skippedMap.size) return plan;

  const events = array(eventsInput);
  const preserved = record(preservedPending);
  const nextPending = { ...record(plan?.pendingState) };
  for (const [beatId, reason] of skippedMap.entries()) {
    const { selectedOutcomeId: _droppedBranch, ...rest } = record(nextPending[beatId]);
    nextPending[beatId] = { ...rest, outcome: "skipped", reason };
  }

  // Phase 1: collect the complete transitive set of dependent event IDs first
  // so out-of-order multi-dependency beats never read stale upstream state.
  const dirty = new Set(skippedMap.keys());
  let changed = true;
  while (changed) {
    changed = false;
    for (const event of events) {
      const id = text(event?.id);
      if (!id || dirty.has(id)) continue;
      if (referencedScriptedEventIds(event).some((refId) => dirty.has(refId))) {
        dirty.add(id);
        changed = true;
      }
    }
  }

  // Clear every non-skipped dirty entry before Phase 2 so out-of-order beats
  // never observe stale pre-replan upstream outcomes from `plan.pendingState`.
  for (const id of dirty) {
    if (!skippedMap.has(id)) delete nextPending[id];
  }

  // Phase 2: iteratively restore dependent entries from preservedPending
  // whenever every referenced beat resolves to the same outcome AND
  // selectedOutcomeId. Running to fixpoint handles out-of-order chains.
  let restored = true;
  while (restored) {
    restored = false;
    for (const event of events) {
      const id = text(event?.id);
      if (!id || !dirty.has(id) || skippedMap.has(id) || nextPending[id]) continue;
      const refs = referencedScriptedEventIds(event);
      const preservedEntry = preserved[id];
      const depsMatchPreserved = Boolean(preservedEntry)
        && ["fired", "skipped"].includes(lower(preservedEntry.outcome))
        && refs.every((refId) => {
          const currentEntry = nextPending[refId] || resolvedState?.[refId];
          const savedEntry = preserved[refId] || resolvedState?.[refId];
          const currentOutcome = lower(currentEntry?.outcome);
          const savedOutcome = lower(savedEntry?.outcome);
          if (!currentOutcome || currentOutcome !== savedOutcome) return false;
          const currentBranch = currentOutcome === "fired" ? text(currentEntry?.selectedOutcomeId) : "";
          const savedBranch = savedOutcome === "fired" ? text(savedEntry?.selectedOutcomeId) : "";
          return currentBranch === savedBranch;
        });
      if (depsMatchPreserved) {
        nextPending[id] = { ...preservedEntry };
        restored = true;
      }
    }
  }

  return planScriptedEvents(events, {
    world,
    resolvedState,
    pendingState: nextPending,
    playerPolities,
    random,
  });
};

export const commitScriptedEventPlan = (resolvedState, plan, { throughDate = "" } = {}) => {
  const state = normalizeScriptedEventState(resolvedState);
  const through = dateKey(throughDate);
  const fired = [];
  const skipped = [];

  for (const resolution of array(plan?.resolutions)) {
    const event = resolution?.event;
    const id = text(event?.id);
    const eventKey = dateKey(event?.date);
    if (!id || eventKey === null || through === null || eventKey > through || state[id]) continue;

    const persisted = {
      outcome: resolution.outcome === "fired" ? "fired" : "skipped",
      mode: lower(resolution.mode || event?.trigger?.mode || "always"),
      date: text(event?.date),
      resolvedDate: text(event?.date),
      ...(Number.isFinite(resolution.roll) ? { roll: resolution.roll } : {}),
      ...(Number.isFinite(resolution.percent) ? { percent: resolution.percent } : {}),
      ...(text(resolution.selectedOutcomeId) ? { selectedOutcomeId: text(resolution.selectedOutcomeId) } : {}),
      ...(Number.isFinite(resolution.outcomeRoll) ? { outcomeRoll: resolution.outcomeRoll } : {}),
      ...(resolution.effectiveWeights ? { effectiveWeights: resolution.effectiveWeights } : {}),
    };
    state[id] = persisted;
    if (persisted.outcome === "fired") fired.push(eventWithSelectedOutcome(event, resolution));
    else skipped.push(event);
  }

  return { state, fired, skipped };
};
