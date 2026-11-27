import test from "node:test";
import assert from "node:assert/strict";
import { planCountryAliasEdit } from "./countryAliasEdits.js";

const registry = () => ({
  Karlsland: { name: "Karlsland", aliases: ["Karlsland", "Imperial Karlsland"], formerNames: [] },
  Germany: { name: "German Reich", aliases: ["Reich", "Germany"], formerNames: ["Weimar Republic"] },
  "Alaskan HQ": { name: "U.S. Army Alaskan HQ", aliases: [], formerNames: [] },
});

const edit = (input, options = {}) => planCountryAliasEdit({
  polities: registry(), countryKey: "Karlsland", alias: input, ...options,
});

test("adds a distinct alternative name without changing or recreating the country", () => {
  const before = registry();
  const result = planCountryAliasEdit({ polities: before, countryKey: "Karlsland", alias: "  Karlsland Empire  " });
  assert.deepEqual(result, { ok: true, aliases: ["Karlsland", "Imperial Karlsland", "Karlsland Empire"] });
  assert.deepEqual(before, registry(), "the authoring planner never mutates source state");
});

test("removes a chosen explicit alias but leaves other names untouched", () => {
  assert.deepEqual(edit("Imperial Karlsland", { action: "remove" }), {
    ok: true, aliases: ["Karlsland"],
  });
  assert.deepEqual(edit("Absent", { action: "remove" }), {
    ok: false, reason: "That alternative name is not on this country's list.",
  });
});

test("existing self-name aliases remain visible and removable without touching canonical key", () => {
  assert.deepEqual(edit("Karlsland", { action: "remove" }), {
    ok: true, aliases: ["Imperial Karlsland"],
  });
  assert.match(edit("karlsland").reason, /already uses/);
});

test("refuses missing, blank and punctuation-only alternatives", () => {
  assert.match(edit(" ").reason, /Enter an alternative/);
  assert.match(edit("!@#").reason, /Enter an alternative/);
  assert.match(edit("OK", { countryKey: "Missing" }).reason, /Select a country/);
});

test("uses the native unicode name fold for same-country punctuation and accent variants", () => {
  assert.match(edit("Imperial-Karlsland").reason, /already uses/);
  assert.match(edit("KARLSLAND").reason, /already uses/);
  const polities = { "Côte d'Ivoire": { name: "Côte d'Ivoire", aliases: [] } };
  const result = planCountryAliasEdit({ polities, countryKey: "Côte d'Ivoire", alias: "Cote d Ivoire" });
  assert.equal(result.ok, false);
});

test("refuses another country's current key, display name, alias or former name", () => {
  for (const alias of ["Germany", "German-Reich", "Reich", "Weimar Republic", "U.S Army Alaskan HQ"]) {
    const result = edit(alias);
    assert.equal(result.ok, false, alias);
    assert.match(result.reason, /already used by/);
  }
});

test("rejects a territory-only, unregistered owner name rather than silently shadowing it", () => {
  const result = edit("Kingdom of Bulgaria", { occupiedKeys: ["Kingdom of Bulgaria"] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /already used by/);
});

test("allows author to remove an inherited legacy collision to repair ambiguity", () => {
  const polities = { A: { name: "A", aliases: ["Contested"] }, B: { name: "B", aliases: ["Contested"] } };
  assert.deepEqual(planCountryAliasEdit({
    polities, countryKey: "A", action: "remove", alias: "Contested",
  }), { ok: true, aliases: [] });
});

test("neither unsupported actions nor no-op inputs modify aliases", () => {
  assert.equal(edit("New", { action: "delete-everything" }).ok, false);
  assert.equal(edit("nothing", { action: "remove" }).ok, false);
});
