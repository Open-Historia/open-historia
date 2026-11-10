/*! Open Historia — older Modern Day copies take the common country names © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "right now in modern day countries go by the kingdom of spain or the french
// republic, rename all these countries by their more common names in the
// scenario template and for modern day so they are spain and france. leave the
// us's name as it is tho" (the owner, 2026-11-09).
//
// The built-in Modern Day has called its countries by their common names since
// content revision 2 (2026-09-18: "Spain", formerly "Kingdom of Spain"). The
// revision reached the built-in itself, but not the worlds that already held the
// old names: the campaigns started on it (each keeps its own world), and the
// copy kept when the player had edited the built-in (modern-day-edited). Those
// still say "Kingdom of Spain", while the colours a game reads from its scenario
// may be keyed "Spain" — and a country whose key the colours do not hold is
// drawn in no colour of its own.
//
// This brings such a world across, once: every polity keyed by a name the
// built-in seed lists as a common-named country's former name is re-keyed to the
// common name through the ordinary rename (polityRename.js), so its regions,
// claims, relations, units, the player's own country, chats, actions, colours
// and flags follow it, and the old name stays a former name the AI and old text
// still resolve. The table is the seed's own (commonNameRenames below), never a
// word list kept here.
//
// Only a world that took the old names from the built-in is touched: one on the
// hand-drawn map ("fault-lines-2014-v1") before revision 2, or one without a map
// stamp that belongs to a kept copy of Modern Day. A world made at revision 2 or
// later, or on the current map (which never had the formal names), already
// started on the common names, so a formal name in it is one the story gave a
// country, and it stays. Every other scenario keeps its names: a community
// scenario may call a country by its formal name on purpose.
//
// Shared by both stores (server/libraryStore.js, src/runtime/web/libraryStore.js),
// so no node or src/ imports, like ownerMigration.js and polityRename.js.
import {
  findPolityKey,
  renamePolityInActions,
  renamePolityInChats,
  renamePolityInColors,
  renamePolityInFlags,
  renamePolityInGame,
  renamePolityInWorld,
  samePolityName,
} from "./polityRename.js";

// The world's marker: set once the world has been brought across, so a formal
// name the story gives a country later is never undone.
export const COMMON_NAMES_SCHEMA = 1;

// Kept as they are. The owner, 2026-11-09: "leave the us's name as it is tho" —
// a world that calls it "United States of America" goes on doing so.
export const KEPT_FORMAL_NAMES = Object.freeze(["United States of America"]);

// The built-in's hand-drawn map, whose first content revision named every
// country formally; revision 2 renamed them.
const FORMAL_NAMES_MAP = "fault-lines-2014-v1";
const COMMON_NAMES_REVISION = 2;
// The copies the stores keep of Modern Day (refreshBuiltInContent,
// syncBuiltInScenarioFromSeed): ensureUniqueId may have numbered them.
const MODERN_DAY_COPY_ID = /^modern-day-(edited|classic)(-\d+)?$/;

const str = (value) => String(value ?? "").trim();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isKept = (name) => KEPT_FORMAL_NAMES.some((kept) => samePolityName(kept, name));

// [formal name, common name] for every former name the seed's countries list,
// less the kept ones and any that is itself a country of the seed.
export const commonNameRenames = (seedWorld) => {
  const registry = isRecord(seedWorld?.polityOverrides) ? seedWorld.polityOverrides : {};
  const keys = Object.keys(registry);
  const out = [];
  for (const key of keys) {
    for (const former of Array.isArray(registry[key]?.formerNames) ? registry[key].formerNames : []) {
      const formal = str(former);
      if (!formal || samePolityName(formal, key) || isKept(formal)) continue;
      if (keys.some((other) => samePolityName(other, formal))) continue;
      if (out.some(([from]) => samePolityName(from, formal))) continue;
      out.push([formal, key]);
    }
  }
  return out;
};

const revisionOf = (world) => {
  const value = Number(world?.builtInRevision);
  return Number.isInteger(value) && value > 0 ? value : 1;
};

// A world that took the formal names from the built-in.
export const worldPredatesCommonNames = (world) =>
  str(world?.builtInMap) === FORMAL_NAMES_MAP && revisionOf(world) < COMMON_NAMES_REVISION;

export const isModernDayCopyId = (scenarioId) => MODERN_DAY_COPY_ID.test(str(scenarioId));

// Whether a scenario's world is one of those, by itself or by being a kept copy.
export const scenarioPredatesCommonNames = (scenarioId, world) =>
  worldPredatesCommonNames(world) || (!str(world?.builtInMap) && isModernDayCopyId(scenarioId));

// Whether this record's world is still to be brought across. A game is judged
// by its own world's map stamp, else by its scenario (`parentPredates`): a
// game's world is its scenario's world as it was when the game began.
export const needsCommonNames = (world, { scenarioId = "", parentPredates = false } = {}) => {
  if (!isRecord(world)) return false;
  if (Number(world.commonNames ?? 0) >= COMMON_NAMES_SCHEMA) return false;
  if (worldPredatesCommonNames(world)) return true;
  if (str(world.builtInMap)) return false;
  return isModernDayCopyId(scenarioId) || Boolean(parentPredates);
};

// A store keyed by polity names that holds this polity under its old name has
// that entry moved; one that does not is left exactly as it was. Unlike an
// in-play rename, an entry already under the common name is not a leftover
// here: the colours a kept copy was given are the seed's, keyed "Spain".
const ownsKey = (record, name) => isRecord(record) && Object.keys(record).some((key) => samePolityName(key, name));

// The record's parts in, the parts that changed out (undefined when unchanged),
// with the world always marked. `renames` is commonNameRenames' list.
export const migrateToCommonNames = ({ world, game, colors, flags, tags, chat, actions } = {}, renames = []) => {
  if (!isRecord(world)) return null;
  let nextWorld = world;
  let nextGame = game;
  let nextColors = colors;
  let nextFlags = flags;
  let nextTags = tags;
  let nextChat = chat;
  let nextActions = actions;
  const renamed = [];
  for (const [formal, common] of Array.isArray(renames) ? renames : []) {
    if (isKept(formal) || isKept(common)) continue;
    const from = findPolityKey(nextWorld.polityOverrides, formal);
    if (!from) continue;
    // Never two countries into one (the owner: names are exact, and a different
    // name is a different country): a world that already has the common name as
    // a polity of its own keeps both as they are.
    if (findPolityKey(nextWorld.polityOverrides, common)) continue;
    let result;
    try {
      result = renamePolityInWorld(nextWorld, from, common);
    } catch {
      continue; // a clash the rename refuses (a group or a political ledger under the name)
    }
    nextWorld = result.world;
    if (ownsKey(nextColors, result.from)) nextColors = renamePolityInColors(nextColors, result.from, result.to);
    if (ownsKey(nextTags, result.from)) nextTags = renamePolityInColors(nextTags, result.from, result.to);
    nextFlags = renamePolityInFlags(nextFlags, result.from, result.to);
    nextGame = renamePolityInGame(nextGame, result.from, result.to);
    nextChat = renamePolityInChats(nextChat, result.from, result.to);
    nextActions = renamePolityInActions(nextActions, result.from, result.to);
    renamed.push({ from: result.from, to: result.to });
  }
  const changed = (before, after) => (renamed.length && after !== before ? after : undefined);
  return {
    world: { ...nextWorld, commonNames: COMMON_NAMES_SCHEMA },
    game: changed(game, nextGame),
    colors: changed(colors, nextColors),
    flags: changed(flags, nextFlags),
    tags: changed(tags, nextTags),
    chat: changed(chat, nextChat),
    actions: changed(actions, nextActions),
    renamed,
  };
};
