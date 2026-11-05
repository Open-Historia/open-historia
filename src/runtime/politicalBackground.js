/*! Open Historia — native political background simulation orchestration (Continuum) */

import { applyPoliticalActorOperations, POLITICAL_ACTOR_OPS } from "./politicalActorOps.js";
import { normalizePoliticalActors } from "./politicalActors.js";
import { advancePoliticalBackgroundBatchInWorker } from "./politicalBackgroundClient.js";
import { buildPoliticalClockPlan, normalizePoliticalSimulationClock } from "./politicalClock.js";
import { derivePoliticalStructuralSignals, heldRegionCounts } from "./politicalStructuralPressure.js";

const cloneValue = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const pressureOperations = (patchesByPolity) => Object.entries(patchesByPolity || {}).map(([polityKey, state]) => ({
  op: POLITICAL_ACTOR_OPS.SET_POLITICAL_PRESSURES,
  polityKey,
  state,
}));

const isAbortError = (error) => error?.name === "AbortError";

// Skips that are simply "nothing to do" rather than something broke.
const QUIET_SKIP_REASONS = new Set(["no-time-advanced", "no-political-actors"]);

// What the turn writes to the debug log about one background run, or null for
// nothing. A skip for a real reason (no worker, a worker error, a failed
// commit) and a committed run that dropped a disposition op are logged outside
// verbose mode, so a save whose parties never change carries the reason.
export const describePoliticalBackgroundResult = (political) => {
  if (!political || typeof political !== "object") return null;
  const droppedResponseTicks = Number(political.plan?.droppedResponseTicks) || 0;
  if (political.skipped) {
    if (QUIET_SKIP_REASONS.has(political.reason)) return null;
    const errors = [
      ...(Array.isArray(political.errors) ? political.errors : []),
      ...(political.error ? [political.error?.message || String(political.error)] : []),
    ];
    return {
      message: `Political background skipped (${political.reason || "unknown reason"}); the political state and clock are unchanged.`,
      detail: { reason: political.reason || "", ...(errors.length ? { errors } : {}), droppedResponseTicks },
      verbose: false,
    };
  }
  const dispositionErrors = Array.isArray(political.dispositionErrors) ? political.dispositionErrors : [];
  const changed = political.pressureChangedPolities || political.responseChangedEntities || political.dispositionChangedPolities;
  if (!changed && !dispositionErrors.length && !droppedResponseTicks) return null;
  return {
    message: `Political background: ${political.pressureChangedPolities || 0} pressure polity(s), ${political.responseChangedEntities || 0} political response change(s), ${political.dispositionChangedPolities || 0} disposition change(s).`,
    detail: {
      responseTicks: political.plan?.responseTicks || 0,
      structuralSignalPolities: political.structuralSignalPolities || 0,
      droppedResponseTicks,
      ...(dispositionErrors.length ? { dispositionErrors } : {}),
    },
    verbose: !dispositionErrors.length,
  };
};

export const advancePoliticalBackgroundSimulation = async ({
  world,
  fromDate = "",
  toDate = "",
  round = 0,
  signal,
  backgroundAdvance = advancePoliticalBackgroundBatchInWorker,
  // Groups switched off for the game (politicalStructuralPressure.js).
  groups = true,
} = {}) => {
  const inputWorld = world && typeof world === "object" && !Array.isArray(world) ? world : {};
  const currentClock = normalizePoliticalSimulationClock(inputWorld.politicalSimulation);
  const plan = buildPoliticalClockPlan({ clock: currentClock, fromDate, toDate, round });
  if (plan.elapsedMonths <= 0) {
    return { world: inputWorld, skipped: true, reason: "no-time-advanced", plan, pressureChangedPolities: 0, responseChangedEntities: 0 };
  }

  const actors = normalizePoliticalActors(inputWorld.politicalActors);
  if (!Object.keys(actors.byPolity).length) {
    return {
      world: { ...inputWorld, politicalSimulation: plan.nextClock },
      skipped: true,
      reason: "no-political-actors",
      plan,
      pressureChangedPolities: 0,
      responseChangedEntities: 0,
    };
  }

  const signalsByPolity = derivePoliticalStructuralSignals({ ...inputWorld, politicalActors: actors }, {
    months: plan.elapsedMonths,
    updatedAt: plan.toDate,
    groups,
  });

  let computed;
  try {
    computed = await backgroundAdvance({
      actorsByPolity: cloneValue(actors.byPolity),
      signalsByPolity,
      months: plan.elapsedMonths,
      updatedAt: plan.toDate,
      round,
      responseTicks: plan.responseTicks,
    }, { signal });
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error;
    return { world: inputWorld, skipped: true, reason: "background-worker-error", error, plan, pressureChangedPolities: 0, responseChangedEntities: 0 };
  }

  if (computed?.skipped) {
    return {
      world: inputWorld,
      skipped: true,
      reason: computed.reason || "background-worker-skipped",
      plan,
      pressureChangedPolities: 0,
      responseChangedEntities: 0,
    };
  }

  const nextWorld = cloneValue({ ...inputWorld, politicalActors: actors });
  const pressureApply = applyPoliticalActorOperations(nextWorld, pressureOperations(computed?.pressurePatchesByPolity));
  if (pressureApply.failed) {
    return {
      world: inputWorld,
      skipped: true,
      reason: "pressure-commit-failed",
      plan,
      pressureChangedPolities: 0,
      responseChangedEntities: 0,
      errors: pressureApply.results.filter((entry) => entry.error).map((entry) => entry.error),
    };
  }

  const responseApply = applyPoliticalActorOperations(nextWorld, computed?.responseOperations || []);
  if (responseApply.failed) {
    return {
      world: inputWorld,
      skipped: true,
      reason: "response-commit-failed",
      plan,
      pressureChangedPolities: 0,
      responseChangedEntities: 0,
      errors: responseApply.results.filter((entry) => entry.error).map((entry) => entry.error),
    };
  }

  // Dispositions are derived per polity from the state committed above, so one
  // bad disposition op skips only itself instead of discarding every pressure
  // and response change for the whole world.
  const dispositionApply = applyPoliticalActorOperations(nextWorld, computed?.dispositionOperations || [], { stopOnError: false });
  const dispositionErrors = dispositionApply.results.filter((entry) => entry.error).map((entry) => entry.error);

  // The ground each actor holds now is what the next advance measures a loss against.
  nextWorld.politicalSimulation = normalizePoliticalSimulationClock({ ...plan.nextClock, heldRegions: heldRegionCounts(nextWorld) });
  return {
    world: nextWorld,
    skipped: false,
    reason: "",
    plan,
    pressureChangedPolities: Number(computed?.pressureChangedPolities) || 0,
    responseChangedEntities: Number(computed?.responseChangedEntities) || 0,
    responseChangedPolities: Number(computed?.responseChangedPolities) || 0,
    structuralSignalPolities: Object.keys(signalsByPolity).length,
    committedResponseEntities: responseApply.applied,
    dispositionChangedPolities: Number(computed?.dispositionChangedPolities) || 0,
    committedDispositions: dispositionApply.applied,
    ...(dispositionErrors.length ? { dispositionErrors } : {}),
  };
};
