/*! Open Historia — what a scenario's detailed maps offer to download: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/detailedMapOffers.test.js
//
// A scenario may name several detailed maps (docs/adr/0007). Installing it from
// the hub and a game's Settings → Map both offer the ones this device lacks.
// What has to hold:
//   - a map this device has offers nothing, unless the list has a newer version
//     (always in Settings; at install only one the scenario needs);
//   - a map named by checksum, or one the official list no longer has, cannot
//     be downloaded and is not offered;
//   - Settings says in one line what there is to download.

import test from "node:test";
import assert from "node:assert/strict";

import { detailedMapOffers, detailedMapsDownloadLine } from "./detailedMapOffers.js";

const official = (id, versions) => ({ id, name: id, versions: versions.map((version) => ({ version, bytes: version * 1000 })) });
const map = (pick, detailed, starting = false) => ({ pick, kind: "detailed", name: pick, starting, detailed });

test("a map this device lacks is offered at the newest version, with its size", () => {
  const [offer] = detailedMapOffers([{ map: map("", { id: "relief", version: 1 }, true), installed: null, official: official("relief", [1, 2]) }]);
  assert.deepEqual(offer, { id: "relief", name: "relief", version: 2, bytes: 2000, pick: "", starting: true });
});

test("an update is offered in Settings, and at install only when the scenario needs it", () => {
  const lookups = [
    { map: map("own:a", { id: "a", version: 1 }), installed: { official: { id: "a", version: 1 } }, official: official("a", [1, 2]) },
    { map: map("own:b", { id: "b", version: 3 }), installed: { official: { id: "b", version: 2 } }, official: official("b", [2, 3]) },
  ];
  assert.deepEqual(detailedMapOffers(lookups, { optionalUpdates: true }).map((offer) => offer.pick), ["own:a", "own:b"]);
  assert.deepEqual(detailedMapOffers(lookups).map((offer) => offer.pick), ["own:b"]);
});

test("a map that cannot be downloaded is not offered", () => {
  const lookups = [
    { map: map("own:mine", { hash: "a".repeat(64) }), installed: null, official: null },
    { map: map("own:gone", { id: "gone", version: 1 }), installed: null, official: null },
    { map: map("own:have", { id: "have", version: 1 }), installed: { official: { id: "have", version: 1 } }, official: official("have", [1]) },
  ];
  assert.deepEqual(detailedMapOffers(lookups, { optionalUpdates: true }), []);
});

test("Settings says what there is to download in one line, and nothing when there is nothing", () => {
  const missing = { id: "a", version: 1, bytes: 1 };
  const update = { ...missing, have: 1 };
  assert.equal(detailedMapsDownloadLine([]), "");
  assert.equal(detailedMapsDownloadLine([missing]), "1 of this scenario's detailed maps isn't on this device.");
  assert.equal(detailedMapsDownloadLine([missing, missing]), "2 of this scenario's detailed maps aren't on this device.");
  assert.equal(detailedMapsDownloadLine([update]), "1 of this scenario's detailed maps has a newer version.");
  assert.equal(detailedMapsDownloadLine([missing, update, update]), "1 of this scenario's detailed maps isn't on this device, and 2 have a newer version.");
});
