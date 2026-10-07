// Run: node --test server/regionFocus.test.js
//
// The jump prompt lists a few powers' regions by name. They must be the powers
// the turn is about, not whichever owners the save happened to store first.
import assert from "node:assert/strict";
import test from "node:test";

import { isPendingAction, mentionCount, nameVariants, selectFocusPowers } from "../src/Game/AI/regionFocus.js";

const owners = [
  { key: "united states of america", label: "United States of America", regions: 285 },
  { key: "russian federation", label: "Russian Federation", regions: 341 },
  { key: "ukraine", label: "Ukraine", regions: 128 },
  { key: "people's republic of china", label: "People's Republic of China", regions: 200 },
  { key: "republic of panama", label: "Republic of Panama", regions: 12 },
  { key: "federal republic of germany", label: "Federal Republic of Germany", regions: 182 },
  { key: "islamic republic of iran", label: "Islamic Republic of Iran", regions: 35 },
  { key: "republic of india", label: "Republic of India", regions: 40 },
];

test("a power is recognised only under the names the map declares for it", () => {
  const russia = nameVariants("Russian Federation");
  assert.equal(mentionCount("The Russian Federation annexes Kharkiv", russia), 1);
  assert.equal(mentionCount("Russia annexes Kharkiv; Russian troops mass", russia), 0, "\"Russia\" is not a name this map has");
  const withAlias = nameVariants("Russian Federation", { aliases: ["Russia"] });
  assert.equal(mentionCount("Russia annexes Kharkiv", withAlias), 1, "a declared alias counts");
  const germany = nameVariants("Federal Republic of Germany", { displayName: "Germany" });
  assert.equal(mentionCount("Germany hosts the summit", germany), 1, "the declared display name counts");
  assert.equal(mentionCount("the Germans reinforce the Baltic", germany), 0, "no stems, no guessing");
  const iran = nameVariants("Islamic Republic of Iran", { stockName: "Iran" });
  assert.equal(mentionCount("Iran enriches uranium", iran), 1, "the stock name counts when the record declares its code");
  assert.equal(mentionCount("Ireland votes", iran), 0);
});

test("without any signal, the player leads and size breaks ties", () => {
  const ranked = selectFocusPowers({ owners, player: "United States of America" });
  assert.equal(ranked[0].label, "United States of America");
  assert.equal(ranked[1].label, "Russian Federation");
  assert.equal(ranked.at(-1).label, "Republic of Panama");
});

test("a pending action names the powers that matter most", () => {
  const ranked = selectFocusPowers({
    owners,
    player: "United States of America",
    actions: [
      { title: "Arm Ukraine", description: "Ship Javelins to Kyiv and warn the Russian Federation against further annexation.", status: "planned" },
      { title: "Old business", description: "Trade talks with the Republic of Panama", status: "resolved" },
      { title: "Loose talk", description: "Warn Russia too." },
    ],
  });
  assert.deepEqual(ranked.slice(0, 3).map((entry) => entry.label), ["United States of America", "Russian Federation", "Ukraine"]);
  assert.ok(ranked.find((entry) => entry.label === "Republic of Panama").reasons.length === 0, "a resolved action carries no weight");
  assert.equal(ranked.find((entry) => entry.label === "Russian Federation").score, 120 + 15, "\"Russia\" in prose did not count a second time: it is not a name on this map");
});

test("an order the last jump answered no longer earns focus", () => {
  // settleOrders marks an answered order status "resolved"; nothing ever sets
  // a `resolved` flag, so that is the field the ranking has to read.
  const answered = { title: "Old business", description: "Trade talks with the Republic of Panama and the Republic of India", status: "resolved" };
  const ranked = selectFocusPowers({
    owners,
    player: "United States of America",
    actions: Array.from({ length: 30 }, () => answered),
  });
  assert.equal(ranked.find((entry) => entry.label === "Republic of Panama").reasons.length, 0);
  assert.equal(ranked.find((entry) => entry.label === "Republic of India").reasons.length, 0);
  assert.equal(isPendingAction(answered), false);
  assert.equal(isPendingAction({ title: "Queued", status: "planned" }), true);
  assert.equal(isPendingAction({ title: "Saved before statuses" }), true, "no status reads as planned, as normalizeActionEntry does");
  assert.equal(isPendingAction(null), false);
});

