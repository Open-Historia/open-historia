import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf-8");

test("generated-world destination is surfaced in the real Map Editor and never bypasses native scenario Save",()=>{
  const editor=read("./MapEditor.jsx");
  const host=read("../Game/GameUI/libraryBar.jsx");
  assert.match(editor,/Generated world: choose a destination/);
  assert.match(editor,/Create New Scenario from This World/);
  assert.match(editor,/destination: "new"/);
  assert.match(editor,/newScenarioName: newGeneratedScenarioName/);
  assert.match(editor,/generatedWorldReplacementId\(d\.doc\) && !reviewSource/);
  assert.match(host,/if \(destination === "new"\)/);
  assert.match(host,/createFreshScenarioFromGeneratedMap\(/);
  assert.match(host,/withSingleLibraryRefresh\(\(\) => writeMapToScenario\(newId, freshSeed, \[\]\)\)/);
  assert.match(host,/settleSource: beforePlay/);
  const settlement=host.indexOf("settleSource: beforePlay");
  const selection=host.indexOf("await selectScenario(newId)");
  assert.ok(settlement>0&&selection>settlement,"The new scenario must be selected only after accepted native publication/settlement");
  assert.match(host,/await openScenarioEditor\(newId\)/);
});
test("ordinary scenario Save and historical-world rejection remain on their existing guarded path",()=>{
  const host=read("../Game/GameUI/libraryBar.jsx");
  const editor=read("./MapEditor.jsx");
  assert.match(host,/if \(destination !== "current"\) throw new Error/);
  assert.match(host,/assertGeneratedWorldScenarioSaveAllowed\(currentWorld, seed\.generatedWorldReplacement\)/);
  assert.match(editor,/if \(destination === "new" && !generatedWorldReplacementId\(d\.doc\)\)/);
  assert.match(editor,/beforePlay: async \(applied\)/);
  assert.match(editor,/await finishAcceptedScenarioSave\(applied\)/);
});
