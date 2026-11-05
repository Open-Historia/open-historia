/*! Open Historia Continuum — Political World v2 canonical quality gate
 *
 * v3 checkpoint quality is derived only from staged canon + explicit coverage.
 * There is no job-history accounting path.
 */

import { isFinitePowerScore } from "../../../runtime/powerStatus.js";
import { derivePoliticalWorldV2MembershipSurface, incompletePoliticalWorldV2Actors } from "./simpleWorklist.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(array(values).map(clean).filter(Boolean))];
const acceptedFor = (checkpoint, key) => new Set(unique(checkpoint?.coverage?.[key]));

export const evaluatePoliticalWorldV2Quality = ({
  checkpoint,
  polities = [],
  historicalVerificationRequired = false,
  relevanceByPolity = {},
} = {}) => {
  const expected = unique(polities.map((entry) => typeof entry === "string" ? entry : entry?.polityKey));
  const expectedSet = new Set(expected);
  const actorCovered = acceptedFor(checkpoint, "political-actor");
  const actorIncomplete = new Set(incompletePoliticalWorldV2Actors({
    checkpoint,
    inputs: { polities, relevanceByPolity, scenarioDate: checkpoint?.scenarioDate },
  }));
  const actorAccepted = new Set(expected.filter((polity) => actorCovered.has(polity) && !actorIncomplete.has(polity)));
  const alignmentAccepted = acceptedFor(checkpoint, "governing-alignment");
  const verificationAccepted = acceptedFor(checkpoint, "historical-verification");
  const membershipSurface = derivePoliticalWorldV2MembershipSurface(checkpoint);
  const membershipAccepted = membershipSurface.complete ? new Set(expected) : new Set();
  const powerAccepted = new Set(expected.filter((polity) => isFinitePowerScore(checkpoint?.stagedWorld?.powerStatus?.byPolity?.[polity]?.score)));

  const unresolved = [];
  const addMissing = (kind, accepted) => {
    for (const polity of expected) if (!accepted.has(polity)) unresolved.push({ kind, polityKey: polity });
  };
  addMissing("political-actor", actorAccepted);
  addMissing("membership", membershipAccepted);
  addMissing("governing-alignment", alignmentAccepted);
  addMissing("power-evidence", powerAccepted);
  if (historicalVerificationRequired) addMissing("historical-verification", verificationAccepted);

  const blockingErrors = [];
  const activeReferencePackIds = unique(checkpoint?.bootstrap?.activeReferencePackIds);
  const expectedReferenceInstitutionIds = unique(checkpoint?.bootstrap?.expectedReferenceInstitutionIds);
  const materializedReferenceInstitutionIds = unique(checkpoint?.bootstrap?.materializedReferenceInstitutionIds);
  const missingReferenceInstitutionIds = unique(checkpoint?.bootstrap?.missingReferenceInstitutionIds);
  if (activeReferencePackIds.length && expectedReferenceInstitutionIds.length && missingReferenceInstitutionIds.length) {
    blockingErrors.push(`Selected reference knowledge is incomplete in staged canon: ${missingReferenceInstitutionIds.length}/${expectedReferenceInstitutionIds.length} expected institution(s) are missing.`);
  }
  if (activeReferencePackIds.length && expectedReferenceInstitutionIds.length && materializedReferenceInstitutionIds.length < expectedReferenceInstitutionIds.length) {
    const missing = expectedReferenceInstitutionIds.filter((id) => !materializedReferenceInstitutionIds.includes(id));
    if (missing.length && !blockingErrors.some((entry) => entry.includes("Selected reference knowledge is incomplete"))) {
      blockingErrors.push(`Selected reference knowledge has not been fully materialized: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}.`);
    }
  }
  if (checkpoint?.stages?.institutionDiscovery !== "complete") blockingErrors.push("Canonical institution discovery has not completed.");
  if (checkpoint?.stages?.institutionGovernance !== "complete") blockingErrors.push("Canonical institution governance resolution has not completed.");
  if (checkpoint?.stages?.agreements !== "complete") blockingErrors.push("Standing-agreement resolution has not completed.");
  if (clean(checkpoint?.status) === "blocked" && clean(checkpoint?.lastError)) blockingErrors.push(clean(checkpoint.lastError));

  const dedupedUnresolved = [];
  const seen = new Set();
  for (const item of unresolved) {
    if (!expectedSet.has(item.polityKey)) continue;
    const key = `${item.kind}:${item.polityKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedUnresolved.push(item);
  }

  const canonicalReady = dedupedUnresolved.length === 0 && blockingErrors.length === 0;
  return {
    structuralReady: clean(checkpoint?.status) !== "blocked",
    canonicalReady,
    unresolved: dedupedUnresolved,
    blockingErrors,
    warnings: unique(checkpoint?.warnings),
    counts: {
      polities: expected.length,
      politicalActors: actorAccepted.size,
      memberships: membershipAccepted.size,
      membershipInstitutionsResolved: membershipSurface.resolvedInstitutionIds.length,
      membershipInstitutionsTotal: membershipSurface.activeInstitutionIds.length,
      governingAlignment: alignmentAccepted.size,
      powerEvidence: powerAccepted.size,
      verified: historicalVerificationRequired ? verificationAccepted.size : expected.length,
      verificationTargets: historicalVerificationRequired ? expected.length : 0,
      institutions: membershipSurface.activeInstitutionIds.length,
      referencePacksActive: activeReferencePackIds.length,
      referenceInstitutionsExpected: expectedReferenceInstitutionIds.length,
      referenceInstitutionsMaterialized: materializedReferenceInstitutionIds.length,
      agreements: array(checkpoint?.stagedWorld?.agreements).length,
      modelCalls: Number(checkpoint?.modelCalls) || 0,
    },
  };
};
