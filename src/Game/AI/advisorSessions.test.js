import assert from "node:assert/strict";
import test from "node:test";
import { createAdvisorSessionRegistry } from "./advisorSessions.js";

test("each Advisor recipient has separate durable memory, history, and generation guard", () => {
  const registry = createAdvisorSessionRegistry();
  const chief = registry.get();
  const marina = registry.get("advisor-marina-001");
  assert.notEqual(chief, marina);
  assert.equal(registry.get("advisor-marina-001"), marina);
  chief.memory = "Orlov remembers prior policy";
  marina.memory = "Marina remembers Treasury discussions";
  chief.history.push({ role: "user", text: "State strategy" });
  marina.history.push({ role: "user", text: "Treasury" });
  assert.equal(registry.get().memory, "Orlov remembers prior policy");
  assert.deepEqual(chief.history.map((x) => x.text), ["State strategy"]);
  const marinaGeneration = marina.conversation.current();
  chief.conversation.replace();
  assert.equal(marina.conversation.isCurrent(marinaGeneration), true);
  marina.conversation.replace();
  assert.equal(marina.conversation.isCurrent(marinaGeneration), false);
  assert.deepEqual(marina.history.map((x) => x.text), ["Treasury"]);
});
