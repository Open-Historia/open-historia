/*! Open Historia — exact queued-order outcome attribution © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A queued Action is resolved only by a retained event that carries its stable
// id in impacts.actionIds (playerFocus.js). Models sometimes write the outcome
// in perfectly good prose but omit that small reference. Native code must not
// guess from words: this module gives the semantic review a bounded list of
// exact action ids and candidate event indexes, then validates/applies only the
// exact pairings it returns.

import { eventContentKey } from "../../runtime/eventDedup.js";
import { actionNeedsEvent } from "./playerFocus.js";

const text = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

export const ACTION_OUTCOME_ASSOCIATION_TOOL = "submit_action_outcome_associations";

export const ACTION_OUTCOME_ASSOCIATION_SCHEMA = Object.freeze({
  type: "object",
  description: "Exact links between queued player orders and candidate events that genuinely give those orders an outcome.",
  properties: {
    associations: {
      type: "array",
      maxItems: 80,
      items: {
        type: "object",
        properties: {
          actionId: { type: "string", minLength: 1, description: "Copy one queued action id exactly." },
          eventIndex: { type: "integer", minimum: 0, description: "Zero-based candidate event index shown in the job." },
        },
        required: ["actionId", "eventIndex"],
        additionalProperties: false,
      },
    },
  },
  required: ["associations"],
  additionalProperties: false,
});

const citedActionIds = (events) => new Set(
  list(events)
    .flatMap((event) => list(event?.impacts?.actionIds))
    .map(text)
    .filter(Boolean),
);

export const pendingOutcomeActions = (actions, events) => {
  const cited = citedActionIds(events);
  return list(actions).filter((action) => {
    const id = text(action?.id);
    return text(action?.status) === "planned" && id && actionNeedsEvent(action) && !cited.has(id);
  });
};

const actionLabel = (action) => text(action?.text) || text(action?.title) || "(untitled order)";

export const buildActionOutcomeAssociationPlan = ({ actions, events, maxEvents = 60 } = {}) => {
  const candidates = list(events).slice(0, Math.max(0, Number(maxEvents) || 0)).map((event, index) => ({
    index,
    key: eventContentKey(event),
    event,
  }));
  const pendingActions = pendingOutcomeActions(actions, events);
  if (!pendingActions.length || !candidates.length) return null;

  const orderBlock = pendingActions.map((action) => `- [${text(action.id)}] ${actionLabel(action)}`).join("\n");
  const eventBlock = candidates.map(({ event, index }) => {
    const existing = list(event?.impacts?.actionIds).map(text).filter(Boolean);
    return [
      `[${index}] ${text(event?.date) || "undated"} — ${text(event?.title) || "(untitled)"}`,
      text(event?.description),
      existing.length ? `Already cites: ${existing.join(", ")}` : "Already cites: none",
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  const prompt = [
    "[QUEUED ORDER OUTCOME ATTRIBUTION]",
    "The timeline candidates below have already been written. Some current queued player orders still have no exact actionId citation.",
    "Your only job is to identify which candidate event, if any, genuinely gives each listed order an outcome.",
    "",
    "Rules:",
    "- Associate an order only when the event actually answers that exact order: success, partial success, delay, refusal/failure, or the concrete launch/beginning of a longer operation all count.",
    "- A topical mention, adjacent development, intention, plan, or unrelated event does NOT answer an order.",
    "- Do not pretend a whole strategic objective succeeded when the event only says the operation began; the event may still be the valid outcome of the order to begin it.",
    "- One event may answer several orders only when it genuinely answers each one. One order should normally have one outcome event.",
    "- Copy actionId exactly from the queued-order list and eventIndex exactly from the candidate list. Invent neither.",
    "- If no candidate answers an order, omit that order. An unanswered order must remain queued.",
    "- Do not rewrite events, infer new facts, authorize new player policy, or judge whether the player's desired objective ultimately succeeded.",
    "",
    "Queued orders still needing an outcome citation:",
    orderBlock,
    "",
    "Candidate events:",
    eventBlock,
    "",
    `Return {\"associations\":[]} when none of these events answers any listed order.`,
  ].join("\n");

  return {
    pendingActions,
    pendingIds: new Set(pendingActions.map((action) => text(action.id))),
    candidates,
    prompt,
    schema: ACTION_OUTCOME_ASSOCIATION_SCHEMA,
  };
};

// Tool schemas already constrain the shape, but mimicked tool calls and provider
// salvage still reach native code. Keep only exact ids/indexes that were in the
// plan; never repair an id or choose an event by prose here.
export const normalizeActionOutcomeAssociationAnswer = (answer, plan) => {
  if (!plan) return { associations: [], removed: 0 };
  const seenActions = new Set();
  const associations = [];
  let removed = 0;
  for (const row of list(answer?.associations)) {
    const actionId = text(row?.actionId);
    const eventIndex = Number(row?.eventIndex);
    if (!plan.pendingIds.has(actionId)
      || !Number.isInteger(eventIndex)
      || eventIndex < 0
      || eventIndex >= plan.candidates.length
      || seenActions.has(actionId)) {
      removed += 1;
      continue;
    }
    seenActions.add(actionId);
    associations.push({ actionId, eventIndex });
  }
  return { associations, removed };
};

const addActionId = (event, actionId) => {
  const existing = list(event?.impacts?.actionIds).map(text).filter(Boolean);
  if (existing.includes(actionId)) return event;
  return {
    ...event,
    impacts: {
      ...(event?.impacts && typeof event.impacts === "object" ? event.impacts : {}),
      actionIds: [...existing, actionId],
    },
  };
};

// Apply review rows to the raw merged events by the same prose identity used by
// ordinary timeline de-duplication. Candidate event ids are deliberately not
// used: normalization can mint temporary ids more than once before commit.
export const applyActionOutcomeAssociations = ({ events, plan, answer } = {}) => {
  const source = list(events);
  if (!plan) return { events: source, applied: [], removed: 0 };
  const normalized = normalizeActionOutcomeAssociationAnswer(answer, plan);
  const next = [...source];
  const applied = [];

  for (const row of normalized.associations) {
    const candidate = plan.candidates[row.eventIndex];
    if (!candidate) continue;
    const rawIndex = next.findIndex((event) => eventContentKey(event) === candidate.key);
    if (rawIndex < 0) continue;
    next[rawIndex] = addActionId(next[rawIndex], row.actionId);
    applied.push({ ...row, eventTitle: text(next[rawIndex]?.title) });
  }

  return { events: next, applied, removed: normalized.removed };
};

// Exact reference-integrity guard for model-written actionIds. Coverage is NOT
// required here: omission is handled by the bounded semantic association review,
// and an unanswered order intentionally stays queued. Unknown/stale ids, however,
// must never resolve some other queue entry by accident.
export const validateQueuedActionIds = (events, actions, { strict = false } = {}) => {
  const allowed = new Set(list(actions)
    .filter((action) => text(action?.status) === "planned")
    .map((action) => text(action?.id))
    .filter(Boolean));
  const nextEvents = list(events);
  let removed = 0;

  for (let eventIndex = 0; eventIndex < nextEvents.length; eventIndex += 1) {
    const event = nextEvents[eventIndex];
    const impacts = event?.impacts;
    if (!impacts || typeof impacts !== "object" || !Array.isArray(impacts.actionIds)) continue;
    const kept = [];
    for (let idIndex = 0; idIndex < impacts.actionIds.length; idIndex += 1) {
      const id = text(impacts.actionIds[idIndex]);
      if (id && allowed.has(id)) {
        if (!kept.includes(id)) kept.push(id);
        continue;
      }
      if (strict) {
        return {
          events: nextEvents,
          error: `$.events[${eventIndex}].impacts.actionIds[${idIndex}] must be the exact id of a current planned player action; ${JSON.stringify(id || impacts.actionIds[idIndex])} is not one.`,
          removed,
        };
      }
      removed += 1;
    }
    impacts.actionIds = kept;
  }
  return { events: nextEvents, error: "", removed };
};
