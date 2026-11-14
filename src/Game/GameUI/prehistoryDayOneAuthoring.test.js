import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("./PrehistoryPanel.jsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("./DayOneFactEditor.jsx", import.meta.url), "utf8");

test("pre-history exposes manual relationship, agreement and storyline controls without replacing the original record ownership", () => {
  assert.match(panel, /AUTHORABLE_DAY_ONE_KINDS\.map/);
  assert.match(panel, /insertManualDayOneFact\(current, kind\)/);
  assert.match(panel, /updateDayOneFact\(current, family, index, patch\)/);
  assert.match(panel, /withoutPrehistoryUpdate\(current, family, index\)/);
  assert.match(panel, /<DayOneFactEditor/);
  assert.match(panel, /<DayOneRow/);
  assert.match(panel, /changed \|\| \(!saved && Boolean\(briefing\)\) \? \{ prehistory: record \} : \{\}/);
  assert.match(panel, /canonicalDirty \? \{ agreements: canonicalValidation\.agreements \} : \{\}/);
  assert.match(panel, /saveScenario\(scenarioId, \{ worldPatch \}\)/);
  assert.doesNotMatch(panel, /worldPatch:\s*\{\s*(relations|storylines):/);
});

test("saving uses native semantic compiler verification, without creating an AI request", () => {
  assert.match(panel, /dayOneEditorProblems\(draft, \{ startDate, world: stagedWorld, verifyWorld: true \}\)/);
  assert.match(panel, /if \(verified\.length\)/);
  assert.match(panel, /MAX_SEMANTIC_DAY_ONE_FACTS/);
  assert.match(panel, /countPrehistoryUpdates\(draft\)/);
  assert.match(panel, /<datalist id="oh-prehistory-polities">/);
  assert.match(editor, /onChangeType/);
  assert.match(editor, /onReciprocalChange/);
  assert.match(editor, /onRemove/);
  assert.match(editor, /\+ Add country/);
  assert.match(editor, /Remove country/);
});

test("editor retains separate semantic and legacy fields rather than conflating process kind with fact kind", () => {
  assert.match(editor, /row\.family === "canonicalUpdates"/);
  assert.match(editor, /legacy \? "kind" : "processKind"/);
  assert.match(editor, /sourceEventRefs|existing event links/);
  assert.match(editor, /Signatory countries/);
  assert.match(editor, /worldAgreements/);
  assert.match(panel, /Existing scenario agreements/);
  assert.match(panel, /removeScenarioCanonicalAgreement\(current, agreement\.id\)/);
  assert.match(panel, /validateScenarioCanonicalAgreementEdits/);
  assert.match(panel, /world: stagedWorld, verifyWorld: true/);
  assert.match(editor, /guarantor/);
  assert.match(editor, /beneficiary/);
  assert.match(editor, /grantor/);
  assert.match(editor, /grantee/);
});
