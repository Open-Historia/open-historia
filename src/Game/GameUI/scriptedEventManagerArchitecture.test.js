import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./ScriptedEventsEditor.jsx", import.meta.url), "utf8");

test("scripted events use a dedicated manager instead of expanding every event inline", () => {
  assert.match(source, /Manage scripted events/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-label="Scripted Events manager"/);
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /setExpandedKey\(expanded \? "" : key\)/);
  assert.match(source, /Search scripted events/);
  assert.match(source, /Sort scripted events/);
  assert.match(source, /Duplicate/);
});

test("scripted event rule authoring exposes no-conditions and independent writable/draggable chance", () => {
  assert.match(source, /value="none">No conditions<\/option>/);
  assert.match(source, /No conditions - this event becomes eligible when its date is reached/);
  assert.match(source, /aria-label="Event chance percent"/);
  assert.match(source, /aria-label="Event chance slider"/);
  assert.match(source, /type="range"/);
  assert.match(source, /No conditions \+ 100% is the old Always behavior/);
});

test("all native select options in the manager retain explicit dark popup colors", () => {
  assert.match(source, /const optionStyle = \{\s*backgroundColor: "#1a1b1f",\s*color: "#f8fafc"/s);
  const selectBlocks = [...source.matchAll(/<select\b[\s\S]*?<\/select>/g)].map((match) => match[0]);
  assert.ok(selectBlocks.length >= 5);
  for (const block of selectBlocks) {
    const optionTags = block.match(/<option\b[^>]*>/g) || [];
    assert.ok(optionTags.length > 0);
    for (const tag of optionTags) assert.match(tag, /style=\{optionStyle\}/);
  }
});
