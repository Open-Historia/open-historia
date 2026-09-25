// Open Historia — should this device trade a little speed for memory?
//
// A phone's WebView gets a fraction of the memory a desktop tab does, and a few
// of the map's costs land all at once: the regions file parsed by two readers,
// a burst of tile workers, the globe's lighting redrawn on every frame of a
// drag. On a constrained device those are staggered or throttled (Nations.jsx,
// Map/mapLibreSetup.js, GlobeEffects.jsx); everywhere else they run flat out.
//
// Constrained is any of: the Android app; a touch-only screen (nothing can
// hover and the pointer is a finger: a phone or a tablet, in any browser); a
// browser that reports 4 GB of memory or less. navigator.deviceMemory is capped
// at 8 by the spec, so it can say "small" but never "big": a phone with 12 GB
// reports what a 64 GB desktop does, which is why it is not the only signal.
//
// localStorage "oh_device_profile" = "constrained" or "full" overrides the
// guess: for trying the phone path on a desktop, or giving a strong tablet the
// fast one. Decided once per page load, so every caller agrees.
import { isNativeBuild } from "./native/bridge.js";

export const DEVICE_PROFILE_OVERRIDE_KEY = "oh_device_profile";
const LOW_DEVICE_MEMORY_GB = 4;

export const classifyDevice = ({ native = false, touchOnly = false, deviceMemoryGb = null, override = "" } = {}) => {
  if (override === "constrained") return true;
  if (override === "full") return false;
  if (native || touchOnly) return true;
  const memory = Number(deviceMemoryGb);
  return deviceMemoryGb != null && Number.isFinite(memory) && memory > 0 && memory <= LOW_DEVICE_MEMORY_GB;
};

const readSignals = () => {
  let override = "";
  try {
    override = String(globalThis.localStorage?.getItem(DEVICE_PROFILE_OVERRIDE_KEY) ?? "");
  } catch {
    // Storage blocked: no override.
  }
  let touchOnly = false;
  try {
    touchOnly = Boolean(globalThis.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches);
  } catch {
    // No media queries (a worker, or a test): not a touch screen.
  }
  return {
    native: isNativeBuild(),
    touchOnly,
    deviceMemoryGb: globalThis.navigator?.deviceMemory ?? null,
    override,
  };
};

let constrained = null;

export const isConstrainedDevice = () => {
  if (constrained === null) constrained = classifyDevice(readSignals());
  return constrained;
};

// MapLibre's worker pool and how many tiles and images it fetches and decodes at
// once (Map/mapLibreSetup.js). Elsewhere: half the cores (2 to 6 workers) and
// twice as many requests (16 to 24). A phone gets 2 and 8: every worker is a
// JavaScript heap of its own with its own copy of the style, and that many
// decodes landing together on entering the map is what tipped weak phones over.
// Every tile still loads, fewer at a time.
const FALLBACK_THREADS = 4;

export const mapRuntimeLimits = ({ hardwareThreads, constrained = false } = {}) => {
  if (constrained) return { workerCount: 2, parallelImageRequests: 8 };
  const threads = Number(hardwareThreads) > 0 ? Number(hardwareThreads) : FALLBACK_THREADS;
  return {
    workerCount: Math.min(6, Math.max(2, Math.ceil(threads / 2))),
    parallelImageRequests: Math.min(24, Math.max(16, threads * 2)),
  };
};
