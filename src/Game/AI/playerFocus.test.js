// Run the tests: node --test src/Game/AI/playerFocus.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  PLAYER_FOCUS_DEFAULT,
  buildPlayerFocusDirective,
  collectPlayerMaterial,
  createSpareTest,
  combinedShares,
  createPlayerEventTest,
  normalizePlayerFocus,
  playerFocusShortfall,
  settleOrders,
  trimWorldForFocus,
  slipPassedMilestones,
} from "./playerFocus.js";

test("an unknown or missing Player focus reads as Balanced", () => {
  assert.equal(PLAYER_FOCUS_DEFAULT, "balanced");
  assert.equal(normalizePlayerFocus(undefined), "balanced");
  assert.equal(normalizePlayerFocus("loud"), "balanced");
  assert.equal(normalizePlayerFocus("Spotlight"), "spotlight");
});

test("each level sets the player's minimum, and the author's world share keeps what is left", () => {
  assert.deepEqual(combinedShares({ focus: "world-first", worldShare: 35 }), { player: 25, world: 35 });
  assert.deepEqual(combinedShares({ focus: "balanced", worldShare: 35 }), { player: 40, world: 35 });
  assert.deepEqual(combinedShares({ focus: "focused", worldShare: 35 }), { player: 60, world: 35 });
  // 75 + 35 > 100: the player's focus wins (ADR 0003).
  assert.deepEqual(combinedShares({ focus: "spotlight", worldShare: 35 }), { player: 75, world: 25 });
  assert.deepEqual(combinedShares({ focus: "focused", worldShare: 50 }), { player: 60, world: 40 });
  assert.deepEqual(combinedShares({ focus: "focused", worldShare: 0 }), { player: 60, world: 0 });
});

test("an event is the player's when it names them, is marked theirs, or happens in their territory", () => {
  const isPlayerEvent = createPlayerEventTest({
    playerNames: ["British Empire", "United Kingdom"],
    territoryNames: ["Punjab", "Lahore", "Pakistan", "Greater Manchester"],
  });
  const event = (title, description = "", extra = {}) => ({ title, description, ...extra });
  assert.equal(isPlayerEvent(event("British Empire opens a shipyard")), true);
  assert.equal(isPlayerEvent(event("Argentina condemns the buildup", "", { playerRelated: true })), true);
  assert.equal(isPlayerEvent(event("Riots in Lahore", "Crowds fill the streets of the old city.")), true);
  assert.equal(isPlayerEvent(event("Unrest spreads", "Protests reach Greater Manchester.")), true);
  assert.equal(isPlayerEvent(event("Former Pakistani officers form a movement", "Veterans of Pakistan's army organise.")), true);
  assert.equal(isPlayerEvent(event("Seoul and Pyongyang trade artillery fire", "The Korean peninsula tenses.")), false);
  // Whole words only: "Punjabi" music abroad is not Punjab.
  assert.equal(isPlayerEvent(event("Toronto hosts a Punjabi music festival")), false);
});

const PLAYER = "British Empire";
const window = { originDate: "2016-08-01", targetDate: "2016-08-31" };
const isBritish = createPlayerEventTest({ playerNames: [PLAYER], territoryNames: ["Lahore"] });

const campaign = {
  actions: [
    { id: "a1", status: "planned", text: "Fortify the Falklands." },
    { id: "a0", status: "resolved", text: "Already done." },
  ],
  projects: [
    {
      id: "p-turing", name: "Project Turing", ownerCode: "", status: "active",
      milestones: [
        { id: "m1", title: "First quantum node online", date: "2016-08-15", status: "pending" },
        { id: "m2", title: "Second node", date: "2016-09-20", status: "pending" },
        { id: "m3", title: "Far off", date: "2017-06-01", status: "pending" },
      ],
    },
    { id: "p-argus", name: "Project Argus", ownerCode: "", status: "active", targetDate: "2016-08-20", milestones: [] },
    { id: "p-done", name: "Project Done", ownerCode: "", status: "complete", milestones: [{ id: "m9", title: "x", date: "2016-08-10", status: "pending" }] },
    { id: "p-foreign", name: "Russian Carrier", ownerCode: "Russia", status: "active", milestones: [{ id: "m8", title: "Launch", date: "2016-08-10", status: "pending" }] },
  ],
  storylines: [
    { id: "s1", title: "Falklands standoff", status: "active", participants: ["Argentina", PLAYER] },
    { id: "s2", title: "Korean tension", status: "active", participants: ["South Korea", "North Korea"] },
    { id: "s3", title: "Old Pakistan friction", status: "resolved", participants: [PLAYER] },
  ],
  wars: [
    { id: "w1", title: "Gulf War", status: "active", sideA: ["Saudi Arabia"], sideB: ["Iran"] },
    { id: "w2", title: "Falklands War", status: "active", sideA: ["Argentina"], sideB: [PLAYER] },
  ],
  relations: [
    { a: "Argentina", b: PLAYER, status: "hostile", lastUpdatedDate: "2016-07-20" },
    { a: "France", b: PLAYER, status: "friendly", lastUpdatedDate: "2015-01-01" },
    { a: "Iran", b: "Saudi Arabia", status: "hostile", lastUpdatedDate: "2016-07-30" },
  ],
  chats: [
    { id: "c1", title: "Talks with Washington", countries: ["United States", PLAYER], messages: [{ memorySummary: "The US will send envoys by September.", time: "2016-07-25" }] },
    { id: "c2", title: "Idle", countries: ["France", PLAYER], messages: [{ text: "Hello" }] },
  ],
  recentEvents: [
    { id: "e1", date: "2016-07-28", title: "Argentina condemns British Empire buildup", description: "" },
    { id: "e2", date: "2016-07-29", title: "Seoul protests", description: "" },
    { id: "e3", date: "2016-03-01", title: "British Empire budget", description: "" },
  ],
};

