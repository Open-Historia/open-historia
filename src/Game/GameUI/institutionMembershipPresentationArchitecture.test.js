import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./InstitutionsWorkspace.jsx", import.meta.url), "utf8");

test("all institution membership surfaces use status-aware presentation", () => {
  assert.match(source, /institutionMembershipDisplayLabel/);
  assert.doesNotMatch(source, /member\.role \|\| member\.status/);
  assert.doesNotMatch(source, /row\.member\.role \|\| row\.member\.status/);
  assert.doesNotMatch(source, /view\.member\.role \|\| view\.member\.status/);

  const uses = source.match(/institutionMembershipDisplayLabel\(/g) || [];
  assert.ok(uses.length >= 3, `expected all membership surfaces to use the shared rule, found ${uses.length}`);
});
