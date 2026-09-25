import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPoliticalActorMetadataPatch,
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

test("legacy political metadata migration helper remains available without making Stats the normal write authority", () => {
  const world = makeWorld();

  const updated = applyPoliticalActorMetadataPatch(world, "Poland", {
    government: "Presidential republic",
    leader: "Test Leader",
  });

  assert.ok(updated);
  assert.equal(updated.government.form, "Presidential republic");
  assert.equal(updated.government.headOfState, "Test Leader");
  assert.equal(updated.leader, "Test Leader");
  assert.equal(getPoliticalProfile(world, "Republic of Poland")?.leader, "Test Leader");
});


test("political actor normalization owns a fresh mutable copy", () => {
  const source = makeWorld().politicalActors;
  const normalized = normalizePoliticalActors(source);

  normalized.byPolity.Ukraine.leader = "Changed";
  normalized.byPolity.Ukraine.government.headOfState = "Changed";

  assert.equal(source.byPolity.Ukraine.leader, "Petro Poroshenko");
  assert.equal(source.byPolity.Ukraine.government.headOfState, "Petro Poroshenko");
});
