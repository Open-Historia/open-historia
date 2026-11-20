/*!
 * Open Historia Map Editor - scenario-authored starting bilateral relations.
 * world.relations remains the sole canonical owner. Edits are explicitly
 * scoped patches: a Map Editor save cannot wipe unrelated diplomacy records.
 */
import { nameKey } from "../../server/nameKey.js";
import { relationBandForScore } from "../runtime/diplomaticStance.js";

export const MAX_STARTING_RELATIONS = 256;
const clean = (value) => String(value ?? "").trim();
const reject = (reason) => ({ ok: false, reason });
const isRow = (value) => value && typeof value === "object" && !Array.isArray(value);
const folded = (value) => nameKey(value);
export const relationPairKey = (a, b) => [folded(a), folded(b)].sort().join("\u0000");

const scoreOf = (value) => {
  if (typeof value === "boolean" || value === null || value === undefined) return null;
  const text = clean(value);
  if (!/^-?(?:0|[1-9]\d{0,2})$/.test(text)) return null;
  const score = Number(text);
  return Number.isInteger(score) && score >= -100 && score <= 100 ? score : null;
};

const choicesAsRows = (choices) => (choices instanceof Set
  ? [...choices].map((key) => ({ key }))
  : Array.isArray(choices) ? choices : []);

export const knownPolityKeys = (choices = []) => new Set(
  choicesAsRows(choices).map((item) => clean(item?.key)).filter(Boolean),
);

// Resolve legacy relation endpoint spellings only from explicitly recorded
// polity identity metadata. A visible label/old alias can refer to the same
// stable key without silently inventing a new bilateral relationship.
const endpointOf = (value, choices) => {
  const raw = clean(value);
  const name = folded(raw);
  const rows = choicesAsRows(choices);
  const direct = rows.find((row) => clean(row?.key) === raw);
  if (direct) return { key: clean(direct.key), candidates: [clean(direct.key)] };
  const candidates = [...new Set(rows.filter((row) => [
    row?.key, row?.name, ...(Array.isArray(row?.aliases) ? row.aliases : []),
    ...(Array.isArray(row?.formerNames) ? row.formerNames : []),
  ].some((entry) => folded(entry) === name)).map((row) => clean(row.key)).filter(Boolean))];
  return { key: candidates.length === 1 ? candidates[0] : raw, candidates };
};

export const startingRelationRowsFor = (source, owner, choices) => {
  const rows = Array.isArray(source) ? source : [];
  return rows.flatMap((row) => {
    if (!isRow(row)) return [];
    const a = endpointOf(row.a, choices);
    const b = endpointOf(row.b, choices);
    if (a.candidates.length > 1 || b.candidates.length > 1) return [];
    if (a.key === owner && b.key !== owner) return [{ other: b.key, score: row.score }];
    if (b.key === owner && a.key !== owner) return [{ other: a.key, score: row.score }];
    return [];
  });
};

export const validateStartingRelationEdit = (edit, keys) => {
  if (!isRow(edit)) return reject("Choose two known polities for the relationship.");
  const a = clean(edit.a);
  const b = clean(edit.b);
  const known = keys instanceof Set ? keys : knownPolityKeys(keys);
  if (!a || !b || !known.has(a) || !known.has(b)) return reject("Choose registered polities, not aliases or unknown names.");
  if (folded(a) === folded(b)) return reject("A polity cannot have a diplomatic score with itself.");
  if (!Object.prototype.hasOwnProperty.call(edit, "score")) return reject("Enter an explicit score, or clear the existing score.");
  const score = edit.score === null ? null : scoreOf(edit.score);
  if (edit.score !== null && score === null) return reject("Diplomatic score must be a whole number from -100 to +100.");
  return { ok: true, edit: { a, b, score } };
};

export const mergeStartingRelationEdit = (previous, edit) => {
  const rows = Array.isArray(previous) ? previous : [];
  const pair = relationPairKey(edit.a, edit.b);
  return [...rows.filter((row) => relationPairKey(row.a, row.b) !== pair), edit];
};

