import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./EditorToolDock.jsx", import.meta.url), "utf8");

test("active-tool indicator stays outside the tool dock's flex layout and does not change dock width", () => {
  assert.match(source, /position: "relative",\s*display: "flex"/);
  assert.match(source, /\{current && <span\s+aria-live="polite"/);
  assert.match(source, /position: "absolute",\s*left: "50%",\s*bottom: "calc\(100% \+ 8px\)"/);
  assert.match(source, /transform: "translateX\(-50%\)"/);
  assert.match(source, /pointerEvents: "none"/);
  assert.match(source, /current\.label\.split\(" \("\)\[0\]/);
  assert.match(source, /role="toolbar"/);
  assert.match(source, /aria-keyshortcuts=\{tool\.hotkey\}/);
});
