/*! Open Historia — the Workshop's tool hints: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/toolHints.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { toolHint } from "./toolHints.js";

// The tool ids the Toolbar shows, read from its source so a 14th tool cannot be
// added without a hint.
const toolbarIds = [...readFileSync(new URL("./Toolbar.jsx", import.meta.url), "utf8").matchAll(/\{ id: "([\w-]+)", icon:/g)].map((m) => m[1]);

test("the Toolbar has 13 tools and every one has a name and a sentence", () => {
  assert.equal(toolbarIds.length, 13);
  for (const id of toolbarIds) {
    const hint = toolHint(id);
    assert.ok(hint && hint.name && hint.text, `no hint for "${id}"`);
    assert.ok(hint.text.length > 15, `"${id}" hint is too short to explain anything`);
  }
});

test("an unknown tool has no hint", () => {
  assert.equal(toolHint("nope"), null);
});

test("modify and border say how many regions they act on", () => {
  assert.match(toolHint("modify", 0).text, /no selection/);
  assert.match(toolHint("modify", 3).text, /3 selected regions/);
  assert.match(toolHint("modify", 1).text, /1 selected region\b/);
  assert.equal(toolHint("border", 2).warn, false);
  assert.equal(toolHint("border", 1).warn, true);
  assert.match(toolHint("border", 1).text, /exactly 2/);
});
