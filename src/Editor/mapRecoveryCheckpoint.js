/*!
 * Beta N022: a persisted, independently loadable map-document checkpoint
 * before a whole-world replacement. Server confirmation is insufficient:
 * verify the saved regions and authored registries by reading it back.
 */
import { regionDeltaKey } from "../../server/regionDelta.js";
import { DOCUMENT_FIELDS } from "../../server/mapEditorFields.js";

const has = (obj,key) => Object.prototype.hasOwnProperty.call(obj || {},key);
// Use the store's entire document contract, not a second list that can omit
// newly persisted fields (for example staged government edits).
const PRESERVE = Object.keys(DOCUMENT_FIELDS).filter((field) => field !== "regions");
const comparableMetadata = (metadata) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  // Store creation legitimately refreshes the bookkeeping timestamps.
  return Object.fromEntries(Object.keys(metadata)
    .filter((key) => key !== "createdAt" && key !== "updatedAt")
    .sort().map((key) => [key, metadata[key]]));
};
const regionShape = (fc) => fc && fc.type === "FeatureCollection" && Array.isArray(fc.features);
const keyCounts = (value) => (
  Array.isArray(value)
    ? value.length
    : value && typeof value === "object"
      ? Object.entries(value).filter(([, entry]) => entry !== undefined).length
      : 0
);

export const verifyRecoverySnapshot = (expected,actual) => {
  if (!expected || !actual || !regionShape(expected.regions) || !regionShape(actual.regions)) return false;
  if (expected.regions.features.length !== actual.regions.features.length) return false;
  // Count alone can be satisfied by a truncated/cross-written map with the same
  // number of features. IDs and each feature's geometry need to match as well.
  const before=expected.regions.features,after=actual.regions.features;
  for (let i=0;i<before.length;i++) {
    const a=before[i],b=after[i];
    if (!a || !b || regionDeltaKey(a)!==regionDeltaKey(b) ||
        a.geometry?.type!==b.geometry?.type ||
        JSON.stringify(a.geometry?.coordinates)!==JSON.stringify(b.geometry?.coordinates)) return false;
  }
  for (const field of PRESERVE) {
    if (has(expected,field)!==has(actual,field)) return false;
    if (has(expected,field) &&
        (keyCounts(expected[field])!==keyCounts(actual[field]) ||
         JSON.stringify(expected[field])!==JSON.stringify(actual[field]))) return false;
  }
  const expectedMetadata = comparableMetadata(expected.metadata);
  const actualMetadata = comparableMetadata(actual.metadata);
  if (!expectedMetadata || !actualMetadata ||
      JSON.stringify(expectedMetadata) !== JSON.stringify(actualMetadata)) return false;
  return true;
};

export const createVerifiedMapRecovery = async ({
  payload,reason,save,load,now=new Date(),
}) => {
  if (!regionShape(payload?.regions) || typeof save!=="function" || typeof load!=="function")
    throw new Error("Cannot replace the map: a complete recoverable map document is not available.");
  const originalName=String(payload.metadata?.name||payload.name||"Map").trim()||"Map";
  const reasonLabel=String(reason||"replacement").trim().slice(0,70);
  const stamp=new Date(now);
  if (!Number.isFinite(stamp.getTime())) throw new Error("Invalid recovery checkpoint date.");
  const name=`Recovery — ${originalName} — before ${reasonLabel} — ${stamp.toISOString().slice(0,19).replace("T"," ")}`;
  const snapshot={
    ...payload, id:null, name,
    metadata:{...(payload.metadata||{}),name},
  };
  // This deliberately creates a DIFFERENT Saved map. It never updates the
  // current working-document ID or the live scenario.
  const saved=await save(null,snapshot);
  const id=String(saved?.id||"").trim();
  if (!id) throw new Error("Recovery checkpoint was not acknowledged by map storage. Nothing was replaced.");
  const reopened=await load(id);
  if (!verifyRecoverySnapshot(snapshot,reopened)) {
    throw new Error(`Recovery checkpoint ${id} could not be verified after saving. Nothing was replaced.`);
  }
  return {id,name,regions: snapshot.regions.features.length};
};
