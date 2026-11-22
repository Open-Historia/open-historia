import test from "node:test";
import assert from "node:assert/strict";

import { landlessFoundings, successorTransfers } from "./polityTransitions.js";

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

// "a movement ousted the Lebanese government ... nothing actually changed on map despite the events and AI recognizing
// the new Republic" (a player, 2026-11-10).
test("a polity a skip founds with no land anywhere in it is found, to be told to the next skip", () => {
  const ousted = { title: "The Cedar Movement takes Beirut", impacts: { polityChanges: [{ operation: "create", code: "Lebanese Democratic Republic" }] } };
  assert.deepEqual(landlessFoundings([ousted]), [{ polity: "Lebanese Democratic Republic", title: "The Cedar Movement takes Beirut" }]);
  // Land given to it in the same event, or a later one, or the land of a country it succeeds: nothing to tell.
  assert.deepEqual(landlessFoundings([{ impacts: { ...ousted.impacts, regionControlOps: [{ op: "control", regionId: "Beirut", fromCode: "Lebanon", toCode: "lebanese democratic republic" }] } }]), []);
  assert.deepEqual(landlessFoundings([ousted, { impacts: { regionTransfers: [{ regionId: "country: Lebanon", fromCode: "Lebanon", toCode: "Lebanese Democratic Republic" }] } }]), []);
  // Fighting for a region is not holding it.
  assert.equal(landlessFoundings([{ impacts: { ...ousted.impacts, regionControlOps: [{ op: "contest", regionId: "Beirut", fromCode: "Lebanon", toCode: "Lebanese Democratic Republic" }] } }]).length, 1);
  // A rename is the same country, with its land.
  assert.deepEqual(landlessFoundings([{ impacts: { polityChanges: [{ operation: "rename", code: "Lebanon", name: "Lebanese Democratic Republic" }] } }]), []);
  // Named once, however often it is written.
  assert.equal(landlessFoundings([ousted, ousted]).length, 1);
  assert.deepEqual(landlessFoundings([]), []);
});
