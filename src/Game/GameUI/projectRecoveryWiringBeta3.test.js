/*! Open Historia — Projects recovery UI contract tests; AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("Game library exposes recovery without opening or normalizing the broken live world", () => {
  const library = read("./libraryBar.jsx");
  assert.match(library, /\["Recover Projects…", \(\) => \{ setCardMenuOpen\(false\); onRecover\(game\); \}, false\]/);
  assert.match(library, /onRecover=\{setProjectRecoveryGame\}/);
  assert.match(library, /<ProjectRecoveryDialog[\s\S]*?game=\{projectRecoveryGame\}/);
  assert.match(library, /const ProjectRecoveryDialog = lazy\(\(\) => import\("\.\/ProjectRecoveryDialog\.jsx"\)\)/);
});

test("save-owner recovery creates a separate imported campaign and copies only compatible restore points", () => {
  const dialog = read("./ProjectRecoveryDialog.jsx");
  assert.match(dialog, /exportGameBundle\(game\.id\)/);
  assert.match(dialog, /prepareProjectRecoveryBundle\(bundle,/);
  assert.match(dialog, /const snapshots = canCopySnapshots \? await readGameSnapshotsText\(game\.id\) : null;[\s\S]*?await importGameBundle\(repaired\)/);
  assert.match(dialog, /await writeGameSnapshotsText\(newGameId, snapshots\)/);
  assert.match(dialog, /\(activeWarning \|\| historyWarning\) && !window\.confirm\(/);
  assert.match(dialog, /if \(snapshots !== null\) await writeGameSnapshotsText\(newGameId, snapshots\)/);
  assert.doesNotMatch(dialog, /writeWorldState\(|mutateWorldState\(/);
});

test("a recovery shelf cannot become a guest's canonical world/intelligence field", () => {
  const projection = read("../../multiplayer/host/projection.js");
  assert.match(projection, /"projectRecoveryArchive"/);
});
