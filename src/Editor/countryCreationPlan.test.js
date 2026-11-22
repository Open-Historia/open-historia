import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planCountryCreation } from "./countryCreationPlan.js";

const polities = {
  "Karl Republic": { name: "Karlsland", aliases: ["Imperial Karlsland"], formerNames: ["German Reich"] },
  "U.S Army Alaskan HQ": { name: "U.S Army Alaskan HQ", aliases: [] },
};
const plan = (name, extra = {}) => planCountryCreation({ name, polities, ...extra });

test("a genuinely distinct canonical identity is creatable without adding redundant aliases", () => {
  const before = JSON.stringify(polities);
  assert.deepEqual(plan("  New Caledonian Federation  "), { ok: true, key: "New Caledonian Federation" });
  assert.equal(JSON.stringify(polities), before);
});
test("a registered key, display name, historical name or alias cannot be duplicated by creation", () => {
  for (const name of ["Karl Republic", "karlsland", "Imperial-Karlsland", "GERMAN REICH", "U.S. Army Alaskan HQ"]) {
    const result = plan(name);
    assert.equal(result.ok, false, name);
    assert.match(result.reason, /already identifies/);
  }
});
test("territory-only owner names are reserved, preserving landless and historical polity identities", () => {
  const result = plan("Kingdom of Bulgaria", { occupiedKeys: ["Kingdom-of Bulgaria"] });
  assert.equal(result.ok, false);
});
test("blank, punctuation-only and non-identities cannot be registered", () => {
  for (const input of ["", "   ", "---", "!?"]) {
    const result = plan(input);
    assert.equal(result.ok, false, input);
  }
});
test("both native country creation entry points retain the canonical identity preflight", () => {
  const manager = readFileSync(new URL("./PolitiesPanel.jsx", import.meta.url), "utf8");
  const inspector = readFileSync(new URL("./SelectionInspector.jsx", import.meta.url), "utf8");
  const draft = readFileSync(new URL("./countryCreationDraft.js", import.meta.url), "utf8");
  assert.match(draft, /planCountryCreation\(\{/);
  assert.match(manager, /planCountryDraft\(\{/);
  assert.match(manager, /if \(!plan\.ok\) return plan;/);
  assert.match(inspector, /planCountryCreation\(\{/);
  assert.match(inspector, /if \(!plan\.ok\)/);
  assert.match(inspector, /aliases: \[\], status: "active"/);
  assert.match(inspector, /const foldPolityName = nameKey;/);
});

test("non-Latin script names remain valid, and native Unicode folding protects collisions", () => {
  const result = plan("България");
  assert.deepEqual(result, { ok: true, key: "България" });
  const blocked = planCountryCreation({ name: "БЪЛГАРИЯ", occupiedKeys: ["българия"] });
  assert.equal(blocked.ok, false);
});
