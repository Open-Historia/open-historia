/*! Open Historia — puppets © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A Puppet is a polity whose will is directed by an Overlord while it stays a
// separate country — it holds its own territory, keeps its own sovereignty and
// paints in its own colour. See the Glossary in docs/world-state.md, and
// docs/adr/0004-puppet-ledger-and-secrecy.md for why this is its own ledger.
//
// This module owns the one rule every surface must agree on: WHAT MAY THIS
// VIEWER SEE. The country panel, the diplomacy markers, the map overlay and the
// advisor's prompt all ask it, because four callers deciding separately is how
// the game ends up contradicting itself about the player's own empire — the
// same reason countryTags.js was extracted.
//
// DELIBERATELY IMPORT-FREE, like chatVisibility.js / countryTags.js: this
// decides what one government is allowed to know about another, and the modules
// that call it reach the whole browser runtime and cannot be unit-tested.
//
// TWO KINDS OF SECRET, and the difference is the whole design:
//
//   secrecy  — whether the arrangement EXISTS publicly. A protectorate is a
//              signed, published treaty; a bought government is not.
//   loyalty  — how far the Puppet actually accepts direction. Hidden from
//              everyone but the Overlord in EVERY case, open ones included, so
//              that an openly-known satellite still has something worth
//              spying on.
//
// And knowledge, once acquired, is never taken away: a polity that learned of a
// covert arrangement in 1948 goes on believing in it after it lapsed in 1953.
// That staleness is deliberate — it is what this feature has instead of letting
// a turned agent fabricate relationships outright (see the ADR).

export const PUPPET_KINDS = ["protectorate", "satellite", "client"];
export const PUPPET_SECRECY_LEVELS = ["open", "covert"];
export const PUPPET_STATUSES = ["active", "released", "annexed", "revolted"];
export const MAX_PUPPETS = 64;

const str = (value) => String(value ?? "").trim();
const norm = (value) => str(value).toLocaleLowerCase();
const same = (left, right) => Boolean(norm(left)) && norm(left) === norm(right);

// A band, never a number. A visible score is the threshold players optimise
// against whether or not the engine enforces one, and nothing here does.
export const loyaltyBand = (loyalty) => {
  const value = Number(loyalty);
  if (!Number.isFinite(value)) return "Content";
  if (value >= 75) return "Loyal";
  if (value >= 50) return "Content";
  if (value >= 25) return "Restless";
  return "Seething";
};

// knownTo entries are { polity, learnedDate }; a bare string is accepted so a
// row written by hand (or by an older build) still grants sight, just without
// a date to show for it.
const knownEntry = (row, viewer) => {
  if (!Array.isArray(row?.knownTo)) return null;
  for (const entry of row.knownTo) {
    if (typeof entry === "string") {
      if (same(entry, viewer)) return { polity: str(entry), learnedDate: "" };
      continue;
    }
    if (same(entry?.polity, viewer)) {
      return { polity: str(entry.polity), learnedDate: str(entry.learnedDate), seenStatus: norm(entry.seenStatus) };
    }
  }
  return null;
};

const roleOf = (row, viewer) => {
  if (same(row?.overlord, viewer)) return "overlord";
  if (same(row?.puppet, viewer)) return "puppet";
  return "foreign";
};

// What one viewer may see of one row, or null if they may see nothing at all.
// Nothing means NOTHING: not a redacted row, not a disabled control. A greyed
// out entry would announce the existence of the secret it is keeping.
const viewOf = (row, viewer) => {
  const overlord = str(row?.overlord);
  const puppet = str(row?.puppet);
  if (!overlord || !puppet) return null;

  const role = roleOf(row, viewer);
  const covert = norm(row?.secrecy) === "covert";
  const learned = role === "foreign" && covert ? knownEntry(row, viewer) : null;
  if (role === "foreign" && covert && !learned) return null;

  const isOverlord = role === "overlord";
  const loyaltyNumber = Number(row?.loyalty);
  const loyalty = isOverlord && Number.isFinite(loyaltyNumber) ? Math.max(0, Math.min(100, Math.round(loyaltyNumber))) : null;

  // These fall back rather than trusting normalizeWorldState, and that is not
  // redundant: the advisor path reads world.json RAW (readJson, not
  // readWorldState), so this module is handed unnormalised rows in production.
  // Being import-free, it cannot call the normalizer to find out.
  //
  // The believed state. A party to the arrangement knows what it did, and an
  // open arrangement ends in public — but a covert one learned through
  // intelligence goes on standing in the viewer's mind until fresh reporting
  // says otherwise, and nothing here tells them it has not.
  const trueStatus = PUPPET_STATUSES.includes(norm(row?.status)) ? norm(row.status) : "active";
  // What the viewer LAST SAW, not what is so: an agent still in place brings the
  // entry up to date, and without one the old belief stands.
  const status = learned
    ? (PUPPET_STATUSES.includes(learned.seenStatus) ? learned.seenStatus : "active")
    : trueStatus;

  return {
    id: str(row?.id),
    overlord,
    puppet,
    kind: PUPPET_KINDS.includes(norm(row?.kind)) ? norm(row.kind) : "client",
    secrecy: covert ? "covert" : "open",
    status,
    startedDate: str(row?.startedDate),
    endedDate: learned && status === "active" ? "" : str(row?.endedDate),
    role,
    loyalty,
    // Null for everyone but the Overlord — and callers interpolate this straight
    // into prose, so an Overlord row whose loyalty is missing or garbage must
    // still get a WORD. loyaltyBand() already answers "Content" for a
    // non-finite score; the null here means "not yours to see", never "unknown".
    loyaltyBand: role === "overlord" ? loyaltyBand(loyalty) : null,
    fromIntelligence: Boolean(learned),
    asOf: learned ? learned.learnedDate : "",
  };
};

// Every subordination this viewer may see, live or finished, as they believe it
// to stand. Pass the polity's NAME — the same namespace as reputation,
// intelligence and country tags.
export const visiblePuppetsFor = (world, viewer) => {
  const rows = Array.isArray(world?.puppets) ? world.puppets : [];
  return rows.map((row) => viewOf(row, viewer)).filter(Boolean);
};

// Only the arrangements the viewer believes are still standing — which for a
// stale covert row is not the same thing as the arrangements that are.
export const livePuppetsFor = (world, viewer) =>
  visiblePuppetsFor(world, viewer).filter((row) => row.status === "active");

// The three-way branch — are we the Overlord here, the Puppet, or looking at
// somebody else's arrangement — was being rewritten at every surface, and a
// fourth would have written it again. The WORDS differ (a prompt line, a panel
// headline, a list marker), so only the dispatch is shared.
export const describeRole = (row, { overlord, puppet, foreign }) => {
  if (row?.role === "overlord") return overlord?.(row);
  if (row?.role === "puppet") return puppet?.(row);
  return foreign?.(row);
};

// What each kind MEANS, in words a player reads once and understands. The kind
// says which powers the Overlord holds; a satellite is what most people mean by
// a "puppet state", so it says so. `who` is "we" (the viewer is the Overlord),
// or the Overlord's name; `whose` is "its" or, seen from the Puppet, "our".
// THE THREE KINDS, in the player's words. A "puppet state" is what people
// actually call a satellite, so that is what the game calls it; `kind` in the
// ledger is unchanged. Each sentence says what the Overlord holds, from the
// viewer's own side of the arrangement.
const KIND_LABELS = { protectorate: "protectorate", satellite: "puppet state", client: "client state" };
const KIND_MEANINGS = {
  protectorate: ({ holder, runs, its, governs }) => `${holder} ${runs("run")} ${its} foreign policy and defence. ${governs} at home.`,
  satellite: ({ holder, runs, its, keeps, decisions }) =>
    `${holder} ${runs("control")} ${its} government. ${keeps} the flag and the name; the decisions are ${decisions}.`,
  client: ({ government, backing, makes, its }) =>
    `${government} depends on ${backing} backing and follows its lead, but ${makes} most of ${its} own decisions.`,
};

export const puppetKindLabel = (kind) => KIND_LABELS[String(kind ?? "").trim()] || String(kind ?? "").trim();

// One sentence on what this kind means, written for whoever is looking: the
// Overlord ("we control its government"), the Puppet ("they control ours"), or
// a third party watching two other countries.
export const puppetKindMeaning = (row) => {
  const meaning = KIND_MEANINGS[row?.kind];
  if (!meaning) return "";
  const ours = row.role === "overlord";
  const mine = row.role === "puppet";
  return meaning({
    holder: ours ? "We" : row.overlord,
    runs: (verb) => (ours ? verb : `${verb}s`),
    its: mine ? "our" : "its",
    governs: mine ? "We govern ourselves" : "It governs itself",
    keeps: mine ? "We keep" : "It keeps",
    decisions: ours ? "ours" : mine ? "theirs" : `${row.overlord}'s`,
    government: mine ? "Our government" : "Its government",
    backing: ours ? "our" : `${row.overlord}'s`,
    makes: mine ? "we make" : "it makes",
  });
};

// "2016-01-10" as "10 January 2016" — a date a player reads, not a key. Left
// alone if it is not a plain calendar date (a scenario may use its own).
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const readableDate = (value) => {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return text;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : text;
};

// What the country panel and the map popup print for a clicked country, as the
// viewer may see it — or null, which renders nothing. A covert arrangement the
// viewer has not discovered must leave no trace at all: not a locked row, not a
// greyed-out line, since either would announce the secret it is keeping.
//
// headline — what this country is, in three or four words
// meaning  — one sentence on what that gives the Overlord
// facts    — the short, chip-sized truths: mood, when it began, whether the
//            world knows. Never a Loyalty NUMBER, and never the Puppet's own
//            mood to itself: a visible score is a threshold to optimise
//            against, and nothing in the engine enforces one.
export const puppetSummaryFor = (world, viewer, countryName) => {
  const name = String(countryName ?? "").trim();
  // NOBODY'S VIEW IS NOT AN OUTSIDER'S. A surface that has not yet learned who
  // is playing must show nothing at all: the map card drew before its read of
  // the save came back and told the player their own overlord was somebody
  // else's arrangement ("Puppet state of Russia").
  if (!world || !name || !String(viewer ?? "").trim()) return null;
  const rows = visiblePuppetsFor(world, viewer);
  const row = rows.find((entry) => entry.puppet === name)
    || rows.find((entry) => entry.overlord === name && entry.role === "puppet");
  if (!row || row.status !== "active") return null;

  const label = puppetKindLabel(row.kind);
  const since = row.startedDate ? `Since ${readableDate(row.startedDate)}` : "";
  const secrecy = row.secrecy === "covert" ? "Covert" : "Openly known";
  const summary = describeRole(row, {
    overlord: () => ({
      headline: `Our ${label}`,
      facts: [row.loyaltyBand, since, secrecy].filter(Boolean),
      provenance: "",
    }),
    puppet: () => ({
      headline: `${row.overlord}'s ${label}`,
      facts: [since, secrecy].filter(Boolean),
      provenance: "",
    }),
    foreign: () => ({
      headline: `${label.charAt(0).toUpperCase()}${label.slice(1)} of ${row.overlord}`,
      facts: [since].filter(Boolean),
      provenance: row.fromIntelligence ? `From intelligence${row.asOf ? `, as of ${readableDate(row.asOf)}` : ""}.` : "",
    }),
  });
  return { ...summary, meaning: puppetKindMeaning(row), role: row.role, kind: row.kind, kindLabel: label };
};

// What a LEADER speaking as `viewer` is told about subordinations — the chat
// counterpart of the advisor's filtered view, and the same rule
// chatVisibility.js applies to transcripts: a leader speaks as one polity, so it
// knows what that polity knows and nothing more. Handing every leader the whole
// ledger would let France's leader "know" a covert deal France never uncovered.
//
//   own     — the viewer's own arrangements, as Overlord or Puppet. A party to a
//             subordination always knows it. For a COVERT one the briefing also
//             names who in the room has NOT found out (`present` is everyone in
//             the room, as names or { name } entries, the player included), because that is what the leader needs to know which way
//             to lie. An Overlord is told its Puppet's mood; a Puppet is not
//             told its own.
//   learned — other polities' arrangements the viewer has uncovered, with when.
export const puppetBriefingFor = (world, viewer, { present = [] } = {}) => {
  const rows = Array.isArray(world?.puppets) ? world.puppets : [];
  const own = [];
  for (const row of rows) {
    if (norm(row?.status || "active") !== "active") continue;
    const role = roleOf(row, viewer);
    if (role === "foreign") continue;
    const counterpart = str(role === "overlord" ? row.puppet : row.overlord);
    const covert = norm(row?.secrecy) === "covert";
    const unawareHere = covert
      ? [...new Set(present.map((entry) => str(entry?.name ?? entry)).filter(Boolean))].filter((name) =>
        !same(name, viewer) && !same(name, counterpart) && !knownEntry(row, name))
      : [];
    own.push({
      role,
      counterpart,
      kind: PUPPET_KINDS.includes(norm(row?.kind)) ? norm(row.kind) : "client",
      secrecy: covert ? "covert" : "open",
      loyaltyBand: role === "overlord" ? loyaltyBand(row?.loyalty) : null,
      unawareHere,
    });
  }
  const learned = livePuppetsFor(world, viewer)
    .filter((row) => row.role === "foreign")
    .map((row) => ({ overlord: row.overlord, puppet: row.puppet, kind: row.kind, fromIntelligence: row.fromIntelligence, asOf: row.asOf }));
  return { own, learned };
};

// The briefing as prompt text, or "" when there is nothing to say. Shared by the
// one-on-one leader and the group turn so the two cannot describe the same
// arrangement differently.
export const describePuppetBriefing = ({ own = [], learned = [] } = {}, viewer = "") => {
  if (!own.length && !learned.length) return "";
  const lines = [];
  for (const row of own) {
    const head = row.role === "puppet"
      ? `${viewer} is the ${row.kind} of ${row.counterpart}: its will is directed from there, though it remains a separate country.`
      : `${viewer} directs ${row.counterpart} as its ${row.kind} (${row.counterpart}'s mood toward ${viewer}: ${String(row.loyaltyBand || "").toLowerCase()}).`;
    const secret = row.secrecy === "covert"
      ? (row.unawareHere.length
        ? ` The arrangement is SECRET, and ${row.unawareHere.join(", ")} ${row.unawareHere.length === 1 ? "does" : "do"} not know: toward ${row.unawareHere.length === 1 ? "them" : "any of them"}, ${row.role === "puppet" ? viewer : row.counterpart} is a fully independent country, and nothing said here may suggest otherwise.`
        : " The arrangement is secret, but everyone in this conversation already knows of it.")
      : " The arrangement is openly known.";
    lines.push(`- ${head}${secret}`);
  }
  for (const row of learned) {
    lines.push(`- ${viewer}'s services know that ${row.overlord} directs ${row.puppet} as its ${row.kind}${row.fromIntelligence ? `${row.asOf ? ` (as of ${row.asOf})` : ""}, though this is not public` : ""}.`);
  }
  return `[Subordinations ${viewer} Knows Of]\n${lines.join("\n")}`;
};
