// Run: node --test server/regionFocus.test.js
//
// The jump prompt lists a few powers' regions by name. They must be the powers
// the turn is about, not whichever owners the save happened to store first.
import assert from "node:assert/strict";
import test from "node:test";

import { mentionCount, nameVariants, selectFocusPowers } from "../src/Game/AI/regionFocus.js";

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
      { title: "Arm Ukraine", description: "Ship Javelins to Kyiv and warn the Russian Federation against further annexation.", resolved: false },
      { title: "Old business", description: "Trade talks with the Republic of Panama", resolved: true },
      { title: "Loose talk", description: "Warn Russia too.", resolved: false },
    ],
  });
  assert.deepEqual(ranked.slice(0, 3).map((entry) => entry.label), ["United States of America", "Russian Federation", "Ukraine"]);
  assert.ok(ranked.find((entry) => entry.label === "Republic of Panama").reasons.length === 0, "a resolved action carries no weight");
  assert.equal(ranked.find((entry) => entry.label === "Russian Federation").score, 120 + 15, "\"Russia\" in prose did not count a second time: it is not a name on this map");
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
