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

export const directGeneratedTerritoryOps = async ({
  events = [],
  world = {},
  analyzeBatch,
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
    analysis = await analyzeBatch({
      candidates: candidates.map(({ event, index }) => ({
        eventIndex: index,
        date: normalizeString(event?.date),
        title: normalizeString(event?.title),
        description: normalizeString(event?.description),
        existingLegalTransfers: cloneValue(normalizeArray(event?.impacts?.regionTransfers)),
        existingControlOps: cloneValue(normalizeArray(event?.impacts?.regionControlOps)),
        unitOps: cloneValue(normalizeArray(event?.impacts?.unitOps)),
      })),
      territorialState: {
        regionOwnershipOverrides: cloneValue(world?.regionOwnershipOverrides || {}),
        regionSovereigntyOverrides: cloneValue(world?.regionSovereigntyOverrides || {}),
        regionClaimants: cloneValue(world?.regionClaimants || {}),
      },
    });
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
