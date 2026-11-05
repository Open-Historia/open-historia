/*! Open Historia — which chats are the most recently active: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/chatRecency.test.js
//
// A leader whose agent sits in the player's government is shown the player's
// four most recently active other chats (main.jsx buildDiplomaticSystemPrompt).
// It took the last four in the store, which lists chats newest-CREATED first:
// the four oldest, and never an old thread that had just been written to.
// sortDiplomaticChatsByRecentActivity now picks them, by the game date of each
// thread's latest message, compared as a date (a BC date is not a string).
import test from "node:test";
import assert from "node:assert/strict";

import { sortDiplomaticChatsByRecentActivity } from "./promptContext.js";

const chat = (id, name, ...times) => ({
  id,
  title: id,
  countries: [{ code: name.slice(0, 3).toUpperCase(), name }],
  messages: times.map((time, index) => ({ id: `${id}-${index}`, role: "user", speaker: "Player", text: `${id} ${index}`, time })),
});

const ids = (chats) => chats.map((entry) => entry.id);

test("the most recently active chats come first, wherever they sit in the store", () => {
  const stored = [
    chat("newest-created", "Portugal", "1915-01-01"),
    chat("middle", "Spain", "1914-09-01"),
    chat("undated", "Italy", ""),
    chat("oldest-created", "Germany", "1914-01-01", "1915-06-01"),
  ];
  assert.deepEqual(ids(sortDiplomaticChatsByRecentActivity(stored)), ["oldest-created", "newest-created", "middle", "undated"]);
});

test("BC dates are ordered by the calendar", () => {
  const stored = [
    chat("carthage", "Carthage", "-0219-05-01"),
    chat("syracuse", "Syracuse", "-0218-03-01"),
    chat("rome", "Rome", "-1000-01-01"),
  ];
  assert.deepEqual(ids(sortDiplomaticChatsByRecentActivity(stored)), ["syracuse", "carthage", "rome"]);
});

test("a tie keeps the store's order", () => {
  const stored = [chat("b", "Spain", "1915-01-01"), chat("a", "Italy", "1915-01-01")];
  assert.deepEqual(ids(sortDiplomaticChatsByRecentActivity(stored)), ["b", "a"]);
});
