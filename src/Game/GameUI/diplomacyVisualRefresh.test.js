import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./chat.jsx", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("./main.jsx", import.meta.url), "utf8");

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
  assert.match(source, /maxWidth: isError \? "82%" : "min\(84%, 44rem\)"/);
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

test("diplomacy yields space to the live desktop right drawer", () => {
  assert.match(source, /width: "min\(68rem, calc\(100vw - 1rem - var\(--oh-right-drawer-safe-offset, 0px\)\)\)"/);
  assert.match(main, /const RIGHT_DRAWER_SAFE_OFFSET_VAR = "--oh-right-drawer-safe-offset"/);
  assert.match(main, /const rightDrawerSafeOffset = rightDrawerOpen && !isMobile/);
  assert.match(main, /style\.setProperty\(RIGHT_DRAWER_SAFE_OFFSET_VAR, rightDrawerSafeOffset\)/);
  assert.match(main, /`var\(\$\{ADVISOR_WIDTH_VAR\}, \$\{advisorWidth\}px\)`/);
});

test("the inbox and conversation use a responsive split, readable activity cues and theme-aware message colors", () => {
  const styles = fs.readFileSync(new URL("./diplomacyInbox.css", import.meta.url), "utf8");
  assert.match(source, /data-diplomacy-layout="responsive-split"/);
  assert.match(source, /className="oh-diplomacy-active-sidebar"/);
  assert.match(source, /className="oh-diplomacy-search"/);
  assert.match(source, /handleInboxScroll/);
  assert.match(source, /inboxHasNewActivity/);
  assert.match(source, /chatInboxSignature\(saved\) === chatInboxSignature\(prev\)/);
  assert.match(source, /color-mix\(in srgb, var\(--oh-ui-accent/);
  assert.match(styles, /@container \(max-width: 47rem\)/);
  assert.match(styles, /prefers-reduced-motion/);
});
