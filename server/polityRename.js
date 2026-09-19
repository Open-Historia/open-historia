/*! Open Historia — polity re-keying © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A polity is keyed by its full name everywhere: regions, colours, flags, tags,
// stats, reputation, units, spies, wars, treaties, chats, the player's standing
// goal, the game's own polity.
// Renaming a country therefore RE-KEYS it. One pass rewrites every store from
// the old name to the new one, and the old name is kept as a former name so
// history written under it, and a model still using it, fold onto the same
// country (src/runtime/ownerNames.js buildOwnerAliasMap). The Workshop's
// Polities panel, an event's polityChanges (a rename, or an update that carries
// a new name) and the GM console all come through here; gameplay.js finishes
// what the world state does not carry — the game's own polity, queued orders,
// chats, flags and the stock map's baked regions. Shared with the server, so no
// src/ imports, like ownerMigration.js.

const str = (value) => String(value ?? "").trim();
// The same identity as ownerNames.js ownerIdentityKey: case, diacritics and
// punctuation do not make a different country.
const identity = (value) => str(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const unique = (list) => [...new Set(list.map(str).filter(Boolean))];

export const samePolityName = (a, b) => {
  const left = identity(a);
  return Boolean(left) && left === identity(b);
};

const mapName = (value, from, to) => (samePolityName(value, from) ? to : value);
const mapList = (list, from, to) => (Array.isArray(list) ? unique(list.map((value) => mapName(value, from, to))) : list);
// A map keyed by polity names, re-keyed: the country's own value — under its
// exact old key, else under a spelling of it — moves to the new name, where the
// old key stood. Anything else that answers to the new name is not this country
// and not any other (refuseClash refuses a name another polity has), so it is a
// leftover: an unused stock-palette colour, a flag or figures kept under a name
// nobody holds. It goes, rather than repaint or restate the renamed country —
// even when the country had no value of its own there.
const mapKeys = (record, from, to) => {
  if (!isRecord(record)) return record;
  const own = Object.prototype.hasOwnProperty.call(record, from)
    ? from
    : Object.keys(record).find((key) => samePolityName(key, from));
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === own) out[to] = value;
    else if (!samePolityName(key, from) && !samePolityName(key, to)) out[key] = value;
  }
  return out;
};
const mapValues = (record, from, to) => {
  if (!isRecord(record)) return record;
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = typeof value === "string" ? mapName(value, from, to) : Array.isArray(value) ? mapList(value, from, to) : value;
  }
  return out;
};
const mapRows = (rows, mapper) => (Array.isArray(rows) ? rows.map((row) => (isRecord(row) ? mapper(row) : row)) : rows);

// The key a name resolves to in a registry keyed by names, or "".
export const findPolityKey = (polityOverrides, name) =>
  Object.keys(isRecord(polityOverrides) ? polityOverrides : {}).find((key) => samePolityName(key, name)) ?? "";

// Every record whose display name is not its key — a save from before renames
// re-keyed, or a code-shaped key with a real name — is a rename waiting to be
// run. Two records answering to one name are left alone, and so is a display
// name the caller reserves (a real country's name on a differently keyed
// record) unless it was this polity's own name before.
export const displayNameMigrations = (world, { isReserved = () => false } = {}) => {
  const overrides = isRecord(world?.polityOverrides) ? world.polityOverrides : {};
  const keys = Object.keys(overrides);
  const out = [];
  for (const key of keys) {
    const record = overrides[key];
    const name = str(record?.name);
    if (!name || samePolityName(name, key)) continue;
    if (keys.some((other) => other !== key && samePolityName(other, name))) continue;
    const former = Array.isArray(record?.formerNames) ? record.formerNames : [];
    if (isReserved(name) && !former.some((entry) => samePolityName(entry, name))) continue;
    if (out.some((entry) => samePolityName(entry.to, name))) continue;
    out.push({ from: key, to: name });
  }
  return out;
};

const renamedRecord = (record, fromKey, to) => {
  const previous = unique([fromKey, record.name]).filter((name) => !samePolityName(name, to));
  const notNew = (name) => !samePolityName(name, to);
  return {
    ...record,
    code: to,
    name: to,
    aliases: unique([...(Array.isArray(record.aliases) ? record.aliases : []), ...previous]).filter(notNew),
    formerNames: unique([...(Array.isArray(record.formerNames) ? record.formerNames : []), ...previous]).filter(notNew),
  };
};

const rekeyRegistry = (registry, fromKey, to, fallback) => {
  const record = isRecord(registry[fromKey]) ? registry[fromKey] : fallback;
  const next = {};
  for (const [key, value] of Object.entries(registry)) {
    if (!samePolityName(key, fromKey)) next[key] = value;
  }
  next[to] = renamedRecord(record, fromKey, to);
  return next;
};

const refuseClash = (registry, fromKey, to) => {
  const clash = Object.keys(registry).find((key) => samePolityName(key, to) && !samePolityName(key, fromKey));
  if (clash) throw new Error(`"${to}" is already the name of another polity ("${clash}"); a rename cannot merge two countries.`);
};

// The rename in a world: returns { world, from, to } with `from` the key the
// old name resolved to. Throws when the new name is another polity's.
export const renamePolityInWorld = (world, fromName, toName) => {
  const from = str(fromName);
  const to = str(toName);
  if (!from || !to) throw new Error("A rename needs the polity's current name and its new name.");
  const overrides = isRecord(world?.polityOverrides) ? world.polityOverrides : {};
  const fromKey = findPolityKey(overrides, from) || from;
  refuseClash(overrides, fromKey, to);
  const polityOverrides = rekeyRegistry(overrides, fromKey, to, { aliases: [], code: fromKey, color: "", name: "", note: "" });

  const next = { ...world, polityOverrides };
  const put = (field, value) => {
    if (value !== undefined) next[field] = value;
  };
  const one = (value) => mapName(value, fromKey, to);
  put("regionOwnershipOverrides", mapValues(world?.regionOwnershipOverrides, fromKey, to));
  put("regionSovereigntyOverrides", mapValues(world?.regionSovereigntyOverrides, fromKey, to));
  put("regionClaimants", mapValues(world?.regionClaimants, fromKey, to));
  put("units", mapRows(world?.units, (unit) => ({ ...unit, ownerCode: one(unit.ownerCode) })));
  put("markers", mapRows(world?.markers, (marker) => ({ ...marker, ownerCode: one(marker.ownerCode) })));
  put("spies", mapRows(world?.spies, (spy) => ({ ...spy, owner: one(spy.owner), target: one(spy.target) })));
  put("wars", mapRows(world?.wars, (war) => ({ ...war, sideA: mapList(war.sideA, fromKey, to), sideB: mapList(war.sideB, fromKey, to) })));
  put("relations", mapRows(world?.relations, (relation) => ({ ...relation, a: one(relation.a), b: one(relation.b) })));
  put("agreements", mapRows(world?.agreements, (agreement) => ({
    ...agreement,
    parties: mapList(agreement.parties, fromKey, to),
    ...(agreement.guarantor ? { guarantor: one(agreement.guarantor) } : {}),
    ...(agreement.beneficiary ? { beneficiary: one(agreement.beneficiary) } : {}),
  })));
  put("storylines", mapRows(world?.storylines, (storyline) => ({ ...storyline, participants: mapList(storyline.participants, fromKey, to) })));
  put("projects", mapRows(world?.projects, (project) => ({ ...project, ownerCode: one(project.ownerCode) })));
  for (const field of ["countryStats", "countryTags", "internationalReputation", "intelligence", "playerGoals"]) {
    put(field, mapKeys(world?.[field], fromKey, to));
  }
  return { world: next, from: fromKey, to };
};

// The stores the world does not hold. Each returns its input untouched when
// nothing matched.
export const renamePolityInColors = (colors, from, to) => mapKeys(colors, from, to);
export const renamePolityInFlags = (flags, from, to) => mapKeys(flags, from, to);
export const renamePolityInGame = (game, from, to) =>
  (isRecord(game) && samePolityName(game.country, from) ? { ...game, country: to } : game);
export const renamePolityInChats = (chats, from, to) =>
  mapRows(chats, (chat) => ({
    ...chat,
    countries: Array.isArray(chat.countries)
      ? chat.countries.map((country) => (
        typeof country === "string"
          ? mapName(country, from, to)
          : isRecord(country)
            ? { ...country, name: mapName(country.name, from, to), code: mapName(country.code, from, to) }
            : country
      ))
      : chat.countries,
  }));
export const renamePolityInActions = (actions, from, to) =>
  mapRows(actions, (action) => ({
    ...action,
    participants: mapList(action.participants, from, to),
    invitees: mapList(action.invitees, from, to),
  }));

// On a stock map most regions carry no override: their owner is the country
// baked into the tiles. Renaming such a country has to say so for every one
// of them, or the tiles keep painting the old name where nothing overrode it.
export const expandBakedRegionsForRename = (world, regions, from, to) => {
  const overrides = { ...(isRecord(world?.regionOwnershipOverrides) ? world.regionOwnershipOverrides : {}) };
  let added = 0;
  for (const region of Array.isArray(regions) ? regions : []) {
    const id = str(region?.id);
    if (!id || Object.prototype.hasOwnProperty.call(overrides, id)) continue;
    if (!samePolityName(region?.country, from)) continue;
    overrides[id] = to;
    added += 1;
  }
  return added ? { ...world, regionOwnershipOverrides: overrides } : world;
};

// The Workshop's document: the registry record moves to the new name and the
// colour, flag, tags and city markers keyed by the old one follow. The map's
// regions live in OpenLayers and are re-keyed by OlMap.renameOwner.
export const renamePolityInDocument = (doc, fromName, toName) => {
  const from = str(fromName);
  const to = str(toName);
  if (!from || !to) throw new Error("A rename needs the polity's current name and its new name.");
  const polities = isRecord(doc?.polities) ? doc.polities : {};
  const fromKey = findPolityKey(polities, from) || from;
  refuseClash(polities, fromKey, to);
  const next = { ...doc, polities: rekeyRegistry(polities, fromKey, to, { name: fromKey, aliases: [] }) };
  const put = (field, value) => {
    if (value !== undefined) next[field] = value;
  };
  put("colorOverrides", mapKeys(doc?.colorOverrides, fromKey, to));
  put("flags", mapKeys(doc?.flags, fromKey, to));
  put("tags", mapKeys(doc?.tags, fromKey, to));
  put("features", mapRows(doc?.features, (feature) => ({
    ...feature,
    ...(typeof feature.country === "string" ? { country: mapName(feature.country, fromKey, to) } : {}),
    ...(typeof feature.owner === "string" ? { owner: mapName(feature.owner, fromKey, to) } : {}),
  })));
  return next;
};
