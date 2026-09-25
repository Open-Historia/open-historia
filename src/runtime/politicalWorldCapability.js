/*! Open Historia — player-facing Political World capability state. */

const object = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

export const POLITICAL_WORLD_CAPABILITY = Object.freeze({
  ABSENT: "absent",
  SPARSE: "sparse",
  AVAILABLE: "available",
});

export const politicalWorldCapability = (world = {}, { polityCount = 0 } = {}) => {
  const actorsByPolity = object(world?.politicalActors?.byPolity);
  const actorCount = Object.values(actorsByPolity).filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)).length;
  const expectedPolities = Math.max(0, Math.trunc(Number(polityCount) || 0));

  let status = POLITICAL_WORLD_CAPABILITY.AVAILABLE;
  if (actorCount === 0) status = POLITICAL_WORLD_CAPABILITY.ABSENT;
  else if (expectedPolities > 0 && actorCount < expectedPolities) status = POLITICAL_WORLD_CAPABILITY.SPARSE;

  return {
    status,
    actorCount,
    polityCount: expectedPolities,
    available: actorCount > 0,
  };
};

export const politicalWorldCapabilityLabel = (capability = {}) => {
  if (capability.status === POLITICAL_WORLD_CAPABILITY.ABSENT) return "Not generated";
  if (capability.status === POLITICAL_WORLD_CAPABILITY.SPARSE) return "Available - partially developed";
  return "Available";
};
