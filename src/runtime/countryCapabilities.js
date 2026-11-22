/*! Open Historia - canonical GM/Country Editor corrections to live intelligence and military capabilities.
 * One validated native mutation path for these administrative edits; ordinary simulation
 * still owns subsequent military shifts, war weariness and supply consumption. */
import { applyCountryStatPatchToWorld } from "./gameState.js";
import { militaryLookup } from "./militaryStats.js";
import { militaryProfile } from "./militaryPower.js";
import { normalizeIntelligenceRating } from "./spycraft.js";
import { normalizeWarResources, resourcesOf } from "./warResources.js";
import { normalizeWarWeariness } from "./warWeariness.js";

const MILITARY_FIELDS = Object.freeze([
  { key: "quality", label: "Troop quality", minimum: 0, maximum: 100, step: 1 },
  { key: "technology", label: "Technology", minimum: 0, maximum: 100, step: 1 },
  { key: "spending", label: "Spending", minimum: 0, maximum: 100, step: 1 },
  { key: "manpowerShare", label: "Manpower share (%)", minimum: 0.1, maximum: 100, step: 0.1 },
  { key: "land", label: "Land capability", minimum: 0, maximum: 100, step: 1 },
  { key: "sea", label: "Naval capability", minimum: 0, maximum: 100, step: 1 },
  { key: "air", label: "Air capability", minimum: 0, maximum: 100, step: 1 },
]);

export const COUNTRY_CAPABILITY_FIELDS = Object.freeze([
  { key: "intelligence", label: "Intelligence Service", minimum: 0, maximum: 100, step: 1 },
  ...MILITARY_FIELDS,
  { key: "warWeariness", label: "War weariness", minimum: 0, maximum: 100, step: 0.1 },
  { key: "warResources", label: "War resources", minimum: 0, maximum: 100, step: 0.1 },
]);
const CAPABILITY_KEYS = new Set(["intelligence", "military", "warWeariness", "warResources"]);
const MILITARY_BY_KEY = new Map(MILITARY_FIELDS.map((field) => [field.key, field]));
const FIELD_BY_KEY = new Map(COUNTRY_CAPABILITY_FIELDS.map((field) => [field.key, field]));
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fold = (value) => String(value ?? "").trim().toLowerCase();

const validateNumber = (key, value, { minimum, maximum, step }) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return `${key} must be a finite number.`;
  if (value < minimum || value > maximum) return `${key} must be between ${minimum} and ${maximum}.`;
  const scale = Math.round(1 / step);
  if (Math.abs(value * scale - Math.round(value * scale)) > 1e-7) {
    return `${key} must be in steps of ${step}.`;
  }
  return "";
};

// Strict validation for explicit administrative edits. Never silently clamp, clear,
// or discard malformed values: normal turn and legacy asset normalizers are separate.
export const validateCountryCapabilityPatch = (patch) => {
  if (!record(patch) || Object.keys(patch).length === 0) return "A nonempty capability patch is required.";
  for (const key of Object.keys(patch)) {
    if (!CAPABILITY_KEYS.has(key)) return `Unsupported capability field "${key}".`;
  }
  for (const key of ["intelligence", "warWeariness", "warResources"]) {
    if (!has(patch, key)) continue;
    const error = validateNumber(key, patch[key], FIELD_BY_KEY.get(key));
    if (error) return error;
  }
  if (has(patch, "military")) {
    if (!record(patch.military) || !Object.keys(patch.military).length) return "military must contain at least one supported field.";
    for (const [key, value] of Object.entries(patch.military)) {
      const field = MILITARY_BY_KEY.get(key);
      if (!field) return `Unsupported military field "${key}".`;
      const error = validateNumber(`military.${key}`, value, field);
      if (error) return error;
    }
  }
  return "";
};

const textOf = (value) => value === null || value === undefined || value === "" ? "" : String(value);

