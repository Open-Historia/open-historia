/*!
 * Open Historia — native territory director (ported from kernely's Continuum branch)
 * v0.1.2
 *
 * regionOwnershipOverrides is what the map actually paints, so it is de-facto
 * control. regionClaimants is already the native striped dispute layer. this pass
 * finally stops treating every muddy wartime occupation like a peace treaty.
 */

const VERSION = "0.1.2";

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const cloneValue = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

// Names compared as the map and the ledgers write them: case and spacing aside.
const nameKey = (value) => normalizeString(value).toLocaleLowerCase().replace(/\s+/g, " ");

const opKey = (op) => {
  const kind = normalizeString(op?.op).toLowerCase();
  const region = normalizeString(op?.regionId).toLowerCase();
  if (kind === "contest") {
    return `${kind}|${region}|${normalizeString(op?.actorCode).toLowerCase()}`;
  }
  if (kind === "control") {
    return `${kind}|${region}|${normalizeString(op?.toCode).toLowerCase()}`;
  }
  if (kind === "clear_contest") {
    return `${kind}|${region}|${normalizeString(op?.claimantCode).toLowerCase()}|${op?.clearAll === true}`;
  }
  return `${kind}|${region}|${JSON.stringify(op)}`;
};

// Whether the director reads an event: by what the event IS, never by its
// words. Land may have changed hands or been fought over when the event
//   - carries territorial operations of its own (regionTransfers, regionControlOps);
//   - belongs to a war (warId) or names the powers fighting in it (combatants);
//   - answers an order of the player's, or is a Scene's outcome (`ordered`,
//     mapConsequences.js).
// English capture, fight and ceasefire words used to decide it, and an event
// written in any other language was never read: the same war took ground in
// English and none in French (the owner, 2026-11-13: "there should be
// absolutely no keywording done in this game anywhere").
export const hasTerritorialContent = (event) => {
  const impacts = event?.impacts || {};
  return (
    normalizeArray(impacts.regionTransfers).length > 0 ||
    normalizeArray(impacts.regionControlOps).length > 0 ||
    Boolean(normalizeString(event?.warId)) ||
    normalizeArray(event?.combatants).some((name) => normalizeString(name)) ||
    Boolean(event?.ordered)
  );
};

const isTerritoryCandidate = (event) => hasTerritorialContent(event);

// Whether the event's own regionTransfers already move this region: by the
// map's id or name as either side wrote it, case and spacing aside.
const transfersRegion = (impacts, op) => {
  const names = new Set([op?.regionId, op?.regionName].map(nameKey).filter(Boolean));
  return normalizeArray(impacts?.regionTransfers)
    .some((transfer) => [transfer?.regionId, transfer?.regionName].map(nameKey).some((name) => name && names.has(name)));
};

