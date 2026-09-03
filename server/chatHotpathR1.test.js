import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import {
  chatParticipantSetKey,
  mergeIncomingChats,
  reconcileChatsForPlayer,
  reconcileStableChatsForPlayer,
} from "../src/runtime/gameState.js";

const player = "Republic of Latvia";
const actorNames = Array.from(
  { length: 120 },
  (_, index) => `Continuum Test Polity ${String(index + 1).padStart(3, "0")}`,
);

const world = {
  ownerSchemaVersion: 4,
  polityOverrides: Object.fromEntries(
    [player, ...actorNames].map((name) => [
      name,
      {
        name,
        code: name,
        status: "active",
      },
    ]),
  ),
  regionOwnershipOverrides: {},
};

const makeMessage = (actor, i) => ({
  id: `m-${actor}-${i}`,
  polityKey: actor,
  speaker: actor,
  role: "assistant",
  text: `Diplomatic continuity message ${i} from ${actor}.`,
  time: `2019-12-${String((i % 27) + 1).padStart(2, "0")}`,
});

const makeChat = (actor, index, { closed = true } = {}) => ({
  id: `chat-${index}`,
  countries: [{ name: actor, code: actor, polityKey: actor }],
  linkedEventId: "",
  messages: Array.from({ length: 40 }, (_, i) => makeMessage(actor, i)),
  source: "outreach",
  status: closed ? "closed" : "open",
  title: `Talks with ${actor}`,
});

test("stable participant key never needs an external world fixture", () => {
  const chat = makeChat(actorNames[0], 0);
  assert.equal(chatParticipantSetKey(chat, world), actorNames[0].toLowerCase());
});

test("stable and legacy reconciliation remain semantically equivalent on canonical chats", () => {
  const chats = actorNames.slice(0, 24).map((actor, index) =>
    makeChat(actor, index, { closed: index < 18 }),
  );
  const stable = reconcileStableChatsForPlayer(chats, world, player);
  const legacy = reconcileChatsForPlayer(chats, world, player);
  const signature = (rows) => rows.map((chat) => ({
    id: chat.id,
    status: chat.status,
    countries: chat.countries.map((country) => country.polityKey || country.name),
    messageIds: chat.messages.map((message) => message.id),
    messageText: chat.messages.map((message) => message.text),
  }));
  assert.deepEqual(signature(stable), signature(legacy));
});

test("incoming chat merge keeps established thread identity and adds new history", () => {
  const actor = actorNames[0];
  const base = [makeChat(actor, 0, { closed: false })];
  const incoming = [{
    ...makeChat(actor, 999, { closed: false }),
    messages: [makeMessage(actor, 100)],
    title: "Replacement title must not steal identity",
  }];
  const merged = mergeIncomingChats(base, incoming, world, { playerCountry: player });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "chat-0");
  assert.equal(merged[0].title, `Talks with ${actor}`);
  assert.equal(merged[0].messages.at(-1).id, `m-${actor}-100`);
});

test("mature canonical chat archive reconciliation stays bounded", () => {
  const chats = actorNames.slice(0, 100).map((actor, index) =>
    makeChat(actor, index, { closed: index < 90 }),
  );
  const started = performance.now();
  const reconciled = reconcileChatsForPlayer(chats, world, player);
  const elapsed = performance.now() - started;
  assert.equal(reconciled.length, chats.length);
  assert.ok(elapsed < 1500, `chat reconciliation took ${elapsed.toFixed(1)}ms`);
});
