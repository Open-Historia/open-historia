/*! Open Historia — what an agreement does, as the AI wrote it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "dont have the numbers be hardcoded, make stats changes be done by the ai so
// it has actual context, make this true for all deals that already exist in
// the game" (the owner, 2026-11-19).
//
// Every agreement of the world (world.agreements: a country's treaty or a
// group's deal, whatever its type) carries the effects the AI wrote for it when
// it was made, from what it knew then: the parties' economies, their relation,
// the war, the terms agreed. The request that makes an agreement writes them
// (a chat's TREATY line, a group chat's treaties, the time skip's agreementUpdates
// start line); the engine (Game/AI/agreementEngine.js) carries out exactly what
// is written, once and on schedule, and never a number of its own. What an
// agreement with no effects does is nothing beyond what it always did: an old
// save's agreements stay as they were.
//
//   effects { months, onSign: [effect], perYear: [effect], onEnd: [effect], onBreak: [effect] }
//     months    how long it runs, in months; 0 (or none) for no set term. At its
//               term it expires and its onEnd effects are carried out
//     onSign    once, when it is made
//     perYear   while it is in force, written as YEARLY amounts (3 billion a
//               year is 3e9), because that is how people and treaties state
//               them; the engine applies a twelfth of each every month. (It was
//               `monthly`, one month's amount, which the model wrote as the
//               year's: a treaty paying 3 billion a year paid it every month.
//               A saved `monthly` list is read as twelve times itself.)
//     onEnd     once, when it ends at its term or by agreement
//     onBreak   once, when a party breaks it (the party may be written "breaker")
//
//   effect, one of (every name an exact party or country name, never an id):
//     stat       { type, party, stat, change }   a figure of a country's sheet, the
//                paths and measures of a project's effects (runtime/projectEngine.js):
//                stability, indices.<key>, military.<figure>, economy.gdp (%),
//                economy.publicDebt, economy.<rate>, population.total (%)
//     relation   { type, party, with, change }   the relation between two, in points
//     reputation { type, party, change }          a country's standing, 0-100
//     payment    { type, from, to, amount }       money in US dollars, paid by `from`'s
//                treasury (its public debt) to `to`'s
//     strength   { type, party, figure, change }  a group's own forces (militaryStats.js):
//                spending, technology, quality, land, sea, air
//     area       { type, group, op, region }      once only: a group takes ("take") or
//                gives up ("release") a region, by its name
//     war        { type, op }                     once only: a war between just the two
//                parties goes to "ceasefire" or "end"s
//
// THE CAPS (EFFECT_CAPS, a year's being twelve of a project's months). The AI
// decides freely; the engine only keeps one deal from transforming a country
// overnight, with the same footing as a project's effects (one project and one
// treaty are of a size): a 0-100 figure by at most 8 points at once and 6 a
// year, a GDP by 3 % at once and 3 % a year, and so on (STAT_BOUNDS, its month
// times 12). A relation moves at most 25 at once (a peace or an alliance is a
// large change, a war to a friendship is not one signature) and 24 a year. A
// payment is at most 5 % of the payer's GDP at once and 6 % a year (above the
// 4 % the harshest reparations take). A group's figures move at most 15 at once
// (arms delivered) and 12 a year. At most EFFECTS_MOST effects a list,
// AREA_MOST regions, and a term of at most MONTHS_MOST months.
//
// Pure and import-light: the world normalizer keeps these on every agreement.

import { STAT_BOUNDS, normalizeProjectEffect, statMeasure } from "./projectEngine.js";

export const AGREEMENT_EFFECT_TYPES = Object.freeze(["stat", "relation", "reputation", "payment", "strength", "area", "war"]);
export const AGREEMENT_EFFECT_LISTS = Object.freeze(["onSign", "perYear", "onEnd", "onBreak"]);
export const MONTHS_A_YEAR = 12;
export const GROUP_STRENGTH_FIGURES = Object.freeze(["spending", "technology", "quality", "land", "sea", "air"]);
// The one word a breach's effect may name its party by.
export const BREAKER = "breaker";
export const EFFECTS_MOST = 8;
export const AREA_MOST = 6;
export const MONTHS_MOST = 600;
export const PAYMENT_MOST = 1e13;
export const EFFECT_CAPS = Object.freeze({
  relation: { once: 25, year: 24 },
  reputation: { once: 10, year: 6 },
  // A share of the payer's GDP.
  payment: { once: 0.05, year: 0.06 },
  strength: { once: 15, year: 12 },
});

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value, most = 160) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value) => {
  const number = typeof value === "string" ? Number(value.replace(/[,_\s$]/g, "")) : Number(value);
  return Number.isFinite(number) ? number : NaN;
};
const within = (value, least, most) => Math.min(most, Math.max(least, value));
const round2 = (value) => Math.round(value * 100) / 100;

// The scale of a list: "once" for onSign/onEnd/onBreak, "year" for perYear.
export const scaleOfList = (list) => (list === "perYear" ? "year" : "once");

// One effect as an agreement keeps it, bounded on its scale; null for one the
// engine cannot carry out. The kind is the closed set's, as written.
export const normalizeAgreementEffect = (value, { scale = "once" } = {}) => {
  if (!isRecord(value)) return null;
  const type = asText(value.type, 20);
  if (!AGREEMENT_EFFECT_TYPES.includes(type)) return null;
  const party = asText(value.party, 120);
  if (type === "stat") {
    // A year's change is held directly against twelve of a project's months,
    // without rounding the twelfth to two decimals and dropping small annual changes.
    const year = scale === "year";
    const change = finite(value.change);
    if (!party || !Number.isFinite(change)) return null;
    if (year) {
      const probe = normalizeProjectEffect({ type: "stat", stat: value.stat, change: 1 }, { scale: "once" });
      if (!probe) return null;
      const cap = statCapOf(probe.stat, "year");
      const held = round2(within(change, -cap, cap));
      return held ? { type, party, stat: probe.stat, change: held } : null;
    }
    const held = normalizeProjectEffect({ type: "stat", stat: value.stat, change }, { scale });
    if (!held) return null;
    return { type, party, stat: held.stat, change: held.change };
  }
  if (type === "relation" || type === "reputation" || type === "strength") {
    const change = finite(value.change);
    if (!party || !Number.isFinite(change)) return null;
    const most = EFFECT_CAPS[type][scale];
    const held = round2(within(change, -most, most));
    if (!held) return null;
    if (type === "relation") {
      const other = asText(value.with, 120);
      if (!other || other.toLowerCase() === party.toLowerCase()) return null;
      return { type, party, with: other, change: held };
    }
    if (type === "strength") {
      const figure = asText(value.figure, 20);
      if (!GROUP_STRENGTH_FIGURES.includes(figure)) return null;
      return { type, party, figure, change: held };
    }
    return { type, party, change: held };
  }
  if (type === "payment") {
    const from = asText(value.from, 120);
    const to = asText(value.to, 120);
    const amount = finite(value.amount);
    if (!from || !to || from.toLowerCase() === to.toLowerCase() || !(amount > 0)) return null;
    return { type, from, to, amount: Math.round(Math.min(amount, PAYMENT_MOST)) };
  }
  if (scale !== "once") return null;
  if (type === "area") {
    const group = asText(value.group, 120);
    const op = asText(value.op, 10);
    const region = asText(value.region, 160).replace(/^region:\s*/i, "");
    if (!group || !region || !["take", "release"].includes(op)) return null;
    return { type, group, op, region };
  }
  const op = asText(value.op, 12);
  return ["ceasefire", "end"].includes(op) ? { type: "war", op } : null;
};

