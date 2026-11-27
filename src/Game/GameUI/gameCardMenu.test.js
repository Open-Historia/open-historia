/*! Open Historia — what a game's card offers in the library: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/gameCardMenu.test.js
//
// The review of 2026-11-19, F7: a guest's stand-in card offered Edit, Clone and Archive, each refused, and Export,
// which exported the stand-in. It offers what works: Current on the card, and leaving the shared game.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { gameCardActions } from "./gameCardMenu.js";

test("a guest's stand-in card offers only leaving; every other game's card is as it was", () => {
  assert.deepEqual(gameCardActions({ id: "g1" }), ["edit", "clone", "recover", "archive", "export"]);
  assert.deepEqual(gameCardActions({ id: "g2", standIn: { returnTo: "g1" } }), ["leave"]);
  assert.deepEqual(gameCardActions(null), ["edit", "clone", "recover", "archive", "export"]);
});

test("the card builds its menu from those actions, and leaving goes as the shared game's own Leave does", () => {
  const bar = fs.readFileSync(new URL("./libraryBar.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const card = bar.slice(bar.indexOf("const GameCard = "), bar.indexOf("const cardMenuItems = ") + 1200);
  assert.match(card, /const cardMenuItems = gameCardActions\(game\)\.map\(\(action\) => cardMenuItemFor\[action\]\);/);
  assert.match(bar, /const \{ leaveSharedGame \} = await import\("\.\.\/\.\.\/multiplayer\/client\/sharedGame\.js"\);\n\s*await leaveSharedGame\(\);\n\s*window\.location\.reload\(\);/);
});
