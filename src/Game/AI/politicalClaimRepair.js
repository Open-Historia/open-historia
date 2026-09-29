/*! Open Historia — bounded Political World claim repair © 2026 OpenHistoria contributors, AGPL-3.0-or-later (see LICENSE). */
// A timeline event may be a perfectly usable piece of simulated history while
// its Political World write is incomplete. This module keeps that distinction
// explicit: the AI is allowed to decide/invent a plausible political outcome,
// but native code owns whether the returned operations are legal canonical
// mutations. A repair may COMPLETE the already-authored outcome; it may never
// rewrite the event or silently invent a different native outcome.

import {
  getPoliticalProfile,
  getPoliticalProfileKey,
  normalizePoliticalActorRecord,
  normalizePoliticalActors,
  normalizePoliticalParty,
  normalizePoliticalPowerBloc,
  resolvePoliticalParty,
  resolvePoliticalPowerBloc,
} from "../../runtime/politicalActors.js";
import {
  applyPoliticalActorOperation,
  POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE,
  validatePoliticalActorOperationShape,
} from "../../runtime/politicalActorOps.js";
import { buildPoliticalDecisionContext } from "./politicalDecisionContext.js";
import {
  politicalCompletenessRowsForEvent,
  validatePoliticalImpactCompleteness,
} from "./politicalImpactCompleteness.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const lower = (value) => clean(value).toLocaleLowerCase();
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const GENERATED_STRUCTURAL_OPS = Object.freeze([
  "set-government",
  "form-coalition",
  "leave-coalition",
  "replace-leader",
  "set-political-system",
  "create-party",
  "update-party",
  "set-party-support",
  "set-party-influence",
  "set-party-leader",
  "create-power-bloc",
  "update-power-bloc",
  "set-power-bloc-influence",
  "set-strategy",
  "set-traits",
]);

const PARTY_OPS = Object.freeze([
  "create-party",
  "update-party",
  "set-party-support",
  "set-party-influence",
  "set-party-leader",
  "create-power-bloc",
  "update-power-bloc",
  "set-power-bloc-influence",
]);

const EFFECT_ALLOWED_OPS = Object.freeze({
  election: Object.freeze([
    ...PARTY_OPS,
    "set-government",
    "form-coalition",
    "leave-coalition",
    "replace-leader",
    "set-political-system",
    "set-strategy",
    "set-traits",
  ]),
  government: Object.freeze(["set-government", "form-coalition", "leave-coalition", "replace-leader"]),
  coalition: Object.freeze(["form-coalition", "leave-coalition", "set-government"]),
  leadership: Object.freeze(["replace-leader", "set-government", "set-party-leader"]),
  system: Object.freeze(["set-political-system", "set-government"]),
  parties: PARTY_OPS,
});

const repairOpSchema = {
  type: "object",
  properties: {
    op: { type: "string", enum: GENERATED_STRUCTURAL_OPS },
    polityKey: { type: "string" },
    argsJson: { type: "string" },
  },
  required: ["op", "polityKey", "argsJson"],
  additionalProperties: false,
};

export const POLITICAL_CLAIM_REPAIR_TOOL = Object.freeze({
  name: "submit_political_claim_repair",
  description: "Complete only the canonical Political Actor operations needed to make the supplied already-authored political events true.",
  schema: {
    type: "object",
    properties: {
      eventRepairs: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            eventNumber: { type: "integer", minimum: 1 },
            politicalActorOps: { type: "array", maxItems: 32, items: repairOpSchema },
            reason: { type: "string" },
          },
          required: ["eventNumber", "politicalActorOps", "reason"],
          additionalProperties: false,
        },
      },
      summary: { type: "string" },
    },
    required: ["eventRepairs", "summary"],
    additionalProperties: false,
  },
});

const targetRowsForEvent = (claimContext, event) => politicalCompletenessRowsForEvent(claimContext, event)
  .map((row) => ({
    polityKey: clean(row?.polityKey),
    effects: [...new Set(list(row?.effects).map((effect) => lower(effect)).filter(Boolean))],
  }))
  .filter((row) => row.polityKey && row.effects.length);

