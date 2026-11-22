/*! Open Historia — the game never reads its own words back: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/ownWordsNotRead.test.js
//
// A screen that decided what to show by matching an English sentence the game
// had written elsewhere broke the day that sentence changed, and in every
// language a pack translated it into. Each now says what it is by a flag or a
// status, where it is written. The screens are JSX that node cannot import, so
// their wiring is read as source.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { normalizeWarRecord } from "../../runtime/warRecord.js";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("an institution's opening line is shown as written, never matched and reworded", () => {
  const chat = read("./chat.jsx");
  const record = chat.slice(chat.indexOf("const InstitutionRecord = "), chat.indexOf("// `label`: \"Thinking\""));
  assert.ok(record.length > 0);
  assert.doesNotMatch(record, /channel established|\.test\(raw\)|\.replace\(/);
  assert.match(read("../../runtime/institutionalChannels.js"), /institutionalSystemMessage\(`\$\{institution\.name\} council opened\.`, date\)/);
});

test("the institution editor's note is good news by its flag, not by its words", () => {
  const panel = read("./InstitutionAuthoringPanel.jsx");
  assert.doesNotMatch(panel, /saved\|deleted from/);
  assert.match(panel, /say\("Institution saved to scenario canon\.", true\);/);
  assert.match(panel, /background: messageOk \? /);
});

test("a war's cause is shown as its record keeps it; the engine's old bookkeeping note is cleared where the record is read", () => {
  assert.doesNotMatch(read("./stats.jsx"), /native bootstrap/i);
  const sides = { sideA: ["Borduria"], sideB: ["Syldavia"] };
  assert.equal(normalizeWarRecord({ ...sides, cause: "Native bootstrap from hard-combat event: Battle of Klow" }).cause, "");
  // Any cause the story gave is kept, in any language.
  assert.equal(normalizeWarRecord({ ...sides, cause: "Border dispute over Klow" }).cause, "Border dispute over Klow");
  assert.equal(normalizeWarRecord({ ...sides, cause: "Différend frontalier autour de Klow" }).cause, "Différend frontalier autour de Klow");
});