test("what the player has going on: orders and due dates must be answered, the rest may be drawn on", () => {
  const material = collectPlayerMaterial({ ...campaign, ...window, playerNames: [PLAYER], isPlayerEvent: isBritish });
  const byKind = (kind) => material.filter((item) => item.kind === kind);
  assert.deepEqual(byKind("order").map((item) => [item.id, item.required]), [["a1", true]]);
  assert.deepEqual(byKind("milestone").map((item) => [item.id, item.required]), [["m1", true], ["m2", false]]);
  assert.deepEqual(byKind("target").map((item) => [item.id, item.required]), [["p-argus", true]]);
  assert.deepEqual(byKind("storyline").map((item) => item.id), ["s1"]);
  assert.deepEqual(byKind("war").map((item) => item.id), ["w2"]);
  assert.deepEqual(byKind("relation").map((item) => item.label), ["Relations with Argentina: hostile"]);
  assert.deepEqual(byKind("chat").map((item) => item.id), ["c1"]);
  assert.deepEqual(byKind("consequence").map((item) => item.id), ["e1"]);
  assert.ok(material.every((item) => item.label));
});

test("a quiet stretch has nothing going on", () => {
  assert.deepEqual(collectPlayerMaterial({ ...window, playerNames: [PLAYER], isPlayerEvent: isBritish }), []);
});

const events = (player, world) => [
  ...Array.from({ length: player }, (_, index) => ({ title: `British Empire move ${index}` })),
  ...Array.from({ length: world }, (_, index) => ({ title: `Korean incident ${index}` })),
];
const plenty = Array.from({ length: 6 }, (_, index) => ({ kind: "storyline", id: `s${index}`, label: "x", required: false }));

test("on Focused with plenty going on, a six-event jump with two Player events is short by two", () => {
  const shortfall = playerFocusShortfall(events(2, 4), { focus: "focused", isPlayerEvent: isBritish, material: plenty, playerName: PLAYER });
  assert.equal(shortfall.needed, 4);
  assert.equal(shortfall.have, 2);
  assert.match(shortfall.text, /British Empire/);
  assert.equal(playerFocusShortfall(events(4, 2), { focus: "focused", isPlayerEvent: isBritish, material: plenty }), null);
});

test("the minimum never asks for more Player events than the player has going on", () => {
  const two = plenty.slice(0, 2);
  assert.equal(playerFocusShortfall(events(2, 4), { focus: "spotlight", isPlayerEvent: isBritish, material: two }), null);
  assert.equal(playerFocusShortfall(events(1, 5), { focus: "spotlight", isPlayerEvent: isBritish, material: two }).needed, 2);
  assert.equal(playerFocusShortfall(events(0, 6), { focus: "spotlight", isPlayerEvent: isBritish, material: [] }), null);
});

test("below three events no share is asked for", () => {
  assert.equal(playerFocusShortfall(events(0, 2), { focus: "spotlight", isPlayerEvent: isBritish, material: plenty }), null);
});

test("an order resolves only when an event answered it; the rest stay queued, marked overdue", () => {
  const queue = [
    { id: "a1", status: "planned", text: "Fund the shipyard" },
    { id: "a2", status: "planned", text: "Hire shipyard workers" },
    { id: "a3", status: "planned", text: "Recall the ambassador", overdue: true },
    { id: "a4", status: "resolved", text: "Old" },
  ];
  const answered = [{ title: "Shipyard funded and staffed", impacts: { actionIds: ["a1", "a2"] } }, { title: "Quiet", impacts: {} }];
  const settled = settleOrders(queue, answered);
  assert.deepEqual(settled.map((action) => [action.id, action.status, action.overdue === true]), [
    ["a1", "resolved", false],
    ["a2", "resolved", false],
    ["a3", "planned", true],
    ["a4", "resolved", false],
  ]);
  const later = settleOrders(settled, [{ impacts: { actionIds: ["a3"] } }]);
  assert.deepEqual(later.find((action) => action.id === "a3"), { id: "a3", status: "resolved", text: "Recall the ambassador" });
});

