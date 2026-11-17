import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCountryStatContinuity } from "../../runtime/countryStats.js";
import {
  buildCustomStatContinuity, customStatRefreshDecision, describeFreshCustomStatEvidence,
} from "./customStatContinuity.js";
import { eventConcernsTarget } from "./statsEventEvidence.js";

// The sheet is Russia's. An event is Russia's when its structure names Russia
// (gameplay.js passes an exact identity check as isRussia).
const isRussia = (name) => String(name ?? "").trim().toLowerCase() === "russia";
const concernsTarget = (event) => eventConcernsTarget(event, isRussia);
const old = { id: "r-2026", date: "2026-01-01", title: "Russian unrest", description: "Russian political crisis.", impacts: { polityChanges: [{ code: "Russia", operation: "update" }] } };
const recovery = { id: "r-2029", date: "2029-06-15", title: "Russian recovery", description: "Russia restores regional public services.", places: [{ kind: "country", name: "Russia" }] };
const foreign = { id: "p-2029", date: "2029-06-17", title: "Polish election", description: "Poland holds an election.", impacts: { polityChanges: [{ code: "Poland", operation: "update" }] } };
const scores = { nationalStability: 52, domesticSecurity: 48, internationalReputation: 68 };
const keys = Object.keys(scores);
const state = { government: "constitutional republic", activeWars: 0 };
const evidence = (events, prior = null, otherState = state) => buildCustomStatContinuity({
  events, prior, currentState: otherState, concernsTarget,
});

test("an event is the country's by its structure, never by its words, in any language", () => {
  // Russia in the prose and nowhere else: not Russia's event.
  const prose = { id: "x-1", date: "2029-01-01", title: "Russian ballet tours Paris", description: "The Bolshoi plays to full houses.", impacts: { polityChanges: [{ code: "France", operation: "update" }] } };
  // The same event as `recovery`, written in Russian and in Chinese: Russia's alike.
  const russian = { ...recovery, id: "r-ru", title: "Восстановление в России", description: "Россия восстанавливает государственные услуги в регионах." };
  const chinese = { ...recovery, id: "r-zh", title: "俄罗斯复苏", description: "俄罗斯恢复地区公共服务。" };
  // A war Russia fights in, and an event of the player's own when Russia is the player.
  const war = { id: "w-1", date: "2029-02-01", title: "Fighting on the Dnieper", description: "Battles rage.", combatants: ["Russia", "Ukraine"] };
  const own = { id: "o-1", date: "2029-03-01", title: "Reform bill", description: "Parliament passes it.", playerRelated: true };
  assert.deepEqual(evidence([prose, recovery, russian, chinese, war, own]).evidenceIds, ["r-2029", "r-ru", "r-zh", "w-1"]);
  const asPlayer = buildCustomStatContinuity({
    events: [prose, own], currentState: state,
    concernsTarget: (event) => eventConcernsTarget(event, isRussia, { playerIsTarget: true }),
  });
  assert.deepEqual(asPlayer.evidenceIds, ["o-1"]);
});

test("old complete Russian custom sheet is sealed without replaying 2026 Kremlin crisis", () => {
  const next = evidence([old, foreign]);
  const decision = customStatRefreshDecision({
    previousValues: scores, requiredKeys: keys, prior: { assessedDate: "2029-07-02" }, current: next,
  });
  assert.deepEqual(decision, { regenerate: false, migrate: true, reason: "legacy-baseline" });
  assert.deepEqual(next.evidenceIds, ["r-2026"]);
  const sealed = { customStatFingerprint: next.fingerprint, customStatEvidenceIds: next.evidenceIds };
  assert.deepEqual(customStatRefreshDecision({
    previousValues: scores, requiredKeys: keys, prior: sealed, current: evidence([old, foreign], sealed),
  }), { regenerate: false, migrate: false, reason: "unchanged-canonical-evidence" });
});

test("elapsed game time or unrelated foreign news do not authorize new stat values", () => {
  const initial = evidence([old]);
  const prior = { customStatFingerprint: initial.fingerprint, customStatEvidenceIds: initial.evidenceIds };
  const later = evidence([old, foreign], prior);
  assert.equal(later.fingerprint, initial.fingerprint);
  assert.equal(customStatRefreshDecision({ previousValues: scores, requiredKeys: keys, prior, current: later }).regenerate, false);
});

test("genuinely new target-country developments enable either positive or negative reassessment", () => {
  const original = evidence([old]);
  const prior = { customStatFingerprint: original.fingerprint, customStatEvidenceIds: original.evidenceIds };
  const changed = evidence([old, recovery, foreign], prior);
  assert.equal(changed.newEventCount, 1);
  assert.deepEqual(changed.freshEvents.map((item) => item.id), ["r-2029"]);
  assert.equal(customStatRefreshDecision({ previousValues: scores, requiredKeys: keys, prior, current: changed }).regenerate, true);
  assert.match(describeFreshCustomStatEvidence(changed.freshEvents), /Russian recovery/);
  const stateChanged = evidence([old], prior, { ...state, government: "provisional government" });
  assert.equal(customStatRefreshDecision({ previousValues: scores, requiredKeys: keys, prior, current: stateChanged }).regenerate, true);
});

test("history consolidation cannot manufacture evidence changes or trigger recomputation", () => {
  const before = evidence([old, recovery]);
  const prior = { customStatFingerprint: before.fingerprint, customStatEvidenceIds: before.evidenceIds };
  const afterConsolidation = evidence([], prior);
  assert.equal(afterConsolidation.fingerprint, before.fingerprint);
  assert.equal(afterConsolidation.newEventCount, 0);
});

test("explicit hard audit and incomplete custom baseline can regenerate", () => {
  const next = evidence([old]);
  const prior = { customStatFingerprint: next.fingerprint, customStatEvidenceIds: next.evidenceIds };
  assert.equal(customStatRefreshDecision({
    previousValues: scores, requiredKeys: keys, prior, current: next, hardAudit: true,
  }).reason, "authorized-hard-audit");
  assert.equal(customStatRefreshDecision({
    previousValues: { nationalStability: 0 }, requiredKeys: keys, prior, current: next,
  }).reason, "incomplete-baseline");
});

test("custom evidence checkpoint survives native continuity normalization", () => {
  const next = evidence([old]);
  const normalized = normalizeCountryStatContinuity({
    assessedDate: "2029-07-02", assessedRound: 272,
    customStatFingerprint: next.fingerprint, customStatEvidenceIds: next.evidenceIds,
  });
  assert.equal(normalized.customStatFingerprint, next.fingerprint);
  assert.deepEqual(normalized.customStatEvidenceIds, ["r-2026"]);
  assert.equal(normalized.assessedDate, "2029-07-02");
});
