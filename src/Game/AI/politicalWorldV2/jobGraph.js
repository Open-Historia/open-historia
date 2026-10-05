/*! Open Historia Continuum — Political World v2 job records
 *
 * The two helpers executor.js still uses. The runs themselves are scheduled by
 * simpleWorklist.js and driven by simpleRunner.js.
 */

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};
const array = (value) => Array.isArray(value) ? value : [];

const acceptedTargetsFromJob = (job) => array(job?.result?.acceptedPolities).map(clean).filter(Boolean);

export const acceptedPoliticalWorldV2Targets = (checkpoint, type) => {
  const wantedType = clean(type);
  const accepted = new Set(array(checkpoint?.coverage?.[wantedType]).map(clean).filter(Boolean));
  for (const job of Object.values(checkpoint?.jobs || {})) {
    if (clean(job?.type) !== wantedType || job?.status !== "completed") continue;
    for (const target of acceptedTargetsFromJob(job)) accepted.add(target);
  }
  return accepted;
};

export const createPoliticalWorldV2Job = ({
  id,
  type,
  stage = "",
  targets = [],
  dependencies = [],
  payload = {},
  maxAttempts = 2,
} = {}) => {
  const jobId = clean(id);
  const jobType = clean(type);
  if (!jobId || !jobType) throw new Error("Political World v2 jobs require id and type");
  return {
    id: jobId,
    type: jobType,
    stage: clean(stage || jobType),
    targets: array(targets).map(clean).filter(Boolean),
    dependencies: [...new Set(array(dependencies).map(clean).filter(Boolean))],
    payload: clone(payload || {}),
    status: "pending",
    attempts: 0,
    maxAttempts: Math.max(1, Math.trunc(Number(maxAttempts) || 2)),
    startedAt: "",
    completedAt: "",
    error: "",
    result: null,
  };
};