// The director's operations, kept or dropped by what each op IS: its kind and
// the fields that kind needs, never the event's words. A legal transfer is what
// its op says it is too: regionTransfers move sovereignty, regionControlOps
// occupation. English readers used to keep a control flip only beside capture
// words that were not denied, a contest only beside fight words, a clear only
// beside ceasefire words and clearAll only beside settlement words, and turned
// a transfer into occupation when the words told of a capture and not a
// treaty. In any other language every op was dropped and every transfer stayed
// as it was.
//
// `onBattlefield(regionRef)`: whether a region, by its id or its name, lies on
// a battlefield (frontApply.js frontRegionTest). Who holds such a region, and
// whether it is fought over, is the front engine's to work out from the orders
// the events gave, so the director's own marks on it are left out. Not handed
// in by a game with fronts off, and then nothing here changes.
export const sanitizeDirectorOrders = ({ events, orders, onBattlefield = null }) => {
  const diagnostics = [];
  const acceptedByEvent = new Map();

  const ordersByEvent = new Map();
  for (const entry of normalizeArray(orders)) {
    const eventIndex = Number(entry?.eventIndex);
    if (!Number.isInteger(eventIndex) || eventIndex < 0 || eventIndex >= events.length) continue;
    const list = ordersByEvent.get(eventIndex) || [];
    list.push(...normalizeArray(entry?.regionControlOps));
    ordersByEvent.set(eventIndex, list);
  }

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    const proposed = ordersByEvent.get(eventIndex) || [];
    if (proposed.length === 0 || !hasTerritorialContent(event)) continue;

    const impacts = event?.impacts || {};
    const existing = normalizeArray(impacts.regionControlOps);
    const seen = new Set(existing.map(opKey));
    const accepted = [];

    for (const raw of proposed.slice(0, 16)) {
      const op = cloneValue(raw);
      const kind = normalizeString(op?.op).toLowerCase();
      const regionId = normalizeString(op?.regionId);
      const reject = (reason) => diagnostics.push({ eventIndex, op: kind || "?", action: "DROP", reason });
      const keep = () => {
        const key = opKey(op);
        if (seen.has(key)) {
          reject("duplicate of an existing control operation");
          return;
        }
        seen.add(key);
        accepted.push(op);
        diagnostics.push({ eventIndex, op: kind, action: "KEEP", reason: "accepted" });
      };

      if (!regionId) {
        reject("regionId/place wording is blank");
        continue;
      }

      if ((kind === "contest" || kind === "control") && typeof onBattlefield === "function"
        && (onBattlefield(regionId) || (normalizeString(op?.regionName) && onBattlefield(op.regionName)))) {
        reject("the region is on a battlefield: the front engine works out who holds it");
        continue;
      }

      if (kind === "contest") {
        const fromCode = normalizeString(op?.fromCode);
        const actorCode = normalizeString(op?.actorCode);
        if (!fromCode || !actorCode || fromCode.toLowerCase() === actorCode.toLowerCase()) {
          reject("contest needs different nonblank fromCode and actorCode values");
          continue;
        }
        keep();
        continue;
      }

      if (kind === "control") {
        const fromCode = normalizeString(op?.fromCode);
        const toCode = normalizeString(op?.toCode);
        if (!fromCode || !toCode || fromCode.toLowerCase() === toCode.toLowerCase()) {
          reject("control flip needs different nonblank fromCode and toCode values");
          continue;
        }
        if (transfersRegion(impacts, op)) {
          reject("the event's own regionTransfers already move this region; no extra control flip needed");
          continue;
        }
        keep();
        continue;
      }

      if (kind === "clear_contest") {
        const claimantCode = normalizeString(op?.claimantCode);
        if (!claimantCode && op?.clearAll !== true) {
          reject("clear_contest needs claimantCode or clearAll=true");
          continue;
        }
        keep();
        continue;
      }

      reject(`unsupported region control op ${kind || "(blank)"}`);
    }

    if (accepted.length > 0) acceptedByEvent.set(eventIndex, accepted);
  }

  return { acceptedByEvent, diagnostics };
};

const publishDiagnostics = ({ candidates = [], analysis = null, eventOrders = [], diagnostics = [], skippedReason = "" } = {}) => {
  if (typeof window === "undefined") return;
  window.__OH_NATIVE_TERRITORY_DIRECTOR__ = {
    version: VERSION,
    last: () => ({
      candidateCount: candidates.length,
      candidateTitles: candidates.map(({ event, index }) => ({
        index,
        title: normalizeString(event?.title),
      })),
      analysisSource: analysis?.generation?.source || (skippedReason ? "not-run" : "ai"),
      skippedReason,
      eventOrders: cloneValue(eventOrders),
      diagnostics: cloneValue(diagnostics),
    }),
  };
};

publishDiagnostics();

// What the analyzer is shown of the map.
//
// It used to be the three stores whole. regionSovereigntyOverrides and
// regionClaimants are sparse — a row only where a region is occupied or disputed —
// but regionOwnershipOverrides is not: on a hand-drawn world EVERY region carries
// an override, and the built-in scenario is a hand-drawn world. A live 30-day jump
// on it sent this narrow pass 215,000 characters, five times over (each lookup
// round re-sends the request): about a million characters, 40% of everything that
// jump spent, on 4,848 rows of `"2014": "Ukraine"` — a numeric id and an owner, no
// region name, nothing a model can reason from.
//
// What the pass actually needs is the map's NON-NORMAL state: where the controller
// is not the lawful sovereign, and where there are claimants. So the two sparse
// stores go whole, and of the ownership store only the rows for THOSE regions.
//
// And it needs the controller of every place the events NAME, because that is
// what it writes into fromCode. This used to be left to a lookup ("find its
// controller with find_region"), which saved characters and cost a request — the
// wrong way round on a free key, where a lookup round re-sends the whole prompt
// and requests are what run out (requestBudget.js). The caller now reads the
// events for place names and hands each one over with its controller
// (`placesNamed`, from lookupTools.js placesNamedIn), so nothing has to be asked.
//
// Bounded all the same: a world war on a large map can dispute hundreds of
// regions. Rows that involve a power the candidate events concern come first
// (their combatants, and the sides of the operations they already carry), so
// the cap never hides the front being reconciled, and what it leaves out is
// counted. Which powers those are is read from those fields, never from the
// events' words, where a name is spelled in the player's language.
export const TERRITORIAL_STATE_ROW_CAP = 400;

