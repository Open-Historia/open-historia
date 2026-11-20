/*! Open Historia — diplomacy with groups: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/groupDiplomacy.test.js
//
// "make it so you can have diplomacy with them like cartels and shit" (the
// owner, 2026-11-19). A group is a party to the world's relations and
// agreements by its exact name, through the same ledgers as a country; its
// deals do things in the world through the existing engines; its leadership
// talks in a chat as the group it is; and the diplomatic map draws its area by
// its standing with the focus.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeWorldState } from "../../runtime/gameState.js";
import { GROUP_DEAL_TYPES, dealsBetween, groupPartyKey, relationBetween } from "../../runtime/groupParties.js";
import { answerTreaty, proposeDeal, withTurnTreatyOffers } from "../../runtime/treatyOffers.js";
import { parseDiplomaticEnvelope } from "../../runtime/diplomaticEnvelope.js";
import { buildDiplomaticView } from "../../runtime/diplomaticViews.js";
import { describeGroupsForPrompt } from "../../runtime/groups.js";
import { applyDiplomaticUpdates, canonicalDiplomaticPolity, validateDiplomaticLedgerPayload } from "./nativeDiplomaticDirector.js";
import {
  CRACKDOWN_DAYS_PER_REGION,
  GROUP_SPENDING_BOUNDS,
  MAX_REGIONS_A_TURN,
  START_RELATION,
  declareGroupDeal,
  endGroupDeal,
  settleGroupDealStarts,
  turnGroupDeals,
} from "./groupDeals.js";
import { GROUP_DIPLOMACY_RULE, describeDealTalk, describeGroupLeaderBrief, describeGroupStanding, readDealLine } from "./groupDealTalk.js";
import { groupAreaColorExpression } from "../Map/groupAreaColors.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const CARTEL = "Cartel del Golfo";
const REBELS = "Frente Sur";
const REGIONS = [
  { id: "r1", name: "Tamaulipas", countryCode: "MEX", country: "Mexico" },
  { id: "r2", name: "Nuevo León", countryCode: "MEX", country: "Mexico" },
  { id: "r3", name: "Coahuila", countryCode: "MEX", country: "Mexico" },
  { id: "r9", name: "Texas", countryCode: "USA", country: "United States" },
];
const base = (extra = {}) => normalizeWorldState({
  polityOverrides: {
    Mexico: { name: "Mexico", aliases: [] },
    "United States": { name: "United States", aliases: [] },
  },
  regionOwnershipOverrides: { r1: "Mexico", r2: "Mexico", r3: "Mexico", r9: "United States" },
  groups: {
    [CARTEL]: { description: "A drug cartel that runs the Gulf coast's ports and highways.", color: "#e11d48", military: { spending: 50, technology: 40 } },
    [REBELS]: { description: "A rebel movement in the southern mountains.", color: "#65a30d" },
  },
  groupAreas: { r1: CARTEL, r2: CARTEL, r3: CARTEL, r9: CARTEL },
  countryStats: {
    Mexico: { economy: { gdp: 1_000_000_000_000, publicDebt: 50 } },
    "United States": { economy: { gdp: 20_000_000_000_000, publicDebt: 100 } },
  },
  ...extra,
});

// ---- a group is a party, by its name -----------------------------------------------------------

test("a group is a diplomatic party by its exact name; a country's tag never makes it one", () => {
  const world = base();
  assert.equal(groupPartyKey(world, "cartel del golfo"), CARTEL);
  assert.equal(groupPartyKey(world, `group: ${CARTEL}`), CARTEL);
  assert.equal(groupPartyKey(world, `country: ${CARTEL}`), "");
  assert.equal(groupPartyKey(world, "Mexico"), "");
  assert.equal(canonicalDiplomaticPolity(CARTEL, world), CARTEL, "the ledger resolves a group where it resolved no polity");
  assert.equal(canonicalDiplomaticPolity("Mexico", world), "Mexico");
  assert.equal(canonicalDiplomaticPolity("Nowhere Land", world), "", "an unknown name is still refused");
});

test("the world keeps a relation and a deal with a group, and an old save without one loads as it was", () => {
  const world = base({
    relations: [{ a: "Mexico", b: `group: ${CARTEL}`, score: -70 }],
    agreements: [{ id: "deal-1", title: "Plaza tax", type: "protection", parties: ["Mexico", CARTEL], status: "active", effectsApplied: true, carryDays: 40 }],
  });
  assert.equal(world.relations.length, 1);
  assert.deepEqual([world.relations[0].a, world.relations[0].b].sort(), [CARTEL, "Mexico"].sort());
  assert.equal(world.agreements[0].type, "protection");
  assert.deepEqual(world.agreements[0].parties, ["Mexico", CARTEL], "the order is kept: the first party gives");
  assert.equal(world.agreements[0].effectsApplied, true);
  assert.equal(world.agreements[0].carryDays, 40);
  const old = normalizeWorldState({ polityOverrides: { Mexico: { name: "Mexico" }, Peru: { name: "Peru" } }, relations: [{ a: "Mexico", b: "Peru", score: 10 }], agreements: [{ id: "a", type: "alliance", parties: ["Mexico", "Peru"], title: "Pact" }] });
  assert.equal(old.relations[0].score, 10);
  assert.equal(old.agreements[0].type, "alliance");
  assert.equal(old.agreements[0].effectsApplied, undefined);
});

test("a skip's relation and deal records naming a group pass the ledger and are applied", () => {
  const world = base();
  const events = [{ id: "e1", date: "2026-03-01", title: "A truce on the Gulf coast", description: "Mexico and the cartel stop shooting.", kind: "diplomacy" }];
  const candidate = {
    events,
    relationUpdates: `Mexico~${CARTEL}~-40~strained~1~A truce`,
    agreementUpdates: `gulf-truce~start~truce~Mexico,group: ${CARTEL}~1~Gulf Truce~No raids for a year`,
  };
  assert.equal(validateDiplomaticLedgerPayload(candidate, { world, authority: "skip" }), "");
  const merged = applyDiplomaticUpdates({ world, relationUpdates: candidate.relationUpdates, agreementUpdates: candidate.agreementUpdates, events, stopDate: "2026-03-31", round: 3 });
  const truce = merged.world.agreements.find((entry) => entry.id === "gulf-truce");
  assert.equal(truce.type, "truce");
  assert.deepEqual(truce.parties, ["Mexico", CARTEL]);
  assert.equal(relationBetween(merged.world, CARTEL, "Mexico").score, -40);
});

// ---- what a deal does -----------------------------------------------------------------------

test("a truce puts a war between just the two on ceasefire, and moves the relation once", () => {
  const world = base({
    wars: [{ id: "gulf-war", title: "The Gulf War on the Cartels", status: "active", sideA: ["Mexico"], sideB: [CARTEL], startDate: "2025-01-01" }],
    relations: [{ a: "Mexico", b: CARTEL, score: -80 }],
    agreements: [{ id: "t", title: "Truce", type: "truce", parties: ["Mexico", CARTEL], status: "active", startedDate: "2026-03-01" }],
  });
  const once = settleGroupDealStarts(world, { date: "2026-03-01", round: 3 });
  assert.equal(once.world.wars.find((war) => war.id === "gulf-war").status, "ceasefire");
  assert.equal(relationBetween(once.world, "Mexico", CARTEL).score, -80 + START_RELATION.truce);
  const twice = settleGroupDealStarts(once.world, { date: "2026-04-01", round: 4 });
  assert.equal(relationBetween(twice.world, "Mexico", CARTEL).score, -80 + START_RELATION.truce, "a deal's start is carried out once");
  assert.equal(twice.started.length, 0);
});

test("an amnesty ends the war, gives up the group's ground in the granting country only, and stands its forces down", () => {
  const world = base({
    wars: [{ id: "w", title: "War", status: "active", sideA: ["Mexico"], sideB: [CARTEL] }],
    agreements: [{ id: "am", title: "Amnesty", type: "amnesty", parties: ["Mexico", CARTEL], status: "active" }],
  });
  const settled = settleGroupDealStarts(world, { date: "2026-05-01", round: 5, regions: REGIONS }).world;
  assert.equal(settled.wars.find((war) => war.id === "w").status, "ended");
  assert.deepEqual(Object.keys(settled.groupAreas), ["r9"], "Texas is the United States' land, not Mexico's");
  assert.ok(settled.groups[CARTEL].military.spending < 50);
});

test("a crackdown ends the cooperative deals between the two, and a hostage exchange is over when made", () => {
  const world = base({
    agreements: [
      { id: "p", title: "Plaza", type: "protection", parties: ["Mexico", CARTEL], status: "active", effectsApplied: true },
      { id: "h", title: "Swap", type: "hostage_exchange", parties: ["Mexico", CARTEL], status: "active" },
    ],
  });
  const declared = declareGroupDeal(world, { by: "Mexico", against: CARTEL, type: "crackdown", title: "Operation Lighthouse", date: "2026-06-01", round: 6, regions: REGIONS });
  assert.equal(declared.reason, "");
  const status = (id) => declared.world.agreements.find((entry) => entry.id === id)?.status;
  assert.equal(status("p"), "ended");
  assert.equal(status("h"), "ended");
  assert.equal(dealsBetween(declared.world, "Mexico", CARTEL).map((entry) => entry.type).join(), "crackdown");
  assert.equal(declareGroupDeal(declared.world, { by: "Mexico", against: CARTEL, type: "crackdown" }).reason, "open", "one crackdown at a time");
  assert.equal(declareGroupDeal(world, { by: "Mexico", against: CARTEL, type: "truce" }).reason, "type", "only a crackdown is declared alone");
});

test("every turn a crackdown costs its government, weakens the group and takes back its ground region by region, within bounds", () => {
  const start = declareGroupDeal(base(), { by: "Mexico", against: CARTEL, type: "crackdown", title: "Lighthouse", date: "2026-01-01", round: 1, regions: REGIONS }).world;
  const short = turnGroupDeals({ world: start, days: 60, date: "2026-03-01", round: 2, regions: REGIONS }).world;
  assert.equal(Object.keys(short.groupAreas).length, 4, "60 days take no region yet");
  assert.equal(short.agreements.find((entry) => entry.type === "crackdown").carryDays, 60);
  const later = turnGroupDeals({ world: short, days: 60, date: "2026-05-01", round: 3, regions: REGIONS }).world;
  assert.equal(Object.keys(later.groupAreas).length, 3, "120 days carried take one");
  assert.equal(later.agreements.find((entry) => entry.type === "crackdown").carryDays, 120 - CRACKDOWN_DAYS_PER_REGION);
  assert.ok(later.countryStats.Mexico.economy.publicDebt > 50, "it costs the government");
  assert.ok(later.groups[CARTEL].military.spending < 50, "it weakens the group");
  const decade = turnGroupDeals({ world: later, days: 3650, date: "2036-05-01", round: 4, regions: REGIONS }).world;
  assert.ok(Object.keys(decade.groupAreas).includes("r9"), "never the ground in another country's land");
  assert.ok(Object.keys(decade.groupAreas).length >= 4 - 1 - MAX_REGIONS_A_TURN);
  assert.ok(decade.groups[CARTEL].military.spending >= GROUP_SPENDING_BOUNDS[0]);
});

test("protection and sponsorship are paid from a country's sheet and make the group stronger; no request is made", () => {
  const world = base({
    agreements: [
      { id: "p", title: "Plaza", type: "protection", parties: ["Mexico", CARTEL], status: "active", effectsApplied: true },
      { id: "s", title: "Arms", type: "sponsorship", parties: ["United States", REBELS], status: "active", effectsApplied: true },
    ],
  });
  const next = turnGroupDeals({ world, days: 365, date: "2027-01-01", round: 9 }).world;
  assert.ok(Math.abs(next.countryStats.Mexico.economy.publicDebt - 50.3) < 0.01, "0.3% of GDP a year");
  assert.ok(next.groups[CARTEL].military.spending > 50);
  assert.ok(next.countryStats["United States"].economy.publicDebt > 100);
  assert.ok(next.groups[REBELS].military.spending > 50 && next.groups[REBELS].military.technology > 50);
  const source = read("./groupDeals.js");
  assert.doesNotMatch(source, /callAI|runJsonTask|fetch\(/, "a deal's effects are the engine's, never a request");
});

test("ending a deal short of its term is remembered by the other side; ending a crackdown is not", () => {
  const world = base({ agreements: [{ id: "p", title: "Plaza", type: "protection", parties: ["Mexico", CARTEL], status: "active", effectsApplied: true }] });
  const ended = endGroupDeal(world, { id: "p", by: "Mexico", date: "2026-02-01", round: 2 });
  assert.equal(ended.agreement.status, "ended");
  assert.ok(relationBetween(ended.world, "Mexico", CARTEL).score < 0);
  assert.equal(endGroupDeal(world, { id: "p", by: "Peru" }).reason, "not-yours");
});

// ---- deals put in a chat ----------------------------------------------------------------------

test("a deal put to a group is signed with the giver first, and is made during a war", () => {
  const world = base({ wars: [{ id: "w", status: "active", sideA: ["Mexico"], sideB: [CARTEL] }] });
  const put = proposeDeal(world, { from: "Mexico", to: CARTEL, type: "protection", giver: "to", title: "They pay us", date: "2026-01-01", round: 1, withLeader: true, chatId: "chat-1" });
  assert.equal(put.reason, "");
  assert.equal(put.offer.giverIsTo, true);
  assert.equal(put.offer.withLeader, true);
  assert.equal(proposeDeal(put.world, { from: "Mexico", to: CARTEL, type: "truce" }).reason, "open");
  assert.equal(proposeDeal(world, { from: "Mexico", to: CARTEL, type: "crackdown" }).reason, "type", "a crackdown is declared, not put");
  const kept = withTurnTreatyOffers(put.world.treatyOffers, { wars: world.wars, round: 2 });
  assert.equal(kept[0].status, "open", "a deal with a group does not lapse for the war");
  const signed = answerTreaty(put.world, { op: "sign", ref: put.offer.id, country: CARTEL, date: "2026-01-02", round: 1 });
  assert.equal(signed.error, "");
  assert.deepEqual(signed.agreement.parties, [CARTEL, "Mexico"], "the cartel pays");
});

test("a group's leadership says what it decides on a hidden DEAL line from a closed set", () => {
  assert.deepEqual(readDealLine("sign"), { verdict: "sign" });
  assert.deepEqual(readDealLine("Decline"), { verdict: "decline" });
  assert.deepEqual(readDealLine("end protection"), { verdict: "end", type: "protection" });
  assert.deepEqual(readDealLine("offer protection | you | La cuota | 5% of the port's take"), { verdict: "offer", type: "protection", giver: "you", title: "La cuota", terms: "5% of the port's take" });
  assert.equal(readDealLine("accept"), null, "no synonym of the closed set is read");
  assert.equal(readDealLine("offer crackdown|us|x"), null);
  assert.equal(readDealLine("aceptar"), null);
  const envelope = parseDiplomaticEnvelope("Bueno, gringo. Trato hecho.\nDEAL:sign\nDIPLOMATIC_MEMORY:The cartel took the truce.\nREACTION:🤝");
  assert.equal(envelope.deal, "sign");
  assert.equal(envelope.reply, "Bueno, gringo. Trato hecho.");
  assert.equal(parseDiplomaticEnvelope("DEAL:decline").deal, "decline", "a reply of the line alone is an answer");
});

test("a group's leadership is told it is a group, in its own voice, by names only", () => {
  const world = base({ relations: [{ a: "Mexico", b: CARTEL, score: -70 }] });
  const brief = describeGroupLeaderBrief({ world, speaker: CARTEL, player: "Mexico", regionName: (id) => REGIONS.find((region) => region.id === id)?.name ?? "" });
  assert.match(brief, /^\[You Speak for a Group, Not a Government\]/);
  assert.match(brief, /A drug cartel that runs the Gulf coast's ports/);
  assert.match(brief, /It controls 4 regions: Tamaulipas, Nuevo León, Coahuila, Texas\./);
  assert.match(brief, /relation with Mexico: hostile \(-70/);
  assert.doesNotMatch(brief, /\br[0-9]\b/, "never a region's id");
  assert.equal(describeGroupLeaderBrief({ world, speaker: "United States", player: "Mexico" }), "", "a country is told nothing of it");
  const put = proposeDeal(world, { from: "Mexico", to: CARTEL, type: "truce", title: "Gulf truce", withLeader: true }).offer;
  const talk = describeDealTalk({ world, speaker: CARTEL, player: "Mexico", openOffer: put });
  assert.match(talk, /Mexico has put a deal to Cartel del Golfo: truce, "Gulf truce"/);
  assert.match(talk, /DEAL:sign or DEAL:decline/);
  assert.doesNotMatch(talk, /crackdown,/, "a crackdown is not offered in a chat");
});

// ---- what the time skip is told ---------------------------------------------------------------

test("the skip's [Groups] block carries each group's relations and deals compactly, and the rule is short", () => {
  const world = base({
    relations: [{ a: "Mexico", b: CARTEL, score: -70 }],
    agreements: [{ id: "t", title: "Gulf truce", type: "truce", parties: ["Mexico", CARTEL], status: "active" }],
  });
  const standing = describeGroupStanding(world, CARTEL);
  assert.equal(standing, 'relations: Mexico hostile -70; deals: truce (Mexico / Cartel del Golfo) "Gulf truce"');
  const block = describeGroupsForPrompt(world, { regionName: (id) => REGIONS.find((region) => region.id === id)?.name ?? "", standingOf: (name) => describeGroupStanding(world, name) });
  assert.match(block, /\{relations: Mexico hostile -70; deals: truce/);
  assert.equal(describeGroupStanding(world, REBELS), "");
  assert.ok(GROUP_DIPLOMACY_RULE.length < 800, `the rule is ${GROUP_DIPLOMACY_RULE.length} characters`);
  for (const type of GROUP_DEAL_TYPES) assert.ok(GROUP_DIPLOMACY_RULE.includes(type), type);
  const gameplay = read("./gameplay.js");
  assert.match(gameplay, /const GROUPS_RULE_WITH_DIPLOMACY = `\$\{GROUPS_RULE\} \$\{GROUP_DIPLOMACY_RULE\}`;/);
  assert.match(gameplay, /worldWithImpacts = dealt\.world;/, "the turn carries the deals out after war and peace");
  assert.match(gameplay, /A group writes to the player, and is written to, by its exact name/, "a group may reach out to the player");
});

// ---- the diplomatic map -----------------------------------------------------------------------

test("the Relations view draws each group by its standing with the focus, and counts them apart", () => {
  const world = base({
    relations: [{ a: "Mexico", b: REBELS, score: 30 }],
    agreements: [{ id: "c", title: "Lighthouse", type: "crackdown", parties: ["Mexico", CARTEL], status: "active" }],
  });
  const view = buildDiplomaticView({ view: "relations", playerCountry: "Mexico", world, landedOwners: ["Mexico", "United States"] });
  const byName = Object.fromEntries(view.groups.map((group) => [group.name, group.category]));
  assert.deepEqual(byName, { [CARTEL]: "crackdown", [REBELS]: "cordial" });
  assert.deepEqual(view.groupEntries.map((entry) => [entry.id, entry.count]), [["crackdown", 1], ["cordial", 1]]);
  assert.ok(!view.legend.entries.some((entry) => entry.id === "crackdown"), "the countries' legend counts countries only");
  const expression = groupAreaColorExpression(Object.fromEntries(view.groups.map((group) => [group.name, group.color])));
  assert.equal(expression[0], "match");
  assert.deepEqual(groupAreaColorExpression(null), ["get", "color"], "the political map keeps each group's own colour");
});

test("the deal UI is themed, has no gradient or purple, and talks to groups only in single player", () => {
  const ui = read("../GameUI/groupDeals.jsx");
  assert.match(ui, /--oh-ui-accent/);
  assert.doesNotMatch(ui, /gradient/i);
  const chat = read("../GameUI/chat.jsx");
  assert.match(chat, /const dealGroup = peaceCounterpart && groupsOnHere && !inSharedGame\(\) \? groupPartyKey\(world, peaceCounterpart\.name\) : "";/);
  assert.match(chat, /void answerDealInChat\(\{ speaker: country\.name, line: deal, chatId: chat\.id \}\)/);
  assert.match(chat, /groups=\{pickableGroups\}/, "the new-conversation picker lists the groups");
  assert.match(read("../Selection/Regions.jsx"), /Talk to their leadership/);
});
