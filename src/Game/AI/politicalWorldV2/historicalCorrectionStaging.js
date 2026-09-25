/*! Open Historia Continuum — staged Political World historical corrections
 *
 * Exact-date verification is allowed to replace only fields the generator itself
 * materialized. This helper applies a validated correction patch onto the current
 * staged actor without rebuilding the actor from a partial generation delta.
 */

import { normalizePoliticalActorRecord } from "../../../runtime/politicalActors.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const generatedPathOwns = (appliedPaths, path) => {
  const target = clean(path);
  if (!target) return false;
  return appliedPaths.some((raw) => {
    const owned = clean(raw);
    if (!owned) return false;
    return target === owned
      || target.startsWith(`${owned}.`)
      || target.startsWith(`${owned}[`);
  });
};

const entityIdentity = (entity) => {
  const id = clean(entity?.id).toLocaleLowerCase();
  if (id) return `id:${id}`;
  const name = clean(entity?.name).toLocaleLowerCase();
  return name ? `name:${name}` : "";
};

const entityPathOwned = (appliedPaths, collection, entity) => {
  if (generatedPathOwns(appliedPaths, collection)) return true;
  const id = clean(entity?.id);
  if (id && generatedPathOwns(appliedPaths, `${collection}[${id}]`)) return true;
  return false;
};

const applyNestedCorrection = (target, correction, prefix, appliedPaths) => {
  const out = object(target);
  for (const [key, value] of Object.entries(object(correction))) {
    const path = `${prefix}.${key}`;
    if (generatedPathOwns(appliedPaths, path)) out[key] = clone(value);
  }
  return out;
};

const applyEntityCorrections = ({ current, corrections, collection, appliedPaths, replaceSet }) => {
  const existing = Array.isArray(current) ? clone(current) : [];
  const incoming = Array.isArray(corrections) ? corrections.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) : [];
  if (!incoming.length) return existing;

  const collectionOwned = generatedPathOwns(appliedPaths, collection);
  if (replaceSet === true && collectionOwned) {
    return incoming.map((correction) => {
      const key = entityIdentity(correction);
      const previous = key ? existing.find((entry) => entityIdentity(entry) === key) : null;
      return previous ? { ...clone(previous), ...clone(correction) } : clone(correction);
    });
  }

  const out = existing;
  for (const correction of incoming) {
    if (!entityPathOwned(appliedPaths, collection, correction)) continue;
    const key = entityIdentity(correction);
    const index = key ? out.findIndex((entry) => entityIdentity(entry) === key) : -1;
    if (index >= 0) out[index] = { ...out[index], ...clone(correction) };
    else if (collectionOwned) out.push(clone(correction));
  }
  return out;
};

export const applyValidatedHistoricalCorrectionToStagedActor = ({
  currentActor,
  correctionEntry,
} = {}) => {
  const polityKey = clean(correctionEntry?.item?.polityKey || currentActor?.polityKey);
  const verification = object(correctionEntry?.historicalVerification);
  const correction = object(verification?.correctionPatch);
  const appliedPaths = [
    ...(Array.isArray(correctionEntry?.validation?.appliedPaths) ? correctionEntry.validation.appliedPaths : []),
    ...(Array.isArray(correctionEntry?.validation?.provenance?.appliedPaths) ? correctionEntry.validation.provenance.appliedPaths : []),
  ].map(clean).filter(Boolean);

  if (!polityKey || !Object.keys(correction).length || !appliedPaths.length) {
    return currentActor ? clone(currentActor) : null;
  }

  const out = clone(currentActor && typeof currentActor === "object" ? currentActor : {});

  if (correction.politicalSystem && typeof correction.politicalSystem === "object") {
    out.politicalSystem = applyNestedCorrection(out.politicalSystem, correction.politicalSystem, "politicalSystem", appliedPaths);
  }
  if (correction.government && typeof correction.government === "object") {
    out.government = applyNestedCorrection(out.government, correction.government, "government", appliedPaths);
  }

  for (const key of ["leader", "goals", "fears", "ambitions", "domesticPressures", "perceptions"]) {
    if (correction[key] !== undefined && generatedPathOwns(appliedPaths, key)) out[key] = clone(correction[key]);
  }

  for (const collection of ["parties", "powerBlocs"]) {
    if (!Array.isArray(correction[collection])) continue;
    out[collection] = applyEntityCorrections({
      current: out[collection],
      corrections: correction[collection],
      collection,
      appliedPaths,
      replaceSet: verification.replaceRepresentationEntities === true,
    });
  }

  return normalizePoliticalActorRecord({ ...out, polityKey }, polityKey);
};
