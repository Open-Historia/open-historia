/*! Open Historia — ids that tell nothing but themselves: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/blindIds.test.js
//
// The follow-ups of 2026-11-18, C7: the host's ids were its clock and one
// counter for everything it made, so two of a player's own told it how much
// every other player had done between them. And the documents and threads the
// game makes in a round carried the same.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { blindFraction, blindId, blindToken } from "./blindIds.js";
import { applyReportOps } from "./reports.js";
import { createPlayerPollEvent } from "./chatThreads.js";

test("an id is its kind and random hex, unique, and holds no clock or count", () => {
  const made = Array.from({ length: 5000 }, () => blindId("order"));
  assert.ok(made.every((id) => /^order-[0-9a-f]{16}$/.test(id)));
  assert.equal(new Set(made).size, made.length);
  assert.match(blindToken(), /^[0-9a-f]{16}$/);
  assert.match(blindId(""), /^[0-9a-f]{16}$/);
  const fractions = Array.from({ length: 1000 }, blindFraction);
  assert.ok(fractions.every((value) => value >= 0 && value < 1));
  assert.ok(new Set(fractions).size > 990);
});

test("the game's own id makers for what others read are the blind one: the host's, documents' and threads'", () => {
  const host = fs.readFileSync(new URL("../multiplayer/host/gameHost.js", import.meta.url), "utf8");
  assert.match(host, /const mintId = \(prefix\) => blindId\(prefix\);/);
  assert.match(host, /const mintEpoch = \(\) => blindToken\(\);/);
  assert.doesNotMatch(host, /sequence \+= 1/, "no counter of everything the host made");
  for (const file of ["./reports.js", "./chatThreads.js"]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /const mintId = \(prefix\) => blindId\(prefix\);/, file);
    assert.doesNotMatch(source, /Date\.now\(\)\.toString\(36\)}-\$\{sequence/, file);
  }
  // As they come out.
  const poll = createPlayerPollEvent({ player: "Ruritania", question: "Peace?", options: ["Yes", "No"], time: "2014-04-01" });
  assert.match(poll.pollId, /^poll-[0-9a-f]{16}$/);
  assert.match(poll.id, /^pollev-[0-9a-f]{16}$/);
  const { created } = applyReportOps([], [
    { op: "create", title: "A secret pact", body: "Signed at night.", visibleTo: ["Ruritania"] },
    { op: "create", title: "A second", body: "Also signed.", visibleTo: ["Ruritania"] },
  ]);
  assert.equal(created.length, 2);
  for (const entry of created) assert.match(entry.report.id, /^report-[0-9a-f]{16}$/);
});
