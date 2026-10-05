/*! Open Historia — direct whole-document write ratchet © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/directWriteRatchet.test.js
//
// A whole-document write saves a copy of world.json (or the chats, the events,
// the orders...) that its writer read some time before. If anything changed the
// document in between (the player deployed a unit while a model call was out,
// a note landed while the player typed), the older copy wins and the change is
// gone. Multiplayer makes that the normal case, with every seat writing at once.
//
// The cure is a read-modify-write inside the one write queue: gameState.js
// mutateWorldState and its siblings for one document, mutateCanonicalTurnState
// for several at once, and later an intent the engine applies. This test counts
// what is left of the old kind, file by file and kind by kind, and only lets the
// numbers go down. A new direct write fails it; so does removing one without
// lowering its allowance below, which is how the ratchet keeps the ground won.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A call that saves a whole runtime document, or the turn's canonical commit.
const DIRECT_WRITE = /\b(writeWorldState|writeGameData|writeActionsState|writeEventsState|writeChatsState|writeInterceptsState|writeCanonicalTurnState)\s*\(|\bwriteJson\s*\(\s*JSON_URLS\.(\w+)/g;

// What may still write directly, and why. Lower a number when a write goes;
// never raise one for a write of our own.
//
// Raised once, when public alpha f4f21604 was merged (2026-10-05), for the
// direct writes its new features brought with them. Each is marked "alpha";
// step 2 turns the panel ones into intents like the rest.
const ALLOWED = {
  // The seam itself: the write helpers' own bodies, and the queue's entries.
  "runtime/gameState.js": {
    "writeActionsState": 1, "writeEventsState": 1, "writeGameData": 1, "writeInterceptsState": 1,
    // alpha: mergeChatKnowledgeCursors reads and writes inside the queue itself.
    "writeWorldState": 2, "writeJson(actions)": 1, "writeJson(advisor)": 1, "writeJson(chat)": 2,
    "writeJson(events)": 1, "writeJson(game)": 1, "writeJson(intercepts)": 1, "writeJson(world)": 1,
  },
  // The turn's commit and the rollback's restore replace the canonical state on
  // purpose, under the busy lock (the jump re-reads the chats); the rollback
  // archive is written only by those two; flags are presentation data a rename
  // or the GM changes beside the commit.
  // alpha: a rollback puts back the flags an undone rename moved (a fourth).
  "Game/AI/gameplay.js": {
    "writeCanonicalTurnState": 2, "writeJson(snapshots)": 2, "writeJson(flags)": 4,
  },
  // The player's own panels. Phase 0 step 2 turns these into intents.
  // alpha: annexing by hand goes through annexByHand (one more world write).
  "Game/GameUI/cheats.jsx": {
    "writeWorldState": 18, "writeGameData": 2, "writeEventsState": 1, "writeJson(actions)": 1,
    "writeJson(chat)": 1, "writeJson(citiesGeojson)": 1, "writeJson(colors)": 3, "writeJson(events)": 1,
    "writeJson(game)": 1, "writeJson(regionsGeojson)": 1, "writeJson(snapshots)": 1, "writeJson(world)": 1,
  },
  // alpha: an order whose unit could not be saved is taken back out of the queue.
  "Game/Map/unitsController.js": { "writeWorldState": 3, "writeActionsState": 2 },
  "Game/GameUI/advisor.jsx": { "writeActionsState": 1, "writeWorldState": 1, "writeJson(advisor)": 1 },
  "Game/GameUI/chat.jsx": { "writeChatsState": 1, "writeWorldState": 1 },
  "Game/GameUI/stats.jsx": { "writeWorldState": 3 },
  "Game/GameUI/actions.jsx": { "writeActionsState": 1, "writeWorldState": 1 },
  "Game/GameUI/projects.jsx": { "writeWorldState": 1 },
  // alpha: starting a game as a group gives it its colour and flag, as a faction's does.
  "Game/GameUI/libraryBar.jsx": { "writeJson(colors)": 2, "writeJson(flags)": 2 },
  "runtime/polityFlags.js": { "writeJson(flags)": 1 },
};

// Comments name these functions all the time; only code counts. Line by line on
// purpose: a "/api/*" inside a comment or a string would open a block comment
// for a stripper that looked for /* ... */ and swallow the code after it.
const withoutComments = (source) => source
  .split(/\r?\n/)
  .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
  .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
  .join("\n");

const sourceFiles = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(?:[cm]?js|jsx)$/.test(entry.name) && !/\.test\.[cm]?jsx?$/.test(entry.name)) out.push(full);
  }
  return out;
};

const countDirectWrites = () => {
  const found = {};
  for (const file of sourceFiles(SRC)) {
    const counts = {};
    for (const match of withoutComments(fs.readFileSync(file, "utf8")).matchAll(DIRECT_WRITE)) {
      const kind = match[1] || `writeJson(${match[2]})`;
      counts[kind] = (counts[kind] || 0) + 1;
    }
    if (Object.keys(counts).length) found[path.relative(SRC, file).split(path.sep).join("/")] = counts;
  }
  return found;
};

test("direct whole-document writes only ever go down", () => {
  const found = countDirectWrites();
  const problems = [];
  for (const [file, counts] of Object.entries(found)) {
    for (const [kind, count] of Object.entries(counts)) {
      const allowed = ALLOWED[file]?.[kind] ?? 0;
      if (count > allowed) {
        problems.push(`${file}: ${count} × ${kind}, allowed ${allowed}. Read and write inside the queue instead (gameState.js mutateWorldState & co., or mutateCanonicalTurnState).`);
      }
    }
  }
  for (const [file, kinds] of Object.entries(ALLOWED)) {
    for (const [kind, allowed] of Object.entries(kinds)) {
      const count = found[file]?.[kind] ?? 0;
      if (count < allowed) {
        problems.push(`${file}: ${count} × ${kind}, allowance still ${allowed}. Lower it to ${count} so the write cannot come back.`);
      }
    }
  }
  assert.deepEqual(problems, [], `\n${problems.join("\n")}\n\nFound now: ${JSON.stringify(found, null, 2)}`);
});

test("the engine's background writers go through the queue", () => {
  const gameplay = withoutComments(fs.readFileSync(path.join(SRC, "Game/AI/gameplay.js"), "utf8"));
  // The single-document helpers are gone from the engine entirely; what is left
  // of its writes is listed above.
  for (const name of ["writeWorldState", "writeChatsState", "writeEventsState", "writeActionsState", "writeGameData", "writeInterceptsState"]) {
    assert.doesNotMatch(gameplay, new RegExp(`\\b${name}\\b`), `gameplay.js must not use ${name}; mutate the document instead`);
  }
  // The stats worker PUTs world.json itself; the page holds the queue for it.
  const persist = gameplay.slice(
    gameplay.indexOf("const persistCountryStatsBackground"),
    gameplay.indexOf("const createUiBudget"),
  );
  assert.match(persist, /runInCanonicalWriteQueue\(/, "the worker's world PUT must run inside the page's write queue");
  assert.match(persist, /COUNTRY_STATS_PERSIST_TIMEOUT_MS/, "a stalled worker must not hold the queue forever");
});
