/*! Open Historia — Game Master preview and apply checks © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The pure checks that decide what a GM console transaction may write to canon:
// polity lifecycle (create / restore / update / dissolve), breakaway
// sovereignty, chronology, the post-apply territory check and the fingerprint
// that makes a stale preview fail closed. gameplay.js runs them; they live here
// so node --test can load them (gameplay.js imports main.jsx and cannot be).
import { compareGameDates, normalizeGameDate } from "../../runtime/gameDates.js";
import { normalizeEvents, normalizeWorldState } from "../../runtime/gameState.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { resolvePolityIdentity } from "../../runtime/polityIdentity.js";

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);
const normalizeGameMasterIsoDate = (value) => normalizeGameDate(value);

export const gameMasterPolityKey = (value) => normalizeString(value).toLowerCase();

const gameMasterCanonicalPolityKey = (token, world) => {
  const raw = normalizeString(token);
  if (!raw) return "";
  const resolution = resolvePolityIdentity(raw, normalizeWorldState(world), {
    allowUnknown: false,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
    // Administrative/state-mutation comparisons must not let map provenance
    // redirect a polity token to some other active actor.
    allowMapRefs: false,
  });
  return gameMasterPolityKey(normalizeString(resolution?.resolved) || toCountryName(raw) || raw);
};

const gameMasterEventHasCanonicalEffects = (candidate, eventIndex) => {
  const event = normalizeArray(candidate?.events)[eventIndex];
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  for (const field of [
    "regionTransfers",
    "regionClaims",
    "polityChanges",
    "politicalActorOps",
    "createdChats",
    "unitOps",
    "markerOps",
    "institutionLifecycleOps",
    "projectOps",
    "groupOps",
  ]) {
    if (normalizeArray(impacts[field]).length > 0) return true;
  }

  const linked = (entries) => normalizeArray(entries).some((entry) =>
    normalizeArray(entry?.eventIndexes).some((value) => Number(value) === eventIndex));

  return linked(candidate?.countryStatPatches)
    || linked(candidate?.warUpdates)
    || linked(candidate?.relationUpdates)
    || linked(candidate?.agreementUpdates)
    || linked(candidate?.puppetUpdates);
};

export const validateGameMasterChronology = (candidate, game) => {
  const currentDate = normalizeGameMasterIsoDate(game?.gameDate || game?.startDate);
  if (!currentDate) return "";

  const events = normalizeArray(candidate?.events);
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const eventDate = normalizeGameMasterIsoDate(events[eventIndex]?.date);
    if (!eventDate || compareGameDates(eventDate, currentDate) <= 0) continue;
    if (!gameMasterEventHasCanonicalEffects(candidate, eventIndex)) continue;

    return `$.events[${eventIndex}] is dated ${eventDate}, after the current game date ${currentDate}, but it establishes canonical state changes. GM Apply never advances time, so date it on or before ${currentDate} or drop its structured effects.`;
  }

  return "";
};

const resolveGameMasterLifecycleIdentity = (token, world) => {
  const requested = normalizeString(token);
  if (!requested) return "";
  // Callers already hand us the live/normalized world. Re-normalizing it here is
  // surprisingly expensive when this helper is used while scanning map ownership.
  const resolution = resolvePolityIdentity(requested, world, {
    allowUnknown: false,
    // Do NOT ask the generic identity resolver whether a stock/base name is
    // "active". Its stock-base compatibility path intentionally permits ordinary
    // modern maps with no polity registry, but that is not enough evidence for GM
    // lifecycle semantics in a historical save (1915 Poland was the bug here).
    requireActive: false,
    allowCoreMatch: true,
    // Stock/base geography and mapRefs are vocabulary/provenance, not proof that
    // a political actor already exists. GM lifecycle identity must come from the
    // campaign's declared political registry/aliases/lineage only.
    allowStockBase: false,
    allowMapRefs: false,
  });
  return normalizeString(resolution?.resolved);
};

// The AI authors the CURRENT regime/display name, but native code owns stable
// polity identity and existence: a stock map name is not proof that the polity
// currently exists (1915 Poland). A create/update aimed at a known dormant
// lineage becomes a restore.
export const normalizeGameMasterPolityLifecycle = (candidate, world, baseActivePolities = new Set()) => {
  const active = new Set(baseActivePolities);

  for (const event of normalizeArray(candidate?.events)) {
    const changes = event?.impacts?.polityChanges;
    if (!Array.isArray(changes)) continue;

    event.impacts.polityChanges = changes.map((change) => {
      if (!change || typeof change !== "object" || Array.isArray(change)) return change;
      const operation = normalizeString(change.operation).toLowerCase();
      const code = normalizeString(change.code);
      if (!code) return change;

      const knownIdentity = resolveGameMasterLifecycleIdentity(code, world);
      const knownKey = gameMasterPolityKey(knownIdentity || code);
      const activeIdentity = knownKey && active.has(knownKey) ? (knownIdentity || code) : "";

      let normalizedChange = change;

      if (["create", "update"].includes(operation) && knownIdentity && !activeIdentity) {
        normalizedChange = {
          ...change,
          operation: "restore",
          code: knownIdentity,
        };
      } else if (operation === "restore" && knownIdentity) {
        normalizedChange = {
          ...change,
          code: knownIdentity,
        };
      }

      const finalOperation = normalizeString(normalizedChange?.operation).toLowerCase();
      const finalCode =
        resolveGameMasterLifecycleIdentity(normalizedChange?.code, world) ||
        toCountryName(normalizeString(normalizedChange?.code)) ||
        normalizeString(normalizedChange?.code);
      const finalKey = gameMasterPolityKey(finalCode);

      if (["create", "restore"].includes(finalOperation) && finalKey) active.add(finalKey);
      if (finalOperation === "dissolve" && finalKey) active.delete(finalKey);

      return normalizedChange;
    });
  }

  return candidate;
};

export const validateGameMasterPolityLifecycle = (candidate, world, baseActivePolities = new Set()) => {
  const active = new Set(baseActivePolities);

  for (let eventIndex = 0; eventIndex < normalizeArray(candidate?.events).length; eventIndex += 1) {
    const event = normalizeArray(candidate?.events)[eventIndex];
    const changes = normalizeArray(event?.impacts?.polityChanges);

    for (let changeIndex = 0; changeIndex < changes.length; changeIndex += 1) {
      const change = changes[changeIndex];
      const operation = normalizeString(change?.operation).toLowerCase();
      const code = normalizeString(change?.code);
      if (!code) continue;

      const knownIdentity = resolveGameMasterLifecycleIdentity(code, world);
      const stableIdentity = knownIdentity || toCountryName(code) || code;
      const stableKey = gameMasterPolityKey(stableIdentity);
      const activeIdentity = stableKey && active.has(stableKey) ? stableIdentity : "";

      if (operation === "create" && activeIdentity) {
        return `$.events[${eventIndex}].impacts.polityChanges[${changeIndex}] tries to CREATE "${code}", but it already resolves to active polity "${activeIdentity}". Use update/rename for the existing polity instead of creating a duplicate identity.`;
      }

      if (operation === "restore" && activeIdentity) {
        return `$.events[${eventIndex}].impacts.polityChanges[${changeIndex}] tries to RESTORE "${code}", but "${activeIdentity}" is already active. Use update/rename if the current regime or display name is changing.`;
      }

      if (operation === "update" && !activeIdentity) {
        return `$.events[${eventIndex}].impacts.polityChanges[${changeIndex}] tries to UPDATE "${code}", but that polity is not currently active. Use restore for a known historical/dormant identity or create for a genuinely new polity.`;
      }

      if (["create", "restore"].includes(operation) && stableKey) active.add(stableKey);
      if (operation === "dissolve" && stableKey) active.delete(stableKey);
    }
  }

  return "";
};

// A newly created belligerent may not receive LEGAL sovereignty from the very
// power it is fighting for independence in the same transaction: rebel gains
// are control ops until a settlement or recognition.
export const validateGameMasterBreakawaySovereignty = (candidate) => {
  const createdPolities = new Set();
  for (const event of normalizeArray(candidate?.events)) {
    for (const change of normalizeArray(event?.impacts?.polityChanges)) {
      const operation = normalizeString(change?.operation).toLowerCase();
      if (!["create", "restore"].includes(operation)) continue;
      const code = normalizeString(change?.code);
      const name = normalizeString(change?.name);
      if (code) createdPolities.add(code.toLowerCase());
      if (name) createdPolities.add(name.toLowerCase());
    }
  }
  if (!createdPolities.size) return "";

  const activeBreakawayPairs = [];
  for (const update of normalizeArray(candidate?.warUpdates)) {
    if (normalizeString(update?.op).toLowerCase() !== "start") continue;
    const sideA = normalizeArray(update?.actors).map((value) => normalizeString(value)).filter(Boolean);
    const sideB = normalizeArray(update?.opponents).map((value) => normalizeString(value)).filter(Boolean);
    for (const a of sideA) {
      for (const b of sideB) {
        if (createdPolities.has(a.toLowerCase()) || createdPolities.has(b.toLowerCase())) {
          activeBreakawayPairs.push([a, b]);
        }
      }
    }
  }
  if (!activeBreakawayPairs.length) return "";

  const opposingPair = (fromCode, toCode) => activeBreakawayPairs.some(([a, b]) => {
    const from = normalizeString(fromCode).toLowerCase();
    const to = normalizeString(toCode).toLowerCase();
    return (a.toLowerCase() === to && b.toLowerCase() === from)
      || (b.toLowerCase() === to && a.toLowerCase() === from);
  });

  for (let eventIndex = 0; eventIndex < normalizeArray(candidate?.events).length; eventIndex += 1) {
    const event = normalizeArray(candidate?.events)[eventIndex];
    const transfers = normalizeArray(event?.impacts?.regionTransfers);
    for (let transferIndex = 0; transferIndex < transfers.length; transferIndex += 1) {
      const transfer = transfers[transferIndex];
      const toCode = normalizeString(transfer?.toCode);
      const fromCode = normalizeString(transfer?.fromCode);
      if (!createdPolities.has(toCode.toLowerCase()) || !opposingPair(fromCode, toCode)) continue;
      return `$.events[${eventIndex}].impacts.regionTransfers[${transferIndex}] attempts to transfer LEGAL sovereignty from "${fromCode}" to newly created belligerent "${toCode}" while their independence war is starting. A unilateral declaration, uprising, revolution or secession does not itself change legal sovereignty. Keep the prior sovereign legally in place and represent the disputed territory with regionControlOps (normally contest; use control only for territory the breakaway has decisively captured/administers). Legal sovereignty can move later through explicit recognition, cession, annexation or settlement.`;
    }
  }

  return "";
};

// GM Apply must never report success merely because the common mutation seam
// returned an object. Verify every previewed territorial consequence against the
// in-memory post-apply world before ANY persistence happens.
export const verifyGameMasterTerritoryPostconditions = (events, world) => {
  const normalizedWorld = normalizeWorldState(world);

  for (let eventIndex = 0; eventIndex < normalizeArray(events).length; eventIndex += 1) {
    const event = normalizeArray(events)[eventIndex];
    const impacts = event?.impacts || {};

    for (let transferIndex = 0; transferIndex < normalizeArray(impacts.regionTransfers).length; transferIndex += 1) {
      const transfer = normalizeArray(impacts.regionTransfers)[transferIndex];
      // A whole-country transfer names the losing polity, not one region; its
      // regions were rewritten individually by the impact seam.
      if (transfer?.wholeCountry) continue;
      const regionId = normalizeString(transfer?.regionId);
      const expected = gameMasterCanonicalPolityKey(transfer?.toCode, normalizedWorld);
      // The sovereignty map is sparse: no row means the controller is the sovereign.
      const actual = gameMasterCanonicalPolityKey(
        normalizedWorld.regionSovereigntyOverrides?.[regionId] || normalizedWorld.regionOwnershipOverrides?.[regionId],
        normalizedWorld,
      );
      if (!regionId || !expected || actual !== expected) {
        return `territorial operation ${eventIndex}:${transferIndex} did not take effect for ${regionId || "unknown region"} (expected ${normalizeString(transfer?.toCode) || "target"}, found ${normalizeString(normalizedWorld.regionOwnershipOverrides?.[regionId]) || "no override"}).`;
      }
    }

    for (let controlIndex = 0; controlIndex < normalizeArray(impacts.regionControlOps).length; controlIndex += 1) {
      const control = normalizeArray(impacts.regionControlOps)[controlIndex];
      const op = normalizeString(control?.op).toLowerCase();
      const regionId = normalizeString(control?.regionId);
      if (!regionId) {
        return `de-facto control operation ${eventIndex}:${controlIndex} has no canonical region id after preview validation.`;
      }
      if (op === "control") {
        const expected = gameMasterCanonicalPolityKey(control?.toCode, normalizedWorld);
        const actual = gameMasterCanonicalPolityKey(normalizedWorld.regionOwnershipOverrides?.[regionId], normalizedWorld);
        if (!expected || actual !== expected) {
          return `de-facto control operation ${eventIndex}:${controlIndex} did not take effect for ${regionId} (expected ${normalizeString(control?.toCode) || "target"}).`;
        }
      }
      if (op === "contest") {
        const expected = gameMasterCanonicalPolityKey(control?.actorCode || control?.claimantCode, normalizedWorld);
        const claimants = normalizeArray(normalizedWorld.regionClaimants?.[regionId])
          .map((value) => gameMasterCanonicalPolityKey(value, normalizedWorld))
          .filter(Boolean);
        // A contest by the polity that controls the region after this
        // transaction is moot — the apply seam skips it on purpose (a
        // controller cannot claim its own region), most often because the same
        // transaction also transferred the region to that polity. Not a failure.
        const controller = gameMasterCanonicalPolityKey(normalizedWorld.regionOwnershipOverrides?.[regionId], normalizedWorld);
        if (expected && controller && expected === controller) continue;
        if (!expected || !claimants.includes(expected)) {
          return `contest operation ${eventIndex}:${controlIndex} did not take effect for ${regionId} (expected claimant ${normalizeString(control?.actorCode || control?.claimantCode) || "unknown"}).`;
        }
      }
    }

    for (let claimIndex = 0; claimIndex < normalizeArray(impacts.regionClaims).length; claimIndex += 1) {
      const claim = normalizeArray(impacts.regionClaims)[claimIndex];
      const regionId = normalizeString(claim?.regionId);
      const expected = gameMasterCanonicalPolityKey(claim?.claimantCode || claim?.claimant, normalizedWorld);
      if (!regionId || !expected) {
        return `claim operation ${eventIndex}:${claimIndex} has no canonical region id or claimant after preview validation.`;
      }
      const claimants = normalizeArray(normalizedWorld.regionClaimants?.[regionId])
        .map((value) => gameMasterCanonicalPolityKey(value, normalizedWorld))
        .filter(Boolean);
      const present = claimants.includes(expected);
      if (claim?.drop ? present : !present) {
        return `claim operation ${eventIndex}:${claimIndex} did not take effect for ${regionId} (${claim?.drop ? "claim still present" : "claim missing"} for ${normalizeString(claim?.claimantCode || claim?.claimant)}).`;
      }
    }
  }

  return "";
};

const hashGameMasterText = (value) => {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

// Fingerprint only canonical state the GM planner is allowed to mutate/read while
// authoring a transaction. If any of it changes between Preview and Apply, the
// transaction fails closed and the administrator must regenerate instead of having
// native code silently reinterpret an old preview against a new world.
export const gameMasterStateFingerprint = ({ game = {}, world = {}, events = [], colors = {} } = {}) => {
  const normalizedWorld = normalizeWorldState(world);
  const relevant = {
    game: {
      country: normalizeString(game?.country),
      gameDate: normalizeString(game?.gameDate),
      round: Number(game?.round) || 0,
      startDate: normalizeString(game?.startDate),
    },
    colors,
    events: normalizeEvents(events).map((event) => ({
      id: event.id,
      date: event.date,
      title: event.title,
      description: event.description,
      impacts: event.impacts,
      warId: event.warId,
      combatants: event.combatants,
    })),
    world: {
      polityOverrides: normalizedWorld.polityOverrides,
      regionOwnershipOverrides: normalizedWorld.regionOwnershipOverrides,
      regionSovereigntyOverrides: normalizedWorld.regionSovereigntyOverrides,
      regionClaimants: normalizedWorld.regionClaimants,
      countryStats: normalizedWorld.countryStats,
      countryTags: normalizedWorld.countryTags,
      internationalReputation: normalizedWorld.internationalReputation,
      units: normalizedWorld.units,
      markers: normalizedWorld.markers,
      cityRenames: normalizedWorld.cityRenames,
      storylines: normalizedWorld.storylines,
      wars: normalizedWorld.wars,
      relations: normalizedWorld.relations,
      agreements: normalizedWorld.agreements,
    },
  };
  return hashGameMasterText(JSON.stringify(relevant));
};
