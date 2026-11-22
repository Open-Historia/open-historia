import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FROST_CLASS, FROST_LAYER_ID, cornerRadius, frostSize, isOverlay, panelBox, samePanels } from "./frostedPanels.js";
import { MAP_LAYER_ORDER } from "./mapLayerOrder.js";

const canvas = { left: 0, top: 0, width: 384, height: 755 };

test("the glass is painted over everything else the map draws", () => {
  assert.equal(MAP_LAYER_ORDER.at(-1), FROST_LAYER_ID);
});

test("the browser's blur goes only while the map paints the glass", () => {
  const css = fs.readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  assert.match(css, new RegExp(`:root\\.${FROST_CLASS} \\{\\s*--oh-hud-blur: none;`));
});

test("the frame is blitted: copying it from the canvas stalled the globe for half a second at a time", () => {
  const source = fs.readFileSync(new URL("./frostedPanels.js", import.meta.url), "utf8");
  assert.match(source, /gl\.blitFramebuffer\(/);
  assert.doesNotMatch(source, /gl\.copyTexSubImage2D\(/);
});

test("a panel's box is where it sits on the canvas, and off it there is none", () => {
  const rect = { left: 10, top: 20, width: 50, height: 40 };
  assert.deepEqual(panelBox(rect, canvas, 6), { x: 10, y: 20, width: 50, height: 40, radius: 6 });
  assert.deepEqual(panelBox(rect, { ...canvas, left: 5, top: 8 }), { x: 5, y: 12, width: 50, height: 40, radius: 0 });
  assert.equal(panelBox({ ...rect, width: 0 }, canvas), null);
  assert.equal(panelBox({ ...rect, left: 400 }, canvas), null, "a drawer slid off to the right");
  assert.equal(panelBox({ ...rect, left: -368, width: 368 }, canvas), null, "and to the left");
  assert.ok(panelBox({ ...rect, left: -20 }, canvas), "part of it is still over the map");
});

// The map can only blur itself: a menu over the date bar would show the date through it.
test("the bars and buttons are the map's to paint, and what covers them is the browser's", () => {
  for (const height of [35, 51, 64]) assert.equal(isOverlay({ height }), false);
  for (const height of [300, 480]) assert.equal(isOverlay({ height }), true);
});

test("a radius is what the box can show", () => {
  assert.equal(cornerRadius("14px", 50, 40), 14);
  assert.equal(cornerRadius("50%", 51, 51), 25.5);
  assert.equal(cornerRadius("999px", 80, 30), 15);
  assert.equal(cornerRadius("0px", 50, 40), 0);
  assert.equal(cornerRadius("", 50, 40), 0);
});

test("the map is asked to draw only when a panel has changed", () => {
  const box = { x: 1, y: 2, width: 3, height: 4, radius: 5 };
  assert.equal(samePanels([box], [{ ...box }]), true);
  assert.equal(samePanels([box], [{ ...box, x: 2 }]), false);
  assert.equal(samePanels([box], []), false);
});

test("the small copy is never empty", () => {
  assert.deepEqual(frostSize(384, 755), [48, 95]);
  assert.deepEqual(frostSize(1, 1), [1, 1]);
});
