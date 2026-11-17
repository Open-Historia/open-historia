// Native continuity gate for scenario-defined National Stats. An AI may judge
// values when there is new target-country canon, but elapsed time alone does
// not authorize rewriting an established sheet.
const clean = (value) => String(value ?? "").trim();
const array = (value) => Array.isArray(value) ? value : [];
const MAX_EVIDENCE_IDS = 96;
const MAX_NEW_EVIDENCE = 12;

const hash = (value) => {
  let n = 2166136261;
  for (const ch of String(value)) {
    n = Math.imul(n ^ ch.charCodeAt(0), 16777619);
  }
  return (n >>> 0).toString(36);
};

// `concernsTarget(event)`: whether the event is about the country, by its
// structure (statsEventEvidence.js eventConcernsTarget): the parties its
// operations name, its combatants, its places, the player's own events. Never
// its words.
export const buildCustomStatContinuity = ({
  events = [], prior = null, currentState = {}, concernsTarget = () => false,
} = {}) => {
  const eligible = [];
  for (const event of array(events)) {
    const id = clean(event?.id);
    if (!id) continue;
    if (!concernsTarget(event)) continue;
    eligible.push(event);
  }
  const tracked = eligible.slice(-MAX_EVIDENCE_IDS);
  const priorIds = array(prior?.customStatEvidenceIds).map(clean).filter(Boolean);
  const before = new Set(priorIds);
  const newEvents = tracked.filter((event) => !before.has(clean(event.id)));
  // Consolidation removes old individual events from the live events list.
  // Never mistake that compaction for a reversal of country conditions.
  const ids = [...new Set([...priorIds, ...tracked.map((event) => clean(event.id))])].slice(-MAX_EVIDENCE_IDS);
  const fingerprint = `custom-stats-v1-${hash(JSON.stringify({ ids, state: currentState }))}`;
  return {
    fingerprint,
    evidenceIds: ids,
    freshEvents: newEvents.slice(-MAX_NEW_EVIDENCE),
    newEventCount: newEvents.length,
  };
};

// The old baseline wins on the first observation of this new native contract.
// Importing every 2026 event into a July 2029 rating would replay old news,
// whereas preserving the assessed values and sealing their current evidence is
// a lossless continuity migration. The explicit hard-audit switch remains.
export const customStatRefreshDecision = ({
  previousValues = {}, requiredKeys = [], prior = null, current = null, hardAudit = false,
} = {}) => {
  if (hardAudit) return { regenerate: true, reason: "authorized-hard-audit" };
  if (!requiredKeys.length || requiredKeys.some((key) => !Object.hasOwn(previousValues, key))) {
    return { regenerate: true, reason: "incomplete-baseline" };
  }
  if (!clean(prior?.customStatFingerprint)) return { regenerate: false, migrate: true, reason: "legacy-baseline" };
  if (prior.customStatFingerprint === current?.fingerprint) {
    return { regenerate: false, migrate: false, reason: "unchanged-canonical-evidence" };
  }
  return { regenerate: true, reason: "changed-canonical-evidence" };
};

export const describeFreshCustomStatEvidence = (events, { maxChars = 4400 } = {}) => {
  let remaining = Math.max(500, maxChars);
  const out = [];
  for (const event of array(events)) {
    const text = `- [${clean(event?.id)}] ${clean(event?.date)}: ${clean(event?.title)} — ${clean(event?.description).slice(0, 360)}`;
    if (text.length + 1 > remaining) break;
    out.push(text);
    remaining -= text.length + 1;
  }
  return out.join("\n") || "No new event text in this bounded window; evaluate only the newly changed canonical state.";
};
