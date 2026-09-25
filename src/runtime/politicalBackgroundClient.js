/*! Open Historia — non-blocking political background worker client (Continuum) */

let politicalWorker = null;
let politicalWorkerBroken = false;
let politicalRequestId = 0;
const politicalPending = new Map();

const stopWorker = ({ broken = false, reason = null } = {}) => {
  if (broken) politicalWorkerBroken = true;
  politicalWorker?.terminate?.();
  politicalWorker = null;
  for (const pending of politicalPending.values()) {
    pending.reject(reason instanceof Error ? reason : new Error("Political background worker stopped."));
  }
  politicalPending.clear();
};

const getPoliticalWorker = () => {
  if (politicalWorkerBroken || typeof Worker === "undefined") return null;
  if (politicalWorker) return politicalWorker;

  try {
    const worker = new Worker(
      new URL("./politicalBackgroundWorker.js", import.meta.url),
      { type: "module", name: "openhistoria-political-background" },
    );

    worker.onmessage = (event) => {
      const id = Number(event?.data?.id);
      const pending = politicalPending.get(id);
      if (!pending) return;
      politicalPending.delete(id);
      if (event?.data?.error) pending.reject(new Error(event.data.error));
      else pending.resolve(event?.data?.result);
    };

    worker.onerror = (event) => {
      stopWorker({
        broken: true,
        reason: new Error(event?.message || "Political background worker failed."),
      });
    };

    politicalWorker = worker;
    return worker;
  } catch {
    politicalWorkerBroken = true;
    return null;
  }
};

// Deliberately NO main-thread compute fallback. A failed Worker preserves the
// last valid political state/clock so a later healthy turn may catch up instead
// of freezing the UI to maintain simulation fidelity.
export const advancePoliticalBackgroundBatchInWorker = async (payload, { signal } = {}) => {
  const worker = getPoliticalWorker();
  if (!worker) return { skipped: true, reason: "worker-unavailable" };

  const id = ++politicalRequestId;
  return await new Promise((resolve, reject) => {
    const abort = () => {
      politicalPending.delete(id);
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException("Political background update cancelled.", "AbortError"));
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    politicalPending.set(id, {
      resolve: (value) => {
        signal?.removeEventListener?.("abort", abort);
        resolve(value);
      },
      reject: (error) => {
        signal?.removeEventListener?.("abort", abort);
        reject(error);
      },
    });
    signal?.addEventListener?.("abort", abort, { once: true });
    worker.postMessage({ id, payload });
  });
};

export const resetPoliticalBackgroundWorkerForTests = () => stopWorker();
