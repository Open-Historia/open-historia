/*! Open Historia — the Android app rests in the background © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Capacitor keeps the WebView running when its app goes to the background (its
// KeepRunning default), so everything the page does on a timer went on with the
// app closed: the polls, the retries, the checks, and whatever they set off.
// A player's phone listed the app at 2 Ah of background battery in a day.
//
// So once the page is hidden and nothing is being generated, it tells
// MainActivity, which pauses the WebView's timers until the app comes back
// (BackgroundPausePlugin, MainActivity.onStart). A turn or a reply that is still
// being written is let finish first, and the pause follows it: the player comes
// back to a finished turn rather than one that stopped when they left.
import { nativePlugin, nativeReady } from "./bridge.js";

// How often a hidden page asks again while a turn is still being written.
export const BACKGROUND_POLL_MS = 2000;

// The logic, free of the bridge so it can be tested: `requestPause` is called
// once per hidden spell, as soon as `isGenerating()` is false.
export const installBackgroundPause = ({
  isGenerating = () => false,
  requestPause,
  doc = typeof document === "undefined" ? null : document,
  pollMs = BACKGROUND_POLL_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) => {
  if (!doc || typeof doc.addEventListener !== "function" || typeof requestPause !== "function") return () => {};
  let timer = null;
  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const check = () => {
    timer = null;
    if (doc.visibilityState !== "hidden") return;
    let generating = false;
    try { generating = Boolean(isGenerating()); } catch { generating = false; }
    if (generating) {
      timer = setTimer(check, pollMs);
      return;
    }
    try {
      Promise.resolve(requestPause()).catch(() => {});
    } catch {
      // No bridge after all: nothing to pause.
    }
  };
  const onVisibility = () => {
    cancel();
    if (doc.visibilityState === "hidden") timer = setTimer(check, 0);
  };
  doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    cancel();
    doc.removeEventListener("visibilitychange", onVisibility);
  };
};

// In the app only; a no-op on the website and the desktop.
export const installNativeBackgroundPause = (isGenerating) => {
  if (!nativeReady()) return () => {};
  return installBackgroundPause({
    isGenerating,
    requestPause: () => nativePlugin("OhBackground")?.idle?.(),
  });
};
