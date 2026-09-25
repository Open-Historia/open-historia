/*! Open Historia Continuum — Political World v2 bounded job planner
 *
 * The user sees one Generate Political World workflow. These jobs are internal
 * resumable units chosen by expected response size, not UI phases.
 */

import { createPoliticalWorldV2Job } from "./jobGraph.js";

export const POLITICAL_WORLD_V2_QUALITY_MODES = Object.freeze(["fast", "balanced", "canonical"]);
export const POLITICAL_WORLD_V2_DEFAULT_QUALITY_MODE = "canonical";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(array(values).map(clean).filter(Boolean))];
const chunk = (values, size) => {
  const out = [];
  const width = Math.max(1, Math.trunc(Number(size) || 1));
  for (let index = 0; index < values.length; index += width) out.push(values.slice(index, index + width));
  return out;
};

const MODE_CONFIG = Object.freeze({
  fast: {
    actorBatch: 12,
    membershipBatch: 24,
    alignmentBatch: 48,
    targetedVerification: false,
  },
  balanced: {
    actorBatch: 8,
    membershipBatch: 20,
    alignmentBatch: 40,
    targetedVerification: true,
  },
  canonical: {
    actorBatch: 8,
    membershipBatch: 16,
    alignmentBatch: 32,
    targetedVerification: true,
  },
});

export const politicalWorldV2ModeConfig = (mode = POLITICAL_WORLD_V2_DEFAULT_QUALITY_MODE) => MODE_CONFIG[
  POLITICAL_WORLD_V2_QUALITY_MODES.includes(clean(mode)) ? clean(mode) : POLITICAL_WORLD_V2_DEFAULT_QUALITY_MODE
];

export const planPoliticalWorldV2Jobs = ({
  polities = [],
  qualityMode = POLITICAL_WORLD_V2_DEFAULT_QUALITY_MODE,
  hasCanonicalInstitutionCatalog = false,
  referenceResolvedMembershipPolities = [],
  referenceCoveredInstitutionIds = [],
  nativeResolvedPowerPolities = [],
  verificationTargets = [],
} = {}) => {
  const polityKeys = unique(polities.map((entry) => typeof entry === "string" ? entry : entry?.polityKey).filter(Boolean));
  const config = politicalWorldV2ModeConfig(qualityMode);
  const jobs = [];

  let catalogDependency = [];
  // Canonical/Balanced quality still performs one bounded discovery pass even
  // when reference data already seeded a catalog. Reference packs are reusable
  // knowledge, not a claim that they exhaust every strategically material
  // institution in an authored/alternate universe. Fast mode may trust an
  // already-materialized catalog and skip the call.
  const discoverInstitutions = !hasCanonicalInstitutionCatalog || qualityMode !== "fast";
  if (discoverInstitutions) {
    jobs.push(createPoliticalWorldV2Job({
      id: "institutions:discover",
      type: "institution-discovery",
      stage: "institutions",
      targets: [],
      maxAttempts: 2,
    }));
    catalogDependency = ["institutions:discover"];
  }

  // Membership resolution is institution-centric in v2. Reference packs may
  // exhaustively cover a subset (or all) of the active canonical catalog.
  // After institution discovery, one deterministic surface job identifies only
  // the uncovered institution identities; each uncovered institution then costs
  // at most one bounded provider call, regardless of polity count.
  const membershipJobs = [createPoliticalWorldV2Job({
    id: "memberships:surface",
    type: "membership-surface",
    stage: "institutions",
    targets: [],
    dependencies: catalogDependency,
    payload: {
      referenceCoveredInstitutionIds: unique(referenceCoveredInstitutionIds),
      legacyReferenceResolvedMembershipPolities: unique(referenceResolvedMembershipPolities),
    },
    maxAttempts: 1,
  })];
  const actorJobs = chunk(polityKeys, config.actorBatch).map((targets, index) => createPoliticalWorldV2Job({
    id: `actors:${String(index + 1).padStart(3, "0")}`,
    type: "political-actor",
    stage: "politics",
    targets,
    // Political organisms are independent canonical work. A provider/catalog
    // failure must never prevent us from retaining already-successful politics.
    dependencies: [],
    maxAttempts: 1,
  }));
  jobs.push(...actorJobs);

  const actorJobByPolity = new Map();
  for (const job of actorJobs) for (const polity of job.targets) actorJobByPolity.set(polity, job.id);

  const alignmentJobs = chunk(polityKeys, config.alignmentBatch).map((targets, index) => createPoliticalWorldV2Job({
    id: `alignment:${String(index + 1).padStart(3, "0")}`,
    type: "governing-alignment",
    stage: "politics",
    targets,
    dependencies: unique(targets.map((polity) => actorJobByPolity.get(polity))),
    maxAttempts: 1,
  }));
  jobs.push(...alignmentJobs);

  // Membership work comes after the political organism has been staged so the
  // membership prompt can reuse canonical regime/system context, and finite
  // daily budgets preferentially retain high-value Political Actor work first.
  jobs.push(...membershipJobs);

  jobs.push(createPoliticalWorldV2Job({
    id: "agreements:global",
    type: "agreement-resolution",
    stage: "institutions",
    dependencies: catalogDependency,
    maxAttempts: 1,
  }));

  const nativePowerResolved = new Set(unique(nativeResolvedPowerPolities));
  const unresolvedPowerPolities = polityKeys.filter((polity) => !nativePowerResolved.has(polity));
  for (const [index, targets] of chunk(unresolvedPowerPolities, 24).entries()) {
    jobs.push(createPoliticalWorldV2Job({
      id: `power:${String(index + 1).padStart(3, "0")}`,
      type: "power-evidence",
      stage: "politics",
      targets,
      dependencies: unique(targets.map((polity) => actorJobByPolity.get(polity))),
      maxAttempts: 1,
    }));
  }

  const requestedVerification = unique(verificationTargets).filter((polity) => polityKeys.includes(polity));
  if (config.targetedVerification && requestedVerification.length) {
    for (const [index, targets] of chunk(requestedVerification, 12).entries()) {
      jobs.push(createPoliticalWorldV2Job({
        id: `sentinel:${String(index + 1).padStart(3, "0")}`,
        type: "temporal-sentinel",
        stage: "verification",
        targets,
        dependencies: unique(targets.map((polity) => actorJobByPolity.get(polity))),
        maxAttempts: 1,
      }));
    }
  }

  return {
    qualityMode: POLITICAL_WORLD_V2_QUALITY_MODES.includes(clean(qualityMode)) ? clean(qualityMode) : POLITICAL_WORLD_V2_DEFAULT_QUALITY_MODE,
    polityCount: polityKeys.length,
    jobs,
    counts: jobs.reduce((out, job) => {
      out[job.type] = (out[job.type] || 0) + 1;
      return out;
    }, {}),
  };
};
