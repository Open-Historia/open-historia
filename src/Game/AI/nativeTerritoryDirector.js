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

const eventText = (event) =>
  `${normalizeString(event?.title)} ${normalizeString(event?.description)}`.trim();

const TERRITORIAL_EVENT_PATTERN =
  /\b(captur\w*|seiz\w*|occup(?:y|ies|ied|ation)|retak\w*|retaken|recaptur\w*|liberat\w*|overr[au]n|breakthrough|front(?:line)?|battle|clash|combat|skirmish|offensive|invasion|invad\w*|withdraw\w*|retreat\w*|evacuat\w*|ceasefire|armistice|peace|treaty|cession|cedes?|ceded|annex\w*|sovereignty|control (?:of|over)|de[- ]facto (?:military )?control|holds? the field|falls? to)\b/i;

// this is intentionally about a CHANGE of control, not merely the word "control".
// otherwise "serbia retains control" or "neither side gains control" would be
// enough to flip the map, which would be spectacularly stupid.
const WARTIME_CONTROL_PATTERN =
  /\b(captur\w*|seiz\w*|conquer\w*|occup(?:y|ies|ied|ation)|retak\w*|retaken|recaptur\w*|liberat\w*|overr[au]n|breakthrough|falls? to|holds? the field|surrend\w*|capitulat\w*|(?:takes?|took|taken|taking|assumes?|assumed|assuming|gains?|gained|gaining|secures?|secured|securing|establish(?:es|ed|ing)?|asserts?|asserted|asserting|wrests?|wrested|wresting|imposes?|imposed|imposing)\s+(?:(?:de[- ]facto|effective|military|administrative|territorial)\s+){0,3}control|(?:comes?|came|falls?|fell|passes?|passed)\s+under\s+(?:(?:de[- ]facto|effective|military|administrative|territorial)\s+){0,3}control)\b/i;

const NEGATED_CONTROL_CHANGE_PATTERN =
  /\b(?:does not|did not|doesn't|didn't|fails? to|failed to|without|neither side|no side)\b[^.!?]{0,90}\b(?:take|gain|secure|establish|assume|assert|wrest|impose|capture|seize|occupy)\w*\b[^.!?]{0,50}\bcontrol\b/i;

const CONTEST_PATTERN =
  /\b(battl\w*|clash\w*|combat|skirmish\w*|firefight\w*|fight\w*|contested?|disputed?|offensive|counteroffensive|attack\w*|assault\w*|siege|front(?:line)?|bridgehead|beachhead|foothold|incursion|insurrect\w*|uprising|rebellion|revolt\w*|engag\w*|seiz\w*|cross(?:es|ed|ing)? the border|cross(?:es|ed|ing)? the frontier)\b/i;

const CLEAR_CONTEST_PATTERN =
  /\b(ceasefire|armistice|peace|withdraw\w*|retreat\w*|evacuat\w*|pulls? back|pulled back|disengag\w*|demilitariz\w*|front dissolves|fighting ends|hostilities end|stand(?:s)? down)\b/i;


const CLEAR_ALL_PATTERN =
  /\b(final settlement|territorial settlement|dispute settled|renounces? (?:all )?claims|withdraws? (?:all )?claims|all claims withdrawn|treaty settles|recognized border|recognised border)\b/i;

const LEGAL_SOVEREIGNTY_PATTERN =
  /\b(treaty|peace settlement|peace agreement|final settlement|cession|cedes?|ceded|ceding|annex\w*|incorporat\w*|sovereignty|recognized|recognised|formal(?:ly)? transfer|legal(?:ly)? transfer|purchase|sale|sold|union|unification|plebiscite|referendum|arbitration award|partition agreement)\b/i;

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

const hasTerritorialContent = (event) => {
  const impacts = event?.impacts || {};
  return (
    normalizeArray(impacts.regionTransfers).length > 0 ||
    normalizeArray(impacts.regionControlOps).length > 0 ||
    normalizeArray(impacts.unitOps).some((op) => op?.op === "attack") ||
    TERRITORIAL_EVENT_PATTERN.test(eventText(event))
  );
};

