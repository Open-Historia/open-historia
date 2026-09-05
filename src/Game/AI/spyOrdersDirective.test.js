import assert from "node:assert/strict";
import test from "node:test";

import { SPY_ORDERS_DIRECTIVE_HEADER, buildSpyOrdersDirective } from "./spyOrdersDirective.js";

test("the espionage directive names the player and both operations", () => {
  const text = buildSpyOrdersDirective("France");
  assert.ok(text.startsWith(SPY_ORDERS_DIRECTIVE_HEADER));
  assert.match(text, /France's intelligence service/);
  assert.match(text, /"op":"deploy"/);
  assert.match(text, /"op":"recall"/);
  assert.match(text, /impacts\.spyOps/);
  // The three rules the engine enforces are spelled out for the model.
  assert.match(text, /One agent per country/);
  assert.match(text, /at most three/);
  assert.match(text, /never inside France's own territory/);
});

test("a missing player name falls back rather than reading \"undefined\"", () => {
  const text = buildSpyOrdersDirective();
  assert.doesNotMatch(text, /undefined/);
  assert.match(text, /the player's intelligence service/);
  assert.equal(buildSpyOrdersDirective("   "), text);
});
