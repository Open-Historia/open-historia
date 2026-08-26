// Runs in a BARE CHECKOUT: markdownText.js is import-free on purpose.
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeMarkdown } from "./markdownText.js";

// The bug this module was written for: the advisor wanted a line break, reached
// for HTML, and the player saw the tag.
test("<br> in its every spelling becomes a real line break", () => {
  assert.equal(normalizeMarkdown("first<br>second"), "first\nsecond");
  assert.equal(normalizeMarkdown("first<br/>second"), "first\nsecond");
  assert.equal(normalizeMarkdown("first<br />second"), "first\nsecond");
  assert.equal(normalizeMarkdown("first<BR>second"), "first\nsecond");
});

test("inline HTML emphasis becomes markdown emphasis", () => {
  assert.equal(normalizeMarkdown("<b>Titan</b> is <i>late</i>"), "**Titan** is *late*");
  assert.equal(normalizeMarkdown("<strong>5 GW</strong>"), "**5 GW**");
  assert.equal(normalizeMarkdown("<u>underlined</u>"), "underlined");
});

test("entities a model types out are decoded", () => {
  assert.equal(normalizeMarkdown("5&nbsp;GW &mdash; online"), "5 GW \u2014 online");
  assert.equal(normalizeMarkdown("Jones &amp; Sons"), "Jones & Sons");
  assert.equal(normalizeMarkdown("50&#176;N"), "50\u00b0N");
});

// Escaping the tag is how you say "I mean the text" — so honour it.
test("an escaped tag stays visible text", () => {
  assert.equal(normalizeMarkdown("write &lt;br&gt; to break"), "write <br> to break");
});

test("a tag inside a code span is left alone", () => {
  assert.equal(normalizeMarkdown("use `<br>` sparingly"), "use `<br>` sparingly");
});

test("a fenced block passes through untouched", () => {
  const source = "Look:\n```html\n<b>bold</b><br>\n```\ndone";
  assert.equal(normalizeMarkdown(source), source);
});

test("an unterminated fence keeps its contents verbatim", () => {
  const source = "Cut off:\n```json\n[{\"op\":\"create\"}<br>";
  assert.equal(normalizeMarkdown(source), source);
});

// A table glued to the paragraph above it does not parse at all, which is how a
// wall of pipes ends up in the chat.
test("a table glued to the paragraph above gets its blank line", () => {
  const source = "Here is the position:\n| Item | Detail |\n|------|--------|\n| Titan | 1 GW |";
  assert.equal(
    normalizeMarkdown(source),
    "Here is the position:\n\n| Item | Detail |\n|------|--------|\n| Titan | 1 GW |",
  );
});

// ...and a paragraph glued to the last row is swallowed as a one-cell row.
test("a paragraph glued to the last row gets its blank line", () => {
  const source = "| Item | Detail |\n|---|---|\n| Titan | 1 GW |\nThat is the whole yard.";
  assert.equal(
    normalizeMarkdown(source),
    "| Item | Detail |\n|---|---|\n| Titan | 1 GW |\n\nThat is the whole yard.",
  );
});

test("a correctly spaced table is returned unchanged", () => {
  const source = "Position:\n\n| Item | Detail |\n| --- | --- |\n| Titan | 1 GW |\n\nDone.";
  assert.equal(normalizeMarkdown(source), source);
});

test("alignment markers and pipe-less prose do not confuse the table detector", () => {
  const source = "| A | B |\n|:--|--:|\n| 1 | 2 |";
  assert.equal(normalizeMarkdown(source), source);
  // A lone pipe in prose is not a table: no delimiter row follows it.
  assert.equal(normalizeMarkdown("Reactor A | Reactor B"), "Reactor A | Reactor B");
});

test("a heading missing its space is repaired", () => {
  assert.equal(normalizeMarkdown("###Titan"), "### Titan");
  assert.equal(normalizeMarkdown("### Titan"), "### Titan");
  // Not a heading, and must not become one.
  assert.equal(normalizeMarkdown("#1 priority"), "# 1 priority");
});

test("ordinary markdown is passed through untouched", () => {
  const source = "## Status\n\n- **Titan** reached criticality\n- Hyperion sync validated\n\n> Your Excellency,\n\nRegards.";
  assert.equal(normalizeMarkdown(source), source);
});

test("empty and nullish input are safe", () => {
  assert.equal(normalizeMarkdown(""), "");
  assert.equal(normalizeMarkdown(null), "");
  assert.equal(normalizeMarkdown(undefined), "");
});
