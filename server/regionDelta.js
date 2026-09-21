/*! Open Historia — a map-editor save that carries only what changed © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The editor used to send its whole world on every autosave — every two seconds,
// whether or not a polygon had moved. On the shipped world that is 5.5 MB of JSON
// each time; on the z9 seed it was an ~83 MB string, and that churn is what ran
// the tab out of memory (src/Editor/OlMap.jsx, serializeRegions). The client now
// writes each region on its own, compares it against what the last save wrote,
// and sends the difference. This is the other half: putting that difference back
// onto the stored map.
//
// Shared by the desktop store (server/mapEditorStore.js) and the website's
// IndexedDB one (src/runtime/web/editorStore.js) so the two cannot drift.
//
// A delta is only ever applied when the result agrees with the client about how
// many regions there are. That check is what makes this safe: a delta built
// against a different copy of the map is refused whole, the stored geometry is
// left alone, and the caller asks the editor for a full save instead. A map lost
// to a silently half-applied delta is not recoverable; one extra full save is.

const key = (feature) => {
  const id = feature?.id ?? feature?.properties?.id;
  return id === undefined || id === null || id === "" ? null : String(id);
};

export const regionDeltaKey = key;

// A payload the client meant as a delta, as opposed to a full FeatureCollection
// or nothing at all.
export const isRegionDelta = (value) =>
  Boolean(value) && typeof value === "object"
  && (Array.isArray(value.changed) || Array.isArray(value.removed));

// `stored` is the FeatureCollection on record. Returns the new collection, or
// why it could not be trusted. Order is preserved: a changed region stays where
// it was, a new one goes on the end.
export const applyRegionDelta = (stored, delta) => {
  if (!isRegionDelta(delta)) return { applied: false, reason: "not a delta" };

  const features = Array.isArray(stored?.features) ? [...stored.features] : null;
  if (!features) return { applied: false, reason: "no geometry stored" };

  const at = new Map();
  for (const [index, feature] of features.entries()) {
    const id = key(feature);
    if (id !== null) at.set(id, index);
  }

  const removed = new Set();
  for (const id of Array.isArray(delta.removed) ? delta.removed : []) {
    const found = at.get(String(id));
    if (found !== undefined) removed.add(found);
  }

  for (const feature of Array.isArray(delta.changed) ? delta.changed : []) {
    const id = key(feature);
    if (id === null) return { applied: false, reason: "a region in the delta has no id" };
    const found = at.get(id);
    if (found === undefined) {
      at.set(id, features.length);
      features.push(feature);
    } else {
      features[found] = feature;
      removed.delete(found);
    }
  }

  const next = removed.size ? features.filter((_, index) => !removed.has(index)) : features;

  // The client says how many regions it holds. Anything else means the two are
  // not looking at the same map.
  if (Number.isFinite(Number(delta.count)) && next.length !== Number(delta.count)) {
    return { applied: false, reason: `delta expected ${Number(delta.count)} regions, merge made ${next.length}` };
  }

  return {
    applied: true,
    regions: { ...(stored && typeof stored === "object" ? stored : {}), type: "FeatureCollection", features: next },
  };
};
