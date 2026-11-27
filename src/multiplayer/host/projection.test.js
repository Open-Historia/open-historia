/*! Open Historia — what one player may see of the host's game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/projection.test.js
//
// Canaries: a unique string planted in every private place of one player's
// state must appear nowhere in any other player's view, byte for byte, because
// the view is exactly what crosses the network. And each player must still see
// all of its own.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WORLD_DEFAULTS, normalizeChats, normalizeEvents, normalizeWorldState } from "../../runtime/gameState.js";
import { projectChatThread } from "../../runtime/chatThreads.js";
import { newSeal } from "../../runtime/spySeal.js";
import {
  FILTERED_WORLD_KEY_NAMES,
  HOST_ONLY_WORLD_KEYS,
  PUBLIC_WORLD_KEYS,
  projectForViewer,
} from "./projection.js";

const LATVIA = "Republic of Latvia"; // the host's own seat
const RUSSIA = "Russian Federation"; // a second person
const ESTONIA = "Republic of Estonia"; // the AI's

const unit = (id, ownerCode, extra = {}) => ({
  id, name: id, type: "infantry", ownerCode, strength: 90, lng: 25, lat: 57, status: "idle", source: "ai", ...extra,
});

const state = () => ({
  game: { country: LATVIA, humanCountries: [LATVIA, RUSSIA], gameDate: "2014-04-01", round: 4 },
  world: {
    polityOverrides: {
      [LATVIA]: { code: LATVIA, name: LATVIA, status: "active" },
      [RUSSIA]: { code: RUSSIA, name: RUSSIA, status: "active" },
      [ESTONIA]: { code: ESTONIA, name: ESTONIA, status: "active" },
    },
    wars: [{ id: "war-1", status: "active", sideA: [RUSSIA], sideB: [ESTONIA], cause: "PUBLIC-WAR" }],
    units: [
      unit("ru-1", RUSSIA, { orderId: "order-ru-march", note: "PUBLIC-UNIT-NOTE" }),
      unit("lv-1", LATVIA, { orderId: "order-lv-patrol" }),
    ],
    pendingUnitOrders: [
      { id: "order-ru-march", unitId: "ru-1", kind: "move", toLng: 31.1, toLat: 60.4, note: "CANARY-RU-DESTINATION" },
      { id: "order-lv-patrol", unitId: "lv-1", kind: "patrol", toLng: 21.1, toLat: 56.5, radiusKm: 50, note: "CANARY-LV-PATROL" },
    ],
    spies: [
      { id: "spy-ru-in-est", owner: RUSSIA, target: ESTONIA, status: "active", deployedAt: "2014-03-01", coverStory: "", suspected: false },
      { id: "spy-lv-in-ru", owner: LATVIA, target: RUSSIA, status: "turned", deployedAt: "2014-03-01", coverStory: "CANARY-COVER-STORY", turnedAt: "2014-03-20", suspected: false },
      { id: "spy-ru-in-lv", owner: RUSSIA, target: LATVIA, status: "discovered", deployedAt: "2014-03-01", coverStory: "", suspected: false },
    ],
    // The host's own board, as single player keeps it: its own work, and what
    // its services have learned of Russia's.
    projects: [
      { id: "proj-lv", name: "CANARY-LV-PROJECT", kind: "operation", ownerCode: "", summary: "x", status: "active", secrecy: "covert" },
      { id: "proj-lv-on-ru", name: "CANARY-LV-FILE-ON-RU", kind: "operation", ownerCode: RUSSIA, summary: "x", status: "active", secrecy: "covert" },
      // Estonia's own covert work, which Russia's agent there has learned of.
      { id: "proj-est", name: "Estonian Shield", kind: "project", ownerCode: ESTONIA, summary: "x", status: "active", secrecy: "covert", knownBy: { [RUSSIA]: { spyIds: ["spy-ru-in-est"], verification: "doubted" } } },
    ],
    // The second person's board.
    seatBoards: {
      [RUSSIA]: [
        { id: "proj-ru", name: "CANARY-RU-PROJECT", kind: "operation", ownerCode: "", summary: "x", status: "active", secrecy: "covert" },
        { id: "proj-ru-on-lv", name: "CANARY-RU-FILE-ON-LV", kind: "operation", ownerCode: LATVIA, summary: "x", status: "active" },
        // What nobody hides, everybody sees.
        { id: "proj-ru-public", name: "Moscow Metro Extension", kind: "project", ownerCode: "", summary: "x", status: "active", secrecy: "public" },
      ],
    },
    actionSuggestions: [{ id: "topic-1", title: "CANARY-LV-SUGGESTION", actions: [] }],
    puppets: [
      { id: "pup-covert", overlord: RUSSIA, puppet: ESTONIA, kind: "client", secrecy: "covert", loyalty: 37, knownTo: [], status: "active", startedDate: "2014-01-01" },
    ],
    reports: [
      { id: "rep-ru", title: "Moscow memo", body: "CANARY-RU-REPORT", visibleTo: [RUSSIA] },
      { id: "rep-lv", title: "Riga memo", body: "Riga's own paper", visibleTo: [LATVIA], interceptedBy: [RUSSIA] },
      { id: "rep-public", title: "Communiqué", body: "PUBLIC-COMMUNIQUE" },
    ],
    relations: [
      { id: "rel-ru-est", a: RUSSIA, b: ESTONIA, score: -61, status: "rival", summary: "CANARY-RU-EST-RELATION" },
      { id: "rel-lv-ru", a: LATVIA, b: RUSSIA, score: -40, status: "tense", summary: "a relation both know" },
    ],
    countryStats: {
      [RUSSIA]: { capital: "Moscow", stability: 60, customStats: { prestige: 4242 }, indices: { sovereignty: 80 } },
      [LATVIA]: { capital: "Riga", stability: 70, customStats: { prestige: 5151 }, indices: { sovereignty: 60 } },
    },
    countryStatsHistory: { [RUSSIA]: [{ date: "2014-01-01", stability: 58 }] },
    intelligence: { [RUSSIA]: 88, [LATVIA]: 36 },
    playerGoals: { [RUSSIA]: { text: "CANARY-RU-GOAL" }, [LATVIA]: { text: "Riga's goal" } },
    politicalActors: {
      schemaVersion: 1,
      byPolity: {
        [RUSSIA]: { polityKey: RUSSIA, name: RUSSIA, government: { name: "Government of Russia" }, strategy: { summary: "CANARY-RU-STRATEGY" }, traits: { aggression: 81 }, goals: ["a public goal"] },
      },
    },
    institutions: {
      byId: {
        "baltic-council": {
          id: "baltic-council", name: "Baltic Council", status: "active", kind: "regional",
          members: [{ polity: LATVIA, status: "active" }, { polity: ESTONIA, status: "active" }],
          proposals: { p1: { id: "p1", title: "CANARY-BALTIC-PROPOSAL" } },
        },
      },
    },
    storylines: [{ id: "story-1", status: "active", title: "CANARY-STORYLINE" }],
    lastJumpSummary: "CANARY-JUMP-SUMMARY",
    simulationHistory: [{
      round: 3, date: "2014-03-30", fromDate: "2014-03-01", toDate: "2014-03-30", mode: "jump", source: "fallback",
      eventIds: ["e1"], summary: "CANARY-TURN-SUMMARY", rawResponse: "CANARY-RAW-RESPONSE", fallbackReason: "CANARY-HOST-PROVIDER-ERROR",
      receipt: { notes: ["CANARY-RECEIPT-NOTE"] }, transactionId: "CANARY-TRANSACTION",
      plannedActions: [
        { id: "order-ru-0", status: "planned", title: "March", text: "CANARY-RU-PAST-ORDER", ownerCode: RUSSIA },
        { id: "order-lv-0", status: "planned", title: "Talks", text: "CANARY-LV-PAST-ORDER" },
      ],
    }],
    gmAudit: [{ id: "gm-1", note: "CANARY-GM-AUDIT" }],
    notes: "CANARY-GM-NOTES",
    spySeal: SEAL,
    activeInteractive: { id: "scene-1", premise: "CANARY-LV-SCENE" },
  },
  events: [
    {
      id: "e1", date: "2014-03-30", title: "Russia moves troops toward Estonia", description: "Columns roll west.",
      importance: "major", kind: "world", playerRelated: true, storylineIds: ["story-1"],
      agency: { principal: RUSSIA, principalKind: "polity", sovereignPolity: RUSSIA, authority: "player-order", authorityRef: "order-ru-1", sovereignActors: [{ polity: RUSSIA, authority: "player-order", authorityRef: "order-ru-1" }] },
      impacts: {
        actionIds: ["order-ru-1"],
        unitOps: [{ op: "move", unitId: "ru-1", toLng: 31.1, toLat: 60.4, note: "CANARY-MOVE-NOTE" }],
        spyOps: [{ op: "deploy", target: ESTONIA, note: "CANARY-SPYOP" }],
        projectOps: [{ op: "update", projectId: "proj-ru", note: "CANARY-PROJECTOP" }],
        politicalActorOps: [{ op: "set-strategy", polityKey: RUSSIA, argsJson: "{\"summary\":\"CANARY-ACTOROP\"}" }],
        reports: [{ op: "create", title: "t", body: "CANARY-EVENT-DOCUMENT" }],
        // A letter to each player (AI/sharedLetters.js): each is its addressee's.
        createdChats: [
          { to: LATVIA, countries: [ESTONIA], openingMessage: "CANARY-LV-OPENING" },
          { to: RUSSIA, countries: [ESTONIA], openingMessage: "CANARY-RU-LETTER" },
        ],
        regionControlOps: [{ op: "control", regionId: "Ida-Viru", toCode: RUSSIA }],
      },
      npcReaction: { enabled: true, chatId: "CANARY-NPC-CHAT" },
    },
  ],
  chat: [
    {
      id: "chat-ru-est", player: RUSSIA, countries: [{ code: ESTONIA, name: ESTONIA }],
      messages: [
        { id: "m1", role: "user", speaker: RUSSIA, text: "CANARY-RU-TO-EST" },
        { id: "m2", role: "leader", speaker: ESTONIA, code: ESTONIA, text: "Tallinn answers.", memorySummary: "CANARY-LEADER-MEMORY" },
      ],
    },
    {
      id: "chat-lv-ru", countries: [{ code: RUSSIA, name: RUSSIA }],
      messages: [
        { id: "m3", role: "user", text: "Riga writes to Moscow." },
        { id: "m4", role: "leader", speaker: RUSSIA, code: RUSSIA, text: "Moscow writes back." },
      ],
    },
    {
      id: "chat-lv-est", countries: [{ code: ESTONIA, name: ESTONIA }],
      messages: [{ id: "m5", role: "user", text: "CANARY-LV-TO-EST" }],
    },
  ],
  actions: [
    { id: "order-ru-1", status: "planned", title: "March", text: "CANARY-RU-ORDER", ownerCode: RUSSIA },
    { id: "order-lv-1", status: "planned", title: "Talks", text: "CANARY-LV-ORDER" },
  ],
  intercepts: { [RUSSIA]: { gatheredAt: "2014-03-30", exchanges: [{ subject: "CANARY-LV-INTERCEPT" }] } },
  colors: { [RUSSIA]: "#aa0000" },
  flags: {},
});

const text = (view) => JSON.stringify(view);
const SEAL = newSeal();

test("every world key is public, filtered for the viewer, or the host's alone, and only one of those", () => {
  const classified = [...PUBLIC_WORLD_KEYS, ...FILTERED_WORLD_KEY_NAMES, ...HOST_ONLY_WORLD_KEYS];
  assert.equal(new Set(classified).size, classified.length, "a key is classified twice");
  const known = new Set(classified);
  const keys = new Set([...Object.keys(WORLD_DEFAULTS), ...Object.keys(normalizeWorldState(state().world))]);
  const missing = [...keys].filter((key) => !known.has(key));
  assert.deepEqual(missing, [], "classify these world keys in projection.js");
});

test("nothing private of the second player reaches the host's view", () => {
  const view = text(projectForViewer(state(), LATVIA));
  for (const canary of [
    "CANARY-RU-DESTINATION", "CANARY-RU-PROJECT", "CANARY-RU-FILE-ON-LV", "CANARY-RU-PAST-ORDER", "CANARY-RU-REPORT", "CANARY-RU-EST-RELATION",
    "CANARY-RU-GOAL", "CANARY-RU-STRATEGY", "CANARY-RU-TO-EST", "CANARY-RU-ORDER",
    "order-ru-1", "order-ru-march", "CANARY-MOVE-NOTE", "CANARY-ACTOROP", "CANARY-LEADER-MEMORY",
    "spy-ru-in-est", "pup-covert",
    // The letter the skip wrote to the second player (the gap audit's N7).
    "CANARY-RU-LETTER",
  ]) assert.equal(view.includes(canary), false, `${canary} leaked to the host's view`);
  // Numbers are checked where they live: a bare "88" can turn up in any timestamp.
  // How good Russia's service is, is Russia's to know: everyone else has an estimate.
  const world = projectForViewer(state(), LATVIA).world;
  assert.deepEqual(world.intelligence, { [RUSSIA]: 90, [LATVIA]: 36 });
  // A stat sheet is what anyone can count: it goes to everyone whole, as single player shows it.
  const whole = normalizeWorldState(state().world);
  assert.deepEqual(world.countryStats[RUSSIA], whole.countryStats[RUSSIA]);
  assert.equal(world.countryStats[RUSSIA].customStats.prestige, 4242);
  assert.deepEqual(world.countryStatsHistory, whole.countryStatsHistory);
});

test("nothing private of the host reaches the second player's view", () => {
  const view = text(projectForViewer(state(), RUSSIA));
  for (const canary of [
    "CANARY-LV-PATROL", "CANARY-LV-PROJECT", "CANARY-LV-FILE-ON-RU", "CANARY-LV-PAST-ORDER", "CANARY-HOST-PROVIDER-ERROR",
    "CANARY-LV-TO-EST", "CANARY-LV-ORDER", "order-lv-1", "order-lv-patrol",
    SEAL, "CANARY-LV-SCENE", "CANARY-LV-INTERCEPT", "CANARY-LV-OPENING",
    "CANARY-BALTIC-PROPOSAL", "Riga's goal",
  ]) assert.equal(view.includes(canary), false, `${canary} leaked to the second player's view`);
});

test("the narrator's own never reaches any view, the host's included", () => {
  for (const seat of [LATVIA, RUSSIA, ESTONIA]) {
    const view = text(projectForViewer(state(), seat));
    for (const canary of [
      "CANARY-STORYLINE", "story-1", "CANARY-JUMP-SUMMARY", "CANARY-RAW-RESPONSE", "CANARY-GM-AUDIT", "CANARY-GM-NOTES",
      "CANARY-TURN-SUMMARY", "CANARY-RECEIPT-NOTE", "CANARY-TRANSACTION", "CANARY-LV-SUGGESTION",
      "CANARY-SPYOP", "CANARY-PROJECTOP", "CANARY-EVENT-DOCUMENT", "CANARY-NPC-CHAT",
    ]) assert.equal(view.includes(canary), false, `${canary} reached ${seat}'s view`);
  }
});

test("each player sees all of its own, as single player shows it", () => {
  const ru = projectForViewer(state(), RUSSIA);
  assert.equal(ru.game.country, RUSSIA);
  assert.deepEqual(ru.actions.map((action) => action.id), ["order-ru-1"]);
  assert.deepEqual(ru.world.pendingUnitOrders.map((order) => order.id), ["order-ru-march"]);
  assert.equal(ru.world.units.find((entry) => entry.id === "ru-1").orderId, "order-ru-march");
  assert.deepEqual(ru.world.projects.map((project) => project.id), ["proj-ru", "proj-ru-on-lv", "proj-ru-public", "proj-est"], "its own board, whole, and what it knows of abroad");
  // The newest turn, for its Events panel: when it ran, what it wrote, its own orders.
  assert.deepEqual(ru.world.simulationHistory, [{
    date: "2014-03-30", fromDate: "2014-03-01", toDate: "2014-03-30", round: 3, mode: "jump", source: "fallback",
    eventIds: ["e1"],
    plannedActions: ru.world.simulationHistory[0].plannedActions,
  }]);
  assert.deepEqual(ru.world.simulationHistory[0].plannedActions.map((action) => action.id), ["order-ru-0"]);
  assert.deepEqual(ru.world.intelligence, { [RUSSIA]: 88, [LATVIA]: 40 }, "its own exactly, another's to the nearest ten");
  assert.deepEqual(ru.world.playerGoals, { [RUSSIA]: { text: "CANARY-RU-GOAL" } });
  assert.equal(ru.world.countryStats[RUSSIA].customStats.prestige, 4242);
  assert.equal(ru.world.countryStats[LATVIA].customStats.prestige, 5151, "every sheet, whole");
  assert.equal(ru.world.politicalActors.byPolity[RUSSIA].strategy.summary, "CANARY-RU-STRATEGY");
  assert.equal(ru.world.puppets[0].loyalty, 37, "the overlord knows its puppet's loyalty");
  assert.deepEqual(ru.world.reports.map((report) => report.id).sort(), ["rep-lv", "rep-public", "rep-ru"]);
  assert.deepEqual(ru.events[0].impacts.actionIds, ["order-ru-1"]);
  assert.equal(ru.events[0].impacts.unitOps.length, 1, "its own march order");
  assert.equal(ru.events[0].playerRelated, true);

  const lv = projectForViewer(state(), LATVIA);
  assert.deepEqual(lv.world.projects.map((project) => project.id), ["proj-lv", "proj-lv-on-ru", "proj-est", "proj-ru-public"], "the game's own board, as single player keeps it, and the work nobody hides");
  assert.deepEqual(lv.world.simulationHistory[0].plannedActions.map((action) => action.id), ["order-lv-0"]);
  assert.equal(lv.world.simulationHistory[0].fallbackReason, "CANARY-HOST-PROVIDER-ERROR", "the host's own model failed: the host is told why");
  assert.equal(lv.world.spySeal, SEAL);
  assert.equal(lv.world.activeInteractive.premise, "CANARY-LV-SCENE");
  assert.deepEqual(Object.keys(lv.intercepts), [RUSSIA]);
  assert.equal(lv.world.institutions.byId["baltic-council"].proposals.p1.title, "CANARY-BALTIC-PROPOSAL");
  assert.equal(lv.events[0].impacts.createdChats.length, 1);
});

test("the game's own rules hold inside a view: turned agents, caught agents, stolen papers, covert puppets", () => {
  const lv = projectForViewer(state(), LATVIA);
  const mine = lv.world.spies.find((spy) => spy.id === "spy-lv-in-ru");
  assert.equal(mine.status, "active", "an owner never learns its agent was turned");
  assert.equal("coverStory" in mine, false);
  assert.ok(lv.world.spies.some((spy) => spy.id === "spy-ru-in-lv"), "Latvia caught Russia's agent, so knows it");
  assert.equal(lv.world.puppets.length, 0, "a covert arrangement nobody told Latvia of");
  const riga = lv.world.reports.find((report) => report.id === "rep-lv");
  assert.equal("interceptedBy" in riga, false, "a holder never learns its paper was read");

  const ru = projectForViewer(state(), RUSSIA);
  const turned = ru.world.spies.find((spy) => spy.id === "spy-lv-in-ru");
  assert.equal(turned.coverStory, "CANARY-COVER-STORY", "Russia turned the agent, and writes what it is fed");
  const stolen = ru.world.reports.find((report) => report.id === "rep-lv");
  assert.deepEqual(stolen.interceptedBy, [RUSSIA]);
  assert.ok(ru.world.spies.some((spy) => spy.id === "spy-ru-in-lv"), "its own agent, still believed free");

  const est = projectForViewer(state(), ESTONIA);
  assert.equal(est.world.spies.some((spy) => spy.id === "spy-lv-in-ru"), false, "nobody else knows of it");
  assert.equal(text(est).includes("CANARY-COVER-STORY"), false);
  assert.equal(est.world.puppets.length, 1, "the puppet knows its overlord");
  assert.equal("loyalty" in est.world.puppets[0], false, "but not its own loyalty score");
});

// The review of 2026-11-18, views 2: a guest's board showed nothing abroad, and
// nobody saw a guest's public work. Each board now shows another country's work
// as single player shows it, with what the viewer's own service knows of it.
test("every board shows the work abroad nobody hides, and what the viewer's own service knows, nothing anyone else's does", () => {
  const ru = projectForViewer(state(), RUSSIA).world.projects;
  const shield = ru.find((project) => project.id === "proj-est");
  assert.deepEqual([shield.ownerCode, shield.linkedSpyIds, shield.verification, shield.known, "knownBy" in shield], [ESTONIA, ["spy-ru-in-est"], "doubted", true, false]);
  const lv = projectForViewer(state(), LATVIA).world.projects;
  const metro = lv.find((project) => project.id === "proj-ru-public");
  assert.deepEqual([metro.ownerCode, metro.known, metro.linkedSpyIds], [RUSSIA, false, []]);
  assert.equal("knownBy" in lv.find((project) => project.id === "proj-est"), false, "the host's board never says what Russia knows");
  const est = projectForViewer(state(), ESTONIA).world.projects;
  assert.deepEqual(est.map((project) => project.id), ["proj-ru-public"], "a country nobody plays here sees only what nobody hides");
});

// The review of 2026-11-18, views 9: an agent's id is made from its owner's
// name, so one caught whose sender was never learned still named its sender.
test("an agent caught without its sender ever being learned reaches the country that caught it under a name of the view's own", () => {
  const s = state();
  s.world.spies.push(
    { id: "spy-russian-federation-republic-of-latvia-2", owner: RUSSIA, target: LATVIA, status: "dead", identified: false, deployedAt: "2014-02-01", exposedAt: "2014-03-15" },
    { id: "spy-republic-of-estonia-republic-of-latvia-1", owner: ESTONIA, target: LATVIA, status: "dead", identified: false, deployedAt: "2014-02-10", exposedAt: "2014-03-20" },
  );
  const lv = projectForViewer(s, LATVIA);
  const dead = lv.world.spies.filter((spy) => spy.status === "dead");
  assert.deepEqual(dead.map((spy) => [spy.id, spy.owner]), [["agent-unknown-1", ""], ["agent-unknown-2", ""]]);
  for (const id of ["spy-russian-federation-republic-of-latvia-2", "spy-republic-of-estonia-republic-of-latvia-1"]) assert.equal(text(lv).includes(id), false);
  assert.ok(lv.world.spies.some((spy) => spy.id === "spy-ru-in-lv"), "one caught and known keeps its id: it is held, and orders name it");
  const ru = projectForViewer(s, RUSSIA);
  assert.ok(ru.world.spies.some((spy) => spy.id === "spy-russian-federation-republic-of-latvia-2"), "its owner knows its own agent");
});

test("threads read from each side: the viewer is the implicit player, and its own words are its own", () => {
  const ru = projectForViewer(state(), RUSSIA);
  const own = ru.chat.find((chat) => chat.id === "chat-ru-est");
  assert.deepEqual(own.countries.map((entry) => entry.name), [ESTONIA]);
  assert.equal(own.messages[0].role, "user");
  assert.equal("player" in own, false);
  const withHost = ru.chat.find((chat) => chat.id === "chat-lv-ru");
  assert.deepEqual(withHost.countries.map((entry) => entry.name), [LATVIA]);
  assert.deepEqual(withHost.messages.map((message) => [message.role, message.speaker ?? ""]), [["leader", LATVIA], ["user", RUSSIA]]);
  assert.equal(ru.chat.some((chat) => chat.id === "chat-lv-est"), false);

  const lv = projectForViewer(state(), LATVIA);
  assert.deepEqual(lv.chat.map((chat) => chat.id).sort(), ["chat-lv-est", "chat-lv-ru"]);
  assert.equal(lv.chat.find((chat) => chat.id === "chat-lv-ru").messages[0].role, "user");
});

test("what everyone knows reaches everyone", () => {
  for (const seat of [LATVIA, RUSSIA, ESTONIA]) {
    const view = projectForViewer(state(), seat);
    const all = text(view);
    for (const canary of ["PUBLIC-WAR", "PUBLIC-UNIT-NOTE", "PUBLIC-COMMUNIQUE"]) assert.ok(all.includes(canary), `${canary} missing for ${seat}`);
    assert.equal(view.world.units.length, 2);
    assert.deepEqual(view.events[0].impacts.regionControlOps, [{ op: "control", regionId: "Ida-Viru", toCode: RUSSIA }]);
    assert.equal(view.world.countryStats[RUSSIA].stability, 60);
    assert.equal(view.world.politicalActors.byPolity[RUSSIA].goals[0], "a public goal");
    assert.equal(view.world.institutions.byId["baltic-council"].name, "Baltic Council");
    assert.equal(view.colors[RUSSIA], "#aa0000");
    assert.deepEqual(view.game.humanCountries, [LATVIA, RUSSIA]);
  }
  const est = projectForViewer(state(), ESTONIA);
  assert.equal(est.world.institutions.byId["baltic-council"].proposals.p1.title, "CANARY-BALTIC-PROPOSAL", "a member sees its institution's business");
});

test("a view is a copy: changing it never changes the host's game", () => {
  const source = state();
  const view = projectForViewer(source, RUSSIA);
  view.world.units[0].strength = 1;
  view.actions[0].text = "changed";
  assert.equal(source.world.units[0].strength, 90);
  assert.equal(source.actions[0].text, "CANARY-RU-ORDER");
});

test("a thread's log reads from each side too, and a newcomer sees only what was said since it joined", () => {
  const docs = state();
  docs.chat = [{
    id: "chat-ru-log",
    player: RUSSIA,
    countries: [{ code: ESTONIA, name: ESTONIA }, { code: LATVIA, name: LATVIA }],
    // Beside the log, as the game keeps them: every logged line, and one said
    // just now that the log has not taken in yet.
    messages: [
      { id: "c2", role: "user", text: "CANARY-BEFORE-LATVIA" },
      { id: "c4", role: "user", text: "Moscow speaks." },
      { id: "c5", role: "leader", speaker: ESTONIA, code: ESTONIA, text: "Tallinn answers." },
      { id: "c6", role: "leader", speaker: LATVIA, code: LATVIA, text: "Riga answers." },
      { id: "m-new", role: "user", speaker: RUSSIA, code: RUSSIA, text: "Moscow again." },
    ],
    polls: [{ id: "poll-1", question: "CANARY-POLL-BEFORE-LATVIA", options: [] }],
    events: [
      { id: "c0", kind: "chat_created", title: "Border talks", by: RUSSIA },
      { id: "c1", kind: "member_joined", member: { code: ESTONIA, name: ESTONIA }, by: "" },
      { id: "c2", kind: "message", role: "user", by: "", text: "CANARY-BEFORE-LATVIA" },
      { id: "c3", kind: "member_joined", member: { code: LATVIA, name: LATVIA }, by: "" },
      { id: "c4", kind: "message", role: "user", by: "", text: "Moscow speaks." },
      { id: "c5", kind: "message", role: "leader", by: ESTONIA, code: ESTONIA, text: "Tallinn answers.", memorySummary: "CANARY-LOG-MEMORY" },
      { id: "c6", kind: "message", role: "leader", by: LATVIA, code: LATVIA, text: "Riga answers." },
    ],
  }];
  const lv = projectForViewer(docs, LATVIA).chat[0];
  // Latvia's own joining is not in its copy, and the thread's owner joins at
  // the start: the game's own reader of a log (chatThreads.js) then lists who
  // Latvia is talking to, as it does in single player.
  assert.deepEqual(lv.events.map((event) => event.id), ["c0", "c0-owner", "c1", "c4", "c5", "c6"]);
  assert.deepEqual(projectChatThread(lv.events).countries.map((entry) => entry.name), [RUSSIA, ESTONIA]);
  assert.deepEqual(lv.countries.map((entry) => entry.name), [RUSSIA, ESTONIA]);
  const line = (thread, eventId) => thread.events.find((event) => event.id === eventId);
  assert.deepEqual([line(lv, "c4").role, line(lv, "c4").by], ["leader", RUSSIA]);
  assert.equal(line(lv, "c6").role, "user", "Latvia's own words");
  assert.deepEqual(lv.messages.map((message) => [message.id, message.role]), [["c4", "leader"], ["c5", "leader"], ["c6", "user"], ["m-new", "leader"]]);
  assert.equal("polls" in lv, false, "its screen reads the votes from its own part of the log");
  for (const canary of ["CANARY-LOG-MEMORY", "CANARY-BEFORE-LATVIA", "CANARY-POLL-BEFORE-LATVIA"]) {
    assert.equal(JSON.stringify(lv).includes(canary), false, canary);
  }

  const ru = projectForViewer(docs, RUSSIA).chat[0];
  assert.equal(ru.events.length, 7, "the owner reads its whole thread");
  assert.deepEqual(projectChatThread(ru.events).countries.map((entry) => entry.name), [ESTONIA, LATVIA]);
  assert.equal(ru.messages.length, 5);
  assert.equal(line(ru, "c4").role, "user");
  assert.deepEqual([line(ru, "c6").role, line(ru, "c6").by], ["leader", LATVIA]);
  assert.equal(JSON.stringify(ru).includes("CANARY-LOG-MEMORY"), false);
});

test("a thread a person opened with another reads, for each, as a thread with the other", () => {
  // The United States' line to China, as the game keeps it once its log is
  // written: the owner is in no member list, and China is the one member.
  const docs = state();
  docs.chat = normalizeChats([{
    id: "chat-lv-ru-log",
    player: LATVIA,
    countries: [{ code: RUSSIA, name: RUSSIA }],
    messages: [],
    events: [
      { id: "t0", kind: "chat_created", title: "", by: "" },
      { id: "t1", kind: "member_joined", member: { code: RUSSIA, name: RUSSIA }, by: "" },
      { id: "t2", kind: "message", role: "user", by: LATVIA, code: LATVIA, text: "Riga to Moscow." },
      { id: "t3", kind: "message", role: "user", by: RUSSIA, code: RUSSIA, text: "Moscow to Riga." },
    ],
  }]);
  assert.equal(docs.chat[0].player, LATVIA, "the game's normalizer keeps whose thread it is");
  // Each side's copy, read the way that player's screen reads it.
  const seenBy = (viewer) => normalizeChats(projectForViewer(docs, viewer).chat)[0];
  const ru = seenBy(RUSSIA);
  assert.deepEqual(ru.countries.map((entry) => entry.name), [LATVIA]);
  assert.deepEqual(ru.messages.map((message) => [message.role, message.speaker]), [["leader", LATVIA], ["user", RUSSIA]]);
  const lv = seenBy(LATVIA);
  assert.deepEqual(lv.countries.map((entry) => entry.name), [RUSSIA]);
  assert.deepEqual(lv.messages.map((message) => [message.role, message.speaker]), [["user", LATVIA], ["leader", RUSSIA]]);
});

test("what one government alone found out is shown to that government's player alone", () => {
  // Russia's counter-intelligence catches an agent: an event marked for Russia
  // (runtime/spycraft.js resolveEspionage, with several people playing).
  const docs = state();
  docs.events = [...docs.events, {
    id: "e-caught", date: "2014-03-30", title: "Counter-intelligence uncovers a CANARY-CAUGHT agent",
    description: "The agent is in custody.", importance: "minor", kind: "world", source: "espionage", audience: [RUSSIA],
  }];
  docs.world.simulationHistory[0].eventIds = ["e1", "e-caught"];

  const ru = projectForViewer(docs, RUSSIA);
  assert.deepEqual(ru.events.map((event) => event.id), ["e1", "e-caught"]);
  assert.equal("audience" in ru.events[1], false, "who else an event was for is not sent");
  assert.deepEqual(ru.world.simulationHistory[0].eventIds, ["e1", "e-caught"]);

  for (const seat of [LATVIA, ESTONIA]) {
    const view = projectForViewer(docs, seat);
    assert.deepEqual(view.events.map((event) => event.id), ["e1"], `${seat} is not shown it`);
    assert.deepEqual(view.world.simulationHistory[0].eventIds, ["e1"], "nor does the turn's record count it");
    assert.equal(JSON.stringify(view).includes("CANARY-CAUGHT"), false);
  }
  // An event marked for nobody in particular is everybody's, as in a one-player game.
  assert.equal(projectForViewer(state(), ESTONIA).events.length, state().events.length);
});

// "Yours" is what an event says it is about, never its words: a name found in
// the text made "Oman" Romania's and left "la Roumanie" nobody's.
test("an event is each player's own by what it says it concerns, in any language, never by its words", () => {
  const docs = state();
  docs.events = [
    { id: "a", date: "2014-03-30", title: "Riga and Moscow trade notes", description: "Notes are exchanged.", concerns: [LATVIA, RUSSIA] },
    { id: "b", date: "2014-03-30", title: "Riga et Moscou échangent des notes", description: "Des notes sont échangées.", concerns: ["republic of latvia", RUSSIA] },
    { id: "c", date: "2014-03-30", title: "Republic of Estonia and the Russian Federation", description: "Named in the words only." },
    { id: "d", date: "2014-03-30", title: "Skirmish", description: "Shots on the border.", combatants: [RUSSIA, ESTONIA] },
  ];
  const mine = (seat) => projectForViewer(docs, seat).events.filter((event) => event.playerRelated).map((event) => event.id);
  assert.deepEqual(mine(RUSSIA), ["a", "b", "d"], "the French twin is Russia's as the English one is; the words alone are nobody's");
  assert.deepEqual(mine(ESTONIA), ["d"]);
  assert.deepEqual(mine(LATVIA), ["a", "b"]);
  // The host's own seat keeps the skip's own mark of what is the player's.
  docs.events = [{ id: "e", date: "2014-03-30", title: "Quiet", description: "Nothing named.", playerRelated: true }];
  assert.deepEqual(mine(LATVIA), ["e"]);
  assert.deepEqual(mine(RUSSIA), [], "another seat does not take the host's mark");
  // What an event concerns is kept across a save, and an event that names
  // nobody saves as it always did.
  const [kept, plain] = normalizeEvents([{ id: "k", title: "K", concerns: [RUSSIA, " russian  federation ", "", LATVIA] }, { id: "p", title: "P" }]);
  assert.deepEqual(kept.concerns, [RUSSIA, LATVIA]);
  assert.equal("concerns" in plain, false);
});

test("the game keeps who an event is for across a save, and adds nothing to an event for everybody", () => {
  const [marked, open] = normalizeEvents([
    { id: "a", title: "Marked", audience: [RUSSIA, RUSSIA, "", " "] },
    { id: "b", title: "Open" },
  ]);
  assert.deepEqual(marked.audience, [RUSSIA]);
  assert.equal("audience" in open, false);
});

test("a player's advisor brings them their government's secrets, in a thread of their own; their advice is theirs alone", () => {
  const docs = state();
  docs.events = [...docs.events, {
    id: "e-caught", date: "2014-03-30", title: "Counter-intelligence uncovers a CANARY-CAUGHT agent",
    description: "The agent is in custody.", importance: "minor", kind: "world", source: "espionage", audience: [RUSSIA],
  }];
  docs.world.seatAdvice = {
    [RUSSIA]: { advisor: { name: "Nikolai Patrushev-Volkov", title: "Secretary of the Security Council" }, suggestions: ["CANARY-RU-ADVICE"], round: 3 },
    [LATVIA]: { advisor: { name: "Ilze Kalnina", title: "Chief of the Constitution Protection Bureau" }, suggestions: ["CANARY-LV-ADVICE"], round: 3 },
  };

  const ru = projectForViewer(docs, RUSSIA);
  const desk = ru.chat.find((chat) => chat.source === "advisor");
  assert.equal(desk.title, "Nikolai Patrushev-Volkov, Secretary of the Security Council");
  // The agent caught, and the Riga memo its agents stole; never its own memo.
  assert.deepEqual(desk.messages.map((message) => message.id).sort(), ["advisor-e-caught", "advisor-rep-lv"]);
  assert.ok(desk.messages.every((message) => message.role === "leader" && message.speaker === "Nikolai Patrushev-Volkov"));
  assert.deepEqual(Object.keys(ru.world.seatAdvice), [RUSSIA]);

  const lv = projectForViewer(docs, LATVIA);
  assert.equal(lv.chat.some((chat) => chat.source === "advisor"), false, "Latvia keeps no secret here");
  assert.deepEqual(Object.keys(lv.world.seatAdvice), [LATVIA]);
  assert.equal(JSON.stringify(lv).includes("CANARY-RU-ADVICE"), false);
  assert.equal(JSON.stringify(projectForViewer(docs, ESTONIA)).includes("CANARY-CAUGHT"), false);
});

// Every key the game's code reads of the world, read from the code itself:
// a key the views do not classify is in no view, and a key that only some
// scenarios have (a map's projection, its seas) slipped past a check that knew
// only the keys every world has. Names read off something else called "world"
// are listed here, each with what it is.
const NOT_THE_WORLD = new Map([
  // runtime/fronts/syntheticMap.js and testKit.js: a test map's own helpers.
  ["controller", "fronts test map"], ["controllerOf", "fronts test map"], ["sovereignOf", "fronts test map"],
  ["frame", "fronts test map"], ["map", "fronts test map, the Editor's search results"], ["regions", "fronts test map"],
  // Editor/exportPreset.js and AI/gameplay.js: a scenario's world.json file, by name.
  ["json", "world.json, a file name"],
  // Editor/SearchBar.jsx: a list of places.
  ["length", "the Editor's search results"],
  // Game/Map/seasonTint.js: a colour and how strongly it tints.
  ["rgb", "a season's tint"], ["strength", "a season's tint"],
]);

test("every key of the world the game's code reads is public, filtered for the viewer, or the host's alone", () => {
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const read = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
      } else if (/\.(?:js|jsx)$/.test(entry.name) && !/\.test\.(?:js|jsx)$/.test(entry.name)) {
        for (const match of fs.readFileSync(full, "utf8").matchAll(/\bworld\??\.([A-Za-z_]\w*)/g)) read.add(match[1]);
      }
    }
  };
  walk(SRC);
  const classified = new Set([...PUBLIC_WORLD_KEYS, ...FILTERED_WORLD_KEY_NAMES, ...HOST_ONLY_WORLD_KEYS]);
  const unclassified = [...read].filter((key) => !classified.has(key) && !NOT_THE_WORLD.has(key)).sort();
  assert.deepEqual(unclassified, [], "classify these world keys in projection.js (or name what else they are read off)");
  assert.ok(read.has("projection") && read.has("seas"), "the code was read");
});

test("the map as the scenario draws it reaches every view: its projection, region types and seas", () => {
  const docs = state();
  docs.world = {
    ...docs.world,
    projection: { kind: "flat", noGlobe: true },
    regionTypes: [{ id: "sea", name: "Sea", water: true }],
    seas: [{ name: "Inner Sea", point: [10, 10] }],
    customGeometry: true,
    prehistory: { events: [{ title: "CANARY-PREHISTORY" }] },
    canonContext: { referencePacks: ["CANARY-CANON"] },
  };
  for (const viewer of [LATVIA, RUSSIA]) {
    const world = projectForViewer(docs, viewer).world;
    assert.deepEqual(world.projection, { kind: "flat", noGlobe: true });
    assert.equal(world.regionTypes[0].id, "sea");
    assert.equal(world.seas[0].name, "Inner Sea");
    assert.equal(world.customGeometry, true);
    assert.equal(JSON.stringify(world).includes("CANARY-PREHISTORY"), false, "the Workshop's own record stays the host's");
    assert.equal(JSON.stringify(world).includes("CANARY-CANON"), false);
  }
});

// ---- What is only ordered stays private until the skip (decision 6, "A only") ----

test("another country's formation raised this round is not seen until the skip; one it stood down still is", () => {
  const docs = state();
  docs.world.units = [
    unit("ru-raised", RUSSIA, { status: "pending" }),
    unit("ru-standing", RUSSIA),
    unit("lv-raised", LATVIA, { status: "pending" }),
  ];
  const disbanded = unit("ru-gone", RUSSIA, { strength: 40 });
  docs.actions = [
    { id: "order-ru-disband", kind: "action", source: "order", status: "planned", ownerCode: RUSSIA, text: "Stand down ru-gone", unitRevert: { unitId: "ru-gone", restore: disbanded } },
  ];
  const latvia = projectForViewer(docs, LATVIA).world.units.map((entry) => entry.id).sort();
  assert.deepEqual(latvia, ["lv-raised", "ru-gone", "ru-standing"], "its own pending formation, and Russia's as the world last saw them");
  const russia = projectForViewer(docs, RUSSIA).world.units.map((entry) => entry.id).sort();
  assert.deepEqual(russia, ["ru-raised", "ru-standing"], "its own as they now are: raised, and the stood-down one gone");
  const gone = projectForViewer(docs, LATVIA).world.units.find((entry) => entry.id === "ru-gone");
  assert.equal(gone.orderId, "", "another's unit never carries its order");
  // After the skip the order is no longer planned: the formation is gone for everyone.
  docs.actions = [{ ...docs.actions[0], status: "resolved" }];
  assert.equal(projectForViewer(docs, LATVIA).world.units.some((entry) => entry.id === "ru-gone"), false);
});

test("a fleet's new posture is seen by others only as it stood before it was ordered, until the skip", () => {
  const docs = state();
  docs.world.units = [unit("ru-fleet", RUSSIA, { type: "naval", posture: "blockade", status: "idle" })];
  // Ordered on the game's date (host/onlyOrdered.js withFleetOrdered).
  docs.world.seenFleetPostures = { "ru-fleet": { posture: "patrol", status: "idle", since: "2014-04-01", ordered: { posture: "blockade", status: "idle" } } };
  assert.equal(projectForViewer(docs, LATVIA).world.units[0].posture, "patrol");
  assert.equal(projectForViewer(docs, RUSSIA).world.units[0].posture, "blockade", "its own as ordered");
  assert.equal("seenFleetPostures" in projectForViewer(docs, LATVIA).world, false, "the host's bookkeeping");
});

test("a convoy only ordered is its owner's, and whom a country's ships hunt is that country's own", () => {
  const docs = state();
  const convoy = (id, owner, status, hunters = []) => ({ id, medium: "sea", owner, to: { lng: 24, lat: 59, name: "Tallinn" }, from: { lng: 30, lat: 60 }, status, hunters, load: [] });
  docs.world.transports = [convoy("t1", RUSSIA, "ordered"), convoy("t2", RUSSIA, "moving", [LATVIA, ESTONIA]), convoy("t3", LATVIA, "ordered")];
  const latvia = projectForViewer(docs, LATVIA).world.transports;
  assert.deepEqual(latvia.map((entry) => entry.id).sort(), ["t2", "t3"]);
  assert.deepEqual(latvia.find((entry) => entry.id === "t2").hunters, [LATVIA], "its own hunt only");
  const russia = projectForViewer(docs, RUSSIA).world.transports;
  assert.deepEqual(russia.map((entry) => entry.id).sort(), ["t1", "t2"]);
  assert.deepEqual(russia.find((entry) => entry.id === "t2").hunters, [], "not who hunts its convoy");
});

test("a line ordered since the last skip is its owner's; once time has passed everyone sees it, built or not", () => {
  const docs = state();
  const line = (id, owner, since) => ({ id, name: id, owner, level: 5, points: [[24, 57], [25, 58]], building: { since, days: 60 } });
  docs.world.fortifications = [line("ru-new", RUSSIA, "2014-04-01"), line("ru-rising", RUSSIA, "2014-03-01"), { id: "ru-old", name: "ru-old", owner: RUSSIA, level: 5, points: [[26, 57], [27, 58]] }];
  assert.deepEqual(projectForViewer(docs, LATVIA).world.fortifications.map((entry) => entry.id).sort(), ["ru-old", "ru-rising"]);
  assert.deepEqual(projectForViewer(docs, RUSSIA).world.fortifications.map((entry) => entry.id).sort(), ["ru-new", "ru-old", "ru-rising"]);
});

// An invited player was sent only an institution's public face, no case: its
// hearing and its Institutions tab had nothing to accept (the gap audit of
// 2026-11-18, D5c). A case is its subject's and its opener's to see in full.
test("a country an institution's case is about, or that opened it, sees that case; its business stays the members'", () => {
  const docs = state();
  docs.world.institutions.byId["baltic-council"].lifecycleCases = {
    "invite-ru": { id: "invite-ru", kind: "invitation", status: "pending", polity: RUSSIA, initiatedBy: LATVIA, requestedStatus: "member", reason: "CANARY-RU-INVITE" },
    "apply-ru": { id: "apply-ru", kind: "application", status: "pending-approval", polity: "Republic of Poland", initiatedBy: RUSSIA, reason: "CANARY-RU-SPONSORS" },
    "invite-pl": { id: "invite-pl", kind: "invitation", status: "pending", polity: "Republic of Poland", initiatedBy: ESTONIA, reason: "CANARY-PL-INVITE" },
  };
  const ru = projectForViewer(docs, RUSSIA).world.institutions.byId["baltic-council"];
  assert.deepEqual(Object.keys(ru.lifecycleCases).sort(), ["apply-ru", "invite-ru"]);
  assert.equal(ru.lifecycleCases["invite-ru"].reason, "CANARY-RU-INVITE", "in full");
  assert.equal(ru.proposals, undefined, "the members' business is theirs");
  const lv = projectForViewer(docs, LATVIA).world.institutions.byId["baltic-council"];
  assert.equal(Object.keys(lv.lifecycleCases).length, 3, "a member sees every case");
  // A country with no case there sees none.
  docs.world.institutions.byId["baltic-council"].lifecycleCases = { "invite-pl": docs.world.institutions.byId["baltic-council"].lifecycleCases["invite-pl"] };
  assert.equal(projectForViewer(docs, RUSSIA).world.institutions.byId["baltic-council"].lifecycleCases, undefined);
});

test("an event written for a player's own order and kept off the timeline is told to that player, with why, and to nobody else", () => {
  const docs = state();
  const card = (title, actionIds, route = "UNSUPPORTED_REVERSAL") => ({ title, description: `${title}, as written`, date: "2014-03-20", route, actionIds });
  docs.world.simulationHistory[0].filedEvents = [
    card("CANARY-RU-REFUSED", ["order-ru-0"]),
    card("Talks refused", ["order-lv-0"], "EXACT_DUPLICATE"),
    card("Both at once", ["order-ru-0", "order-lv-0"]),
    card("CANARY-NOBODYS-ORDER", []),
  ];
  const ru = projectForViewer(docs, RUSSIA).world.simulationHistory[0].filedEvents;
  assert.deepEqual(ru.map((entry) => entry.title), ["CANARY-RU-REFUSED", "Both at once"]);
  assert.deepEqual(ru[0].actionIds, ["order-ru-0"]);
  assert.equal(ru[0].fate, "not-recorded");
  assert.match(ru[0].note, /Contradicts what is already on the record/, "the engine's reason, in the player's words");
  assert.deepEqual(ru[1].actionIds, ["order-ru-0"], "another player's order id is theirs");
  const lv = projectForViewer(docs, LATVIA).world.simulationHistory[0].filedEvents;
  assert.deepEqual(lv.map((entry) => entry.title), ["Talks refused", "Both at once"], "the host's own orders (no owner named) are the host's");
  const est = projectForViewer(docs, ESTONIA).world.simulationHistory[0];
  assert.equal("filedEvents" in est, false, "a seat with no order in the turn is told of none");
  for (const viewer of [RUSSIA, LATVIA, ESTONIA]) {
    const view = text(projectForViewer(docs, viewer));
    assert.equal(view.includes("CANARY-NOBODYS-ORDER"), false, "a card that answered nobody's order stays with the host");
    if (viewer !== RUSSIA) assert.equal(view.includes("CANARY-RU-REFUSED"), false, `${viewer} is not told of another's refused order`);
  }
});

// A person's terms of peace to another person were in every player's view (the gap audit of 2026-11-18, N2): the
// screens showed them to the two alone, the network to everyone.
test("terms of peace are the two parties' own until they are taken, and a call to arms the defender's and its ally's until answered", () => {
  const docs = state();
  const offer = (id, from, to, status) => ({ id, warId: "war-1", from, to, terms: { territory: "restored" }, date: "2014-04-01", round: 4, status, source: "player" });
  docs.world.peaceOffers = [
    offer("open-ru-lv", RUSSIA, LATVIA, "open"),
    offer("declined-lv-ru", LATVIA, RUSSIA, "declined"),
    offer("open-est-ru", ESTONIA, RUSSIA, "open"),
    offer("taken-est-lv", ESTONIA, LATVIA, "accepted"),
  ];
  const call = (id, defender, ally, status) => ({ id, warId: "war-1", defender, ally, attackers: [ESTONIA], date: "2014-04-01", round: 4, status });
  docs.world.callsToArms = [call("ask-ru-lv", RUSSIA, LATVIA, "open"), call("ask-est-ru", ESTONIA, RUSSIA, "lapsed"), call("joined-ru-est", RUSSIA, ESTONIA, "honoured")];
  const offers = (viewer) => projectForViewer(docs, viewer).world.peaceOffers.map((entry) => entry.id).sort();
  const calls = (viewer) => projectForViewer(docs, viewer).world.callsToArms.map((entry) => entry.id).sort();
  assert.deepEqual(offers(LATVIA), ["declined-lv-ru", "open-ru-lv", "taken-est-lv"]);
  assert.deepEqual(offers(RUSSIA), ["declined-lv-ru", "open-est-ru", "open-ru-lv", "taken-est-lv"]);
  assert.deepEqual(offers(ESTONIA), ["open-est-ru", "taken-est-lv"], "a peace taken is everyone's to know");
  assert.deepEqual(calls(LATVIA), ["ask-ru-lv", "joined-ru-est"]);
  assert.deepEqual(calls(ESTONIA), ["ask-est-ru", "joined-ru-est"]);
  assert.ok(!text(projectForViewer(docs, ESTONIA)).includes("open-ru-lv"), "not a byte of another's terms");
});

// The review of 2026-11-18, views 6, 7, 8 and 11: what each view carried beyond, or short of, what its government knows.
test("an event's new intelligence rating is exact for its own government only, as world.intelligence is", () => {
  const docs = state();
  docs.events[0].impacts.polityChanges = [
    { operation: "update", code: RUSSIA, intelligence: 83 },
    { operation: "update", code: LATVIA, intelligence: 47, reputation: 61 },
  ];
  const ratings = (viewer) => Object.fromEntries(projectForViewer(docs, viewer).events[0].impacts.polityChanges.map((change) => [change.code, change.intelligence]));
  assert.deepEqual(ratings(RUSSIA), { [RUSSIA]: 83, [LATVIA]: 50 });
  assert.deepEqual(ratings(LATVIA), { [RUSSIA]: 80, [LATVIA]: 47 });
  assert.deepEqual(ratings(ESTONIA), { [RUSSIA]: 80, [LATVIA]: 50 });
  assert.equal(projectForViewer(docs, ESTONIA).events[0].impacts.polityChanges[1].reputation, 61, "reputation is public");
});

test("a document's holders are told they hold it and who sent it, never who else holds it", () => {
  const docs = state();
  docs.world.reports.push(
    { id: "rep-shared", title: "Memo", body: "b", from: RUSSIA, visibleTo: [RUSSIA, LATVIA, ESTONIA] },
    { id: "rep-stolen", title: "Note", body: "b", visibleTo: [ESTONIA, "Kingdom of Sweden"], interceptedBy: [LATVIA] },
  );
  const holders = (viewer, id) => projectForViewer(docs, viewer).world.reports.find((report) => report.id === id)?.visibleTo;
  assert.deepEqual(holders(LATVIA, "rep-shared"), [RUSSIA, LATVIA], "the sender and itself");
  assert.deepEqual(holders(ESTONIA, "rep-shared"), [RUSSIA, ESTONIA]);
  assert.deepEqual(holders(RUSSIA, "rep-shared"), [RUSSIA]);
  assert.deepEqual(holders(LATVIA, "rep-stolen"), [ESTONIA], "a stolen copy is still nobody's published paper");
  assert.equal(holders(LATVIA, "rep-public"), null);
});

test("how any two governments stand is in every view; the narrator's account of it only in the parties'", () => {
  const relations = (viewer) => projectForViewer(state(), viewer).world.relations;
  const lv = relations(LATVIA);
  assert.deepEqual(lv.map((relation) => relation.id).sort(), ["rel-lv-ru", "rel-ru-est"]);
  const theirs = lv.find((relation) => relation.id === "rel-ru-est");
  assert.equal(theirs.score, -61);
  assert.equal(theirs.status, "rival");
  assert.equal("summary" in theirs, false);
  assert.equal(lv.find((relation) => relation.id === "rel-lv-ru").summary, "a relation both know");
  assert.equal(relations(RUSSIA).find((relation) => relation.id === "rel-ru-est").summary, "CANARY-RU-EST-RELATION");
});

test("the Game Master's standing reminders reach every view, so every device's AI is bound by them", () => {
  const docs = state();
  docs.world.simulationReminders = [{ id: "r1", text: "The Baltic is frozen this winter.", createdRound: 2 }];
  const whole = normalizeWorldState(docs.world).simulationReminders;
  assert.ok(Array.isArray(whole) && whole.length === 1, "the save keeps them");
  for (const viewer of [LATVIA, RUSSIA, ESTONIA]) assert.deepEqual(projectForViewer(docs, viewer).world.simulationReminders, whole);
});