test("belligerents, chat partners, event movers and claimants all outrank the rest", () => {
  const ranked = selectFocusPowers({
    owners,
    player: "United States of America",
    wars: [{ id: "war-1", status: "active", sides: { aggressors: ["Russian Federation"], defenders: ["Ukraine"] } }],
    chats: [{ countries: [{ name: "Islamic Republic of Iran" }] }],
    events: [
      { title: "Berlin summit", description: "The Federal Republic of Germany hosts talks.", impacts: {} },
      { title: "Panama Canal reopened", description: "The Republic of Panama restores traffic.", impacts: { regionTransfers: [{ fromCode: "Republic of Panama", toCode: "Republic of India" }] } },
    ],
    claimants: { "690": ["People's Republic of China"] },
    ownerOfRegion: (id) => (id === "690" ? "United States of America" : ""),
  });
  const labels = ranked.map((entry) => entry.label);
  assert.equal(labels[0], "United States of America");
  assert.ok(labels.indexOf("Russian Federation") < labels.indexOf("Federal Republic of Germany"), "a belligerent beats a mention");
  assert.ok(labels.indexOf("Ukraine") < labels.indexOf("Federal Republic of Germany"));
  assert.ok(labels.indexOf("Islamic Republic of Iran") < labels.indexOf("Federal Republic of Germany"), "a chat partner beats a mention");
  assert.ok(labels.indexOf("People's Republic of China") < labels.indexOf("Federal Republic of Germany"), "a claim on the player's land beats a mention");
  const panama = ranked.find((entry) => entry.label === "Republic of Panama");
  assert.ok(panama.reasons.includes("moved by recent events"));
  assert.ok(panama.reasons.includes("named in recent events"));
});

test("an ended war no longer promotes its belligerents", () => {
  const ranked = selectFocusPowers({
    owners,
    player: "United States of America",
    wars: [{ id: "war-0", status: "ended", sides: { aggressors: ["Republic of Panama"], defenders: ["Republic of India"] } }],
  });
  assert.equal(ranked.find((entry) => entry.label === "Republic of Panama").reasons.length, 0);
});

// A map whose powers are named in another script. Folded to a-z0-9 each of
// these names was no name at all: none was ever recognised in an order, a war,
// a chat or an event, and the powers were ranked by size alone.
const cyrillicOwners = [
  { key: "российская федерация", label: "Российская Федерация", regions: 341 },
  { key: "украина", label: "Украина", regions: 128 },
  { key: "республика беларусь", label: "Республика Беларусь", regions: 96, displayName: "Беларусь" },
  { key: "китайская народная республика", label: "Китайская Народная Республика", regions: 200 },
  { key: "республика панама", label: "Республика Панама", regions: 12 },
];

test("a power named in Cyrillic or Chinese is recognised under the names the map declares, and only those", () => {
  const russia = nameVariants("Российская Федерация");
  assert.equal(mentionCount("Польша направила ноту: Российская Федерация отвечает.", russia), 1);
  assert.equal(mentionCount("Россия отвечает; российские войска на границе", russia), 0, "\"Россия\" is not a name this map has");
  assert.equal(mentionCount("РОССИЙСКАЯ ФЕДЕРАЦИЯ, Российская Федерация", russia), 2, "case folds in any script");
  const belarus = nameVariants("Республика Беларусь", { displayName: "Беларусь" });
  assert.equal(mentionCount("Беларусь принимает саммит", belarus), 1);
  // Chinese: where punctuation sets the name apart. An unbroken sentence is one
  // word here; nothing cuts Chinese into words.
  const china = nameVariants("中华人民共和国", { aliases: ["中国"] });
  assert.equal(mentionCount("声明称：中国，将公布新的五年计划。", china), 1);
  assert.equal(mentionCount("东京消息：日本，举行选举。", china), 0);
  assert.equal(mentionCount("中国宣布新的五年计划", china), 0);
});

test("the turn's powers lead on a map named in Cyrillic, as on any other", () => {
  const ranked = selectFocusPowers({
    owners: cyrillicOwners,
    player: "Российская Федерация",
    actions: [{ title: "Давление на Украина", description: "Предупредить: Республика Панама не должна вмешиваться.", resolved: false }],
    wars: [{ id: "war-1", status: "active", sides: { aggressors: ["Российская Федерация"], defenders: ["Украина"] } }],
    events: [{ title: "Саммит в Минске", description: "Беларусь принимает переговоры.", impacts: {} }],
  });
  assert.deepEqual(ranked.slice(0, 2).map((entry) => entry.label), ["Российская Федерация", "Украина"]);
  const labels = ranked.map((entry) => entry.label);
  assert.ok(labels.indexOf("Республика Панама") < labels.indexOf("Китайская Народная Республика"), "twelve regions named in an order outrank two hundred nobody mentioned");
  assert.ok(ranked.find((entry) => entry.label === "Республика Беларусь").reasons.includes("named in recent events"));
  assert.equal(ranked.find((entry) => entry.label === "Китайская Народная Республика").reasons.length, 0);
});
