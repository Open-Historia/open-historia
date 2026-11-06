/*! Open Historia — sandbox mode tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/sandbox.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { actorOf, describeSandboxForAdvisor, describeSandboxForSimulation, isObserver, isSandbox, withSandbox } from "./sandbox.js";

test("observer needs sandbox, and switching sandbox off ends it", () => {
  assert.equal(isObserver({ observer: true }), false);
  const on = withSandbox({ country: "Croatia" }, { sandbox: true, observer: true });
  assert.ok(isSandbox(on) && isObserver(on));
  const off = withSandbox(on, { sandbox: false });
  assert.deepEqual([off.sandbox, off.observer, off.country], [false, false, "Croatia"]);
  assert.equal(withSandbox(on, { observer: false }).sandbox, true);
});

test("an order belongs to its actor, else the player's country; an observer's needs one", () => {
  const game = { country: "Croatia", sandbox: true };
  assert.equal(actorOf({ actor: "France" }, game), "France");
  assert.equal(actorOf({}, game), "Croatia");
  assert.equal(actorOf({}, { ...game, observer: true }), "");
});

test("turns are told the sandbox rules last; nothing outside sandbox", () => {
  assert.equal(describeSandboxForSimulation({ country: "Croatia" }), "");
  const sandbox = describeSandboxForSimulation({ country: "Croatia", sandbox: true });
  assert.match(sandbox, /^\[Sandbox Mode\]\nThe player leads Croatia/);
  assert.match(sandbox, /An order marked \(as X\) is X's own government's decision/);
  const observer = describeSandboxForSimulation({ country: "Croatia", sandbox: true, observer: true });
  assert.match(observer, /^\[Sandbox Mode — Observer\]\nNo polity is human-controlled/);
  assert.match(observer, /Croatia is not the player's polity: simulate it like every other power/);
  assert.match(describeSandboxForAdvisor({ sandbox: true, observer: true }), /impartial analyst/);
  assert.equal(describeSandboxForAdvisor({ sandbox: true }), "");
});

test("orders carry their actor through a save, and the turn's order list names it", async () => {
  const { normalizeActionEntry } = await import("./gameState.js");
  const { buildActionHistoryText } = await import("../Game/AI/promptContext.js");
  const order = normalizeActionEntry({ id: "action-1", title: "Mobilise the army", text: "Mobilise the army", status: "planned", actor: "France" });
  assert.equal(order.actor, "France");
  assert.equal(normalizeActionEntry({ title: "x", text: "x" }).actor, undefined);
  assert.match(buildActionHistoryText([order]), /^- \(action\) \(as France\) Mobilise the army: /);
});

test("turns, idle diplomacy and event outreach read the sandbox switches", async () => {
  const { readFileSync } = await import("node:fs");
  const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(gameplay, /const sandbox = describeSandboxForSimulation\(game\);\n  if \(sandbox\) blocks\.push\(sandbox\);/);
  assert.match(gameplay, /const observer = isObserver\(bundle\.game\);/);
  assert.match(gameplay, /if \(!payload\.chat \|\| observer\) return null;/);
  assert.match(gameplay, /if \(isObserver\(bundle\.game\)\) return debug \? \{ processed: 0, reason: "observer"/);
  assert.equal((gameplay.match(/no polity is human-controlled \(sandbox observer\)/g) ?? []).length, 2);
  const advisor = readFileSync(new URL("../Game/AI/main.jsx", import.meta.url), "utf8");
  assert.match(advisor, /describeSandboxForAdvisor\(gameData\),/);
});

test("Improve action text writes what happens in sandbox mode, not an attempt to make it happen", async () => {
  const { describeSandboxForRefine } = await import("./sandbox.js");
  assert.equal(describeSandboxForRefine({ country: "Croatia" }), "");
  const plain = describeSandboxForRefine({ country: "Croatia", sandbox: true, observer: true });
  assert.match(plain, /statement of what happens, in the present tense/);
  assert.match(plain, /never turn it into another power funding, backing, supporting/);
  assert.match(plain, /never hedge it/);
  assert.match(describeSandboxForRefine({ sandbox: true }, "Serbia"), /given as Serbia: write it as Serbia's own decision/);
  assert.match(describeSandboxForSimulation({ country: "Croatia", sandbox: true }), /is the game master's decree: it happens as written/);
  const { readFileSync } = await import("node:fs");
  const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
  assert.match(gameplay, /const sandbox = describeSandboxForRefine\(bundle\.game, actor\);/);
});

test("the orders a turn must answer say whose they are in sandbox mode", async () => {
  const { collectPlayerMaterial } = await import("../Game/AI/playerFocus.js");
  const items = collectPlayerMaterial({
    actions: [
      { id: "a1", status: "planned", text: "Topple the Vučić government", actor: "Serbia" },
      { id: "a2", status: "planned", text: "Fund the shipyard" },
      { id: "a3", status: "planned", text: "Hold talks", ownerCode: "Croatia", actor: "Slovenia" },
    ],
  }).filter((item) => item.kind === "order");
  assert.deepEqual(items.map((item) => item.label), [
    "(as Serbia) Topple the Vučić government",
    "Fund the shipyard",
    "(Croatia) (as Slovenia) Hold talks",
  ]);
});
