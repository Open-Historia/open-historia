import test from "node:test";
import assert from "node:assert/strict";

const world = () => ({
  countryStats: {
    Albion: { leader: "Current President", government: "republic", stability: 64 },
  },
  politicalActors: {
    schemaVersion: 6,
    byPolity: {
      Albion: {
        polityKey: "Albion",
        government: { form: "republic", headOfState: { name: "Current President" } },
        leader: { name: "Current President" },
      },
    },
  },
});

test("Stats persistence worker saves the actor's mirror over a conflicting one", async () => {
  const originalSelf = globalThis.self;
  const originalFetch = globalThis.fetch;
  const outgoing = [];
  const writes = [];
  globalThis.self = { postMessage: (message) => outgoing.push(message) };
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === "PUT") {
      writes.push(JSON.parse(init.body));
      return { ok: true, text: async () => init.body };
    }
    return { ok: true, json: async () => world() };
  };
  try {
    await import("./countryStatsWorker.js?authority-regression");
    await globalThis.self.onmessage({ data: { id: 101, type: "persist",
      payload: { urls: { world: "/api/state/world" }, code: "Albion",
        sheet: { leader: "Unapproved Replacement", stability: 50 }, date: "2026-01-01" },
    } });
    // The sheet is saved with the actor's leader, not refused: every sheet of a country whose stored leader had
    // drifted from its head of state failed to save (review of beta-stats-v2, 2026-11-03).
    assert.equal(writes.length, 1, "the worker's sheet is saved");
    assert.equal(writes[0].countryStats.Albion.leader, "Current President", "with the actor's leader");
    assert.equal(writes[0].countryStats.Albion.stability, 50, "and the rest of the sheet");
    assert.equal(outgoing.length, 1);
    assert.equal(outgoing[0].error, undefined);
  } finally {
    if (originalSelf === undefined) delete globalThis.self; else globalThis.self = originalSelf;
    globalThis.fetch = originalFetch;
  }
});

test("Stats persistence worker accepts a matching actor mirror and retains its canon", async () => {
  const originalSelf = globalThis.self;
  const originalFetch = globalThis.fetch;
  const outgoing = [];
  const writes = [];
  globalThis.self = { postMessage: (message) => outgoing.push(message) };
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === "PUT") {
      writes.push(JSON.parse(init.body));
      return { ok: true, text: async () => init.body };
    }
    return { ok: true, json: async () => world() };
  };
  try {
    await import("./countryStatsWorker.js?matching-actor-regression");
    await globalThis.self.onmessage({ data: { id: 102, type: "persist",
      payload: { urls: { world: "/api/state/world" }, code: "Albion",
        sheet: { leader: "Current President", government: "republic", stability: 50 },
        date: "2026-01-01" },
    } });
    assert.equal(writes.length, 1);
    assert.equal(outgoing[0].error, undefined);
    assert.equal(writes[0].countryStats.Albion.leader, "Current President");
    assert.equal(writes[0].countryStats.Albion.government, "republic");
    assert.equal(writes[0].countryStats.Albion.stability, 50);
  } finally {
    if (originalSelf === undefined) delete globalThis.self; else globalThis.self = originalSelf;
    globalThis.fetch = originalFetch;
  }
});
