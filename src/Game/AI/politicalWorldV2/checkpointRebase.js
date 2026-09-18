/*! Open Historia Continuum — narrow v2 Canon Context checkpoint rebase
 *
 * This exists only to rescue an un-applied generator workspace when the saved
 * scenario's Canon Context/reference-pack selection is newer than the workspace
 * fingerprint. It never rebases authored political/institution ledgers.
 */

import { activeReferencePackIds, materializeScenarioCanon, readScenarioCanon } from "../../../runtime/scenarioCanon.js";
import { canonReferencePackDomains } from "../../../runtime/canonReferencePacks.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => Array.isArray(value) ? value : [];
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};
const stableComparable = (value) => {
  if (Array.isArray(value)) return value.map(stableComparable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableComparable(value[key])]));
};
const sameJson = (left, right) => JSON.stringify(stableComparable(left)) === JSON.stringify(stableComparable(right));

const SAFE_REBASE_REFERENCE_DOMAINS = new Set(["institutions", "memberships"]);

const roundZeroWithoutPackSelection = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const next = clone(value);
  delete next.referencePackIds;
  return next;
};

const referencePackSet = (world) => new Set(activeReferencePackIds(readScenarioCanon(world).canonContext));

const referencePackChangeIsNarrowlySafe = (stagedWorld, freshWorld) => {
  const before = referencePackSet(stagedWorld);
  const after = referencePackSet(freshWorld);
  const changed = [...new Set([...before, ...after])].filter((id) => before.has(id) !== after.has(id));
  if (!changed.length) return false;
  return changed.every((id) => {
    const domains = canonReferencePackDomains(id);
    return domains.length > 0 && domains.every((domain) => SAFE_REBASE_REFERENCE_DOMAINS.has(clean(domain)));
  });
};

const activePolityKeys = (polities = []) => array(polities)
  .filter((entry) => typeof entry === "string" || entry?.active !== false)
  .map((entry) => clean(typeof entry === "string" ? entry : entry?.polityKey))
  .filter(Boolean);

export const canSafelyRebasePoliticalWorldV2ReferenceCanon = (checkpoint, inputs) => {
  const freshWorld = inputs?.world || {};
  const freshCanon = readScenarioCanon(freshWorld);
  if (!freshCanon.initialized || activeReferencePackIds(freshCanon.canonContext).length === 0) return false;
  if (clean(checkpoint?.scenarioDate) !== clean(inputs?.scenarioDate)) return false;

  const staged = checkpoint?.stagedWorld || {};
  if (!referencePackChangeIsNarrowlySafe(staged, freshWorld)) return false;
  if (!checkpoint?.sourceRoundZeroContext) return false;
  if (!sameJson(
    roundZeroWithoutPackSelection(checkpoint.sourceRoundZeroContext),
    roundZeroWithoutPackSelection(inputs?.roundZeroContext || null),
  )) return false;
  const stableWorldKeys = [
    "startingTimelineText",
    "simulationRules",
    "polityOverrides",
    "ownerCodes",
    "regionOwnershipOverrides",
    "regionSovereigntyOverrides",
    "wars",
    "relations",
  ];
  if (stableWorldKeys.some((key) => !sameJson(staged?.[key] ?? null, freshWorld?.[key] ?? null))) return false;

  // Saved owning ledgers mean the author may have edited canon since generation
  // began. Never hide that behind an automatic rebase.
  if (Object.keys(freshWorld?.politicalActors?.byPolity || {}).length) return false;
  if (Object.keys(freshWorld?.institutions?.byId || {}).length) return false;
  if (array(freshWorld?.agreements).length) return false;

  const expected = new Set(activePolityKeys(inputs?.polities || []));
  return array(checkpoint?.coverage?.["political-actor"]).every((polity) => expected.has(clean(polity)));
};

export const rebasePoliticalWorldV2ReferenceCanon = (checkpoint, inputs, inputFingerprint) => {
  if (!canSafelyRebasePoliticalWorldV2ReferenceCanon(checkpoint, inputs)) return null;
  const next = clone(checkpoint);
  next.inputFingerprint = clean(inputFingerprint);
  next.sourceRoundZeroContext = clone(inputs?.roundZeroContext || null);
  next.stagedWorld = materializeScenarioCanon(next.stagedWorld || {}, {
    canonContext: inputs?.world?.canonContext,
  });
  next.bootstrap = { ...(next.bootstrap || {}), canonContextRebased: true };
  // Rebased Canon Context changes the authoritative reference surface. The
  // previously completed global institution/agreement stages were evaluated
  // against the older surface and must be reconciled before Apply can become
  // available again. Keep the expensive polity-level canon, but deliberately
  // invalidate readiness until Resume performs deterministic reference seeding
  // and the two global passes again.
  next.stages = { ...(next.stages || {}), institutionDiscovery: "pending", institutionGovernance: "pending", agreements: "pending" };
  next.quality = {
    ...(next.quality || {}),
    structuralReady: true,
    canonicalReady: false,
    blockingErrors: [],
  };
  next.status = "ready";
  next.pauseReason = "reference-canon-rebase";
  next.lastError = "";
  next.currentTask = null;
  return next;
};
