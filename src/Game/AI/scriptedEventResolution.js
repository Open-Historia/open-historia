/*! Open Historia — native eligibility and exactly-once resolution for scenario scripted events © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

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
    out[id] = normalized;
  }
  return out;
};

export const evaluateScriptedEventCondition = (conditionInput, world = {}) => {
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
  default:
    return { matched: false, reason: type ? `unsupported condition ${type}` : "missing condition type" };
  }
};

export const evaluateScriptedEventConditions = (triggerInput, world = {}) => {
  const trigger = record(triggerInput);
  const conditions = array(trigger.conditions);
  if (!conditions.length) return { matched: false, matchedCount: 0, requiredCount: 0, results: [], reason: "no conditions" };
  const results = conditions.map((condition) => evaluateScriptedEventCondition(condition, world));
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

const resolutionFor = (event, world, random) => {
  const trigger = record(event?.trigger);
  const mode = lower(trigger.mode || "always");

  if (mode === "rules") {
    const conditions = array(trigger.conditions);
    const evaluation = conditions.length
      ? evaluateScriptedEventConditions(trigger, world)
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
    const evaluation = evaluateScriptedEventConditions(trigger, world);
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

// Planning is deliberately side-effect free with respect to the persisted save.
// `pendingState` is an ephemeral held-turn cache: a failed segment can be retried
// without rerolling Chance or re-evaluating a Conditional event. Only a segment
// that was accepted is committed by commitScriptedEventPlan below.
export const planScriptedEvents = (eventsInput, {
  world = {},
  resolvedState = {},
  pendingState = {},
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
      resolution = resolutionFor(event, world, random);
      pending[id] = {
        outcome: resolution.outcome,
        mode: resolution.mode,
        date: resolution.date,
        ...(Number.isFinite(resolution.roll) ? { roll: resolution.roll } : {}),
        ...(Number.isFinite(resolution.percent) ? { percent: resolution.percent } : {}),
      };
    } else {
      resolution = { ...resolution, event };
    }

    const withEvent = { ...resolution, event };
    resolutions.push(withEvent);
    if (withEvent.outcome === "fired") eligible.push(event);
  }

  return { eligible, resolutions, pendingState: pending };
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
    };
    state[id] = persisted;
    if (persisted.outcome === "fired") fired.push(event);
    else skipped.push(event);
  }

  return { state, fired, skipped };
};
