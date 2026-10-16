/*! Open Historia — the Workshop's tool button look: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/editorStyles.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { toolButton, panelSurface } from "./editorStyles.js";

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// WCAG relative luminance of an [r, g, b] colour.
const lum = ([r, g, b]) => {
  const c = [r, g, b].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
// "rgba(255,255,255,0.06)" laid over the panel's flat background.
const over = (rgba, base) => {
  const [r, g, b, a] = rgba.match(/[\d.]+/g).map(Number);
  return [r, g, b].map((v, i) => v * a + base[i] * (1 - a));
};

test("the active tool is at least 3:1 against an inactive one, and its icon is readable on it", () => {
  const panel = hex(panelSurface.backgroundColor);
  const inactive = over(toolButton(false, false).background, panel);
  const active = hex(toolButton(true, false).background);
  assert.ok(ratio(active, inactive) >= 3, `button vs neighbour: ${ratio(active, inactive).toFixed(2)}`);
  assert.ok(ratio(active, hex(toolButton(true, false).color)) >= 4.5, "icon on the active button");
});
