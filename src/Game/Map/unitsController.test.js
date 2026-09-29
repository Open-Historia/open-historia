// Run: node --test src/Game/Map/unitsController.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { isDeployableType } from "./unitsController.js";

// deployUnit refuses a type the scenario does not allow, whoever calls it: the
// advisor's one-click deployments could place an air wing in a scenario that
// allows only infantry and garrison (B201).
test("a scenario's allowed troop types bind every deployment", () => {
  assert.equal(isDeployableType("air", ["infantry", "garrison"]), false);
  assert.equal(isDeployableType("infantry", ["infantry", "garrison"]), true);
  assert.equal(isDeployableType("Infantry", ["infantry", "garrison"]), true);
});

test("no list, or an empty one, allows every type", () => {
  assert.equal(isDeployableType("air", null), true);
  assert.equal(isDeployableType("air", []), true);
});
