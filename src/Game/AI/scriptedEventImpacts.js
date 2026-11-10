/*! Open Historia — a fired scripted event's authored impacts reach the time skip's answer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The impacts an author attaches to a scripted event (server/scriptedImpacts.js)
// are merged into the event the answer writes for it, before the answer's world
// changes are resolved and applied, so they go through the same resolver as the
// model's own. Regions are stored by their map id, which the resolver takes as
// it is. The model is told what each event carries so its story agrees.

import { normalizeScriptedImpacts } from "../../../server/scriptedImpacts.js";
import { SCRIPTED_EVENT, beatIsWritten, ensureScriptedEvents } from "./worldDirection.js";

const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLowerCase();
const array = (value) => (Array.isArray(value) ? value : []);
const clone = (value) => JSON.parse(JSON.stringify(value));
const FAMILIES = ["polityChanges", "regionTransfers", "regionControlOps", "regionClaims"];

// The impacts a fired beat carries: its own, then its selected outcome's.
export const scriptedImpactsOf = (beat) => {
  const own = normalizeScriptedImpacts(beat?.impacts);
  const selectedId = text(beat?.selectedOutcomeId);
  const outcome = selectedId ? array(beat?.outcomes).find((entry) => text(entry?.id) === selectedId) : null;
  const branch = normalizeScriptedImpacts(outcome?.impacts);
  const out = {};
  for (const family of FAMILIES) {
    const entries = [...array(own[family]), ...array(branch[family])];
    if (entries.length) out[family] = clone(entries);
  }
  return out;
};

const bareName = (value) => lower(value).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^region:\s*/, "");
const regionKeys = (entry) => [bareName(entry?.regionId), bareName(entry?.regionName)].filter(Boolean);
const claimKey = (entry) => `${bareName(entry?.regionId)}|${entry?.allClaimants ? "*" : lower(entry?.claimantCode)}`;
const polityKey = (entry) => `${lower(entry?.operation)}|${lower(entry?.code)}`;

// The answer's impacts with the author's added: what the model wrote for the
// same region, claim or polity operation gives way to the author's.
export const mergeAuthoredImpacts = (impactsInput, authoredInput) => {
  const impacts = impactsInput && typeof impactsInput === "object" && !Array.isArray(impactsInput) ? impactsInput : {};
  const authored = authoredInput && typeof authoredInput === "object" ? authoredInput : {};
  const out = { ...impacts };
  for (const family of FAMILIES) {
    const mine = array(authored[family]);
    if (!mine.length) continue;
    const theirs = array(impacts[family]);
    let kept = theirs;
    if (family === "regionTransfers" || family === "regionControlOps") {
      const taken = new Set(mine.flatMap(regionKeys));
      kept = theirs.filter((entry) => !regionKeys(entry).some((key) => taken.has(key)));
    } else if (family === "regionClaims") {
      const taken = new Set(mine.map(claimKey));
      kept = theirs.filter((entry) => !taken.has(claimKey(entry)));
    } else {
      const taken = new Set(mine.map(polityKey));
      kept = theirs.filter((entry) => !taken.has(polityKey(entry)));
    }
    out[family] = [...kept, ...clone(mine)];
  }
  return out;
};

// Marks an event as one that tells a fired scripted event: the map's tempo
// (worldDirection.js applyTerritoryTempo) never withholds what it carries.
const markScripted = (event) => {
  if (event && typeof event === "object") event[SCRIPTED_EVENT] = true;
};

// ensureScriptedEvents (worldDirection.js), with each beat's authored impacts
// on the event that tells it: an event of the answer (matched one-to-one in
// the same order ensureScriptedEvents matches them) or the engine's own copy.
// Every such event is marked (SCRIPTED_EVENT), with or without authored
// impacts. The marker is a symbol: it rides the copies the engine makes of
// the event (an exact-wording beat's) and never reaches a save.
export const ensureScriptedEventsWithImpacts = (eventsInput, beatsInput, options = {}) => {
  const events = array(eventsInput);
  const beats = array(beatsInput);
  const attached = [];
  const consumed = new Set();
  for (const beat of beats) {
    let matchIndex = -1;
    for (let index = 0; index < events.length; index += 1) {
      if (!consumed.has(index) && beatIsWritten(beat, [events[index]], options)) {
        matchIndex = index;
        break;
      }
    }
    if (matchIndex === -1) continue;
    consumed.add(matchIndex);
    const authored = scriptedImpactsOf(beat);
    const event = events[matchIndex];
    markScripted(event);
    if (!Object.keys(authored).length || !event || typeof event !== "object") continue;
    event.impacts = mergeAuthoredImpacts(event.impacts, authored);
    attached.push(beat);
  }
  const result = ensureScriptedEvents(events, beats, options);
  result.inserted.forEach((beat, offset) => {
    const authored = scriptedImpactsOf(beat);
    const event = result.events[events.length + offset];
    markScripted(event);
    if (!Object.keys(authored).length || !event) return;
    event.impacts = mergeAuthoredImpacts(event.impacts, authored);
    attached.push(beat);
  });
  return { ...result, attached };
};

const listNames = (names) => {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length <= 1) return unique[0] || "";
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
};
const regionName = (entry) => text(entry?.regionName) || text(entry?.regionId).replace(/^region:\s*/i, "");

const groupBy = (entries, keyOf) => {
  const groups = new Map();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.values()];
};

