/*! Open Historia — opening a Council that already stands writes nothing © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/runtime/institutionalChannels.commit.test.js
//
// Needs a full install: gameState.js -> assets.js -> maplibre-gl.
//
// ensureInstitutionalChannel runs every time a Council is opened and before
// every debate or vote round. It used to commit all six canonical documents
// each time, even when the channel was already there exactly as it stands.
// Served from an in-memory store the way the local server answers the page.

import test from "node:test";
import assert from "node:assert/strict";
import { setRuntimeAssetEndpoints } from "./assets.js";
import { ensureInstitutionalChannel, institutionalChannelUnchanged, materializeInstitutionalChannel } from "./institutionalChannels.js";

const store = new Map();
let commits = 0;
globalThis.fetch = async (url, init = {}) => {
  const method = String(init.method || "GET").toUpperCase();
  if (String(url).includes("/api/runtime/turn-commit") && method === "PUT") {
    commits += 1;
    const payload = JSON.parse(String(init.body));
    for (const key of ["actions", "chat", "events", "game", "colors", "world"]) store.set(key, JSON.stringify(payload[key]));
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const match = /\/api\/runtime\/json\/(\w+)/.exec(String(url));
  if (!match) return new Response("not found", { status: 404 });
  if (!store.has(match[1])) return new Response("missing", { status: 404 });
  return new Response(store.get(match[1]), { status: 200, headers: { "Content-Type": "application/json" } });
};

const makeWorld = () => ({
  polityOverrides: {
    A: { code: "A", name: "Player Republic", status: "active", aliases: [] },
    B: { code: "B", name: "B Republic", status: "active", aliases: [] },
  },
  institutions: {
    schemaVersion: 1,
    ledgerVersion: 1,
    byId: {
      council: {
        id: "council",
        name: "Continental Council",
        status: "active",
        members: [
          { polity: "A", status: "member", role: "member" },
          { polity: "B", status: "member", role: "member" },
        ],
      },
    },
  },
});

test("the first opening creates the Council in one commit; opening it again commits nothing", async () => {
  setRuntimeAssetEndpoints({ token: "council-open-once" });
  store.clear();
  store.set("world", JSON.stringify(makeWorld()));
  store.set("chat", "[]");
  store.set("game", JSON.stringify({ country: "A", gameDate: "2000-01-02" }));
  commits = 0;

  const first = await ensureInstitutionalChannel({ institutionId: "council", playerCountry: "A", date: "2000-01-02" });
  assert.equal(commits, 1);
  assert.equal(first.channel.id, "institution-channel-council");

  const again = await ensureInstitutionalChannel({ institutionId: "council", playerCountry: "A", date: "2000-01-03" });
  assert.equal(commits, 1, "nothing changed, so nothing was written");
  assert.equal(again.channel.id, "institution-channel-council");
  assert.ok(again.chats.some((chat) => chat.id === "institution-channel-council"));

  // A roster change is a change: it is written.
  const world = JSON.parse(store.get("world"));
  world.institutions.byId.council.members.push({ polity: "C", status: "member", role: "member" });
  world.polityOverrides.C = { code: "C", name: "C Republic", status: "active", aliases: [] };
  store.set("world", JSON.stringify(world));
  await ensureInstitutionalChannel({ institutionId: "council", playerCountry: "A", date: "2000-01-04" });
  assert.equal(commits, 2);
});

test("unchanged means stored under the bound id with the same roster, status and title", () => {
  const first = materializeInstitutionalChannel({ world: makeWorld(), chats: [], institutionId: "council", playerCountry: "A" });
  assert.equal(institutionalChannelUnchanged({ world: makeWorld(), chats: [] }, first), false, "not stored yet");
  const again = materializeInstitutionalChannel({ world: first.world, chats: first.chats, institutionId: "council", playerCountry: "A" });
  assert.equal(institutionalChannelUnchanged({ world: first.world, chats: first.chats }, again), true);
  const dissolved = structuredClone(first.world);
  dissolved.institutions.byId.council.status = "dissolved";
  const closed = materializeInstitutionalChannel({ world: dissolved, chats: first.chats, institutionId: "council", playerCountry: "A" });
  assert.equal(institutionalChannelUnchanged({ world: dissolved, chats: first.chats }, closed), false, "a closed channel is written");
});
