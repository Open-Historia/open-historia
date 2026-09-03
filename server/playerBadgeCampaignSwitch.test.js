import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const badge = fs.readFileSync(
  path.resolve(here, "../src/Game/GameUI/other.jsx"),
  "utf8",
);

test("player badge follows the active campaign from the library store", () => {
  assert.match(badge, /import \{ useLibraryState \} from "\.\.\/\.\.\/runtime\/library\.js"/);
  assert.match(badge, /const \{ activeGame \} = useLibraryState\(\)/);
  assert.match(badge, /const activeGameCountry = String\(activeGame\?\.country \|\| ""\)\.trim\(\)/);
});

test("campaign switch invalidates badge state even when the new country name matches", () => {
  assert.match(badge, /const activeGameId = String\(activeGame\?\.id \|\| ""\)/);
  assert.match(badge, /\}, \[activeGameCountry, activeGameId\]\);/);
});

test("badge no longer boots player identity from cached game.json", () => {
  assert.doesNotMatch(badge, /readJson\(JSON_URLS\.game/);
  assert.doesNotMatch(badge, /getNationFlags, readJson/);
});

test("campaign activation refreshes world-dependent badge state once", () => {
  assert.match(badge, /readWorldState\(\{ force: true \}\)/);
  assert.match(badge, /setWorldState\(null\)/);
  assert.match(badge, /setLandless\(false\)/);
});

test("normal in-campaign game and world update listeners remain intact", () => {
  assert.match(badge, /window\.addEventListener\("oh:game-updated", onGameUpdated\)/);
  assert.match(badge, /window\.addEventListener\("oh:world-updated", onWorldUpdated\)/);
});
