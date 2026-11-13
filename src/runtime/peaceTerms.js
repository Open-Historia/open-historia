/*! Open Historia — peace: offers, terms and reparations © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "A peace offer the player accepts or declines, with war weariness." "Also
// have war weariness, wars that end with terms and reparations."
//
// A war used to end when the story said so, and that was all an ending was.
// Now a war can end ON TERMS, and the game carries them out.
//
// TERMS are the ground and the money, and whatever else the two agree:
//
//   the ground      "as held": each side keeps what it holds as the peace is
//                   made (what was taken is ceded); or "restored": every
//                   region goes back to whose it lawfully was (a white peace)
//   reparations     one side pays the other a share of its economy a year,
//                   for so many years (world.reparations); or nobody pays
//
// and, "make peace treaties be able to take all territory as well, transfer
// certain regions in exchange for peace, turn into a puppet state, and do
// anything else" (the owner, 2026-11-03):
//
//   annexed         one of the two gives up all its land to the other:
//                   { country, by }
//   cessions        named regions pass to one of the two from the other:
//                   [{ region, to }], the region by its name on the map
//   puppet          one of the two becomes the other's puppet:
//                   { subject, overlord, kind } (runtime/puppets.js kinds)
//   conditions      anything else, in words ("the Rhineland is demilitarised"):
//                   the game cannot carry these out itself, so the next time
//                   skip is told them with the peace and carries them out
//
// Each of the four is left out of the terms when they have none.
//
// WHO OFFERS PEACE, AND WHEN, is the AI's to decide, never a formula's: "make
// it so it only happens when the simulation says the country sends a peace
// treaty, it should not be fully deterministic anymore" (the owner,
// 2026-10-30). The game only checks what it is told and keeps it:
//
//   an offer        (world.peaceOffers) a country nobody plays offers a
//                   person peace in a letter of the time skip's
//                   (offerFromSkip), or a leader does in a chat reply; a
//                   person puts terms to an enemy in that enemy's chat, and
//                   its leader's reply accepts, declines or counters. Each
//                   offer is shown in the chat it was made in, with its terms
//   a treaty        two countries nobody plays make peace when the skip says
//                   they did (treatyFromSkip)
//
// The figures below (standingOf, termsWorth, wouldAccept, termsOffered) no
// longer decide anything: they are what the game reckons the terms are worth
// to a country, told to the model beside its war's other figures
// (AI/warStatsPrompt.js), whose decision it stays.
//
// REPARATIONS are paid turn by turn out of the payer's economy: on the
// backend of its sheet (runtime/statsBackend.js) the payer's public debt
// rises by what it paid and the receiver's falls, so what each has to spend
// on its forces follows (runtime/militaryFunding.js).
//
// Pure, and loads in plain Node.

import { PUPPET_KINDS, puppetKindLabel } from "./puppets.js";
import { MAX_WAR_SIDE_MEMBERS, keepOpenRows } from "./warRecord.js";

export const TERRITORY_AS_HELD = "as held";
export const TERRITORY_RESTORED = "restored";
export const PEACE_TERRITORIES = Object.freeze([TERRITORY_AS_HELD, TERRITORY_RESTORED]);
export const OFFER_STATUSES = Object.freeze(["open", "accepted", "declined", "lapsed"]);

// What a fresh country expects to better its standing by if it fights on, and
// a spent one to worsen it by: at half-weary it expects the war to end as it stands.
export const PEACE_HOPE = 0.2;
// How long an open offer stands, in turns.
export const PEACE_OFFER_STANDS_ROUNDS = 4;
// How far apart two sides' standings must be for one to be "losing".
export const STANDING_EVEN = 0.08;
// Reparations: the share of its GDP a year a beaten country pays at the worst, the least worth writing down, and for how long.
export const REPARATIONS_SHARE_MOST = 0.04;
export const REPARATIONS_SHARE_LEAST = 0.005;
export const REPARATIONS_YEARS_LEAST = 3;
export const REPARATIONS_YEARS_MOST = 12;
// The most reparations terms an AI may write: a share of the payer's GDP a year, and years.
export const REPARATIONS_SHARE_CAP = 0.1;
export const REPARATIONS_YEARS_CAP = 20;
export const OFFERS_KEPT_MOST = 24;
// Who made an offer: a time skip's letter, a leader's chat reply, a person's own terms, a leader's counter to them.
export const OFFER_SOURCES = Object.freeze(["skip", "chat", "player", "counter"]);
export const REPARATIONS_KEPT_MOST = 24;
// The most regions one peace cedes by name, the most other conditions it carries, and how long one may be.
export const PEACE_CESSIONS_MOST = 40;
export const PEACE_CONDITIONS_MOST = 6;
export const PEACE_CONDITION_CHARS = 220;
// The puppet a peace makes when its terms do not say which kind.
export const PEACE_PUPPET_KIND = "satellite";
// What each kind of term is worth to the country it favours (termsWorth), the ground being 1 at the most.
export const ANNEXED_WORTH = 1;
export const PUPPET_WORTH = 0.6;
export const CESSION_WORTH = 0.05;
export const CESSIONS_WORTH_MOST = 0.5;

const clean = (value, most = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const within = (value, least, most) => Math.min(most, Math.max(least, value));
const figure = (value) => {
  const read = Number(value);
  return Number.isFinite(read) ? read : 0;
};
const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

// ---- terms ----------------------------------------------------------------------------------

// Reparations as they are kept in terms: { payer, receiver, share, years } or null.
const normalizePayment = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const payer = clean(raw.payer);
  const receiver = clean(raw.receiver);
  const share = figure(raw.share);
  const years = Math.round(figure(raw.years));
  if (!payer || !receiver || fold(payer) === fold(receiver) || !(share >= REPARATIONS_SHARE_LEAST / 2) || !(years >= 1)) return null;
  return { payer, receiver, share: round(within(share, 0, 0.2), 4), years: Math.min(30, years) };
};

// The terms beyond the ground and the money (annexed, cessions, puppet,
// conditions), each only where there is one: a country annexed is nobody's
// puppet, and a region is ceded once.
const normalizeExtras = (raw) => {
  const annexedCountry = clean(raw?.annexed?.country);
  const annexed = annexedCountry ? { country: annexedCountry, by: clean(raw.annexed.by) } : null;
  const seen = new Set();
  const cessions = [];
  for (const entry of list(raw?.cessions)) {
    const region = clean(entry?.region);
    const to = clean(entry?.to);
    if (!region || !to || seen.has(fold(region)) || cessions.length >= PEACE_CESSIONS_MOST) continue;
    seen.add(fold(region));
    cessions.push({ region, to });
  }
  const subject = clean(raw?.puppet?.subject);
  const kind = fold(raw?.puppet?.kind);
  const puppet = subject && fold(subject) !== fold(annexedCountry) && fold(subject) !== fold(raw?.puppet?.overlord)
    ? { subject, overlord: clean(raw.puppet.overlord), kind: PUPPET_KINDS.includes(kind) ? kind : PEACE_PUPPET_KIND }
    : null;
  const conditions = [...new Set(list(raw?.conditions).map((text) => clean(text, PEACE_CONDITION_CHARS)).filter(Boolean))].slice(0, PEACE_CONDITIONS_MOST);
  return {
    ...(annexed ? { annexed } : {}),
    ...(cessions.length > 0 ? { cessions } : {}),
    ...(puppet ? { puppet } : {}),
    ...(conditions.length > 0 ? { conditions } : {}),
  };
};

export const normalizeTerms = (raw) => ({
  territory: PEACE_TERRITORIES.includes(raw?.territory) ? raw.territory : TERRITORY_RESTORED,
  reparations: normalizePayment(raw?.reparations),
  ...normalizeExtras(raw),
});

// How a war stands for one country against the other side, from -1 (it has
// lost everything and taken nothing) to 1 (the reverse).
//   lost     the share of its own ground the other side holds
//   taken    the share of the other side's ground it holds
export const standingOf = ({ lost = 0, taken = 0 } = {}) => within(figure(taken), 0, 1) - within(figure(lost), 0, 1);

// The terms a country would offer, by how the war stands for it.
//   offerer, receiver   who offers, and to whom
//   standing            standingOf for the offerer
//   weariness           the offerer's, 0 to 100
export const termsOffered = ({ offerer = "", receiver = "", standing = 0, weariness = 0 } = {}) => {
  const stands = within(figure(standing), -1, 1);
  if (stands > -STANDING_EVEN && stands < STANDING_EVEN) return normalizeTerms({ territory: TERRITORY_RESTORED });
  // Winning, and weary all the same: it keeps what it holds and asks nothing more.
  if (stands >= STANDING_EVEN) return normalizeTerms({ territory: TERRITORY_AS_HELD });
  // Losing: it cedes what it has lost, and pays; the worse it stands and the wearier it is, the more and the longer.
  const plight = within(-stands * 0.7 + (within(figure(weariness), 0, 100) / 100) * 0.3, 0, 1);
  const share = REPARATIONS_SHARE_MOST * plight;
  const years = Math.round(REPARATIONS_YEARS_LEAST + (REPARATIONS_YEARS_MOST - REPARATIONS_YEARS_LEAST) * plight);
  return normalizeTerms({
    territory: TERRITORY_AS_HELD,
    reparations: share >= REPARATIONS_SHARE_LEAST ? { payer: offerer, receiver, share, years } : null,
  });
};

// How good terms are for one country, from -1 to 1: what it keeps or gives up
// of the ground as the war stands for it, and what it is paid or pays.
//   standing   standingOf for that country
export const termsWorth = (terms, country, standing = 0) => {
  const read = normalizeTerms(terms);
  const ground = read.territory === TERRITORY_AS_HELD ? within(figure(standing), -1, 1) : 0;
  const payment = read.reparations;
  const paid = !payment ? 0 : (payment.share * payment.years) / (REPARATIONS_SHARE_MOST * REPARATIONS_YEARS_MOST);
  const money = !payment ? 0 : fold(payment.receiver) === fold(country) ? paid : fold(payment.payer) === fold(country) ? -paid : 0;
  // (Annexed, a puppet, regions ceded: worth as much to the one that gains as it costs the one that loses.)
  const mine = (name) => fold(name) === fold(country);
  const annexed = !read.annexed ? 0 : mine(read.annexed.country) ? -ANNEXED_WORTH : ANNEXED_WORTH;
  const puppet = !read.puppet ? 0 : mine(read.puppet.subject) ? -PUPPET_WORTH : PUPPET_WORTH;
  const ceded = list(read.cessions).reduce((sum, entry) => sum + (mine(entry.to) ? CESSION_WORTH : -CESSION_WORTH), 0);
  return within(ground + 0.5 * money + annexed + puppet + within(ceded, -CESSIONS_WORTH_MOST, CESSIONS_WORTH_MOST), -1, 1);
};

// Whether a country nobody plays takes the terms put to it: it does when they
// are no worse for it than what it expects of fighting on. A fresh country
// expects to better its standing (PEACE_HOPE), so it will not sign away ground
// it has lost, nor stop at what it has taken unless it is paid to; a
// half-weary one expects the war to end as it stands; a spent one expects
// worse, and takes worse.
//   standing    standingOf for the country answering
//   weariness   its own, 0 to 100
export const wouldAccept = ({ terms, country = "", standing = 0, weariness = 0 } = {}) => {
  const worth = termsWorth(terms, country, standing);
  const weary = within(figure(weariness), 0, 100) / 100;
  const hopes = within(figure(standing), -1, 1) + PEACE_HOPE * (1 - 2 * weary);
  return worth >= hopes - 1e-9;
};

// Names in a list: "A", "A and B", "A, B and C".
const listed = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

// The regions ceded, by who receives them: [{ to, regions }].
export const cessionsByReceiver = (cessions) => {
  const by = new Map();
  for (const entry of list(cessions)) {
    const key = fold(entry?.to);
    if (!key || !clean(entry?.region)) continue;
    if (!by.has(key)) by.set(key, { to: clean(entry.to), regions: [] });
    by.get(key).regions.push(clean(entry.region));
  }
  return [...by.values()];
};

// Terms in a line, for the story and for whoever reads the game.
export const describeTerms = (terms) => {
  const read = normalizeTerms(terms);
  const ground = read.territory === TERRITORY_AS_HELD ? "each side keeps the ground it holds" : "every region goes back to whose it was before the war";
  const payment = read.reparations;
  const parts = [read.annexed ? `${read.annexed.country} is annexed: all its land passes to ${read.annexed.by || "the other side"}` : ground];
  for (const { to, regions } of cessionsByReceiver(read.cessions)) parts.push(`${listed(regions)} ${regions.length === 1 ? "passes" : "pass"} to ${to}`);
  if (read.puppet) parts.push(`${read.puppet.subject} becomes ${read.puppet.overlord ? `${read.puppet.overlord}'s` : "the other side's"} ${puppetKindLabel(read.puppet.kind)}`);
  parts.push(payment
    ? `${payment.payer} pays ${payment.receiver} reparations of ${round(payment.share * 100, 1)}% of its economy a year for ${payment.years} ${payment.years === 1 ? "year" : "years"}`
    : "nobody pays reparations");
  if (read.conditions) parts.push(`and: ${read.conditions.join("; ")}`);
  return parts.join("; ");
};

/// ---- offers ---------------------------------------------------------------------------------

// world.peaceOffers: { id, warId, from, to, terms, date, round, status, answeredRound?, source?, chatId?, messageId? }
//   source      who made it (OFFER_SOURCES)
//   chatId      the thread it was made in, where it is known
//   messageId   the message that carries it there, where it is known
export const normalizePeaceOffer = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = clean(raw.id, 80);
  const warId = clean(raw.warId);
  const from = clean(raw.from);
  const to = clean(raw.to);
  if (!id || !warId || !from || !to || fold(from) === fold(to)) return null;
  const status = OFFER_STATUSES.includes(raw.status) ? raw.status : "open";
  const answered = Math.round(figure(raw.answeredRound));
  const chatId = clean(raw.chatId, 120);
  const messageId = clean(raw.messageId, 120);
  return {
    id,
    warId,
    from,
    to,
    terms: normalizeTerms(raw.terms),
    date: clean(raw.date, 40),
    round: Math.max(0, Math.round(figure(raw.round))),
    status,
    ...(status !== "open" && answered > 0 ? { answeredRound: answered } : {}),
    ...(OFFER_SOURCES.includes(raw.source) ? { source: raw.source } : {}),
    ...(chatId ? { chatId } : {}),
    ...(messageId ? { messageId } : {}),
  };
};

export const normalizePeaceOffers = (value) => {
  const kept = new Map();
  for (const raw of list(value)) {
    const offer = normalizePeaceOffer(raw);
    if (offer) kept.set(offer.id, offer);
  }
  // (An open offer is never cut: runtime/warRecord.js keepOpenRows.)
  return keepOpenRows([...kept.values()], OFFERS_KEPT_MOST, (offer) => offer.status === "open");
};

// The offers that wait for an answer from one country ("" for anybody's).
export const openOffersFor = (offers, country = "") => normalizePeaceOffers(offers).filter((offer) => offer.status === "open" && (!fold(country) || fold(offer.to) === fold(country)));

// The open offer between two countries, made by either: null for none.
export const openOfferBetween = (offers, a, b) => normalizePeaceOffers(offers).find((offer) => offer.status === "open" && ((fold(offer.from) === fold(a) && fold(offer.to) === fold(b)) || (fold(offer.from) === fold(b) && fold(offer.to) === fold(a)))) ?? null;

const sidesOf = (war) => [list(war?.sideA).map((name) => clean(name)).filter(Boolean), list(war?.sideB).map((name) => clean(name)).filter(Boolean)];
const settleable = (war) => ["active", "ceasefire"].includes(fold(war?.status || "active"));

// The war two countries fight on opposite sides of, still to be settled: null for none.
export const warBetween = (wars, a, b) => list(wars).find((war) => {
  if (!clean(war?.id) || !settleable(war)) return false;
  const [first, second] = sidesOf(war).map((members) => new Set(members.map(fold)));
  return (first.has(fold(a)) && second.has(fold(b))) || (first.has(fold(b)) && second.has(fold(a)));
}) ?? null;

// Terms an AI wrote, held to what the game allows: whoever pays is one of the
// two making peace and the other receives, at most REPARATIONS_SHARE_CAP of its
// economy a year for REPARATIONS_YEARS_CAP years. Reparations naming anyone
// else are dropped, never guessed onto somebody. So with the rest: the country
// annexed or made a puppet is one of the two, and the other gains it; a region
// is ceded to one of the two. A term naming a third country is dropped.
export const clampTerms = (raw, { from = "", to = "" } = {}) => {
  const parties = [clean(from), clean(to)];
  const party = (name) => parties.find((entry) => entry && fold(entry) === fold(name)) ?? "";
  const otherOf = (name) => parties.find((entry) => entry && fold(entry) !== fold(name)) ?? "";
  // A payer named with nobody to receive: the other of the two.
  const named = raw?.reparations && typeof raw.reparations === "object" ? raw.reparations : null;
  const filled = named && !clean(named.receiver)
    ? { ...raw, reparations: { ...named, receiver: otherOf(named.payer) } }
    : raw;
  const { annexed, cessions, puppet, ...read } = normalizeTerms(filled);
  const annexedCountry = annexed ? party(annexed.country) : "";
  const subject = puppet ? party(puppet.subject) : "";
  const kept = normalizeTerms({
    ...read,
    annexed: annexedCountry ? { country: annexedCountry, by: otherOf(annexedCountry) } : null,
    cessions: list(cessions).map((entry) => ({ region: entry.region, to: party(entry.to) })).filter((entry) => entry.to && fold(entry.to) !== fold(annexedCountry)),
    puppet: subject ? { subject, overlord: otherOf(subject), kind: puppet.kind } : null,
  });
  const payment = kept.reparations;
  if (!payment) return kept;
  const payer = party(payment.payer);
  const receiver = otherOf(payer);
  if (!payer || !receiver) return { ...kept, reparations: null };
  return { ...kept, reparations: { payer, receiver, share: round(within(payment.share, 0, REPARATIONS_SHARE_CAP), 4), years: Math.min(REPARATIONS_YEARS_CAP, payment.years) } };
};

// Terms as a line an AI writes, a term a part, the parts parted by ";":
//   "as held; Borduria pays 2% for 5 years"   "restored; none"   "restored"
//   "Borduria is annexed"                      (all its land passes to the other)
//   "Borduria cedes Klow, Szohod to Syldavia"  "Klow passes to Syldavia"
//   "Borduria becomes Syldavia's puppet"       (or protectorate, client state)
//   anything else is a condition, told to the next time skip to carry out
// `from` and `to` are the two making peace: a country a term names is one of
// them (clampTerms). Ground it cannot read is the old borders.
// i18n-ignore: an example for the model and a pattern, never shown.
export const TERMS_LINE_EXAMPLE = "as held; Borduria cedes Klow, Szohod to Syldavia; Borduria becomes Syldavia's puppet; Borduria pays 2% for 5 years; the border forts are razed";
// i18n-ignore: a pattern the terms are read with.
const PUPPET_WORDS = "puppet(?: state)?|satellite|protectorate|client(?: state)?|vassal";
const puppetKindOf = (word) => {
  const read = fold(word);
  return read.startsWith("protectorate") ? "protectorate" : read.startsWith("client") ? "client" : "satellite";
};
export const readTermsLine = (text, { from = "", to = "" } = {}) => {
  const parties = [clean(from), clean(to)];
  const party = (named) => {
    const read = fold(named).replace(/^the\s+/, "");
    return parties.find((name) => name && (read === fold(name) || read.endsWith(` ${fold(name)}`))) ?? "";
  };
  const otherOf = (name) => parties.find((entry) => entry && fold(entry) !== fold(name)) ?? "";
  // (A list of regions: "Klow, Szohod and Dospad". One whose own name has an "and" is told apart when it is ceded: warAndPeace.js.)
  const regionsOf = (text) => clean(text, 1200).split(/\s*,\s*/).map((name) => clean(name).replace(/^(?:and|the region of)\s+/i, "")).filter(Boolean);
  let territory = TERRITORY_RESTORED;
  let reparations = null;
  let annexed = null;
  let puppet = null;
  const cessions = [];
  const conditions = [];
  for (const raw of clean(text, 2400).split(/\s*[;|]\s*/)) {
    const part = clean(raw).replace(/^(?:and|also|plus)\s+/i, "").replace(/[.]+$/, "");
    const lower = part.toLowerCase();
    if (!part || /^(?:none|nothing|no reparations|nobody pays)$/.test(lower)) continue;
    const paid = part.match(/^(.+?)\s+pays?\b[^0-9]*?(\d+(?:\.\d+)?)\s*%[^0-9]*?(\d+)\s*years?/i);
    if (paid) {
      const payer = party(paid[1]) || clean(paid[1]);
      reparations = { payer, receiver: otherOf(payer), share: Number(paid[2]) / 100, years: Number(paid[3]) };
      continue;
    }
    const annex = part.match(/^annex(?:es|ation of)?\s+(?:all of\s+)?(.+)$/i)
      ?? part.match(/^(.+?)\s+(?:is\s+|to be\s+)?annexed\b/i)
      ?? part.match(/^(.+?)\s+gives? up all (?:of )?(?:its|their) (?:land|territory)/i)
      ?? part.match(/^all (?:of )?(.+?)(?:'s (?:land|territory))?\s+(?:goes|passes) to\b/i);
    if (annex && party(annex[1])) {
      annexed = { country: party(annex[1]) };
      continue;
    }
    const subject = part.match(new RegExp(`^(.+?)\\s+becomes?\\s+(?:a\\s+|an\\s+|the\\s+)?(?:(.+?)'s\\s+)?(${PUPPET_WORDS})(?:\\s+(?:of|to)\\s+(.+))?$`, "i"));
    if (subject && party(subject[1])) {
      puppet = { subject: party(subject[1]), kind: puppetKindOf(subject[3]) };
      continue;
    }
    const made = part.match(new RegExp(`^(?:make\\s+)?(${PUPPET_WORDS})\\s+(?:of\\s+)?(.+)$`, "i"));
    if (made && party(made[2])) {
      puppet = { subject: party(made[2]), kind: puppetKindOf(made[1]) };
      continue;
    }
    const cede = part.match(/^(?:(.+?)\s+)?cedes?\s+(.+?)(?:\s+to\s+(.+))?$/i);
    if (cede) {
      // ("cedes what it lost", "cedes the occupied ground": the ground as held.)
      if (!cede[3] && /^(?:what|all it|the (?:ground|land|territory)|occupied)/i.test(cede[2])) {
        territory = TERRITORY_AS_HELD;
        continue;
      }
      const receiver = cede[3] ? party(cede[3]) : otherOf(party(cede[1] ?? ""));
      if (receiver && (cede[3] || party(cede[1] ?? ""))) {
        for (const region of regionsOf(cede[2])) cessions.push({ region, to: receiver });
        continue;
      }
    }
    const passes = part.match(/^(.+?)\s+(?:goes|go|pass(?:es)?|transfers?)\s+to\s+(.+)$/i);
    if (passes && party(passes[2])) {
      for (const region of regionsOf(passes[1])) cessions.push({ region, to: party(passes[2]) });
      continue;
    }
    if (/\brestor|old borders|status quo|white peace/.test(lower)) {
      territory = TERRITORY_RESTORED;
      continue;
    }
    if (/\bas\s*held\b|\bkeeps?\b|\bheld\b/.test(lower)) {
      territory = TERRITORY_AS_HELD;
      continue;
    }
    conditions.push(part.replace(/^(?:condition|conditions|other)\s*:\s*/i, ""));
  }
  return clampTerms({ territory, reparations, annexed, cessions, puppet, conditions }, { from, to });
};

// What an AI answers about peace in a chat, read from one line:
//   "accept"   "decline"   "offer as held; Borduria pays 2% for 5 years"   "counter restored; none"
// Returns { verdict, terms } (terms only for an offer or a counter), or null for nothing it can read.
//   from, to   the AI's country and the person's: who pays is read against them
export const PEACE_VERDICTS = Object.freeze(["accept", "decline", "offer", "counter"]);
export const readPeaceVerdict = (text, { from = "", to = "" } = {}) => {
  const line = clean(text, 400);
  const word = line.toLowerCase().match(/^(accept(?:s|ed)?|declin(?:e|es|ed)|refus(?:e|es|ed)|reject(?:s|ed)?|offer(?:s|ed)?|counter(?:-?offers?|s|ed)?)\b/);
  if (!word) return null;
  const head = word[1];
  const verdict = head.startsWith("accept") ? "accept" : head.startsWith("offer") ? "offer" : head.startsWith("counter") ? "counter" : "decline";
  if (verdict === "accept" || verdict === "decline") return { verdict };
  return { verdict, terms: readTermsLine(line.slice(word[0].length).replace(/^[\s:,-]+/, ""), { from, to }) };
};

// The open offers as a turn ends: those whose war is over, whose two parties
// no longer face each other in it, or that have stood too long, lapse. A turn
// makes no offer of its own: the AI does (offerFromAi).
//   offers   world.peaceOffers as the turn ends
//   wars     the war ledger as the turn ends
//   round    the turn it now is
export const withTurnPeaceOffers = (offers, { wars = [], round = 0 } = {}) => {
  const now = Math.max(0, Math.round(figure(round)));
  const warsById = new Map(list(wars).map((war) => [clean(war?.id), war]));
  return normalizePeaceOffers(offers).map((offer) => {
    if (offer.status !== "open") return offer;
    const war = warsById.get(offer.warId);
    // (A peace is between the two it was offered between: an offer of one war's
    // parties is no peace for a war fought by others, whatever its id.)
    const [first, second] = sidesOf(war).map((members) => new Set(members.map(fold)));
    const facing = (first.has(fold(offer.from)) && second.has(fold(offer.to))) || (first.has(fold(offer.to)) && second.has(fold(offer.from)));
    const stale = !war || !settleable(war) || !facing || now - offer.round >= PEACE_OFFER_STANDS_ROUNDS;
    return stale ? { ...offer, status: "lapsed", answeredRound: now } : offer;
  });
};

// An offer of peace an AI makes a person, checked: a war between the AI's
// country and the person's, the AI's side played by nobody, the person's
// country played. Returns { offer } or { reason } in words.
//   from, to     the AI's country, the person's
//   terms        { territory, reparations } as the AI wrote them (clampTerms)
//   wars         the war ledger
//   players      the countries people play
//   source       who made it (OFFER_SOURCES)
//   chatId, messageId   where it was made, where that is known
export const offerFromAi = ({ from = "", to = "", terms = null, wars = [], players = [], round = 0, date = "", source = "skip", chatId = "", messageId = "" } = {}) => {
  const played = new Set(list(players).map(fold).filter(Boolean));
  if (!clean(from) || !clean(to)) return { reason: "nobody named" };
  if (!played.has(fold(to))) return { reason: `${clean(to)} is played by nobody` };
  const war = warBetween(wars, from, to);
  if (!war) return { reason: `${clean(from)} and ${clean(to)} are not at war` };
  const theirs = sidesOf(war).find((members) => members.some((member) => fold(member) === fold(from)));
  if (theirs.some((member) => played.has(fold(member)))) return { reason: `${clean(from)}'s side is led by a person` };
  const now = Math.max(0, Math.round(figure(round)));
  const offer = normalizePeaceOffer({
    id: `peace:${clean(war.id)}:${fold(from)}:${now}`,
    warId: war.id,
    from: clean(from),
    to: clean(to),
    terms: clampTerms(withMoreTerms(terms, { from, to }), { from, to }),
    date,
    round: now,
    status: "open",
    source,
    chatId,
    messageId,
  });
  return offer ? { offer } : { reason: "unreadable" };
};

// A world's offers with one added. An open offer between the same two in the
// same war gives way to it: a new offer replaces the one on the table.
export const withOffer = (offers, offer) => {
  const read = normalizePeaceOffer(offer);
  if (!read) return normalizePeaceOffers(offers);
  const pair = (entry) => [fold(entry.from), fold(entry.to)].sort().join("|");
  const sameTable = (entry) => entry.status === "open" && entry.warId === read.warId && pair(entry) === pair(read);
  const kept = normalizePeaceOffers(offers)
    .filter((entry) => entry.id !== read.id)
    .map((entry) => (sameTable(entry) ? { ...entry, status: "lapsed", answeredRound: Math.max(1, read.round) } : entry));
  return normalizePeaceOffers([...kept, read]);
};

// A peace two countries nobody plays made, as a time skip tells it, checked:
// they fight on opposite sides of a war, and no person is on either side.
// Returns { treaty: { warId, from, to, terms } } or { reason } in words.
// A person's own offer waiting in that war (`offers`, world.peaceOffers) is the
// one peace there the skip may make: its receiver accepting it, on the terms
// offered, whatever the line says of them (`accepts`, the offer's id).
export const treatyFromSkip = ({ from = "", to = "", terms = null, wars = [], players = [], offers = [] } = {}) => {
  const played = new Set(list(players).map(fold).filter(Boolean));
  const war = warBetween(wars, from, to);
  if (!war) return { reason: `${clean(from) || "nobody"} and ${clean(to) || "nobody"} are not at war` };
  if (sidesOf(war).some((members) => members.some((member) => played.has(fold(member))))) {
    // (In any war still unsettled between the two: a ledger that started the war twice has twins, and the offer
    // may wait in the one warBetween did not find first. The peace ends both, warAndPeace.js makePeace.)
    const between = new Set(list(wars).filter((entry) => warBetween([entry], from, to)).map((entry) => clean(entry.id)));
    const offer = normalizePeaceOffers(offers).find((entry) => entry.status === "open" && between.has(clean(entry.warId))
      && ((fold(entry.from) === fold(from) && fold(entry.to) === fold(to)) || (fold(entry.from) === fold(to) && fold(entry.to) === fold(from)))
      && played.has(fold(entry.from)) && !played.has(fold(entry.to)));
    if (offer) {
      return { treaty: { warId: clean(offer.warId), from: offer.from, to: offer.to, terms: offer.terms, accepts: offer.id } };
    }
    return { reason: "a person is in that war: their peace is theirs to make" };
  }
  return { treaty: { warId: clean(war.id), from: clean(from), to: clean(to), terms: clampTerms(terms, { from, to }) } };
};

// The terms a time skip's letter offering peace carries (AI/gameplaySchemas.js
// peaceOfferSchema: territory, reparationsPayer, reparationsPercent,
// reparationsYears, moreTerms), as terms are kept here. Who receives any
// reparations is the other of the two making peace (clampTerms). moreTerms is
// any other term, written as a peaceTreaties line writes it ("Borduria is
// annexed; Klow passes to Syldavia"): kept as written (`more`), for it can only
// be read knowing the two making peace (withMoreTerms).
export const termsOfLetter = (offer) => {
  const payer = clean(offer?.reparationsPayer);
  const percent = figure(offer?.reparationsPercent);
  const years = Math.round(figure(offer?.reparationsYears));
  const more = clean(offer?.moreTerms, 1200);
  return {
    territory: fold(offer?.territory) === TERRITORY_AS_HELD ? TERRITORY_AS_HELD : TERRITORY_RESTORED,
    reparations: payer && percent > 0 && years > 0 ? { payer, receiver: "", share: percent / 100, years } : null,
    ...(more ? { more } : {}),
  };
};

// Terms with their `more` (termsOfLetter) read between the two making peace:
// the ground and the money stay as the letter's own fields gave them.
export const withMoreTerms = (raw, { from = "", to = "" } = {}) => {
  const more = clean(raw?.more, 1200);
  if (!more) return raw;
  const { territory, reparations, ...extras } = readTermsLine(more, { from, to });
  return { ...raw, ...extras };
};

// The peace lines of a time skip's answer (its peaceTreaties field), one a line:
//   offering country | accepting country | terms (readTermsLine)
// Returns [{ from, to, terms }]; a line it cannot read is left out.
export const readTreatyLines = (value) => {
  const lines = Array.isArray(value) ? value : String(value ?? "").split(/\r?\n/);
  const read = [];
  for (const raw of lines) {
    const parts = String(raw ?? "").replace(/^\s*[-*]\s*/, "").split("|").map((part) => clean(part, 400));
    if (parts.length < 2 || !parts[0] || !parts[1]) continue;
    const [from, to] = parts;
    read.push({ from, to, terms: readTermsLine(parts.slice(2).join("; "), { from, to }) });
  }
  return read;
};

// ---- reparations ----------------------------------------------------------------------------

// world.reparations: { id, warId, payer, receiver, share, since, days, paidDays }
//   share      of the payer's GDP, a year
//   days       how many days they run in all
//   paidDays   how many of those have been paid
export const normalizeReparation = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = clean(raw.id, 80);
  const payer = clean(raw.payer);
  const receiver = clean(raw.receiver);
  const share = figure(raw.share);
  const days = Math.round(figure(raw.days));
  if (!id || !payer || !receiver || fold(payer) === fold(receiver) || !(share > 0) || !(days > 0)) return null;
  const paidDays = within(Math.round(figure(raw.paidDays)), 0, days);
  return { id, warId: clean(raw.warId), payer, receiver, share: round(within(share, 0, 0.2), 4), since: clean(raw.since, 40), days, paidDays };
};

