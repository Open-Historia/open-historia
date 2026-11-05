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
});

test("punctuation alone still cannot become an id", () => {
  assert.equal(stableAsciiId("— / …"), "");
});
