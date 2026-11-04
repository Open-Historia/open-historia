import assert from "node:assert/strict";
import test from "node:test";
import { describeChiefAdvisorOverride } from "./advisorPersona.js";

test("chief profile is opt-in and leaves scenario prompt untouched by default", () => {
  assert.equal(describeChiefAdvisorOverride(null), "");
  assert.equal(describeChiefAdvisorOverride(undefined), "");
});

test("chief override sets identity and personality without removing Advisor capabilities", () => {
  const text = describeChiefAdvisorOverride({
    name: "Dmitri Orlov",
    title: "Chief of Staff",
    personality: "Candid and pragmatic; challenges weak arguments.",
  });
  assert.match(text, /Dmitri Orlov/);
  assert.match(text, /Chief of Staff/);
  assert.match(text, /Candid and pragmatic/);
  assert.match(text, /Continue fulfilling every scenario-defined Advisor duty/);
  assert.match(text, /does not grant new authority/);
});

test("chief override without personality still preserves name and scenario rules", () => {
  const text = describeChiefAdvisorOverride({ name: "Friedrich", title: "Imperial Advisor", personality: "" });
  assert.match(text, /Friedrich/);
  assert.match(text, /Imperial Advisor/);
  assert.doesNotMatch(text, /Your personality and operating principles:/);
});
