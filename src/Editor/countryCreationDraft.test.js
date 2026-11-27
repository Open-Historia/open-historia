import test from "node:test";
import assert from "node:assert/strict";
import { emptyCountryDraft, planCountryDraft } from "./countryCreationDraft.js";

const polities = {
  "German Reich": { name: "German Reich", aliases: ["Imperial Germany"] },
  "Kingdom of Bulgaria": { name: "Kingdom of Bulgaria", aliases: [], formerNames: ["Principality of Bulgaria"] },
};
const puppetRows = [];
const choices = Object.keys(polities).map((key) => ({ key, name: key }));
const plan = (patch = {}, override = {}) => planCountryDraft({
  draft: { ...emptyCountryDraft(), name: "Karlsland", ...patch },
  polities, occupiedKeys: [], puppets: puppetRows, polityChoices: choices,
  ...override,
});

test("opening setup creates an entirely unsaved, empty draft", () => {
  assert.deepEqual(emptyCountryDraft(), {
    name: "", aliases: [], formerNames: [], note: "", population: "", military: null,
    color: null, flag: null, tags: [], overlord: "", dependencyKind: "satellite",
    secrecy: "open", loyalty: 50, assignSelectedRegions: false, startingRelations: [],
  });
});

test("valid complete country setup preserves authored identity, appearance, army and dependency without mutation", () => {
  const draft = {
    name: "  Republic of Karlsland ",
    aliases: ["Karl Republic"],
    formerNames: ["Duchy of Karlsland"],
    note: "Parliamentary republic after a revolution.",
    population: "4,600,000",
    military: { quality: 0, technology: 65, land: 75 },
    color: [13, 64, 123], flag: "data:image/png;base64,abcd",
    tags: ["democratic", "regional-power"], overlord: "Kingdom of Bulgaria",
    dependencyKind: "client", secrecy: "covert", loyalty: 23,
    assignSelectedRegions: true,
  };
  const input = JSON.stringify({ draft, polities, puppetRows });
  const result = plan(draft);
  assert.equal(result.ok, true);
  assert.equal(result.key, "Republic of Karlsland");
  assert.deepEqual(result.record, {
    name: "Republic of Karlsland", code: "Republic of Karlsland",
    status: "active", aliases: ["Karl Republic"], formerNames: ["Duchy of Karlsland"],
    note: draft.note, population: 4600000,
    military: { quality: 0, technology: 65, land: 75 },
  });
  assert.deepEqual(result.color, draft.color);
  assert.deepEqual(result.tags, draft.tags);
  assert.equal(result.flag, draft.flag);
  assert.equal(result.assignSelectedRegions, true);
  assert.equal(result.puppets.length, 1);
  assert.deepEqual(
    (({ overlord, puppet, kind, secrecy, loyalty, status }) => ({ overlord, puppet, kind, secrecy, loyalty, status }))(result.puppets[0]),
    { overlord: "Kingdom of Bulgaria", puppet: "Republic of Karlsland", kind: "client", secrecy: "covert", loyalty: 23, status: "active" },
  );
  assert.equal(JSON.stringify({ draft, polities, puppetRows }), input, "Pure preview may not mutate live sources or draft");
});

test("optional unset properties stay unset; zero troop quality remains an explicit author choice", () => {
  const result = plan({ military: { quality: 0 } });
  assert.equal(result.ok, true);
  assert.equal("population" in result.record, false);
  assert.equal(result.record.military.quality, 0);
  assert.equal(result.color, null);
  assert.equal(result.flag, null);
  assert.equal(result.puppets, null);
});

test("creation rejects existing registered keys, aliases and former names without touching scenario state", () => {
  for (const name of ["German Reich", "IMPERIAL-GERMANY", "Principality of Bulgaria", "Kingdom of Bulgaria"]) {
    const result = plan({ name });
    assert.equal(result.ok, false, name);
    assert.match(result.reason, /already identifies/);
  }
});

test("creation refuses internal alternative/former names that duplicate the country or each other", () => {
  for (const patch of [
    { aliases: ["Karlsland"] },
    { aliases: ["Karl", "KARL"] },
    { aliases: ["Karl"], formerNames: ["K.A.R.L"] },
    { formerNames: ["-"] },
    { aliases: ["Imperial Germany"] },
    { formerNames: ["Principality of Bulgaria"] },
  ]) {
    const result = plan(patch);
    assert.equal(result.ok, false, JSON.stringify(patch));
  }
});

test("creation refuses invalid population and out-of-contract tag lists", () => {
  for (const patch of [
    { population: "3 million" }, { population: "-4" }, { population: "0" },
    { tags: ["liberal", "Liberal"] }, { tags: [""] },
    { tags: ["x".repeat(33)] }, { tags: Array.from({ length: 9 }, (_, i) => `tag-${i}`) },
  ]) assert.equal(plan(patch).ok, false, JSON.stringify(patch));
});

test("preflight refuses unknown, self, or invalid puppet relationships using the actual native contracts", () => {
  for (const patch of [
    { overlord: "Unknown Land" },
    { overlord: "German Reich", dependencyKind: "nonsense" },
    { overlord: "German Reich", secrecy: "nonsense" },
    { overlord: "German Reich", loyalty: -1 },
  ]) assert.equal(plan(patch).ok, false, JSON.stringify(patch));
  const withPuppet = [{ id: "puppet-German Reich", puppet: "German Reich", overlord: "Kingdom of Bulgaria", status: "active" }];
  assert.equal(plan({ overlord: "German Reich" }, { puppets: withPuppet }).ok, false);
});

test("creation refuses malformed color and flag values instead of silently dropping the user's choices", () => {
  assert.equal(plan({ color: [999, 0, 0] }).ok, false);
  assert.equal(plan({ color: [1.5, 2, 3] }).ok, false);
  assert.equal(plan({ flag: {} }).ok, false);
});
