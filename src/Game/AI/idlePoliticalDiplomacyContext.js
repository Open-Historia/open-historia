/*! Open Historia Continuum — bounded PWv2 context for idle/event diplomacy. */
import { getPoliticalProfile } from "../../runtime/politicalActors.js";
import { livePuppetsFor } from "../../runtime/puppets.js";
import { compareGameDatesNewestFirst } from "../../runtime/gameDates.js";
import { buildBoundedPoliticalDecisionContextSet, buildPoliticalDecisionContext } from "./politicalDecisionContext.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => Array.isArray(value) ? value : [];
const lower = (value) => clean(value).toLocaleLowerCase();

// How many governments a note's request carries the background of: the most
// relevant, the latest to have had anything happen first. The owner, 2026-11-01:
// "up to 20 can have background info and if there are more than 20 it picks the
// top 20 most relevant that have had things happen in order of recency".
export const IDLE_BACKGROUND_LIMIT = 20;
// A campaign where nothing has happened yet still lets a few write.
const QUIET_BACKGROUND_COUNT = 6;
// How far back the event feed is read for who it involved (newest first).
const EVENTS_READ = 400;
const CAPSULE_LIMITS = Object.freeze({
  traits: 6,
  goals: 4,
  fears: 4,
  ambitions: 4,
  domesticPressures: 4,
  pressureIssues: 4,
  governingEntities: 3,
  oppositionEntities: 2,
  perceptions: 3,
  relations: 4,
  agreements: 4,
  wars: 3,
  institutions: 5,
  institutionLifecycleCases: 4,
});
const CAPSULE_CHARS = 1400;

// The governments that may write: every polity with a political profile but
// the player's and the dissolved, by the one name the world gives each
// (politicalActors.byPolity keys), in their stored order.
const eligiblePolities = (world, player) => {
  const playerActor = getPoliticalProfile(world, player);
  return Object.keys(world?.politicalActors?.byPolity || {})
    .map(clean)
    .filter((name) => name
      && lower(name) !== lower(player)
      && world.politicalActors.byPolity[name] !== playerActor
      && lower(world?.polityOverrides?.[name]?.status) !== "dissolved");
};

// Exact names only: a polity's own name, or the code its own record carries.
// No aliases, no near spellings (the owner's rule: one normal country name).
const exactNamer = (world, names) => {
  const byName = new Map(names.map((name) => [lower(name), name]));
  for (const [key, record] of Object.entries(world?.polityOverrides || {})) {
    const name = byName.get(lower(record?.name)) || byName.get(lower(key));
    if (!name) continue;
    if (clean(key)) byName.set(lower(key), name);
    if (clean(record?.code)) byName.set(lower(record.code), name);
  }
  return (value) => byName.get(lower(value?.name || value?.code || value?.polity || value)) || "";
};

// Where an exact name stands in a text as a whole name, longest names first so
// that "Niger" is not read inside "Nigeria" nor "Congo" inside "Republic of the Congo".
const namesInText = (textValue, names) => {
  const textOf = String(textValue ?? "");
  if (!textOf) return [];
  const taken = [];
  const found = [];
  const isWordChar = (char) => Boolean(char) && /[\p{L}\p{N}]/u.test(char);
  for (const name of names) {
    let from = 0;
    for (;;) {
      const at = textOf.indexOf(name, from);
      if (at < 0) break;
      const end = at + name.length;
      from = at + 1;
      if (isWordChar(textOf[at - 1]) || isWordChar(textOf[end])) continue;
      if (taken.some(([start, stop]) => at < stop && end > start)) continue;
      taken.push([at, end]);
      if (!found.includes(name)) found.push(name);
    }
  }
  return found;
};

