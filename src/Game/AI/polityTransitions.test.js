import test from "node:test";
import assert from "node:assert/strict";

import { successorTransfers } from "./polityTransitions.js";

test("a polity founded as another dissolves inherits all of its land", () => {
  const transfers = successorTransfers({
    polityChanges: [
      { operation: "create", code: "Republic of China" },
      { operation: "dissolve", code: "Qing Empire" },
    ],
  });
  assert.deepEqual(transfers, [{
    regionId: "country: Qing Empire",
    regionName: "Qing Empire",
    fromCode: "Qing Empire",
    toCode: "Republic of China",
    wholeCountry: true,
    note: "Republic of China succeeds Qing Empire, which this event dissolves.",
  }]);
});

test("land the event already settles, several heirs, or no dissolution leave it to the event", () => {
  const founding = [{ operation: "create", code: "Republic of China" }, { operation: "dissolve", code: "Qing Empire" }];
  assert.deepEqual(successorTransfers({ polityChanges: founding, regionTransfers: [{ regionId: "Beijing", fromCode: "Qing Empire", toCode: "Republic of China" }] }), []);
  assert.deepEqual(successorTransfers({ polityChanges: founding, regionControlOps: [{ op: "control", regionId: "Wuhan", fromCode: "qing empire", toCode: "Republic of China" }] }), []);
  assert.deepEqual(successorTransfers({ polityChanges: [...founding, { operation: "create", code: "Mongolia" }] }), []);
  assert.deepEqual(successorTransfers({ polityChanges: [{ operation: "create", code: "Republic of China" }] }), []);
  assert.deepEqual(successorTransfers({ polityChanges: [{ operation: "rename", code: "Qing Empire", name: "Republic of China" }] }), []);
  assert.deepEqual(successorTransfers({}), []);
});
