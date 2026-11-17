/*! Open Historia — the campaign's history in tiers, and the canon that never fades © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The history document (Game/AI/historyConsolidation.js) was one text kept near
// a word budget: every fold rewrote it whole, and to make room the model
// condensed what it judged least important, so a treaty or a death from the
// first years could be condensed out of a long campaign. It is kept in tiers
// now, each with its own budget, and the facts that must never fade are kept
// apart from all of them:
//   historyDocument.years   [{ year, text }]: a paragraph per game year, the
//                           newest HISTORY_YEARS_KEPT of them;
//   historyDocument.eras    [{ from, to, text }]: the older years, rolled up;
//   world.canonFacts        [{ date, kind, text, key }]: treaties, deaths,
//                           regime and border changes, office holders. Never
//                           condensed and never dropped from the save. A fact
//                           with a `key` (an office) is superseded on the page
//                           by a later fact with the same key, and stays in the
//                           save.
// A time skip's history answer fills them (its "years", "eras" and "canon"),
// judgeHistoryTiers takes each entry on its own merits, and renderHistoryTiers
// gives each tier its own share of the prompt. A save from before keeps its
// document as the first era until a fold writes years.
//
// Sizes are counted in characters, as the prompt is given them. They were
// counted in words split on spaces: a paragraph in Chinese, Japanese or Thai,
// which put no spaces between their words, was one word, so every year a fold
// wrote in those languages was refused as "too thin" and its eras as a stub.
//
// Import-free: the world normaliser, the fold and the prompt all read it.

const norm = (value) => String(value ?? "").trim();
const flat = (value) => norm(value).replace(/\s+/g, " ");
const chars = (value) => flat(value).length;
const whole = (value) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : NaN);

export const HISTORY_TIERS = Object.freeze({
  // The newest game years kept as a paragraph each; older ones roll into eras.
  yearsKept: 3,
  // The most canon facts the save keeps (oldest superseded ones go first).
  canonMost: 400,
  // What each tier is given of the prompt, in characters. Eras longer than
  // their share are condensed by the next fold, so the prompt shows them all.
  canonChars: 5000,
  eraChars: 4500,
  yearChars: 6500,
});

export const CANON_KINDS = Object.freeze(["treaty", "death", "regime", "border", "office", "war", "other"]);

// A date as the game writes it: a year (negative before AD 1), a month, a day.
const DATE = /^-?\d{1,5}(?:-\d{2}(?:-\d{2})?)?$/;
export const yearOfDate = (date) => {
  const match = /^(-?\d{1,5})/.exec(norm(date));
  return match ? Number(match[1]) : NaN;
};
const compareDates = (a, b) => {
  const ya = yearOfDate(a);
  const yb = yearOfDate(b);
  if (ya !== yb) return (Number.isFinite(ya) ? ya : 0) - (Number.isFinite(yb) ? yb : 0);
  return norm(a).replace(/^-?\d+/, "").localeCompare(norm(b).replace(/^-?\d+/, ""));
};

export const normalizeCanonFact = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const date = norm(raw.date);
  const text = flat(raw.text ?? raw.fact).slice(0, 400);
  if (!DATE.test(date) || text.length < 3) return null;
  const kind = CANON_KINDS.includes(norm(raw.kind).toLowerCase()) ? norm(raw.kind).toLowerCase() : "other";
  const key = flat(raw.key).slice(0, 120);
  return { date, kind, text, ...(key ? { key } : {}) };
};

// The save's canon: valid facts, each once, in date order, at most canonMost
// (the oldest superseded facts are let go first, then the oldest).
export const normalizeCanonFacts = (value) => {
  const seen = new Set();
  const facts = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const fact = normalizeCanonFact(raw);
    if (!fact) continue;
    const id = `${fact.date}|${fact.text.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    facts.push(fact);
  }
  facts.sort((a, b) => compareDates(a.date, b.date));
  if (facts.length <= HISTORY_TIERS.canonMost) return facts;
  const superseded = supersededFacts(facts);
  const over = facts.length - HISTORY_TIERS.canonMost;
  const dropped = new Set([...superseded].slice(0, over));
  const kept = facts.filter((fact) => !dropped.has(fact));
  return kept.slice(Math.max(0, kept.length - HISTORY_TIERS.canonMost));
};

// The facts a later fact with the same key replaces on the page.
const supersededFacts = (facts) => {
  const latest = new Map();
  for (const fact of facts) if (fact.key) latest.set(fact.key.toLowerCase(), fact);
  return new Set(facts.filter((fact) => fact.key && latest.get(fact.key.toLowerCase()) !== fact));
};

export const normalizeHistoryYears = (value) => {
  const byYear = new Map();
  for (const raw of Array.isArray(value) ? value : []) {
    const year = whole(raw?.year);
    const text = norm(raw?.text);
    if (!Number.isFinite(year) || !text) continue;
    byYear.set(year, { year, text });
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
};

export const normalizeHistoryEras = (value) => (Array.isArray(value) ? value : [])
  .map((raw) => {
    const from = whole(raw?.from);
    const to = whole(raw?.to);
    const text = norm(raw?.text);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || !text) return null;
    return { from, to, text };
  })
  .filter(Boolean)
  .sort((a, b) => a.from - b.from || a.to - b.to);

export const hasHistoryTiers = (document) =>
  normalizeHistoryYears(document?.years).length > 0 || normalizeHistoryEras(document?.eras).length > 0;

// ---- what a fold's answer gives ------------------------------------------------

// Each tier of a fold's answer, entry by entry: what is malformed is left out,
// and said so; what is good is taken. `span` is the years the folded material
// covers ([first, last]); a year paragraph outside it (by more than a year) is
// not about this material and is left out. `eraChars` is how many characters
// the campaign's eras have: a revision of them that would keep less than a
// third is a stub, not a condensation, and is left out.
export const judgeHistoryTiers = (answer, { span = null, eraChars = 0 } = {}) => {
  const source = answer && typeof answer === "object" && !Array.isArray(answer) ? answer : {};
  const notes = [];
  const [first, last] = Array.isArray(span) && span.length === 2 && span.every(Number.isFinite) ? span : [-Infinity, Infinity];
  const years = [];
  for (const raw of Array.isArray(source.years) ? source.years : []) {
    const year = whole(raw?.year);
    const text = norm(raw?.text);
    if (!Number.isFinite(year) || !text) {
      notes.push(`a year paragraph${Number.isFinite(year) ? ` for ${year} had no text` : " had no year"}`);
      continue;
    }
    if (year < first - 1 || year > last + 1) {
      notes.push(`the paragraph for ${year} is outside the years folded (${first}–${last})`);
      continue;
    }
    years.push({ year, text });
  }
  let eras = null;
  if (Array.isArray(source.eras) && source.eras.length) {
    const taken = normalizeHistoryEras(source.eras);
    const written = taken.reduce((sum, era) => sum + chars(era.text), 0);
    if (taken.length && written >= eraChars / 3) eras = taken;
    else notes.push(`the eras came back at ${written} characters against the ${eraChars} the campaign has, and are left as they were`);
  }
  const canon = [];
  for (const raw of Array.isArray(source.canon) ? source.canon : []) {
    const fact = normalizeCanonFact(raw);
    if (fact) canon.push(fact);
    else notes.push("a canon fact without a date or a text was left out");
  }
  return { years: normalizeHistoryYears(years), eras, canon, notes, any: years.length > 0 || Boolean(eras) || canon.length > 0 };
};

// The document with a fold's tiers written in. A year paragraph replaces that
// year's; years beyond the newest yearsKept roll into the last era (a new one
// when there is none, or when the last one ends more than a year earlier); a
// revision of the eras replaces them. A document from before the tiers keeps
// its text as the first era, covering everything up to the first year written.
export const mergeHistoryTiers = (document, { years = [], eras = null } = {}, { startYear = NaN } = {}) => {
  let currentEras = normalizeHistoryEras(document?.eras);
  let currentYears = normalizeHistoryYears(document?.years);
  const legacy = norm(document?.text);
  const incoming = normalizeHistoryYears(years);
  if (legacy && !currentEras.length && !currentYears.length && (incoming.length || eras)) {
    const firstYear = incoming[0]?.year ?? yearOfDate(document?.throughDate);
    const to = Number.isFinite(firstYear) ? firstYear - 1 : NaN;
    const from = Number.isFinite(startYear) ? Math.min(startYear, Number.isFinite(to) ? to : startYear) : to;
    if (Number.isFinite(from) && Number.isFinite(to)) currentEras = [{ from, to: Math.max(from, to), text: legacy }];
  }
  const byYear = new Map(currentYears.map((entry) => [entry.year, entry]));
  for (const entry of incoming) byYear.set(entry.year, entry);
  currentYears = [...byYear.values()].sort((a, b) => a.year - b.year);
  if (eras) {
    // A revision of the eras replaces them, except an era older than every one
    // it gives (it was not revised, only left out), and except an era of years
    // still kept as paragraphs, which says them twice.
    const firstKept = currentYears.slice(-HISTORY_TIERS.yearsKept)[0]?.year ?? Infinity;
    const revised = normalizeHistoryEras(eras).filter((era) => era.from < firstKept);
    if (revised.length) currentEras = [...currentEras.filter((era) => era.to < revised[0].from), ...revised];
  }
  while (currentYears.length > HISTORY_TIERS.yearsKept) {
    const oldest = currentYears.shift();
    const last = currentEras.at(-1);
    if (last && last.to >= oldest.year - 1 && last.from <= oldest.year) {
      currentEras = [...currentEras.slice(0, -1), { from: last.from, to: Math.max(last.to, oldest.year), text: `${last.text}\n${oldest.year}: ${oldest.text}` }];
    } else {
      currentEras = [...currentEras, { from: oldest.year, to: oldest.year, text: `${oldest.year}: ${oldest.text}` }];
    }
  }
  return { eras: currentEras, years: currentYears };
};

// How long the campaign's eras are, in characters. A document from before the
// tiers counts its text: mergeHistoryTiers makes it the first era, so a fold's
// eras answer is judged against it. Counted as 0, a stub of eras the model
// wrote unasked replaced it whole (a 1939 campaign's first year and more,
// 2026-11-10).
export const eraCharCount = (document) => {
  const eras = normalizeHistoryEras(document?.eras);
  if (!eras.length && !normalizeHistoryYears(document?.years).length) return chars(document?.text);
  return eras.reduce((sum, era) => sum + chars(era.text), 0);
};

// ---- what the prompt is shown --------------------------------------------------

const span = (era) => (era.from === era.to ? `${era.from}` : `${era.from}–${era.to}`);

// Newest first within a budget, shown oldest first; what did not fit is counted.
const fitNewest = (items, render, budget) => {
  const kept = [];
  let used = 0;
  for (const item of [...items].reverse()) {
    const text = render(item);
    if (kept.length && used + text.length + 1 > budget) break;
    kept.unshift(text);
    used += text.length + 1;
  }
  return { kept, left: items.length - kept.length };
};

// The canon as the prompt gives it: every fact not superseded, in date order,
// newest first within its budget; what did not fit is counted, and stays in the
// save. "" when there is none.
export const renderCanonFacts = (facts, { maxChars = HISTORY_TIERS.canonChars } = {}) => {
  const all = normalizeCanonFacts(facts);
  if (!all.length) return "";
  const superseded = supersededFacts(all);
  const shown = all.filter((fact) => !superseded.has(fact));
  const { kept, left } = fitNewest(shown, (fact) => `- ${fact.date} (${fact.kind}): ${fact.text}`, maxChars);
  return [
    "CANON (standing facts of this campaign: they hold until a later fact here says otherwise):",
    ...(left ? [`[${left} older fact(s) omitted here; they remain canon in the save.]`] : []),
    ...kept,
  ].join("\n");
};

// The eras and the years, each within its own budget. `scale` shrinks every
// budget alike, for a task given less room. "" when there are no tiers.
export const renderHistoryTiers = (document, { scale = 1 } = {}) => {
  const eras = normalizeHistoryEras(document?.eras);
  const years = normalizeHistoryYears(document?.years);
  if (!eras.length && !years.length) return "";
  const factor = Number.isFinite(scale) && scale > 0 ? Math.min(1, scale) : 1;
  const parts = [];
  if (eras.length) {
    const { kept, left } = fitNewest(eras, (era) => `${span(era)}: ${flat(era.text)}`, Math.max(400, HISTORY_TIERS.eraChars * factor));
    parts.push("EARLIER YEARS, IN ERAS:", ...(left ? [`[${left} older era(s) omitted here; they remain in the save.]`] : []), ...kept);
  }
  if (years.length) {
    const { kept, left } = fitNewest(years, (entry) => `${entry.year}: ${flat(entry.text)}`, Math.max(600, HISTORY_TIERS.yearChars * factor));
    if (parts.length) parts.push("");
    parts.push("YEAR BY YEAR:", ...(left ? [`[${left} older year(s) omitted here; they remain in the save.]`] : []), ...kept);
  }
  return parts.join("\n");
};
