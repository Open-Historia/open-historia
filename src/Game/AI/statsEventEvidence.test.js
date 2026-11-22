/*! Open Historia — the events a country's Stats are shown: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/statsEventEvidence.test.js
//
// A country's Stats read the events that are about it, by their structure and
// their tags. They were chosen by English economic and demographic words and by
// the country's name found in the prose by prefixes: a game in another language
// gave its Stats no evidence at all, and in English "Nigeria" was "Niger".

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { STATS_DEMOGRAPHIC_TAGS, STATS_ECONOMIC_TAGS, eventConcernsTarget, eventHasAnyTag, eventPolityNames } from "./statsEventEvidence.js";
import { prepareCountryStatsKernel } from "./countryStatsWorkerKernel.js";

const isGermany = (name) => String(name ?? "").trim().toLowerCase() === "germany";

test("the polities an event names are those in its structure", () => {
  const event = {
    combatants: ["Germany", "France"],
    places: [{ kind: "country", name: "Belgium" }, { kind: "city", name: "Liège" }],
    impacts: {
      polityChanges: [{ code: "Austria", operation: "update" }],
      regionTransfers: [{ fromCode: "Denmark", toCode: "Prussia" }],
      regionControlOps: [{ op: "control", fromCode: "Poland", toCode: "Russia", actorCode: "Russia" }],
      unitOps: [{ op: "spawn", unit: { ownerCode: "Italy" } }],
      markerOps: [{ op: "build", marker: { ownerCode: "Spain" } }],
      createdChats: [{ countries: ["Sweden"] }],
      politicalActorOps: [{ op: "set-government", polityKey: "Norway" }],
    },
  };
  assert.deepEqual(new Set(eventPolityNames(event)), new Set([
    "Austria", "Denmark", "Prussia", "Poland", "Russia", "Norway", "Italy", "Spain", "Sweden", "Germany", "France", "Belgium",
  ]));
});

test("an event is a country's by its structure, never by its words", () => {
  const prose = { title: "Germany raises tariffs", description: "Berlin acts.", impacts: { polityChanges: [{ code: "France", operation: "update" }] } };
  assert.equal(eventConcernsTarget(prose, isGermany), false);
  const named = { ...prose, impacts: { polityChanges: [{ code: "Germany", operation: "update" }] } };
  const russian = { ...named, title: "Германия повышает пошлины", description: "Берлин действует." };
  const chinese = { ...named, title: "德国提高关税", description: "柏林采取行动。" };
  for (const event of [named, russian, chinese]) assert.equal(eventConcernsTarget(event, isGermany), true, event.title);
  // The player's own event is the player's country's, by playerRelated alone.
  const own = { title: "Reform", playerRelated: true };
  assert.equal(eventConcernsTarget(own, isGermany), false);
  assert.equal(eventConcernsTarget(own, isGermany, { playerIsTarget: true }), true);
});

test("an event's kind is its tags, matched exactly", () => {
  assert.equal(eventHasAnyTag({ tags: ["Economy"] }, STATS_ECONOMIC_TAGS), true);
  assert.equal(eventHasAnyTag({ tags: ["economy"] }, STATS_ECONOMIC_TAGS), true);
  assert.equal(eventHasAnyTag({ tags: ["Culture", "Politics"] }, STATS_ECONOMIC_TAGS), false);
  assert.equal(eventHasAnyTag({ tags: ["Disaster"] }, STATS_DEMOGRAPHIC_TAGS), true);
  assert.equal(eventHasAnyTag({ tags: ["Economy"] }, STATS_DEMOGRAPHIC_TAGS), false);
  assert.equal(eventHasAnyTag({ title: "Trade war and famine" }, STATS_ECONOMIC_TAGS), false, "words are no tag");
});

const bundleWith = (events) => ({
  game: { country: "France", gameDate: "1913-01-01", startDate: "1912-01-01" },
  world: { polityOverrides: { Germany: { name: "Germany", status: "active" }, France: { name: "France", status: "active" } } },
  events,
});

test("the Stats worker's economic evidence: tagged events the country is a party to, the same in every language", async () => {
  const germany = { polityChanges: [{ code: "Germany", operation: "update" }] };
  const events = [
    { id: "en", date: "1912-03-01", tags: ["Economy"], title: "Germany raises tariffs on grain", description: "The Reichstag votes the bill.", impacts: germany },
    { id: "ru", date: "1912-03-02", tags: ["Economy"], title: "Германия повышает пошлины на зерно", description: "Рейхстаг принимает закон.", impacts: germany },
    { id: "war", date: "1912-04-01", tags: ["Military"], title: "Border clashes", description: "Shots on the Vosges.", combatants: ["Germany", "France"] },
    // German in its words, France's in its structure.
    { id: "prose", date: "1912-05-01", tags: ["Economy"], title: "German bankers lend to Paris", description: "A loan for the French treasury.", impacts: { polityChanges: [{ code: "France", operation: "update" }] } },
    // Germany's, but no economic, disaster or war event.
    { id: "culture", date: "1912-06-01", tags: ["Culture"], title: "Berlin opera season opens", description: "Tariff debates are forgotten for a night.", impacts: germany },
  ];
  const prepared = await prepareCountryStatsKernel({ bundle: bundleWith(events), code: "Germany" });
  assert.deepEqual(prepared.middle.rawEconomicEvidence.relevantIds, ["en", "ru", "war"]);
  const french = await prepareCountryStatsKernel({ bundle: bundleWith(events), code: "France" });
  assert.deepEqual(french.middle.rawEconomicEvidence.relevantIds, ["war", "prose"]);
});

test("gameplay.js and the worker read the tags and the structure, and no word list", () => {
  for (const file of ["./gameplay.js", "./countryStatsWorkerKernel.js"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /ECONOMIC_EVENT_PATTERN|STATS_DEMOGRAPHIC_CANON_PATTERN|statsTextMentionsTarget|STATS_GENERIC_POLITY_WORDS/, file);
    assert.match(source, /eventHasAnyTag\(event, STATS_ECONOMIC_TAGS\)\s*&& eventConcernsTarget\(event, sameTarget, \{ playerIsTarget \}\)/, file);
    assert.match(source, /eventHasAnyTag\(event, STATS_DEMOGRAPHIC_TAGS\)\s*&& eventConcernsTarget\(event, sameTarget, \{ playerIsTarget \}\)/, file);
  }
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(gameplay, /concernsTarget: \(event\) => eventConcernsTarget\(event, sameTarget, \{ playerIsTarget \}\)/, "the custom stats' continuity too");
});
