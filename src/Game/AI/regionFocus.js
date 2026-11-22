// Which powers' regions a jump prompt lists BY NAME.
//
// The prompt cannot carry every region of every power (a hand-drawn world has
// nearly five thousand), so it enumerates a few powers in full and gives the
// rest as counts. Until now that few was chosen by accident: the player, then
// whichever owners happened to come first in the save's override map — on the
// Fault Lines world that meant Panama, China, India, Somaliland, France and
// Sweden while the player was fighting Russia over Ukraine, whose regions the
// model therefore had to guess. Guessed names failed to resolve and the
// annexation never reached the map.
//
// This ranks the powers by what the turn is actually about: the player, the
// parties to the player's pending actions, the belligerents of live wars, the
// player's chat partners, the powers the recent events moved or name in their
// structure (combatants, country places), the claimants of contested regions,
// and only then size. Import-free.
//
// Every match here is on a name a record writes, against a name the map
// declares, spelled out in full. Nothing is read from prose: a power's name was
// counted in the orders' and the events' words, which in a game written in
// another language than the map's names counted nothing, and in any language
// counted "the Russian Federation's neighbours" as about it.
//
// A name is its letters, marks and digits in any script. Folded to a-z0-9, a
// power the map names in Cyrillic, Arabic or Chinese had no form to be
// recognised by, and nothing said about it ever weighed.

export const foldName = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();

// The forms under which a power is recognised in prose: the names the map
// declares for it, and nothing else — its owner token, its display name, its
// declared aliases, and the stock country name only when its record declares a
// stock code. Names are standardised: a world that has a "Russian Federation"
// and nothing called "Russia" is not mentioning it when prose says "Russia",
// and a world with both has two different countries. No stems, no prefixes.
export const nameVariants = (label, { displayName = "", aliases = [], stockName = "" } = {}) => {
  const exact = new Set();
  for (const raw of [label, displayName, stockName, ...(Array.isArray(aliases) ? aliases : [])]) {
    const folded = foldName(raw);
    if (folded) exact.add(folded);
  }
  return { exact };
};

// The polities on a war's sides: sideA and sideB as the war ledger writes them
// (runtime/warRecord.js), or the lists of a `sides` object. Never its title or
// its note.
const warSides = (war) => {
  const lists = [war?.sideA, war?.sideB];
  if (war?.sides && typeof war.sides === "object") lists.push(...(Array.isArray(war.sides) ? war.sides : Object.values(war.sides)));
  return lists.flatMap((list) => (Array.isArray(list) ? list : [])).filter((name) => typeof name === "string");
};

// A war that is over (runtime/warRecord.js WAR_STATUSES: active, ceasefire,
// ended), matched exactly.
const warIsOver = (war) => String(war?.status ?? "").trim().toLowerCase() === "ended";

// The polities an event names in its structure besides its operations: its
// combatants and the countries among its places.
const eventParties = (event) => [
  ...(Array.isArray(event?.combatants) ? event.combatants : []),
  ...(Array.isArray(event?.places) ? event.places : [])
    .filter((place) => String(place?.kind ?? "").trim().toLowerCase() === "country")
    .map((place) => place?.name),
].filter((name) => typeof name === "string" && name.trim());

const impactOwners = (impacts) => {
  const names = [];
  const push = (value) => { if (typeof value === "string" && value.trim()) names.push(value); };
  for (const entry of Array.isArray(impacts?.regionTransfers) ? impacts.regionTransfers : []) { push(entry?.fromCode); push(entry?.toCode); }
  for (const entry of Array.isArray(impacts?.regionControlOps) ? impacts.regionControlOps : []) { push(entry?.fromCode); push(entry?.toCode); push(entry?.actorCode); }
  for (const entry of Array.isArray(impacts?.regionClaims) ? impacts.regionClaims : []) { push(entry?.claimantCode); }
  for (const entry of Array.isArray(impacts?.polityChanges) ? impacts.polityChanges : []) { push(entry?.code); push(entry?.name); }
  for (const entry of Array.isArray(impacts?.politicalActorOps) ? impacts.politicalActorOps : []) { push(entry?.polityKey || entry?.polity || entry?.country); }
  for (const entry of Array.isArray(impacts?.unitOps) ? impacts.unitOps : []) { push(entry?.unit?.ownerCode); }
  return names;
};

// An order still waiting for its outcome. Actions carry only a status —
// "planned" until a jump answers them, then "resolved" (playerFocus.js
// settleOrders) — and one saved without a status is planned, as
// normalizeActionEntry reads it. There is no `resolved` flag to test.
export const isPendingAction = (action) =>
  Boolean(action && typeof action === "object")
  && (String(action.status ?? "").trim() || "planned") === "planned";

export const FOCUS_WEIGHTS = Object.freeze({
  player: 1000,
  action: 120,
  war: 90,
  chat: 70,
  eventImpact: 45,
  eventMention: 20,
  claimOnPlayer: 60,
  claimant: 12,
  sizeCap: 15,
  sizeDivisor: 20,
  // What a time skip adds to put the powers it shows in full in view
  // (promptFocus.js): the player's neighbours, its relevant countries (idle
  // diplomacy's: those that had something happen or dealt with the player
  // lately), the powers that changed since the last skip, and the parties to a
  // storyline still running. A relevant country weighs what a neighbour does:
  // the owner asked for it to be shown as a neighbour is.
  neighbour: 50,
  relevant: 50,
  changed: 40,
  storyline: 55,
});

