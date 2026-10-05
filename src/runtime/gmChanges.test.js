/*! Open Historia — GM changes and reminders tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/gmChanges.test.js
//
// Runs without node_modules: gmChanges.js imports nothing.
//
// The invariants: a change made outside the simulation reaches the next skip
// once — the skip that starts from the round it was made in — and a reminder
// reaches every prompt for as long as it stands, in its newest wording, with its
// withdrawal told as a change of its own.

import test from "node:test";
import assert from "node:assert/strict";

import {
  GM_CHANGES_LIMIT,
  REMINDERS_LIMIT,
  addReminder,
  editReminder,
  gmChangesForRound,
  gmChangesSince,
  normalizeGmChange,
  normalizeGmChanges,
  normalizeReminders,
  recordGmChange,
  removeReminder,
  renderGmChangeNarration,
  renderReminders,
} from "./gmChanges.js";

const at = (minute) => `2026-09-17T12:${String(minute).padStart(2, "0")}:00.000Z`;

test("a change is recorded with the round it was made in, newest first", () => {
  let world = {};
  world = recordGmChange(world, { kind: "territory", summary: "Annexed Crimea to the Russian Federation.", round: 4, date: "2014-03-18", at: at(1) });
  world = recordGmChange(world, { kind: "stats", summary: "Set Ukraine's stability to 35.", round: 4, date: "2014-03-18", at: at(2) });
  assert.deepEqual(world.gmChanges.map((entry) => entry.kind), ["stats", "territory"]);
  assert.equal(world.gmChanges[0].round, 4);
  assert.match(world.gmChanges[1].id, /^gm-change-/);
});

test("the next skip hears the changes of the round it starts from, in the order they were made", () => {
  let world = {};
  world = recordGmChange(world, { kind: "feature", summary: "Placed an airfield at Kerch.", round: 3, at: at(1) });
  world = recordGmChange(world, { kind: "territory", summary: "Annexed Crimea to the Russian Federation.", round: 4, at: at(2) });
  world = recordGmChange(world, { kind: "stats", summary: "Set Ukraine's stability to 35.", round: 4, at: at(3) });
  assert.deepEqual(gmChangesForRound(world, 4).map((entry) => entry.summary), [
    "Annexed Crimea to the Russian Federation.",
    "Set Ukraine's stability to 35.",
  ]);
  assert.deepEqual(gmChangesForRound(world, 5), [], "after the skip the round has moved on: told once");
  assert.equal(gmChangesForRound(world, 3).length, 1, "a rollback to round 3 would be told the airfield again");
});

test("the same change saved twice in a row is one change", () => {
  let world = {};
  world = recordGmChange(world, { kind: "stats", summary: "Set Ukraine's stability to 35.", round: 4, at: at(1) });
  world = recordGmChange(world, { kind: "stats", summary: "Set Ukraine's stability to 35.", round: 4, at: at(2) });
  assert.equal(world.gmChanges.length, 1);
  world = recordGmChange(world, { kind: "stats", summary: "Set Ukraine's stability to 35.", round: 5, at: at(3) });
  assert.equal(world.gmChanges.length, 2, "the same edit in a later round is a new change");
});

test("a border redrawn region by region is one line that gathers the regions", () => {
  let world = {};
  const step = (item, minute, extra = {}) => {
    world = recordGmChange(world, { kind: "territory", group: "regions→Russian Federation", template: "Moved {items} to the Russian Federation by hand.", item, round: 4, at: at(minute), ...extra });
  };
  step("Crimea", 1);
  step("Sevastopol", 2);
  step("Crimea", 3);
  assert.equal(world.gmChanges.length, 1);
  assert.equal(world.gmChanges[0].summary, "Moved Crimea, Sevastopol to the Russian Federation by hand.");
  const id = world.gmChanges[0].id;
  for (let index = 0; index < 10; index += 1) step(`Region ${index}`, 4 + index);
  assert.equal(world.gmChanges[0].id, id, "the line keeps its identity as it grows");
  assert.match(world.gmChanges[0].summary, /Crimea, Sevastopol, Region 0, .* and 4 more to the Russian Federation/);
  step("Kherson", 30, { round: 5 });
  assert.equal(world.gmChanges.length, 2, "a new round starts a new line");
  world = recordGmChange(world, { kind: "stats", summary: "Set Ukraine's stability to 35.", round: 5, at: at(31) });
  step("Zaporizhzhia", 32, { round: 5 });
  assert.equal(world.gmChanges.length, 4, "a step after something else starts a new line too");
  assert.deepEqual(normalizeGmChanges(JSON.parse(JSON.stringify(world.gmChanges))), world.gmChanges, "survives a save");
});

test("the narration says what changed and how to treat it, and nothing when nothing did", () => {
  const block = renderGmChangeNarration([
    { kind: "territory", summary: "Annexed Crimea to the Russian Federation.", round: 4, at: at(1) },
    { kind: "other", summary: "Something else.", round: 4, at: at(2) },
  ]);
  assert.match(block, /^\[CHANGES MADE OUTSIDE THE SIMULATION SINCE YOUR LAST TURN\]/);
  assert.match(block, /do not undo or contradict them/);
  assert.match(block, /- Annexed Crimea to the Russian Federation\. \(territory\)/);
  assert.match(block, /- Something else\.$/m, "no label for the catch-all kind");
  assert.equal(renderGmChangeNarration([]), "");
});

test("a hand edit of the puppet ledger is its own kind of change", () => {
  const world = recordGmChange({}, { kind: "puppets", summary: "Released Poland from being USSR's puppet state by hand.", round: 4, at: at(1) });
  assert.equal(world.gmChanges[0].kind, "puppets");
  assert.match(renderGmChangeNarration(world.gmChanges), /- Released Poland from being USSR's puppet state by hand\. \(puppet states\)/);
});

test("a busy round lists its newest changes and counts the rest", () => {
  const many = Array.from({ length: 15 }, (_unused, index) => ({ kind: "feature", summary: `Change ${index + 1}.`, round: 2, at: at(index) }));
  const block = renderGmChangeNarration(many, { max: 12 });
  assert.match(block, /\(3 earlier changes this round not listed\.\)/);
  assert.doesNotMatch(block, /Change 3\./);
  assert.match(block, /Change 15\./);
});

test("the log is bounded, and an entry without an id gets the same one on every read", () => {
  const bare = { kind: "timeline", summary: "Deleted the event 'Riots in Odesa'.", round: 2, at: at(5) };
  assert.equal(normalizeGmChange(bare).id, normalizeGmChange({ ...bare }).id);
  const long = Array.from({ length: GM_CHANGES_LIMIT + 10 }, (_unused, index) => ({ kind: "feature", summary: `Change ${index}.`, round: 1, at: at(index % 60) }));
  assert.equal(normalizeGmChanges(long).length, GM_CHANGES_LIMIT);
  assert.equal(normalizeGmChange({ kind: "feature", summary: "   " }), null, "a change that says nothing is not recorded");
  assert.equal(normalizeGmChange({ kind: "nonsense", summary: "x" }).kind, "other");
});

test("a conversation catches up on the changes made since its last message", () => {
  let world = {};
  world = recordGmChange(world, { kind: "stats", summary: "Before.", round: 1, at: at(1) });
  world = recordGmChange(world, { kind: "stats", summary: "After one.", round: 1, at: at(5) });
  world = recordGmChange(world, { kind: "territory", summary: "After two.", round: 2, at: at(9) });
  assert.deepEqual(gmChangesSince(world, at(3)).map((entry) => entry.summary), ["After one.", "After two."]);
  assert.deepEqual(gmChangesSince(world, ""), [], "no cursor, no catch-up: a fresh conversation reads the present");
});

test("a reminder stands in every prompt, in its newest wording, until it is withdrawn", () => {
  let world = {};
  world = addReminder(world, { text: "The Kerch bridge is destroyed and cannot be crossed.", round: 4, date: "2014-03-18", at: at(1) });
  world = addReminder(world, { text: "The harvest has failed across the south.", round: 4, date: "2014-03-18", at: at(2) });
  const [bridge] = world.simulationReminders;
  let block = renderReminders(world.simulationReminders, { formatDate: (value) => `on ${value}` });
  assert.match(block, /^\[REMINDERS FROM THE GAME MASTER\]/);
  assert.match(block, /- The Kerch bridge is destroyed and cannot be crossed\. \(since on 2014-03-18\)/);

  world = editReminder(world, bridge.id, "The Kerch bridge is being repaired; it reopens in June.");
  block = renderReminders(world.simulationReminders);
  assert.match(block, /being repaired/);
  assert.doesNotMatch(block, /cannot be crossed/);
  assert.equal(world.simulationReminders[0].id, bridge.id, "an edit keeps the reminder's id");

  world = removeReminder(world, bridge.id, { round: 5, date: "2014-04-18", at: at(9) });
  assert.equal(world.simulationReminders.length, 1);
  assert.doesNotMatch(renderReminders(world.simulationReminders), /Kerch/);
  const [withdrawn] = gmChangesForRound(world, 5);
  assert.equal(withdrawn.kind, "reminder");
  assert.match(withdrawn.summary, /Withdrew the reminder "The Kerch bridge is being repaired/);
  assert.equal(renderReminders([]), "");
});

test("reminders are bounded, keep their line breaks, and refuse an empty one", () => {
  const many = Array.from({ length: REMINDERS_LIMIT + 3 }, (_unused, index) => ({ id: `r${index}`, text: `Reminder ${index}.` }));
  const kept = normalizeReminders(many);
  assert.equal(kept.length, REMINDERS_LIMIT);
  assert.equal(kept.at(-1).text, `Reminder ${REMINDERS_LIMIT + 2}.`, "the newest are kept");
  const [multi] = normalizeReminders([{ id: "m", text: "Two facts:\n\n\n- the bridge is down\n- the port is mined   " }]);
  assert.equal(multi.text, "Two facts:\n\n- the bridge is down\n- the port is mined");
  assert.match(renderReminders([multi]), /- Two facts:\n\n {2}- the bridge is down\n {2}- the port is mined/);
  assert.equal(addReminder({}, { text: "   " }).simulationReminders, undefined, "nothing to add");
  assert.deepEqual(removeReminder({ simulationReminders: [] }, "missing"), { simulationReminders: [] });
});
