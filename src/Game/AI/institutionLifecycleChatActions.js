/*! Open Historia Continuum — explicit AI responses to live institution lifecycle cases. */

import { extractJsonArray } from "./jsonSalvage.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLocaleLowerCase().replace(/[\s_]+/g, "-");
const list = (value) => Array.isArray(value) ? value : [];

export const INSTITUTION_LIFECYCLE_CHAT_ACTION = "institution_lifecycle_response";
export const INSTITUTION_LIFECYCLE_RESPONSE_DECISIONS = Object.freeze([
  "accept",
  "reject",
  "seek-observer",
  "request-terms",
  "delay",
]);
const DECISIONS = new Set(INSTITUTION_LIFECYCLE_RESPONSE_DECISIONS);

export const normalizeInstitutionLifecycleChatAction = (entry = {}) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  if (lower(entry.type || entry.action || entry.op).replace(/-/g, "_") !== INSTITUTION_LIFECYCLE_CHAT_ACTION) return null;
  const actorName = clean(entry.actorName || entry.actor || entry.speaker);
  const caseId = clean(entry.lifecycleCaseId || entry.caseId);
  const decision = lower(entry.lifecycleDecision || entry.decision || entry.response);
  if (!actorName || !caseId || !DECISIONS.has(decision)) return null;
  return {
    type: INSTITUTION_LIFECYCLE_CHAT_ACTION,
    actorName,
    caseId,
    decision,
    reason: clean(entry.reason).slice(0, 1200),
    terms: clean(entry.lifecycleTerms || entry.terms || entry.requestedTerms).slice(0, 2400),
  };
};

export const parseInstitutionLifecycleResponsesJson = (raw = "") => {
  // Raw-JSON lifecycle turns may already have a parsed array before the generic
  // chat transport normalizer serializes it. Accept both forms defensively.
  const parsed = Array.isArray(raw) ? raw : extractJsonArray(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry) => normalizeInstitutionLifecycleChatAction({
    ...entry,
    type: INSTITUTION_LIFECYCLE_CHAT_ACTION,
    lifecycleCaseId: entry?.lifecycleCaseId || entry?.caseId,
    lifecycleDecision: entry?.lifecycleDecision || entry?.decision || entry?.response,
    lifecycleTerms: entry?.lifecycleTerms || entry?.terms || entry?.requestedTerms,
  })).filter(Boolean);
};

export const partitionInstitutionLifecycleChatActions = (actions = []) => {
  const lifecycle = [];
  const conversational = [];
  for (const action of list(actions)) {
    const type = lower(action?.type || action?.action || action?.op).replace(/-/g, "_");
    if (type !== INSTITUTION_LIFECYCLE_CHAT_ACTION) {
      conversational.push(action);
      continue;
    }
    const normalized = normalizeInstitutionLifecycleChatAction(action);
    if (normalized) lifecycle.push(normalized);
  }
  return { lifecycle, conversational };
};
