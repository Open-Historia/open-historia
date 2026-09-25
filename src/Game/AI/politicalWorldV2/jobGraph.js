/*! Open Historia Continuum — Political World v2 resumable job graph */

import { normalizePoliticalWorldV2Checkpoint } from "./checkpoint.js";

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

const recordCoverage = (checkpoint, job) => {
  const type = clean(job?.type);
  if (!type) return;
  const accepted = acceptedTargetsFromJob(job);
  if (!accepted.length) return;
  checkpoint.coverage = checkpoint.coverage && typeof checkpoint.coverage === "object" ? checkpoint.coverage : {};
  const merged = new Set(array(checkpoint.coverage[type]).map(clean).filter(Boolean));
  for (const target of accepted) merged.add(target);
  checkpoint.coverage[type] = [...merged];
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

export const addPoliticalWorldV2Jobs = (checkpoint, jobs = [], now = new Date().toISOString()) => {
  const next = normalizePoliticalWorldV2Checkpoint(checkpoint);
  if (!next) throw new Error("Invalid Political World v2 checkpoint");
  for (const rawJob of array(jobs)) {
    const job = rawJob?.status ? clone(rawJob) : createPoliticalWorldV2Job(rawJob);
    if (next.jobs[job.id]) continue;
    next.jobs[job.id] = job;
    next.jobOrder.push(job.id);
  }
  next.updatedAt = now;
  return next;
};

const dependencyState = (checkpoint, job) => {
  const dependencies = array(job.dependencies);
  if (!dependencies.length) return "ready";
  for (const dependencyId of dependencies) {
    const dependency = checkpoint.jobs[dependencyId];
    if (!dependency) return "blocked-missing";
    if (["failed", "skipped"].includes(dependency.status)) return "blocked-failed";
    if (dependency.status !== "completed") return "waiting";
  }
  return "ready";
};

const jobPriority = (job) => {
  const id = clean(job?.id);
  const repairDepth = Math.max(0, Math.trunc(Number(job?.payload?.repairDepth) || 0));
  // Resolve a discovered gap before moving deeper into unrelated world work.
  // This prevents one omitted polity from causing downstream alignment /
  // verification calls that are guaranteed to need another repair later.
  if (repairDepth > 0 || id.startsWith("repair:") || id.startsWith("verify:") || id.startsWith("realign:")) return 0;
  return 1;
};

export const runnablePoliticalWorldV2JobIds = (checkpoint) => {
  const current = normalizePoliticalWorldV2Checkpoint(checkpoint);
  if (!current) return [];
  return current.jobOrder
    .map((id, index) => ({ id, index, job: current.jobs[id] }))
    .filter(({ job }) => job?.status === "pending" && dependencyState(current, job) === "ready")
    .sort((left, right) => jobPriority(left.job) - jobPriority(right.job) || left.index - right.index)
    .map(({ id }) => id);
};

export const claimNextPoliticalWorldV2Job = (checkpoint, now = new Date().toISOString()) => {
  const next = normalizePoliticalWorldV2Checkpoint(checkpoint);
  if (!next) throw new Error("Invalid Political World v2 checkpoint");
  const id = runnablePoliticalWorldV2JobIds(next)[0];
  if (!id) return { checkpoint: next, job: null };
  const job = next.jobs[id];
  job.status = "running";
  job.attempts += 1;
  job.startedAt = now;
  job.error = "";
  next.status = "running";
  next.pauseReason = "";
  next.updatedAt = now;
  return { checkpoint: next, job: clone(job) };
};

export const completePoliticalWorldV2Job = (checkpoint, jobId, result, now = new Date().toISOString()) => {
  const next = normalizePoliticalWorldV2Checkpoint(checkpoint);
  const job = next?.jobs?.[clean(jobId)];
  if (!next || !job) throw new Error(`Unknown Political World v2 job ${clean(jobId)}`);
  job.status = "completed";
  job.completedAt = now;
  job.result = clone(result);
  job.error = "";
  recordCoverage(next, job);
  next.updatedAt = now;
  return next;
};

export const failPoliticalWorldV2Job = (checkpoint, jobId, error, { retry = true, now = new Date().toISOString() } = {}) => {
  const next = normalizePoliticalWorldV2Checkpoint(checkpoint);
  const job = next?.jobs?.[clean(jobId)];
  if (!next || !job) throw new Error(`Unknown Political World v2 job ${clean(jobId)}`);
  job.error = clean(error?.message || error || "Unknown job failure");
  const canRetry = retry && job.attempts < job.maxAttempts;
  job.status = canRetry ? "pending" : "failed";
  if (!canRetry) {
    job.completedAt = now;
    job.payload = job.payload && typeof job.payload === "object" ? job.payload : {};
    job.payload.resumeFailureCount = Math.max(0, Math.trunc(Number(job.payload.resumeFailureCount) || 0)) + 1;
  }
  next.updatedAt = now;
  return next;
};

export const resetInterruptedPoliticalWorldV2Jobs = (checkpoint, now = new Date().toISOString()) => {
  const next = normalizePoliticalWorldV2Checkpoint(checkpoint);
  if (!next) throw new Error("Invalid Political World v2 checkpoint");
  for (const job of Object.values(next.jobs)) {
    if (job.status !== "running") continue;
    // A browser/app interruption is not a domain retry. The previous provider
    // call may already count against quota, but there is no accepted result to
    // preserve, so Resume must be allowed to replay this exact bounded unit
    // even when maxAttempts is 1.
    job.status = "pending";
    job.attempts = Math.max(0, Number(job.attempts || 0) - 1);
    job.startedAt = "";
    job.completedAt = "";
    job.error = "";
  }
  next.status = "ready";
  next.pauseReason = "";
  next.updatedAt = now;
  return next;
};


export const reopenFailedPoliticalWorldV2Jobs = (checkpoint, now = new Date().toISOString()) => {
  const next = normalizePoliticalWorldV2Checkpoint(checkpoint);
  if (!next) throw new Error("Invalid Political World v2 checkpoint");
  for (const job of Object.values(next.jobs)) {
    if (job.status !== "failed") continue;
    // Explicit Resume may retry a bounded failure, but never forever. Reopening
    // the same deterministic failure on every Resume was a quota leak: calls
    // could be consumed indefinitely without any new canonical state. Two
    // failed cycles are enough to distinguish a transient provider miss from a
    // job that needs a changed strategy/code path.
    const failureCount = Math.max(0, Math.trunc(Number(job?.payload?.resumeFailureCount) || 0));
    if (failureCount >= 2) continue;
    job.status = "pending";
    job.attempts = 0;
    job.startedAt = "";
    job.completedAt = "";
    job.error = "";
  }
  next.status = "ready";
  next.pauseReason = "";
  next.updatedAt = now;
  return next;
};

export const summarizePoliticalWorldV2Jobs = (checkpoint) => {
  const current = normalizePoliticalWorldV2Checkpoint(checkpoint);
  if (!current) return null;
  const counts = { pending: 0, running: 0, completed: 0, failed: 0, paused: 0, skipped: 0 };
  for (const job of Object.values(current.jobs)) {
    if (Object.prototype.hasOwnProperty.call(counts, job.status)) counts[job.status] += 1;
  }
  return {
    total: Object.keys(current.jobs).length,
    ...counts,
    runnable: runnablePoliticalWorldV2JobIds(current).length,
  };
};
