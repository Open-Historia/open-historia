/*! Open Historia — peace through the diplomatic chats, and the war's own figures in diplomacy: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/peaceInChat.test.js
//
// "make it so peace is offered through the diplomatic chats instead of as a
// popup, also make it so it only happens when the simulation says the country
// sends a peace treaty, it should not be fully deterministic anymore. when a
// country is at war, they should know their war stats and act accordingly in
// diplomacy" (the owner, 2026-10-30).
//
// Needs node_modules: gameState.js reaches assets.js.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeChatEntry, normalizeWorldState } from "../../runtime/gameState.js";
import { parseDiplomaticEnvelope } from "../../runtime/diplomaticEnvelope.js";
import { TERRITORY_AS_HELD, termsOfLetter } from "../../runtime/peaceTerms.js";
import { peaceOffersForThread, placePeaceOffers } from "../GameUI/peacePlacement.js";
import { GAMEPLAY_TOOLS, normalizeGameplayPayload, validateGameplayPayload } from "./gameplaySchemas.js";
import { mergeSegmentPayloads } from "./jumpSegments.js";
import { buildPeaceBlock } from "./peacePrompt.js";
import { answerPeaceProposal, offerPeace, playerDiplomacy, turnWarAndPeace } from "./warAndPeace.js";
import { PEACE_ANSWERS_FIELD, PEACE_LINE, WAR_STATS_HEADING, buildWarStatsBlock, describePeaceTalk, describeWarStats, isAtWar } from "./warStatsPrompt.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").split("\r\n").join("\n");

const WAR = { id: "war-1", title: "The Border War", status: "active", sideA: ["Aland"], sideB: ["Borduria", "Cisland"], startedDate: "1914-03-01", lastUpdatedDate: "1914-03-01" };
const world = (extra = {}) => normalizeWorldState({
  customRegions: true,
  regionOwnershipOverrides: { a1: "Aland", a2: "Aland", b1: "Borduria", b2: "Aland", b3: "Aland" },
  regionSovereigntyOverrides: { b2: "Borduria", b3: "Borduria" },
  polityOverrides: Object.fromEntries(["Aland", "Borduria", "Cisland", "Dorland"].map((name) => [name, { code: name, name, aliases: [], color: "", note: "" }])),
  wars: [WAR],
  warWeariness: [{ country: "Borduria", value: 74 }, { country: "Aland", value: 31 }],
  warResources: [{ country: "Borduria", value: 18 }],
  blockades: [{ country: "Borduria", by: ["Aland"], pressure: 0.55, covered: 0.6, days: 45, since: "1914-12-01" }],
  agreements: [{ id: "pact-1", title: "The Northern Pact", type: "mutual_defense", status: "active", parties: ["Borduria", "Dorland"] }],
  battlefields: [{
    v: 1,
    name: "The Border Front",
    warId: "war-1",
    status: "active",
    sides: [["Aland"], ["Borduria"]],
    frame: { lng0: 20, lat0: 50, cell: 0.1, cols: 30, rows: 20, km: 8 },
    brief: {
      strength: [{ n: 30, pct: 90, reserves: "ample" }, { n: 12, pct: 55, reserves: "thin", mustering: 3 }],
      sectors: [{ name: "north", moved: 6 }, { name: "south", moved: 2 }],
      cities: [["Bordograd"], []],
    },
  }],
  ...extra,
});

test("a country at war is told its own war: weariness, ground, battlefields, supplies, a blockade, allies, and what the game reckons peace worth", () => {
  const lines = describeWarStats(world(), "Borduria");
  const text = lines.join("\n");
  assert.equal(lines[0], "Borduria:");
  assert.ok(text.includes("- The Border War: against Aland, beside Cisland; it holds 0 of the enemy's regions and the enemy holds 2 of its own; weariness 74 (war-weary), Aland's 31 (uneasy)."), text);
  assert.ok(text.includes("The Border Front: its side 12 formations at 55%, reserves thin, 3 more mustering; the enemy 30 formations at 90%, reserves ample; the enemy is much the stronger there; the line has been moving against it; it lost city: Bordograd."), text);
  assert.ok(text.includes("by the game's reckoning,"), "wouldAccept's figures, as information");
  assert.ok(text.includes("- Supplies (fuel, munitions, pay): 18 of 100, short: its armies are fighting worse for it."));
  assert.ok(text.includes("- Blockaded by Aland for 45 days, at 55% pressure"));
  assert.ok(text.includes("- Borduria is defended by Dorland."));
  // The other side sees its own war the other way round.
  const aland = describeWarStats(world(), "Aland").join("\n");
  assert.ok(aland.includes("it holds 2 of the enemy's regions") && aland.includes("it is much the stronger there; the line has been moving its way; it took city: Bordograd") && aland.includes("Its fleets blockade Borduria."), aland);
  // A country at peace is told nothing.
  assert.deepEqual(describeWarStats(world(), "Dorland"), []);
  assert.equal(isAtWar(world(), "Dorland"), false);
  assert.equal(buildWarStatsBlock({ world: world(), countries: ["Dorland"] }), "");
  // Names, never ids.
  const block = buildWarStatsBlock({ world: world(), countries: ["Borduria", "Aland"] });
  assert.ok(block.startsWith(`${WAR_STATS_HEADING}\n`));
  assert.ok(block.includes("Nothing here obliges it to anything: what it does is its own decision."));
  for (const id of ["war-1", "pact-1", "b2", "a1"]) assert.equal(block.includes(id), false, id);
  // Held to its room: what does not fit is counted.
  const tight = buildWarStatsBlock({ world: world(), countries: ["Borduria", "Aland"], max: 1200 });
  assert.ok(tight.length <= 1200 && tight.endsWith("(1 more country at war not told for room.)"), tight);
});

test("the war's figures are in every prompt where a country at war speaks or decides its diplomacy", () => {
  // The time skip.
  const skip = buildPeaceBlock({ world: world(), game: { round: 9 }, players: ["Aland"] });
  assert.ok(skip.includes(`\n${WAR_STATS_HEADING}\n`) && skip.includes("Borduria:\n- The Border War:"), skip);
  // A leader's reply in a one-on-one chat.
  const main = read("main.jsx");
  const leader = main.slice(main.indexOf("export async function buildDiplomaticSystemPrompt("), main.indexOf("let advisorHistory = [];"));
  assert.ok(leader.includes("const wars = speaker ? buildWarStatsBlock({ world: worldData, countries: [speaker], heading: OWN_WARS_HEADING, max: 1800 }) : \"\";"));
  assert.ok(leader.includes("describePeaceTalk({ world: worldData, speaker, player: playerName, form: \"line\" })"));
  assert.ok(leader.includes("${wars ? `\\n\\n${wars}` : \"\"}${peaceTalk ? `\\n\\n${peaceTalk}` : \"\"}"));
  const gameplay = read("gameplay.js");
  // A group chat's turn, for every AI participant.
  const batch = gameplay.slice(gameplay.indexOf("export const runChatActionBatch = async ("), gameplay.indexOf("// Once a completed turn lands, formal ballots"));
  assert.ok(batch.includes("buildWarStatsBlock({ world: bundle.world, countries: aiParticipants, max: 2400 }),"));
  assert.ok(batch.includes("describePeaceTalk({ world: bundle.world, speaker, player, form: \"field\" })"));
  assert.ok(batch.includes("payload?.[PEACE_ANSWERS_FIELD]"));
  // The pulse between rounds: the player's enemies and those beside it.
  const idle = gameplay.slice(gameplay.indexOf("export const maybeSendIdleDiplomacy = async () => {"));
  assert.ok(idle.includes("const idleWarStats = buildWarStatsBlock({") && idle.includes("+ (idleWarStats ? `\\n\\n${idleWarStats}` : \"\")"));
  // No request was added for any of it.
  assert.equal((leader.match(/runJsonTask\(|callAI\(/g) ?? []).length, 0, "the leader's prompt asks nothing: its reply is the one request");
  assert.equal((batch.match(/runJsonTask\(|callAI\(/g) ?? []).length, 1, "a table's turn is one request, as before");
});

test("a leader at war with the player is told what is on the table, and how to say what it decides", () => {
  const put = playerDiplomacy(world(), { op: "propose", ref: "war-1", terms: { territory: TERRITORY_AS_HELD }, country: "Aland", players: ["Aland"], date: "1915-01-10", round: 8 }).world;
  const talk = describePeaceTalk({ world: put, speaker: "Borduria", player: "Aland", form: "line" });
  assert.ok(talk.includes("Aland has put these terms of peace to Borduria: each side keeps the ground it holds; nobody pays reparations. Borduria answers them now"), talk);
  assert.ok(talk.includes(`${PEACE_LINE}:accept, ${PEACE_LINE}:decline, ${PEACE_LINE}:counter <terms> or ${PEACE_LINE}:offer <terms>`));
  assert.ok(talk.includes("the decision is still its own"));
  const group = describePeaceTalk({ world: put, speaker: "Borduria", player: "Aland", form: "field" });
  assert.ok(group.includes(`in ${PEACE_ANSWERS_FIELD}, a line each: country | accept, decline, counter <terms> or offer <terms>`));
  // Nothing on the table: it may offer, and nothing obliges it.
  assert.ok(describePeaceTalk({ world: world(), speaker: "Borduria", player: "Aland" }).includes("It may offer Aland peace in this answer if it wants to, on terms of its own; nothing obliges it to."));
  // Not at war: nothing.
  assert.equal(describePeaceTalk({ world: world(), speaker: "Dorland", player: "Aland" }), "");
  // The hidden line comes off the reply, wherever it stands.
  assert.deepEqual(parseDiplomaticEnvelope("We will not sign this.\nPEACE:decline\nDIPLOMATIC_MEMORY:Borduria refused Aland's terms.\nREACTION:😠"), { reply: "We will not sign this.", reaction: "😠", memorySummary: "Borduria refused Aland's terms.", peace: "decline" });
  assert.equal(parseDiplomaticEnvelope("Good day.\nDIPLOMATIC_MEMORY:Nothing.").peace, "");
  // And what it said is carried out; a reply that says nothing of peace leaves the terms open.
  const accepted = answerPeaceProposal(put, { from: "Borduria", to: "Aland", verdict: { verdict: "accept" }, players: ["Aland"], date: "1915-01-12", round: 8 });
  assert.equal(accepted.world.wars[0].status, "ended");
  const chat = read("../GameUI/chat.jsx");
  assert.ok(chat.includes("const { reply, reaction, memorySummary, peace } = await sendDiplomaticMessage("));
  assert.ok(chat.includes("void answerPeaceInChat({ speaker: country.name, line: peace, chatId: chat.id, messageId: leaderMessage.id })"));
});

test("a skip's answer with a peace offer lands as a chat message carrying its terms, and only when the skip says so", () => {
  // The skip's answer, as a model writes it: the letter in diplomaticOutreach with its terms.
  const answer = normalizeGameplayPayload("jumpForward", {
    events: [{ date: "1915-02-01", title: "Borduria sues for peace", description: "Its cabinet, short of shells and blockaded, votes to seek terms." }],
    stopDate: "1915-02-01",
    summary: "Borduria seeks peace.",
    diplomaticOutreach: [{ title: "Terms of peace", countries: ["Borduria"], speaker: "Borduria", openingMessage: "Our people have suffered enough. We offer you peace.", peaceOffer: { territory: "as held", reparationsPayer: "Borduria", reparationsPercent: 2, reparationsYears: 5 } }],
    peaceTreaties: "",
  });
  assert.equal(validateGameplayPayload("jumpForward", answer).valid, true, validateGameplayPayload("jumpForward", answer).error);
  const merged = mergeSegmentPayloads([answer]);
  const [letter] = merged.diplomaticOutreach;
  const terms = termsOfLetter(letter.peaceOffer);
  // The letter's opening message keeps the id the offer is shown on (gameplay.js buildGeneratedChat).
  const messageId = "msg-peace-9-borduria";
  const thread = normalizeChatEntry({ id: "chat-7", countries: [{ name: "Borduria", code: "Borduria" }], title: letter.title, source: "outreach", status: "open", messages: [{ id: messageId, role: "leader", speaker: "Borduria", code: "Borduria", text: letter.openingMessage, time: "" }] });
  const sent = offerPeace(world(), { from: "Borduria", to: "Aland", terms, players: ["Aland"], date: "1915-02-01", round: 9, source: "skip", messageId });
  assert.deepEqual(sent.offer.terms, { territory: TERRITORY_AS_HELD, reparations: { payer: "Borduria", receiver: "Aland", share: 0.02, years: 5 } });
  // Shown in that chat, on that message, with its answer.
  const shown = peaceOffersForThread({ offers: sent.world.peaceOffers, player: "Aland", chatId: thread.id, messageIds: thread.messages.map((message) => message.id), counterpart: "Borduria" });
  const placed = placePeaceOffers({ offers: shown, drawnIds: [messageId] });
  assert.deepEqual(placed.byMessage.get(messageId).map((offer) => offer.id), [sent.offer.id]);
  assert.deepEqual(placed.stranded, []);
  // Not before the reveal reaches the letter; at the foot when its message is out of the window.
  assert.deepEqual([...placePeaceOffers({ offers: shown, drawnIds: [], waitingIds: [messageId] }).byMessage.keys(), ...placePeaceOffers({ offers: shown, drawnIds: [], waitingIds: [messageId] }).stranded], []);
  assert.equal(placePeaceOffers({ offers: shown, drawnIds: [] }).stranded.length, 1);
  // Not in somebody else's chat.
  assert.deepEqual(peaceOffersForThread({ offers: sent.world.peaceOffers, player: "Aland", chatId: "chat-9", messageIds: [], counterpart: "Dorland" }), []);
  // Accepting it in the chat ends the war; declining keeps it.
  const yes = playerDiplomacy(sent.world, { op: "accept", ref: sent.offer.id, country: "Aland", players: ["Aland"], date: "1915-02-02", round: 9 });
  const no = playerDiplomacy(sent.world, { op: "decline", ref: sent.offer.id, country: "Aland", players: ["Aland"], date: "1915-02-02", round: 9 });
  assert.deepEqual([yes.world.wars[0].status, no.world.wars[0].status], ["ended", "active"]);
  // The turn writes it so, and nowhere else does an offer come from.
  const gameplay = read("gameplay.js");
  assert.ok(gameplay.includes("const terms = peaceOffer && typeof peaceOffer === \"object\" ? termsOfLetter(peaceOffer) : null;"));
  assert.ok(gameplay.includes("const nextChat = await opening({ ...letter, source: \"outreach\", ...(offerMessageId ? { openingMessageId: offerMessageId } : {}) }, \"\", { revealWith: lastTurnEventId });"));
  assert.ok(gameplay.includes("treaties: readTreatyLines(result.peaceTreaties),"));
  assert.ok(gameplay.includes("peaceTreaties: merged.peaceTreaties,"));
  // Weariness 90 alone sends nothing.
  const spent = turnWarAndPeace({ world: world({ warWeariness: [{ country: "Borduria", value: 90 }] }), baseWorld: world(), days: 30, date: "1915-02-01", round: 9, players: ["Aland"] });
  assert.deepEqual(spent.peaceOffers, []);
});

test("an offer of peace no longer pops up over the map, and the skip's contract carries it safely", () => {
  const cards = fs.readFileSync(path.join(here, "../GameUI/warAndPeace.jsx"), "utf8").split("\r\n").join("\n");
  const popup = cards.slice(cards.indexOf("export const WarAndPeaceCards = () => {"), cards.indexOf("// ---- in a diplomatic chat"));
  assert.equal(popup.includes("offer"), false, "the cards over the map are calls to arms only");
  assert.ok(popup.includes("openCallsFor(calls, country)"));
  const chat = read("../GameUI/chat.jsx");
  assert.ok(chat.includes("{(peaceByMessage.get(String(msg.id ?? \"\")) ?? []).map(renderPeaceCard)}") && chat.includes("{strandedPeace.map(renderPeaceCard)}"));
  // The letter's terms and the treaties' lines ride in the skip's one answer: no array bounds (Gemini rejects them).
  const outreach = GAMEPLAY_TOOLS.jumpForward.schema.properties.diplomaticOutreach;
  assert.deepEqual(Object.keys(outreach.items.properties.peaceOffer.properties), ["territory", "reparationsPayer", "reparationsPercent", "reparationsYears"]);
  assert.equal(GAMEPLAY_TOOLS.jumpForward.schema.properties.peaceTreaties.type, "string");
  const bounded = JSON.stringify(outreach.items.properties.peaceOffer).match(/minItems|maxItems/g);
  assert.equal(bounded, null);
  // A letter of peace written into an event's chats instead is moved to the outreach, not retried.
  const misplaced = normalizeGameplayPayload("jumpForward", { events: [{ date: "1915-02-01", title: "t", description: "d", impacts: { createdChats: [{ title: "Peace", countries: ["Borduria"], speaker: "Borduria", openingMessage: "Peace?", peaceOffer: { territory: "restored" } }] } }], stopDate: "1915-02-01", summary: "s" });
  assert.equal(validateGameplayPayload("jumpForward", misplaced).valid, true);
  assert.deepEqual([misplaced.events[0].impacts.createdChats.length, misplaced.diplomaticOutreach.length], [0, 1]);
  // Treaty lines survive a segmented skip's merge.
  assert.deepEqual(mergeSegmentPayloads([{ events: [], peaceTreaties: "A | B | restored" }, { events: [], peaceTreaties: "C | D | as held" }]).peaceTreaties, ["A | B | restored", "C | D | as held"]);
});
