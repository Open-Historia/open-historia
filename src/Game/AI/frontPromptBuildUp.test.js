// Run: node --test src/Game/AI/frontPromptBuildUp.test.js
//
// A player's report (2026-11-05): Poland's "I build up my forces" came back as an event and a manpower figure, with
// no `home:` line, so nobody was called up. The skip's rule wrote the line as `home: X~X~...` for the model to fill in.
import assert from "node:assert/strict";
import test from "node:test";

import { buildFrontsBlock } from "./frontPrompt.js";

test("the skip is told the build-up line with the player's own name", () => {
  const block = buildFrontsBlock({ battlefields: [], players: ["Poland"] });
  assert.match(block, /`home: Poland~Poland~reinforce~all~4`/);
  assert.doesNotMatch(block, /home: X~X/);
  assert.match(block, /Only that line calls them up: an event or a figure alone raises nobody\./);
});

test("with several players the line keeps its placeholder", () => {
  assert.match(buildFrontsBlock({ battlefields: [], players: ["Poland", "Lithuania"] }), /`home: X~X~reinforce~all~4`/);
});