// A list as an agreement keeps it: each effect bounded, at most EFFECTS_MOST of them and AREA_MOST regions.
export const normalizeAgreementEffectList = (list, { scale = "once" } = {}) => {
  const out = [];
  let areas = 0;
  for (const raw of asArray(list)) {
    const effect = normalizeAgreementEffect(raw, { scale });
    if (!effect) continue;
    if (effect.type === "area" && (areas += 1) > AREA_MOST) continue;
    if (out.length >= EFFECTS_MOST) break;
    out.push(effect);
  }
  return out;
};

// A list written as one month's amounts (the former `monthly`), as a year's: twelve times each.
const yearOfMonthly = (list) => asArray(list).map((effect) => (isRecord(effect)
  ? {
    ...effect,
    ...(Number.isFinite(finite(effect.change)) ? { change: finite(effect.change) * MONTHS_A_YEAR } : {}),
    ...(Number.isFinite(finite(effect.amount)) ? { amount: finite(effect.amount) * MONTHS_A_YEAR } : {}),
  }
  : effect));

// An agreement's effects as the world keeps them, or null when it has none (an old save's, or one made with none).
// A `monthly` list (saved before perYear) is read as the year it makes.
export const normalizeAgreementEffects = (value) => {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.perYear) && Array.isArray(value.monthly)) value = { ...value, perYear: yearOfMonthly(value.monthly) };
  const months = Math.trunc(finite(value.months));
  const lists = Object.fromEntries(AGREEMENT_EFFECT_LISTS.map((list) => [list, normalizeAgreementEffectList(value[list], { scale: scaleOfList(list) })]));
  const any = AGREEMENT_EFFECT_LISTS.some((list) => lists[list].length);
  const term = Number.isFinite(months) && months > 0 ? Math.min(MONTHS_MOST, months) : 0;
  if (!any && !term) return null;
  return {
    ...(term ? { months: term } : {}),
    ...Object.fromEntries(AGREEMENT_EFFECT_LISTS.filter((list) => lists[list].length).map((list) => [list, lists[list]])),
  };
};

