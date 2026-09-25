import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./chat.jsx", import.meta.url), "utf8");

test("diplomacy refresh keeps counterpart-first titles and modern thread rows", () => {
  assert.match(source, /const diplomaticCounterparts =/);
  assert.match(source, /summarizeDiplomaticParticipants/);
  assert.match(source, /data-diplomacy-thread-row="modern"/);
  assert.doesNotMatch(source, /Chat with \$\{countries\.map/);
});

test("open diplomacy has a participant header instead of the old text-only title", () => {
  assert.match(source, /data-diplomacy-header="modern"/);
  assert.match(source, /Direct diplomatic channel/);
  assert.match(source, /-party diplomatic channel/);
  assert.match(source, /headerFlagUrls/);
});

test("messages use bounded width, grouping, subtle accents and hover copy", () => {
  assert.match(source, /maxWidth: isError \? "82%" : "min\(70%, 42rem\)"/);
  assert.match(source, /compact = false/);
  assert.match(source, /groupedWithNext/);
  assert.match(source, /CopyIcon/);
  assert.match(source, /borderLeft: \(!isPlayer && !isError\)/);
});

test("reactions render as a multi-reaction strip rather than one floating badge", () => {
  assert.match(source, /data-diplomacy-reactions="multi"/);
  assert.match(source, /ReactionStrip/);
  assert.match(source, /ReactionChip/);
  assert.doesNotMatch(source, /const ReactionBubble/);
});

test("composer uses the modern send icon and preserves auto-growing textarea behavior", () => {
  assert.match(source, /data-diplomacy-composer="modern"/);
  assert.match(source, /<SendIcon \/>/);
  assert.match(source, /onInput=\{fitComposer\}/);
  assert.doesNotMatch(source, /🚀/);
});
