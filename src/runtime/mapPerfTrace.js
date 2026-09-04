const TRACE_LIMIT = 500;
const FREEZE_TRACE_COUNT = 80;
const trace = [];

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

const expose = () => {
  if (typeof globalThis === "undefined") return;
  globalThis.__OH_MAP_TRACE__ = trace;
};

export const recordMapTrace = (type, detail = null) => {
  const entry = {
    t: round(nowMs()),
    type: String(type || "unknown"),
    detail: sanitize(detail),
  };
  trace.push(entry);
  if (trace.length > TRACE_LIMIT) trace.splice(0, trace.length - TRACE_LIMIT);
  expose();
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
    recent: trace.slice(-FREEZE_TRACE_COUNT),
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
  trace.length = 0;
  expose();
  if (typeof globalThis !== "undefined") {
    globalThis.__OH_LAST_MAP_FREEZE__ = null;
    globalThis.__OH_MAP_FREEZES__ = [];
  }
};

expose();