// The polities one event involves, by its structured fields, and its title and
// description where they name a polity exactly.
const polityNamesInEvent = (event, world, nameOf, byLength) => {
  const out = [];
  const add = (value) => {
    const name = nameOf(value);
    if (name && !out.includes(name)) out.push(name);
  };
  const impacts = event?.impacts || {};
  list(event?.combatants).forEach(add);
  list(event?.countries).forEach(add);
  list(event?.participants).forEach(add);
  if (typeof event?.agency === "string") add(event.agency);
  else list(event?.agency).forEach(add);
  const war = clean(event?.warId) ? list(world?.wars).find((entry) => clean(entry?.id) === clean(event.warId)) : null;
  if (war) [...list(war.sideA), ...list(war.sideB)].forEach(add);
  for (const place of list(event?.places)) {
    const match = String(place ?? "").match(/country:\s*([^,]+)/i);
    if (match) add(match[1]);
  }
  for (const change of list(impacts.polityChanges)) { add(change?.name); add(change?.code); }
  for (const op of list(impacts.politicalActorOps)) { add(op?.polityKey); add(op?.polity); add(op?.country); }
  for (const transfer of list(impacts.regionTransfers)) { add(transfer?.fromCode); add(transfer?.toCode); }
  for (const op of list(impacts.regionControlOps)) { add(op?.fromCode); add(op?.toCode); add(op?.actorCode); add(op?.claimantCode); }
  for (const op of list(impacts.institutionLifecycleOps)) { add(op?.actorPolity); add(op?.targetPolity); }
  for (const chat of list(impacts.createdChats)) { add(chat?.speaker); list(chat?.countries).forEach(add); }
  for (const op of list(impacts.unitOps)) { add(op?.owner); add(op?.ownerCode); }
  for (const name of namesInText(`${event?.title ?? ""}\n${event?.description ?? ""}`, byLength)) add(name);
  return out;
};

// The polities that have had something happen to them, or have dealt with the
// player, latest first: { name, date } for each, the date of the latest thing
// (blank when it carries none: those come after the dated ones).
export const rankRelevantPolities = (bundle, { event = null } = {}) => {
  const world = bundle?.world || {};
  const player = clean(bundle?.game?.country);
  const names = eligiblePolities(world, player);
  const nameOf = exactNamer(world, names);
  const byLength = [...names].sort((a, b) => b.length - a.length);
  // Each polity's latest: { date, round }. A date first; with none, the round;
  // with neither it still counts, after every dated one.
  const latest = new Map();
  const roundOf = (value) => (Number.isFinite(Number(value)) && value !== "" && value !== null ? Number(value) : -1);
  const newer = (a, b) => compareGameDatesNewestFirst(a.date, b.date) || b.round - a.round;
  const note = (value, date, round = -1) => {
    const name = nameOf(value);
    if (!name) return;
    const next = { date: clean(date), round: roundOf(round) };
    const known = latest.get(name);
    if (known === undefined || newer(next, known) < 0) latest.set(name, next);
  };
  const isPlayer = (value) => lower(value?.name || value?.code || value) === lower(player);

  // The event a reaction answers comes before everything else.
  const first = event ? polityNamesInEvent(event, world, nameOf, byLength) : [];

  // What happened: the event feed, newest first.
  const events = list(bundle?.events)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => compareGameDatesNewestFirst(clean(a.entry?.date), clean(b.entry?.date)) || b.index - a.index)
    .slice(0, EVENTS_READ);
  for (const { entry } of events) for (const name of polityNamesInEvent(entry, world, nameOf, byLength)) note(name, entry?.date);

  // What passed between them and the player.
  // Every chat with the player is a dealing: one-on-one or group, open or
  // closed, an institution's channel too (those sit among the chats). Dated by
  // its latest dated message; else by its own date or round; else undated.
  for (const chat of list(bundle?.chats)) {
    const dates = list(chat?.messages).map((message) => clean(message?.time)).filter(Boolean).sort(compareGameDatesNewestFirst);
    const ownDate = [chat?.lastUpdatedDate, chat?.updatedDate, chat?.date, chat?.startedDate, chat?.createdDate].map(clean).find(Boolean) || "";
    const round = [chat?.updatedRound, chat?.round, chat?.createdRound].find((value) => roundOf(value) >= 0);
    const members = [...list(chat?.countries), ...list(chat?.participants), ...list(chat?.members)];
    for (const country of members) if (!isPlayer(country)) note(country, dates[0] || ownDate, round);
  }
  for (const war of list(world?.wars)) {
    const parties = [...list(war?.sideA), ...list(war?.sideB)];
    if (!parties.some(isPlayer)) continue;
    for (const party of parties) if (!isPlayer(party)) note(party, war?.lastUpdatedDate || war?.startedDate);
  }
  for (const relation of list(world?.relations)) {
    if (isPlayer(relation?.a)) note(relation?.b, relation?.lastUpdatedDate);
    else if (isPlayer(relation?.b)) note(relation?.a, relation?.lastUpdatedDate);
  }
  for (const agreement of list(world?.agreements)) {
    const parties = list(agreement?.parties);
    if (!parties.some(isPlayer)) continue;
    for (const party of parties) if (!isPlayer(party)) note(party, agreement?.lastUpdatedDate || agreement?.startedDate);
  }
  for (const offer of list(world?.peaceOffers)) {
    if (isPlayer(offer?.from)) note(offer?.to, offer?.date);
    else if (isPlayer(offer?.to)) note(offer?.from, offer?.date);
  }
  for (const call of list(world?.callsToArms)) {
    const parties = [call?.ally, call?.defender, ...list(call?.attackers)];
    if (!parties.some(isPlayer)) continue;
    for (const party of parties) if (party && !isPlayer(party)) note(party, call?.date);
  }
  for (const row of livePuppetsFor(world, player)) {
    const other = row.role === "overlord" ? row.puppet : row.role === "puppet" ? row.overlord : "";
    if (other) note(other, row?.lastUpdatedDate || row?.startedDate);
  }

  const ranked = [...latest.entries()]
    .filter(([name]) => !first.includes(name))
    .map(([name, when], order) => ({ name, when, order }))
    .sort((a, b) => newer(a.when, b.when) || a.order - b.order)
    .map(({ name, when }) => ({ name, date: when.date }));
  return [...first.map((name) => ({ name, date: clean(event?.date) })), ...ranked];
};

