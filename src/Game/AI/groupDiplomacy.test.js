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
import { answerTreaty, recordDraftedTreaty, withTurnTreatyOffers } from "../../runtime/treatyOffers.js";
import { AGREEMENT_EFFECTS_FORMAT, AGREEMENT_EFFECTS_SCHEMA, EFFECT_CAPS, normalizeAgreementEffects } from "../../runtime/agreementEffects.js";
import { parseDiplomaticEnvelope } from "../../runtime/diplomaticEnvelope.js";
import { buildDiplomaticView } from "../../runtime/diplomaticViews.js";
import { describeGroupsForPrompt } from "../../runtime/groups.js";
import { applyDiplomaticUpdates, canonicalDiplomaticPolity, validateDiplomaticLedgerPayload } from "./nativeDiplomaticDirector.js";
import { breakAgreement, settleAgreementStarts, turnAgreements } from "./agreementEngine.js";
import { GROUP_DIPLOMACY_RULE, describeGroupLeaderBrief, describeGroupStanding } from "./groupDealTalk.js";
import { describeTableTreaties, describeTreatyTalk, readTreaty, treatyAgreement } from "./treatyTalk.js";
import { GAME_MASTER_SCHEMA } from "./gameplaySchemas.js";
import { groupAreaColorExpression } from "../Map/groupAreaColors.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

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

// ---- what an agreement does: only what the AI wrote ---------------------------------------------

const TRUCE_EFFECTS = {
  months: 12,
  onSign: [{ type: "war", op: "ceasefire" }, { type: "relation", party: "Mexico", with: CARTEL, change: 12 }],
  // A year's amounts: $600M and 6 points a year, a twelfth of each a month.
  perYear: [{ type: "payment", from: "Mexico", to: CARTEL, amount: 600_000_000 }, { type: "strength", party: CARTEL, figure: "spending", change: 6 }],
  onEnd: [{ type: "relation", party: "Mexico", with: CARTEL, change: -3 }],
  onBreak: [{ type: "relation", party: "breaker", with: CARTEL, change: -20 }, { type: "reputation", party: "breaker", change: -4 }],
};

test("effects are kept as written, held to generous caps, and an agreement without them does nothing", () => {
  const held = normalizeAgreementEffects({
    months: 9999,
    onSign: [{ type: "relation", party: "A", with: "B", change: 80 }, { type: "stat", party: "A", stat: "Stability", change: 40 }, { type: "nonsense" }],
    perYear: [{ type: "strength", party: "C", figure: "spending", change: 30 }, { type: "war", op: "end" }, { type: "area", group: "C", op: "take", region: "X" }],
  });
  assert.equal(held.months, 600);
  assert.deepEqual(held.onSign, [{ type: "relation", party: "A", with: "B", change: EFFECT_CAPS.relation.once }, { type: "stat", party: "A", stat: "stability", change: 8 }]);
  assert.deepEqual(held.perYear, [{ type: "strength", party: "C", figure: "spending", change: EFFECT_CAPS.strength.year }], "a war or the ground moves once, never a year at a time");
  // An agreement saved with the former `monthly` list (one month's amounts) reads as the year it makes.
  assert.deepEqual(normalizeAgreementEffects({ monthly: [{ type: "payment", from: "A", to: "B", amount: 250_000_000 }] }), { perYear: [{ type: "payment", from: "A", to: "B", amount: 3_000_000_000 }] });
  assert.equal(normalizeAgreementEffects({}), null);
  const world = base({ relations: [{ a: "Mexico", b: CARTEL, score: -50 }], agreements: [{ id: "old", title: "Old pact", type: "truce", parties: ["Mexico", CARTEL], status: "active" }] });
  const after = turnAgreements({ world, days: 400, date: "2027-02-01", round: 4 }).world;
  assert.equal(relationBetween(after, "Mexico", CARTEL).score, -50, "an old save's agreement is neutral");
  assert.equal(after.countryStats.Mexico.economy.publicDebt, 50);
});

test("an agreement's making, months, term and end are carried out exactly as written, once", () => {
  const world = base({
    wars: [{ id: "gulf-war", title: "The Gulf War", status: "active", sideA: ["Mexico"], sideB: [CARTEL] }],
    relations: [{ a: "Mexico", b: CARTEL, score: -80 }],
    agreements: [{ id: "t", title: "Gulf truce", type: "truce", parties: ["Mexico", CARTEL], status: "active", effects: TRUCE_EFFECTS }],
  });
  const made = settleAgreementStarts(world, { date: "2026-03-01", round: 3 }).world;
  assert.equal(made.wars[0].status, "ceasefire");
  assert.equal(relationBetween(made, "Mexico", CARTEL).score, -68);
  assert.equal(relationBetween(settleAgreementStarts(made, { date: "2026-04-01" }).world, "Mexico", CARTEL).score, -68, "made once");
  const turn = turnAgreements({ world: made, days: 75, date: "2026-05-15", round: 4 }).world;
  const truce = turn.agreements.find((entry) => entry.id === "t");
  assert.equal(truce.monthsRun, 2);
  assert.equal(truce.carryDays, 15);
  // Two months of $50M from a $1T economy: 0.01 points of debt.
  assert.ok(Math.abs(turn.countryStats.Mexico.economy.publicDebt - 50.01) < 1e-6);
  assert.equal(turn.groups[CARTEL].military.spending, 51, "half a point a month: one whole point in two months");
  const done = turnAgreements({ world: turn, days: 3650, date: "2036-05-15", round: 5 }).world;
  const over = done.agreements.find((entry) => entry.id === "t");
  assert.deepEqual([over.status, over.monthsRun, over.endApplied], ["expired", 12, true], "it runs its term and no further");
  assert.equal(relationBetween(done, "Mexico", CARTEL).score, -71, "its onEnd, once");
});