// The powers the candidates concern, by name: whoever fights in them, and every
// side of the territorial operations and units they carry.
const powersConcerned = (candidates) => new Set(normalizeArray(candidates).flatMap((candidate) => [
  ...normalizeArray(candidate?.combatants),
  ...normalizeArray(candidate?.existingLegalTransfers).flatMap((op) => [op?.fromCode, op?.toCode]),
  ...normalizeArray(candidate?.existingControlOps).flatMap((op) => [op?.fromCode, op?.toCode, op?.actorCode, op?.claimantCode]),
  ...normalizeArray(candidate?.unitOps).map((op) => op?.unit?.ownerCode),
]).map(nameKey).filter(Boolean));

// The text a caller reads for place names: the candidates' own words, and the
// places their existing operations already point at.
export const territoryCandidateText = (candidates = []) => normalizeArray(candidates)
  .map((candidate) => [
    normalizeString(candidate?.title),
    normalizeString(candidate?.description),
    ...normalizeArray(candidate?.existingLegalTransfers).flatMap((op) => [op?.regionId, op?.regionName]),
    ...normalizeArray(candidate?.existingControlOps).flatMap((op) => [op?.regionId, op?.regionName]),
  ].map(normalizeString).filter(Boolean).join(". "))
  .join("\n");

export const summarizeTerritorialState = (world, candidates = [], { placesNamed = null } = {}) => {
  const control = world?.regionOwnershipOverrides && typeof world.regionOwnershipOverrides === "object" ? world.regionOwnershipOverrides : {};
  const sovereignty = world?.regionSovereigntyOverrides && typeof world.regionSovereigntyOverrides === "object" ? world.regionSovereigntyOverrides : {};
  const claimants = world?.regionClaimants && typeof world.regionClaimants === "object" ? world.regionClaimants : {};

  const concerned = powersConcerned(candidates);
  const namedInCandidates = (regionId) => [control[regionId], sovereignty[regionId], ...normalizeArray(claimants[regionId])]
    .some((power) => concerned.has(nameKey(power)));

  const regionIds = [...new Set([...Object.keys(sovereignty), ...Object.keys(claimants)])];
  // Stable within each group, so the same world produces the same prompt.
  const ordered = [
    ...regionIds.filter((regionId) => namedInCandidates(regionId)),
    ...regionIds.filter((regionId) => !namedInCandidates(regionId)),
  ];
  const kept = ordered.slice(0, TERRITORIAL_STATE_ROW_CAP);
  const pick = (store) => Object.fromEntries(kept.filter((regionId) => regionId in store).map((regionId) => [regionId, cloneValue(store[regionId])]));

  const places = Array.isArray(placesNamed) ? placesNamed : null;
  return {
    scope: places
      ? "The occupied and disputed regions, and every place the events name with who controls it now. Any other region is held by its lawful owner."
      : "Occupied and disputed regions only. Every other region is held by its lawful owner.",
    ...(places ? { placesTheseEventsName: cloneValue(places) } : {}),
    regionOwnershipOverrides: pick(control),
    regionSovereigntyOverrides: pick(sovereignty),
    regionClaimants: pick(claimants),
    ...(ordered.length > kept.length ? { omittedRegions: ordered.length - kept.length } : {}),
  };
};

// Which events the director would be asked about and what it would be shown of
// them, or null when none is territorial. Its own function so the turn review
// (gameplay.js runTurnReview) can tell beforehand whether there is anything to
// ask, and ask it as one job among several, with exactly this input.
// `findPlaces(text)` is the caller's place-name reader; without one the state
// goes out as it always did.
const territoryCandidates = (sourceEvents) => sourceEvents
  .map((event, index) => ({ event, index }))
  .filter(({ event }) => isTerritoryCandidate(event));