// One line in words: names only, never an id.
export const describeScriptedImpacts = (impactsInput) => {
  const impacts = normalizeScriptedImpacts(impactsInput);
  const parts = [];
  for (const change of array(impacts.polityChanges)) {
    const operation = lower(change.operation);
    if (operation === "create") parts.push(`${change.code} is founded`);
    else if (operation === "rename") parts.push(`${change.code} is renamed ${change.name}`);
    else if (operation === "dissolve") parts.push(`${change.code} is dissolved`);
    else if (operation === "restore") parts.push(`${change.code} is restored`);
    else if (operation === "update") {
      if (text(change.stats?.leader)) parts.push(`${change.code}'s leader becomes ${change.stats.leader}`);
      if (text(change.stats?.government)) parts.push(`${change.code}'s government becomes ${change.stats.government}`);
    }
  }
  for (const group of groupBy(array(impacts.regionTransfers), (entry) => `${entry.toCode}|${entry.wholeCountry ? "all" : ""}`)) {
    const to = group[0].toCode;
    if (group[0].wholeCountry) parts.push(`all of ${listNames(group.map((entry) => entry.fromCode || regionName(entry)))} passes to ${to}`);
    else parts.push(`${listNames(group.map(regionName))} pass${group.length === 1 ? "es" : ""} to ${to}`);
  }
  for (const group of groupBy(array(impacts.regionControlOps), (entry) => `${lower(entry.op)}|${entry.toCode || entry.actorCode || entry.claimantCode || ""}`)) {
    const op = lower(group[0].op);
    const names = listNames(group.map(regionName));
    if (op === "control") parts.push(`${names} ${group.length === 1 ? "is" : "are"} occupied by ${group[0].toCode}`);
    else if (op === "contest") parts.push(`${group[0].actorCode} contests ${names}`);
    else if (op === "clear_contest") parts.push(`the fighting over ${names} ends`);
  }
  for (const group of groupBy(array(impacts.regionClaims), (entry) => `${entry.allClaimants ? "*" : entry.claimantCode || ""}|${entry.drop ? "drop" : "add"}|${/^country:/i.test(text(entry.regionId)) ? "country" : ""}`)) {
    const claimant = group[0].allClaimants ? "" : text(group[0].claimantCode);
    if (/^country:/i.test(text(group[0].regionId))) {
      const countries = listNames(group.map((entry) => text(entry.regionName) || text(entry.regionId).replace(/^country:\s*/i, "")));
      parts.push(claimant ? `${claimant} gives up every claim on ${countries}` : `every claim on ${countries} is removed`);
    } else if (group[0].drop) parts.push(`${claimant} drops its claim to ${listNames(group.map(regionName))}`);
    else parts.push(`${claimant} claims ${listNames(group.map(regionName))}`);
  }
  return parts.join("; ");
};

// What the model is told when the engine writes in a beat its answer left out
// (the fallback's, when `fallback`): the impacts it carries are the author's,
// by name, and only when it carries none does it say so.
export const scriptedBeatWrittenNote = (beat, { fallback = false } = {}) => {
  const carries = describeScriptedImpacts(scriptedImpactsOf(beat));
  return `The scripted event of ${beat?.date} — "${beat?.title}" — was not in ${fallback ? "the fallback answer" : "your answer"}, so the engine wrote it in the author's words, `
    + (carries ? `with the impacts its author attached: ${carries}.` : "with no impacts.");
};

// The events of a payload that tell a fired scripted event and carry
// impacts (ensureScriptedEventsWithImpacts marks them).
export const scriptedEventsCarryingImpacts = (eventsInput) => array(eventsInput).filter((event) =>
  event?.[SCRIPTED_EVENT] && event.impacts && typeof event.impacts === "object"
  && FAMILIES.some((family) => array(event.impacts[family]).length));

// A skip that fell back to stand-in events skips the validator, and with it
// the resolver every answer's world changes go through. The events that tell
// its fired scripted events are resolved here instead, by the same
// `validate` (gameplay.js validateGeneratedWorldChanges, handed in so this
// file stays import-free of the game), never strictly: a fallback has no
// attempt to send back. Only those events go: the stand-ins carry nothing to
// resolve. What it resolved is put back in the payload in place; should it
// still refuse, those events keep their story and lose the author's changes
// (`error` says why, for the caller's receipt).
export const resolveFallbackScriptedImpacts = async (payload, world, {
  validate,
  ...options
} = {}) => {
  const events = array(payload?.events);
  const carrying = scriptedEventsCarryingImpacts(events);
  if (!carrying.length || typeof validate !== "function") return { resolved: 0, error: "", events: [] };
  const positions = carrying.map((event) => events.indexOf(event));
  const scripted = { events: [...carrying] };
  const error = await validate(scripted, world, { ...options, strictTransfers: false });
  if (error) {
    for (const position of positions) {
      const event = events[position];
      const impacts = { ...event.impacts };
      for (const family of FAMILIES) delete impacts[family];
      events[position] = { ...event, impacts };
    }
    return { resolved: 0, error: String(error), events: carrying };
  }
  positions.forEach((position, offset) => {
    const event = scripted.events[offset];
    if (event && typeof event === "object") {
      markScripted(event);
      events[position] = event;
    }
  });
  return { resolved: carrying.length, error: "", events: carrying };
};

// What the period is told: beside the scripted events, which beats carry what.
export const buildScriptedImpactsInstruction = (beatsInput) => {
  const rows = array(beatsInput)
    .map((beat) => ({ beat, line: describeScriptedImpacts(scriptedImpactsOf(beat)) }))
    .filter((entry) => entry.line)
    .map(({ beat, line }) => `- ${beat.date} — ${text(beat.title) || text(beat.text).slice(0, 80)}: this event carries: ${line}.`);
  if (!rows.length) return "";
  return "[Impacts the author attached to scripted events — applied by the engine]\n"
    + "The engine attaches these to the events above exactly as listed. Write each event so its story agrees with them, and do not write them again in its impacts.\n"
    + rows.join("\n");
};
