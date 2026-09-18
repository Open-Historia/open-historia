/*! Open Historia Continuum — budget-aware Political World v2 job runner */

import { normalizePoliticalWorldV2Checkpoint } from "./checkpoint.js";
import {
  claimNextPoliticalWorldV2Job,
  completePoliticalWorldV2Job,
  failPoliticalWorldV2Job,
  summarizePoliticalWorldV2Jobs,
} from "./jobGraph.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const normalizedRunBudget = (checkpoint, maxModelCalls) => {
  const raw = maxModelCalls != null ? maxModelCalls : checkpoint.maxModelCalls;
  if (!Number.isFinite(Number(raw))) return null;
  return Math.max(0, Math.trunc(Number(raw)));
};

export const runPoliticalWorldV2Jobs = async ({
  checkpoint,
  executeJob,
  applyJobResult = null,
  maxModelCalls = null,
  signal = null,
  onCheckpoint = null,
} = {}) => {
  if (typeof executeJob !== "function") throw new Error("Political World v2 runner requires executeJob(job, checkpoint, context)");
  let current = normalizePoliticalWorldV2Checkpoint(checkpoint);
  if (!current) throw new Error("Invalid Political World v2 checkpoint");

  // A configured budget is PER RUN/RESUME SESSION, not lifetime checkpoint
  // usage. Cumulative modelCalls remain diagnostic/provenance while the user can
  // come back tomorrow and request another bounded slice without arithmetic.
  const runStartModelCalls = current.modelCalls;
  const runBudget = normalizedRunBudget(current, maxModelCalls);
  const runBudgetLimit = runBudget == null ? null : runStartModelCalls + runBudget;

  const hasBudget = () => runBudgetLimit == null || current.modelCalls < runBudgetLimit;
  const consumeModelCall = async () => {
    if (!hasBudget()) {
      const error = new Error("Political World v2 model-call budget reached for this run.");
      error.code = "POLITICAL_WORLD_V2_BUDGET";
      throw error;
    }
    current.modelCalls += 1;
    await onCheckpoint?.(clone(current));
  };

  while (true) {
    if (signal?.aborted) {
      current.status = "paused";
      current.pauseReason = "aborted";
      await onCheckpoint?.(clone(current));
      return current;
    }

    const summary = summarizePoliticalWorldV2Jobs(current);
    if (summary.failed > 0 && summary.runnable === 0 && summary.running === 0) {
      current.status = "blocked";
      current.pauseReason = "failed-jobs";
      await onCheckpoint?.(clone(current));
      return current;
    }
    if (summary.pending === 0 && summary.running === 0) {
      current.status = summary.failed > 0 ? "blocked" : "complete";
      current.pauseReason = summary.failed > 0 ? "failed-jobs" : "";
      await onCheckpoint?.(clone(current));
      return current;
    }
    if (summary.runnable === 0) {
      current.status = "blocked";
      current.pauseReason = "dependency-deadlock";
      await onCheckpoint?.(clone(current));
      return current;
    }
    if (!hasBudget()) {
      current.status = "paused";
      current.pauseReason = "model-call-budget";
      await onCheckpoint?.(clone(current));
      return current;
    }

    const claim = claimNextPoliticalWorldV2Job(current);
    current = claim.checkpoint;
    const job = claim.job;
    if (!job) continue;

    try {
      const result = await executeJob(job, clone(current), {
        consumeModelCall,
        remainingModelCalls: () => runBudgetLimit == null ? null : Math.max(0, runBudgetLimit - current.modelCalls),
      });

      // Stage/validate the domain result before marking the job completed or
      // recording canonical coverage. A result that cannot actually be applied
      // must remain a failed job, not a completed job with phantom coverage.
      let applied = null;
      if (typeof applyJobResult === "function") {
        applied = await applyJobResult({ checkpoint: clone(current), job, result: clone(result) });
      }
      current = completePoliticalWorldV2Job(current, job.id, result);
      if (applied) {
        if (applied?.stagedWorld !== undefined) current.stagedWorld = clone(applied.stagedWorld);
        if (Array.isArray(applied?.newJobs) && applied.newJobs.length) {
          const { addPoliticalWorldV2Jobs } = await import("./jobGraph.js");
          current = addPoliticalWorldV2Jobs(current, applied.newJobs);
        }
        if (applied?.quality && typeof applied.quality === "object") current.quality = clone(applied.quality);
      }
    } catch (error) {
      if (error?.code === "POLITICAL_WORLD_V2_BUDGET") {
        // No provider call was allowed to begin. Put the job back exactly where
        // it was so Resume starts with this same unit of work.
        const running = current.jobs?.[job.id];
        if (running) {
          running.status = "pending";
          running.attempts = Math.max(0, Number(running.attempts || 0) - 1);
          running.startedAt = "";
          running.error = "";
        }
        current.status = "paused";
        current.pauseReason = "model-call-budget";
        await onCheckpoint?.(clone(current));
        return current;
      }
      current = failPoliticalWorldV2Job(current, job.id, clean(error?.message || error), { retry: true });
    }

    await onCheckpoint?.(clone(current));
  }
};
