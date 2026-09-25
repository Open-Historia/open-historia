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
// This ranks the powers by what the turn is actually about: the player, whoever
// the player's pending actions name, the belligerents of active wars, the
// player's chat partners, the powers the recent events moved or mentioned, the
// claimants of contested regions, and only then size. Import-free.
//
// Every match here is on a name the map declares, spelled out in full. Prose
// that says "Russia" on a world whose power is the "Russian Federation" (and
// nothing called "Russia") names nobody; the two are different countries
// wherever both exist. Ranking is never allowed to blur that line.

export const foldName = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
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

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// How many times a power's exact names occur in `text` as whole words. Zero for
// empty text.
export const mentionCount = (text, variants) => {
  const haystack = ` ${foldName(text)} `;
  if (haystack.trim().length === 0) return 0;
  let count = 0;
  for (const form of variants.exact) {
    const matches = haystack.match(new RegExp(`(?<= )${escapeRegExp(form)}(?= )`, "g"));
    if (matches) count += matches.length;
  }
  return count;
};

// Every string reachable inside a record, for wars and other ledgers whose
// shape differs between branches; keys are not trusted, values are matched.
const stringsIn = (value, depth = 0, out = []) => {
  if (depth > 4 || value == null) return out;
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) stringsIn(entry, depth + 1, out);
  } else if (typeof value === "object") {
    for (const entry of Object.values(value)) stringsIn(entry, depth + 1, out);
  }
  return out;
};

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

export const FOCUS_WEIGHTS = Object.freeze({
  player: 1000,
  action: 120,
  war: 90,
  chat: 70,
  eventImpact: 45,
  eventMention: 20,
  eventMentionCap: 80,
  claimOnPlayer: 60,
  claimant: 12,
  sizeCap: 15,
  sizeDivisor: 20,
});

/**
 * Rank the powers whose regions the prompt should list in full.
 *
 *   owners   [{ key, label, regions, displayName?, aliases? }] — one per current
 *            owner, `regions` being how many it holds.
 *   player   the player's polity name.
 *   actions  the save's pending actions (unresolved ones weigh; resolved ignored).
 *   chats    the save's chats ({ countries: [{ name }] }).
 *   events   recent events, newest last; the last `recentEvents` count.
 *   wars     the world's war ledger, any shape.
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
  const creditMentions = (text, points, reason, cap = Infinity) => {
    for (const entry of entries) {
      const count = mentionCount(text, entry.variants);
      if (count > 0) credit(entry, Math.min(cap, count * points), reason);
    }
  };

  const playerEntry = findExact(player);
  credit(playerEntry, weights.player, "player");

  for (const action of Array.isArray(actions) ? actions : []) {
    if (!action || action.resolved) continue;
    const text = [action.title, action.description, action.rawInput, action.text].filter(Boolean).join(" ");
    creditMentions(text, weights.action, "player action", weights.action);
  }

  for (const war of Array.isArray(wars) ? wars : []) {
    if (war && typeof war === "object" && /ended|concluded|closed/i.test(String(war.status ?? ""))) continue;
    const seen = new Set();
    for (const name of stringsIn(war)) {
      const entry = findExact(name);
      if (entry && !seen.has(entry)) { seen.add(entry); credit(entry, weights.war, "at war"); }
    }
  }

  for (const chat of Array.isArray(chats) ? chats : []) {
    for (const country of Array.isArray(chat?.countries) ? chat.countries : []) {
      credit(findExact(country?.name || country?.code), weights.chat, "chat partner");
    }
  }

  const recent = (Array.isArray(events) ? events : []).slice(-recentEvents);
  for (const event of recent) {
    const seen = new Set();
    for (const name of impactOwners(event?.impacts)) {
      const entry = findExact(name);
      if (entry && !seen.has(entry)) { seen.add(entry); credit(entry, weights.eventImpact, "moved by recent events"); }
    }
    creditMentions(`${event?.title ?? ""} ${event?.description ?? ""}`, weights.eventMention, "named in recent events", weights.eventMentionCap);
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

  for (const entry of entries) {
    entry.score += Math.min(weights.sizeCap, Math.floor((Number(entry.owner.regions) || 0) / weights.sizeDivisor));
  }

  return entries
    .sort((a, b) => b.score - a.score || (Number(b.owner.regions) || 0) - (Number(a.owner.regions) || 0) || a.label.localeCompare(b.label))
    .map((entry) => ({ label: entry.label, score: entry.score, reasons: entry.reasons }));
};
