import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Every dropdown in the game opens a list a player can read. The list is the
// system's, light unless told otherwise, and the interface's text is light: a
// player saw white entries on a white list, readable only under the pointer.
// One rule in the stylesheet makes every list dark with light text, and it
// has to win over what any one dropdown says for itself (some give their
// entries black text, for a light list that is no longer there).
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("every dropdown's list is dark with light text, whatever the dropdown says for itself", () => {
  assert.match(css, /select \{\s+color-scheme: dark;\s+\}/);
  assert.match(css, /select option,\s+select optgroup \{\s+background-color: #1f1f23 !important;\s+color: #f4f4f5 !important;\s+\}/);
  assert.match(css, /select option:disabled \{\s+color: #8b8b93 !important;\s+\}/);
});

test("the two colours can be told apart", () => {
  // Relative luminance of the ground and of the text: a contrast well past 7 to 1.
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  assert.ok(contrast("#1f1f23", "#f4f4f5") > 12);
  assert.ok(contrast("#1f1f23", "#8b8b93") > 4);
});
