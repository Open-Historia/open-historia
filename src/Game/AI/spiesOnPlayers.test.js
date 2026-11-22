/*! Open Historia — who tries to plant an agent in each player: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/spiesOnPlayers.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { spiesOnPlayersOf, whoSpiesBlock } from "./spiesOnPlayers.js";

test("single player is asked exactly as before", () => {
  assert.equal(whoSpiesBlock(["France"]), `[Who Spies on the Player]
Write spiesOnPlayer: the polities, by exact name and comma-separated, that would really try to place an agent in France this period. Choose them as the world stands: enemies and rivals, powers with a real stake in France's affairs, a patron keeping watch on a client. A polity with no reason to, no reach, or no intelligence service to speak of sends nobody. An empty string when none would.`);
});

test("with several players each is asked for, by exact name, one line each", () => {
  const block = whoSpiesBlock(["France", "Spain"]);
  assert.match(block, /^\[Who Spies on the Players\]/);
  assert.match(block, /The players: France; Spain\./);
  assert.match(block, /Never another player's polity/);
});

test("each player's line is read by the players' exact names; a player not given one is not in the answer", () => {
  const read = spiesOnPlayersOf("France: Britain, Prussia\nCongo Free State: Belgium; Congo: Angola, Congo", ["France", "Congo", "Congo Free State", "Spain"]);
  assert.deepEqual([...read], [["France", ["Britain", "Prussia"]], ["Congo Free State", ["Belgium"]], ["Congo", ["Angola"]]]);
  assert.equal(read.has("Spain"), false);
  // An empty line is an answer: nobody would.
  assert.deepEqual([...spiesOnPlayersOf("france :  ", ["France"])], [["France", []]]);
  // A line that names no player is no answer; nor is the single-player form.
  assert.deepEqual([...spiesOnPlayersOf("Britain, Prussia", ["France", "Spain"])], []);
  assert.deepEqual([...spiesOnPlayersOf("Atlantis: Britain", ["France", "Spain"])], []);
});

test("the skip asks it in the rules and the live records, and reads it per player (gameplay.js)", () => {
  // (Read as Git checks it out on any system: a Windows checkout's CRLF is not the code's.)
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(gameplay, /espionage && spiedOn \? whoSpiesBlock\(humanCountriesOf\(game\)\) : ""/);
  assert.match(gameplay, /if \(spiedOn && !rulesAbove\) blocks\.push\(whoSpiesBlock\(humanCountriesOf\(game\)\)\);/);
  assert.match(gameplay, /const spiesNamedFor = spiedPeople\.length > 1 \? spiesOnPlayersOf\(result\.spiesOnPlayerText, spiedPeople\) : null;/);
  // Each player's service briefs the skip on its own agents.
  assert.match(gameplay, /const spymasters = spymastersOf\(game\);\n\s+const briefs = \[\];\n\s+for \(const owner of spymasters\) \{/);
  assert.match(gameplay, /await readOpenedIntercepts\(\{ owner, gameCountry: normalizeString\(game\?\.country\) \}\)/);
});