// Canonicalizes party and group names inside normalized agreement effects,
// preserving the "breaker" placeholder. When `parties` is provided, drops any
// effect targeting a party or group that is not a participant of the agreement.
export const canonicalizeAgreementEffects = (value, resolve = (name) => name, { resolveGroup = null, parties = null } = {}) => {
  const normalized = normalizeAgreementEffects(value);
  if (!normalized) return null;
  const partyOf = (name) => {
    const raw = asText(name, 120);
    if (!raw || raw.toLowerCase() === BREAKER) return raw;
    return asText(resolve(raw), 120) || raw;
  };
  const groupOf = (name) => {
    const raw = asText(name, 120);
    if (!raw || raw.toLowerCase() === BREAKER) return raw;
    const fn = resolveGroup || resolve;
    return asText(fn(raw), 120) || raw;
  };
  const allowed = Array.isArray(parties) && parties.length > 0
    ? new Set(parties.map((party) => asText(party, 120).toLowerCase()).filter(Boolean))
    : null;
  const targetAllowed = (name, listName) => {
    if (!allowed) return true;
    const folded = asText(name, 120).toLowerCase();
    if (!folded) return false;
    if (listName === "onBreak" && folded === BREAKER) return true;
    return allowed.has(folded);
  };
  const mapEffect = (effect) => {
    const next = { ...effect };
    if (next.party) next.party = partyOf(next.party);
    if (next.with) next.with = partyOf(next.with);
    if (next.from) next.from = partyOf(next.from);
    if (next.to) next.to = partyOf(next.to);
    if (next.group) next.group = groupOf(next.group);
    return next;
  };
  const keepEffect = (effect, listName) => {
    if (!allowed) return true;
    switch (effect.type) {
      case "stat":
      case "reputation":
      case "strength":
        return targetAllowed(effect.party, listName);
      case "relation":
        return targetAllowed(effect.party, listName) && targetAllowed(effect.with, listName);
      case "payment":
        return targetAllowed(effect.from, listName) && targetAllowed(effect.to, listName);
      case "area":
        return targetAllowed(effect.group, listName);
      case "war":
        return true;
      default:
        return false;
    }
  };
  const out = { ...(normalized.months ? { months: normalized.months } : {}) };
  for (const listName of AGREEMENT_EFFECT_LISTS) {
    if (!normalized[listName]?.length) continue;
    const kept = normalized[listName].map(mapEffect).filter((effect) => keepEffect(effect, listName));
    if (kept.length) out[listName] = kept;
  }
  return normalizeAgreementEffects(out);
};