test("a sum a year is paid a twelfth each month", () => {
  const world = settleAgreementStarts(base({ agreements: [{ id: "pact", title: "Border pact", type: "trade_economic", parties: ["United States", "Mexico"], status: "active",
    effects: { months: 60, perYear: [{ type: "payment", from: "United States", to: "Mexico", amount: 3_000_000_000 }, { type: "relation", party: "United States", with: "Mexico", change: 6 }] } }] }), { date: "2026-01-01" }).world;
  const month = turnAgreements({ world, days: 30, date: "2026-01-31", round: 2 }).world;
  // $250M of a $20T economy is 0.00125 points of its debt; of Mexico's $1T, 0.025 points off.
  assert.ok(Math.abs(month.countryStats["United States"].economy.publicDebt - 100.00125) < 1e-4, String(month.countryStats["United States"].economy.publicDebt));
  assert.ok(Math.abs(month.countryStats.Mexico.economy.publicDebt - 49.975) < 1e-4);
  const year = turnAgreements({ world: month, days: 330, date: "2026-12-31", round: 3 }).world;
  assert.ok(Math.abs(year.countryStats.Mexico.economy.publicDebt - 49.7) < 1e-3, "a year of it is the year's sum");
  assert.equal(relationBetween(year, "United States", "Mexico").score, 6, "half a point a month, a whole point every second month");
});

test("breaking an agreement carries out its breach, with the breaker named", () => {
  const world = settleAgreementStarts(base({
    relations: [{ a: "Mexico", b: CARTEL, score: 0 }],
    agreements: [{ id: "t", title: "Gulf truce", type: "truce", parties: ["Mexico", CARTEL], status: "active", effects: TRUCE_EFFECTS }],
  }), { date: "2026-03-01" }).world;
  const broken = breakAgreement(world, { id: "t", by: "Mexico", date: "2026-04-01", round: 2 });
  assert.equal(broken.agreement.brokenBy, "Mexico");
  assert.equal(relationBetween(broken.world, "Mexico", CARTEL).score, 12 - 20);
  assert.equal(breakAgreement(world, { id: "t", by: "Peru" }).reason, "not-yours");
});

test("a payment is held to a share of the payer's GDP, and a group's area moves by the region's name", () => {
  const world = base({ agreements: [{ id: "a", title: "Amnesty", type: "amnesty", parties: ["Mexico", CARTEL], status: "active", effects: {
    onSign: [{ type: "payment", from: "Mexico", to: CARTEL, amount: 9e14 }, { type: "area", group: CARTEL, op: "release", region: "Tamaulipas" }],
  } }] });
  const made = settleAgreementStarts(world, { date: "2026-01-01", regions: REGIONS }).world;
  assert.ok(Math.abs(made.countryStats.Mexico.economy.publicDebt - (50 + EFFECT_CAPS.payment.once * 100)) < 1e-6);
  assert.equal(made.groupAreas.r1, undefined);
  assert.equal(made.groupAreas.r2, CARTEL);
});

