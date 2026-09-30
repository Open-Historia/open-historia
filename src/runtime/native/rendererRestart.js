/*! Open Historia — the page's renderer, gone and started again © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// When Android stops the page's renderer to free memory, or it crashes,
// MainActivity builds the page again instead of letting the app close, and keeps
// a note of what happened (RendererRestartPlugin). The page puts that note in
// the diagnostics log on its way up: what the player saw was the game starting
// over, and a log they save afterwards has to say why.
import { logDebugEvent } from "../debugLog.js";
import { nativePlugin, nativeReady } from "./bridge.js";

// Android's renderer priorities (WebView.RENDERER_PRIORITY_*), as words.
const PRIORITY_NAMES = { 0: "waived", 1: "bound", 2: "important" };

export const describeRendererRestart = (info) => {
  if (!info || !Number(info.at)) return null;
  const why = info.crashed
    ? "The page's renderer crashed"
    : "Android stopped the page's renderer to free memory";
  const outcome = info.restarted === false
    ? "for the fourth time in a minute, and the app closed."
    : "and the app started the page again.";
  return {
    message: `${why} ${outcome}`,
    detail: {
      at: new Date(Number(info.at)).toISOString(),
      crashed: Boolean(info.crashed),
      rendererPriority: PRIORITY_NAMES[info.priority] ?? String(info.priority ?? ""),
      restartsInTheLastMinute: Number(info.recent) || 1,
      deviceMemoryGb: typeof navigator !== "undefined" ? navigator.deviceMemory ?? null : null,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    },
  };
};

// Asks the app for its note (once; the app forgets it on reading) and logs it.
export const reportRendererRestart = async ({ plugin, log = logDebugEvent } = {}) => {
  const source = plugin ?? (nativeReady() ? nativePlugin("OhRenderer") : null);
  if (!source || typeof source.lastRestart !== "function") return null;
  try {
    const entry = describeRendererRestart(await source.lastRestart());
    if (!entry) return null;
    log("app", entry.message, entry.detail, { problem: true });
    return entry;
  } catch {
    return null;
  }
};