// The cap of a stat on its scale ("once" or "year"), for the record shown to the player (projectEngine.js
// STAT_BOUNDS, a year twelve of its months).
export const statCapOf = (stat, scale = "once") => {
  const measure = statMeasure(stat);
  const table = measure === "custom" ? STAT_BOUNDS.points : STAT_BOUNDS[measure];
  if (!table) return 0;
  return scale === "year" ? table.month * MONTHS_A_YEAR : table.once;
};

// ---- the shape the AI writes ---------------------------------------------------------------

// The JSON schema of an agreement's effects: the one shape every request that makes an agreement
// writes (a chat's TREATY line, a group chat's treaties, the time skip's start line, the Game Master's
// agreementUpdates), checked where a request has a schema and read by normalizeAgreementEffects everywhere.
const effectItemSchema = (types) => ({
  type: "object",
  properties: {
    type: { type: "string", enum: types },
    party: { type: "string" },
    with: { type: "string" },
    stat: { type: "string" },
    change: { type: "number" },
    from: { type: "string" },
    to: { type: "string" },
    amount: { type: "number" },
    figure: { type: "string", enum: [...GROUP_STRENGTH_FIGURES] },
    group: { type: "string" },
    op: { type: "string", enum: ["take", "release", "ceasefire", "end"] },
    region: { type: "string" },
  },
  required: ["type"],
});
const ONCE_TYPES = [...AGREEMENT_EFFECT_TYPES];
const YEARLY_TYPES = AGREEMENT_EFFECT_TYPES.filter((type) => type !== "area" && type !== "war");
export const AGREEMENT_EFFECTS_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    months: { type: "integer" },
    onSign: { type: "array", items: effectItemSchema(ONCE_TYPES) },
    perYear: { type: "array", items: effectItemSchema(YEARLY_TYPES) },
    onEnd: { type: "array", items: effectItemSchema(ONCE_TYPES) },
    onBreak: { type: "array", items: effectItemSchema(ONCE_TYPES) },
  },
});

// How an agreement's effects are written, in every request that makes one (the time skip,
// a chat's TREATY line, a group chat's treaties): one shared text, compact.
export const AGREEMENT_EFFECTS_FORMAT = `Effects are a JSON object {"months":N,"onSign":[],"perYear":[],"onEnd":[],"onBreak":[]}: months is the term (0 for none); onSign once when made, perYear what it does each year in force, written as a year's amounts (the game applies a twelfth each month), onEnd once at its end, onBreak once if a party breaks it (that party may be written "breaker"). Each item is one of {"type":"stat","party":P,"stat":"stability|indices.<key>|military.<figure>|economy.gdp|economy.publicDebt|economy.budgetBalance|population.total","change":N} (gdp and population.total in %, the rest in points), {"type":"relation","party":P,"with":Q,"change":N}, {"type":"reputation","party":P,"change":N}, {"type":"payment","from":P,"to":Q,"amount":USD}, {"type":"strength","party":GROUP,"figure":"spending|technology|quality|land|sea|air","change":N}, {"type":"area","group":GROUP,"op":"take|release","region":"exact region name"} (once only), {"type":"war","op":"ceasefire|end"} (once only, between just the parties). onSign is only what changes hands at signing; a relation item moves the pair's one relation, so write it once a pair. Write them from the parties' real means and the terms: what each side actually gives and gets. The game applies exactly these, within its caps, and nothing else.`;