// The governments a background note may come from, as one list: the relevant
// first, latest first, then the rest in their stored order, with the first
// `maxActors` relevant ones carrying their background (bounded PWv2 capsules).
// Nothing in it says which are which: the owner did not want the later ones
// read as the ones not to pick.
export const buildIdleDiplomacyPoliticalDecisionSet = (
  bundle,
  { event = null, maxActors = IDLE_BACKGROUND_LIMIT } = {},
) => {
  const world = bundle?.world || {};
  const player = clean(bundle?.game?.country);
  const empty = { ...buildBoundedPoliticalDecisionContextSet(world, { actorPolities: [], maxActors: 0 }), listed: [], player, fetched: new Set(), open: false };
  if (!player) return empty;
  const names = eligiblePolities(world, player);
  if (!names.length) return empty;

  const relevant = rankRelevantPolities(bundle, { event }).map((entry) => entry.name);
  const listed = [...relevant, ...names.filter((name) => !relevant.includes(name))];
  const cap = Math.max(0, Number(maxActors) || 0);
  const shown = (relevant.length ? relevant : listed).slice(0, relevant.length ? cap : Math.min(cap, QUIET_BACKGROUND_COUNT));
  const set = buildBoundedPoliticalDecisionContextSet(world, {
    actorPolities: shown,
    counterpartByActor: Object.fromEntries(shown.map((actor) => [actor, player])),
    maxActors: shown.length,
    perActorMaxChars: CAPSULE_CHARS,
    maxTotalChars: CAPSULE_CHARS * Math.max(1, shown.length) + 2000,
    limits: CAPSULE_LIMITS,
  });
  return { ...set, listed, player, fetched: new Set(), open: false };
};

// The background a government's capsule gives, keyed by the list's name.
const capsuleByName = (decisionSet) => {
  const out = new Map();
  for (const context of list(decisionSet?.contexts)) {
    const name = list(decisionSet?.listed).find((entry) => lower(entry) === lower(context?.actorPolity))
      || clean(context?.actorPolity);
    if (name) out.set(name, context.text);
  }
  return out;
};

export const GOVERNMENT_BACKGROUND_FUNCTION = "government_background";

// The list, as the model reads it. `canFetch`: the request carries
// government_background, so a government listed without its background can
// have it fetched before it writes.
export const idleDiplomacyPoliticalContextText = (decisionSet, { canFetch = false } = {}) => {
  const listed = list(decisionSet?.listed);
  if (!listed.length || !list(decisionSet?.contexts).length) return "";
  const capsules = capsuleByName(decisionSet);
  const rows = listed.flatMap((name) => (capsules.has(name) ? [`- ${name}`, capsules.get(name), ""] : [`- ${name}`]));
  return [
    "[GOVERNMENTS THAT MAY WRITE - PRIVATE ENGINE DATA]",
    "Any government below may be the one that writes. Use only the writer's own background: never pass one government's private politics to another, or to the player as known fact.",
    ...(canFetch
      ? [`A government listed without its background has it fetched with ${GOVERNMENT_BACKGROUND_FUNCTION} before it writes.`]
      : []),
    "",
    ...rows,
  ].join("\n").trim();
};

