/*! Open Historia — the canonical war record © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The one shape a war in world.wars has, and the rules every war keeps, for
// everything that reads or writes the ledger: the time skip and the Game
// Master (Game/AI/nativeWarLedger.js), the world's own normalizer
// (gameState.js), the pre-game history, the fronts, peace and alliances.
//
// The owner, 2026-11-13: "the entire war foundational archetecture is pretty
// weak". What was weak, and what this file now holds for all of them:
//
// - IDENTITY. A war's id is that war's for as long as the game lasts. A war
//   that ended and flares again is a NEW war with an id of its own and a link
//   to the one it renews (`renews`); the old record, its dates and everything
//   that names it (a peace offer, a treaty, reparations, the events it was
//   fought in) stay the old war's. A `start` under an ended war's id used to
//   overwrite that war in place, and a peace offered in the first war could be
//   accepted in the second.
// - SIDES. A side holds every member it is given, up to one bound for every
//   reader (MAX_WAR_SIDE_MEMBERS). The ledger kept 12 a side and read an
//   event's combatants as 8, and which members survived the cut was decided by
//   the order they were written in.
// - RETENTION. A war that is being fought, or holds in a ceasefire, is never
//   cut. Ended wars are history: they are kept, newest first, up to
//   MAX_ENDED_WARS, and an ended war something else in the world still names
//   (a treaty, reparations, an offer, a battlefield, a war that renews it) is
//   kept whatever its age. Both normalizers used to cut the whole list at 64,
//   in different places, whoever still named the war.
// - ONE NORMALIZER. The ledger's and the world's normalizers had drifted
//   apart: different id fallbacks (an array position, which moves when the
//   list is sorted), title repairs, date forms and caps.
//
// Pure: no world access beyond what it is handed, no model, no I/O.

import { toCountryName } from "./ownerNames.js";
import { compareGameDates, normalizeGameDate } from "./gameDates.js";

export const WAR_STATUSES = Object.freeze(["active", "ceasefire", "ended"]);
const STATUS_SET = new Set(WAR_STATUSES);
// Being fought, or held in a ceasefire: a war that is not over.
export const LIVE_WAR_STATUSES = Object.freeze(new Set(["active", "ceasefire"]));

// The most members one side of one war holds, and the most combatants one
// event names. One bound for every reader: a coalition the ledger keeps is a
// coalition the fronts, the peace and the prompts see whole.
export const MAX_WAR_SIDE_MEMBERS = 64;

// Ended wars kept as history, newest first. Wars something else still names
// are kept beyond it (see normalizeWarRecords).
export const MAX_ENDED_WARS = 400;

// The events and storylines a war remembers. The first source event is the
// war's opening and is kept whatever follows; the rest are the newest.
export const MAX_WAR_SOURCE_EVENTS = 24;
export const MAX_WAR_STORYLINES = 12;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const wholeRound = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.trunc(Number(value)) : 0);

// A polity as a war names it: the country a code stands for ("FRA"), else the
// name as written. Exact: only case and spacing are forgiven, never another
// spelling (feedback: polity names are exact).
export const warPolityName = (value) => {
  const raw = clean(value);
  if (!raw) return "";
  return clean(toCountryName(raw)) || raw;
};

export const warPolityKey = (value) => warPolityName(value).toLocaleLowerCase();

// A polity's name has a letter in it: "1" and "2" on a side are event numbers
// written a field early (a time skip's "United Kingdom,Ireland~1,2").
const hasLetter = (value) => /\p{L}/u.test(value);

// The members of a list of polities, each once, in the order given.
export const warMembers = (value, limit = MAX_WAR_SIDE_MEMBERS) => {
  const seen = new Set();
  const result = [];
  for (const raw of asArray(value)) {
    const name = warPolityName(raw);
    const key = name.toLocaleLowerCase();
    if (!name || !hasLetter(name) || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
    if (result.length >= limit) break;
  }
  return result;
};

// A game date in its one written form ("-0218-03-01" for 218 BC), or "".
export const warDate = (value) => {
  const text = clean(value);
  if (!text) return "";
  const canonical = normalizeGameDate(text);
  if (canonical) return canonical;
  const prefix = /^(-?\d{4}-\d{2}-\d{2})[T ]/.exec(text);
  return prefix ? normalizeGameDate(prefix[1]) || "" : "";
};

// An id as it is kept: one line, no record separator in it ("~" splits a
// compact war record, so an id holding one could never be written back).
export const cleanWarId = (value) => clean(value).replace(/[~|]+/g, "-");

// A name as it stands in an id: ASCII letters and digits.
export const warIdPart = (value) => warPolityName(value)
  .normalize("NFKD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 40) || "belligerent";

// The id a war is given from what it is, when nothing gave it one: its two
// leading members (in a fixed order, so either side's writing gives the same)
// and the day it began. Never an array position: a list is sorted and filtered,
// and a war named after where it stood was another war's on the next read.
export const contentWarId = ({ sideA = [], sideB = [], startedDate = "" } = {}) => {
  const parts = [warMembers(sideA)[0], warMembers(sideB)[0]].filter(Boolean).map(warIdPart).sort();
  const day = warDate(startedDate).replace(/[^0-9]/g, "") || "undated";
  return `war-${parts.join("-") || "unnamed"}-${day}`.slice(0, 120);
};

// A renewal's suffix: "war-uk-ireland-2016" flares again as
// "war-uk-ireland-2016-r2", then "-r3". Written so the stem is always
// recoverable, whatever the model's own id ends with (a year is not a suffix).
const RENEWAL_SUFFIX_RE = /-r(\d+)$/;
export const warIdStem = (id) => cleanWarId(id).replace(RENEWAL_SUFFIX_RE, "");

// A new id from `base` that no war in `taken` (a Set of ids) holds: the base
// itself if it is free, else its stem's next free renewal number.
export const mintWarId = (base, taken) => {
  const root = cleanWarId(base) || "war";
  const occupied = taken instanceof Set ? taken : new Set(asArray(taken));
  if (!occupied.has(root)) return root;
  const stem = warIdStem(root);
  for (let number = 2; number < 10000; number += 1) {
    const candidate = `${stem}-r${number}`;
    if (!occupied.has(candidate)) return candidate;
  }
  return `${stem}-r${occupied.size + 2}`;
};

// What a war remembers of the events it was told in: its first (the opening)
// and the newest.
const keepSourceEvents = (ids) => {
  const unique = [...new Set(asArray(ids).map(clean).filter(Boolean))];
  if (unique.length <= MAX_WAR_SOURCE_EVENTS) return unique;
  return [unique[0], ...unique.slice(-(MAX_WAR_SOURCE_EVENTS - 1))];
};

// A war's two sides as written: no member on both (the first side keeps it),
// and two parties written on one side with nobody on the other are one on
// each (a start whose event numbers stood where the opponents go).
export const warSidesOf = (sideA, sideB) => {
  const a = warMembers(sideA);
  const keys = new Set(a.map((name) => name.toLocaleLowerCase()));
  const b = warMembers(sideB).filter((name) => !keys.has(name.toLocaleLowerCase()));
  return b.length === 0 && a.length === 2 ? [[a[0]], [a[1]]] : [a, b];
};

// The canonical war record, or null when what is given cannot be one (no two
// opposing sides). `fallbackId` is used for a record that carries no id.
export const normalizeWarRecord = (entry, { fallbackId = "" } = {}) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const [sideA, sideB] = warSidesOf(entry.sideA, entry.sideB);
  if (!sideA.length || !sideB.length) return null;

  const rawStatus = clean(entry.status).toLowerCase();
  const status = STATUS_SET.has(rawStatus) ? rawStatus : "active";
  const startedDate = warDate(entry.startedDate);
  const id = cleanWarId(entry.id) || cleanWarId(fallbackId) || contentWarId({ sideA, sideB, startedDate });

  // A name saved with its cause run on after a "~" or "|" ("Franco-Italian
  // War~Dispute over…"): the name is what comes before it, and the rest is the
  // cause where none was kept.
  const [savedTitle, ...runOn] = clean(entry.title).split(/\s*[~|]\s*/);
  const title = savedTitle || `${sideA[0]}–${sideB[0]} War`;
  const cause = clean(entry.cause) || runOn.join(" ").trim();

  const war = {
    id,
    title,
    status,
    sideA,
    sideB,
    startedDate,
    endedDate: status === "ended" ? warDate(entry.endedDate || entry.lastUpdatedDate) : "",
    lastUpdatedDate: warDate(entry.lastUpdatedDate || entry.startedDate),
    cause,
    note: clean(entry.note),
    sourceEventIds: keepSourceEvents(entry.sourceEventIds),
    storylineIds: [...new Set(asArray(entry.storylineIds).map(clean).filter(Boolean))].slice(-MAX_WAR_STORYLINES),
    createdRound: wholeRound(entry.createdRound),
    updatedRound: wholeRound(entry.updatedRound),
  };
  // The ended war this one renews: kept only when there is one, so a record
  // that renews nothing has the shape it always had.
  const renews = cleanWarId(entry.renews);
  if (renews && renews !== id) war.renews = renews;
  return war;
};

