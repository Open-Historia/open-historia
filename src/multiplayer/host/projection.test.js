/*! Open Historia — what one player may see of the host's game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/projection.test.js
//
// Canaries: a unique string planted in every private place of one player's
// state must appear nowhere in any other player's view, byte for byte, because
// the view is exactly what crosses the network. And each player must still see
// all of its own.

import test from "node:test";
import assert from "node:assert/strict";

import { WORLD_DEFAULTS, normalizeWorldState } from "../../runtime/gameState.js";
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
    projects: [
      { id: "proj-ru", name: "CANARY-RU-PROJECT", kind: "operation", ownerCode: RUSSIA, summary: "x", status: "active" },
      { id: "proj-lv", name: "CANARY-LV-PROJECT", kind: "operation", ownerCode: "", summary: "x", status: "active" },
    ],
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
      [RUSSIA]: { capital: "Moscow", stability: 60, customStats: { secretMissiles: 4242 }, indices: { intelligenceService: 97, sovereignty: 80 } },
      [LATVIA]: { capital: "Riga", stability: 70, customStats: { reserves: 5151 }, indices: { intelligenceService: 41, sovereignty: 60 } },
    },
    countryStatsHistory: { [RUSSIA]: [{ date: "2014-01-01", stability: 58, note: "CANARY-RU-HISTORY" }] },
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
    simulationHistory: [{ round: 3, rawResponse: "CANARY-RAW-RESPONSE" }],
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
        createdChats: [{ countries: [ESTONIA], openingMessage: "CANARY-LV-OPENING" }],
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
    "CANARY-RU-DESTINATION", "CANARY-RU-PROJECT", "CANARY-RU-REPORT", "CANARY-RU-EST-RELATION",
    "CANARY-RU-HISTORY", "CANARY-RU-GOAL", "CANARY-RU-STRATEGY", "CANARY-RU-TO-EST", "CANARY-RU-ORDER",
    "order-ru-1", "order-ru-march", "CANARY-MOVE-NOTE", "CANARY-ACTOROP", "CANARY-LEADER-MEMORY",
    "secretMissiles", "spy-ru-in-est", "pup-covert",
  ]) assert.equal(view.includes(canary), false, `${canary} leaked to the host's view`);
  // Numbers are checked where they live: a bare "97" can turn up in any timestamp.
  const sheet = projectForViewer(state(), LATVIA).world.countryStats[RUSSIA];
  assert.equal(sheet.customStats, undefined);
  assert.equal(sheet.indices.intelligenceService, undefined);
  assert.equal(sheet.indices.sovereignty, 80);
});

test("nothing private of the host reaches the second player's view", () => {
  const view = text(projectForViewer(state(), RUSSIA));
  for (const canary of [
    "CANARY-LV-PATROL", "CANARY-LV-PROJECT", "CANARY-LV-TO-EST", "CANARY-LV-ORDER", "order-lv-1", "order-lv-patrol",
    SEAL, "CANARY-LV-SCENE", "CANARY-LV-INTERCEPT", "CANARY-LV-OPENING",
    "CANARY-BALTIC-PROPOSAL", "Riga's goal", "reserves",
  ]) assert.equal(view.includes(canary), false, `${canary} leaked to the second player's view`);
});

test("the narrator's own never reaches any view, the host's included", () => {
  for (const seat of [LATVIA, RUSSIA, ESTONIA]) {
    const view = text(projectForViewer(state(), seat));
    for (const canary of [
      "CANARY-STORYLINE", "story-1", "CANARY-JUMP-SUMMARY", "CANARY-RAW-RESPONSE", "CANARY-GM-AUDIT", "CANARY-GM-NOTES",
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
  assert.deepEqual(ru.world.projects.map((project) => project.id), ["proj-ru"]);
  assert.deepEqual(ru.world.intelligence, { [RUSSIA]: 88 });
  assert.deepEqual(ru.world.playerGoals, { [RUSSIA]: { text: "CANARY-RU-GOAL" } });
  assert.equal(ru.world.countryStats[RUSSIA].customStats.secretMissiles, 4242);
  assert.equal(ru.world.politicalActors.byPolity[RUSSIA].strategy.summary, "CANARY-RU-STRATEGY");
  assert.equal(ru.world.puppets[0].loyalty, 37, "the overlord knows its puppet's loyalty");
  assert.deepEqual(ru.world.reports.map((report) => report.id).sort(), ["rep-lv", "rep-public", "rep-ru"]);
  assert.deepEqual(ru.events[0].impacts.actionIds, ["order-ru-1"]);
  assert.equal(ru.events[0].impacts.unitOps.length, 1, "its own march order");
  assert.equal(ru.events[0].playerRelated, true);

  const lv = projectForViewer(state(), LATVIA);
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
    messages: [],
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
  assert.deepEqual(lv.events.map((event) => event.id), ["c0", "c1", "c3", "c4", "c5", "c6"]);
  const line = (thread, eventId) => thread.events.find((event) => event.id === eventId);
  assert.deepEqual([line(lv, "c4").role, line(lv, "c4").by], ["leader", RUSSIA]);
  assert.equal(line(lv, "c6").role, "user", "Latvia's own words");
  assert.equal(JSON.stringify(lv).includes("CANARY-LOG-MEMORY"), false);
  assert.equal(JSON.stringify(lv).includes("CANARY-BEFORE-LATVIA"), false);

  const ru = projectForViewer(docs, RUSSIA).chat[0];
  assert.equal(ru.events.length, 7, "the owner reads its whole thread");
  assert.equal(line(ru, "c4").role, "user");
  assert.deepEqual([line(ru, "c6").role, line(ru, "c6").by], ["leader", LATVIA]);
  assert.equal(JSON.stringify(ru).includes("CANARY-LOG-MEMORY"), false);
});
