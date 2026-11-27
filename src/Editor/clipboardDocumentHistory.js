/*!
 * Canonical document half of an OpenLayers clipboard-paste history command.
 * The native map owns geometry, selection, and the command stack. This module
 * owns only document additions from planClipboardMerge, never scenario export.
 */
import { normalizeTagList } from "../runtime/countryTags.js";

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameKey = (a, b) => String(a).toLocaleLowerCase() === String(b).toLocaleLowerCase();
const own = (record, key) => Object.prototype.hasOwnProperty.call(record, key);

const plannedFields = (plan = {}) => ({
  polities: Object.fromEntries(Object.entries(plan.upserts || {}).map(([key, record]) =>
    [key, { ...record, name: String(record.name ?? key).trim() || key,
      aliases: Array.isArray(record.aliases)
        ? [...new Set(record.aliases.map((v) => String(v || "").trim()).filter(Boolean))]
        : [] }])),
  colorOverrides: plan.colorOverrides || {},
  flags: plan.flags || {},
  tags: Object.fromEntries(Object.entries(plan.tags || {})
    .map(([key, list]) => [key, normalizeTagList(list)])
    .filter(([, list]) => list.length)),
  groups: plan.groups || {},
});

export const applyClipboardMetadata = (document, plan) => {
  if (!document || !plan) return document;
  const updates = {};
  for (const [field, additions] of Object.entries(plannedFields(plan))) {
    const current = document[field] || {};
    const missing = Object.fromEntries(Object.entries(additions).filter(([key]) =>
      field === "groups"
        ? !Object.keys(current).some((existing) => sameKey(existing, key))
        : !own(current, key)));
    if (Object.keys(missing).length) updates[field] = { ...current, ...missing };
  }
  const currentTypes = Array.isArray(document.types) ? document.types : [];
  const usedIds = new Set(currentTypes.map(({ id }) => String(id)));
  const missingTypes = [];
  for (const row of Array.isArray(plan.types) ? plan.types : []) {
    if (!row || row.id == null || usedIds.has(String(row.id))) continue;
    usedIds.add(String(row.id));
    missingTypes.push(row);
  }
  if (missingTypes.length) updates.types = [...currentTypes, ...missingTypes];
  return Object.keys(updates).length ? { ...document, ...updates } : document;
};

export const undoClipboardMetadata = (document, plan, original = null) => {
  if (!document || !plan) return document;
  const updates = {};
  for (const [field, additions] of Object.entries(plannedFields(plan))) {
    const current = document[field] || {};
    const removed = Object.keys(additions).filter((key) =>
      !(original && own(original[field] || {}, key)) &&
      own(current, key) && equal(current[key], additions[key]));
    if (removed.length) {
      const keys = new Set(removed);
      updates[field] = Object.fromEntries(Object.entries(current).filter(([key]) => !keys.has(key)));
    }
  }
  const types = Array.isArray(document.types) ? document.types : [];
  const candidates = new Map((Array.isArray(plan.types) ? plan.types : [])
    .filter((row) => row?.id != null).map((row) => [String(row.id), row]));
  if (candidates.size) {
    const kept = types.filter((row) =>
      !candidates.has(String(row?.id)) ||
      (original && (original.types || []).some((old) => String(old.id) === String(row?.id))) ||
      !equal(row, candidates.get(String(row?.id))));
    if (kept.length !== types.length) updates.types = kept;
  }
  return Object.keys(updates).length ? { ...document, ...updates } : document;
};

/** A single reversible document step to be nested in OlMap.pasteRegions. */
export const clipboardMetadataStep = (plan, originalDocument, setDocument, setDirty) => {
  if (!originalDocument || typeof setDocument !== "function" || typeof setDirty !== "function") {
    throw new TypeError("Clipboard document history requires a document setter and dirty-state owner");
  }
  const mutate = (transform) => () => {
    setDocument((document) => transform(document, plan));
    setDirty("dirty");
  };
  return {
    undo: () => { setDocument((document) => undoClipboardMetadata(document, plan, originalDocument)); setDirty("dirty"); },
    redo: mutate(applyClipboardMetadata),
  };
};
