const TRACE_LIMIT = 500;
const FREEZE_TRACE_COUNT = 80;
// A ring: once full, each entry overwrites the oldest one in place instead of
// shifting the whole array down.
const trace = new Array(TRACE_LIMIT);
let traceNext = 0;
let traceCount = 0;

// The map's frame sampler, per-pan console summary and per-event trace
// listeners (World.jsx) cost something on every frame, so they run only when
// the player or a developer asks for them, with the same switch as assets.js's
// performance console output:
//   window.__OH_PERF_VERBOSE__ = true
// The listeners are attached when a map mounts, so set it before opening a game.
export const isMapPerfVerbose = () =>
  typeof globalThis !== "undefined" && globalThis.__OH_PERF_VERBOSE__ === true;

// The recorded entries, oldest first.
export const getMapTrace = (last = TRACE_LIMIT) => {
  const count = Math.max(0, Math.min(traceCount, Math.floor(Number(last) || 0)));
  const out = new Array(count);
  const start = traceNext - count + TRACE_LIMIT;
  for (let index = 0; index < count; index += 1) {
    out[index] = trace[(start + index) % TRACE_LIMIT];
  }
  return out;
};

const nowMs = () => (
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now()
);

const round = (value, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
};

const sanitize = (detail) => {
  if (detail == null) return null;
  if (typeof detail !== "object") return detail;
  const out = {};
  for (const [key, value] of Object.entries(detail)) {
    if (
      value == null
      || typeof value === "string"
      || typeof value === "number"
      || typeof value === "boolean"
    ) {
      out[key] = value;
    } else if (Array.isArray(value) && value.length <= 20) {
      out[key] = value.map((entry) => (
        entry == null || ["string", "number", "boolean"].includes(typeof entry)
          ? entry
          : String(entry?.id ?? entry?.key ?? entry?.name ?? "[object]")
      ));
    }
  }
  return out;
};

// window.__OH_MAP_TRACE__ reads as the ordered entries, as it did when the
// trace was a plain array.
const expose = () => {
  if (typeof globalThis === "undefined") return;
  try {
    Object.defineProperty(globalThis, "__OH_MAP_TRACE__", {
      configurable: true,
      enumerable: false,
      get: () => getMapTrace(),
    });
  } catch {
    // A frozen or locked-down global keeps working without the console handle.
  }
};

export const recordMapTrace = (type, detail = null) => {
  const entry = {
    t: round(nowMs()),
    type: String(type || "unknown"),
    detail: sanitize(detail),
  };
  trace[traceNext] = entry;
  traceNext = (traceNext + 1) % TRACE_LIMIT;
  if (traceCount < TRACE_LIMIT) traceCount += 1;
  return entry;
};

export const recordMapWork = (label, elapsedMs, detail = null) => {
  const elapsed = Number(elapsedMs || 0);
  if (elapsed < 2) return;
  recordMapTrace("work", {
    label,
    ms: round(elapsed),
    ...(detail && typeof detail === "object" ? detail : {}),
  });
};

export const recordMapFreeze = ({ deltaMs, map = null, counters = null } = {}) => {
  const delta = Number(deltaMs || 0);
  const center = map?.getCenter?.();
  const freeze = {
    version: "R5.3",
    at: round(nowMs()),
    frameMs: round(delta),
    zoom: round(map?.getZoom?.() ?? 0, 3),
    center: center
      ? { lng: round(center.lng, 3), lat: round(center.lat, 3) }
      : null,
    moving: Boolean(map?.isMoving?.()),
    zooming: Boolean(map?.isZooming?.()),
    rotating: Boolean(map?.isRotating?.()),
    tilesLoaded: Boolean(map?.areTilesLoaded?.()),
    counters: counters && typeof counters === "object" ? { ...counters } : {},
    recent: getMapTrace(FREEZE_TRACE_COUNT),
  };
  if (typeof globalThis !== "undefined") {
    globalThis.__OH_LAST_MAP_FREEZE__ = freeze;
    const archive = Array.isArray(globalThis.__OH_MAP_FREEZES__)
      ? globalThis.__OH_MAP_FREEZES__
      : [];
    archive.push(freeze);
    if (archive.length > 20) archive.splice(0, archive.length - 20);
    globalThis.__OH_MAP_FREEZES__ = archive;
  }
  recordMapTrace("freeze", {
    frameMs: freeze.frameMs,
    zoom: freeze.zoom,
    tilesLoaded: freeze.tilesLoaded,
    sourceEvents: freeze.counters?.sourceEvents ?? 0,
    styleEvents: freeze.counters?.styleEvents ?? 0,
    dataEvents: freeze.counters?.dataEvents ?? 0,
  });
  return freeze;
};

export const clearMapTrace = () => {
  trace.fill(undefined);
  traceNext = 0;
  traceCount = 0;
  if (typeof globalThis !== "undefined") {
    globalThis.__OH_LAST_MAP_FREEZE__ = null;
    globalThis.__OH_MAP_FREEZES__ = [];
  }
};

expose();
