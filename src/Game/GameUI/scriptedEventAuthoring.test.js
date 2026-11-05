import assert from "node:assert/strict";
import test from "node:test";
import {
  scriptedEventInstitutionOptions,
  scriptedEventPickerLabel,
  scriptedEventPickerValue,
  scriptedEventPolityOptions,
} from "./scriptedEventAuthoring.js";

test("scripted-event polity authoring exposes human labels while preserving canonical ids", () => {
  const world = {
    ownerCodes: ["GBR"],
    polityOverrides: {
      "German Empire": { name: "German Empire", status: "active" },
    },
    politicalActors: {
      byPolity: {
        "Russian Empire": { name: "Russian Empire" },
      },
    },
  };
  const options = scriptedEventPolityOptions(world);
  assert.ok(options.some((entry) => entry.id === "GBR" && entry.label === "United Kingdom"));
  assert.ok(options.some((entry) => entry.id === "German Empire" && entry.label === "German Empire"));
  assert.ok(options.some((entry) => entry.id === "Russian Empire" && entry.label === "Russian Empire"));
  assert.equal(scriptedEventPickerLabel("GBR", options), "United Kingdom");
  assert.equal(scriptedEventPickerValue("United Kingdom", options), "GBR");
});

test("scripted-event institution authoring uses canonical ids under human names", () => {
  const options = scriptedEventInstitutionOptions({
    institutions: {
      byId: {
        "triple-alliance": { id: "triple-alliance", name: "Triple Alliance", status: "active" },
      },
    },
  });
  assert.deepEqual(options, [{ id: "triple-alliance", label: "Triple Alliance" }]);
  assert.equal(scriptedEventPickerValue("Triple Alliance", options), "triple-alliance");
  assert.equal(scriptedEventPickerLabel("triple-alliance", options), "Triple Alliance");
});

test("an unresolved advanced token remains explicit instead of being guessed", () => {
  const options = [{ id: "German Empire", label: "German Empire" }];
  assert.equal(scriptedEventPickerValue("future-polity-id", options), "future-polity-id");
  assert.equal(scriptedEventPickerLabel("future-polity-id", options), "future-polity-id");
});
