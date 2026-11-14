/*! Open Historia — portions (tests for the Player focus rules) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/playerFocus.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  PLAYER_FOCUS_DEFAULT,
  buildPlayerFocusDirective,
  collectPlayerMaterial,
  createSpareTest,
  combinedShares,
  isPlayerEvent,
  normalizePlayerFocus,
  playerFocusShortfall,
  repeatedOrder,
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

// The player's names and the names of the places it held were looked for in the
// event's words: "России" was not "Россия", a Chinese sentence had no word
// breaks to find a name between, and "Georgia" the US state was the country.
test("an event is the player's when the simulator marks it playerRelated, and its words never decide", () => {
  const event = (title, description = "", extra = {}) => ({ title, description, ...extra });
  assert.equal(isPlayerEvent(event("Argentina condemns the buildup", "", { playerRelated: true })), true);
  assert.equal(isPlayerEvent(event("Riots in Lahore", "Crowds fill the streets of the old city.", { playerRelated: true })), true);
  // Named in its words but not marked: the world's.
  assert.equal(isPlayerEvent(event("British Empire opens a shipyard")), false);
  assert.equal(isPlayerEvent(event("Seoul and Pyongyang trade artillery fire", "The Korean peninsula tenses.")), false);
  assert.equal(isPlayerEvent(event("x", "", { playerRelated: "yes" })), false, "only the boolean mark");
  assert.equal(isPlayerEvent(null), false);
});

test("the same event counts the same in every language", () => {
  const twins = [
    { title: "Riots in Lahore", description: "Crowds fill the streets of the old city." },
    { title: "Émeutes à Lahore", description: "La foule envahit les rues de la vieille ville." },
    { title: "Беспорядки в Лахоре", description: "Толпы заполнили улицы старого города." },
    { title: "拉合尔发生骚乱", description: "人群涌上老城的街道。" },
  ];
  assert.deepEqual(twins.map((event) => isPlayerEvent({ ...event, playerRelated: true })), [true, true, true, true]);
  assert.deepEqual(twins.map((event) => isPlayerEvent(event)), [false, false, false, false]);
});

const PLAYER = "British Empire";
const window = { originDate: "2016-08-01", targetDate: "2016-08-31" };

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
    { id: "e1", date: "2016-07-28", title: "Argentina condemns British Empire buildup", description: "", playerRelated: true },
    { id: "e2", date: "2016-07-29", title: "Seoul protests", description: "" },
    { id: "e3", date: "2016-03-01", title: "British Empire budget", description: "", playerRelated: true },
    // Names the player in its words, but was never marked the player's.
    { id: "e4", date: "2016-07-30", title: "British Empire shares fall in Tokyo", description: "" },
  ],
};

test("what the player has going on: orders and due dates must be answered, the rest may be drawn on", () => {
  const material = collectPlayerMaterial({ ...campaign, ...window, playerNames: [PLAYER] });
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
  assert.deepEqual(collectPlayerMaterial({ ...window, playerNames: [PLAYER] }), []);
});

const events = (player, world) => [
  ...Array.from({ length: player }, (_, index) => ({ title: `Move ${index}`, playerRelated: true })),
  ...Array.from({ length: world }, (_, index) => ({ title: `Korean incident ${index}` })),
];
const plenty = Array.from({ length: 6 }, (_, index) => ({ kind: "storyline", id: `s${index}`, label: "x", required: false }));

test("on Focused with plenty going on, a six-event jump with two Player events is short by two", () => {
  const shortfall = playerFocusShortfall(events(2, 4), { focus: "focused", material: plenty, playerName: PLAYER });
  assert.equal(shortfall.needed, 4);
  assert.equal(shortfall.have, 2);
  assert.match(shortfall.text, /^2 of your 6 events were marked playerRelated;/);
  assert.match(shortfall.text, /British Empire/);
  assert.match(shortfall.text, /mark each such event playerRelated\.$/);
  assert.equal(playerFocusShortfall(events(4, 2), { focus: "focused", material: plenty }), null);
});

test("an event that names the player but is not marked theirs is not counted, in any language", () => {
  const named = [
    { title: "British Empire move" },
    { title: "L'Empire britannique agit" },
    { title: "Британская империя действует" },
    { title: "大英帝国采取行动" },
  ];
  for (const event of named) {
    const list = [event, { ...event }, { title: "Korean incident" }];
    assert.equal(playerFocusShortfall(list, { focus: "focused", material: plenty, playerName: PLAYER }).have, 0, event.title);
    assert.equal(playerFocusShortfall(list.map((entry) => ({ ...entry, playerRelated: true })), { focus: "focused", material: plenty, playerName: PLAYER }), null, event.title);
  }
});

test("the minimum never asks for more Player events than the player has going on", () => {
  const two = plenty.slice(0, 2);
  assert.equal(playerFocusShortfall(events(2, 4), { focus: "spotlight", material: two }), null);
  assert.equal(playerFocusShortfall(events(1, 5), { focus: "spotlight", material: two }).needed, 2);
  assert.equal(playerFocusShortfall(events(0, 6), { focus: "spotlight", material: [] }), null);
});

test("below three events no share is asked for", () => {
  assert.equal(playerFocusShortfall(events(0, 2), { focus: "spotlight", material: plenty }), null);
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

test("an order settled by a skip remembers the round it was carried out in", () => {
  const queue = [
    { id: "a1", status: "planned", text: "Fund the shipyard" },
    { id: "a2", status: "resolved", text: "Old", resolvedRound: 3 },
  ];
  const settled = settleOrders(queue, [{ impacts: { actionIds: ["a1"] } }], { round: 9 });
  assert.equal(settled[0].resolvedRound, 9);
  assert.equal(settled[1].resolvedRound, 3, "an order settled before keeps its own round");
});

// The advisor queued "Hask to load at dusk 13 September" twice, word for word,
// thirteen minutes apart, when the player had only asked how things stood.
test("repeatedOrder finds the same order still queued, or carried out in the last two skips", () => {
  const actions = [
    { id: "q", status: "planned", title: "Hask to load at dusk 13 September" },
    { id: "r1", status: "resolved", title: "Raven to White Harbor", resolvedRound: 56 },
    { id: "r2", status: "resolved", title: "Stock the Wall before winter", resolvedRound: 54 },
    { id: "r3", status: "resolved", title: "Keep Robb at Winterfell" },
  ];
  assert.equal(repeatedOrder(actions, "  hask to load at DUSK 13 september ", { round: 57 })?.id, "q");
  assert.equal(repeatedOrder(actions, "Raven to White Harbor", { round: 57 })?.id, "r1");
  assert.equal(repeatedOrder(actions, "Stock the Wall before winter", { round: 57 }), null, "older orders may be given again");
  assert.equal(repeatedOrder(actions, "Keep Robb at Winterfell", { round: 57 }), null, "an order with no round cannot be dated");
  assert.equal(repeatedOrder(actions, "A new order", { round: 57 }), null);
  assert.equal(repeatedOrder(actions, "", { round: 57 }), null);
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

test("the filler filter spares an event that answers an order or moves a Project with something due", () => {
  const material = collectPlayerMaterial({ ...campaign, ...window, playerNames: [PLAYER] });
  const spare = createSpareTest(material);
  assert.equal(spare({ title: "Officials review plans", impacts: { actionIds: ["a1"] } }), true);
  assert.equal(spare({ title: "Engineers bring the first node online", impacts: { projectOps: [{ op: "milestone", projectId: "p-turing", milestone: { title: "First quantum node online", status: "done" } }] } }), true);
  assert.equal(spare({ title: "A schedule review", impacts: { projectOps: [{ op: "update", name: "project argus", lastUpdate: "Behind." }] } }), true, "by the Board's name, case aside");
  // A Project's name in the words, with no op: not what spares it.
  assert.equal(spare({ title: "Project Turing engineers bring the first node online", impacts: {} }), false);
  // Another Project's op, or one only in its lead-up month: not due.
  assert.equal(spare({ title: "A carrier", impacts: { projectOps: [{ op: "update", projectId: "p-foreign" }] } }), false);
  assert.equal(spare({ title: "Ministry reviews road standards", impacts: {} }), false);
  assert.equal(createSpareTest([])({ title: "x", impacts: { projectOps: [{ op: "update", projectId: "p-turing" }] } }), false);
});

// A folded skip's board ops have been lifted off its events by the time the
// filter runs (gameplay.js foldedTurnReview): the caller hands them back by event.
test("the filler filter reads the board ops the caller hands it for each event", () => {
  const material = collectPlayerMaterial({ ...campaign, ...window, playerNames: [PLAYER] });
  const lifted = new Map([["segment-1-event-2", [{ op: "update", projectId: "p-argus", progress: 80 }]]]);
  const spare = createSpareTest(material, { boardOpsOf: (event) => lifted.get(event.id) ?? [] });
  assert.equal(spare({ id: "segment-1-event-2", title: "Quiet progress", impacts: {} }), true);
  assert.equal(spare({ id: "segment-1-event-3", title: "Quiet progress", impacts: {} }), false);
});

// Names were folded to their a-z and 0-9, so one in another script folded to
// nothing: a Project named in the player's language never spared the event
// that named it, and one owned by a polity named in Cyrillic had a blank owner,
// which on the Board means the player.
test("Projects and their owners are told apart in any script, and an event about one is spared by its op in any language", () => {
  const board = {
    ...campaign,
    projects: [
      { id: "p-fortress", name: "Проект «Береговая крепость»", ownerCode: "", status: "active", targetDate: "2016-08-20", milestones: [] },
      { id: "p-carrier", name: "Авианосец «Шторм»", ownerCode: "Российская Федерация", status: "active", targetDate: "2016-08-10", milestones: [] },
      { id: "p-rail", name: "高速铁路计划", ownerCode: "中华人民共和国", status: "active", targetDate: "2016-08-12", milestones: [] },
    ],
  };
  const material = collectPlayerMaterial({ ...board, ...window, playerNames: [PLAYER] });
  assert.deepEqual(material.filter((item) => item.kind === "target").map((item) => item.id), ["p-fortress"], "another polity's Projects are not the player's");

  const spare = createSpareTest(material);
  const op = { op: "update", projectId: "p-fortress", progress: 90 };
  // The same event told in four languages: spared alike by its op, and alike without it.
  for (const title of ["Coastal Fortress: battery commissioned", "Forteresse côtière : batterie mise en service", "Проект «Береговая крепость»: артиллерийская батарея введена в строй", "海岸要塞：炮台投入使用"]) {
    assert.equal(spare({ title, impacts: { projectOps: [op] } }), true, title);
    assert.equal(spare({ title, impacts: {} }), false, title);
  }
  assert.equal(spare({ title: "Министерство пересматривает дорожные нормы", impacts: { projectOps: [{ op: "update", name: "Проект «Береговая крепость»" }] } }), true, "by the Board's own name in its own script");
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

test("the share the jump is told is capped by what the player actually has going on", () => {
  const thin = [
    { kind: "order", id: "a1", label: "Fortify the Falklands", required: true },
    { kind: "storyline", id: "s1", label: "Falklands standoff", required: false },
  ];
  const text = buildPlayerFocusDirective({ focus: "spotlight", worldShare: 35, material: thin, playerName: PLAYER });
  assert.match(text, /never more than the 2/, "a Spotlight player with two threads is not asked for three quarters of the month");
  // "At least" and then "a ceiling" told the model two opposite things; the
  // share is one minimum, bounded by what is listed.
  assert.match(text, /a minimum only as far as the items below allow, not a quota to fill/);
  assert.doesNotMatch(text, /ceiling/);
  const plentyText = buildPlayerFocusDirective({
    focus: "spotlight",
    material: Array.from({ length: 9 }, (_, index) => ({ kind: "storyline", id: `s${index}`, label: "x", required: false })),
    playerName: PLAYER,
  });
  assert.match(plentyText, /75%/, "with plenty going on the level's own share is what it asks for");
});

// --- Orders told without their id ---
// From a player's log: the treaty was ratified five times because no event
// cited the order, so it stayed overdue and every jump retold it. The engine
// then gave a Player event that shared most of an order's longer words the
// order's id (citeNarratedOrders): the wrong order among two about the same
// treaty, and never in Chinese, Japanese or a language that inflects its words.
// An order is answered by its id alone; one told without it stays overdue, and
// the next skip is told to answer it by id.

const nigeriaOrder = {
  id: "order-nigeria",
  status: "planned",
  title: "Finalize and Ratify the Nigerian Imperial Accession Treaty",
  text: "Dispatch diplomatic envoys to Abuja to conclude the final legislative review.",
};

test("an order told without its id stays queued and overdue, in English as in any other language", () => {
  for (const title of [
    "British Crown Ratifies the Nigerian Imperial Accession Treaty in Abuja",
    "La Couronne britannique ratifie le traité d'adhésion impériale du Nigeria à Abuja",
    "Британская корона ратифицирует договор о присоединении Нигерии",
    "英国王室在阿布贾批准尼日利亚帝国加入条约",
  ]) {
    const told = [{ title, description: "", playerRelated: true, impacts: {} }];
    const [settled] = settleOrders([nigeriaOrder], told);
    assert.equal(settled.status, "planned", title);
    assert.equal(settled.overdue, true, title);
    // Told with its id, it is answered, whatever the language.
    assert.equal(settleOrders([nigeriaOrder], [{ ...told[0], impacts: { actionIds: ["order-nigeria"] } }])[0].status, "resolved", title);
  }
});

test("no event is given an order's id by its words: the skip's events go to the curator as they were written", async () => {
  const { readFileSync } = await import("node:fs");
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const focus = readFileSync(new URL("./playerFocus.js", import.meta.url), "utf8");
  assert.doesNotMatch(gameplay, /citeNarratedOrders|ORDER_VERB_WORDS/);
  assert.doesNotMatch(focus, /export const citeNarratedOrders|ORDER_VERB_WORDS|stemsOf/);
  assert.match(gameplay, /const mainCuration = await curateGeneratedEventsWithHidden\(\{\s*events: dedupedEvents,/);
});

// --- A game that is not played in Latin letters ---
// From a player's log (2026-10-05): the game in Russian, the orders, the
// Projects and the events all in Cyrillic. Every rule above read words, and
// the words were folded to a-z0-9: there were none. A Project was never found
// named, and a polity named in Cyrillic folded to no name at all, which the
// Board reads as the player's own.

const RUSSIA = "Российская Федерация";

test("a Player event in Russian or Chinese counts exactly as its English twin, by its mark", () => {
  const marked = (title) => ({ title, description: "", playerRelated: true });
  const english = [marked("The Russian Federation opens a shipyard"), marked("Riots in Sevastopol"), { title: "Seoul and Pyongyang trade fire" }];
  const russian = [marked("Российская Федерация открывает верфь"), marked("Беспорядки в Севастополе"), { title: "Сеул и Пхеньян обмениваются огнём" }];
  const chinese = [marked("俄罗斯联邦开设造船厂"), marked("塞瓦斯托波尔发生骚乱"), { title: "首尔与平壤交火" }];
  const counted = (list) => playerFocusShortfall(list, { focus: "spotlight", material: plenty, playerName: RUSSIA })?.have ?? "met";
  assert.deepEqual([counted(english), counted(russian), counted(chinese)], [2, 2, 2]);
});

test("a Project named in Cyrillic is the player's or another's by its owner, and is spared by its op", () => {
  const board = [
    { id: "p-leviathan", name: "Проект Левиафан", ownerCode: "", status: "active", targetDate: "2014-06-01", milestones: [] },
    { id: "p-fortress", name: "Проект Береговая Крепость", ownerCode: RUSSIA, status: "active", targetDate: "2014-05-15", milestones: [] },
    { id: "p-kyiv", name: "Программа перевооружения", ownerCode: "Украина", status: "active", targetDate: "2014-05-20", milestones: [] },
  ];
  const material = collectPlayerMaterial({
    projects: board, originDate: "2014-05-01", targetDate: "2014-06-01", playerNames: [RUSSIA],
  });
  assert.deepEqual(
    material.filter((item) => item.kind === "target").map((item) => item.id).sort(),
    ["p-fortress", "p-leviathan"],
    "Ukraine's programme is not the player's: its owner has a name",
  );
  const spare = createSpareTest(material);
  assert.equal(spare({ title: "Установлен энергетический блок", impacts: { projectOps: [{ op: "update", projectId: "p-leviathan", progress: 70 }] } }), true);
  assert.equal(spare({ title: "Проект Левиафан: установлен энергетический блок", impacts: {} }), false, "named in the words alone");
  assert.equal(spare({ title: "Министерство пересматривает дорожные нормы", impacts: { projectOps: [{ op: "update", projectId: "p-kyiv" }] } }), false, "another polity's programme is not due");
});

test("the jump is told to mark its Player events, and that the mark is what is counted", () => {
  const text = buildPlayerFocusDirective({ focus: "balanced", material: plenty, playerName: PLAYER });
  assert.match(text, /Mark every Player event playerRelated: that mark is what the engine counts\./);
  const due = buildPlayerFocusDirective({ focus: "balanced", material: [{ kind: "target", id: "p", label: "Project Argus: target date 2016-08-20", required: true }], playerName: PLAYER });
  assert.match(due, /DUE THIS PERIOD — each gets an outcome in an event that names the Project exactly: reached, slipped or missed, with the board op that records it wherever you keep the board\./);
});

// A time skip's [This Round] lists the orders with their ids and words
// (promptContext.js buildActionHistoryText ids): the focus names them by id.
test("where the orders are listed above, the focus names them by id and does not repeat their words", async () => {
  const material = [
    { kind: "order", id: "a1", label: "Fund the shipyard", required: true },
    { kind: "order", id: "a2", label: "Recall the ambassador", required: true, overdue: true },
  ];
  const text = buildPlayerFocusDirective({ focus: "balanced", material, playerName: PLAYER, ordersAbove: true });
  assert.match(text, /ORDERS \(their words are under \[This Round\] above, by the same ids\) — every one gets an outcome this period/);
  assert.match(text, /^- \[a2\] \(OVERDUE: carried over unanswered from the last period; answer it first\)$/m, "the overdue order first, by id");
  assert.match(text, /^- \[a1\]$/m);
  assert.equal(text.includes("Fund the shipyard") || text.includes("Recall the ambassador"), false);
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync(new URL("./gameplay.js", import.meta.url), "utf8"), /playerFocusDirective: buildPlayerFocusDirective\(\{[\s\S]{0,400}?ordersAbove: true,/);
});
