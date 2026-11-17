/*! Open Historia — canonical Projects mutation contract tests; AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./projects.jsx", import.meta.url), "utf8");
const start = source.indexOf("const writeOps = useCallback(async (ops) => {");
const end = source.indexOf("const setFunding = useCallback", start);
const writeOps = start >= 0 && end > start ? source.slice(start, end) : "";

test("all Projects panel player writes run inside the shared canonical document queue", () => {
  assert.ok(writeOps, "Projects player-write handler must exist");
  assert.match(writeOps, /await mutateWorldState\(\(world\) => \{/);
  assert.match(writeOps, /applyProjectOpsToWorld\(\{/);
  assert.match(writeOps, /actor: "player"/);
  assert.match(writeOps, /if \(refusedProjectIds\.length > 0\) throw new Error/);
  assert.doesNotMatch(writeOps, /await readWorldState\(/, "a stale snapshot cannot be taken outside the queue");
  assert.doesNotMatch(writeOps, /writeWorldState\(/, "the handler must not write a stale world outside the queue");
});
