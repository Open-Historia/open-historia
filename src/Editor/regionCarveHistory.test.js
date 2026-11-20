import test from "node:test";
import assert from "node:assert/strict";
import Feature from "ol/Feature.js";
import Polygon from "ol/geom/Polygon.js";
import { restoreCarvedEdited } from "./regionCarveHistory.js";

test("undo restores absence, false, and true of the canonical edited attribute", () => {
  for (const original of [undefined, false, true]) {
    const feature = new Feature(new Polygon([[[0,0],[10,0],[10,10],[0,0]]]));
    if (original !== undefined) feature.set("edited", original);
    const previous = feature.get("edited");
    feature.set("edited", true);
    restoreCarvedEdited(feature, previous);
    assert.equal(feature.get("edited"), original);
    assert.equal(feature.getKeys().includes("edited"), original !== undefined);
    feature.set("edited", true);
    assert.equal(feature.get("edited"), true, "redo marks the carved geometry edited");
  }
});
