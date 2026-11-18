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

// A host whose checksum could not be read shared its game all the same, and each guest drew whatever its library held
// under the host's id or name (the review of 2026-11-18, wars 10). No copy is used unchecked.
test("a host that states no checksum has no copy here drawn for it, by id or by name", async () => {
  const asked = [];
  const fingerprintOf = async (id) => { asked.push(id); return ""; };
  assert.deepEqual(await chooseStandInScenario({ scenarios, host: { id: "modern-day", name: "Modern Day" }, fingerprintOf }), { scenario: null, differs: false, unchecked: true });
  assert.deepEqual(asked, [], "nothing to check a copy by");
});

test("a checksum that cannot be read counts as no match, never as a match", async () => {
  const chosen = await chooseStandInScenario({ scenarios, host: { id: "modern-day", name: "Modern Day", hash: HOST_MAP }, fingerprintOf: async () => { throw new Error("offline"); } });
  assert.deepEqual(chosen, { scenario: null, differs: true });
});

// A stand-in says what it is by its record, never by its name: the old copies named "Shared game: ..." were found by
// matching those English words, which decides nothing (the review of 2026-11-18, door 8). A copy a guest kept from
// before stand-ins said so is an ordinary game of theirs.
test("no stand-in, old or new, is found by its name", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of ["./sharedGame.js", "../ui/LobbiesTab.jsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.replace\(\/\^\(\?:shared game/i, file);
    assert.doesNotMatch(source, /\/[^/\n]*shared game[^/\n]*\/[gimsuy]*\.test\(|\.match\(\/[^/\n]*shared game/i, file);
  }
});
