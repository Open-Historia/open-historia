/*! Open Historia — Listen in: where the feeds are kept: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/listenInStore.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { addListenInBatch, createListenInBatch, emptyListenInStore } from "./listenIn.js";
import { LISTEN_IN_GAMES_KEPT, createListenInStorage } from "./listenInStore.js";
import { installFakeIndexedDb } from "./web/fakeIndexedDb.js";

const bavaria = { regionId: "DEU.2_1", regionName: "Bayern", polity: "Germany", polityKey: "Germany" };
const batch = (text, now) => createListenInBatch({ posts: [{ author: "Maria", text }], gameDate: "2016-01-04", language: "en", now });
const withBatch = (text, now) => (store) => addListenInBatch(store, bavaria, batch(text, now), { now });

test("a feed written in one session is there in the next", async () => {
  const fake = installFakeIndexedDb();
  const first = createListenInStorage({ now: () => 100 });
  assert.deepEqual(await first.read("game-1"), emptyListenInStore());
  await first.update("game-1", withBatch("Snow again.", 1));
  assert.equal(fake.rows("oh-listen-in", "games").get("game-1").updatedAt, 100);

  // A new page: nothing in memory, the store read back from the device.
  const second = createListenInStorage();
  const read = await second.read("game-1");
  assert.equal(read.places["region:DEU.2_1"].batches[0].posts[0].text, "Snow again.");
  // Another game's feeds are its own.
  assert.deepEqual(await second.read("game-2"), emptyListenInStore());
  assert.deepEqual(await second.read(""), emptyListenInStore());
});

test("two feeds that come back together are both kept", async () => {
  installFakeIndexedDb();
  const storage = createListenInStorage();
  const other = { polity: "Germany", polityKey: "Germany" };
  await Promise.all([
    storage.update("game-1", withBatch("From the region.", 1)),
    storage.update("game-1", (store) => addListenInBatch(store, other, batch("From the country.", 2), { now: 2 })),
  ]);
  const read = await createListenInStorage().read("game-1");
  assert.deepEqual(Object.keys(read.places).sort(), ["country:germany", "region:DEU.2_1"]);
});

test("without IndexedDB the session still keeps what it read", async () => {
  const storage = createListenInStorage({ idb: () => null });
  await storage.update("game-1", withBatch("Kept in memory.", 1));
  assert.equal((await storage.read("game-1")).places["region:DEU.2_1"].batches[0].posts[0].text, "Kept in memory.");
  // Nothing was stored: a new session starts empty.
  assert.deepEqual(await createListenInStorage({ idb: () => null }).read("game-1"), emptyListenInStore());
});

test("only the games read last keep their feeds", async () => {
  const fake = installFakeIndexedDb();
  let clock = 0;
  const storage = createListenInStorage({ now: () => (clock += 1) });
  for (let index = 0; index < LISTEN_IN_GAMES_KEPT + 3; index += 1) {
    await storage.update(`game-${index}`, withBatch(`Game ${index}.`, index));
  }
  const kept = [...fake.rows("oh-listen-in", "games").keys()];
  assert.equal(kept.length, LISTEN_IN_GAMES_KEPT);
  assert.ok(!kept.includes("game-0"));
  assert.ok(kept.includes(`game-${LISTEN_IN_GAMES_KEPT + 2}`));
});
