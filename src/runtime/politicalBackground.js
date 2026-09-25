/*! Open Historia — native political background simulation orchestration (Continuum) */

import { applyPoliticalActorOperations, POLITICAL_ACTOR_OPS } from "./politicalActorOps.js";
import { normalizePoliticalActors } from "./politicalActors.js";
import { advancePoliticalBackgroundBatchInWorker } from "./politicalBackgroundClient.js";
import { buildPoliticalClockPlan, normalizePoliticalSimulationClock } from "./politicalClock.js";
import { derivePoliticalStructuralSignals } from "./politicalStructuralPressure.js";

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

export const advancePoliticalBackgroundSimulation = async ({
  world,
  fromDate = "",
  toDate = "",
  round = 0,
  signal,
  backgroundAdvance = advancePoliticalBackgroundBatchInWorker,
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

  const dispositionApply = applyPoliticalActorOperations(nextWorld, computed?.dispositionOperations || []);
  if (dispositionApply.failed) {
    return {
      world: inputWorld,
      skipped: true,
      reason: "disposition-commit-failed",
      plan,
      pressureChangedPolities: 0,
      responseChangedEntities: 0,
      errors: dispositionApply.results.filter((entry) => entry.error).map((entry) => entry.error),
    };
  }

  nextWorld.politicalSimulation = plan.nextClock;
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
  };
};
