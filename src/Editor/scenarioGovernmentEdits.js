/*!
 * Map Editor starting-government authoring operations.
 * The scenario's world.politicalActors is sole canonical owner. The map stores
 * only explicit author edits, reapplied at Save/Apply in a validated transaction.
 */
import { normalizePoliticalActorRecord } from "../runtime/politicalActors.js";
import { samePolityName } from "../../server/polityRename.js";

const str = (value) => String(value ?? "").trim();
const ALLOWED = Object.freeze(["form", "ideology"]);

export const stageGovernmentEdit = (edits, polity, fields) => {
  const key = str(polity);
  if (!key) throw new Error("Choose a polity before editing its government.");
  if (!fields || typeof fields !== "object") throw new Error("Government change requires explicit fields.");

  const change = { polity: key };
  for (const field of ALLOWED) {
    if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
    if (fields[field] === null) {
      change[field] = null; // explicit clearing is different from leaving unset
    } else {
      const value = str(fields[field]);
      if (!value || value.length > 160) {
        throw new Error(`Government ${field} must contain 1–160 characters or an explicit clear.`);
      }
      change[field] = value;
    }
  }
  if (!ALLOWED.some((field) => Object.prototype.hasOwnProperty.call(change, field))) {
    throw new Error("No government changes supplied.");
  }

  const base = Array.isArray(edits) ? edits : [];
  const same = base.filter((row) => samePolityName(row?.polity, key));
  const merged = { ...same.reduce((acc, row) => ({ ...acc, ...row }), {}), ...change, polity: key };
  return [...base.filter((row) => !samePolityName(row?.polity, key)), merged];
};

export const rekeyGovernmentEdits = (rows, from, to) => (
  (Array.isArray(rows) ? rows : []).map((row) => (samePolityName(row?.polity, from) ? { ...row, polity: to } : row))
);

export const removeGovernmentEdits = (rows, keys) => {
  const toRemove = (Array.isArray(keys) ? keys : [keys]).map(str).filter(Boolean);
  return (Array.isArray(rows) ? rows : []).filter((row) => !toRemove.some((key) => samePolityName(row?.polity, key)));
};

const replayPolityRenames = (polity, renames) => {
  let key = str(polity);
  if (!key || !Array.isArray(renames) || !renames.length) return key;
  for (const rename of renames) {
    const from = str(rename?.from);
    const to = str(rename?.to);
    if (from && to && samePolityName(key, from)) key = to;
  }
  return key;
};

// Remove only government fields successfully written to the scenario. If an
// author changed a different field while the Save was in flight, that newer
// explicit intent must survive. Operations are not persistent Political World
// state, and leaving settled ones queued can overwrite later canonical edits.
export const settleGovernmentEditRows = (currentRows, savedRows, polityRenames = []) => {
  const current = Array.isArray(currentRows) ? currentRows : [];
  const saved = Array.isArray(savedRows) ? savedRows : [];
  if (!saved.length) return current;
  const rebasedSaved = Array.isArray(polityRenames) && polityRenames.length
    ? saved.map((item) => {
      if (!item || typeof item !== "object") return item;
      const polity = replayPolityRenames(item.polity, polityRenames);
      return polity === item.polity ? item : { ...item, polity };
    })
    : saved;
  return current.flatMap((row) => {
    const prior = rebasedSaved.find((item) => samePolityName(item?.polity, row?.polity));
    if (!prior) return [row];
    const remaining = { polity: row.polity };
    for (const field of ALLOWED) {
      if (!Object.prototype.hasOwnProperty.call(row, field)) continue;
      if (Object.prototype.hasOwnProperty.call(prior, field) && prior[field] === row[field]) continue;
      remaining[field] = row[field];
    }
    return ALLOWED.some((field) => Object.prototype.hasOwnProperty.call(remaining, field)) ? [remaining] : [];
  });
};

export const applyGovernmentEdits = (world, rows, { polityNames = null } = {}) => {
  const edits = Array.isArray(rows) ? rows : [];
  if (!edits.length) return world;
  if (!world || typeof world !== "object" || Array.isArray(world)) {
    throw new Error("Cannot edit government: scenario world is unavailable.");
  }

  const available = polityNames || Object.keys(world.polityOverrides || {});
  const byPolity = { ...(world.politicalActors?.byPolity || {}) };
  const seen = [];

  for (const raw of edits) {
    const key = str(raw?.polity);
    if (!key) throw new Error("Government edit is missing its polity ID.");
    const canonical = available.find((name) => samePolityName(name, key));
    if (!canonical) throw new Error(`Government edit references missing polity ${key}. Save cancelled.`);
    if (seen.some((name) => samePolityName(name, canonical))) {
      throw new Error(`Duplicate government transition for ${canonical}.`);
    }
    seen.push(canonical);

    for (const field of Object.keys(raw)) {
      if (field !== "polity" && !ALLOWED.includes(field)) {
        throw new Error(`Unsupported government transition field ${field}.`);
      }
    }

    const matches = Object.keys(byPolity).filter((name) => samePolityName(name, canonical));
    if (matches.length > 1) throw new Error(`Ambiguous Political Actor identity for ${canonical}.`);
    const actorKey = matches[0] || canonical;
    const old = byPolity[actorKey] || { polityKey: canonical };
    const government = { ...(old.government || {}) };

    for (const field of ALLOWED) {
      if (!Object.prototype.hasOwnProperty.call(raw, field)) continue;
      const value = raw[field];
      if (value === null) {
        delete government[field];
      } else {
        const normalized = str(value);
        if (!normalized || normalized.length > 160) {
          throw new Error(`Invalid government ${field} for ${canonical}.`);
        }
        government[field] = normalized;
      }
    }

    const updated = normalizePoliticalActorRecord({ ...old, polityKey: canonical, government }, canonical);
    if (!updated) throw new Error(`Cannot validate Political Actor for ${canonical}.`);
    delete byPolity[actorKey];
    byPolity[canonical] = updated;
  }

  return {
    ...world,
    politicalActors: {
      ...(world.politicalActors || {}),
      byPolity,
    },
  };
};