// Old prompts treated every wartime capture as a sovereign transfer. Salvage that
// output here before it reaches world state: a battlefield occupation is control;
// a treaty/cession/annexation is sovereignty. One regex gate is not international
// law, but it is much better than making every trench advance legally permanent.
const convertLegacyWartimeTransfers = (events) => {
  const diagnostics = [];

  const nextEvents = normalizeArray(events).map((event, eventIndex) => {
    const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
    const transfers = normalizeArray(impacts.regionTransfers);
    if (transfers.length === 0) return event;

    const text = eventText(event);
    if (!WARTIME_CONTROL_PATTERN.test(text) || LEGAL_SOVEREIGNTY_PATTERN.test(text)) {
      return event;
    }

    const converted = transfers.map((transfer) => ({
      op: "control",
      regionId: normalizeString(transfer?.regionId),
      regionName: normalizeString(transfer?.regionName),
      fromCode: normalizeString(transfer?.fromCode),
      toCode: normalizeString(transfer?.toCode),
      note:
        normalizeString(transfer?.note) ||
        "Converted from legacy wartime regionTransfer to de-facto control.",
      ...(transfer?.wholeCountry === true ? { wholeCountry: true } : {}),
    })).filter((op) => op.regionId && op.toCode);

    if (converted.length === 0) return event;

    diagnostics.push({
      eventIndex,
      op: "regionTransfers",
      action: "CONVERT",
      reason: `${converted.length} wartime transfer(s) converted to de-facto control`,
    });

    return {
      ...event,
      impacts: {
        ...impacts,
        regionTransfers: [],
        regionControlOps: [
          ...normalizeArray(impacts.regionControlOps),
          ...converted,
        ],
      },
    };
  });

  return { events: nextEvents, diagnostics };
};

