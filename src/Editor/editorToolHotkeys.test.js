import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_GROUPS, TOOLS } from "./editorToolCatalog.js";
import { toolForHotkey } from "./editorToolHotkeys.js";

test("every native tool has a unique one-letter shortcut and its canonical ID is unchanged", () => {
  assert.equal(TOOLS.length, 19, "18 previous modes plus native region scissors");
  assert.equal(new Set(TOOLS.map((tool) => tool.id)).size, TOOLS.length);
  assert.equal(new Set(TOOLS.map((tool) => tool.hotkey)).size, TOOLS.length);
  assert.ok(TOOL_GROUPS.length >= 4);
  for (const tool of TOOLS) {
    assert.match(tool.hotkey, /^[A-Z]$/);
    assert.equal(toolForHotkey({ key: tool.hotkey.toLowerCase() }), tool.id);
    assert.ok(tool.label.length > 5);
  }
  assert.equal(toolForHotkey({ key: "v" }), "select");
  assert.equal(toolForHotkey({ key: "b" }), "move");
  assert.equal(toolForHotkey({ key: "m" }), "region-box");
  assert.equal(toolForHotkey({ key: "l" }), "lasso");
});

test("shortcuts don't steal keyboard input, Ctrl/Cmd combos, modifiers, modal dialogs or unfinished drawings", () => {
  for (const event of [
    { key: "v", ctrlKey: true },
    { key: "v", metaKey: true },
    { key: "v", altKey: true },
    { key: "v", shiftKey: true },
    { key: "v", repeat: true },
    { key: "v", isComposing: true },
    { key: "b", target: { tagName: "INPUT" } },
    { key: "b", target: { tagName: "SELECT" } },
    { key: "m", target: { tagName: "TEXTAREA" } },
    { key: "m", target: { tagName: "DIV", isContentEditable: true } },
    { key: "l", target: { tagName: "DIV", closest: () => ({ isContentEditable: true }) } },
  ]) assert.equal(toolForHotkey(event), null);
  assert.equal(toolForHotkey({ key: "v" }, { sketching: true }), null);
  assert.equal(toolForHotkey({ key: "b" }, { modalOpen: true }), null);
  assert.equal(toolForHotkey({ key: "q" }), null);
});
