/*! Open Historia — GM partial transaction display and Apply guard; AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ui = readFileSync(fileURLToPath(new URL("./cheats.jsx", import.meta.url)), "utf8");

test("a preview with omitted canonical operations is labelled PARTIAL, not unqualified VALIDATED", () => {
  assert.match(ui, /gmNotes\.length \? "VALIDATED · PARTIAL" : "VALIDATED"/);
  assert.match(ui, /gmNotes\.length \? "APPLIED · PARTIAL" : "APPLIED"/);
  assert.match(ui, /color: gmNotes\.length \? "#fbbf24" : "#86efac"/);
});

test("GM Apply requires explicit acknowledgement of any omitted operations", () => {
  const guard = ui.indexOf('if (gmNotes.length > 0 && !window.confirm("Some requested operations');
  const start = ui.lastIndexOf("onClick={() => runBusy(async () => {", guard);
  const apply = ui.indexOf("const result = await applyGameMasterPreview(gmPreview);", guard);
  assert.ok(start > 0 && guard > start && guard - start < 700, "the confirmation is on the real Apply button");
  assert.ok(apply > guard && apply - guard < 600, "partial-Apply consent must run before the canonical mutation");
  assert.match(ui.slice(guard,apply), /return "Partial transaction not applied\.";\s*}/);
});
