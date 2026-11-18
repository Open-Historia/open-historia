/*! Open Historia — a refusal reaches the player where they acted: the map cards' wiring © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Selection/refusalsShown.test.js
//
// "Every refusal reaches the player where they acted, with the host's reason"
// (the shared-game map's rule 10). A unit's order in words kept only whether
// it was queued, so its card said the order could not be saved whatever the
// host had answered; a structure's Accept and Move wrote the host's refusal to
// the diagnostics log alone (the gap audit of 2026-11-18). What the functions
// answer is tested beside them (Map/unitsController.test.js,
// runtime/structurePlacement.test.js); the cards are JSX, which node does not
// load, so this pins that each shows what it is answered.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("the unit card shows the reason an order in words was refused", () => {
  const card = read("./Units.jsx");
  const send = card.slice(card.indexOf("const sendRequest"), card.indexOf("return createPortal"));
  assert.match(send, /result = await requestUnitOrders\(unit\.id, request\)/);
  assert.match(send, /setOrderError\(result\?\.error \|\| ORDER_NOT_SAVED\)/);
});

test("a structure's card shows why Accept was refused, and the map's banner why Move was", () => {
  const card = read("./Features.jsx");
  assert.match(card, /saveSettledStructure\(feature\.id\)[\s\S]{0,300}setSettleError\(/);
  assert.match(card, /role="alert"[^>]*>\s*\{settleError\}/);
  const map = read("../Map/Nations.jsx");
  const move = map.slice(map.indexOf('mode.kind === "structure-place"'), map.indexOf('mode.kind === "admin-place"'));
  assert.match(move, /setInteractionMode\(\{ \.\.\.mode, error: /, "a refused Move stays armed and says why, as a deploy does");
});
