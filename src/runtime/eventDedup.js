/*! Open Historia — timeline event de-duplication © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Why this exists: every jump the model is shown the running timeline as context
// (recentEvents / campaignHistory in promptContext.js) and, unless told otherwise,
// RESTATES events it already reported. Each restatement comes back as a NEW event
// object with a freshly-minted random id (generateId in gameState.js uses
// Date.now()+random), so an id-based de-dup can never match it — and the timeline
// ends up showing the "same" event over and over. De-dup on the event's CONTENT.
//
// Pure and dependency-free on purpose: the concat that creates the duplicates lives
// in shared client code ABOVE both the server and the in-browser stores, and this
// helper is unit-tested directly (eventDedup.test.js) without pulling in the
// browser-only asset layer that gameState.js imports.

const norm = (value) => String(value ?? "").trim();

// A stable content key. Only an EXACT restatement (same date AND title AND
// description) collides, so genuinely distinct events that merely share a date or a
// title are always kept — this can never drop real history, only literal repeats.
// Kept on purpose under the rule against text heuristics: a restatement has no
// id that could know it (the model mints a fresh one, and the round's ids are
// given after this runs: eventIdentity.js), and the key is whole texts equal
// but for case and the spaces around them, never a likeness or a word list, so
// it treats every language alike.
export const eventContentKey = (event) =>
  `${norm(event?.date)}\u0000${norm(event?.title).toLowerCase()}\u0000${norm(event?.description).toLowerCase()}`;

// Explicitly-authored transactions (notably the GM Console) need a stronger
// identity than visible prose. A correction can intentionally reuse the same
// date/title/description while changing canonical effects; treating that as a
// duplicate would reject the correction and the events write choke-point would
// otherwise silently remove it. Object key order is normalized so equivalent
// structured effects still compare equal. This key is NOT used by ordinary AI
// anti-repetition de-duplication, which deliberately remains prose-based.
const stableSerialize = (value) => {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

export const eventCanonicalKey = (event) => {
  const combatants = Array.isArray(event?.combatants)
    ? [...event.combatants].map((value) => norm(value).toLowerCase()).filter(Boolean).sort()
    : [];
  return `${eventContentKey(event)}\u0000${stableSerialize({
    impacts: event?.impacts && typeof event.impacts === "object" ? event.impacts : null,
    warId: norm(event?.warId).toLowerCase(),
    combatants,
  })}`;
};


// Keep only the generated events that are NOT a restatement of an event already in
// `baseEvents` (the pre-turn log) or of an earlier event in the same batch.
export const dedupeGeneratedEvents = (baseEvents, generatedEvents, { keyOf = eventContentKey } = {}) => {
  const seen = new Set((Array.isArray(baseEvents) ? baseEvents : []).map((event) => keyOf(event)));
  const fresh = [];
  for (const event of Array.isArray(generatedEvents) ? generatedEvents : []) {
    const key = keyOf(event);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(event);
  }
  return fresh;
};

// Collapse exact duplicates within a single log (keeps the first occurrence). The
// choke-point every write funnels through, so no writer can persist a repeating log.
// `keyOf` says what "exact" means: the prose key (default), or eventCanonicalKey
// for a writer whose duplicates are only those with the same structured effects.
export const dedupeEventLog = (events, options) => dedupeGeneratedEvents([], events, options);
