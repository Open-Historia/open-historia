/*! Open Historia Continuum — Political World v2 reusable quality-repair queue */

import { addPoliticalWorldV2Jobs, createPoliticalWorldV2Job } from "./jobGraph.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => Array.isArray(value) ? value : [];
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

export const QUALITY_REPAIR_JOB_TYPE = Object.freeze({
  "political-actor": "political-actor",
  membership: "membership-resolution",
  "governing-alignment": "governing-alignment",
  "power-evidence": "power-evidence",
  "historical-verification": "temporal-sentinel",
});

export const QUALITY_REPAIR_BATCH_SIZE = Object.freeze({
  "political-actor": 4,
  "membership-resolution": 8,
  "governing-alignment": 8,
  "power-evidence": 12,
  "temporal-sentinel": 8,
});

const familyMatches = (jobType, repairType) => repairType === "temporal-sentinel"
  ? ["temporal-sentinel", "historical-verification"].includes(clean(jobType))
  : clean(jobType) === clean(repairType);

const resetReusableJob = (job, { type, targets, cycle }) => {
  job.type = type;
  job.stage = type === "membership-resolution" ? "institutions" : type === "temporal-sentinel" ? "verification" : "politics";
  job.targets = [...targets];
  job.dependencies = [];
  job.payload = { ...(job.payload || {}), repairDepth: 1, resumeRepair: true, resumeCycle: cycle };
  job.status = "pending";
  job.attempts = 0;
  job.maxAttempts = 1;
  job.startedAt = "";
  job.completedAt = "";
  job.error = "";
  job.result = null;
};

/**
 * Reconcile canonical quality gaps into a bounded reusable repair queue.
 *
 * Important invariant: Resume does not append one job per gap and does not
 * create a fresh generation of repair IDs on every attempt. Existing repair
 * slots are recycled against only the still-unresolved targets. Completed
 * coverage lives separately in checkpoint.coverage, so recycling a slot never
 * forgets successful canon already staged by that slot.
 */
export const reconcilePoliticalWorldV2QualityRepairJobs = (checkpoint) => {
  const unresolved = array(checkpoint?.quality?.unresolved);
  if (!unresolved.length) return checkpoint;

  let next = clone(checkpoint);
  const cycle = Math.max(0, Math.trunc(Number(next.resumeCycle) || 0)) + 1;
  next.resumeCycle = cycle;
  const byType = new Map();

  const hasInstitutionCentricMembership = Object.values(next.jobs || {}).some((job) =>
    ["membership-surface", "institution-membership-resolution"].includes(clean(job?.type)));

  for (const item of unresolved) {
    const polityKey = clean(item?.polityKey);
    if (clean(item?.kind) === "membership" && hasInstitutionCentricMembership) continue;
    const type = QUALITY_REPAIR_JOB_TYPE[clean(item?.kind)];
    if (!polityKey || !type) continue;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(polityKey);
  }

  const newJobs = [];
  for (const [type, rawTargets] of byType.entries()) {
    const openTargets = new Set(Object.values(next.jobs || {})
      .filter((job) => ["pending", "running"].includes(job?.status) && familyMatches(job?.type, type))
      .flatMap((job) => array(job?.targets).map(clean).filter(Boolean)));
    const targets = [...new Set(rawTargets)].filter((target) => !openTargets.has(target));
    if (!targets.length) continue;

    const size = QUALITY_REPAIR_BATCH_SIZE[type] || 4;
    const batches = [];
    for (let index = 0; index < targets.length; index += size) batches.push(targets.slice(index, index + size));

    const reusable = Object.values(next.jobs || {})
      .filter((job) => job?.payload?.resumeRepair === true && familyMatches(job?.type, type) && !["pending", "running"].includes(job?.status))
      .sort((left, right) => clean(left?.id).localeCompare(clean(right?.id)));

    let slot = Object.values(next.jobs || {}).filter((job) => job?.payload?.resumeRepair === true && clean(job?.type) === type).length;
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      const existing = reusable[index];
      if (existing) {
        resetReusableJob(existing, { type, targets: batch, cycle });
        continue;
      }
      slot += 1;
      newJobs.push(createPoliticalWorldV2Job({
        id: `resume-repair:${type}:${String(slot).padStart(3, "0")}`,
        type,
        stage: type === "membership-resolution" ? "institutions" : type === "temporal-sentinel" ? "verification" : "politics",
        targets: batch,
        dependencies: [],
        payload: { repairDepth: 1, resumeRepair: true, resumeCycle: cycle },
        maxAttempts: 1,
      }));
    }
  }

  return newJobs.length ? addPoliticalWorldV2Jobs(next, newJobs) : next;
};