export const normalizeReparations = (value) => {
  const kept = new Map();
  for (const raw of list(value)) {
    const entry = normalizeReparation(raw);
    if (entry && entry.paidDays < entry.days) kept.set(entry.id, entry);
  }
  // Every one kept is still owed, and none is forgiven by a cut (more than 24
  // owed at once used to forgive the oldest).
  return keepOpenRows([...kept.values()], REPARATIONS_KEPT_MOST, () => true);
};

// The reparations a peace begins: [] for terms with none.
export const reparationsOf = (terms, { warId = "", date = "" } = {}) => {
  const payment = normalizeTerms(terms).reparations;
  if (!payment) return [];
  return [{ id: `reparations:${clean(warId)}:${fold(payment.payer)}:${clean(date, 40)}`, warId: clean(warId), payer: payment.payer, receiver: payment.receiver, share: payment.share, since: clean(date, 40), days: payment.years * 365, paidDays: 0 }];
};

// What a period's reparations come to.
//   reparations   world.reparations as the period begins
//   days          how long the period was
//   gdpOf         (name) => its GDP, 0 where its economy is not known
// Returns { reparations, payments }: the list to keep, and what was paid:
// [{ payer, receiver, amount, share }], `share` being the part of the payer's
// GDP that left it (so many points of it are owed more, or owed less).
export const reparationsDue = (reparations, { days = 0, gdpOf = null } = {}) => {
  const span = Math.max(0, Math.round(figure(days)));
  const kept = [];
  const payments = [];
  for (const entry of normalizeReparations(reparations)) {
    const paying = Math.min(span, entry.days - entry.paidDays);
    if (paying > 0) {
      const gdp = typeof gdpOf === "function" ? figure(gdpOf(entry.payer)) : 0;
      const share = (entry.share * paying) / 365;
      // (A payer with no economy on its sheet pays in the story only: the days still count.)
      if (gdp > 0) payments.push({ payer: entry.payer, receiver: entry.receiver, amount: gdp * share, share });
    }
    const next = { ...entry, paidDays: entry.paidDays + paying };
    if (next.paidDays < next.days) kept.push(next);
  }
  return { reparations: kept, payments };
};