// Read the actual current sources, rather than the scenario's customStats duplicate
// or a nominal Military Power total (which the native military profile derives).
export const countryCapabilityFormFromWorld = (world, country) => {
  const military = militaryLookup(world)(country) || {};
  const profile = militaryProfile(world, country);
  const rawIntelligence = world?.intelligence?.[country];
  const intelligence = normalizeIntelligenceRating(rawIntelligence);
  const result = { intelligence: intelligence === null ? "" : textOf(intelligence) };
  for (const field of MILITARY_FIELDS) result[field.key] = textOf(military[field.key]);
  result.warWeariness = textOf(profile.figures.weariness);
  result.warResources = textOf(resourcesOf(world?.warResources, country));
  return result;
};

// Only changed fields become patches, with a fresh-read concurrency check of
// precisely those fields. A blank input never means "zero" or a silent clear.
export const countryCapabilityPatchFromForm = ({ world, country, form, loaded } = {}) => {
  if (!record(form) || !record(loaded)) throw new Error("Reload the country before editing its capabilities.");
  const current = countryCapabilityFormFromWorld(world, country);
  const patch = {};
  const military = {};
  for (const field of COUNTRY_CAPABILITY_FIELDS) {
    const before = textOf(loaded[field.key]);
    const typed = textOf(form[field.key]);
    if (typed === before) continue;
    if (textOf(current[field.key]) !== before) {
      throw new Error(`${field.label} changed while this editor was open. Reload and try again.`);
    }
    if (!typed.trim()) throw new Error(`${field.label} cannot be cleared. Enter an explicit number.`);
    const value = Number(typed);
    const error = validateNumber(field.key, value, field);
    if (error) throw new Error(error);
    if (MILITARY_BY_KEY.has(field.key)) military[field.key] = value;
    else patch[field.key] = value;
  }
  if (Object.keys(military).length) patch.military = military;
  return Object.keys(patch).length ? patch : null;
};

// Apply through the existing canonical owners, staging all writes first. With no
// world.warWeariness entry, the engine falls back to authored starting weariness:
// an explicit zero must also override that inherited baseline to remain zero.
export const applyCountryCapabilityPatchToWorld = (world, country, patch) => {
  const error = validateCountryCapabilityPatch(patch);
  if (error) throw new Error(error);
  if (!record(world) || !String(country ?? "").trim()) throw new Error("An existing country is required.");
  const staged = { ...world, countryStats: { ...(world.countryStats || {}) } };
  if (has(patch, "military")) {
    applyCountryStatPatchToWorld(staged, country, { military: patch.military });
  }
  if (has(patch, "intelligence")) {
    staged.intelligence = { ...(world.intelligence || {}), [country]: patch.intelligence };
  }
  if (has(patch, "warWeariness")) {
    const without = (Array.isArray(world.warWeariness) ? world.warWeariness : [])
      .filter((row) => fold(row?.country) !== fold(country));
    staged.warWeariness = normalizeWarWeariness(
      patch.warWeariness > 0 ? [...without, { country, value: patch.warWeariness }] : without,
    );
    if (patch.warWeariness > 0
      && !staged.warWeariness.some((row) => fold(row.country) === fold(country) && row.value === patch.warWeariness)) {
      throw new Error("War weariness ledger is full; nothing was changed.");
    }
    if (patch.warWeariness === 0) {
      applyCountryStatPatchToWorld(staged, country, { military: { weariness: 0 } });
    }
  }
  if (has(patch, "warResources")) {
    const without = (Array.isArray(world.warResources) ? world.warResources : [])
      .filter((row) => fold(row?.country) !== fold(country));
    staged.warResources = normalizeWarResources(
      patch.warResources < 100 ? [...without, { country, value: patch.warResources }] : without,
    );
    if (patch.warResources < 100
      && !staged.warResources.some((row) => fold(row.country) === fold(country) && row.value === patch.warResources)) {
      throw new Error("War resources ledger is full; nothing was changed.");
    }
  }
  for (const key of ["countryStats", "intelligence", "warWeariness", "warResources"]) {
    if (has(staged, key) && (has(patch, key) || (key === "countryStats" && (has(patch, "military") || patch.warWeariness === 0)))) {
      world[key] = staged[key];
    }
  }
  return world;
};