export const collectPoliticalClaimRepairTargets = (candidate, claimContext, { eventNumbers = null } = {}) => {
  if (claimContext?.mode !== "structured") return [];
  const selected = Array.isArray(eventNumbers) && eventNumbers.length
    ? new Set(eventNumbers.map((value) => Number(value)).filter(Number.isSafeInteger))
    : null;
  return list(candidate?.events).map((event, index) => {
    if (selected && !selected.has(index + 1)) return null;
    const claims = targetRowsForEvent(claimContext, event);
    if (!claims.length) return null;
    return {
      eventNumber: index + 1,
      event,
      claims,
      allowedPolities: [...new Set(claims.map((row) => row.polityKey))],
      allowedOpsByPolity: Object.fromEntries(claims.map((row) => [
        lower(row.polityKey),
        [...new Set(row.effects.flatMap((effect) => EFFECT_ALLOWED_OPS[effect] || []))],
      ])),
    };
  }).filter(Boolean);
};

const officeholderName = (value) => {
  if (typeof value === "string") return clean(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return clean(value.name || value.id);
};

const compactParty = (party) => ({
  id: clean(party?.id),
  name: clean(party?.name),
  ...(clean(party?.ideology) ? { ideology: clean(party.ideology) } : {}),
  ...(Number.isFinite(Number(party?.support?.percent)) ? { supportPercent: Number(party.support.percent) } : {}),
  ...(Number.isFinite(Number(party?.influence?.percent)) ? { influencePercent: Number(party.influence.percent) } : {}),
  ...(clean(party?.influence?.label) ? { influenceLabel: clean(party.influence.label) } : {}),
  ...(officeholderName(party?.leader) ? { leader: officeholderName(party.leader) } : {}),
});

const compactBloc = (bloc) => ({
  id: clean(bloc?.id),
  name: clean(bloc?.name),
  ...(clean(bloc?.kind) ? { kind: clean(bloc.kind) } : {}),
  ...(clean(bloc?.status) ? { status: clean(bloc.status) } : {}),
  ...(clean(bloc?.ideology) ? { ideology: clean(bloc.ideology) } : {}),
  ...(Number.isFinite(Number(bloc?.influence?.percent)) ? { influencePercent: Number(bloc.influence.percent) } : {}),
  ...(clean(bloc?.influence?.label) ? { influenceLabel: clean(bloc.influence.label) } : {}),
  ...(officeholderName(bloc?.leader) ? { leader: officeholderName(bloc.leader) } : {}),
});

const actorRepairContext = (world, polityKey, eventText) => {
  const actor = getPoliticalProfile(world, polityKey);
  const decision = buildPoliticalDecisionContext(world, polityKey, {
    decisionFocusText: eventText,
    maxChars: 4400,
    limits: {
      traits: 8,
      goals: 6,
      fears: 6,
      ambitions: 6,
      domesticPressures: 6,
      pressureIssues: 6,
      governingEntities: 8,
      oppositionEntities: 12,
      perceptions: 4,
      relations: 4,
      agreements: 4,
      wars: 3,
      institutions: 6,
      institutionLifecycleCases: 4,
    },
  });
  return {
    polityKey,
    decisionText: clean(decision?.text) || "No mature Political Decision Context exists for this polity yet.",
    registry: actor ? {
      government: clone(actor.government || {}),
      politicalSystem: clone(actor.politicalSystem || {}),
      parties: list(actor.parties).slice(0, 24).map(compactParty),
      powerBlocs: list(actor.powerBlocs).slice(0, 16).map(compactBloc),
      leader: officeholderName(actor.leader),
    } : {
      government: {},
      politicalSystem: {},
      parties: [],
      powerBlocs: [],
      leader: "",
    },
  };
};

export const buildPoliticalClaimRepairRequest = ({ candidate, world, claimContext, validationError = "", validationFailure = null } = {}) => {
  const failedEventIndex = Number.isInteger(validationFailure?.eventIndex) && validationFailure.eventIndex >= 0
    ? validationFailure.eventIndex
    : 0;
  // One bounded repair call should be able to reconcile the whole remaining
  // political portion of the answer, not only the first row the sequential
  // validator happened to report. Events before the first failure already
  // passed against the scratch world and are deliberately left out.
  const remainingEventNumbers = list(candidate?.events)
    .map((_, index) => index >= failedEventIndex ? index + 1 : null)
    .filter(Boolean);
  const targets = collectPoliticalClaimRepairTargets(candidate, claimContext, {
    eventNumbers: remainingEventNumbers,
  }).slice(0, 12);
  if (!targets.length) return { targets: [], systemPrompt: "", userMessage: "" };

  const contexts = new Map();
  for (const target of targets) {
    const eventText = `${clean(target.event?.title)}\n${clean(target.event?.description)}`.trim();
    for (const polityKey of target.allowedPolities) {
      const key = lower(polityKey);
      if (!contexts.has(key)) contexts.set(key, actorRepairContext(world, polityKey, eventText));
    }
  }

  const systemPrompt = [
    "You are OpenHistoria's BOUNDED POLITICAL WORLD CLAIM REPAIR.",
    "The timeline events below are already authored by the simulator. DO NOT rewrite, replace, soften, delete, or add events. Your only job is to return Political Actor operations that make their declared political outcome canonical.",
    "",
    "CREATIVE AUTHORITY: you ARE allowed to complete a plausible political outcome when the fixed event establishes that a transition happened but omits the exact coalition, cabinet composition, or successor. Use the supplied CURRENT Political World - party support/influence, leaders, blocs, pressures, system and government - to make that political choice. A democracy may form a plausible coalition from its real canonical parties. A succession may introduce a newly chosen/named officeholder when the event establishes that someone takes office. This is still AI simulation; native code will validate what you decide.",
    "",
    "CANONICAL BOUNDARY: existing parties and power blocs MUST be reused by their exact stable ids from the supplied registry. Do not mint replacement parties merely to form a government. Create/update party or bloc state only when the event's declared effects actually include an election/party-landscape change. A newly chosen officeholder does not need to pre-exist as a separate entity: replace-leader may establish that person by name. Do not invent a structural change unrelated to the declared effects.",
    "",
    "TRANSACTION RULE: preserve every already-present valid politicalActorOp. Return ONLY missing/supporting operations for the numbered event. Do not return map, war, diplomacy, institution, Stats, project, unit, chat, storyline, or prose edits. If the supplied evidence cannot support a coherent completion, return no operations for that event; the engine will hold the turn rather than invent canon in native code.",
    "",
    "Use the exact native argsJson shapes below. argsJson itself is a JSON OBJECT SERIALIZED AS A STRING.",
    POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE,
    "",
    `Call ${POLITICAL_CLAIM_REPAIR_TOOL.name} exactly once.`,
  ].join("\n");

  const eventBlocks = targets.map((target) => {
    const event = target.event || {};
    return [
      `EVENT ${target.eventNumber}`,
      `Date: ${clean(event.date) || "unspecified"}`,
      `Title: ${clean(event.title) || "Untitled"}`,
      `Description: ${clean(event.description) || "(none)"}`,
      `Declared/derived Political World effects: ${target.claims.map((row) => `${row.polityKey}=[${row.effects.join(",")}]`).join("; ")}`,
      `Existing politicalActorOps (preserve): ${JSON.stringify(list(event?.impacts?.politicalActorOps))}`,
    ].join("\n");
  });

  const contextBlocks = [...contexts.values()].map((entry) => [
    `POLITY: ${entry.polityKey}`,
    entry.decisionText,
    "Exact canonical entity registry for references:",
    JSON.stringify(entry.registry, null, 2),
  ].join("\n"));

  const userMessage = [
    `VALIDATION FAILURE TO REPAIR:\n${clean(validationError) || "Political World completeness validation failed."}`,
    "",
    "FIXED EVENTS:",
    ...eventBlocks,
    "",
    "CURRENT POLITICAL WORLD:",
    ...contextBlocks,
    "",
    "Return only the smallest coherent operation set needed to make these fixed events and their declared effects true in canonical Political World state.",
  ].join("\n\n");

  return { targets, systemPrompt, userMessage };
};

const targetByNumber = (targets) => new Map(targets.map((target) => [target.eventNumber, target]));

const parseArgs = (packed) => {
  const raw = clean(packed?.argsJson);
  if (!raw) return { error: "argsJson is blank" };
  try {
    const args = JSON.parse(raw);
    if (!args || typeof args !== "object" || Array.isArray(args)) return { error: "argsJson must decode to an object" };
    return { args };
  } catch (error) {
    return { error: `argsJson is not valid JSON: ${error?.message || error}` };
  }
};

const samePackedOperation = (left, right) => clean(left?.op) === clean(right?.op)
  && lower(left?.polityKey) === lower(right?.polityKey)
  && clean(left?.argsJson) === clean(right?.argsJson);

const structuralConflictKey = (packed) => {
  const op = lower(packed?.op);
  const polity = lower(packed?.polityKey);
  const parsed = parseArgs(packed);
  const args = parsed.args || {};
  if (op === "replace-leader") return `${polity}|${op}|${lower(args.office)}`;
  if (op === "leave-coalition") return `${polity}|${op}|${lower(args.partyId || args.party)}`;
  if (["set-government", "form-coalition", "set-political-system"].includes(op)) return `${polity}|${op}`;
  return "";
};

const applyRenameIdentity = (world, event) => {
  for (const change of list(event?.impacts?.polityChanges)) {
    const op = lower(change?.operation);
    const from = clean(change?.code);
    const to = clean(change?.name);
    if (!from || !to || lower(from) === lower(to) || !["rename", "restore", "update"].includes(op)) continue;
    const fromKey = getPoliticalProfileKey(world, from);
    if (!fromKey) continue;
    const actor = world?.politicalActors?.byPolity?.[fromKey];
    if (!actor) continue;
    delete world.politicalActors.byPolity[fromKey];
    world.politicalActors.byPolity[to] = normalizePoliticalActorRecord({ ...actor, polityKey: to, name: to }, to);
  }
};

const canonicalizePartyTokens = (actor, values) => {
  const out = [];
  for (const token of list(values)) {
    const party = resolvePoliticalParty(actor, token);
    if (!party?.id) return { error: `Unknown canonical party reference: ${clean(token) || "(blank)"}.` };
    if (!out.includes(party.id)) out.push(party.id);
  }
  return { ids: out };
};

const canonicalizeRepairOperation = (world, operation) => {
  const actor = getPoliticalProfile(world, operation.polityKey);
  const op = clean(operation.op);
  const next = clone(operation);

  if (op === "create-party") {
    const normalized = normalizePoliticalParty(next.party);
    if (normalized) next.party = normalized;
    return { operation: next };
  }
  if (op === "create-power-bloc") {
    const normalized = normalizePoliticalPowerBloc(next.bloc || next.powerBloc);
    if (normalized) {
      delete next.powerBloc;
      next.bloc = normalized;
    }
    return { operation: next };
  }
  if (!actor) return { operation: next };

  if (op === "form-coalition") {
    const ruling = canonicalizePartyTokens(actor, next.rulingPartyIds || next.rulingParties || []);
    if (ruling.error) return ruling;
    const coalition = canonicalizePartyTokens(actor, next.coalitionPartyIds || next.coalitionParties || []);
    if (coalition.error) return coalition;
    delete next.rulingParties;
    delete next.coalitionParties;
    next.rulingPartyIds = ruling.ids;
    next.coalitionPartyIds = coalition.ids.filter((id) => !ruling.ids.includes(id));
  } else if (["leave-coalition", "update-party", "set-party-support", "set-party-influence", "set-party-leader"].includes(op)) {
    const token = next.partyId || next.party;
    const party = resolvePoliticalParty(actor, token);
    if (!party?.id) return { error: `Unknown canonical party reference: ${clean(token) || "(blank)"}.` };
    next.partyId = party.id;
    delete next.party;
  } else if (["update-power-bloc", "set-power-bloc-influence"].includes(op)) {
    const token = next.blocId || next.powerBlocId || next.bloc || next.powerBloc;
    const bloc = resolvePoliticalPowerBloc(actor, token);
    if (!bloc?.id) return { error: `Unknown canonical power-bloc reference: ${clean(token) || "(blank)"}.` };
    next.blocId = bloc.id;
    delete next.powerBlocId;
    delete next.bloc;
    delete next.powerBloc;
  } else if (op === "set-government" && next.patch && typeof next.patch === "object" && !Array.isArray(next.patch)) {
    const patch = { ...next.patch };
    const hasRuling = Object.prototype.hasOwnProperty.call(patch, "rulingPartyIds") || Object.prototype.hasOwnProperty.call(patch, "rulingParties");
    const hasCoalition = Object.prototype.hasOwnProperty.call(patch, "coalitionPartyIds") || Object.prototype.hasOwnProperty.call(patch, "coalition");
    if (hasRuling) {
      const ruling = canonicalizePartyTokens(actor, patch.rulingPartyIds || patch.rulingParties || []);
      if (ruling.error) return ruling;
      patch.rulingPartyIds = ruling.ids;
      delete patch.rulingParties;
    }
    if (hasCoalition) {
      const coalition = canonicalizePartyTokens(actor, patch.coalitionPartyIds || patch.coalition || []);
      if (coalition.error) return coalition;
      patch.coalitionPartyIds = coalition.ids;
      delete patch.coalition;
    }
    next.patch = patch;
  }
  return { operation: next };
};

const packOperation = (operation) => {
  const { op, polityKey, ...args } = operation;
  return { op: clean(op), polityKey: clean(polityKey), argsJson: JSON.stringify(args) };
};

const validateRepairEnvelope = (payload, targets) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "Political claim repair did not return an object.";
  if (!Array.isArray(payload.eventRepairs)) return "Political claim repair is missing eventRepairs[].";
  if (payload.eventRepairs.length > 12) return "Political claim repair returned too many event repairs.";
  const targetMap = targetByNumber(targets);
  const seen = new Set();
  for (const row of payload.eventRepairs) {
    const eventNumber = Number(row?.eventNumber);
    if (!Number.isSafeInteger(eventNumber) || !targetMap.has(eventNumber)) return `Political claim repair references non-target event ${row?.eventNumber ?? "(blank)"}.`;
    if (seen.has(eventNumber)) return `Political claim repair contains duplicate event ${eventNumber}.`;
    seen.add(eventNumber);
    if (!Array.isArray(row?.politicalActorOps)) return `Political claim repair event ${eventNumber} is missing politicalActorOps[].`;
    if (row.politicalActorOps.length > 32) return `Political claim repair event ${eventNumber} returned too many politicalActorOps.`;
  }
  return "";
};

