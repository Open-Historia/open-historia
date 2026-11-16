/*! Open Historia — which of a guest's scenarios a shared game is drawn on: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/standIn.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { chooseStandInScenario } from "./standIn.js";

const HOST_MAP = "a".repeat(64);
const scenarios = [
  { id: "europe-1936", name: "Europe 1936" },
  { id: "europe-1936-copy", name: "Europe 1936 (host's)" },
  { id: "modern-day", name: "Modern Day" },
];

test("the copy whose map is the host's is used, whatever it is called here", async () => {
  const fingerprints = { "europe-1936": "b".repeat(64), "europe-1936-copy": HOST_MAP, "modern-day": "c".repeat(64) };
  const chosen = await chooseStandInScenario({ scenarios, host: { id: "europe-1936", name: "Europe 1936", hash: HOST_MAP }, fingerprintOf: async (id) => fingerprints[id] });
  assert.equal(chosen.scenario.id, "europe-1936-copy", "the guest's own Europe 1936 is an older map; the copy the host sent is the host's");
});

test("the host's scenario by id or name with another map is said to differ; none at all is missing", async () => {
  const fingerprintOf = async () => "b".repeat(64);
  const differs = await chooseStandInScenario({ scenarios, host: { id: "europe-1936", name: "Europe 1936", hash: HOST_MAP }, fingerprintOf });
  assert.deepEqual(differs, { scenario: null, differs: true });
  const missing = await chooseStandInScenario({ scenarios, host: { id: "atlantis", name: "Atlantis", hash: HOST_MAP }, fingerprintOf });
  assert.deepEqual(missing, { scenario: null, differs: false });
});

test("a host that states no checksum is matched by id, then by its one scenario of that name, as before", async () => {
  const asked = [];
  const fingerprintOf = async (id) => { asked.push(id); return ""; };
  assert.equal((await chooseStandInScenario({ scenarios, host: { id: "modern-day", name: "x" }, fingerprintOf })).scenario.id, "modern-day");
  assert.equal((await chooseStandInScenario({ scenarios, host: { id: "gone", name: "europe 1936" }, fingerprintOf })).scenario.id, "europe-1936");
  assert.equal((await chooseStandInScenario({ scenarios: [...scenarios, { id: "e2", name: "Europe 1936" }], host: { id: "gone", name: "Europe 1936" }, fingerprintOf })).scenario, null, "two of that name: neither");
  assert.deepEqual(asked, [], "no checksum asked for");
});

test("a checksum that cannot be read counts as no match, never as a match", async () => {
  const chosen = await chooseStandInScenario({ scenarios, host: { id: "modern-day", name: "Modern Day", hash: HOST_MAP }, fingerprintOf: async () => { throw new Error("offline"); } });
  assert.deepEqual(chosen, { scenario: null, differs: true });
});
