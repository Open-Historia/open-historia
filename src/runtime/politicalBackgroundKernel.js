/*! Open Historia — pure worker kernel for political background simulation (Continuum) */

import { normalizePoliticalActors } from "./politicalActors.js";
import { advancePoliticalPressureBatch } from "./politicalPressure.js";
import { advancePoliticalResponseBatch } from "./politicalResponse.js";
import { advancePoliticalDispositionBatch } from "./politicalDisposition.js";
import { POLITICAL_ACTOR_OPS } from "./politicalActorOps.js";

const clean = (value) => String(value ?? "").trim();
const cloneValue = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const applyEphemeralResponseOperation = (actorsByPolity, operation) => {
  const actor = actorsByPolity?.[operation?.polityKey];
  if (!actor) return false;

  if (operation.op === POLITICAL_ACTOR_OPS.SET_PARTY_SUPPORT) {
    const party = (actor.parties || []).find((entry) => entry.id === operation.partyId);
    if (!party) return false;
    party.support = { percent: operation.percent };
    return true;
  }

  if (operation.op === POLITICAL_ACTOR_OPS.SET_PARTY_INFLUENCE) {
    const party = (actor.parties || []).find((entry) => entry.id === operation.partyId);
    if (!party) return false;
    party.influence = { ...(party.influence || {}), percent: operation.percent };
    return true;
  }

  if (operation.op === POLITICAL_ACTOR_OPS.SET_POWER_BLOC_INFLUENCE) {
    const bloc = (actor.powerBlocs || []).find((entry) => entry.id === operation.blocId);
    if (!bloc) return false;
    bloc.influence = { ...(bloc.influence || {}), percent: operation.percent };
    return true;
  }

  return false;
};

const responseOperationKey = (operation) => {
  if (operation.op === POLITICAL_ACTOR_OPS.SET_PARTY_SUPPORT) return `${operation.polityKey}|party-support|${operation.partyId}`;
  if (operation.op === POLITICAL_ACTOR_OPS.SET_PARTY_INFLUENCE) return `${operation.polityKey}|party-influence|${operation.partyId}`;
  return `${operation.polityKey}|bloc|${operation.blocId}`;
};

// Pure compute kernel. Intermediate monthly support/influence updates exist only
// inside the worker's detached copy. The caller still commits the FINAL values
// through politicalActorOps on the canonical world, so this is not a second state
// mutation path.
export const advancePoliticalBackgroundKernel = ({
  actorsByPolity = {},
  signalsByPolity = {},
  months = 0,
  updatedAt = "",
  round = 0,
  responseTicks = 0,
} = {}) => {
  const actors = normalizePoliticalActors({ byPolity: cloneValue(actorsByPolity) });
  const pressure = advancePoliticalPressureBatch({
    actorsByPolity: actors.byPolity,
    signalsByPolity,
    months,
    updatedAt,
  });

  for (const [polityKey, state] of Object.entries(pressure.patchesByPolity || {})) {
    const actor = actors.byPolity[polityKey];
    if (actor) actor.politicalPressures = cloneValue(state);
  }

  const finalResponseOps = new Map();
  let responseChangedEntities = 0;
  let responseChangedPolities = 0;
  const ticks = Math.max(0, Math.trunc(Number(responseTicks) || 0));
  for (let tick = 0; tick < ticks; tick += 1) {
    const response = advancePoliticalResponseBatch({
      actorsByPolity: actors.byPolity,
      updatedAt: `${clean(updatedAt)}|r${Math.max(0, Math.trunc(Number(round) || 0))}|t${tick + 1}`,
    });
    if (!response.operations.length) continue;
    responseChangedEntities += response.changedEntities;
    responseChangedPolities += response.changedPolities;
    for (const operation of response.operations) {
      if (!applyEphemeralResponseOperation(actors.byPolity, operation)) continue;
      finalResponseOps.set(responseOperationKey(operation), cloneValue(operation));
    }
  }

  const disposition = advancePoliticalDispositionBatch({
    actorsByPolity: actors.byPolity,
    updatedAt,
  });

  return {
    pressurePatchesByPolity: pressure.patchesByPolity || {},
    pressureChangedPolities: Number(pressure.changedPolities) || 0,
    responseOperations: [...finalResponseOps.values()],
    responseChangedEntities,
    responseChangedPolities,
    dispositionOperations: disposition.operations || [],
    dispositionChangedPolities: Number(disposition.changedPolities) || 0,
  };
};
