/*! Open Historia — Projects in-place archival UI boundary; AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const source = fs.readFileSync(fileURLToPath(new URL("./projects.jsx", import.meta.url)), "utf8");

test("Projects panel archives closed records through the current-world canonical queue", () => {
  assert.match(source, /mutateWorldState\(\(world\) => \{\s*const next = archiveClosedProjectsInWorld\(world, \{ date: gameDate \}\)/);
  assert.match(source, /mutateWorldState\(\(world\) => restoreArchivedProjectInWorld\(world, \{/);
  assert.match(source, /refreshRuntimeState\(\["world"\]\)/);
  assert.match(source, /window\.confirm\(uiString\("Archive all closed projects/);
});

test("archival controls stay outside shared games and never expose the host-only archive", () => {
  assert.match(source, /if \(inSharedGame\(\) \|\| archiveBusy\) return;/);
  assert.match(source, /!inSharedGame\(\) && \(hasClosedBoardRecords \|\| visibleArchive\.length > 0\)/);
  assert.match(source, /!inSharedGame\(\) && archiveOpen && visibleArchive\.length > 0/);
  assert.match(source, /entry\?\.board === "world" && entry\?\.project && isKnownToPlayer\(entry\.project, playerCountry\)/);
  assert.match(source, /disabled=\{archiveBusy \|\| !archiveSelection \|\| projects\.length >= PROJECT_BOARD_LIMIT\}/);
});
