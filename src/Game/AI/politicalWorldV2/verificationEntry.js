/*! Open Historia Continuum — current staged verification candidate helpers */

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const splitPath = (rawPath) => {
  const path = clean(rawPath);
  if (!path) return null;
  const entity = path.match(/^([^.\[]+)\[([^\]]+)\](?:\.(.+))?$/);
  if (entity) return { root: entity[1], entityId: entity[2], tail: clean(entity[3]) };
  const [root, ...rest] = path.split(".");
  return { root, entityId: "", tail: rest.join(".") };
};

const readObjectPath = (value, tail) => {
  if (!tail) return value;
  let current = value;
  for (const segment of tail.split(".").filter(Boolean)) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = current[segment];
  }
  return current;
};

const writeObjectPath = (target, tail, value) => {
  if (!tail) return clone(value);
  const parts = tail.split(".").filter(Boolean);
  const out = target && typeof target === "object" && !Array.isArray(target) ? clone(target) : {};
  let cursor = out;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    cursor[key] = cursor[key] && typeof cursor[key] === "object" && !Array.isArray(cursor[key]) ? clone(cursor[key]) : {};
    cursor = cursor[key];
  }
  cursor[parts.at(-1)] = clone(value);
  return out;
};

const entityIndex = (entities, id) => {
  const wanted = clean(id).toLocaleLowerCase();
  return Array.isArray(entities) ? entities.findIndex((entry) => clean(entry?.id).toLocaleLowerCase() === wanted) : -1;
};

const overlayGeneratedPath = (patch, stagedActor, rawPath) => {
  const parsed = splitPath(rawPath);
  if (!parsed?.root) return patch;
  const out = clone(patch || {});
  if (!parsed.entityId) {
    const sourceRoot = stagedActor?.[parsed.root];
    if (sourceRoot === undefined) return out;
    if (!parsed.tail) {
      out[parsed.root] = clone(sourceRoot);
      return out;
    }
    const value = readObjectPath(sourceRoot, parsed.tail);
    if (value === undefined) return out;
    out[parsed.root] = writeObjectPath(out[parsed.root], parsed.tail, value);
    return out;
  }

  const sourceEntities = stagedActor?.[parsed.root];
  if (!Array.isArray(sourceEntities)) return out;
  const sourceIndex = entityIndex(sourceEntities, parsed.entityId);
  const targetEntities = Array.isArray(out[parsed.root]) ? clone(out[parsed.root]) : [];
  const targetIndex = entityIndex(targetEntities, parsed.entityId);

  if (sourceIndex < 0) {
    // The generator used to own this entity, but a later validated correction
    // removed it from staged canon. Do not keep resurrecting the stale proposal.
    if (!parsed.tail && targetIndex >= 0) targetEntities.splice(targetIndex, 1);
    out[parsed.root] = targetEntities;
    return out;
  }

  const sourceEntity = sourceEntities[sourceIndex];
  if (!parsed.tail) {
    if (targetIndex >= 0) targetEntities[targetIndex] = clone(sourceEntity);
    else targetEntities.push(clone(sourceEntity));
    out[parsed.root] = targetEntities;
    return out;
  }

  const value = readObjectPath(sourceEntity, parsed.tail);
  if (value === undefined) return out;
  let targetEntity = targetIndex >= 0 ? clone(targetEntities[targetIndex]) : { id: clone(sourceEntity?.id) };
  targetEntity = writeObjectPath(targetEntity, parsed.tail, value);
  if (targetIndex >= 0) targetEntities[targetIndex] = targetEntity;
  else targetEntities.push(targetEntity);
  out[parsed.root] = targetEntities;
  return out;
};

export const rebasePoliticalWorldVerificationEntry = (entry, stagedActor) => {
  const next = clone(entry);
  if (!next || !stagedActor || typeof stagedActor !== "object") return next;
  const generatedPaths = Object.keys(object(stagedActor?.generationProvenance?.byPath)).map(clean).filter(Boolean);
  if (!generatedPaths.length) return next;

  let actorPatch = clone(next?.proposal?.actorPatch || {});
  // Apply broader ownership first, then narrower paths so the current staged
  // actor wins deterministically at every generated-owned seam.
  const ordered = [...generatedPaths].sort((left, right) => left.length - right.length || left.localeCompare(right));
  for (const path of ordered) actorPatch = overlayGeneratedPath(actorPatch, stagedActor, path);

  next.proposal = { ...(next.proposal || {}), actorPatch };
  next.validation = {
    ...(next.validation || {}),
    actor: clone(stagedActor),
    appliedPaths: [...generatedPaths],
    provenance: {
      ...(next.validation?.provenance || {}),
      appliedPaths: [...generatedPaths],
    },
  };
  return next;
};

const challengeDisplayForValue = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return clean(value);
  try { return clean(JSON.stringify(value)); } catch { return ""; }
};

const readSimpleChallengePath = (actorPatch, rawPath) => {
  const path = clean(rawPath);
  if (!path || path.includes("[")) return { resolved: false, value: undefined };
  let current = actorPatch;
  for (const segment of path.split(".").filter(Boolean)) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(segment in current)) {
      return { resolved: true, value: undefined };
    }
    current = current[segment];
  }
  return { resolved: true, value: current };
};

export const historicalChallengeStillAppliesToEntry = (challenge, entry) => {
  const facts = Array.isArray(challenge?.challengedFacts) ? challenge.challengedFacts : [];
  if (!facts.length) return true;
  const actorPatch = entry?.proposal?.actorPatch || {};
  let resolvedFacts = 0;
  for (const fact of facts) {
    const current = readSimpleChallengePath(actorPatch, fact?.path);
    if (!current.resolved) return true; // fail closed for complex/unknown fact paths
    resolvedFacts += 1;
    if (challengeDisplayForValue(current.value) === clean(fact?.display)) return true;
  }
  return resolvedFacts === 0;
};
