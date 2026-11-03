// Run: node --test src/Game/GameUI/rankingFlags.test.js
//
// "many flags arent rendering in the ranking thing for some reason" (the owner,
// 2026-11-03): the ranking read a flag from the row's name as if it were a map
// code, so a country known by its official name ("Republic of India") had none.
// It finds them as every other flag in the game is found (polityFlags.js).
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { renamePolityInWorld } from "../../../server/polityRename.js";
import { normalizeWorldState } from "../../runtime/gameState.js";
import { resolvePolityFlag } from "../../runtime/polityFlags.js";
import { buildPolityIdentityIndex } from "../../runtime/polityIdentity.js";

test("a country known by its official name has its flag in the ranking", () => {
  let world = JSON.parse(fs.readFileSync(new URL("../../../server/seed/default/world.json", import.meta.url), "utf8"));
  for (const [from, to] of [["India", "Republic of India"], ["Germany", "Federal Republic of Germany"]]) world = renamePolityInWorld(world, from, to).world;
  world = normalizeWorldState(world);
  const identityIndex = buildPolityIdentityIndex(world);
  const flagOf = (name) => resolvePolityFlag({ polity: { name, code: name }, world, flags: {}, identityIndex }).imageUrl;
  assert.match(flagOf("Republic of India") ?? "", /\/in\.svg$/);
  assert.match(flagOf("Federal Republic of Germany") ?? "", /\/de\.svg$/);
  assert.match(flagOf("Japan") ?? "", /\/jp\.svg$/);
  const stats = fs.readFileSync(new URL("./stats.jsx", import.meta.url), "utf8");
  assert.match(stats, /const flagUrl = resolvePolityFlag\(\{ polity: \{ name: row\.label, code: row\.key \}, world: world \|\| \{\}, flags: flags \|\| \{\}, identityIndex: flagIdentityIndex \}\)\.imageUrl;/);
});
