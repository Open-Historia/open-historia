import assert from "node:assert/strict";
import test from "node:test";

import {
  ensurePoliticalProfile,
  getPoliticalProfile,
  normalizePoliticalActors,
} from "./politicalActors.js";

const makeWorld = () => ({
  polityOverrides: {
    "Russian Federation": {
      name: "Russian Federation",
      aliases: ["Russian Federation"],
      status: "active",
    },
    "Republic of Poland": {
      name: "Republic of Poland",
      aliases: ["Republic of Poland"],
      status: "active",
    },
    Ukraine: {
      name: "Ukraine",
      aliases: ["Ukraine"],
      status: "active",
    },
  },
  politicalActors: {
    schemaVersion: 1,
    byPolity: {
      "Russian Federation": {
        polityKey: "Russian Federation",
        government: {
          form: "Federal semi-presidential republic",
          headOfState: "Vladimir Putin",
        },
        leader: "Vladimir Putin",
      },
      "Republic of Poland": {
        polityKey: "Republic of Poland",
        government: {
          form: "Parliamentary republic",
          headOfState: "Bronisław Komorowski",
        },
        leader: "Bronisław Komorowski",
      },
      Ukraine: {
        polityKey: "Ukraine",
        government: {
          form: "Semi-presidential republic",
          headOfState: "Petro Poroshenko",
        },
        leader: "Petro Poroshenko",
      },
    },
  },
});

test("political profile lookup bridges stock map names to formal modern actor identities", () => {
  const world = makeWorld();

  assert.equal(getPoliticalProfile(world, "Russia")?.polityKey, "Russian Federation");
  assert.equal(getPoliticalProfile(world, "RUS")?.polityKey, "Russian Federation");
  assert.equal(getPoliticalProfile(world, "Poland")?.polityKey, "Republic of Poland");
  assert.equal(getPoliticalProfile(world, "POL")?.polityKey, "Republic of Poland");
  assert.equal(getPoliticalProfile(world, "Ukraine")?.polityKey, "Ukraine");
});

test("a polity of its own never borrows another polity's actor through the stock-country bridge", () => {
  const declared = makeWorld();
  declared.polityOverrides.Russia = { name: "Russia", aliases: [], code: "Russia", status: "active" };
  assert.equal(getPoliticalProfile(declared, "Russia"), null);
  assert.equal(getPoliticalProfile(declared, "Russian Federation")?.polityKey, "Russian Federation");

  const ensured = ensurePoliticalProfile(declared, "Russia");
  assert.equal(ensured.polityKey, "Russia");
  assert.equal(declared.politicalActors.byPolity["Russian Federation"].leader, "Vladimir Putin");
  assert.equal(getPoliticalProfile(declared, "Russia"), ensured);

  const owner = makeWorld();
  owner.regionOwnershipOverrides = { "RUS.1_1": "Russia", "RUS.2_1": "Russian Federation" };
  assert.equal(getPoliticalProfile(owner, "Russia"), null);

  // A map owner whose actor sits under a name that is not a polity of its own
  // still finds it.
  const legacy = makeWorld();
  legacy.regionOwnershipOverrides = { "POL.1_1": "Poland" };
  delete legacy.polityOverrides["Republic of Poland"];
  assert.equal(getPoliticalProfile(legacy, "Poland")?.polityKey, "Republic of Poland");
});

test("political actor normalization owns a fresh mutable copy", () => {
  const source = makeWorld().politicalActors;
  const normalized = normalizePoliticalActors(source);

  normalized.byPolity.Ukraine.leader = "Changed";
  normalized.byPolity.Ukraine.government.headOfState = "Changed";

  assert.equal(source.byPolity.Ukraine.leader, "Petro Poroshenko");
  assert.equal(source.byPolity.Ukraine.government.headOfState, "Petro Poroshenko");
});

test("a party with no id of its own is named for its name in any script, as its English twin is", async () => {
  // Cut to a-z and 0-9, a party named in another script with a number in its
  // name was that number: "Партия 1" was "1", and so was every other "… 1".
  const { normalizePoliticalParty } = await import("./politicalActors.js");
  const idOf = (party) => normalizePoliticalParty(party).id;
  assert.equal(idOf({ name: "United Russia", shortName: "UR" }), "ur", "as it always was");
  assert.equal(idOf({ name: "Law and Justice" }), "law-and-justice", "as it always was");
  for (const [first, second] of [["Party 1", "Union 1"], ["Партия 1", "Союз 1"], ["第一党", "第二党"]]) {
    assert.notEqual(idOf({ name: first }), idOf({ name: second }), first);
    assert.notEqual(idOf({ name: first }), "1", first);
  }
  // A name wholly in another script keeps the id it always had (a hash of it),
  // and a Latin alias still names a party written in another script.
  assert.match(idOf({ name: "Единая Россия" }), /^party-[0-9a-f]{8}$/);
  assert.equal(idOf({ name: "Единая Россия", aliases: ["United Russia"] }), "united-russia");
});
