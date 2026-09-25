import test from "node:test";
import assert from "node:assert/strict";
import {
  createApplicationReceipt,
  noteMalformedImpacts,
  tallyAppliedEvents,
  renderApplicationReceipt,
} from "./applicationReceipt.js";

test("application receipts count canonical Political Actor mutations", () => {
  const receipt = createApplicationReceipt();
  tallyAppliedEvents(receipt, [{
    title: "Cabinet change",
    impacts: {
      politicalActorOps: [
        { op: "set-government", polityKey: "Ruritania", argsJson: "{}" },
        { op: "replace-leader", polityKey: "Ruritania", argsJson: "{}" },
      ],
    },
  }]);

  assert.equal(receipt.applied.events, 1);
  assert.equal(receipt.applied.politicalActorOps, 2);
  assert.match(renderApplicationReceipt(receipt), /2 political actor operations/i);
});

test("application receipts report malformed Political Actor mutations that normalization drops", () => {
  const receipt = createApplicationReceipt();
  const rawEvent = {
    title: "Cabinet change",
    impacts: { politicalActorOps: [{ op: "replace-leader" }, { op: "set-government" }] },
  };
  const normalizedEvent = {
    title: "Cabinet change",
    impacts: { politicalActorOps: [{ op: "replace-leader" }] },
  };

  noteMalformedImpacts(receipt, rawEvent, normalizedEvent);
  assert.equal(receipt.notes.length, 1);
  assert.match(receipt.notes[0].text, /political actor operations?/i);
});
