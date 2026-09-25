import assert from "node:assert/strict";
import test from "node:test";
import { buildLifecycleReplyRevealPlan, lifecycleReplyRevealGapMs } from "./institutionLifecyclePresentation.js";

test("lifecycle group replies reveal one at a time with 1-3 second gaps", () => {
  const messages = [
    { id: "old", speaker: "Republic of Latvia", text: "Invitation" },
    { id: "lt", speaker: "Republic of Lithuania", text: "Accept" },
    { id: "ee", speaker: "Republic of Estonia", text: "Accept" },
    { id: "pl", speaker: "Republic of Poland", text: "Observer instead" },
  ];
  const plan = buildLifecycleReplyRevealPlan({ messages, newMessageIds: ["lt", "ee", "pl"] });
  assert.equal(plan.length, 3);
  assert.equal(plan[0].message.id, "lt");
  assert.equal(plan[0].gapMs, 0);
  for (const row of plan.slice(1)) assert.ok(row.gapMs >= 1000 && row.gapMs <= 3000, `gap ${row.gapMs}ms is outside 1-3 seconds`);
  assert.ok(plan[2].revealAtMs > plan[1].revealAtMs);
});

test("lifecycle reveal timing is deterministic for the same speaker and slot", () => {
  assert.equal(lifecycleReplyRevealGapMs("Republic of Estonia", 1), lifecycleReplyRevealGapMs("Republic of Estonia", 1));
});
