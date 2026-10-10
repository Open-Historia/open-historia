/*! Open Historia — the engine with several human players: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/sharedGameEngine.test.js
//
// What single player grants the player's polity, a shared game grants every
// polity a person plays (runtime/humanPolities.js): its forces are its own, so
// the caps that trim the AI's order of battle never touch them, and the world's
// between-rounds pulse never moves them.

import test from "node:test";
import assert from "node:assert/strict";

import { MAX_UNITS_PER_POLITY, enforceUnitVolume, normalizeWorldState } from "../../runtime/gameState.js";
import { humanCountriesOf, isSharedGame, setHostingSharedGame } from "../../runtime/humanPolities.js";
import { idlePulseUnitOps } from "./idlePulse.js";

// These run as the host's engine does while it shares a game.
setHostingSharedGame(true);

test("a save that still lists human polities is single player wherever it is not being hosted", () => {
  const left = { country: "France", humanCountries: ["France", "Germany"] };
  setHostingSharedGame(false);
  try {
    // The app was closed mid-game, or the save came from a host's export.
    assert.deepEqual(humanCountriesOf(left), ["France"]);
    assert.equal(isSharedGame(left), false);
  } finally {
    setHostingSharedGame(true);
  }
  assert.deepEqual(humanCountriesOf(left), ["France", "Germany"]);
  assert.equal(isSharedGame(left), true);
});

const shared = { country: "France", humanCountries: ["France", "Germany"] };
const unit = (id, ownerCode, index, source = "ai") => ({
  id,
  name: `${ownerCode} ${index}`,
  type: "infantry",
  ownerCode,
  strength: 100 - index,
  source,
  lng: index + 1,
  lat: 1,
});
const forces = (owner, count) => Array.from({ length: count }, (_, index) => unit(`${owner}-${index}`, owner, index));
const count = (world, owner) => world.units.filter((entry) => entry.ownerCode === owner).length;

test("the AI's unit caps pass over every person's forces, and still trim the AI's", () => {
  const world = normalizeWorldState({ units: [...forces("France", 20), ...forces("Germany", 20), ...forces("Italy", 20)] });
  const next = enforceUnitVolume(world, { playerCode: shared.country, playerCodes: humanCountriesOf(shared) });
  assert.equal(count(next, "France"), 20);
  assert.equal(count(next, "Germany"), 20);
  assert.equal(count(next, "Italy"), MAX_UNITS_PER_POLITY);

  // Single player: Germany is the AI's, and its surplus goes as it always has.
  const solo = enforceUnitVolume(world, { playerCode: "France" });
  assert.equal(count(solo, "France"), 20);
  assert.equal(count(solo, "Germany"), MAX_UNITS_PER_POLITY);
});

test("the between-rounds pulse never moves a unit any person plays", () => {
  const world = { units: [unit("fr-1", "France", 1), unit("de-1", "Germany", 1), unit("it-1", "Italy", 1)] };
  const ops = [
    { op: "strength", unitId: "de-1", strength: 50 },
    { op: "strength", unitId: "it-1", strength: 50 },
    { op: "spawn", unit: { ownerCode: "Germany", name: "New Corps" } },
  ];
  assert.deepEqual(idlePulseUnitOps(world, ops, humanCountriesOf(shared)).map((op) => op.unitId ?? "spawn"), ["it-1"]);
  // Single player: only France's are off limits.
  assert.deepEqual(idlePulseUnitOps(world, ops, "France").map((op) => op.unitId ?? "spawn"), ["de-1", "it-1"]);
});

// --- What the simulator is told --------------------------------------------

test("single player's orders read exactly as they always have; a shared game's name who gave each", async () => {
  const { buildActionHistoryText, formatActionsForPrompt, joinPolityNames } = await import("./promptContext.js");
  const solo = [{ id: "o1", status: "planned", title: "Talks", text: "Open talks with Spain" }];
  assert.equal(buildActionHistoryText(solo), "- (action) Talks: Open talks with Spain");
  assert.equal(formatActionsForPrompt(solo), "- Talks: Open talks with Spain");
  const owned = [
    { id: "o1", status: "planned", title: "Talks", text: "Open talks with Spain", ownerCode: "France" },
    { id: "o2", status: "planned", title: "Fleet", text: "Send the fleet to Kiel", ownerCode: "Germany" },
  ];
  assert.equal(buildActionHistoryText(owned), "- (action, France) Talks: Open talks with Spain\n- (action, Germany) Fleet: Send the fleet to Kiel");
  assert.equal(formatActionsForPrompt(owned), "- (France) Talks: Open talks with Spain\n- (Germany) Fleet: Send the fleet to Kiel");
  assert.equal(joinPolityNames(["France"]), "France");
  assert.equal(joinPolityNames(["France", "Germany"]), "France and Germany");
  assert.equal(joinPolityNames(["France", "Germany", "Italy"]), "France, Germany and Italy");
});

test("the player's focus lists every person's orders under the polity that gave them", async () => {
  const { collectPlayerMaterial } = await import("./playerFocus.js");
  const labels = (actions) => collectPlayerMaterial({ playerNames: ["France", "Germany"], actions })
    .filter((item) => item.kind === "order")
    .map((item) => item.label);
  assert.deepEqual(labels([{ id: "o1", status: "planned", text: "Open talks with Spain" }]), ["Open talks with Spain"]);
  assert.deepEqual(labels([{ id: "o2", status: "planned", text: "Send the fleet to Kiel", ownerCode: "Germany" }]), ["(Germany) Send the fleet to Kiel"]);
});

test("the simulator is told who plays only when several people do", async () => {
  const { buildSharedGameDirective } = await import("./sharedGameDirective.js");
  assert.equal(buildSharedGameDirective({ country: "France" }), "");
  assert.equal(buildSharedGameDirective({ country: "France", humanCountries: ["France"] }), "");
  const directive = buildSharedGameDirective(shared);
  assert.match(directive, /^\[Shared Game/);
  assert.match(directive, /one each: France; Germany\./);
  assert.match(directive, /never make another player's polity choose/);
});
