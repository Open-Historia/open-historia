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
  assert.match(source, /Conditions are checked once when this date is reached/);
  assert.match(source, /skipped permanently/);
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

test("scripted event branching authoring explains dependencies and relative outcome weights in player language", () => {
  assert.match(source, /Polity controls region/);
  assert.match(source, /Earlier scripted event happened/);
  assert.match(source, /Earlier event selected an outcome/);
  assert.match(source, /Select earlier event/);
  assert.match(source, /dependency points to an event that has not resolved yet/);
  assert.match(source, /aria-label="Referenced scripted event"/);
  assert.match(source, /aria-label="Referenced scripted outcome"/);
  assert.match(source, /data-scripted-event-outcomes="true"/);
  assert.match(source, /Possible outcomes - choose one/);
  assert.match(source, /Weight is relative, not a percentage/);
  assert.match(source, /3 \/ 1 \/ 1 means 60% \/ 20% \/ 20%/);
  assert.match(source, /Outcome ID/);
  assert.match(source, /aria-label="Outcome weight"/);
  assert.match(source, /0 means this outcome can never be selected/);
  assert.match(source, /At least one outcome needs a weight above 0/);
  assert.match(source, /Blank outcomes are discarded/);
  assert.match(source, /outcomeChanceText/);
});

test("scripted events let authors choose AI-written or exact visible wording", () => {
  assert.match(source, /Event wording/);
  assert.match(source, /aria-label="Event wording mode"/);
  assert.match(source, /value="generated">Let the AI write it<\/option>/);
  assert.match(source, /value="exact">Use my exact wording<\/option>/);
  assert.match(source, /The timeline body uses these exact words/);
  assert.match(source, /Outcomes inherit the event wording mode above/);
});
