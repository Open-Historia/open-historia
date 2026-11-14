/*! Open Historia — the orders a turn gives its battlefields: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontLedger.test.js
//
// The frontOrders lines of a time skip's answer: read, tied to their events,
// and held to the one rule the map does not decide, that a person's troops
// take new orders only from that person.

import test from "node:test";
import assert from "node:assert/strict";
import {
  FRONT_ORDERS_FIELD,
  MAX_FRONT_ORDERS_PER_PASS,
  bindFrontOrdersToEvents,
  decodeFrontOrders,
  describeDroppedFrontOrders,
  frontOrderProseLines,
  normalizeFrontSector,
  screenFrontOrders,
} from "./nativeFrontLedger.js";

const ANSWER = [
  "Eastern Ukraine~Russia~spearhead~north~2,3~city: Kharkiv~~major",
  "Eastern Ukraine~Ukraine~dig in~all",
  "Eastern Ukraine~Russia~Advance~Centre~4",
  "Western Front~Germany~FALL BACK~south~~region: Alsace~repulsed~Total",
].join("\n");

test("a full line and a short one are both read; the last three fields may be left off", () => {
  const [spearhead, digIn, attack, retreat] = decodeFrontOrders(ANSWER);
  assert.deepEqual(spearhead, {
    id: "front-0",
    battlefield: "Eastern Ukraine",
    side: "Russia",
    order: "spearhead",
    sector: "north",
    eventIndexes: [1, 2],
    eventIds: [],
    objective: "city: Kharkiv",
    result: "",
    effort: "major",
  });
  assert.deepEqual([digIn.order, digIn.sector, digIn.objective, digIn.result, digIn.effort], ["dig in", "all", "", "", ""]);
  assert.deepEqual([attack.order, attack.sector, attack.eventIndexes], ["advance", "centre", [3]]);
  assert.deepEqual([retreat.order, retreat.sector, retreat.objective, retreat.result, retreat.effort], ["fall back", "south", "region: Alsace", "repulsed", "total"]);
  assert.equal(FRONT_ORDERS_FIELD, "frontOrders");
});

// The orders, results, efforts and sector words are the rules' own (frontPrompt.js), case and spacing aside.
// Nothing a model might write instead is read as one of them, in English or in another language: the record
// says why it was left out, and the next answer writes the word the rules give (the owner, 2026-11-13).
test("only the engine's own words are read; a near miss in any language is left out and said; a place stays as written", () => {
  const read = (word) => decodeFrontOrders(`A~B~${word}~all`)[0];
  assert.equal(read("Advance").order, "advance");
  assert.equal(read("DIG IN").order, "dig in");
  assert.equal(read("fall back.").order, "fall back");
  // To withdraw is to leave the battlefield, an order of its own: not to fall back along it.
  assert.equal(read("withdraw.").order, "withdraw");
  for (const word of ["Offensive", "blitzkrieg", "entrench", "retreat", "Pull out", "evacuate", "pincer", "attack", "storm"]) {
    assert.equal(read(word).order, "", word);
    assert.match(read(word).problem, /is not an order/, word);
  }
  // The French, German and Russian twins of those English words are treated exactly as they are.
  for (const word of ["attaque", "repli", "Vorstoß", "Rückzug", "наступление", "отступление"]) {
    assert.equal(read(word).order, "", word);
    assert.match(read(word).problem, /is not an order/, word);
  }
  assert.equal(normalizeFrontSector("Centre"), "centre");
  assert.equal(normalizeFrontSector(" NORTHEAST "), "northeast");
  assert.equal(normalizeFrontSector(""), "all", "a blank sector is the whole line");
  assert.equal(normalizeFrontSector("  city: Izium "), "city: Izium");
  // Anything else is a place on the line, kept as written for the engine to find (or say it found none).
  assert.equal(normalizeFrontSector("north-east"), "north-east");
  assert.equal(normalizeFrontSector("the whole line"), "the whole line");
  assert.equal(normalizeFrontSector("nord-est"), "nord-est");
  assert.equal(decodeFrontOrders("A~B~advance~all~~~captured~")[0].result, "captured");
  assert.equal(decodeFrontOrders("A~B~advance~all~~~fell~")[0].result, "", "a word for a result is no result");
  assert.equal(decodeFrontOrders("A~B~advance~all~~~tombée~")[0].result, "");
  assert.equal(decodeFrontOrders("A~B~advance~all~~~~Total")[0].effort, "total");
  assert.equal(decodeFrontOrders("A~B~advance~all~~~~all-out")[0].effort, "", "a word for an effort is no effort: the order stands at the usual one");
  assert.equal(decodeFrontOrders("A~B~advance~all~~~~maximal")[0].effort, "");
});

test("prose where records go is ignored, and a record nothing can be done with says why", () => {
  const answer = "### Front orders\nNo changes on any front this month.\nA~B~charge~all\n~B~hold~all\nA~~hold~all\nA~B~~north~~~captured\nA~B~land~all";
  assert.deepEqual(frontOrderProseLines(answer), ["### Front orders", "No changes on any front this month."]);
  const records = decodeFrontOrders(answer);
  assert.equal(records.length, 5);
  assert.match(records[0].problem, /"charge" is not an order/);
  assert.equal(records[1].problem, "no battlefield is named");
  assert.equal(records[2].problem, "no side is named");
  assert.equal(records[3].problem, undefined, "a result alone is a record: the story says what came of it");
  assert.equal(records[3].order, "");
  assert.equal(records[4].problem, "a landing has to name where");
  assert.deepEqual(decodeFrontOrders(""), []);
  assert.deepEqual(decodeFrontOrders(null), []);
  assert.equal(decodeFrontOrders(Array.from({ length: 40 }, () => "A~B~hold~all").join("\n")).length, MAX_FRONT_ORDERS_PER_PASS);
  // An assault names what is attacked: a city, a structure or a formation. Without one it is no order.
  const assaults = decodeFrontOrders([
    "Eastern Ukraine~Russia~assault~all~2~city: Mariupol",
    "Eastern Ukraine~Russia~Assault~south~3~structure: Azovstal works",
    "Eastern Ukraine~Ukraine~assault~all~~unit: 1st Guards Tank Army~~total",
    "Eastern Ukraine~Russia~assault~all~4",
    "Eastern Ukraine~Russia~flank~north~5~city: Izium",
    "Eastern Ukraine~Russia~storm~south~3~structure: Azovstal works",
  ].join("\n"));
  assert.deepEqual(assaults.map((entry) => [entry.order, entry.objective, entry.problem ?? ""]), [
    ["assault", "city: Mariupol", ""],
    ["assault", "structure: Azovstal works", ""],
    ["assault", "unit: 1st Guards Tank Army", ""],
    ["assault", "", "an assault has to name what is attacked"],
    ["flank", "city: Izium", ""],
    ["", "structure: Azovstal works", "\"storm\" is not an order"],
  ]);
});

test("an order is tied to the ids of the events it named, once", () => {
  const events = [{ id: "e-a" }, { id: "e-b" }, { id: "e-c" }, { id: "e-d" }];
  const bound = bindFrontOrdersToEvents(ANSWER, events);
  assert.deepEqual(bound[0].eventIds, ["e-b", "e-c"]);
  assert.deepEqual(bound[1].eventIds, []);
  assert.deepEqual(bound[2].eventIds, ["e-d"]);
  // Read again against another batch, as a later pass would: the ids stand.
  const again = bindFrontOrdersToEvents(bound, [{ id: "other-1" }, { id: "other-2" }, { id: "other-3" }]);
  assert.deepEqual(again[0].eventIds, ["e-b", "e-c"]);
  assert.deepEqual(again[1].eventIds, [], "an order that named no event still names none");
  assert.deepEqual(bindFrontOrdersToEvents("A~B~hold~all~9", events)[0].eventIds, [], "a number past the last event ties to nothing");
});

test("a person's side takes an order only where the event carries out an order of theirs", () => {
  const events = [
    { id: "e-1", impacts: { actionIds: ["order-ru-1"] } },
    { id: "e-2", impacts: {} },
  ];
  const citesOrderOf = (side, event) => side === "Russia" && (event.impacts.actionIds ?? []).includes("order-ru-1");
  const answer = [
    "Eastern Ukraine~Russia~advance~north~1",
    "Eastern Ukraine~Russia~blitz~south~2",
    "Eastern Ukraine~Russia~advance~centre~2~city: Dnipro~repulsed",
    "Eastern Ukraine~Russia~hold~all",
    "Eastern Ukraine~Ukraine~advance~south~2",
  ].join("\n");
  const { kept, dropped } = screenFrontOrders(bindFrontOrdersToEvents(answer, events), { events, humanSides: ["russia"], citesOrderOf });
  assert.deepEqual(kept.map((order) => `${order.side}:${order.order || "-"}:${order.sector}:${order.result || "-"}`), [
    "Russia:advance:north:-",
    "Russia:-:centre:repulsed",
    "Ukraine:advance:south:-",
  ]);
  assert.equal(dropped.length, 3);
  assert.equal(dropped.every((entry) => entry.player), true);
  // With nobody playing Russia the simulator commands it as it does any country.
  const free = screenFrontOrders(bindFrontOrdersToEvents(answer, events), { events });
  assert.equal(free.kept.length, 5);
  assert.equal(free.dropped.length, 0);
});

test("what was left out is said once, in a line", () => {
  const { dropped } = screenFrontOrders("A~B~charge~all\nA~B~charge~all\n~B~hold~all");
  const line = describeDroppedFrontOrders(dropped);
  assert.match(line, /^Front orders: 3 order\(s\) were left out/);
  assert.equal(line.split('"charge" is not an order').length, 2, "one reason, said once");
  assert.equal(describeDroppedFrontOrders([]), "");
});