export const applyStartingRelationEdits = (source, changes, choices) => {
  const base = Array.isArray(source) ? source : [];
  const edits = Array.isArray(changes) ? changes : [];
  const known = knownPolityKeys(choices);
  // Existing scenario rows are preserved verbatim until their specific pair is
  // explicitly edited. Historical records without a matching modern roster
  // must never be purged as a side effect of editing a different pair.
  let rows = base.slice();
  for (const candidate of edits) {
    const checked = validateStartingRelationEdit(candidate, known);
    if (!checked.ok) return checked;
    const { a, b, score } = checked.edit;
    const pair = relationPairKey(a, b);
    const matches = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (!isRow(row)) continue;
      const left = endpointOf(row.a, choices);
      const right = endpointOf(row.b, choices);
      // If an authored alias belongs to multiple identities and the other
      // endpoint is this pair, refuse an edit rather than accidentally create
      // two native rows that resolve to one pair on game initialization.
      if (left.candidates.length > 1 || right.candidates.length > 1) {
        const leftCould = left.candidates.length ? left.candidates : [left.key];
        const rightCould = right.candidates.length ? right.candidates : [right.key];
        if ((leftCould.includes(a) && rightCould.includes(b)) || (leftCould.includes(b) && rightCould.includes(a))) {
          return reject("This pair has an ambiguous historical identity. Resolve its scenario aliases before editing.");
        }
        continue;
      }
      if (relationPairKey(left.key, right.key) === pair) matches.push(index);
    }
    if (matches.length > 1) return reject("This relationship has duplicate canonical rows. Resolve the conflict before editing.");
    if (score === null) {
      if (matches.length) rows = rows.filter((_, index) => index !== matches[0]);
    } else if (matches.length) {
      rows = rows.map((row, index) => index === matches[0]
        ? { ...row, a, b, score, status: relationBandForScore(score) }
        : row);
    } else {
      rows = [...rows, { a, b, score, status: relationBandForScore(score), summary: "" }];
    }
    if (rows.length > MAX_STARTING_RELATIONS) {
      return reject(`A scenario can hold at most ${MAX_STARTING_RELATIONS} bilateral relationship rows. Remove an existing row before adding another.`);
    }
  }
  return { ok: true, relations: rows };
};

export const planStartingRelationDraft = (entries, newPolityKey, choices) => {
  if (!Array.isArray(entries)) return reject("Starting diplomatic relationships must be a list.");
  const known = knownPolityKeys(choices);
  known.add(clean(newPolityKey));
  const seen = new Set();
  const edits = [];
  for (const value of entries) {
    const checked = validateStartingRelationEdit({ a: newPolityKey, b: value?.other, score: value?.score }, known);
    if (!checked.ok) return checked;
    const pair = relationPairKey(checked.edit.a, checked.edit.b);
    if (seen.has(pair)) return reject("Each counterpart can have only one starting relationship score.");
    seen.add(pair);
    edits.push(checked.edit);
  }
  return { ok: true, edits };
};

export const rekeyStartingRelations = (rows, from, to) => (Array.isArray(rows) ? rows.map((row) => (
  !isRow(row) ? row : {
    ...row,
    a: folded(row.a) === folded(from) ? to : row.a,
    b: folded(row.b) === folded(from) ? to : row.b,
  }
)) : []);

export const withoutStartingRelations = (rows, removed, choices = []) => {
  const keys = new Set((Array.isArray(removed) ? removed : [removed]).map(folded));
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!isRow(row)) return true;
    // An explicit deletion also removes relationships that refer to the deleted
    // polity by one of its unambiguous authored aliases.
    const a = endpointOf(row.a, choices);
    const b = endpointOf(row.b, choices);
    return !keys.has(folded(a.key)) && !keys.has(folded(b.key));
  });
};

/**
 * Complete only the exact immutable edit objects included in a successful
 * scenario write. Counting pending edits would erase a newer edit if the author
 * changed the same pair while that write was in flight.
 */
export const settleStartingRelationEdits = (document, savedEdits) => {
  const saved = Array.isArray(savedEdits) ? savedEdits : [];
  if (!saved.length) return { ok: true, document };
  const choices = Object.entries(document?.polities || {}).map(([key, record]) => ({
    ...(isRow(record) ? record : {}), key,
  }));
  const applied = applyStartingRelationEdits(document?.relations, saved, choices);
  if (!applied.ok) return applied;
  const writtenObjects = new Set(saved);
  return {
    ok: true,
    document: {
      ...document,
      relations: applied.relations,
      relationEdits: (Array.isArray(document.relationEdits) ? document.relationEdits : [])
        .filter((entry) => !writtenObjects.has(entry)),
    },
  };
};
