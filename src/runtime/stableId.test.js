/*! Open Historia — stable non-Latin id regression tests. */
import test from "node:test";
import assert from "node:assert/strict";
import { stableAsciiId } from "./stableId.js";

test("stable ids preserve the legacy ASCII slug contract", () => {
  assert.equal(stableAsciiId("  Baltic & Nordic Union  "), "baltic-nordic-union");
  assert.equal(stableAsciiId("Conseil de l'Europe"), "conseil-de-l-europe");
  assert.equal(stableAsciiId("Café Européen"), "cafe-europeen");
});

test("labels written wholly outside ASCII get deterministic non-empty ASCII ids", () => {
  for (const label of ["Совет Европы", "欧洲联盟", "جامعة الدول العربية", "यूरोपीय परिषद"]) {
    const first = stableAsciiId(label);
    const second = stableAsciiId(label);
    assert.equal(first, second, label);
    assert.match(first, /^u-[a-z0-9]+$/);
  }
  assert.notEqual(stableAsciiId("Совет Европы"), stableAsciiId("Европейский союз"));
  // The ids those labels were always given: a save's institutions keep theirs.
  assert.equal(stableAsciiId("Совет Европы"), "u-aabffe122t");
  assert.equal(stableAsciiId("欧洲联盟"), "u-5nqkqne6kf");
  assert.equal(stableAsciiId("ΕΛΛΆΔΑ"), stableAsciiId("Ελλάδα"));
});

test("a label that mixes another script with ASCII is not cut down to its ASCII", () => {
  // Kept only its ASCII, a treaty of 1997 was "1997", like every other treaty
  // of that year, and "Пётр I" was "i".
  assert.notEqual(stableAsciiId("Договор 1997 года"), "1997");
  assert.notEqual(stableAsciiId("Договор 1997 года"), stableAsciiId("Соглашение 1997 года"));
  assert.notEqual(stableAsciiId("Событие 1"), stableAsciiId("Задача 1"));
  assert.match(stableAsciiId("Пётр I"), /^u-[a-z0-9]+$/);
  // Its English twin keeps the slug it always had.
  assert.equal(stableAsciiId("Treaty of 1997"), "treaty-of-1997");
});

test("punctuation alone still cannot become an id", () => {
  assert.equal(stableAsciiId("— / …"), "");
});
