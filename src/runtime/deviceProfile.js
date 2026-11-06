// Open Historia — should this device trade a little speed for memory?
//
// A phone's WebView gets a fraction of the memory a desktop tab does, and a few
// of the map's costs land all at once: the regions file parsed by two readers,
// a burst of tile workers, the globe's lighting redrawn on every frame of a
// drag. On a constrained device those are staggered or throttled (Nations.jsx,
// Map/mapLibreSetup.js, GlobeEffects.jsx), and 3D Terrain starts off until
// the player turns it on (App.jsx); everywhere else they run flat out.
//
// Constrained is any of: the Android app; a touch-only screen (nothing can
// hover and the pointer is a finger: a phone or a tablet, in any browser); a
// browser that reports 4 GB of memory or less. navigator.deviceMemory is capped
// at 8 by the spec, so it can say "small" but never "big": a phone with 12 GB
// reports what a 64 GB desktop does, which is why it is not the only signal.
//
// localStorage "oh_device_profile" = "constrained" or "full" overrides the
// guess: for trying the phone path on a desktop, or giving a strong tablet the
// fast one. Settings > Map > Performance mode writes it. Decided once per page
// load, so every caller agrees; a change applies after a reload.
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

// The signals the page loaded with, and what they decided.
let loaded = null;

export const isConstrainedDevice = () => {
  if (loaded === null) {
    const signals = readSignals();
    loaded = { signals, constrained: classifyDevice(signals) };
  }
  return loaded.constrained;
};

// The override as stored: "constrained", "full", or "" for the guess.
export const getDeviceProfileOverride = () => {
  const stored = readSignals().override;
  return stored === "constrained" || stored === "full" ? stored : "";
};

export const setDeviceProfileOverride = (value) => {
  try {
    if (value === "constrained" || value === "full") globalThis.localStorage?.setItem(DEVICE_PROFILE_OVERRIDE_KEY, value);
    else globalThis.localStorage?.removeItem(DEVICE_PROFILE_OVERRIDE_KEY);
  } catch {
    // Storage blocked: the guess stands.
  }
};

// Which signal decided, in classifyDevice's order, for the Logging file.
export const deviceProfileReason = ({ native = false, touchOnly = false, deviceMemoryGb = null, override = "" } = {}) => {
  if (override === "constrained" || override === "full") return "override";
  if (native) return "Android app";
  if (touchOnly) return "touch-only screen";
  const memory = Number(deviceMemoryGb);
  if (deviceMemoryGb != null && Number.isFinite(memory) && memory > 0) return `${memory} GB of memory reported`;
  return "memory not reported";
};

// "low memory (touch-only screen)": the profile this page is running with and
// why, plus what a reload would change it to when the override has changed.
export const describeDeviceProfile = ({ running, now = running } = {}) => {
  const name = (constrained) => (constrained ? "low memory" : "full");
  const current = classifyDevice(running);
  const next = classifyDevice(now);
  const text = `${name(current)} (${deviceProfileReason(running)})`;
  return next === current ? text : `${text}; ${name(next)} after a reload`;
};

export const deviceProfileForLog = () => {
  isConstrainedDevice();
  return describeDeviceProfile({ running: loaded.signals, now: readSignals() });
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

// The map's two large archives, regions (~101 MB) and countries (~60 MB), are
// downloaded whole in the background at startup, hashed against the signed
// content manifest and kept in memory, so every later tile is a memory read
// (runtime/preload.js). A browser on a phone does not do that: the downloads
// land, and are hashed (a second copy each), just as the loading screen hands
// over to the map, which is when the tile workers and the regions parse peak
// too. That was the moment iOS Safari killed the tab ("A problem repeatedly
// occurred"). There the map reads the archives over HTTP range requests, a
// tile at a time, as it does anyway until a warm finishes; the opening screen
// needs one 40 KB tile of each. The Android app still loads them whole: its
// APK assets cannot be range-read (wholeFileSource.js), and it ships the
// trimmed z8 archives.
export const warmsWholeMapArchives = ({ native = isNativeBuild(), constrained = isConstrainedDevice() } = {}) =>
  native || !constrained;
