/*!
 * Open Historia Map Editor - scenario-authored starting bilateral relations.
 * world.relations remains the sole canonical owner. Edits are explicitly
 * scoped patches: a Map Editor save cannot wipe unrelated diplomacy records.
 */
import { nameKey } from "../../server/nameKey.js";
import { relationBandForScore } from "../runtime/diplomaticStance.js";
import { hasMalformedRelationSummary } from "../runtime/relationSummary.js";

export const MAX_STARTING_RELATIONS = 256;
// The ordinary diplomatic AI context already includes up to 240 characters.
export const MAX_STARTING_RELATION_SUMMARY = 240;
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
  const checked = { a, b, score };
  if (score !== null && Object.hasOwn(edit, "summary")) {
    if (typeof edit.summary !== "string" || hasMalformedRelationSummary(edit.summary)) return reject("Enter a plain-text diplomatic description without a tilde (~).");
    const summary = edit.summary.trim().replace(/\s+/g, " ");
    if (summary.length > MAX_STARTING_RELATION_SUMMARY) return reject("Diplomatic description must be at most 240 characters.");
    checked.summary = summary;
  }
  return { ok: true, edit: checked };
};

let nextRelationEditSeq = 1;
const attachEditId = (row, existingId = "") => {
  if (!isRow(row)) return row;
  const id = existingId || (typeof row._editId === "string" && row._editId) || `rel-edit-${nextRelationEditSeq++}`;
  const out = { ...row };
  Object.defineProperty(out, "_editId", { value: id, enumerable: false, configurable: true });
  return out;
};

export const mergeStartingRelationEdit = (previous, edit) => {
  const rows = Array.isArray(previous) ? previous : [];
  const pair = relationPairKey(edit.a, edit.b);
  return [...rows.filter((row) => relationPairKey(row.a, row.b) !== pair), attachEditId(edit)];
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
        ? { ...row, a, b, score, status: relationBandForScore(score), ...(Object.hasOwn(checked.edit, "summary") ? { summary: checked.edit.summary } : {}) }
        : row);
    } else {
      rows = [...rows, { a, b, score, status: relationBandForScore(score), summary: checked.edit.summary ?? "" }];
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

export const rekeyStartingRelations = (rows, from, to) => (Array.isArray(rows) ? rows.map((row) => {
  if (!isRow(row)) return row;
  const next = {
    ...row,
    a: folded(row.a) === folded(from) ? to : row.a,
    b: folded(row.b) === folded(from) ? to : row.b,
  };
  return typeof row._editId === "string" && row._editId ? attachEditId(next, row._editId) : next;
}) : []);

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
export const settleStartingRelationEdits = (document, savedEdits, extraKeys = []) => {
  const saved = Array.isArray(savedEdits) ? savedEdits : [];
  if (!saved.length) return { ok: true, document };
  const choices = Object.entries(document?.polities || {}).map(([key, record]) => ({
    ...(isRow(record) ? record : {}), key,
  }));
  const seenKeys = new Set(choices.map((entry) => clean(entry.key)).filter(Boolean));
  for (const rawKey of (Array.isArray(extraKeys) ? extraKeys : [])) {
    const key = clean(rawKey);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    choices.push({ key });
  }
  const known = knownPolityKeys(choices);
  const pending = Array.isArray(document?.relationEdits) ? document.relationEdits : [];
  const pendingById = new Map(pending.filter((entry) => entry?._editId).map((entry) => [entry._editId, entry]));
  const renames = Array.isArray(document?.polityRenames) ? document.polityRenames : [];
  const resolveEndpoint = (raw) => {
    let value = clean(raw);
    if (!known.has(value)) {
      // Workshop renames strip formerNames/old aliases and record { from, to }
      // in document.polityRenames; replay them when an in-flight endpoint no
      // longer matches a current polity key.
      for (const rename of renames) {
        if (rename?.from && rename?.to && folded(value) === folded(rename.from)) {
          value = clean(rename.to);
        }
      }
    }
    const resolved = endpointOf(value, choices);
    return resolved.candidates.length === 1 ? resolved.key : value;
  };
  // If a polity was renamed while the scenario write was in flight, prefer the
  // already-rekeyed pending edit with the same _editId, otherwise replay
  // document.polityRenames and fall back to polity aliases/formerNames.
  const rebasedSaved = saved.map((entry) => {
    if (!isRow(entry)) return entry;
    const matchedPending = entry._editId ? pendingById.get(entry._editId) : null;
    if (matchedPending && known.has(clean(matchedPending.a)) && known.has(clean(matchedPending.b))) {
      const a = clean(matchedPending.a);
      const b = clean(matchedPending.b);
      return a === entry.a && b === entry.b ? entry : attachEditId({ ...entry, a, b }, entry._editId);
    }
    const a = resolveEndpoint(entry.a);
    const b = resolveEndpoint(entry.b);
    return a === entry.a && b === entry.b ? entry : attachEditId({ ...entry, a, b }, entry._editId);
  });
  const applied = applyStartingRelationEdits(document?.relations, rebasedSaved, choices);
  if (!applied.ok) return applied;
  const writtenObjects = new Set(saved);
  const writtenIds = new Set(saved.map((entry) => entry?._editId).filter(Boolean));
  return {
    ok: true,
    document: {
      ...document,
      relations: applied.relations,
      relationEdits: pending
        .filter((entry) => !writtenObjects.has(entry) && !(entry?._editId && writtenIds.has(entry._editId))),
    },
  };
};

// List every existing row, even legacy or conflicting rows which cannot be
// safely edited. Never normalize/dedupe the source merely to display it.
export const startingRelationOverview = (source, choices) => {
  const known = knownPolityKeys(choices);
  const listed = (Array.isArray(source) ? source : []).flatMap((row,index) => {
    if (!isRow(row)) return [];
    const left = endpointOf(row.a, choices), right = endpointOf(row.b, choices);
    const a = left.key, b = right.key;
    const pair = relationPairKey(a,b);
    const resolved = left.candidates.length === 1 && right.candidates.length === 1
      && known.has(a) && known.has(b) && folded(a) !== folded(b);
    return [{ row,index,a,b,pair,editable:resolved }];
  });
  const counts = new Map();
  for(const item of listed)counts.set(item.pair,(counts.get(item.pair)||0)+1);
  return listed.map(item=>({...item, editable:item.editable&&counts.get(item.pair)===1}));
};

// A manager submits one deliberate pair edit against the latest scenario.
// Refuse an intervening change to that pair instead of overwriting it. Other
// pairs and any metadata not named by the edit are preserved.
export const planReviewedStartingRelationEdit = (source, edit, expectedRow, choices) => {
  const checked = validateStartingRelationEdit(edit, choices);
  if(!checked.ok)return checked;
  const pair = relationPairKey(checked.edit.a,checked.edit.b);
  const matches = startingRelationOverview(source,choices).filter(item=>item.pair===pair);
  if(matches.length>1 || matches.some(item=>!item.editable))return reject("This relationship has unresolved or conflicting identities.");
  const current = matches[0]?.row ?? null;
  if(JSON.stringify(current)!==JSON.stringify(expectedRow??null))return reject("This relationship changed since review. Reopen it and review the latest values.");
  return applyStartingRelationEdits(source,[checked.edit],choices);
};
