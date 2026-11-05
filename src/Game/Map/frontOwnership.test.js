// Run: node --test src/Game/Map/frontOwnership.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  contestedOwnersOf, drawnOwnersOf, getFrontShownOwners, resetFrontShownOwnersForTest, setFrontShownOwners, shownOwnerIds,
  subscribeFrontShownOwners, withShownOwners, withoutShownTransitions,
} from "./frontOwnership.js";

test("the map is told whose each region being taken is drawn as, and only when that changes", () => {
  resetFrontShownOwnersForTest();
  let told = 0;
  const stop = subscribeFrontShownOwners(() => { told += 1; });
  assert.deepEqual(getFrontShownOwners(), {});
  // Two battlefields, one with nothing to say.
  const east = Object.freeze({ "region-4": "Ukraine", "region-9": "Ukraine" });
  assert.equal(setFrontShownOwners([east, null]), true);
  assert.deepEqual(getFrontShownOwners(), { "region-4": "Ukraine", "region-9": "Ukraine" });
  assert.equal(told, 1);
  const first = getFrontShownOwners();
  // The same again, as every frame of a playing gives it: nobody is told.
  assert.equal(setFrontShownOwners([east, null]), false);
  assert.equal(setFrontShownOwners([{ "region-9": "Ukraine", "region-4": "Ukraine" }]), false, "nor for the same said another way");
  assert.equal(getFrontShownOwners(), first);
  assert.equal(told, 1);
  // One region is held in full and drawn as the taker's from now.
  assert.equal(setFrontShownOwners([{ "region-4": "Russia", "region-9": "Ukraine" }]), true);
  assert.equal(getFrontShownOwners()["region-4"], "Russia");
  assert.equal(told, 2);
  // No battlefield left: nothing is drawn differently from the world.
  assert.equal(setFrontShownOwners([]), true);
  assert.deepEqual(getFrontShownOwners(), {});
  assert.equal(setFrontShownOwners(null), false);
  assert.equal(told, 3);
  stop();
  setFrontShownOwners([east]);
  assert.equal(told, 3, "one that stopped listening is not told");
  resetFrontShownOwnersForTest();
});

test("what a battlefield draws is laid over the world's owners, and the world's own list comes back when nothing differs", () => {
  const world = { "region-1": "Ukraine", "region-4": "Russia", "region-9": "Russia" };
  // Nothing to lay over it.
  assert.equal(withShownOwners(world, {}), world);
  assert.equal(withShownOwners(world, null), world);
  // The world says region 4 and 9 are Russia's (taken in name); they are still drawn as Ukraine's.
  const drawn = withShownOwners(world, { "region-4": "Ukraine", "region-9": "Ukraine" });
  assert.deepEqual(drawn, { "region-1": "Ukraine", "region-4": "Ukraine", "region-9": "Ukraine" });
  assert.deepEqual(world, { "region-1": "Ukraine", "region-4": "Russia", "region-9": "Russia" }, "the world's own list is not touched");
  // Held in full: drawn as the world says, and so it IS the world's list.
  assert.equal(withShownOwners(world, { "region-4": "Russia", "region-9": "Russia" }), world);
  // A region the world has no word on yet still takes what it is drawn as.
  assert.deepEqual(withShownOwners(undefined, { "region-2": "Ukraine" }), { "region-2": "Ukraine" });
  // A name is put the way the map keys its polities.
  const polities = { RUS: { code: "RUS", name: "Russian Federation" } };
  assert.equal(withShownOwners({ "region-4": "Ukraine" }, { "region-4": "Russian Federation" }, polities)["region-4"], "RUS");
});

test("a change of what a battlefield draws is not swept across the map", () => {
  const sweep = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", id: "region-4", properties: { id: "region-4", fromOwner: "Ukraine", toOwner: "Russia" } },
      { type: "Feature", id: "region-20", properties: { id: "region-20", fromOwner: "Austria", toOwner: "Germany" } },
    ],
  };
  const quiet = shownOwnerIds({ "region-4": "Ukraine" }, { "region-4": "Russia", "region-9": "Ukraine" });
  assert.deepEqual([...quiet].sort(), ["region-4", "region-9"]);
  const kept = withoutShownTransitions(sweep, quiet);
  assert.deepEqual(kept.features.map((feature) => feature.id), ["region-20"], "a change by treaty in the same breath is still swept");
  assert.equal(withoutShownTransitions(sweep, new Set()), sweep);
  assert.equal(withoutShownTransitions(sweep, new Set(["region-77"])), sweep, "the same list when none of it is theirs");
  assert.equal(withoutShownTransitions(null, quiet), null);
  assert.deepEqual(withoutShownTransitions({ type: "FeatureCollection", features: [sweep.features[0]] }, quiet).features, []);
});

test("a record's regions taken in name and not in full are read as whose each is still drawn as", () => {
  const record = { contested: [["region-4", "Ukraine"], ["region-9", "Ukraine"], ["", "x"], ["region-2", 3]] };
  assert.deepEqual(contestedOwnersOf(record), { "region-4": "Ukraine", "region-9": "Ukraine" });
  assert.equal(contestedOwnersOf(record), contestedOwnersOf(record), "read once");
  assert.equal(contestedOwnersOf({ contested: [] }), null);
  assert.equal(contestedOwnersOf(null), null);
});

test("forces standing in peace hold no region back: an annexed country's land is drawn as its annexer's", () => {
  // As the player's save had it: Italy's forces at home, a record standing in
  // peace, listing two regions of Tunisia, which the story had annexed to
  // Italy, as still drawn as Tunisia's. The map painted them in Tunisia's
  // colour under Tunisia's name, though a click said they were Italy's.
  const world = { 3886: "People's Republic Of Italy", 3867: "People's Republic Of Italy" };
  const home = {
    name: "People's Republic Of Italy home forces",
    status: "standing",
    home: true,
    sides: [["People's Republic Of Italy"], ["People's Democratic Republic of Algeria"]],
    replay: null,
    contested: [["3886", "Republic of Tunisia"], ["3867", "Republic of Tunisia"]],
  };
  assert.equal(drawnOwnersOf(home, 3), null);
  resetFrontShownOwnersForTest();
  setFrontShownOwners([drawnOwnersOf(home, 3)]);
  assert.equal(withShownOwners(world, getFrontShownOwners()), world, "drawn as the world says");
  // A battlefield being fought over still holds back what it has taken in name only.
  const front = { ...home, name: "The front", status: "active", home: undefined };
  assert.deepEqual(drawnOwnersOf(front, 3), { 3886: "Republic of Tunisia", 3867: "Republic of Tunisia" });
  assert.equal(drawnOwnersOf(null, 3), null);
  resetFrontShownOwnersForTest();
});