const STATUS_RANK = Object.freeze({ active: 0, ceasefire: 1, ended: 2 });
const byStanding = (a, b) =>
  (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
  || compareGameDates(b.lastUpdatedDate || b.startedDate || "", a.lastUpdatedDate || a.startedDate || "")
  || a.id.localeCompare(b.id);

// The ids of wars that something else in the world names: what keeps an ended
// war in the ledger beyond MAX_ENDED_WARS. Peace offers, treaties, reparations,
// calls to arms, battlefields, transports and sea battles are each a war's, by id.
const WAR_ID_HOLDERS = Object.freeze(["peaceOffers", "peaceTreaties", "reparations", "callsToArms", "battlefields", "transports", "seaBattles"]);
export const referencedWarIds = (world) => {
  const ids = new Set();
  if (!world || typeof world !== "object") return ids;
  for (const key of WAR_ID_HOLDERS) {
    for (const row of asArray(world[key])) {
      const id = cleanWarId(row?.warId);
      if (id) ids.add(id);
    }
  }
  return ids;
};

// The wars of a world, each once, in the order the ledger keeps them: being
// fought, then in ceasefire, then ended; newest first within each.
//
// - A record without an id gets one from what it is (contentWarId), made
//   unique against the others.
// - Two records under one id are one war's: the later one in the list is its
//   newer state (the ledger appends), as it always was.
// - Nothing live is cut. Ended wars beyond MAX_ENDED_WARS go oldest first,
//   except those `keep` names (a Set of ids, e.g. referencedWarIds(world)) and
//   those a kept war renews.
export const normalizeWarRecords = (value, { keep = null } = {}) => {
  const byId = new Map();
  const unnamed = [];
  for (const entry of asArray(value)) {
    const war = normalizeWarRecord(entry);
    if (!war) continue;
    if (!cleanWarId(entry?.id)) {
      unnamed.push(war);
      continue;
    }
    byId.set(war.id, war);
  }
  const taken = new Set(byId.keys());
  for (const war of unnamed) {
    const id = mintWarId(war.id, taken);
    taken.add(id);
    byId.set(id, { ...war, id });
  }

  const wars = [...byId.values()].sort(byStanding);
  const ended = wars.filter((war) => war.status === "ended");
  if (ended.length <= MAX_ENDED_WARS) return wars;

  const held = new Set(keep instanceof Set ? keep : asArray(keep).map(cleanWarId));
  for (const war of wars) if (war.renews) held.add(war.renews);
  // (Renewal chains: a kept war's renewal target keeps its own target.)
  for (let changed = true; changed;) {
    changed = false;
    for (const war of ended) {
      if (held.has(war.id) && war.renews && !held.has(war.renews)) {
        held.add(war.renews);
        changed = true;
      }
    }
  }
  // The newest MAX_ENDED_WARS, and every older one still named.
  const kept = new Set(ended.slice(0, MAX_ENDED_WARS).map((war) => war.id));
  for (const war of ended) if (held.has(war.id)) kept.add(war.id);
  return wars.filter((war) => war.status !== "ended" || kept.has(war.id));
};

// A war's records by id, and which war renews which: what resolving a
// reference needs.
export const warIndex = (wars) => {
  const byId = new Map();
  const renewedBy = new Map();
  for (const war of asArray(wars)) {
    if (!war?.id) continue;
    byId.set(war.id, war);
  }
  for (const war of byId.values()) {
    if (war.renews && byId.has(war.renews)) renewedBy.set(war.renews, war.id);
  }
  return { byId, renewedBy };
};

// The war an id written by the model means now: that war while it is not over;
// once it is over and has been renewed, the newest war renewing it that is
// (the model keeps writing the first war's id for the fighting that flared
// again); else the war itself, ended. Null for an id no war has held.
export const resolveWarReference = (index, id) => {
  const key = cleanWarId(id);
  const war = index?.byId?.get(key) || null;
  if (!war || war.status !== "ended") return war;
  let current = war;
  const seen = new Set([current.id]);
  while (index.renewedBy.has(current.id)) {
    const next = index.byId.get(index.renewedBy.get(current.id));
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    current = next;
  }
  return current;
};

// A store of a war's open business (peace offers, calls to arms, reparations
// owed) as it is kept: every row still open, and of the settled ones the newest,
// as many as `most` leaves room for; in the order given. Each store used to keep
// its last `most` rows whatever they were, so an offer still waiting for its
// answer, or a call to arms nobody had answered, fell off the end of the list
// once enough had been settled after it.
export const keepOpenRows = (rows, most, isOpen) => {
  const list = asArray(rows);
  const settled = list.filter((row) => !isOpen(row));
  const room = Math.max(0, Math.trunc(Number(most) || 0) - (list.length - settled.length));
  const keptSettled = new Set(room > 0 ? settled.slice(-room) : []);
  return list.filter((row) => isOpen(row) || keptSettled.has(row));
};

// Which side of a war a polity is on: "A", "B", or "" for neither.
export const warSideOf = (war, name) => {
  const key = warPolityKey(name);
  if (!key || !war) return "";
  if (asArray(war.sideA).some((member) => warPolityKey(member) === key)) return "A";
  if (asArray(war.sideB).some((member) => warPolityKey(member) === key)) return "B";
  return "";
};

// Whether every one of `names` stands in the war, and at least one on each side.
export const namesFightWar = (war, names) => {
  const sides = asArray(names).map((name) => warSideOf(war, name));
  return sides.length >= 2 && sides.every(Boolean) && sides.includes("A") && sides.includes("B");
};
