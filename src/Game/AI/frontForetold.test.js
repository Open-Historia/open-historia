/*! Open Historia — a period fought before its story is written: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontForetold.test.js
//
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
//
// A time skip's land war is fought BEFORE the skip is asked for
// (frontApply.js forecastTurnFronts), so that the story is written knowing how
// it went. This is that, with the engine itself on a drawn map: the period
// that is told is the period that is then applied, to the last troop; what
// the answer orders is for the period after; and the map moves with the events
// that tell of the war.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { applyEventImpactsToWorld, normalizeEvents } from "../../runtime/gameState.js";
import { describeBattlefield } from "../../runtime/fronts/brief.js";
import { decodeTroops } from "../../runtime/fronts/codec.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { enlarge, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { decodeFrontOrders } from "./nativeFrontLedger.js";
import { FRONTS_BLOCK_MAX, PERIOD_TEXT_MAX, buildFrontsBlock, describePeriod, describeUntold } from "./frontPrompt.js";
import { FRONT_MARK, attachFrontFlips, frontRunSpan, planFrontMoments, runTurnFronts } from "./frontTurn.js";

const legend = { A: "Aland", B: "Borduria", "~": null };
const cities = [
  { name: "Alba", lng: 20.6, lat: 51.4, capital: true },
  { name: "Brod", lng: 23.3, lat: 51.2, capital: true },
  { name: "Mid", lng: 21.7, lat: 50.9, population: 400000 },
  { name: "Eastmark", lng: 22.2, lat: 51.6, population: 90000 },
];
const sheet = () => syntheticMap({ layout: enlarge(["AAABBBBBBB", "AAABBBBBBB", "AAABBBBBBB", "AAABBBBBBB", "~~~~~~~~~~"], 2), legend, west: 20, north: 52, step: 0.25, cities });
const WAR = { id: "war-1", title: "The Border War", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-02-01", lastUpdatedDate: "2024-02-01" };
const worldOn = (map) => ({
  customRegions: true,
  regionOwnershipOverrides: Object.fromEntries(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  polityOverrides: {
    Aland: { code: "Aland", name: "Aland", aliases: [], color: "", note: "" },
    Borduria: { code: "Borduria", name: "Borduria", aliases: [], color: "", note: "" },
  },
  countryStats: { Aland: { population: { total: 2.25e6 } }, Borduria: { population: { total: 1e6 } } },
  wars: [WAR],
  battlefields: [],
  units: [],
});
const event = (id, date, extra = {}) => ({ id, date, title: `The ${id} of the war`, description: "The fighting goes on along the border.", source: "ai", impacts: {}, ...extra });
const turn = (map, world, overrides = {}) => ({
  createFrontRun,
  world,
  events: [],
  frontOrders: [],
  warStages: [world.wars],
  map: { key: "the sheet", cities: map.map.cities, flat: false },
  baseOwners: new Map(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  regionIds: map.regions.map((region) => region.id),
  arenas: new Map(),
  loadRegions: async () => map.regions,
  ...overrides,
});
const applied = (world, events, battlefields) => applyEventImpactsToWorld({ colors: {}, events, world: { ...world, battlefields } }).world;
const stand = (record) => record.troops.map((side) => decodeTroops(side).map((troop) => [Math.round(troop.x * 16), Math.round(troop.y * 16), Math.round(troop.strength)]));

// A war ten days old, Aland advancing along the whole border: what the next
// skip starts from.
const monthIn = async () => {
  const map = sheet();
  const began = worldOn(map);
  const events = normalizeEvents([event("e1", "2024-03-04"), event("e2", "2024-03-08")]);
  const first = await runTurnFronts(turn(map, began, {
    events,
    frontOrders: [{ id: "front-0", battlefield: "The Border", side: "Aland", order: "advance", sector: "all", eventIds: ["e1"] }],
    fromDate: "2024-03-01",
    toDate: "2024-03-11",
    seed: "campaign|2|2024-03-01",
  }));
  return { map, world: applied(began, first.events, first.battlefields) };
};
// The ten days after it: long enough for ground to change hands, short enough that the war is not over.
const SECOND = { fromDate: "2024-03-11", toDate: "2024-03-21", seed: "campaign|3|2024-03-11" };

test("an order for a battlefield whose period was fought beforehand is put at the end of the run; any other falls on its event's day", () => {
  const events = [event("e1", "2024-03-03"), event("e2", "2024-03-10")];
  const { days, dayOf } = frontRunSpan({ fromDate: "2024-03-01", toDate: "2024-03-31", events });
  const frontOrders = [
    { id: "front-0", battlefield: "Eastern Ukraine", side: "Russia", order: "spearhead", sector: "north", eventIds: ["e2"], objective: "city: Kharkiv" },
    { id: "front-1", battlefield: "eastern  ukraine", side: "Ukraine", order: "", sector: "all", eventIds: ["e1"], result: "surrender" },
    { id: "front-2", battlefield: "The Caucasus", side: "Russia", order: "advance", sector: "all", eventIds: ["e2"] },
    { id: "front-3", battlefield: "The Caucasus", side: "Georgia", order: "dig in", sector: "all", eventIds: [] },
  ];
  const settled = new Set(["eastern ukraine"]);
  const moments = planFrontMoments({ events, fromDate: "2024-03-01", days, dayOf, frontOrders, settled });
  assert.deepEqual(moments.map((moment) => [moment.day, moment.battlefield, moment.side, moment.order || moment.result]), [
    [0, "The Caucasus", "Georgia", "dig in"],
    [9, "The Caucasus", "Russia", "advance"],
    [30, "Eastern Ukraine", "Russia", "spearhead"],
    [30, "eastern ukraine", "Ukraine", "surrender"],
  ]);
  // With nothing settled every order is where it always was.
  assert.deepEqual(planFrontMoments({ events, fromDate: "2024-03-01", days, dayOf, frontOrders }).map((moment) => moment.day), [0, 2, 9, 9]);
});

test("a change of hands rides on an event that tells of its war: the first of its day or later, else the last before it", () => {
  const events = [
    event("e1", "2024-03-03", { warId: "war-east" }),
    event("e2", "2024-03-10"),
    event("e3", "2024-03-12", { warId: "war-south" }),
    event("e4", "2024-03-25"),
  ];
  const { dayOf } = frontRunSpan({ fromDate: "2024-03-01", toDate: "2024-03-31", events });
  const aboutOf = (entry, battlefield) => entry.warId === (battlefield === "East" ? "war-east" : battlefield === "South" ? "war-south" : "none");
  const flip = (day, battlefield, regionId) => ({ day, battlefield, regionId, from: "B", to: "A", kind: "control" });
  const { events: next } = attachFrontFlips(events, [flip(1, "East", "r1"), flip(8, "East", "r2"), flip(8, "South", "r3"), flip(20, "South", "r4"), flip(8, "West", "r5")], { dayOf, aboutOf });
  const carried = next.map((entry) => (entry.impacts.regionControlOps ?? []).map((op) => op.regionId));
  // r2 fell after the east's only report: it rides on that report, not on the next unrelated event.
  // r4 fell after the south's: the same. r5's war has no event at all: the first of its day or later.
  assert.deepEqual(carried, [["r1", "r2"], ["r5"], ["r3", "r4"], []]);
  assert.ok(next.every((entry) => (entry.impacts.regionControlOps ?? []).every((op) => op.by === FRONT_MARK)));
});

test("the period that was fought before the story is the period that is applied, and the answer's orders are for the one after", async () => {
  const { map, world } = await monthIn();
  assert.deepEqual(world.battlefields.map((record) => [record.name, record.status]), [["The Border", "active"]]);

  // The days ahead, fought before anything is asked for: no events, no orders.
  const told = await runTurnFronts(turn(map, world, SECOND));
  assert.equal(told.stats.days, 10);
  assert.equal(told.battlefields[0].status, "active");
  assert.ok(told.flips.length >= 3, `${told.flips.length} regions changed hands in the days that were told`);
  assert.ok(told.news.every((entry) => entry.battlefield === "The Border" && /^2024-03-(1[1-9]|2[01])$/.test(entry.d)), "what happened is dated inside the period");

  // The story is then written: three events, one of them about something else,
  // and Aland told to dig in from the first of them.
  const events = normalizeEvents([event("f1", "2024-03-13", { warId: "war-1" }), event("f2", "2024-03-16"), event("f3", "2024-03-19", { warId: "war-1" })]);
  const frontOrders = [{ id: "front-7", battlefield: "The Border", side: "Aland", order: "dig in", sector: "all", eventIds: ["f1"] }];
  const final = await runTurnFronts(turn(map, world, { ...SECOND, events, frontOrders, foretold: true }));

  // The same month, to the last troop and the last region.
  assert.deepEqual(final.flips, told.flips);
  assert.deepEqual(final.news, told.news);
  assert.deepEqual(stand(final.battlefields[0]), stand(told.battlefields[0]));
  assert.deepEqual(final.battlefields[0].brief.taken, told.battlefields[0].brief.taken);
  // The order stands for the month after, not a day old; and nobody was told off for telling of fighting it did not order.
  assert.deepEqual(final.battlefields[0].orders.map(({ s, sector, order }) => [s, sector, order]), [[0, "all", "dig in"]]);
  assert.deepEqual(final.battlefields[0].brief.carry.ages, [0]);
  assert.deepEqual(final.notes, []);
  // And the record says its period was told, which the one fought beforehand (never saved) does not.
  assert.equal(final.battlefields[0].brief.told, true);
  assert.equal(told.battlefields[0].brief.told, undefined);
  // Every change of hands is on an event of that war, never on the one about something else.
  const carriers = final.events.map((entry) => (entry.impacts.regionControlOps ?? []).filter((op) => op.by === FRONT_MARK).length);
  assert.equal(carriers[1], 0);
  assert.equal(carriers[0] + carriers[2], told.flips.length);

  // Asked for the old way, the same answer stops the advance on its second day: other days altogether.
  const after = await runTurnFronts(turn(map, world, { ...SECOND, events, frontOrders }));
  assert.ok(after.flips.length < told.flips.length, `${after.flips.length} against ${told.flips.length}`);
  assert.equal(after.battlefields[0].brief.told, undefined, "and nobody was told it as it happened");

  // A turn cut short lands on the day it was cut: the days told up to then, and no others.
  const cut = await runTurnFronts(turn(map, world, { ...SECOND, toDate: "2024-03-16", events: events.slice(0, 2), frontOrders, foretold: true }));
  assert.deepEqual(cut.flips, told.flips.filter((flip) => flip.day <= 5));
});

test("the block tells a period that was fought as it leaves the battlefield, by date, and says its orders are for the next", async () => {
  const { map, world } = await monthIn();
  const told = await runTurnFronts(turn(map, world, SECOND));
  const period = { fromDate: SECOND.fromDate, toDate: SECOND.toDate, battlefields: told.battlefields, news: told.news };
  const block = buildFrontsBlock({ battlefields: world.battlefields, players: ["Aland"], period });
  const lines = block.split("\n");
  assert.equal(lines[0], "[Fronts]");
  assert.match(lines[1], /It has ALREADY fought this period on every battlefield told in full below: what a battlefield's account says happened, happened, on the dates it gives\./);
  assert.match(lines[1], /write no unitOps for their sides' land forces and no regionControlOps for their regions/);
  assert.match(lines[2], /^Tell the war\. A battlefield where ground changed hands is among the first things this period is about, whoever is fighting on it: give it at least three events of this answer/);
  assert.match(block, /Nothing in any event goes against an account: a place it does not say fell did not fall/);
  assert.ok(lines.includes("battlefield~side~order~sector~eventNumbers~objective~result~effort"));
  assert.match(block, /An order written here is for what comes NEXT: it is put to the troops as this period ends and carried out in the one after/);
  assert.match(block, /Only on a battlefield that first opens in this answer \(a war begun here\) is an order carried out from its event's date/);
  assert.equal(block.includes("told to you here next period, so an event says a named place fell only when"), false, "the rule of a period still to be fought is gone");
  // Its own examples are lines the ledger reads.
  assert.deepEqual(decodeFrontOrders(lines.filter((line) => line.startsWith("Eastern Ukraine~")).join("\n")).map(({ side, order, sector, objective, effort, problem }) => [side, order, sector, objective, effort, problem]), [
    ["Russia", "spearhead", "north", "city: Kharkiv", "major", undefined],
    ["Ukraine", "dig in", "south", "", "", undefined],
  ]);
  // A person's side: its order too is for the next period.
  assert.ok(lines.some((line) => line.startsWith("Aland is played by a person: write no order for it of your own. But what that person tells its troops to do in an action of this turn IS its order, and you write it for them:")
    && line.includes("Such an order is carried out next period, so its event tells of the order being given and not of what came of it.")));
  // The battlefield as the period LEAVES it, then how it began and what happened when.
  assert.ok(lines.includes("Battlefields, as the period from 2024-03-11 to 2024-03-21 leaves them:"));
  const [after] = told.battlefields;
  assert.ok(block.includes(describeBattlefield(after)));
  assert.equal(block.includes(describeBattlefield(world.battlefields[0])), false, "not as it stood when the period began");
  const began = world.battlefields[0].brief.strength;
  assert.ok(lines.includes(`  It began the period with Aland at ${began[0].n} formations and Borduria at ${began[1].n}.`));
  const dated = lines.find((line) => line.startsWith("  This period, by date: "));
  assert.ok(dated, "what happened is told by date");
  const town = told.news.find((entry) => entry.k === "city");
  if (town) assert.ok(dated.includes(`${town.d} ${town.s === 0 ? "Aland" : "Borduria"} took ${town.at}`), dated);
  assert.ok(block.length <= FRONTS_BLOCK_MAX);
  assert.doesNotMatch(block, /\bwar-1\b|\bevent-|\bfront-\d/);
  for (const region of map.regions) assert.ok(!block.includes(region.id));

  // The war's first ten days were fought after the answer that began it, and
  // nobody was told them: they are told now, with the period, under their own date.
  assert.equal(world.battlefields[0].brief.told, undefined);
  const untold = lines.find((line) => line.startsWith("  Before this period, and not yet told: since 2024-03-01: "));
  assert.ok(untold, "what was never told is told");
  assert.match(untold, /Aland advanced \d+ km in the/);
  assert.ok(lines.indexOf(untold) < lines.indexOf(dated) && lines.indexOf(untold) > lines.indexOf("- The Border: Aland against Borduria, open since 2024-03-01, line " + after.brief.km + " km"));
  assert.match(block, /Where an account also says what happened before this period and was not yet told, tell that too, early in the answer/);
  // Once: a battlefield whose last period was told as it happened has nothing left over.
  const toldBefore = world.battlefields.map((record) => ({ ...record, brief: { ...record.brief, told: true } }));
  assert.equal(buildFrontsBlock({ battlefields: toldBefore, players: ["Aland"], period }).includes("not yet told: since"), false);
  assert.equal(describeUntold(toldBefore[0]), "");
  assert.equal(describeUntold(null), "");
  assert.equal(describeUntold({ ...world.battlefields[0], brief: { ...world.battlefields[0].brief, sectors: [], taken: [[], []], cities: [[], []] } }), "", "nothing happened: nothing to tell");

  // A battlefield the period closed is said to be over.
  const { field: _field, ...ended } = after;
  const over = buildFrontsBlock({ battlefields: world.battlefields, players: [], period: { ...period, battlefields: [{ ...ended, status: "closed", closedDate: "2024-03-17" }], news: [] } });
  assert.ok(over.endsWith("- The Border: the fighting there ended during the period (2024-03-17); it is closed."));
  // With nothing fought beforehand the block is what it always was.
  assert.equal(buildFrontsBlock({ battlefields: world.battlefields, players: ["Aland"], period: null }), buildFrontsBlock({ battlefields: world.battlefields, players: ["Aland"] }));
  assert.ok(buildFrontsBlock({ battlefields: world.battlefields, players: ["Aland"] }).includes("Battlefields open now:"));
});

test("of many things that happened the largest are told, in the order they happened, and the rest are counted", () => {
  const record = { name: "The Border", status: "active", sides: [["Aland", "Cisland"], ["Borduria"]] };
  const before = { brief: { strength: [{ n: 120 }, { n: 90 }] } };
  const news = [
    { d: "2024-04-02", k: "whole", s: 0, at: "region: Westmarch" },
    { d: "2024-04-02", k: "whole", s: 0, at: "region: Westmarch" },
    { d: "2024-04-06", k: "whole", s: 0, at: "region: Midmarch" },
    { d: "2024-04-03", k: "city", s: 0, at: "city: Hamlet", size: 4000 },
    { d: "2024-04-05", k: "city", s: 0, at: "city: Mid", size: 400000 },
    { d: "2024-04-05", k: "city", s: 0, at: "city: Mid", size: 400000 },
    { d: "2024-04-09", k: "pocket", s: 1, at: "city: Eastmark" },
    { d: "2024-04-11", k: "overrun", s: 1, at: "region: Eastmarch" },
    { d: "2024-04-20", k: "city", s: 0, at: "city: Brod", size: 90000, capital: true },
    { d: "2024-04-21", k: "city", s: 1, at: "city: Hamlet", size: 4000 },
    { d: "2024-04-22", k: "nonsense", s: 0, at: "city: Nowhere" },
    { d: "2024-04-23", k: "city", s: 4, at: "city: Nowhere" },
  ];
  const all = describePeriod({ record, before, news });
  assert.equal(all, [
    "  It began the period with Aland at 120 formations and Borduria at 90.",
    "  This period, by date: 2024-04-03 Aland took city: Hamlet; 2024-04-05 Aland took city: Mid; 2024-04-09 Aland surrounded troops of Borduria near city: Eastmark, and those troops of Borduria surrendered to Aland; 2024-04-11 Aland overran troops of Borduria near region: Eastmarch: Borduria lost them; 2024-04-20 Aland took city: Brod; 2024-04-21 Borduria took city: Hamlet. Regions that came wholly into a side's hands: Aland 2.",
  ].join("\n"));
  // Room for three: the capital, the largest town, the troops that gave up; in the order they happened.
  assert.equal(describePeriod({ record, news, most: 3 }), "  This period, by date: 2024-04-05 Aland took city: Mid; 2024-04-09 Aland surrounded troops of Borduria near city: Eastmark, and those troops of Borduria surrendered to Aland; 2024-04-20 Aland took city: Brod; and 3 more of the kind. Regions that came wholly into a side's hands: Aland 2.");
  // Held to its length whatever happened.
  const many = Array.from({ length: 60 }, (_, index) => ({ d: "2024-04-10", k: "city", s: 0, at: `city: A Town With A Long Name Number ${index}`, size: index }));
  const held = describePeriod({ record, news: many, most: 40 });
  assert.ok(held.length <= PERIOD_TEXT_MAX, `${held.length} characters`);
  assert.match(held, /and \d+ more of the kind\.$/);
  // A quiet period says so; a border only fortified has no period to tell.
  assert.equal(describePeriod({ record, news: [] }), "  This period, by date: no town changed hands and nobody was cut off.");
  assert.equal(describePeriod({ record, news: [{ d: "2024-04-02", k: "whole", s: 1, at: "region: Westmarch" }] }), "  This period, by date: no town changed hands and nobody was cut off. Regions that came wholly into a side's hands: Borduria 1.");
  assert.equal(describePeriod({ record: { ...record, status: "standing" }, news }), "");
});

test("who surrounded whom is said outright, the side that did it first, so it cannot be told the other way round", () => {
  // Seen in play: with China deep in Mongolia and Mongolian troops surrounded, the account read
  // "troops of Mongolia cut off near Govi-Altay gave up", and the skip wrote that Mongolian forces
  // had encircled a Chinese detachment and taken its surrender.
  const record = { name: "The Gobi", status: "active", sides: [["China"], ["Mongolia"]] };
  const told = (entry) => describePeriod({ record, news: [{ d: "2016-08-13", s: 1, at: "region: Govi-Altay", ...entry }] });
  assert.equal(told({ k: "pocket" }), "  This period, by date: 2016-08-13 China surrounded troops of Mongolia near region: Govi-Altay, and those troops of Mongolia surrendered to China.");
  assert.equal(told({ k: "siege" }), "  This period, by date: 2016-08-13 China shut troops of Mongolia in at region: Govi-Altay and is besieging them.");
  assert.equal(told({ k: "overrun" }), "  This period, by date: 2016-08-13 China overran troops of Mongolia near region: Govi-Altay: Mongolia lost them.");
  // The other way round when it IS the other way round.
  assert.ok(told({ k: "pocket", s: 0 }).includes("Mongolia surrounded troops of China near region: Govi-Altay, and those troops of China surrendered to Mongolia."));
  // Nothing is left that names only the side it happened to: the garden path is gone.
  const source = fs.readFileSync(new URL("./frontPrompt.js", import.meta.url), "utf8");
  for (const old of ["cut off near ${at} gave up", "were overrun near ${at}", "were shut in at ${at}"]) assert.equal(source.includes(old), false, old);
  // And the skip is told to keep an account the way round it is given, and to invent no battle it does not have.
  const fought = buildFrontsBlock({ battlefields: [record], period: { fromDate: "2016-08-12", toDate: "2016-08-19", days: 7, battlefields: [record], news: [] } });
  assert.ok(fought.includes("An account says who did what to whom: keep it that way round. Tell no encirclement, surrender, rout, breakthrough or ground retaken that the account does not give, and none with the two sides exchanged:"));
  assert.ok(fought.includes("A surrender is of a whole side, or of troops the account or the list below shows surrounded, and of nobody else: the game refuses any other."));
});

test("the skip fights its period before it asks, and the turn it writes says so", () => {
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const apply = fs.readFileSync(new URL("./frontApply.js", import.meta.url), "utf8");
  // Fought where the skip is read, before any prompt is built, and handed to the prompt with the skip's variables.
  const skip = gameplay.slice(gameplay.indexOf("export const simulateTimelineJump = async"));
  assert.match(skip, /const foughtBefore = await forecastTurnFronts\(\{\s*world: bundle\.world,\s*game: bundle\.game,\s*campaignId: activeCampaignId\(\),\s*toDate: targetDate,\s*requestedDays: safeDays,/);
  assert.match(skip, /const frontsForecast = foughtBefore \? \{ \.\.\.foughtBefore \} : null;/);
  assert.ok(skip.indexOf("await forecastTurnFronts(") < skip.indexOf("const jumpContext = {"));
  assert.match(skip, /variables: frontsForecast \? \{ \.\.\.variables, frontsForecast \} : variables,/);
  assert.match(gameplay, /const fronts = frontsLiveBlock\(world, game, variables\.frontsForecast \?\? null\);/);
  // The turn carries whether it was, so that a turn kept and applied later is applied the same way.
  assert.match(gameplay, /frontsForetold: Boolean\(context\.variables\?\.frontsForecast\),/);
  assert.match(gameplay, /foretold: result\.frontsForetold === true,/);
  // One way of handing a turn to the engine, for the run before and the run after.
  assert.equal(apply.split("...turnRunInput({").length - 1, 2);
  assert.match(apply, /foretold: foretold === true,/);
  // It asks no model anything.
  const forecast = apply.slice(apply.indexOf("export const forecastTurnFronts"), apply.indexOf("// Runs the front engine over a turn that is about to be applied."));
  assert.equal(/callAI|runJsonTask|fetch\(/.test(forecast), false);
});
