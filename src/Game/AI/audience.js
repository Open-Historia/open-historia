/*! Open Historia — who is looking © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// An audience is who a prompt, a lookup or a transcript is being put together
// FOR. There are only two kinds:
//
//   simulation  the narrator. It resolves what actually happened across the whole
//               world, so it sees everything: every chat, every agent, every
//               secret. The jump, the consolidator and the curator are this.
//
//   viewer      one or more polities, and nothing they could not know. A leader
//               speaking as Angola is a viewer of ["Angola"]. The player's advisor
//               is a viewer of the player's polity.
//
// chatVisibility.js introduced the idea for one thing (which chats a leader has
// read) after a field report in which Angola quoted the player's private letter
// to Nigeria. This is the same rule as a value that can be passed around, so the
// next thing that needs it — a lookup function, a report's distribution list — asks
// the same question the same way instead of growing a private copy of it.
//
// TWO RULES, both inherited from that module and both deliberate:
//
//   1. FAIL CLOSED. Whatever cannot be placed is hidden from a viewer. The cost of
//      wrongly hiding something is a leader that forgets a conversation, which is
//      visible and recoverable. The cost of wrongly showing it is the breach.
//
//   2. THE NARRATOR IS SAID OUT LOUD. There is no "blank means everything" here. A
//      caller that wants everything passes SIMULATION_AUDIENCE. normalizeAudience
//      does accept a blank for callers that predate this module (chatVisibility's
//      documented opt-out), but it is the only place that does, and new code
//      should never rely on it.
//
// Import-free on purpose: this decides what one government may know about
// another, and it has to be testable under bare node.

const clean = (value) => String(value ?? "").trim();
const fold = (value) => clean(value).toLowerCase();

export const SIMULATION_AUDIENCE = Object.freeze({ kind: "simulation" });

// One or more polities looking at the world together. Blank names are dropped and
// duplicates collapse case-insensitively; a viewer of nobody sees only what is
// public.
export const viewerAudience = (polities) => {
  const seen = new Set();
  const names = [];
  for (const entry of Array.isArray(polities) ? polities : [polities]) {
    const name = clean(typeof entry === "object" && entry ? entry.name ?? entry.code : entry);
    if (!name || seen.has(fold(name))) continue;
    seen.add(fold(name));
    names.push(name);
  }
  return Object.freeze({ kind: "viewer", polities: Object.freeze(names) });
};

export const isSimulationAudience = (audience) => audience?.kind === "simulation";

export const audiencePolities = (audience) =>
  (audience?.kind === "viewer" && Array.isArray(audience.polities) ? [...audience.polities] : []);

// Accepts what callers already have in hand: an audience, a polity name, a list of
// names, or nothing. "Nothing" is the narrator ONLY because chatVisibility.js
// documented a blank polity as its opt-out long before this existed; see rule 2.
export const normalizeAudience = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value.kind === "simulation") return SIMULATION_AUDIENCE;
    if (value.kind === "viewer") return viewerAudience(value.polities);
  }
  if (Array.isArray(value)) return viewerAudience(value);
  return clean(value) ? viewerAudience([value]) : SIMULATION_AUDIENCE;
};

/**
 * Does one participant entry refer to `polity`?
 *
 * Participants are stored as a bare name or as `{ code, name }`, and neither is
 * canonicalised on the way in, so either spelling counts. A blank polity never
 * matches — otherwise every unnamed participant would match everything.
 */
export const polityMatches = (entry, polity) => {
  const wanted = fold(polity);
  if (!wanted || !entry) return false;
  if (typeof entry === "string") return fold(entry) === wanted;
  if (typeof entry !== "object") return false;
  return fold(entry.name) === wanted || fold(entry.code) === wanted;
};

// Is any polity of this audience among `participants`?
export const audienceAmong = (audience, participants) => {
  if (isSimulationAudience(audience)) return true;
  const list = Array.isArray(participants) ? participants : [];
  return audiencePolities(audience).some((polity) => list.some((entry) => polityMatches(entry, polity)));
};

// Does this audience speak for `polity`?
export const audienceIncludes = (audience, polity) =>
  isSimulationAudience(audience) || audiencePolities(audience).some((name) => polityMatches(polity, name));

/**
 * May this audience read this chat?
 *
 * A chat's `countries` lists its NON-PLAYER participants; the player is in every
 * chat implicitly, so a viewer that includes the player reads them all. A chat
 * with no recorded participants is hidden from every other viewer (rule 1).
 */
export const audienceSeesChat = (audience, chat, { player = "" } = {}) => {
  if (isSimulationAudience(audience)) return true;
  if (clean(player) && audienceIncludes(audience, player)) return true;
  return audienceAmong(audience, chat?.countries);
};

/**
 * May this audience see something carrying a distribution list?
 *
 * `visibleTo` undefined or null means PUBLIC. An empty list means nobody but the
 * narrator — a document that exists and that no government has read. Anything
 * that is not a list is malformed, and hidden (rule 1).
 */
export const audienceSeesScoped = (audience, visibleTo) => {
  if (isSimulationAudience(audience)) return true;
  if (visibleTo === undefined || visibleTo === null) return true;
  if (!Array.isArray(visibleTo)) return false;
  return audienceAmong(audience, visibleTo);
};

/**
 * What this audience may know about one agent, or null when it may know nothing.
 *
 * An intelligence service knows its own people — but not that one of them has
 * been turned, which is the whole point of turning one: a turned or discovered
 * agent still reads as "active" to its owner until the owner comes to suspect it,
 * and the cover story it is being fed is never labelled as one. The country an
 * agent works in knows only the agents it has caught: discovered, turned or
 * exposed. An undetected agent is invisible to everyone but its owner and the
 * narrator.
 */
const KNOWN_TO_TARGET = new Set(["discovered", "turned", "exposed"]);
export const spyAsSeenBy = (audience, spy) => {
  if (!spy || typeof spy !== "object") return null;
  if (isSimulationAudience(audience)) return spy;
  const status = clean(spy.status) || "active";
  if (audienceIncludes(audience, spy.owner)) {
    const compromised = status === "turned" || status === "discovered";
    const { coverStory: _coverStory, turnedAt: _turnedAt, ...own } = spy;
    return { ...own, status: compromised ? "active" : status, suspected: spy.suspected === true };
  }
  if (audienceIncludes(audience, spy.target) && KNOWN_TO_TARGET.has(status)) return spy;
  return null;
};
