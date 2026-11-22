/*!
 * Beta map editor: one pure plan for identity edits (no side effects).
 *
 * OpenLayers owns region geometry, React document owns authoring metadata,
 * scenario world owns Political Actors. UI commits a validated plan with a
 * single composite map/document Undo command rather than independently
 * mutating each registry (which previously allowed half-created countries).
 */
import { renamePolityInDocument, samePolityName } from "../../server/polityRename.js";
import { rekeyStartingRelations, mergeStartingRelationEdit, withoutStartingRelations } from "./scenarioStartingRelations.js";
import { rekeyGovernmentEdits, removeGovernmentEdits } from "./scenarioGovernmentEdits.js";
import { withoutPolities } from "./scenarioPuppets.js";

const text = (value) => String(value ?? "").trim();
const own = (record, key) => Object.prototype.hasOwnProperty.call(record || {}, key);

export const planMapPolityRename = (document, fromName, toName, occupied = []) => {
  const from = text(fromName);
  const to = text(toName);
  if (!from || !to || from === to) throw new Error("Choose a different, nonempty country name.");
  if (!document || typeof document !== "object") throw new Error("The map document is not available.");
  const clash = (Array.isArray(occupied) ? occupied : []).find((key) => samePolityName(key, to) && !samePolityName(key, from));
  if (clash) throw new Error(`"${to}" is already used by another country ("${clash}").`);
  // This existing canonical helper verifies the registry's own identity
  // uniqueness and moves all keyed appearance/city/unit/puppet metadata.
  const next = renamePolityInDocument(document, from, to);
  const renames = Array.isArray(document.polityRenames) ? document.polityRenames : [];
  const last = renames[renames.length - 1];
  const cancelsLast = last && samePolityName(last.from, to) && samePolityName(last.to, from);
  return {
    ...next,
    relations: rekeyStartingRelations(document.relations, from, to),
    relationEdits: rekeyStartingRelations(document.relationEdits, from, to),
    actorGovernmentEdits: rekeyGovernmentEdits(document.actorGovernmentEdits, from, to),
    polityRenames: cancelsLast ? renames.slice(0, -1) : [...renames, { from, to }],
  };
};

export const planMapPolityCreation = (document, plan) => {
  const key = text(plan?.key);
  if (plan?.ok !== true || !key || !plan.record || !document) {
    throw new Error("The new country has not passed canonical validation.");
  }
  if (Object.keys(document.polities || {}).some((existing) => samePolityName(existing, key))) {
    throw new Error(`Country ${key} already exists.`);
  }
  const appearances = {
    colorOverrides: { ...(document.colorOverrides || {}) },
    flags: { ...(document.flags || {}) },
    tags: { ...(document.tags || {}) },
  };
  if (plan.color) appearances.colorOverrides[key] = plan.color;
  if (plan.flag) appearances.flags[key] = plan.flag;
  if (plan.tags?.length) appearances.tags[key] = plan.tags;
  const relationEdits = (plan.relationEdits || []).reduce(
    (rows, edit) => mergeStartingRelationEdit(rows, edit),
    document.relationEdits || [],
  );
  // Merge only puppet rows involving the newly created polity onto the current
  // document.puppets so Redo never clobbers unrelated puppet edits made later.
  let nextPuppets = document.puppets;
  if (Array.isArray(plan.puppets)) {
    const isLivePuppetRow = (row) => (text(row?.status) || "active") === "active";
    const targetRows = plan.puppets.filter(
      (row) => row && typeof row === "object" && (samePolityName(row.puppet, key) || samePolityName(row.overlord, key)),
    );
    const replacedPuppets = targetRows.filter(isLivePuppetRow).map((row) => text(row.puppet)).filter(Boolean);
    const basePuppets = (Array.isArray(document.puppets) ? document.puppets : [])
      .filter((row) => {
        if (!row || typeof row !== "object") return false;
        if (samePolityName(row.puppet, key) || samePolityName(row.overlord, key)) return false;
        if (isLivePuppetRow(row) && replacedPuppets.some((puppet) => samePolityName(row.puppet, puppet))) return false;
        return true;
      })
      .map((row) => ({ ...row }));
    nextPuppets = [...basePuppets, ...targetRows.map((row) => ({ ...row }))];
  }
  return {
    ...document,
    polities: { ...(document.polities || {}), [key]: { ...plan.record } },
    ...appearances,
    puppets: nextPuppets,
    relationEdits,
  };
};

export const revertMapPolityCreation = (document, key, original) => {
  if (!document || !original || !text(key)) throw new Error("Missing country creation Undo state.");
  const target = text(key);
  const polities = { ...(document.polities || {}) };
  delete polities[target];

  // Remove puppet rows referencing the created target polity, then restore only
  // prior rows from `original.puppets` that were displaced by target's creation
  // so unrelated puppet edits made after creation are preserved.
  const currentPuppets = Array.isArray(document.puppets) ? document.puppets : [];
  const targetRows = currentPuppets.filter((row) => row && (samePolityName(row.overlord, target) || samePolityName(row.puppet, target)));
  const displacedPuppets = targetRows.map((row) => text(row?.puppet)).filter(Boolean);
  const currentWithoutTarget = withoutPolities(currentPuppets, target);
  const isLivePuppetRow = (row) => (text(row?.status) || "active") === "active";
  const restoredPuppets = currentWithoutTarget.map((row) => ({ ...row }));
  if (Array.isArray(original.puppets)) {
    for (const row of original.puppets) {
      if (!row || typeof row !== "object") continue;
      const wasDisplaced = samePolityName(row.overlord, target)
        || samePolityName(row.puppet, target)
        || displacedPuppets.some((puppet) => samePolityName(row.puppet, puppet));
      if (!wasDisplaced) continue;
      const alreadyPresent = restoredPuppets.some((existing) => (
        (existing.id && row.id && existing.id === row.id)
        || (isLivePuppetRow(existing) && isLivePuppetRow(row) && samePolityName(existing.puppet, row.puppet))
      ));
      if (!alreadyPresent) restoredPuppets.push({ ...row });
    }
  }

  const result = {
    ...document,
    polities,
    puppets: restoredPuppets,
    relations: Array.isArray(document.relations) ? withoutStartingRelations(document.relations, target) : document.relations,
    relationEdits: withoutStartingRelations(document.relationEdits, target),
    actorGovernmentEdits: removeGovernmentEdits(document.actorGovernmentEdits, target),
  };
  for (const field of ["colorOverrides", "flags", "tags"]) {
    const values = { ...(document[field] || {}) };
    if (own(original[field], target)) values[target] = original[field][target];
    else delete values[target];
    result[field] = values;
  }
  return result;
};
