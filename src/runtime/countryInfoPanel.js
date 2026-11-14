/*! Open Historia — country info panel rules © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the map's country panel (Game/Selection/CountryPanel.jsx) shows, kept
// out of React so node can test it: which polity a click means, which regions
// it holds, which events are about it, and the Advisor Report it last paid for.
import COUNTRY_NAMES from "./generated/countryNames.js";
import { eventNamesPolity } from "./eventConcerns.js";
import { gameDateDayNumber } from "./gameDates.js";
import { buildOwnerAliasMap, createOwnerResolver, regionBaseOwner } from "./ownerNames.js";
import { resolvePolityIdentity } from "./polityIdentity.js";
import { resolveRegionName } from "./regionNameFixes.js";

const clean = (value) => String(value ?? "").trim();

// The polity a panel opened on `country` ({ code, name, polityKey }) means in
// this world: its stable key, its record and the name it goes by now.
export const resolvePanelPolity = (country, world) => {
  const requested = country?.polityKey || country?.name || country?.code || "";
  const identity = resolvePolityIdentity(requested, world ?? {}, {
    allowUnknown: false,
    requireActive: false,
    allowStockBase: true,
  });
  const stableKey = identity?.resolved || requested;
  const polity = world?.polityOverrides?.[stableKey] ?? null;
  return { stableKey, polity, currentName: polity?.name || country?.name || stableKey };
};

// The panel's three region lists for one polity. The catalog is the one Stats
// counts territory from: the rendered scenario partition, or the merged stock
// catalog when the scenario draws none. Every owner - baked in, controller or
// legal sovereign - goes through the world's own owner folding (a GADM code
// becomes its country name, a display name or alias its key) before it is
// compared with the key, which is exact.
//
// `includeUncatalogued` also lists regions the overrides name but the catalog
// lacks, by id. Only for the merged catalog: against a rendered partition such
// a row is a region the map does not draw.
export const classifyPolityRegions = ({ catalog = [], world = {}, polityKey = "", includeUncatalogued = false } = {}) => {
  const key = clean(polityKey);
  const sovereign = [];
  const controlledForeign = [];
  const occupiedSovereign = [];
  if (!key) return { sovereign, controlledForeign, occupiedSovereign };

  const ownership = world?.regionOwnershipOverrides ?? {};
  const sovereignty = world?.regionSovereigntyOverrides ?? {};
  const owner = createOwnerResolver(buildOwnerAliasMap(world?.polityOverrides));
  const seen = new Set();

  const classify = (regionId, regionName, baseOwner) => {
    const controller = ownership[regionId] != null ? owner(ownership[regionId]) : baseOwner;
    const legalOwner = sovereignty[regionId] != null ? owner(sovereignty[regionId]) : controller;
    if (legalOwner === key) sovereign.push(regionName);
    if (controller === key && legalOwner && legalOwner !== key) controlledForeign.push(regionName);
    if (legalOwner === key && controller && controller !== key) occupiedSovereign.push(regionName);
    seen.add(regionId);
  };

  const resolveName = (id, baseName) =>
    resolveRegionName(id, baseName, world?.regionRenames) || clean(baseName) || id;

  for (const region of Array.isArray(catalog) ? catalog : []) {
    const id = clean(region?.id);
    if (!id) continue;
    classify(id, resolveName(id, region?.name), owner(regionBaseOwner(region)));
  }

  if (includeUncatalogued) {
    for (const regionId of new Set([...Object.keys(ownership), ...Object.keys(sovereignty)])) {
      if (!seen.has(regionId)) classify(regionId, resolveName(regionId, regionId), "");
    }
  }

  return {
    sovereign: [...new Set(sovereign)],
    controlledForeign: [...new Set(controlledForeign)],
    occupiedSovereign: [...new Set(occupiedSovereign)],
  };
};

// Every polity name the world or the stock map knows: the save's keys, names
// and aliases and every real country (the names a Rostra post may give as
// its country or its mentions, socialFeed.js readSkipPosts).
export const knownPolityNames = (world) => {
  const names = new Set(Object.values(COUNTRY_NAMES).map(clean).filter(Boolean));
  for (const [key, polity] of Object.entries(world?.polityOverrides ?? {})) {
    for (const name of [key, polity?.name, ...(Array.isArray(polity?.aliases) ? polity.aliases : [])]) {
      const text = clean(name);
      if (text) names.add(text);
    }
  }
  return [...names];
};

const impactNames = (impacts) => {
  const names = [];
  for (const change of impacts?.polityChanges ?? []) names.push(change?.code);
  for (const transfer of impacts?.regionTransfers ?? []) names.push(transfer?.toCode, transfer?.fromCode);
  for (const op of impacts?.regionControlOps ?? []) names.push(op?.fromCode, op?.toCode, op?.actorCode, op?.claimantCode);
  for (const claim of impacts?.regionClaims ?? []) names.push(claim?.claimantCode);
  for (const op of impacts?.politicalActorOps ?? []) names.push(op?.polityKey);
  for (const op of impacts?.unitOps ?? []) names.push(op?.unit?.ownerCode);
  for (const op of impacts?.markerOps ?? []) names.push(op?.marker?.ownerCode);
  for (const chat of impacts?.createdChats ?? []) {
    for (const country of chat?.countries ?? []) {
      if (typeof country === "string") names.push(country);
      else names.push(country?.code, country?.name);
    }
  }
  return names;
};

// A test for "is this event about the polity?", from the event's own
// structured fields and never its words:
//   - its impacts, which match the polity's key or current name exactly;
//   - the polities it says it concerns, who fights in it and the countries
//     among its places (runtime/eventConcerns.js), which match its key, its
//     current name, a declared alias or a name it had before a rename, case
//     and spacing aside.
// An event written before it said what it concerns is listed by the rest.
// Reading the title and description for the name listed "Allemagne" under
// nothing and an event about the US state of Georgia under the country.
export const createEventMatcher = ({ key = "", name = "", aliases = [], formerNames = [] } = {}) => {
  const own = [...new Set([clean(key), clean(name)].filter(Boolean))];
  const declared = [...own, ...[...aliases, ...formerNames].map(clean).filter(Boolean)];

  return (event) => {
    if (!own.length) return false;
    if (impactNames(event?.impacts).some((value) => own.includes(clean(value)))) return true;
    return eventNamesPolity(event, declared);
  };
};

// Newest first: by game date, later-logged first within a day, undated last.
export const sortEventsNewestFirst = (events) =>
  (Array.isArray(events) ? events : [])
    .map((event, index) => ({ event, index, day: gameDateDayNumber(event?.date) }))
    .sort((left, right) => {
      if (left.day !== right.day) {
        if (left.day === null) return 1;
        if (right.day === null) return -1;
        return right.day - left.day;
      }
      return right.index - left.index;
    })
    .map(({ event }) => event);

// The Advisor Report costs a request. One per polity per round is enough: the
// answer is kept under the campaign, the polity, the round's date and the
// language the prompt asks for, so reopening the panel shows it again and a
// new round or another campaign asks afresh.
export const briefingCacheKey = ({ gameId = "", polity = "", date = "", round = "", language = "" } = {}) =>
  [gameId, polity, date, round, language].map(clean).join("|");

export const createBriefingCache = ({ max = 32 } = {}) => {
  const entries = new Map();
  return {
    get: (key) => entries.get(key),
    set: (key, text) => {
      entries.delete(key);
      entries.set(key, text);
      while (entries.size > max) entries.delete(entries.keys().next().value);
    },
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
};
