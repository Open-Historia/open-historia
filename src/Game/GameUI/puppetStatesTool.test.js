/*! Open Historia — GM Puppet States tool tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/puppetStatesTool.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { applyGmPuppetChange, describeGmPuppetChange, gmPuppetRows, gmPuppetUpdates } from "./puppetStatesTool.js";

// A hand edit is a ledger line like any other, minus the causal event: it must
// obey every rule the AI's lines do, and fail with the ledger's own reason.

const baseWorld = {
  polityOverrides: {
    USSR: { code: "USSR", name: "USSR" },
    Poland: { code: "Poland", name: "Poland" },
    Germany: { code: "Germany", name: "Germany" },
    Slovakia: { code: "Slovakia", name: "Slovakia" },
  },
  regionOwnershipOverrides: { r1: "USSR", r2: "Poland", r3: "Germany", r4: "Slovakia" },
  relations: [],
  agreements: [],
  puppets: [],
  internationalReputation: { USSR: 50 },
};

const at = { date: "1945-06-28", round: 3 };
const install = (world, fields = {}) => applyGmPuppetChange(world, { op: "install", overlord: "USSR", puppet: "Poland", kind: "satellite", loyalty: 40, secrecy: "covert", ...fields }, at);

test("installing by hand writes the row an AI install would, with no event", () => {
  const { world, error, summary } = install(baseWorld);
  assert.equal(error, "");
  assert.equal(world.puppets.length, 1);
  const [row] = world.puppets;
  assert.equal(row.overlord, "USSR");
  assert.equal(row.puppet, "Poland");
  assert.equal(row.kind, "satellite");
  assert.equal(row.loyalty, 40);
  assert.equal(row.secrecy, "covert");
  assert.equal(row.status, "active");
  assert.equal(row.startedDate, "1945-06-28");
  assert.deepEqual(row.sourceEventIds, []);
  assert.deepEqual(row.knownTo.map((entry) => entry.polity).sort(), ["Poland", "USSR"]);
  assert.equal(summary, "Made Poland USSR's puppet state by hand (covert, loyalty 40).");
});

test("a hand edit is refused with the ledger's own reason", () => {
  const held = install(baseWorld).world;
  const second = applyGmPuppetChange(held, { op: "install", overlord: "Germany", puppet: "Poland", kind: "client", loyalty: 50 }, at);
  assert.match(second.error, /already the satellite of USSR/);
  assert.equal(second.world, held, "nothing changes on a refusal");

  const unknown = applyGmPuppetChange(baseWorld, { op: "install", overlord: "USSR", puppet: "Atlantis" }, at);
  assert.match(unknown.error, /"Atlantis" is not a country this world knows/);

  const self = applyGmPuppetChange(baseWorld, { op: "install", overlord: "USSR", puppet: "USSR" }, at);
  assert.match(self.error, /cannot be its own puppet/);

  assert.match(applyGmPuppetChange(baseWorld, { op: "install", overlord: "", puppet: "Poland" }, at).error, /Pick both/);
});

test("an edit sends only what changed, as reclassify and loyalty lines", () => {
  const held = install(baseWorld).world;
  assert.deepEqual(gmPuppetUpdates(held, { op: "edit", overlord: "USSR", puppet: "Poland", kind: "satellite", loyalty: 40 }), []);
  assert.deepEqual(
    gmPuppetUpdates(held, { op: "edit", overlord: "USSR", puppet: "Poland", kind: "client", loyalty: 72 }).map((update) => update.op),
    ["reclassify", "loyalty"],
  );
  const edited = applyGmPuppetChange(held, { op: "edit", overlord: "USSR", puppet: "Poland", kind: "client", loyalty: 72 }, at);
  assert.equal(edited.error, "");
  assert.equal(edited.world.puppets[0].kind, "client");
  assert.equal(edited.world.puppets[0].loyalty, 72);
  assert.equal(edited.summary, "Changed USSR's hold on Poland by hand: now a client state; loyalty 40 → 72.");
});

test("a reveal makes a covert row public, for good", () => {
  const held = install(baseWorld).world;
  const revealed = applyGmPuppetChange(held, { op: "reveal", overlord: "USSR", puppet: "Poland" }, at);
  assert.equal(revealed.world.puppets[0].secrecy, "open");
  assert.equal(revealed.summary, "Made it public by hand that Poland is USSR's puppet state.");
  const again = applyGmPuppetChange(revealed.world, { op: "install", overlord: "USSR", puppet: "Poland", kind: "satellite", loyalty: 40, secrecy: "covert" }, at);
  assert.equal(again.world.puppets[0].secrecy, "open", "a secret that is out stays out");
});

test("release and annex end the row; annex charges the Overlord's reputation as the AI's would", () => {
  const held = install(baseWorld).world;
  const released = applyGmPuppetChange(held, { op: "release", overlord: "USSR", puppet: "Poland" }, at);
  assert.equal(released.world.puppets[0].status, "released");
  assert.equal(released.world.puppets[0].endedDate, "1945-06-28");
  assert.equal(released.summary, "Released Poland from being USSR's puppet state by hand.");

  const annexed = applyGmPuppetChange(held, { op: "annex", overlord: "USSR", puppet: "Poland" }, at);
  assert.equal(annexed.world.puppets[0].status, "annexed");
  assert.equal(annexed.world.internationalReputation.USSR, 42, "a covert arrangement costs 8");
  assert.equal(annexed.world.regionOwnershipOverrides.r2, "Poland", "annexing the arrangement moves no land by itself");
  assert.equal(annexed.summary, "Ended Poland's standing as USSR's puppet state by hand: USSR annexed it.");
});

test("a change to an arrangement that is not standing is refused", () => {
  const released = applyGmPuppetChange(install(baseWorld).world, { op: "release", overlord: "USSR", puppet: "Poland" }, at).world;
  const again = applyGmPuppetChange(released, { op: "annex", overlord: "USSR", puppet: "Poland" }, at);
  assert.match(again.error, /USSR does not direct Poland now/);
  assert.equal(again.world, released);
});

test("a country with no land left cannot be made a puppet by hand either", () => {
  const catalog = [{ id: "r2", country: "Poland", countryCode: "POL" }, { id: "r1", country: "USSR", countryCode: "SUN" }];
  const world = { ...baseWorld, regionOwnershipOverrides: { r1: "USSR", r2: "USSR" } };
  const result = applyGmPuppetChange(world, { op: "install", overlord: "USSR", puppet: "Poland" }, { ...at, regionCatalog: catalog });
  assert.match(result.error, /Poland holds no territory/);
});

test("the rows list standing arrangements apart from ended ones", () => {
  const world = {
    puppets: [
      { id: "p1", overlord: "France", puppet: "Monaco", status: "released" },
      { id: "p2", overlord: "Italy", puppet: "Monaco", status: "active" },
      { id: "p3", overlord: "", puppet: "Nowhere", status: "active" },
    ],
  };
  const rows = gmPuppetRows(world);
  assert.deepEqual(rows.live.map((row) => row.id), ["p2"]);
  assert.deepEqual(rows.ended.map((row) => row.id), ["p1"]);
});

test("each change is described for the next time skip", () => {
  assert.equal(describeGmPuppetChange({ op: "install", overlord: "France", puppet: "Monaco", kind: "protectorate", loyalty: 80, secrecy: "open" }),
    "Made Monaco France's protectorate by hand (openly known, loyalty 80).");
});
