import { normalizeWorldState } from "../../runtime/gameState.js";

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

export const getActiveRegionCatalog = (world, regionCatalog = []) => {
  const catalog = normalizeArray(regionCatalog);
  return world?.customRegions
    ? catalog.filter((region) => region?.inCustomGeometry === true)
    : catalog;
};

const impactContainers = (candidate) => Array.isArray(candidate?.events)
  ? candidate.events.map((event, index) => ({ impacts: event?.impacts, path: `$.events[${index}].impacts` }))
  : [{ impacts: candidate?.impacts, path: "$.impacts" }];

const buildRegionCandidates = ({ activeRegions, fromCode, regionName }) => {
  const wantedName = normalizeString(regionName).toLocaleLowerCase();
  const wantedOwner = normalizeString(fromCode);
  const candidates = activeRegions.filter((region) => {
    const name = normalizeString(region.name).toLocaleLowerCase();
    return (wantedName && (name.includes(wantedName) || wantedName.includes(name))) ||
      (wantedOwner && region.currentOwner === wantedOwner);
  }).slice(0, 8);
  if (candidates.length === 0) return "";
  return ` Valid candidates: ${candidates
    .map((region) => `${region.id}=${region.name} (owner ${region.currentOwner || "unclaimed"})`)
    .join(", ")}.`;
};

export const validateRegionTransfers = ({
  candidate,
  countryCatalog = [],
  regionCatalog = [],
  world = {},
} = {}) => {
  const normalizedWorld = normalizeWorldState(world);
  const activeCatalog = getActiveRegionCatalog(normalizedWorld, regionCatalog);
  const knownRegionIds = new Set(activeCatalog.map((region) => normalizeString(region?.id)).filter(Boolean));
  // If the geometry/catalog is temporarily unavailable, existing saved IDs are
  // safer than rejecting every transfer. Once a catalog exists, it is the sole
  // authority and phantom override keys are deliberately excluded.
  if (knownRegionIds.size === 0 && !normalizedWorld.customRegions) {
    Object.keys(normalizedWorld.regionOwnershipOverrides).forEach((id) => knownRegionIds.add(id));
  }

  const ownerByRegion = new Map();
  const activeRegions = activeCatalog
    .map((region) => {
      const id = normalizeString(region?.id);
      if (!id) return null;
      const hasOverride = Object.prototype.hasOwnProperty.call(normalizedWorld.regionOwnershipOverrides, id);
      const currentOwner = normalizeString(
        hasOverride
          ? normalizedWorld.regionOwnershipOverrides[id]
          : region?.ownerCode ?? region?.countryCode,
      );
      ownerByRegion.set(id, currentOwner);
      return { id, name: normalizeString(region?.name) || id, currentOwner };
    })
    .filter(Boolean);
  if (activeRegions.length === 0 && !normalizedWorld.customRegions) {
    for (const [id, currentOwner] of Object.entries(normalizedWorld.regionOwnershipOverrides)) {
      ownerByRegion.set(id, currentOwner);
      activeRegions.push({ id, name: id, currentOwner });
    }
  }

  const knownCodes = new Set();
  const addCode = (value) => {
    const code = normalizeString(value);
    if (code) knownCodes.add(code);
  };
  if (!normalizedWorld.customRegions) {
    normalizeArray(countryCatalog).forEach((country) => addCode(country?.code));
  }
  activeCatalog.forEach((region) => {
    if (!normalizedWorld.customRegions) addCode(region?.countryCode);
    addCode(region?.ownerCode);
  });
  normalizeArray(normalizedWorld.ownerCodes).forEach(addCode);
  Object.values(normalizedWorld.regionOwnershipOverrides).forEach(addCode);
  Object.entries(normalizedWorld.polityOverrides).forEach(([code, polity]) => {
    addCode(code);
    addCode(polity?.code);
  });
  normalizedWorld.units.forEach((unit) => addCode(unit?.ownerCode));

  const containers = impactContainers(candidate);
  for (const { impacts } of containers) {
    normalizeArray(impacts?.polityChanges).forEach((polity) => addCode(polity?.code));
  }

  for (const { impacts, path } of containers) {
    const transfers = normalizeArray(impacts?.regionTransfers);
    for (let index = 0; index < transfers.length; index += 1) {
      const transfer = transfers[index];
      const transferPath = `${path}.regionTransfers[${index}]`;
      const regionId = normalizeString(transfer?.regionId);
      const toCode = normalizeString(transfer?.toCode);
      const fromCode = normalizeString(transfer?.fromCode);
      if (!regionId) return `${transferPath}.regionId must not be blank.`;
      if (!toCode) return `${transferPath}.toCode must not be blank.`;
      if (!knownRegionIds.has(regionId)) {
        return `${transferPath}.regionId "${regionId}" is not on the active map.` + buildRegionCandidates({
          activeRegions,
          fromCode,
          regionName: transfer?.regionName,
        });
      }
      if (!knownCodes.has(toCode)) {
        const caseMatch = [...knownCodes].find((code) => code.toLocaleLowerCase() === toCode.toLocaleLowerCase());
        return `${transferPath}.toCode "${toCode}" is not an existing or newly created polity code.` +
          (caseMatch ? ` Use exact code "${caseMatch}".` : "");
      }

      const currentOwner = ownerByRegion.get(regionId) ?? "";
      if (fromCode && currentOwner && fromCode !== currentOwner) {
        return `${transferPath}.fromCode "${fromCode}" does not match current owner "${currentOwner}" for ${regionId}.`;
      }
      ownerByRegion.set(regionId, toCode);
    }
  }

  return "";
};
