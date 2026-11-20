import test from "node:test";
import assert from "node:assert/strict";
import { applyClipboardMetadata, undoClipboardMetadata, clipboardMetadataStep } from "./clipboardDocumentHistory.js";

const before = {
  metadata: { name: "Unchanged" },
  polities: { Original: { name: "Original", aliases: [] } },
  types: [{ id: "land", name: "Land" }],
  groups: { Existing: { name: "Existing", description: "Local" } },
  colorOverrides: { Original: [1, 2, 3] },
  flags: {}, tags: {},
};
const plan = {
  upserts: { New: { name: "New", aliases: ["AKA", " AKA ", ""] } },
  types: [{ id: "desert", name: "Desert" }],
  groups: { Frontier: { name: "Frontier", color: [200, 10, 10] } },
  colorOverrides: { New: [44, 88, 99] },
  flags: { New: "data:image/png;base64,AAAA" },
  tags: { New: ["independent"] },
};

test("the clipboard document merge adds missing canonical records without altering existing authoring", () => {
  const changed = applyClipboardMetadata(before, plan);
  assert.equal(changed.polities.Original, before.polities.Original);
  assert.deepEqual(changed.polities.New, { name: "New", aliases: ["AKA"] });
  assert.deepEqual(changed.types.map((t) => t.id), ["land", "desert"]);
  assert.deepEqual(changed.groups.Frontier, plan.groups.Frontier);
  assert.deepEqual(changed.tags.New, ["independent"]);
  assert.deepEqual(changed.metadata, before.metadata);
  assert.deepEqual(undoClipboardMetadata(changed, plan), before);
});

test("undo and redo are idempotent and preserve fields changed by another editing action", () => {
  const changed = applyClipboardMetadata(before, plan);
  assert.strictEqual(applyClipboardMetadata(changed, plan), changed, "redo does not duplicate records");
  const edited = { ...changed,
    polities: { ...changed.polities, New: { ...changed.polities.New, description: "User edited this" } },
    types: changed.types.map((r) => r.id === "desert" ? { ...r, name: "Edited desert" } : r),
  };
  const undone = undoClipboardMetadata(edited, plan);
  assert.equal(undone.polities.New.description, "User edited this", "undo never removes a newly edited polity");
  assert.equal(undone.types.find((r) => r.id === "desert").name, "Edited desert");
  assert.equal(undone.groups.Frontier, undefined, "unchanged additions are removed");
  assert.equal(undone.flags.New, undefined);
  assert.equal(undone.polities.Original, before.polities.Original);
});

test("a preexisting group differing only by case wins over clipboard records", () => {
  const doc = { ...before, groups: { frontier: { name: "Local Frontier" } } };
  const result = applyClipboardMetadata(doc, plan);
  assert.strictEqual(result.groups, doc.groups);
  assert.deepEqual(undoClipboardMetadata(result, plan).groups, doc.groups);
});

test("native document history step schedules state updates only when invoked", () => {
  let document = before;
  const statuses = [];
  const set = (update) => { document = update(document); };
  const step = clipboardMetadataStep(plan, before, set, (status) => statuses.push(status));
  assert.strictEqual(document, before, "planning does not import metadata before geometry succeeded");
  step.redo();
  assert.equal(document.types.length, 2);
  step.undo();
  assert.deepEqual(document, before);
  step.redo();
  assert.equal(document.types.length, 2);
  assert.deepEqual(statuses, ["dirty", "dirty", "dirty"]);
  assert.throws(() => clipboardMetadataStep(plan, before, null, () => {}), TypeError);
});

test("empty or malformed metadata plans leave the canonical document untouched", () => {
  assert.strictEqual(applyClipboardMetadata(before, null), before);
  assert.strictEqual(undoClipboardMetadata(before, null), before);
  assert.strictEqual(applyClipboardMetadata(before, {}), before);
  assert.strictEqual(undoClipboardMetadata(before, {}), before);
});

test("an identical pre-existing record is never removed by clipboard Undo", () => {
  const existing = {
    ...before,
    types: [...before.types, plan.types[0]],
    groups: { ...before.groups, Frontier: plan.groups.Frontier },
    tags: { ...before.tags, New: plan.tags.New },
  };
  let current = existing;
  const step = clipboardMetadataStep(plan, existing, (updater) => { current = updater(current); }, () => {});
  step.redo();
  assert.strictEqual(current.groups, existing.groups);
  step.undo();
  assert.deepEqual(current.groups.Frontier, existing.groups.Frontier);
  assert.deepEqual(current.tags.New, existing.tags.New);
  assert.deepEqual(current.types, existing.types);
  assert.equal(current.polities.New, undefined, "only the genuinely introduced polity is removed");
});

test("clipboard import uses the same canonical tag normalization as regular polity authoring", () => {
  const malformed = { ...plan, tags: {
    New: ["  socialist  ", "SOCIALIST", "anti    NATO", "", "   ", ...Array.from({ length: 70 }, (_, i) => "tag-" + i)],
  }};
  const applied = applyClipboardMetadata(before, malformed);
  assert.deepEqual(applied.tags.New.slice(0, 2), ["socialist", "anti NATO"]);
  assert.equal(applied.tags.New.filter((tag) => tag.toLowerCase() === "socialist").length, 1);
  assert.ok(applied.tags.New.length <= 32, "country tag cap enforced");
  assert.deepEqual(undoClipboardMetadata(applied, malformed, before), before);
});
