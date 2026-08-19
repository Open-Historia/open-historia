/*!
 * open historia enhanced — native timeline curator
 * v0.1.0 — audit only
 *
 * this sits inside the actual turn pipeline instead of stalking fetch requests
 * from the bushes like the old browser-injected curator had to do.
 */

const VERSION = "0.1.0-audit";

let lastAudit = null;

// normalize this crap once so console output doesn't become undefined soup.
const normalizeString = (value) => String(value ?? "").trim();

// ---- event summary ----------------------------------------------------------
// only diagnostic metadata for now. we are absolutely not touching the event
// objects themselves until we prove this thing isn't going to eat history again.
const summarizeEvent = (event, index) => ({
  index: index + 1,
  date: normalizeString(event?.date),
  title: normalizeString(event?.title),
  importance: normalizeString(event?.importance),
  source: normalizeString(event?.source),

  regionTransfers: Array.isArray(event?.impacts?.regionTransfers)
    ? event.impacts.regionTransfers.length
    : 0,

  polityChanges: Array.isArray(event?.impacts?.polityChanges)
    ? event.impacts.polityChanges.length
    : 0,

  unitOps: Array.isArray(event?.impacts?.unitOps)
    ? event.impacts.unitOps.length
    : 0,

  markerOps: Array.isArray(event?.impacts?.markerOps)
    ? event.impacts.markerOps.length
    : 0,

  createdChats: Array.isArray(event?.impacts?.createdChats)
    ? event.impacts.createdChats.length
    : 0,
});

// ---- supported turn types ---------------------------------------------------
// gm commands also pass through applySimulationResult, because apparently one
// function gets to run half the fucking game. don't curate those yet.
const shouldCurateMode = (mode) =>
  mode === "jump" || mode === "auto";

/**
 * native curator choke point.
 *
 * audit only.
 *
 * yes, this currently returns every event unchanged.
 * that is deliberate. first we prove the plumbing works, THEN we give the
 * machine permission to delete things again. we've learned this lesson already.
 */
export const curateGeneratedEvents = async ({
  events = [],
  priorEvents = [],
  game = {},
  world = {},
  actions = [],
  mode = "",
} = {}) => {
  const incoming = Array.isArray(events) ? events : [];

  // gm/catalyst/etc. can piss off for v0.1.
  if (!shouldCurateMode(mode)) {
    return incoming;
  }

  const rows = incoming.map(summarizeEvent);

  // keep the last run around so we can inspect it without summoning another
  // nightmare of network hooks and polling loops.
  lastAudit = {
    version: VERSION,
    mode: "audit",
    simulationMode: mode,

    gameDate: normalizeString(game?.gameDate),
    round: Number(game?.round) || 0,

    generatedCount: incoming.length,

    // audit means nothing gets dropped. zero. nada. don't get clever.
    keptCount: incoming.length,
    droppedCount: 0,

    priorEventCount: Array.isArray(priorEvents)
      ? priorEvents.length
      : 0,

    plannedActionCount: Array.isArray(actions)
      ? actions.filter((action) => action?.status === "planned").length
      : 0,

    events: rows,
    timestamp: new Date().toISOString(),
  };

  console.group(
    `[OH Native Timeline Curator v${VERSION}] AUDIT — ${incoming.length} generated event(s)`,
  );

  console.log({
    gameDate: lastAudit.gameDate,
    round: lastAudit.round,
    simulationMode: mode,
    priorEventCount: lastAudit.priorEventCount,
    plannedActionCount: lastAudit.plannedActionCount,
  });

  if (rows.length) {
    console.table(rows);
  } else {
    // this is actually useful now because we're inside the real pipeline.
    // if this says zero, gemini really handed us zero after dedupe. no fucking
    // guessing whether /events finished saving 14 milliseconds later.
    console.log("no fresh native events were supplied to the curator.");
  }

  console.log(
    "audit only — every event returned unchanged because we are not deleting shit yet.",
  );

  console.groupEnd();

  return incoming;
};

// boring getter. importantly, this does not secretly generate more requests.
export const getLastNativeCuratorAudit = () => lastAudit;

// ---- devtools access --------------------------------------------------------
// because sometimes clicking through vscode is too civilized and we need to
// stare directly into the runtime's soul.
if (typeof window !== "undefined") {
  window.__OH_NATIVE_TIMELINE_CURATOR__ = {
    version: VERSION,
    mode: "audit",
    last: () => lastAudit,
  };
}