const territoryCandidateRows = (sourceEvents) => territoryCandidates(sourceEvents)
  .map(({ event, index }) => {
    const combatants = normalizeArray(event?.combatants).map(normalizeString).filter(Boolean);
    return {
      eventIndex: index,
      date: normalizeString(event?.date),
      title: normalizeString(event?.title),
      description: normalizeString(event?.description),
      // Who fights in it, when the event says (its own field, not its words).
      ...(combatants.length ? { combatants } : {}),
      existingLegalTransfers: cloneValue(normalizeArray(event?.impacts?.regionTransfers)),
      existingControlOps: cloneValue(normalizeArray(event?.impacts?.regionControlOps)),
      unitOps: cloneValue(normalizeArray(event?.impacts?.unitOps)),
    };
  });

const territoryAnalyzerInput = async (candidateRows, world, findPlaces) => {
  let placesNamed = null;
  if (typeof findPlaces === "function") {
    try {
      placesNamed = await findPlaces(territoryCandidateText(candidateRows));
    } catch (error) {
      console.warn("[territory director] the events' place names could not be read; sending the state without them.", error);
    }
  }
  return {
    candidates: candidateRows,
    territorialState: summarizeTerritorialState(world, candidateRows, { placesNamed }),
  };
};

export const buildTerritoryDirectorInput = async ({ events = [], world = {}, findPlaces = null } = {}) => {
  const candidateRows = territoryCandidateRows(normalizeArray(events));
  return candidateRows.length ? territoryAnalyzerInput(candidateRows, world, findPlaces) : null;
};

// `battlefieldRegions`: async () => the test sanitizeDirectorOrders takes as
// `onBattlefield`, or null. Asked for only when the director wrote something.
export const directGeneratedTerritoryOps = async ({
  events = [],
  world = {},
  analyzeBatch,
  findPlaces = null,
  signal = null,
  battlefieldRegions = null,
} = {}) => {
  const sourceEvents = normalizeArray(events);

  const candidates = territoryCandidates(sourceEvents);

  if (candidates.length === 0 || typeof analyzeBatch !== "function") {
    const skippedReason = candidates.length === 0
      ? "no event carries territorial operations, a war, combatants or an order of the player's"
      : "no analyzer supplied";
    publishDiagnostics({
      candidates,
      diagnostics: [],
      skippedReason,
    });
    console.groupCollapsed(`[OH Native Territory Director v${VERSION}] ${candidates.length} territorial candidate(s)`);
    console.info(skippedReason);
    console.groupEnd();
    return sourceEvents;
  }

  let analysis = null;
  try {
    analysis = await analyzeBatch(await territoryAnalyzerInput(territoryCandidateRows(sourceEvents), world, findPlaces));
  } catch (error) {
    // The player's Cancel is not a failed analysis: it must reach the skip, or
    // the cancelled turn goes on to be written.
    if (signal?.aborted) throw error;
    console.warn("[territory director] analysis failed; preserving existing territory state changes.", error);
    return sourceEvents;
  }

  const payload = analysis?.payload ?? analysis ?? {};
  let onBattlefield = null;
  if (typeof battlefieldRegions === "function" && normalizeArray(payload.eventOrders).length > 0) {
    try {
      onBattlefield = await battlefieldRegions();
    } catch (error) {
      console.warn("[territory director] the battlefields could not be read; the director's marks stand as written.", error);
    }
  }
  const sanitized = sanitizeDirectorOrders({
    events: sourceEvents,
    orders: payload.eventOrders,
    onBattlefield,
  });

  const nextEvents = sourceEvents.map((event, index) => {
    const additions = sanitized.acceptedByEvent.get(index) || [];
    if (additions.length === 0) return event;
    const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
    return {
      ...event,
      impacts: {
        ...impacts,
        regionControlOps: [
          ...normalizeArray(impacts.regionControlOps),
          ...additions,
        ],
      },
    };
  });

  const diagnostics = sanitized.diagnostics;
  publishDiagnostics({
    candidates,
    analysis,
    eventOrders: payload.eventOrders || [],
    diagnostics,
  });

  const acceptedCount = [...sanitized.acceptedByEvent.values()]
    .reduce((sum, ops) => sum + normalizeArray(ops).length, 0);

  console.groupCollapsed(
    `[OH Native Territory Director v${VERSION}] ${candidates.length} territorial candidate(s); ` +
    `${acceptedCount} control op(s) accepted`,
  );
  if (diagnostics.length > 0) console.table(diagnostics);
  else console.info("no territorial control operations were added this turn.");
  console.groupEnd();

  return nextEvents;
};