// Reparations in a line: who pays whom how much, and for how much longer.
export const describeReparation = (entry) => {
  const read = normalizeReparation(entry);
  if (!read) return "";
  const left = Math.max(0, read.days - read.paidDays);
  const years = left / 365;
  const span = years >= 1 ? `${round(years, 1)} more ${round(years, 1) === 1 ? "year" : "years"}` : `${Math.max(1, Math.round(left / 30))} more ${Math.round(left / 30) <= 1 ? "month" : "months"}`;
  return `${read.payer} pays ${read.receiver} ${round(read.share * 100, 1)}% of its economy a year in reparations, for ${span}`;
};

// ---- treaties -------------------------------------------------------------------------------

// world.peaceTreaties: the last peaces made on terms, for the story to tell and the game to show.
//   { id, warId, title, date, round, from, to, sides: [[names], [names]], terms, by }
//   by   how it came about: "offer" (a person took one), "proposal" (a person's
//        own terms were taken), "settled" (two countries nobody plays)
export const TREATIES_KEPT_MOST = 12;
export const TREATY_WAYS = Object.freeze(["offer", "proposal", "settled"]);
export const normalizePeaceTreaties = (value) => {
  const kept = new Map();
  for (const raw of list(value)) {
    const id = clean(raw?.id, 120);
    const warId = clean(raw?.warId);
    if (!id || !warId) continue;
    kept.set(id, {
      id,
      warId,
      title: clean(raw.title),
      date: clean(raw.date, 40),
      round: Math.max(0, Math.round(figure(raw.round))),
      from: clean(raw.from),
      to: clean(raw.to),
      sides: [0, 1].map((side) => list(raw.sides?.[side]).map((name) => clean(name)).filter(Boolean).slice(0, MAX_WAR_SIDE_MEMBERS)),
      terms: normalizeTerms(raw.terms),
      by: TREATY_WAYS.includes(raw.by) ? raw.by : "offer",
    });
  }
  return [...kept.values()].slice(-TREATIES_KEPT_MOST);
};