test("a milestone whose date passed with no outcome slips; reached ones, later ones and closed Projects are left alone", () => {
  const board = [
    {
      id: "p1", status: "active",
      milestones: [
        { id: "m1", date: "2016-08-15", status: "pending" },
        { id: "m2", date: "2016-08-10", status: "done" },
        { id: "m3", date: "2016-09-15", status: "pending" },
        { id: "m4", date: "2016-08-31", status: "pending" },
      ],
    },
    { id: "p2", status: "complete", milestones: [{ id: "m5", date: "2016-08-01", status: "pending" }] },
  ];
  const slipped = slipPassedMilestones(board, { date: "2016-08-31" });
  assert.deepEqual(slipped[0].milestones.map((milestone) => milestone.status), ["slipped", "done", "pending", "slipped"]);
  assert.equal(slipped[1], board[1]);
  assert.equal(slipPassedMilestones(slipped, { date: "2016-08-31" })[0], slipped[0], "nothing left to slip changes nothing");
});

test("the filler filter spares an event that answers an order or names a Project with something due", () => {
  const material = collectPlayerMaterial({ ...campaign, ...window, playerNames: [PLAYER], isPlayerEvent: isBritish });
  const spare = createSpareTest(material);
  assert.equal(spare({ title: "Officials review plans", impacts: { actionIds: ["a1"] } }), true);
  assert.equal(spare({ title: "Project Turing engineers bring the first node online", impacts: {} }), true);
  assert.equal(spare({ title: "Project Argus reviews its schedule", impacts: {} }), true);
  // A milestone only in its lead-up month is not due: Turing's is, so use another name.
  assert.equal(spare({ title: "Ministry reviews road standards", impacts: {} }), false);
  assert.equal(createSpareTest([])({ title: "Project Turing update", impacts: {} }), false);
});

test("Focused and Spotlight trim the world's lanes and evidence, lowest-ranked first; the player's stay", () => {
  const ranked = [
    { id: "w1", mine: false }, { id: "p1", mine: true }, { id: "w2", mine: false }, { id: "w3", mine: false },
    { id: "p2", mine: true }, { id: "w4", mine: false }, { id: "w5", mine: false },
  ];
  const ids = (focus) => trimWorldForFocus(ranked, { focus, isPlayerItem: (item) => item.mine }).map((item) => item.id);
  assert.deepEqual(ids("world-first"), ["w1", "p1", "w2", "w3", "p2", "w4", "w5"]);
  assert.deepEqual(ids("balanced"), ["w1", "p1", "w2", "w3", "p2", "w4", "w5"]);
  assert.deepEqual(ids("focused"), ["w1", "p1", "w2", "w3", "p2"]);
  assert.deepEqual(ids("spotlight"), ["w1", "p1", "w2", "p2"]);
  // Something of the world always stays.
  assert.deepEqual(trimWorldForFocus([{ id: "w1", mine: false }], { focus: "spotlight", isPlayerItem: (item) => item.mine }).map((item) => item.id), ["w1"]);
});

test("the jump is told the level, what must be answered (overdue orders first) and what it may draw on", () => {
  const material = [
    { kind: "order", id: "a1", label: "Fund the shipyard", required: true },
    { kind: "order", id: "a2", label: "Recall the ambassador", required: true, overdue: true },
    { kind: "milestone", id: "m1", label: "Project Turing: first node (2016-08-15)", required: true },
    { kind: "storyline", id: "s1", label: "Falklands standoff", required: false },
  ];
  const text = buildPlayerFocusDirective({ focus: "focused", worldShare: 35, material, playerName: PLAYER });
  assert.match(text, /Focused/);
  assert.match(text, /60%/);
  assert.ok(text.indexOf("Recall the ambassador") < text.indexOf("Fund the shipyard"), "the overdue order is listed first");
  assert.ok(text.includes("[a2]") && text.includes("[a1]"), "orders carry their ids for actionIds");
  assert.ok(text.includes("Project Turing: first node") && text.includes("Falklands standoff"));
  const quiet = buildPlayerFocusDirective({ focus: "spotlight", material: [], playerName: PLAYER });
  assert.match(quiet, /nothing/i);
  assert.doesNotMatch(quiet, /75%/, "a quiet stretch asks for no share");
});

test("a queued request that no event could cite still clears: a Deploy the engine accepted, a chat that opened", () => {
  const queue = [
    { id: "d1", status: "planned", kind: "action", text: "Deploy the 1st Fleet", unitRevert: { unitId: "u1", remove: true } },
    { id: "c1", status: "planned", kind: "chat", text: "Open talks with Argentina" },
    { id: "o1", status: "planned", kind: "action", text: "Fortify the Falklands" },
  ];
  const settled = settleOrders(queue, [{ impacts: {} }]);
  assert.deepEqual(settled.map((action) => [action.id, action.status, action.overdue === true]), [
    ["d1", "resolved", false],
    ["c1", "resolved", false],
    ["o1", "planned", true],
  ]);
});