const sanitizeDirectorOrders = ({ events, orders }) => {
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

    const text = eventText(event);
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

      if (kind === "contest") {
        const fromCode = normalizeString(op?.fromCode);
        const actorCode = normalizeString(op?.actorCode);
        if (!fromCode || !actorCode || fromCode.toLowerCase() === actorCode.toLowerCase()) {
          reject("contest needs different nonblank fromCode and actorCode values");
          continue;
        }
        if (!CONTEST_PATTERN.test(text)) {
          reject("event does not actually describe an active territorial/front contest");
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
        if (!WARTIME_CONTROL_PATTERN.test(text) || NEGATED_CONTROL_CHANGE_PATTERN.test(text)) {
          reject("event does not explicitly say de-facto control/capture/occupation changed hands");
          continue;
        }
        if (LEGAL_SOVEREIGNTY_PATTERN.test(text) && normalizeArray(impacts.regionTransfers).length > 0) {
          reject("legal settlement is already represented by regionTransfers; no extra control flip needed");
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
        if (!CLEAR_CONTEST_PATTERN.test(text)) {
          reject("event has no ceasefire/withdrawal/peace cue that clears an active contest");
          continue;
        }
        if (op?.clearAll === true && !CLEAR_ALL_PATTERN.test(text)) {
          reject("clearAll is reserved for an explicit final territorial-claims settlement");
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

const runNativeTerritoryDirectorSelfTests = () => {
  const easterEvent = {
    title: "The Easter Rising Erupts in Dublin",
    description:
      "Armed nationalist and republican volunteers stage a coordinated insurrection in Dublin, seizing the General Post Office and proclaiming the establishment of an independent Irish Republic. British garrison troops and artillery are swiftly deployed to seal off the city center and engage insurgent strongholds, triggering heavy urban skirmishing across the capital over the subsequent week.",
    impacts: {
      regionTransfers: [],
      regionControlOps: [],
      unitOps: [],
    },
  };

  const easterOrders = [{
    eventIndex: 0,
    regionControlOps: [{
      actorCode: "Ireland",
      op: "contest",
      regionName: "Dublin",
      fromCode: "British Empire",
      regionId: "Dublin",
      note: "Easter Rising in Dublin",
    }],
  }];

  const easterResult = sanitizeDirectorOrders({
    events: [easterEvent],
    orders: easterOrders,
  });
  const easterAccepted = easterResult.acceptedByEvent.get(0) || [];

  const sameActorResult = sanitizeDirectorOrders({
    events: [easterEvent],
    orders: [{
      eventIndex: 0,
      regionControlOps: [{
        actorCode: "British Empire",
        op: "contest",
        fromCode: "British Empire",
        regionId: "Dublin",
      }],
    }],
  });

  const quietEvent = {
    title: "Railway Officials Convene",
    description: "Officials review freight timetables and administrative procedures.",
    impacts: {
      regionTransfers: [],
      regionControlOps: [],
      unitOps: [],
    },
  };

  const cases = [
    {
      name: "Easter Rising language supports Dublin contest",
      pass:
        hasTerritorialContent(easterEvent) &&
        easterAccepted.length === 1 &&
        easterAccepted[0]?.op === "contest",
      detail: easterResult.diagnostics.map((row) => `${row.action}:${row.reason}`).join(" | "),
    },
    {
      name: "same actor cannot contest itself",
      pass:
        (sameActorResult.acceptedByEvent.get(0) || []).length === 0 &&
        sameActorResult.diagnostics.some((row) =>
          String(row.reason || "").includes("different nonblank")
        ),
      detail: sameActorResult.diagnostics.map((row) => `${row.action}:${row.reason}`).join(" | "),
    },
    {
      name: "administrative meeting is not territorial",
      pass: hasTerritorialContent(quietEvent) === false,
      detail: "no territorial cue",
    },
  ];

  const passed = cases.every((entry) => entry.pass);
  console.table(cases);
  console.info(
    `[OH Native Territory Director self-test] ${passed ? "PASS" : "FAIL"} — ` +
    `${cases.filter((entry) => entry.pass).length}/${cases.length}`,
  );
  return { passed, cases };
};

const publishDiagnostics = ({ candidates = [], analysis = null, eventOrders = [], diagnostics = [], skippedReason = "" } = {}) => {
  if (typeof window === "undefined") return;
  window.__OH_NATIVE_TERRITORY_DIRECTOR__ = {
    version: VERSION,
    selfTest: () => runNativeTerritoryDirectorSelfTests(),
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
// regions. Rows that involve a power the candidate events name come first, so the
// cap never hides the front being reconciled, and what it leaves out is counted.
export const TERRITORIAL_STATE_ROW_CAP = 400;

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

  const text = normalizeArray(candidates)
    .map((candidate) => `${normalizeString(candidate?.title)} ${normalizeString(candidate?.description)} ${JSON.stringify(candidate?.existingLegalTransfers ?? [])} ${JSON.stringify(candidate?.existingControlOps ?? [])}`)
    .join(" ")
    .toLowerCase();
  const namedInCandidates = (regionId) => {
    const powers = [control[regionId], sovereignty[regionId], ...normalizeArray(claimants[regionId])];
    return powers.some((power) => {
      const name = normalizeString(power).toLowerCase();
      return name.length > 2 && text.includes(name);
    });
  };

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
const territoryCandidateRows = (sourceEvents) => sourceEvents
  .map((event, index) => ({ event, index }))
  .filter(({ event }) => hasTerritorialContent(event))
  .map(({ event, index }) => ({
    eventIndex: index,
    date: normalizeString(event?.date),
    title: normalizeString(event?.title),
    description: normalizeString(event?.description),
    existingLegalTransfers: cloneValue(normalizeArray(event?.impacts?.regionTransfers)),
    existingControlOps: cloneValue(normalizeArray(event?.impacts?.regionControlOps)),
    unitOps: cloneValue(normalizeArray(event?.impacts?.unitOps)),
  }));

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
  const candidateRows = territoryCandidateRows(convertLegacyWartimeTransfers(events).events);
  return candidateRows.length ? territoryAnalyzerInput(candidateRows, world, findPlaces) : null;
};

export const directGeneratedTerritoryOps = async ({
  events = [],
  world = {},
  analyzeBatch,
  findPlaces = null,
} = {}) => {
  const converted = convertLegacyWartimeTransfers(events);
  const sourceEvents = converted.events;

  const candidates = sourceEvents
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => hasTerritorialContent(event));

  if (candidates.length === 0 || typeof analyzeBatch !== "function") {
    const skippedReason = candidates.length === 0
      ? "no territorial/front event candidates matched"
      : "no analyzer supplied";
    publishDiagnostics({
      candidates,
      diagnostics: converted.diagnostics,
      skippedReason,
    });
    console.groupCollapsed(`[OH Native Territory Director v${VERSION}] ${candidates.length} territorial candidate(s)`);
    console.info(skippedReason);
    if (converted.diagnostics.length > 0) console.table(converted.diagnostics);
    console.groupEnd();
    return sourceEvents;
  }

  let analysis = null;
  try {
    analysis = await analyzeBatch(await territoryAnalyzerInput(territoryCandidateRows(sourceEvents), world, findPlaces));
  } catch (error) {
    console.warn("[territory director] analysis failed; preserving existing territory state changes.", error);
    return sourceEvents;
  }

  const payload = analysis?.payload ?? analysis ?? {};
  const sanitized = sanitizeDirectorOrders({
    events: sourceEvents,
    orders: payload.eventOrders,
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

  const diagnostics = [...converted.diagnostics, ...sanitized.diagnostics];
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
