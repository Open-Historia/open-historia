import test from "node:test";
import assert from "node:assert/strict";
import { countryOverviewFacts } from "./countryOverviewFacts.js";

test("country summary treats missing authored values as unset, not invented zeros", () => {
  const current = { key: "Landless Republic", name: "Landless Republic", regionCount: 0, claimantCount: 0, record: null };
  const facts = countryOverviewFacts({ current });
  assert.equal(facts.regionCount, 0);
  assert.equal(facts.claimantCount, 0);
  assert.equal(facts.population, null);
  assert.equal(facts.militaryFields, 0);
  assert.equal(facts.overlord, null);
  assert.equal(facts.note, null);
  assert.equal(facts.flagSet, false);
  assert.deepEqual(facts.tags, []);
  assert.deepEqual(facts.aliases, []);
  assert.deepEqual(facts.formerNames, []);
  assert.equal(facts.hasRecord, false);
});

test("country summary uses actual authored aliases, former names, population, forces and assets without mutation", () => {
  const current = {
    key: "Karl Republic",
    name: "Karl Republic",
    regionCount: 27, claimantCount: 3,
    record: {
      name: "Karl Republic",
      aliases: ["Karl", "Republic of Karlsland"],
      formerNames: ["German Reich"],
      population: 4550000,
      military: { quality: 0, technology: 70 },
      note: "New government, disputed capital",
    },
  };
  const polities = {
    "Karl Republic": current.record,
    "Northern Empire": { name: "Imperial North" },
    "Southern Client": { name: "Southland" },
  };
  const puppets = [
    { status: "active", puppet: "Karl Republic", overlord: "Northern Empire", kind: "client" },
    { status: "released", puppet: "Karl Republic", overlord: "Defunct Empire" },
  ];
  const before = JSON.stringify({ current, polities, puppets });
  const facts = countryOverviewFacts({
    current, polities, puppets,
    flags: { "Karl Republic": "flags/custom-karlsland.svg" },
    tags: { "Karl Republic": ["regional", "post-war"] },
  });
  assert.deepEqual(facts.aliases, ["Karl", "Republic of Karlsland"]);
  assert.deepEqual(facts.formerNames, ["German Reich"]);
  assert.equal(facts.population, "4,550,000");
  assert.equal(facts.militaryFields, 2);
  assert.equal(facts.regionCount, 27);
  assert.equal(facts.claimantCount, 3);
  assert.equal(facts.overlord, "Imperial North");
  assert.equal(facts.dependencyKind, "client");
  assert.deepEqual(facts.dependentNames, []);
  const independentWithDependent = countryOverviewFacts({
    current, polities,
    puppets: [{ status: "active", puppet: "Southern Client", overlord: "Karl Republic", kind: "satellite" }],
  });
  assert.equal(independentWithDependent.overlord, null);
  assert.deepEqual(independentWithDependent.dependentNames, ["Southland"]);
  assert.equal(facts.flagSet, true);
  assert.deepEqual(facts.tags, ["regional", "post-war"]);
  assert.equal(facts.note, "New government, disputed capital");
  assert.equal(JSON.stringify({ current, polities, puppets }), before);
});

test("country summary distinguishes unset population from authored military zero", () => {
  const facts = countryOverviewFacts({
    current: { key: "B", record: { population: undefined, military: { land: 0 } } },
  });
  assert.equal(facts.population, null);
  assert.equal(facts.militaryFields, 1, "A specified zero military capability is a real authored setting");
});
