/*! Open Historia — treaties made in a chat: what the AI is told, and what it answers © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "add a button to diplomacy chat to propose deal where you can write out a
// deal you propose and send it and the ai request actually properly creates
// the treatie in the way the game engine works" (the owner, 2026-11-19).
//
// The player writes a proposal in their own words (GameUI/treatyCards.jsx).
// The other side's leadership answers it in the same request as its reply, and
// ends that reply with one hidden TREATY line (runtime/diplomaticEnvelope.js):
// the treaty written as the game models it, one of the world's agreement types,
// its parties by their exact names, its term, its terms and its effects
// (runtime/agreementEffects.js), and what it decides of it:
//
//   accept    the treaty as proposed, written properly: it is signed at once
//   counter   its own version: put to the player, who signs or declines it
//   refuse    it says no; the draft is kept on the card as what was proposed
//   break     it breaks one in force, named by its exact title
//
// A group chat's governments write the treaties they agree among themselves in
// the same shape (TREATIES_FIELD), and the time skip writes an agreement's
// effects in the same JSON at the end of its start line. One shape everywhere.
//
// The verdict is one of a closed set, the shape is JSON: nothing is read from
// the words of the reply or the terms.

import { AGREEMENT_TYPE_VALUES } from "./nativeDiplomaticDirector.js";
import { AGREEMENT_EFFECTS_FORMAT, normalizeAgreementEffects } from "../../runtime/agreementEffects.js";
import { dealsBetween, isGroupParty, relationBetween } from "../../runtime/groupParties.js";
import { findGroupKey, normalizeGroupAreas, normalizeGroups } from "../../runtime/groups.js";
import { relationBandForScore } from "../../runtime/diplomaticStance.js";

export const TREATY_LINE = "TREATY";
export const TREATIES_FIELD = "treatiesJson";
export const TREATY_VERDICTS = Object.freeze(["accept", "counter", "refuse", "break"]);
export const TREATY_TITLE_MOST = 120;
export const TREATY_TERMS_MOST = 1200;

const clean = (value, most = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLocaleLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const record = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const figure = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
};
const termsText = (value) => String(value ?? "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n").slice(0, TREATY_TERMS_MOST).trim();

// A treaty as a chat or a group chat wrote it, read: { verdict, type, parties, title, terms, effects },
// { verdict: "break", title } or null. The type and verdict from their closed sets as written (case aside);
// the parties as written (the caller resolves them against the world).
export const readTreaty = (value, { verdict: given = "" } = {}) => {
  let raw = value;
  if (typeof raw === "string") {
    const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const verdict = fold(given || raw.answer || raw.verdict);
  if (!TREATY_VERDICTS.includes(verdict)) return null;
  const title = clean(raw.title, TREATY_TITLE_MOST);
  if (verdict === "break") return title ? { verdict, title } : null;
  const type = fold(raw.type).replace(/[ -]+/g, "_");
  const parties = [...new Set(list(raw.parties).map((party) => clean(party, 120)).filter(Boolean))].slice(0, 12);
  if (!AGREEMENT_TYPE_VALUES.includes(type) || parties.length < 2) return verdict === "refuse" ? { verdict } : null;
  return {
    verdict,
    type,
    parties,
    title: title || type,
    terms: termsText(raw.terms),
    effects: normalizeAgreementEffects(raw.effects),
  };
};

// What a party is, in a line, for the AI writing a treaty's effects from its real means: a country's GDP,
// debt and stability where its sheet has them, a group's forces and ground.
const money = (value) => {
  const number = figure(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  if (number >= 1e12) return `$${(number / 1e12).toFixed(2)}T`;
  if (number >= 1e9) return `$${(number / 1e9).toFixed(1)}B`;
  return `$${Math.round(number / 1e6)}M`;
};
export const describePartyMeans = (world, name) => {
  const groupKey = findGroupKey(record(world?.groups), name);
  if (groupKey) {
    const groups = normalizeGroups(world?.groups);
    const military = record(groups[groupKey]?.military);
    const regions = Object.values(normalizeGroupAreas(world?.groupAreas, groups)).filter((owner) => owner === groupKey).length;
    const figures = ["spending", "technology"].filter((field) => Number.isFinite(figure(military[field]))).map((field) => `${field} ${military[field]}`);
    return `${groupKey} (group): ${regions} region${regions === 1 ? "" : "s"}${figures.length ? `, forces ${figures.join(", ")}` : ""}`;
  }
  const key = Object.keys(record(world?.countryStats)).find((entry) => fold(entry) === fold(name));
  const sheet = record(record(world?.countryStats)[key]);
  const economy = record(sheet.economy);
  const parts = [
    money(economy.gdp) ? `GDP ${money(economy.gdp)}` : "",
    Number.isFinite(figure(economy.publicDebt)) ? `public debt ${Math.round(figure(economy.publicDebt))}% of GDP` : "",
    Number.isFinite(figure(sheet.stability)) ? `stability ${Math.round(figure(sheet.stability))}` : "",
  ].filter(Boolean);
  return `${clean(name)}: ${parts.length ? parts.join(", ") : "no figures on record"}`;
};

const atWar = (world, a, b) => list(world?.wars).some((war) => ["active", "ceasefire"].includes(fold(war?.status || "active"))
  && ((list(war.sideA).some((x) => fold(x) === fold(a)) && list(war.sideB).some((x) => fold(x) === fold(b)))
    || (list(war.sideA).some((x) => fold(x) === fold(b)) && list(war.sideB).some((x) => fold(x) === fold(a)))));

// The context a treaty's effects are written from, between two: each one's means, their relation, their war.
export const describeTreatyContext = (world, a, b) => {
  const relation = relationBetween(world, a, b);
  return [
    describePartyMeans(world, a),
    describePartyMeans(world, b),
    relation ? `Relation: ${relationBandForScore(relation.score)} (${Math.round(figure(relation.score))})` : "Relation: none on record",
    atWar(world, a, b) ? "They are at war with each other." : "",
  ].filter(Boolean).join("\n");
};

// The deals in force between two, a line each, by their exact titles.
const inForceLines = (world, a, b) => dealsBetween(world, a, b).map((agreement) => `- "${clean(agreement.title)}" (${agreement.type})`);

// What a leader in a one-on-one chat is told of treaties with the player.
//   proposal   true when the player's last message is a treaty proposal (the Propose deal box)
// The short form (no proposal) only lists the treaties in force and how to break one; "" when there are none.
export const describeTreatyTalk = ({ world = {}, speaker = "", player = "", proposal = false } = {}) => {
  if (!clean(speaker) || !clean(player)) return "";
  const inForce = inForceLines(world, speaker, player);
  const breakLine = `To break one of them, end the reply with the hidden line ${TREATY_LINE}:{"answer":"break","title":"<its exact title>"}.`;
  if (!proposal) return inForce.length ? ["[Treaties]", `In force between ${speaker} and ${player}:`, ...inForce, breakLine].join("\n") : "";
  const types = AGREEMENT_TYPE_VALUES.join(", ");
  const asGroup = isGroupParty(world, speaker) || isGroupParty(world, player);
  return [
    "[Treaty Proposal]",
    `${player}'s last message is a formal treaty proposal, in its own words. ${speaker} answers it in its reply as its own interests, means and nature say: it accepts, counters with its own version, or refuses.`,
    `Then end the reply with one hidden line: ${TREATY_LINE}:{"answer":"accept|counter|refuse","type":T,"parties":[...],"title":"","terms":"","effects":{...}} — the treaty as the game models it: T one of ${types}${asGroup ? " (truce … crackdown are for a group)" : ""}; parties their exact names, the one who gives first where a type has a direction; terms what each side does and by when, written out; effects what it does. accept writes the proposal as proposed; counter writes ${speaker}'s version; refuse may leave effects empty.`,
    AGREEMENT_EFFECTS_FORMAT,
    describeTreatyContext(world, speaker, player),
    ...(inForce.length ? [`In force between them already:`, ...inForce, breakLine] : []),
    "The reply and the line must agree: the game signs, puts or drops the treaty from the line alone.",
  ].join("\n");
};

// What a group chat's governments are told of treaties among themselves (TREATIES_FIELD): only between
// the governments the AI plays, never binding a person.
export const describeTableTreaties = ({ governments = [], people = [] } = {}) => (list(governments).length < 2 ? "" : [
  "[Treaties at the Table]",
  `A treaty the governments ${list(governments).join(", ")} agree among themselves in this turn goes in ${TREATIES_FIELD}: a JSON array of {"type":T,"parties":[...],"title":"","terms":"","effects":{...}}, T one of ${AGREEMENT_TYPE_VALUES.join(", ")}. Never one binding ${list(people).join(" or ") || "a person"}: a person agrees for itself. "[]" when none.`,
  AGREEMENT_EFFECTS_FORMAT,
].join("\n"));

// A treaty read as an agreement of the world (the record applyAgreementUpdates would make), parties
// as `resolve` finds them. Null when fewer than two resolve.
export const treatyAgreement = (treaty, { id = "", date = "", round = 0, resolve = (name) => name } = {}) => {
  const parties = [...new Set(list(treaty?.parties).map((party) => clean(resolve(party), 120)).filter(Boolean))];
  if (parties.length < 2 || !treaty?.type) return null;
  const turn = Math.max(0, Math.trunc(Number(round) || 0));
  return {
    id,
    title: clean(treaty.title, TREATY_TITLE_MOST) || treaty.type,
    type: treaty.type,
    status: "active",
    parties,
    startedDate: clean(date, 40),
    lastUpdatedDate: clean(date, 40),
    terms: termsText(treaty.terms),
    ...(treaty.effects ? { effects: treaty.effects } : {}),
    createdRound: turn,
    updatedRound: turn,
  };
};
