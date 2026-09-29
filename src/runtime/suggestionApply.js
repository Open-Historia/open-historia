/*! Open Historia — applying a suggestion's changes to a scenario's details © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The author's side of a suggestion, for everything outside the map editor
// (the map's changes are applied in the Workshop: src/Editor/suggestionReview.js).
// Each change carries the value the post had (`from`) and the suggested one
// (`to`); measured against the author's scenario as it is now, a change is
//   "open"      the author's value is still the post's: accepting applies it;
//   "conflict"  the author changed it since posting: accepting overwrites theirs;
//   "applied"   the author's scenario already has the suggested value.
// Accepted changes become one scenario save plus the asset uploads they need.
// Pure: the caller does the saving.

import { normalizePackGuidance, PROMPT_MODEL_VERSION } from "../Game/AI/promptGuidance.js";
import { normalizeFeatureSettings } from "../../server/gameFeatures.js";
import { buildScenarioSnapshot, isDetailFieldPath, politicsEntries, POLITICS_FIELDS, POLITICS_LEDGER_KEYS, sameValue } from "./scenarioChanges.js";
import { CANON_MODEL_VERSION } from "./scenarioCanon.js";

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// The value a details change is about, in a snapshot (buildScenarioSnapshot).
export const detailValueIn = (snapshot, change) => {
  if (!snapshot) return undefined;
  switch (change.kind) {
    case "field": {
      const [area, ...rest] = change.path;
      if (area === "meta") return snapshot.meta?.[rest[0]];
      if (area === "game") return snapshot.game?.[rest[0]];
      if (area === "world") return snapshot.world?.[rest[0]];
      if (area === "features") return snapshot.features?.[rest[0]]?.[rest[1]];
      if (area === "prompts") return snapshot.prompts?.[rest.join(".")] ?? "";
      return undefined;
    }
    case "politics": {
      const value = snapshot.politics?.[change.field];
      if (change.container === "value" || !change.entry) return value ?? null;
      return politicsEntries(value, change.container, ledgerKeyOfChange(change)).get(change.entry) ?? null;
    }
    case "stats":
      return snapshot.stats ?? null;
    case "institutionLogos":
      return snapshot.institutionLogos ?? null;
    case "cover":
      return snapshot.cover?.hash ?? null;
    default:
      return undefined;
  }
};

const suggestedValueOf = (change) => (change.kind === "cover" ? change.to?.hash ?? null : change.to);
const postedValueOf = (change) => (change.kind === "cover" ? change.from?.hash ?? null : change.from);

export const detailChangeStatus = (change, snapshot) => {
  const current = detailValueIn(snapshot, change);
  if (sameValue(current, suggestedValueOf(change))) return "applied";
  if (sameValue(current, postedValueOf(change))) return "open";
  return "conflict";
};

// Every details change's status against the author's scenario (its export).
export const detailStatuses = (changes, currentBundle) => {
  const snapshot = currentBundle?.map?.regions instanceof Map ? currentBundle : buildScenarioSnapshot(currentBundle);
  return Object.fromEntries((Array.isArray(changes) ? changes : [])
    .filter((change) => change.area === "details")
    .map((change) => [change.id, detailChangeStatus(change, snapshot)]));
};

// The ledger map a Politics change is about (scenarioChanges.js), or "" for a
// plain list or map. Only the known keys: a file names it.
const ledgerKeyOfChange = (change) => (POLITICS_LEDGER_KEYS.includes(change?.within) ? change.within : "");

// One ledger entry into the author's ledger: their other entries stay, and so
// does their wrapper, a format counter taking the newer of the two.
const applyLedgerChange = (current, change, within) => {
  const ledger = isRecord(current) ? clone(current) : {};
  const shell = isRecord(change.shell) ? change.shell : {};
  for (const [key, value] of Object.entries(shell)) {
    if (key === within) continue;
    if (!Object.prototype.hasOwnProperty.call(ledger, key)) ledger[key] = clone(value);
    else if (typeof value === "number" && typeof ledger[key] === "number") ledger[key] = Math.max(value, ledger[key]);
  }
  const entries = isRecord(ledger[within]) ? ledger[within] : {};
  if (change.op === "remove") delete entries[change.entry];
  else entries[change.entry] = clone(change.to);
  ledger[within] = entries;
  return ledger;
};

const applyPoliticsChange = (current, change) => {
  if (change.container === "value" || !change.entry) return clone(change.to);
  const within = ledgerKeyOfChange(change);
  if (within) return applyLedgerChange(current, change, within);
  if (change.container === "list") {
    const list = Array.isArray(current) ? clone(current) : [];
    const entries = [...politicsEntries(list, "list").keys()];
    const index = entries.indexOf(change.entry);
    if (change.op === "remove") {
      if (index >= 0) list.splice(index, 1);
    } else if (index >= 0) {
      list[index] = clone(change.to);
    } else {
      list.push(clone(change.to));
    }
    return list;
  }
  const map = isRecord(current) ? clone(current) : {};
  if (change.op === "remove") delete map[change.entry];
  else map[change.entry] = clone(change.to);
  return map;
};

// The save that applies `accepted` (details changes) to the scenario described
// by `details` (loadScenarioDetails): { patch, uploads, clears }. `patch` goes
// to saveScenario; each upload is { key, json } or { key, base64, contentType };
// each clear is an asset key.
export const buildDetailSave = (accepted, details) => {
  const patch = {};
  const uploads = [];
  const clears = [];
  const data = details?.data ?? {};
  const scenario = details?.scenario ?? {};
  const worldPatch = {};
  const gamePatch = {};
  let features = null;
  let guidance = null;

  for (const change of Array.isArray(accepted) ? accepted : []) {
    if (change.area !== "details") continue;
    // Reading a file already drops these (normalizeSuggestion); checked again
    // here because each part becomes a key of the author's scenario.
    if (change.kind === "field" && !isDetailFieldPath(change.path)) continue;
    if (change.kind === "politics" && !POLITICS_FIELDS.includes(change.field)) continue;
    if (change.kind === "field") {
      const [area, key, setting] = change.path;
      if (area === "meta") patch[key] = change.to ?? "";
      else if (area === "game") {
        gamePatch[key] = change.to ?? "";
        // The drawer keeps the language in both, and the game date's start too.
        if (key === "language") worldPatch.language = change.to ?? "";
      } else if (area === "world") worldPatch[key] = clone(change.to);
      else if (area === "features") {
        features ??= normalizeFeatureSettings(scenario.features);
        features[key] = { ...(features[key] ?? {}), [setting]: change.to };
      } else if (area === "prompts") {
        guidance ??= normalizePackGuidance(data.prompts);
        const [, ...path] = change.path;
        const text = String(change.to ?? "").trim();
        if (path[0] === "tasks") {
          const [, task, segment] = path;
          const bucket = { ...(guidance.tasks?.[task] ?? {}) };
          if (text) bucket[segment] = text;
          else delete bucket[segment];
          guidance.tasks = { ...(guidance.tasks ?? {}), [task]: bucket };
          if (!Object.keys(bucket).length) delete guidance.tasks[task];
        } else {
          const [section, segment] = path;
          const bucket = { ...(guidance[section] ?? {}) };
          if (text) bucket[segment] = text;
          else delete bucket[segment];
          guidance[section] = bucket;
        }
      }
    } else if (change.kind === "politics") {
      const current = Object.prototype.hasOwnProperty.call(worldPatch, change.field) ? worldPatch[change.field] : data.world?.[change.field];
      worldPatch[change.field] = applyPoliticsChange(current, change);
      // A canon context is read only beside the canon version, as the Politics
      // tab writes it (materializeScenarioCanon): accepting one makes the
      // author's canon current, or its divergence and packs would be ignored.
      if (change.field === "canonContext" && isRecord(change.to)) worldPatch.canonModelVersion = CANON_MODEL_VERSION;
    } else if (change.kind === "stats" || change.kind === "institutionLogos") {
      if (change.to === null || change.to === undefined) clears.push(change.kind);
      else uploads.push({ key: change.kind, json: change.to });
    } else if (change.kind === "cover") {
      if (!change.to) clears.push("cover");
      else if (change.to.base64) uploads.push({ key: "cover", base64: change.to.base64, contentType: change.to.contentType || "image/jpeg" });
    }
  }
  if (Object.keys(worldPatch).length) patch.worldPatch = worldPatch;
  if (Object.keys(gamePatch).length) patch.gamePatch = gamePatch;
  if (features) patch.features = features;
  if (guidance) patch.prompts = { promptModel: PROMPT_MODEL_VERSION, guidance };
  return { patch, uploads, clears };
};
