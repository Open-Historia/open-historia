import test from "node:test";
import assert from "node:assert/strict";
import { applyCountryStatPatchToWorld, normalizeWorldState } from "./gameState.js";
import { buildPoliticalActorLegacyStatsProjection } from "./politicalActors.js";

const withActor = () => normalizeWorldState({
  countryStats: {
    Albion: { leader: "Current President", government: "constitutional republic", stability: 64 },
  },
  politicalActors: {
    schemaVersion: 6,
    byPolity: {
      Albion: {
        polityKey: "Albion",
        name: "Albion",
        government: { form: "constitutional republic", headOfState: { name: "Current President" } },
        leader: { name: "Current President" },
      },
    },
  },
});

// A divergent mirror is replaced by the actor's projection, not refused: the sheets that carry one are mostly the
// AI's, written after their request was spent (review of beta-stats-v2, 2026-11-03).
test("non-event Stats patch cannot fork a canonical Political Actor government or head of state", () => {
  const world = withActor();
  assert.deepEqual(buildPoliticalActorLegacyStatsProjection(world, "Albion"), {
    government: "constitutional republic", leader: "Current President",
  });
  const sheet = applyCountryStatPatchToWorld(world, "Albion", { leader: "Different President", stability: 50 });
  assert.equal(sheet.leader, "Current President", "the mirror is the actor's");
  assert.equal(sheet.stability, 50, "the rest of the patch lands");
  const again = applyCountryStatPatchToWorld(world, "Albion", { government: "military dictatorship" });
  assert.equal(again.government, "constitutional republic");
});

test("native actor projection and unrelated Statistics edits stay writable", () => {
  const world = withActor();
  const synced = applyCountryStatPatchToWorld(world, "Albion", {
    leader: "Current President", government: "constitutional republic", stability: 62,
  });
  assert.equal(synced.stability, 62);
  assert.equal(synced.leader, "Current President");
  assert.equal(synced.government, "constitutional republic");
  const unrelated = applyCountryStatPatchToWorld(world, "Albion", { stability: 60 });
  assert.equal(unrelated.stability, 60);
});

test("legacy-only scenarios still allow their own non-Political-World leadership metadata", () => {
  const world = normalizeWorldState({
    countryStats: { Albion: { leader: "Old Leader", stability: 60 } },
  });
  const sheet = applyCountryStatPatchToWorld(world, "Albion", {
    leader: "New Leader", government: "caretaker cabinet",
  });
  assert.equal(sheet.leader, "New Leader");
  assert.equal(sheet.government, "caretaker cabinet");
});

test("a Political Actor without an established projection does not authorize guessed mirror fields", () => {
  const world = normalizeWorldState({
    countryStats: { Albion: { stability: 60 } },
    politicalActors: { schemaVersion: 6, byPolity: { Albion: {
      polityKey: "Albion", government: {}, parties: [],
    } } },
  });
  applyCountryStatPatchToWorld(world, "Albion", { leader: "Unrecorded Leader" });
  assert.equal(world.countryStats.Albion.leader, undefined, "a guessed mirror is left out");
});
