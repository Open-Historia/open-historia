import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(new URL("./EditorSidebar.jsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("./MapEditor.jsx", import.meta.url), "utf8");

test("settings side switch stays inside the sidebar when the sidebar is docked left", () => {
  // The menu used to open to the right of the left sidebar's Settings gear.
  // It then overlapped the panel beside it and became unclickable because the
  // panel owns a higher stacking layer. Anchor the menu to the gear's RIGHT
  // edge regardless of sidebar side, keeping its 200px width within the 268px
  // sidebar; changing global overlay z-index would only hide the root cause.
  assert.match(sidebar, /right:\s*0,\s*zIndex:\s*60,\s*width:\s*200/);
  assert.doesNotMatch(sidebar, /\[onRight \? "right" : "left"\]: 0, zIndex: 60/);
  assert.match(sidebar, /\{\[\["left", "Left"\], \["right", "Right"\]\]/);
  assert.match(sidebar, /onSideChange\?\.\(value\)/);
});

test("changing sidebar side still uses the existing state owner while editing", () => {
  assert.match(editor, /const \[sidebarSide, setSidebarSideState\] = useState/);
  assert.match(editor, /onSideChange=\{setSidebarSide\}/);
  assert.match(editor, /"--editor-dock-left": `\$\{dockLeft\}px`/);
  assert.match(editor, /"--editor-dock-right": `\$\{dockRight\}px`/);
  assert.match(editor, /\{openPanel === "polities" && \(/);
});
