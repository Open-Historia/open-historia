import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTRY_CAPABILITY_FIELDS,
  applyCountryCapabilityPatchToWorld,
  countryCapabilityFormFromWorld,
  countryCapabilityPatchFromForm,
  validateCountryCapabilityPatch,
} from "./countryCapabilities.js";
import { militaryProfile } from "./militaryPower.js";
import { intelligenceOf } from "./spycraft.js";
import { resourcesOf } from "./warResources.js";
import { wearinessOf } from "./warWeariness.js";

const world = () => ({
  countryStats: {
    Aland: { customStats: { nationalStability: 54 }, military: { technology: 90, spending: 80 } },
    Borduria: { military: { quality: 55 } },
  },
  polityOverrides: { Aland: { military: { quality: 70, technology: 60 } } },
  intelligence: { Aland: 82 },
  warSettings: { mechanics: { military: true, supply: true, air: true } },
  warWeariness: [{ country: "Aland", value: 35 }, { country: "Borduria", value: 12 }],
  warResources: [{ country: "Aland", value: 55 }, { country: "Borduria", value: 77 }],
});

test("capability editor reads canonical live intelligence, military inheritance, and wartime ledgers without inventing zeroes", () => {
  const fields = countryCapabilityFormFromWorld(world(), "Aland");
  assert.deepEqual(
    [fields.intelligence, fields.quality, fields.technology, fields.spending, fields.land, fields.warWeariness, fields.warResources],
    ["82", "70", "90", "80", "", "35", "55"],
  );
  assert.equal(countryCapabilityFormFromWorld(world(), "Borduria").intelligence, "");
  assert.equal(COUNTRY_CAPABILITY_FIELDS.find(({ key }) => key === "manpowerShare").minimum, 0.1);
});

test("changed-only capability patch preserves foreign and custom fields and writes actual combat/espionage owners", () => {
  const state = world();
  const loaded = countryCapabilityFormFromWorld(state, "Aland");
  const form = { ...loaded, intelligence: "0", quality: "75", warWeariness: "65.2", warResources: "0" };
  const patch = countryCapabilityPatchFromForm({ world: state, country: "Aland", form, loaded });
  assert.deepEqual(patch, { intelligence: 0, military: { quality: 75 }, warWeariness: 65.2, warResources: 0 });
  applyCountryCapabilityPatchToWorld(state, "Aland", patch);
  assert.equal(intelligenceOf(state, "Aland"), 0);
  assert.equal(militaryProfile(state, "Aland").figures.quality, 75);
  assert.equal(militaryProfile(state, "Aland").figures.technology, 90);
  assert.equal(militaryProfile(state, "Aland").figures.resources, 0);
  assert.equal(wearinessOf(state.warWeariness, "Aland"), 65.2);
  assert.equal(state.countryStats.Aland.customStats.nationalStability, 54);
  assert.equal(resourcesOf(state.warResources, "Borduria"), 77);
  assert.equal(wearinessOf(state.warWeariness, "Borduria"), 12);
});

test("zero war weariness wins over a nonzero authored starting value and full supply removes sparse row", () => {
  const state = world();
  state.polityOverrides.Aland.military.weariness = 60;
  applyCountryCapabilityPatchToWorld(state, "Aland", { warWeariness: 0, warResources: 100 });
  assert.equal(militaryProfile(state, "Aland").figures.weariness, 0);
  assert.equal(militaryProfile(state, "Aland").figures.resources, 100);
  assert.equal(state.warWeariness.some((row) => row.country === "Aland"), false);
  assert.equal(state.warResources.some((row) => row.country === "Aland"), false);
  assert.equal(state.countryStats.Aland.military.weariness, 0);
});

test("capability edits reject missing, out-of-range, non-finite, unknown, and fractional integer ratings without clamping", () => {
  for (const patch of [
    { intelligence: -1 }, { intelligence: 101 }, { intelligence: 75.5 },
    { intelligence: "" }, { military: { quality: 101 } }, { military: { spending: null } },
    { military: { manpowerShare: 0 } }, { military: { quality: 40.3 } },
    { military: { unknown: 50 } }, { military: {} }, { warWeariness: 100.2 },
    { warResources: -0.1 }, { warResources: null }, { unrecognized: 20 },
  ]) {
    assert.ok(validateCountryCapabilityPatch(patch), JSON.stringify(patch));
  }
  assert.equal(validateCountryCapabilityPatch({ intelligence: 0, military: { quality: 0, manpowerShare: 0.1 }, warWeariness: 0, warResources: 100 }), "");
});

test("stale change to a targeted live capability fails closed but unrelated concurrent changes survive", () => {
  const state = world();
  const loaded = countryCapabilityFormFromWorld(state, "Aland");
  state.intelligence.Aland = 93;
  assert.throws(() => countryCapabilityPatchFromForm({
    world: state, country: "Aland", loaded, form: { ...loaded, intelligence: "91" },
  }), /changed while this editor was open/i);
  assert.deepEqual(countryCapabilityPatchFromForm({
    world: state, country: "Aland", loaded, form: { ...loaded, spending: "79" },
  }), { military: { spending: 79 } });
  assert.deepEqual(countryCapabilityPatchFromForm({
    world: state, country: "Aland", loaded, form: { ...loaded },
  }), null);
});