test("no number of a deal is the engine's own", () => {
  const engine = read("./agreementEngine.js");
  assert.doesNotMatch(engine, /callAI|runJsonTask|fetch\(/, "no request");
  for (const gone of ["START_RELATION", "PROTECTION_SHARE", "CRACKDOWN_DAYS_PER_REGION", "AMNESTY_STAND_DOWN"]) assert.doesNotMatch(engine, new RegExp(gone));
  const peace = read("./warAndPeace.js");
  assert.match(peace, /onBreak/, "a broken alliance costs what its own breach says");
});

// ---- treaties made in a chat -----------------------------------------------------------------------

test("a proposal is answered on a hidden TREATY line in the shape every treaty has", () => {
  const line = JSON.stringify({ answer: "counter", type: "military_access", parties: ["Syria", "Russia"], title: "Tartus lease", terms: "Russia uses Tartus.", effects: { months: 120, perYear: [{ type: "payment", from: "Russia", to: "Syria", amount: 2_000_000_000 }] } });
  const envelope = parseDiplomaticEnvelope(`Ten years, not five.\nTREATY:${line}\nDIPLOMATIC_MEMORY:Syria countered.`);
  assert.equal(envelope.reply, "Ten years, not five.");
  const treaty = readTreaty(envelope.treaty);
  assert.deepEqual([treaty.verdict, treaty.type, treaty.parties, treaty.effects.months], ["counter", "military_access", ["Syria", "Russia"], 120]);
  assert.equal(readTreaty('{"answer":"maybe","type":"truce","parties":["A","B"]}'), null, "only the closed set of answers");
  assert.deepEqual(readTreaty('{"answer":"break","title":"Gulf truce"}'), { verdict: "break", title: "Gulf truce" });
  const put = recordDraftedTreaty({}, { from: "Syria", to: "Russia", status: "open", treaty, proposal: "We pay 2bn a year for Tartus", chatId: "c" });
  const signed = answerTreaty(put.world, { op: "sign", ref: put.offer.id, country: "Russia", date: "2026-01-01" });
  assert.deepEqual([signed.error, signed.agreement.parties, signed.agreement.effects.months], ["", ["Syria", "Russia"], 120]);
  assert.equal(withTurnTreatyOffers(put.world.treatyOffers, { wars: [{ status: "active", sideA: ["Syria"], sideB: ["Russia"] }], round: 1 })[0].status, "open", "a drafted treaty may be made in a war");
  const agreement = treatyAgreement(treaty, { id: "x", date: "2026-01-01" });
  assert.equal(agreement.effects.perYear[0].amount, 2_000_000_000);
});

test("the leader is told the context its effects are written from, compactly, and a group as a group", () => {
  const world = base({ relations: [{ a: "Mexico", b: CARTEL, score: -70 }], agreements: [{ id: "t", title: "Gulf truce", type: "truce", parties: ["Mexico", CARTEL], status: "active" }] });
  const talk = describeTreatyTalk({ world, speaker: CARTEL, player: "Mexico", proposal: true });
  assert.match(talk, /^\[Treaty Proposal\]/);
  assert.match(talk, /Mexico: GDP \$1\.00T, public debt 50% of GDP/);
  assert.match(talk, /Cartel del Golfo \(group\): 4 regions, forces spending 50, technology 40/);
  assert.match(talk, /Relation: hostile \(-70\)/);
  assert.ok(talk.includes(AGREEMENT_EFFECTS_FORMAT));
  assert.doesNotMatch(talk, /\br[0-9]\b/, "never a region's id");
  const quiet = describeTreatyTalk({ world, speaker: CARTEL, player: "Mexico" });
  assert.match(quiet, /"Gulf truce" \(truce\)/);
  assert.ok(quiet.length < 400, `${quiet.length} characters without a proposal`);
  assert.equal(describeTreatyTalk({ world: base(), speaker: CARTEL, player: "Mexico" }), "", "nothing to tell, nothing told");
  assert.equal(describeTableTreaties({ governments: ["Mexico"] }), "", "a table needs two governments the AI plays");
  const brief = describeGroupLeaderBrief({ world, speaker: CARTEL, player: "Mexico", regionName: (id) => REGIONS.find((region) => region.id === id)?.name ?? "" });
  assert.match(brief, /^\[You Speak for a Group, Not a Government\]/);
});

test("the Game Master writes group deals and effects in the same shape", () => {
  const item = GAME_MASTER_SCHEMA.properties.agreementUpdates.items;
  for (const type of GROUP_DEAL_TYPES) assert.ok(item.properties.type.enum.includes(type), type);
  assert.ok(item.properties.op.enum.includes("break"));
  assert.equal(item.properties.effects, AGREEMENT_EFFECTS_SCHEMA);
  assert.ok(!item.required.includes("effects"), "an agreement written with none is still one");
});

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

test("Propose deal is a parchment beside the message box in every one-on-one chat, themed, without gradients", () => {
  const ui = read("../GameUI/treatyCards.jsx");
  assert.match(ui, /aria-label="Propose deal"/);
  assert.match(ui, /title="Propose deal"/);
  assert.match(ui, /--oh-ui-accent/);
  assert.match(ui, /height: "2\.75rem"/, "touch-sized");
  assert.doesNotMatch(ui, /gradient/i);
  const chat = read("../GameUI/chat.jsx");
  assert.match(chat, /const treatyCounterpart = peaceCounterpart && !peaceWithPerson && !inSharedGame\(\)/);
  assert.match(chat, /<ProposeDealButton[^\n]*\/>\}\n\s*<textarea\n\s*ref=\{composerRef\}/, "left of the text box");
  assert.match(chat, /answerTreatyInChat\(\{ speaker: country\.name, line: treaty/);
  assert.match(chat, /groups=\{pickableGroups\}/);
  assert.match(read("../GameUI/stats.jsx"), /<EffectList compact effects=\{agreement\.effects\} \/>/, "the dossier shows each agreement's effects");
  assert.match(read("../Selection/Regions.jsx"), /Talk to their leadership/);
});