// Whether a speaker may write: its background was in the list or fetched in
// this request. With no capsules at all (a scenario without a Political World),
// or no function to fetch one with, any government may.
export const idleDiplomacySpeakerHasContext = (world, speaker, decisionSet) => {
  if (!decisionSet?.contexts?.length || decisionSet?.open) return true;
  const actor = getPoliticalProfile(world, speaker);
  if (!actor) return false;
  if (decisionSet.fetched?.has(actor)) return true;
  return decisionSet.contexts.some((context) => getPoliticalProfile(world, context?.actorPolity) === actor);
};

export const GOVERNMENT_BACKGROUND_TOOL = Object.freeze({
  name: GOVERNMENT_BACKGROUND_FUNCTION,
  description:
    "The background of governments the list gives without it: their politics, aims and standing with the player. "
    + "Call it for a government before that government writes, with every one you are weighing in the same call.",
  schema: {
    type: "object",
    description: "Which governments.",
    properties: {
      names: {
        type: "string",
        description: "One government a line, each by its exact name as the list gives it. Three at most.",
      },
    },
    required: ["names"],
    additionalProperties: false,
  },
});
const BACKGROUNDS_PER_CALL = 3;
const BACKGROUND_ROUNDS = 2;

// The request's functions with government_background added, answering from the
// world in hand. What it gives is kept on the set, so the speaker it fetched may
// write. Without other lookups it may be asked BACKGROUND_ROUNDS times.
export const withGovernmentBackgroundFunction = (lookups, { world, decisionSet } = {}) => {
  const listed = new Map(list(decisionSet?.listed).map((name) => [lower(name), name]));
  return {
    ...(lookups ?? {}),
    ...(lookups ? {} : { maxRounds: BACKGROUND_ROUNDS }),
    tools: [GOVERNMENT_BACKGROUND_TOOL, ...list(lookups?.tools)],
    execute: async (name, args) => {
      if (name !== GOVERNMENT_BACKGROUND_FUNCTION) {
        return typeof lookups?.execute === "function" ? lookups.execute(name, args) : `There is no function called ${name}.`;
      }
      const asked = String(args?.names ?? "").split(/\r?\n|;/).map(clean).filter(Boolean);
      if (!asked.length) return "Name the governments, one a line, as the list gives them.";
      const answers = asked.slice(0, BACKGROUNDS_PER_CALL).map((askedName) => {
        const polity = listed.get(lower(askedName));
        if (!polity) return `No government called "${askedName}" is in the list.`;
        const context = buildPoliticalDecisionContext(world, polity, {
          counterpartPolity: decisionSet?.player || "",
          limits: CAPSULE_LIMITS,
          maxChars: CAPSULE_CHARS,
        });
        if (!context?.text) return `${polity}: no background is kept.`;
        const actor = getPoliticalProfile(world, polity);
        if (actor) decisionSet.fetched.add(actor);
        return `- ${polity}\n${context.text}`;
      });
      if (asked.length > BACKGROUNDS_PER_CALL) answers.push(`Only ${BACKGROUNDS_PER_CALL} at a time: ${asked.slice(BACKGROUNDS_PER_CALL).join(", ")} were not looked up.`);
      return answers.join("\n\n");
    },
  };
};

// The request's functions for a background note: government_background when
// it can be asked (not while requests are being saved). Without it, any listed
// government may write (the set is opened), so a note is never refused for want
// of a background nobody could fetch.
export const idleDiplomacyLookups = (lookups, { world, decisionSet, canFetch = true } = {}) => {
  const needed = list(decisionSet?.contexts).length > 0 && list(decisionSet?.listed).length > list(decisionSet?.contexts).length;
  if (!needed) return lookups ?? null;
  if (!canFetch) {
    decisionSet.open = true;
    return lookups ?? null;
  }
  return withGovernmentBackgroundFunction(lookups, { world, decisionSet });
};
