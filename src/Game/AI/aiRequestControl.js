/*! Open Historia — live AI request cancellation owner. */

export const AI_REQUEST_CONTROL_EVENT = "ai:request-control";

let generationController = new AbortController();
let activeScopes = 0;

const abortError = () => {
  if (typeof DOMException !== "undefined") return new DOMException("Cancelled by player.", "AbortError");
  return Object.assign(new Error("Cancelled by player."), { name: "AbortError" });
};

const announce = (detail = {}) => {
  try {
    window.dispatchEvent(new CustomEvent(AI_REQUEST_CONTROL_EVENT, {
      detail: { active: activeScopes, ...detail },
    }));
  } catch {
    // Tests/headless runtime: the synchronous getters remain authoritative.
  }
};

const joinSignals = (externalSignal, globalSignal) => {
  if (!externalSignal) return { signal: globalSignal, release: () => {} };
  if (externalSignal.aborted) return { signal: externalSignal, release: () => {} };
  if (globalSignal.aborted) return { signal: globalSignal, release: () => {} };

  const controller = new AbortController();
  const forward = (source) => {
    if (!controller.signal.aborted) controller.abort(source.reason ?? abortError());
  };
  const onExternal = () => forward(externalSignal);
  const onGlobal = () => forward(globalSignal);
  externalSignal.addEventListener("abort", onExternal, { once: true });
  globalSignal.addEventListener("abort", onGlobal, { once: true });

  return {
    signal: controller.signal,
    release: () => {
      externalSignal.removeEventListener("abort", onExternal);
      globalSignal.removeEventListener("abort", onGlobal);
    },
  };
};

export const getActiveAiRequestCount = () => activeScopes;

// One scope per callAI invocation. The global signal is composed with any local
// Cancel signal a caller already supplied, so existing turn/advisor cancellation
// keeps working and the emergency stop can abort the same transport/retry chain.
export const beginAiRequestScope = (externalSignal = null) => {
  const generationSignal = generationController.signal;
  const joined = joinSignals(externalSignal, generationSignal);
  let finished = false;
  activeScopes += 1;
  announce();

  return {
    signal: joined.signal,
    finish: () => {
      if (finished) return;
      finished = true;
      joined.release();
      activeScopes = Math.max(0, activeScopes - 1);
      announce();
    },
  };
};

// Replace the generation controller BEFORE aborting the old one. Anything that
// starts synchronously while cancellation unwinds belongs to the next generation
// and must not inherit an already-aborted signal.
export const cancelAllAiRequests = () => {
  const cancelled = activeScopes;
  const previous = generationController;
  generationController = new AbortController();
  if (!previous.signal.aborted) previous.abort(abortError());
  announce({ cancelled });
  return cancelled;
};