export const applyPoliticalClaimRepairResponse = ({ candidate, world, claimContext, targets, payload } = {}) => {
  const envelopeError = validateRepairEnvelope(payload, targets || []);
  if (envelopeError) return { applied: false, added: 0, error: envelopeError };

  const targetMap = targetByNumber(targets || []);
  const repairs = new Map(list(payload?.eventRepairs).map((row) => [Number(row.eventNumber), row]));
  const sourceEvents = list(candidate?.events);
  const stagedEvents = sourceEvents.map((event) => ({
    ...event,
    impacts: {
      ...(event?.impacts && typeof event.impacts === "object" && !Array.isArray(event.impacts) ? event.impacts : {}),
      politicalActorOps: [...list(event?.impacts?.politicalActorOps)],
    },
  }));
  const stagedCandidate = { ...candidate, events: stagedEvents };
  // claimContext binds legacy/CSE exceptions by event identity. The staged
  // transaction clones events, so mirror that membership onto the clones;
  // otherwise the repair's final all-event validation could accidentally turn a
  // legacy authored beat into a structured no-claim event and skip its fail-closed
  // prose completeness check. Structured claim rows themselves survive shallow
  // cloning through their enumerable symbol binding.
  const stagedClaimContext = claimContext && typeof claimContext === "object"
    ? {
        ...claimContext,
        legacyEvents: new Set(stagedEvents.filter((_, index) => claimContext?.legacyEvents?.has?.(sourceEvents[index]))),
      }
    : claimContext;

  const scratch = clone(world || {});
  scratch.politicalActors = normalizePoliticalActors(scratch.politicalActors);
  let added = 0;

  for (let index = 0; index < stagedEvents.length; index += 1) {
    const event = stagedEvents[index];
    applyRenameIdentity(scratch, event);

    // Re-apply every already-accepted operation so references in a later event are
    // resolved against the same Political World state the real turn will have.
    const existing = [...list(event?.impacts?.politicalActorOps)];
    for (const packed of existing) {
      const parsed = parseArgs(packed);
      if (parsed.error) return { applied: false, added: 0, error: `Existing event ${index + 1} Political Actor operation became unreadable during repair: ${parsed.error}` };
      const operation = { ...parsed.args, op: clean(packed?.op), polityKey: clean(packed?.polityKey) };
      const shapeError = validatePoliticalActorOperationShape(operation, { allowNativeDerived: false });
      if (shapeError) return { applied: false, added: 0, error: `Existing event ${index + 1} Political Actor operation is invalid during repair: ${shapeError}` };
      const outcome = applyPoliticalActorOperation(scratch, operation);
      if (!outcome?.applied) return { applied: false, added: 0, error: `Existing event ${index + 1} Political Actor operation was refused during repair: ${clean(outcome?.error) || "native validation refused it"}` };
    }

    const target = targetMap.get(index + 1);
    const row = repairs.get(index + 1);
    if (!target || !row) continue;

    const existingConflictKeys = new Map(existing
      .map((packed) => [structuralConflictKey(packed), packed])
      .filter(([key]) => key));

    for (const packed of list(row.politicalActorOps)) {
      const polityKey = clean(packed?.polityKey);
      const polityLower = lower(polityKey);
      const allowedOps = new Set(target.allowedOpsByPolity?.[polityLower] || []);
      const op = clean(packed?.op);
      if (!target.allowedPolities.some((value) => lower(value) === polityLower)) {
        return { applied: false, added: 0, error: `Repair event ${index + 1} tried to mutate ${polityKey || "(blank)"}, which is outside that event's Political World claim.` };
      }
      if (!allowedOps.has(op)) {
        return { applied: false, added: 0, error: `Repair event ${index + 1} tried ${op || "(blank op)"} for ${polityKey}; that operation is outside the event's declared Political World effects.` };
      }
      if (existing.some((entry) => samePackedOperation(entry, packed))) continue;

      const conflictKey = structuralConflictKey(packed);
      const prior = conflictKey ? existingConflictKeys.get(conflictKey) : null;
      if (prior && !samePackedOperation(prior, packed)) {
        return { applied: false, added: 0, error: `Repair event ${index + 1} tried to overwrite an already-valid ${op} decision for ${polityKey}.` };
      }

      const parsed = parseArgs(packed);
      if (parsed.error) return { applied: false, added: 0, error: `Repair event ${index + 1} ${op}: ${parsed.error}` };
      const rawOperation = { ...parsed.args, op, polityKey };
      const canonicalized = canonicalizeRepairOperation(scratch, rawOperation);
      if (canonicalized.error) return { applied: false, added: 0, error: `Repair event ${index + 1} ${op}: ${canonicalized.error}` };
      const operation = canonicalized.operation;
      const shapeError = validatePoliticalActorOperationShape(operation, { allowNativeDerived: false });
      if (shapeError) return { applied: false, added: 0, error: `Repair event ${index + 1} ${op}: ${shapeError}` };
      const outcome = applyPoliticalActorOperation(scratch, operation);
      if (!outcome?.applied) {
        return { applied: false, added: 0, error: `Repair event ${index + 1} ${op} was refused: ${clean(outcome?.error) || "native Political Actor validation refused it"}` };
      }
      const canonicalPacked = packOperation(operation);
      event.impacts.politicalActorOps.push(canonicalPacked);
      if (conflictKey) existingConflictKeys.set(conflictKey, canonicalPacked);
      added += 1;
    }
  }

  const remainingError = validatePoliticalImpactCompleteness(stagedCandidate, { world, claimContext: stagedClaimContext });
  if (remainingError) return { applied: false, added: 0, error: `Political claim repair remained incomplete: ${remainingError}` };
  if (added <= 0) return { applied: false, added: 0, error: "Political claim repair returned no new canonical operations." };

  // Commit only after the whole repair transaction passes native validation.
  for (let index = 0; index < sourceEvents.length; index += 1) {
    const source = sourceEvents[index];
    const staged = stagedEvents[index];
    if (!source || !staged) continue;
    const before = list(source?.impacts?.politicalActorOps);
    const after = list(staged?.impacts?.politicalActorOps);
    if (after.length === before.length) continue;
    source.impacts = {
      ...(source.impacts && typeof source.impacts === "object" && !Array.isArray(source.impacts) ? source.impacts : {}),
      politicalActorOps: after,
    };
  }

  return { applied: true, added, error: "", summary: clean(payload?.summary) };
};

export const shouldPreventDeterministicFallback = (error) => Boolean(
  error && error.preventDeterministicFallback === true && error.canonicalIntegrity === "political-world",
);

export const politicalClaimRepairHoldError = (message, { cause = null } = {}) => {
  const detail = clean(message) || "Political World could not be reconciled with the generated political event.";
  const error = new Error(`Political World canonical repair could not complete, so this turn was held instead of advancing on a canned fallback: ${detail}`);
  error.preventDeterministicFallback = true;
  error.canonicalIntegrity = "political-world";
  if (cause) error.cause = cause;
  return error;
};
