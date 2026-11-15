// Presentation-only summary of Scenario Politics suggestion changes.
// Canonical diff paths, stable IDs, generated provenance, and acceptance data
// are retained in the suggestion; none of them are UI field labels.
import { sameValue } from "../../runtime/scenarioChanges.js";

const LABELS = Object.freeze({
  polityKey: "Polity",
  government: "Government",
  governmentForm: "Government form",
  governmentIdeology: "Government ideology",
  governmentStatus: "Government status",
  headOfState: "Head of state",
  headOfGovernment: "Head of government",
  politicalLeader: "Political leader",
  coalitionName: "Coalition / cabinet name",
  legislature: "Legislature",
  legislatureSeats: "Legislature seats",
  nextElection: "Next election",
  politicalSystemType: "Political system type",
  politicalRepresentation: "Representation model",
  regimeCharacter: "Regime character",
  approval: "Government approval",
  politicalStability: "Political stability",
  politicalSystemLabel: "Political system",
  politicalSystemNotes: "Political-system notes",
  goals: "Goals",
  fears: "Fears",
  ambitions: "Ambitions",
  domesticPressures: "Domestic pressures",
  parties: "Political parties",
  powerBlocs: "Power blocs",
  politicalTraits: "Political traits",
  traitValues: "Political traits",
  politicalResponse: "Political response",
  powerStatus: "Power status",
  institutions: "Institutions",
  ideology: "Ideology",
  status: "Status",
  leader: "Leader",
  name: "Name",
  title: "Title",
  note: "Note",
});

const NON_GAMEPLAY = new Set([
  "generationProvenance", "generationDiagnostics", "generationCheckpoint",
  "schemaVersion", "ledgerVersion", "createdAt", "updatedAt", "generatedAt", "lastGeneratedAt",
]);

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const nameOf = (value) => {
  if (!isRecord(value)) return "Unnamed entry";
  for (const key of ["name", "title", "label", "shortName", "nameNative"]) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim().slice(0, 120);
  }
  return "Unnamed entry";
};
const entryKey = (item, index) => {
  if (isRecord(item)) {
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (id) return "id:" + id;
    const name = nameOf(item);
    if (name !== "Unnamed entry") return "name:" + name;
  }
  return "position:" + index;
};

const summarizeNames = (items) => ({
  names: items.slice(0, 3).map(nameOf),
  remaining: Math.max(0, items.length - 3),
});

const collectionEdits = (before, after) => {
  const original = new Map((Array.isArray(before) ? before : []).map((item, index) => [entryKey(item, index), item]));
  const suggested = new Map((Array.isArray(after) ? after : []).map((item, index) => [entryKey(item, index), item]));
  const added = [...suggested].filter(([key]) => !original.has(key)).map(([, value]) => value);
  const removed = [...original].filter(([key]) => !suggested.has(key)).map(([, value]) => value);
  const updated = [...suggested].filter(([key, value]) => original.has(key) && !sameValue(original.get(key), value))
    .map(([, value]) => value);
  const edits = [
    ...(added.length ? [{ operation: "added", ...summarizeNames(added) }] : []),
    ...(removed.length ? [{ operation: "removed", ...summarizeNames(removed) }] : []),
    ...(updated.length ? [{ operation: "updated", ...summarizeNames(updated) }] : []),
  ];
  if (edits.length === 0) edits.push({ operation: "reordered", names: [], remaining: 0 });
  return edits;
};

const previewScalar = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "✓" : "✕";
  if (Array.isArray(value)) {
    const all = value.filter((item) => item != null && typeof item !== "object");
    return all.length
      ? all.slice(0, 4).map((item) => String(item)).join(", ").slice(0, 120) + (all.length > 4 ? "…" : "")
      : "—";
  }
  return String(value).slice(0, 120);
};

export const summarizePoliticalChanges = (change, { max = 5 } = {}) => {
  const before = isRecord(change?.from) ? change.from : {};
  const after = isRecord(change?.to) ? change.to : {};
  const rows = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (NON_GAMEPLAY.has(key) || sameValue(before[key], after[key])) continue;
    const oldValue = before[key];
    const newValue = after[key];
    const label = LABELS[key] || "Political details";
    if ((Array.isArray(oldValue) || Array.isArray(newValue))
        && [...(Array.isArray(oldValue) ? oldValue : []), ...(Array.isArray(newValue) ? newValue : [])].every(isRecord)) {
      rows.push({ key, label, type: "collection", edits: collectionEdits(oldValue, newValue) });
    } else if (isRecord(oldValue) || isRecord(newValue)) {
      rows.push({ key, label, type: "details" });
    } else {
      rows.push({ key, label, type: "value", before: previewScalar(oldValue), after: previewScalar(newValue) });
    }
  }
  const limit = Number.isInteger(max) && max > 0 ? max : 5;
  return { rows: rows.slice(0, limit), hiddenCount: Math.max(0, rows.length - limit), bookkeepingOnly: rows.length === 0 };
};
