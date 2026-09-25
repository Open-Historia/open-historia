// Open Historia — Android says memory is short.
//
// MainActivity.onTrimMemory dispatches this event on the page when the system
// asks the app to give memory back: the app is going to the background, or
// memory is running low while it is in front. A cache kept only for speed
// listens here and lets go; nothing that holds the game's state may, because
// the page carries on exactly where it was. The browser builds never fire it.
export const MEMORY_PRESSURE_EVENT = "oh:memory-pressure";

export const onMemoryPressure = (release) => {
  if (typeof window === "undefined" || typeof release !== "function") return () => {};
  const listener = () => {
    try {
      release();
    } catch {
      // Letting a cache go is best-effort.
    }
  };
  window.addEventListener(MEMORY_PRESSURE_EVENT, listener);
  return () => window.removeEventListener(MEMORY_PRESSURE_EVENT, listener);
};
