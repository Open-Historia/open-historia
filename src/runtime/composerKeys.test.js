// Run: node --test src/runtime/composerKeys.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { isComposerSendKey } from "./composerKeys.js";

// What React hands an onKeyDown handler: the key on the synthetic event, the
// composition state on the native one.
const key = (over = {}, native = {}) => ({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: false, keyCode: 13, ...native }, ...over });

test("Enter sends on a keyboard", () => {
  assert.equal(isComposerSendKey(key()), true);
});

test("Shift+Enter and other keys never send", () => {
  assert.equal(isComposerSendKey(key({ shiftKey: true })), false);
  assert.equal(isComposerSendKey(key({ key: "a" })), false);
  assert.equal(isComposerSendKey(null), false);
});

test("on a touch screen Enter is a new line", () => {
  assert.equal(isComposerSendKey(key(), { touch: true }), false);
});

test("Enter that confirms a word in an input method does not send", () => {
  assert.equal(isComposerSendKey(key({}, { isComposing: true })), false);
  assert.equal(isComposerSendKey(key({}, { keyCode: 229 })), false, "Safari's composing Enter");
});
