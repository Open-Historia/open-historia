import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./gameState.js", import.meta.url), "utf8");

test("canonical event normalization preserves structured quotation presentation", () => {
  assert.match(source, /import \{ normalizeEventPresentation \} from "\.\/eventQuote\.js"/);
  assert.match(source, /const presentation = normalizeEventPresentation\(\{/);
  assert.match(source, /description: presentation\.description/);
  assert.match(source, /presentation\.quote \? \{ quote: presentation\.quote \}/);
});