/**
 * Rank the powers whose regions the prompt should list in full.
 *
 *   owners   [{ key, label, regions, displayName?, aliases? }] — one per current
 *            owner, `regions` being how many it holds.
 *   player   the player's polity name.
 *   actions  the save's actions: a planned one weighs its invitees and
 *            participants; resolved ones are ignored.
 *   chats    the save's chats ({ countries: [{ name }] }).
 *   events   recent events, newest last; the last `recentEvents` count, by the
 *            polities their operations move, their combatants and their
 *            country places.
 *   wars     the world's war ledger: sideA/sideB, or a `sides` object of lists.
 *   claimants{ [regionId]: [claimant names] }; ownerOfRegion(regionId) -> owner label.
 *
 * Returns owner labels in descending relevance, the player first.
 */
export const selectFocusPowers = ({
  owners = [],
  player = "",
  actions = [],
  chats = [],
  events = [],
  wars = [],
  claimants = {},
  ownerOfRegion = () => "",
  recentEvents = 12,
  // Names (any case) of the player's neighbours, its relevant countries, the
  // powers changed since the last skip and those in a live storyline. Each is
  // matched by the power's exact names, as everything else here is.
  neighbours = [],
  relevant = [],
  changed = [],
  storylines = [],
  weights = FOCUS_WEIGHTS,
} = {}) => {
  const entries = owners
    .filter((owner) => owner && (owner.label || owner.key))
    .map((owner) => ({
      owner,
      label: String(owner.label || owner.key),
      variants: nameVariants(owner.label || owner.key, { displayName: owner.displayName, aliases: owner.aliases, stockName: owner.stockName }),
      score: 0,
      reasons: [],
    }));
  if (entries.length === 0) return [];

  const byFold = new Map();
  for (const entry of entries) {
    for (const form of entry.variants.exact) if (!byFold.has(form)) byFold.set(form, entry);
  }
  const findExact = (name) => byFold.get(foldName(name)) ?? null;
  const credit = (entry, points, reason) => {
    if (!entry) return;
    entry.score += points;
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
  };
  // Each power named among `names` credited once.
  const creditEach = (names, points, reason) => {
    const seen = new Set();
    for (const name of names) {
      const entry = findExact(name);
      if (entry && !seen.has(entry)) { seen.add(entry); credit(entry, points, reason); }
    }
  };

  const playerEntry = findExact(player);
  credit(playerEntry, weights.player, "player");

  // A pending order's parties: those it invites or involves (normalizeActionEntry).
  for (const action of Array.isArray(actions) ? actions : []) {
    if (!isPendingAction(action)) continue;
    creditEach([
      ...(Array.isArray(action.invitees) ? action.invitees : []),
      ...(Array.isArray(action.participants) ? action.participants : []),
    ].map((name) => (typeof name === "string" ? name : name?.name || name?.code)), weights.action, "player action");
  }

  for (const war of Array.isArray(wars) ? wars : []) {
    if (!war || typeof war !== "object" || warIsOver(war)) continue;
    creditEach(warSides(war), weights.war, "at war");
  }

  for (const chat of Array.isArray(chats) ? chats : []) {
    for (const country of Array.isArray(chat?.countries) ? chat.countries : []) {
      credit(findExact(country?.name || country?.code), weights.chat, "chat partner");
    }
  }

  const recent = (Array.isArray(events) ? events : []).slice(-recentEvents);
  for (const event of recent) {
    creditEach(impactOwners(event?.impacts), weights.eventImpact, "moved by recent events");
    creditEach(eventParties(event), weights.eventMention, "named in recent events");
  }

  for (const [regionId, names] of Object.entries(claimants && typeof claimants === "object" ? claimants : {})) {
    const holder = findExact(ownerOfRegion(regionId));
    for (const name of Array.isArray(names) ? names : []) {
      const entry = findExact(name);
      if (!entry) continue;
      credit(entry, holder && holder === playerEntry ? weights.claimOnPlayer : weights.claimant, holder === playerEntry ? "claims the player's land" : "claimant");
      if (holder && holder !== playerEntry) credit(holder, weights.claimant, "holds contested land");
    }
  }

  const creditNames = (names, points, reason) => {
    const seen = new Set();
    for (const name of Array.isArray(names) ? names : names instanceof Set ? [...names] : []) {
      const entry = findExact(name);
      if (entry && !seen.has(entry)) { seen.add(entry); credit(entry, points, reason); }
    }
  };
  creditNames(neighbours, weights.neighbour ?? 0, "neighbour");
  creditNames(relevant, weights.relevant ?? 0, "relevant country");
  creditNames(changed, weights.changed ?? 0, "changed since the last skip");
  creditNames(storylines, weights.storyline ?? 0, "in a live storyline");

  for (const entry of entries) {
    entry.score += Math.min(weights.sizeCap, Math.floor((Number(entry.owner.regions) || 0) / weights.sizeDivisor));
  }

  return entries
    .sort((a, b) => b.score - a.score || (Number(b.owner.regions) || 0) - (Number(a.owner.regions) || 0) || a.label.localeCompare(b.label))
    .map((entry) => ({ label: entry.label, score: entry.score, reasons: entry.reasons }));
};
