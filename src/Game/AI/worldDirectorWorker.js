import { buildWorldInitiativeContext } from "./nativeWorldDirector.js";

// Dedicated CPU lane for the deterministic Native World Director.
// No canonical writes happen here; the main thread receives the exact same
// {text, analysis} result through structured clone.
self.onmessage = (event) => {
  const id = Number(event?.data?.id);
  try {
    const result = buildWorldInitiativeContext(
      event?.data?.bundle || {},
      event?.data?.options || {},
    );
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({
      id,
      error: String(error?.message || error || "Native World Director worker failed."),
    });
  }
};
