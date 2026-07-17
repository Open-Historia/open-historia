/*! Open Historia — owner migration tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: npm test
//
// The fixtures below are TRANSCRIBED FROM THE REAL SHIPPED DATA, not invented.
// They were validated by running the resolver over all eight scenarios first —
// 240 owners -> 231 names on default, ROM -> "Roman Empire" on roman-117, and so
// on — and then reduced to the smallest shape that still exercises each rule.
//
// They are fixtures rather than the live files for a reason worth keeping: this
// migration REWRITES the shipped data, so a test that reads server/data stops
// testing the moment it succeeds once. It skips silently and looks green forever.

import test from "node:test";
import assert from "node:assert/strict";
import {
  OWNER_SCHEMA,
  buildOwnerRenameMap,
  migrateChat,
  migrateEvents,
  migrateGame,
  migrateRegions,
  migrateWorld,
  needsMigration,
  resolveOwnerName,
} from "./ownerMigration.js";

// A slice of the real server/country-names.json. The six-codes-for-India shape is
// exactly what ships.
const REGISTRY = {
  RUS: "Russia", IND: "India", CHN: "China", PAK: "Pakistan", MEX: "Mexico",
  CIV: "Cote d'Ivoire", FRA: "France", THA: "Thailand", DEU: "Germany",
  Z01: "India", Z02: "China", Z03: "China", Z04: "India", Z05: "India",
  Z06: "Pakistan", Z07: "India", Z08: "China", Z09: "India",
};

const region = (id, owner, gid0, country) => ({
  type: "Feature",
  geometry: null,
  properties: { id, owner, gid0, name: `${id} region`, country, typeId: "land" },
});

// default/world.json really does carry these: auto-generated polities for each
// disputed sliver whose name IS the code, coloured a shared "disputed" teal.
const degenerateZ = (code) => ({ code, name: code, aliases: [], color: "#40aebf", note: "" });

const DEFAULT_LIKE = () => ({
  world: {
    polityOverrides: { Z01: degenerateZ("Z01"), Z02: degenerateZ("Z02"), Z06: degenerateZ("Z06") },
    regionOwnershipOverrides: {},
    ownerCodes: ["RUS", "IND", "Z01", "CHN", "Z02", "PAK", "Z06"],
    countryTags: { IND: ["real"], Z01: ["disputed"] },
    internationalReputation: { IND: 50, RUS: 40 },
    units: [{ id: "u1", ownerCode: "RUS" }],
  },
  game: { country: "RUS" },
  meta: {},
  colors: { RUS: [1, 1, 1], IND: [226, 135, 40], Z01: [64, 176, 191], CHN: [245, 12, 55], Z02: [64, 174, 191] },
  regions: {
    type: "FeatureCollection",
    features: [
      region("RUS.12_1", "RUS", "RUS", "Russia"),
      region("IND.1_1", "IND", "IND", "India"),
      region("Z01.1_1", "Z01", "Z01", "India"),   // Jammu and Kashmir
      region("MEX.1_1", "MEX", "MEX", "México"),   // note the accent, as the seed has it
    ],
  },
});

// roman-117: ONE owner spanning many modern countries. This is the shape that
// makes "self-migrate from region.country" impossible.
const ROMAN_LIKE = () => ({
  world: {
    polityOverrides: { ROM: { code: "ROM", name: "Roman Empire", aliases: ["Rome", "SPQR"] } },
    regionOwnershipOverrides: { "FRA.1_1": "ROM", "ITA.1_1": "ROM", "EGY.1_1": "ROM" },
    ownerCodes: ["ROM"],
  },
  game: { country: "ROM" },
  meta: {},
  colors: { ROM: [163, 28, 28] },
  regions: {
    type: "FeatureCollection",
    features: [
      region("FRA.1_1", "FRA", "FRA", "France"),
      region("ITA.1_1", "ITA", "ITA", "Italy"),
      region("EGY.1_1", "EGY", "EGY", "Egypt"),
    ],
  },
});

const ctxOf = (f) => ({
  polityOverrides: f.world.polityOverrides,
  countryNameOverrides: f.meta.countryNameOverrides,
  registry: REGISTRY,
  features: f.regions.features,
  ownershipOverrides: f.world.regionOwnershipOverrides,
  ownerCodes: f.world.ownerCodes,
  colors: f.colors,
  units: f.world.units,
  countryTags: f.world.countryTags,
  internationalReputation: f.world.internationalReputation,
  gameCountry: f.game.country,
});

test("the disputed territories merge into their claimants", () => {
  const ctx = ctxOf(DEFAULT_LIKE());
  assert.equal(resolveOwnerName("RUS", ctx), "Russia");
  assert.equal(resolveOwnerName("Z01", ctx), "India");     // Jammu and Kashmir
  assert.equal(resolveOwnerName("Z06", ctx), "Pakistan");  // Azad Kashmir
  assert.equal(resolveOwnerName("Z02", ctx), "China");     // Aksai Chin
  // Measured against the real default scenario when this was written: 240 owner
  // codes collapse to 231 names, because 9 Z0x placeholders join 3 claimants.
  const codes = ["IND", "Z01", "Z04", "Z05", "Z07", "Z09"];
  assert.equal(new Set(codes.map((c) => resolveOwnerName(c, ctx))).size, 1);
});

test("rule 1 beats rule 3: a scenario's polity wins over the registry", () => {
  const ctx = ctxOf(ROMAN_LIKE());
  // ROM owns regions whose country values are France, Italy and Egypt. Consensus
  // must NOT fire — this is the case that kills the obvious design.
  assert.equal(resolveOwnerName("ROM", ctx), "Roman Empire");
});

test("the name !== token guard: a self-named degenerate must not win", () => {
  const ctx = ctxOf(DEFAULT_LIKE());
  // polityOverrides.Z01.name === "Z01". Without the guard rule 1 returns "Z01",
  // you ship a country called Z01, and the merge above silently dies.
  assert.equal(ctx.polityOverrides.Z01.name, "Z01", "fixture must keep the real degenerate shape");
  assert.equal(resolveOwnerName("Z01", ctx), "India");
});

test("rule 2 is the only thing that saves a legacy label", () => {
  const f = DEFAULT_LIKE();
  f.meta.countryNameOverrides = { THA: "Siam" }; // wwii-1939's hand-authored label
  const ctx = ctxOf(f);
  assert.equal(resolveOwnerName("THA", ctx), "Siam");
  // Without the override it is just Thailand — proving rule 2 is doing the work.
  assert.equal(resolveOwnerName("THA", ctxOf(DEFAULT_LIKE())), "Thailand");
});

test("rule 3 beats rule 4: the registry is more correct than region.country", () => {
  const ctx = ctxOf(DEFAULT_LIKE());
  // The region says "México"; the registry says "Mexico". Everything else in the
  // codebase matches against the registry's form.
  assert.equal(ctx.features.find((f) => f.properties.owner === "MEX").properties.country, "México");
  assert.equal(resolveOwnerName("MEX", ctx), "Mexico");
});

test("rule 4 names an FMG world, rule 5 leaves it alone", () => {
  const fmg = {
    world: { polityOverrides: { Votengia: { code: "Votengia", name: "Votengia" } }, regionOwnershipOverrides: {} },
    game: { country: "Votengia" }, meta: {}, colors: {},
    regions: { type: "FeatureCollection", features: [region("reg_1", "YAR4", "YAR4", "Yardibyurt")] },
  };
  const ctx = ctxOf(fmg);
  // Consensus: YAR4's only region says Yardibyurt.
  assert.equal(resolveOwnerName("YAR4", ctx), "Yardibyurt");
  // A self-named polity that resolves to ITSELF is real, not degenerate — the
  // guard must not eat it.
  assert.equal(resolveOwnerName("Votengia", ctx), "Votengia");
});

test("degenerate polities are dropped, real self-named ones survive", () => {
  const f = DEFAULT_LIKE();
  f.world.polityOverrides.Votengia = { code: "Votengia", name: "Votengia" };
  const renames = buildOwnerRenameMap(ctxOf(f));
  const out = migrateWorld(f.world, renames, () => {});
  // Z01/Z02/Z06 claimed to be named after themselves while the registry says
  // otherwise: they carry nothing, and renaming them would assert "India is a
  // custom polity called India" coloured Kashmir's teal — which promptContext
  // then teaches the model.
  assert.deepEqual(Object.keys(out.polityOverrides), ["Votengia"]);
});

test("collisions resolve to the real country, not the disputed placeholder", () => {
  const f = DEFAULT_LIKE();
  const renames = buildOwnerRenameMap(ctxOf(f));
  const out = migrateWorld(f.world, renames, () => {});
  // IND and Z01 both become "India". India keeps India's tags, not Kashmir's.
  assert.deepEqual(out.countryTags, { India: ["real"] });
  assert.deepEqual(out.internationalReputation, { India: 50, Russia: 40 });
  assert.deepEqual([...out.ownerCodes].sort(), ["China", "India", "Pakistan", "Russia"]);
});

test("units, game.country and the marker", () => {
  const f = DEFAULT_LIKE();
  const renames = buildOwnerRenameMap(ctxOf(f));
  const world = migrateWorld(f.world, renames, () => {});
  assert.equal(world.units[0].ownerCode, "Russia");
  assert.equal(world.ownerSchema, OWNER_SCHEMA);
  assert.equal(needsMigration(world), false);
  assert.equal(migrateGame(f.game, renames).country, "Russia");
  // A preset's played country reaches its polity, not a raw code.
  const r = ROMAN_LIKE();
  assert.equal(migrateGame(r.game, buildOwnerRenameMap(ctxOf(r))).country, "Roman Empire");
});

test("regions keep id and gid0, lose country, gain a named owner", () => {
  const f = DEFAULT_LIKE();
  const out = migrateRegions(f.regions, buildOwnerRenameMap(ctxOf(f)));
  const sample = out.features[0];
  assert.equal(sample.properties.owner, "Russia");
  assert.equal(sample.properties.id, "RUS.12_1", "region id is not owner-space");
  assert.equal(sample.properties.gid0, "RUS", "gid0 stays as GADM provenance");
  assert.ok(!("country" in sample.properties), "country is duplicate state once owner is the name");
});

test("the replayed storage surfaces move too", () => {
  const f = DEFAULT_LIKE();
  const renames = buildOwnerRenameMap(ctxOf(f));
  // events.json is replayed INTO world by applyEventImpactsToWorld, so a code left
  // here is re-injected into a migrated world later.
  const events = migrateEvents(
    [{ impacts: { regionTransfers: [{ toCode: "IND", fromCode: "Z01" }], polityChanges: [{ code: "RUS" }], unitOps: [{ unit: { ownerCode: "CHN" } }] } }],
    renames,
  );
  assert.equal(events[0].impacts.regionTransfers[0].toCode, "India");
  assert.equal(events[0].impacts.regionTransfers[0].fromCode, "India");
  assert.equal(events[0].impacts.polityChanges[0].code, "Russia");
  assert.equal(events[0].impacts.unitOps[0].unit.ownerCode, "China");

  const chat = migrateChat({ countries: [{ code: "RUS" }], messages: [{ code: "IND", reactions: { "👍": { code: "CHN" } } }] }, renames);
  assert.equal(chat.countries[0].code, "Russia");
  assert.equal(chat.messages[0].code, "India");
  assert.equal(chat.messages[0].reactions["👍"].code, "China");
});

test("migration is idempotent", () => {
  const f = DEFAULT_LIKE();
  const once = {
    world: migrateWorld(f.world, buildOwnerRenameMap(ctxOf(f)), () => {}),
    regions: migrateRegions(f.regions, buildOwnerRenameMap(ctxOf(f))),
  };
  const second = { world: once.world, game: { country: "Russia" }, meta: {}, colors: {}, regions: once.regions };
  const renames2 = buildOwnerRenameMap(ctxOf(second));
  const twice = { world: migrateWorld(once.world, renames2, () => {}), regions: migrateRegions(once.regions, renames2) };
  assert.deepEqual(twice, once);
});
