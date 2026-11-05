// Run: node --test src/runtime/worldLookups.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { lookedUp, readingWorld } from "./worldLookups.js";
import { getPoliticalProfile } from "./politicalActors.js";
import { buildPolityIdentityIndex } from "./polityIdentity.js";
import { buildBoundedPoliticalDecisionContextSet } from "../Game/AI/politicalDecisionContext.js";

const counter = () => {
  let calls = 0;
  return { work: () => { calls += 1; return { calls }; }, calls: () => calls };
};

test("outside a read nothing is kept", () => {
  const world = {};
  const { work, calls } = counter();
  lookedUp(world, "q", work);
  lookedUp(world, "q", work);
  assert.equal(calls(), 2);
});

test("inside a read each answer is worked out once and is the same object", () => {
  const world = {};
  const { work, calls } = counter();
  readingWorld(world, () => {
    assert.equal(lookedUp(world, "q", work), lookedUp(world, "q", work));
  });
  assert.equal(calls(), 1);
});

test("questions and keys are told apart, and undefined and null are keys like any other", () => {
  const world = {};
  const { work, calls } = counter();
  readingWorld(world, () => {
    for (const key of ["a", "b", undefined, null, 0, ""]) {
      lookedUp(world, "q", work, key);
      lookedUp(world, "q", work, key);
    }
    lookedUp(world, "other", work, "a");
  });
  assert.equal(calls(), 7);
});

test("an answer of nothing is kept too", () => {
  const world = {};
  for (const answer of [null, undefined, false, 0, ""]) {
    let calls = 0;
    readingWorld(world, () => {
      lookedUp(world, "q", () => { calls += 1; return answer; });
      lookedUp(world, "q", () => { calls += 1; return answer; });
    });
    assert.equal(calls, 1, String(answer));
  }
});

test("another world is never answered from this one's", () => {
  const world = {};
  const other = {};
  const { work, calls } = counter();
  readingWorld(world, () => {
    lookedUp(world, "q", work);
    lookedUp(other, "q", work);
    lookedUp(other, "q", work);
  });
  assert.equal(calls(), 3);
});

// gameState.js edits worlds in place, so nothing may outlive the read that asked.
test("a world edited between reads gets a fresh answer", () => {
  const world = { owner: "a" };
  const ask = () => readingWorld(world, () => lookedUp(world, "q", () => world.owner));
  assert.equal(ask(), "a");
  world.owner = "b";
  assert.equal(ask(), "b");
});

test("a read inside a read stays one read", () => {
  const world = {};
  const { work, calls } = counter();
  readingWorld(world, () => {
    lookedUp(world, "q", work);
    readingWorld(world, () => lookedUp(world, "q", work));
    lookedUp(world, "q", work);
  });
  assert.equal(calls(), 1);
});

test("a read that throws ends, and gives back what it returned otherwise", () => {
  const world = {};
  assert.throws(() => readingWorld(world, () => { throw new Error("no"); }));
  const { work, calls } = counter();
  lookedUp(world, "q", work);
  lookedUp(world, "q", work);
  assert.equal(calls(), 2);
  assert.equal(readingWorld(world, () => 5), 5);
});

test("with no world there is no read, and the work is still done", () => {
  assert.equal(readingWorld(null, () => 1), 1);
  assert.equal(readingWorld(undefined, () => 2), 2);
  assert.equal(lookedUp(null, "q", () => 3), 3);
  assert.equal(lookedUp(undefined, "q", () => 4), 4);
});

// Callers leave the world out: the map before a game opens, a flag with no world to hand.
test("a world left out is no world, not the read in progress", () => {
  assert.equal(getPoliticalProfile(undefined, "France"), null);
  assert.doesNotThrow(() => buildPolityIdentityIndex(undefined));
  assert.equal(readingWorld({}, () => lookedUp(undefined, "q", () => 5)), 5);
});

const worldOf = (count) => {
  const byPolity = {};
  const polityOverrides = {};
  const regionOwnershipOverrides = {};
  for (let index = 0; index < count; index += 1) {
    const name = `Polity ${index}`;
    byPolity[name] = { name, polityKey: name };
    polityOverrides[name] = { name };
    for (let region = 0; region < 20; region += 1) regionOwnershipOverrides[`r${index}-${region}`] = name;
  }
  return {
    politicalActors: { byPolity },
    polityOverrides,
    regionOwnershipOverrides,
    relations: Array.from({ length: count }, (_, index) => ({ a: `Polity ${index}`, b: "Polity 0", score: 10 })),
    agreements: [],
  };
};

// A Proxy counts each walk of every region's owner, the scan this exists to stop repeating.
const countingRegionWalks = (world) => {
  const walks = { count: 0 };
  world.regionOwnershipOverrides = new Proxy(world.regionOwnershipOverrides, {
    ownKeys(target) {
      walks.count += 1;
      return Reflect.ownKeys(target);
    },
  });
  return walks;
};

test("region owners are walked no more often for 20 governments than for 2", () => {
  const walksFor = (actors) => {
    const world = worldOf(24);
    const walks = countingRegionWalks(world);
    buildBoundedPoliticalDecisionContextSet(world, {
      actorPolities: Array.from({ length: actors }, (_, index) => `Polity ${index}`),
      maxActors: actors,
    });
    return walks.count;
  };
  const few = walksFor(2);
  const many = walksFor(20);
  assert.ok(few > 0, "the fixture reaches the scan");
  assert.ok(many <= few + 2, `${few} walks for 2 governments, ${many} for 20`);
});

test("the answers inside a read are the answers outside one", () => {
  const world = worldOf(6);
  for (const name of ["Polity 1", "polity 2", "Nowhere", "", null]) {
    const outside = getPoliticalProfile(world, name);
    const inside = readingWorld(world, () => getPoliticalProfile(world, name));
    assert.equal(inside, outside, String(name));
  }
  assert.deepEqual(readingWorld(world, () => buildPolityIdentityIndex(world)), buildPolityIdentityIndex(world));
});

test("a build leaves the world as it found it, and gives the same text twice", () => {
  const world = worldOf(6);
  const before = JSON.stringify(world);
  const options = { actorPolities: ["Polity 1", "Polity 2"], maxActors: 2 };
  const first = buildBoundedPoliticalDecisionContextSet(world, options);
  const second = buildBoundedPoliticalDecisionContextSet(world, options);
  assert.equal(first.text, second.text);
  assert.equal(JSON.stringify(world), before);
});

test("an edit between two builds is seen by the second", () => {
  const world = worldOf(3);
  const options = { actorPolities: ["Polity 1"], maxActors: 1, counterpartByActor: { "Polity 1": "Polity 0" } };
  const before = buildBoundedPoliticalDecisionContextSet(world, options);
  world.relations[1].score = -90;
  world.relations[1].status = "hostile";
  const after = buildBoundedPoliticalDecisionContextSet(world, options);
  assert.notEqual(after.text, before.text);
});
