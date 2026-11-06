/*! Open Historia — a scenario's language packs, made in the Workshop: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/scenarioLanguagePacks.test.js
//
// The Workshop's Languages tab collects a scenario's own strings and has its
// author's AI translate them. Requests are the scarce thing (a free Gemini key
// answers a few hundred a day), so a run must batch, ask several languages at
// once, never ask again for what a pack already has or what the game's own
// pack covers, and keep what it got when a later request fails. These tests
// run it against a fake AI that records every request.
import assert from "node:assert/strict";
import test from "node:test";

import { SCENARIO_TRANSLATION_TOOL } from "../Game/AI/scenarioTranslation.js";
import {
  buildTranslationRequest,
  buildTranslationSystemPrompt,
  collectScenarioStrings,
  fetchScenarioLanguagePack,
  generateScenarioLanguagePacks,
  languageCoverage,
  missingStrings,
  planScenarioTranslation,
  readTranslationAnswer,
  staleEntries,
} from "./scenarioLanguagePacks.js";

const SCENARIO = {
  scenario: { name: "The Thirty Years' War", description: "Bohemia rises against the Habsburgs.", eyebrow: "1618", subtitle: "Bohemia rises against the Habsburgs." },
  data: {
    world: {
      polityOverrides: {
        Bohemia: { name: "Kingdom of Bohemia", aliases: ["Bohemian Estates"], role: "Rebel estates", note: "" },
        Austria: { name: "Archduchy of Austria", mapLabel: "Austria" },
        Broken: "not a record",
      },
      groups: { "Protestant Union": { name: "Protestant Union", description: "An alliance of Protestant princes." } },
      institutions: { byId: { diet: { id: "diet", name: "Imperial Diet", shortName: "Reichstag", logoUrl: "https://example.com/x.png" } } },
      prehistory: { summary: "Decades of uneasy peace.", events: [{ id: "e1", date: "1555-09-25", title: "Peace of Augsburg", description: "Cuius regio, eius religio." }] },
    },
    events: [
      { title: "The Defenestration of Prague", description: "Two regents are thrown from a window.", source: "scenario" },
      { title: "Something the AI wrote", description: "In the player's language already.", source: "ai" },
    ],
  },
  assets: {
    stats: { sections: [{ label: "Faith", stats: [{ label: "Piety", description: "How devout the realm is.", suffix: "pts" }] }] },
    citiesGeojson: { features: [{ properties: { city: "Prague" } }, { properties: { name: "Vienna" } }] },
    regionsGeojson: { features: [{ properties: { name: "Moravia" } }, { properties: { name: "Prague" } }, { properties: {} }] },
  },
};

test("a scenario's own strings are collected once each, in the order a player meets them, and nothing else", () => {
  const strings = collectScenarioStrings(SCENARIO);
  const texts = strings.map((item) => item.text);
  assert.deepEqual(texts, [
    "The Thirty Years' War", "Bohemia rises against the Habsburgs.",
    "Kingdom of Bohemia", "Bohemian Estates", "Rebel estates", "Archduchy of Austria", "Austria",
    "Protestant Union", "An alliance of Protestant princes.",
    "Imperial Diet", "Reichstag",
    "The Defenestration of Prague", "Two regents are thrown from a window.",
    "Peace of Augsburg", "Cuius regio, eius religio.", "Decades of uneasy peace.",
    "Faith", "Piety", "How devout the realm is.", "pts",
    "Prague", "Vienna", "Moravia",
  ]);
  assert.ok(!texts.includes("1618"), "a string with no words is not translated");
  assert.ok(!texts.includes("Something the AI wrote"), "what the AI wrote during play is not the scenario's");
  assert.ok(!texts.some((text) => text.startsWith("https://")), "an address is not text");
  assert.equal(strings.find((item) => item.text === "Kingdom of Bohemia").kind, "polity");
  assert.equal(strings.find((item) => item.text === "Prague").kind, "city", "a name met twice keeps its first kind");
  assert.equal(strings.at(-1).kind, "region", "the names on the map come last");
  assert.deepEqual(collectScenarioStrings({}), []);
});

test("coverage counts what a pack has and what the game's own pack covers; a rewritten string is missing and its old entry stale", () => {
  const strings = collectScenarioStrings(SCENARIO);
  const pack = { "Kingdom of Bohemia": "Königreich Böhmen", "The old name": "Der alte Name" };
  const covered = { Prague: "Prag", Vienna: "Wien" };
  const missing = missingStrings(strings, pack, covered);
  assert.equal(missing.length, strings.length - 3);
  assert.ok(!missing.some((item) => ["Kingdom of Bohemia", "Prague", "Vienna"].includes(item.text)));
  assert.deepEqual(languageCoverage(strings, pack, covered), { done: 3, total: strings.length, missing: strings.length - 3 });
  assert.deepEqual(staleEntries(strings, pack), ["The old name"]);
});

test("requests are planned in large batches, languages that lack the same strings sharing a request", () => {
  const items = (count, length = 10) => Array.from({ length: count }, (_, index) => ({ text: `${"x".repeat(length)} ${index}`, kind: "eventText" }));
  // A first run: every language lacks everything, so they travel together, four to a request.
  const all = items(50);
  const first = planScenarioTranslation({ de: all, fr: all, es: all, it: all, pt: all, ru: all });
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((request) => request.codes), [["de", "es", "fr", "it"], ["pt", "ru"]]);
  assert.deepEqual(first[0].items.map((item) => item.id).slice(0, 3), ["1", "2", "3"], "ids are short and per request");
  // A batch is cut where its answer would no longer fit.
  const long = planScenarioTranslation({ de: items(30, 995) }, { answerChars: 5000 });
  assert.equal(long.length, 6);
  assert.ok(long.every((request) => request.items.length === 5));
  // ...and at a number of strings.
  assert.equal(planScenarioTranslation({ de: items(301, 1) }).length, 2);
  // A later run: German lacks two strings, French one of them: two small requests, nothing else.
  const later = planScenarioTranslation({ de: all.slice(0, 2), fr: all.slice(0, 1) });
  assert.deepEqual(later.map((request) => [request.codes, request.items.map((item) => item.text)]), [
    [["de", "fr"], [all[0].text]],
    [["de"], [all[1].text]],
  ]);
  assert.deepEqual(planScenarioTranslation({ de: [], fr: [] }), []);
  // A string longer than a whole answer still goes, alone.
  assert.equal(planScenarioTranslation({ de: items(2, 30000) }).length, 2);
});

test("the prompt asks for historical names, consistency and placeholders kept; the request is the strings as JSON", () => {
  const prompt = buildTranslationSystemPrompt({ name: "The Thirty Years' War", startDate: "1618-05-23", description: "Bohemia rises." });
  assert.match(prompt, /The Thirty Years' War, starting on 1618-05-23/);
  assert.match(prompt, /Böhmen/);
  assert.match(prompt, /never translate the parts of a proper name word by word/i);
  assert.match(prompt, /same English string always gets the same translation/);
  assert.match(prompt, /\{\{like_this\}\}/);
  assert.match(prompt, new RegExp(SCENARIO_TRANSLATION_TOOL.name));
  const request = buildTranslationRequest({ codes: ["de", "ja"], items: [{ id: "1", text: "Kingdom of Bohemia", kind: "polity" }] });
  assert.match(request, /de: German \(Deutsch\)/);
  assert.match(request, /ja: Japanese/);
  assert.deepEqual(JSON.parse(request.split("\n").at(-1)), [{ id: "1", kind: "a country or polity name", text: "Kingdom of Bohemia" }]);
  // Gemini refuses array bounds in a function's schema.
  assert.doesNotMatch(JSON.stringify(SCENARIO_TRANSLATION_TOOL.schema), /minItems|maxItems/);
});

test("an answer is read as a stranger's: only what was asked, nothing empty, every placeholder kept", () => {
  const request = { codes: ["de", "fr"], items: [{ id: "1", text: "Kingdom of Bohemia" }, { id: "2", text: "{{count}} regions held" }] };
  const read = readTranslationAnswer({ translations: [
    { id: "1", lang: "de", text: " Königreich Böhmen " },
    { id: "1", lang: "fr", text: "Royaume de Bohême" },
    { id: "2", lang: "de", text: "{{count}} Regionen gehalten" },
    { id: "2", lang: "fr", text: "{{nombre}} régions tenues" },
    { id: "3", lang: "de", text: "Not asked" },
    { id: "1", lang: "es", text: "Not asked either" },
    { id: "1", lang: "de", text: "" },
    "junk",
  ] }, request);
  assert.deepEqual(read, {
    de: { "Kingdom of Bohemia": "Königreich Böhmen", "{{count}} regions held": "{{count}} Regionen gehalten" },
    fr: { "Kingdom of Bohemia": "Royaume de Bohême" },
  });
  assert.deepEqual(readTranslationAnswer(null, request), { de: {}, fr: {} });
});

// A fake AI: answers every string in every language asked, as "<code>:<text>",
// and records each request.
const fakeAI = ({ failOn = 0, skip = () => false } = {}) => {
  const asked = [];
  const ask = async (systemPrompt, userMessage, tool) => {
    asked.push({ systemPrompt, userMessage, tool });
    if (failOn && asked.length === failOn) throw new Error("The model is busy.");
    const lines = userMessage.split("\n");
    const codes = lines.slice(1, lines.indexOf("")).map((line) => line.split(":")[0]);
    const items = JSON.parse(lines.at(-1));
    return { translations: codes.flatMap((lang) => items.filter((item) => !skip(lang, item.text)).map((item) => ({ id: item.id, lang, text: `${lang}:${item.text}` }))) };
  };
  return { ask, asked };
};

test("a run translates every language in as few requests as it can, and the next run asks only for what changed", async () => {
  const strings = collectScenarioStrings(SCENARIO);
  const ai = fakeAI();
  const progress = [];
  const first = await generateScenarioLanguagePacks({
    strings,
    codes: ["de", "fr", "ja"],
    covered: { de: { Prague: "Prag", Vienna: "Wien" } },
    scenario: { name: "The Thirty Years' War" },
    ask: ai.ask,
    onProgress: ({ done, total }) => progress.push(`${done}/${total}`),
  });
  assert.equal(first.failed, null);
  assert.equal(ai.asked.length, 2, "one request for the strings all three lack, one for the two German has from the game");
  assert.deepEqual(progress, ["0/2", "1/2", "2/2"]);
  assert.equal(ai.asked[0].tool, SCENARIO_TRANSLATION_TOOL);
  assert.equal(Object.keys(first.packs.de).length, strings.length - 2, "what the game's own pack has is left to it");
  assert.equal(first.packs.fr["Kingdom of Bohemia"], "fr:Kingdom of Bohemia");
  assert.equal(Object.keys(first.packs.ja).length, strings.length);

  // Nothing changed: no request at all.
  const again = fakeAI();
  const second = await generateScenarioLanguagePacks({ strings, codes: ["de", "fr", "ja"], packs: first.packs, covered: { de: { Prague: "Prag", Vienna: "Wien" } }, ask: again.ask });
  assert.equal(again.asked.length, 0);
  assert.deepEqual(second.packs, first.packs);

  // The author rewrote a string, corrected another by hand, and added a language.
  const edited = { ...first.packs, de: { ...first.packs.de, "Archduchy of Austria": "Erzherzogtum Österreich" } };
  const renamed = strings.map((item) => (item.text === "Kingdom of Bohemia" ? { ...item, text: "Crown of Bohemia" } : item));
  const third = fakeAI();
  const result = await generateScenarioLanguagePacks({ strings: renamed, codes: ["de", "fr", "ja", "es"], packs: edited, covered: { de: { Prague: "Prag", Vienna: "Wien" } }, ask: third.ask });
  assert.equal(third.asked.length, 2, "the rewritten string in the three old languages, and Spanish whole");
  assert.equal(JSON.parse(third.asked[0].userMessage.split("\n").at(-1)).length, 1);
  assert.equal(result.packs.de["Archduchy of Austria"], "Erzherzogtum Österreich", "a hand correction is never asked about again");
  assert.equal(result.packs.de["Crown of Bohemia"], "de:Crown of Bohemia");
  assert.equal("Kingdom of Bohemia" in result.packs.de, false, "the old string's entry goes with it");
  assert.equal(Object.keys(result.packs.es).length, strings.length);
});

test("a run that fails half-way keeps what it got, and a string the AI left out stays missing for the next run", async () => {
  const strings = Array.from({ length: 40 }, (_, index) => ({ text: `Event number ${index} ${"long text ".repeat(100)}`, kind: "eventText" }));
  const ai = fakeAI({ failOn: 3, skip: (lang, text) => lang === "fr" && text.startsWith("Event number 0 ") });
  const kept = [];
  const result = await generateScenarioLanguagePacks({ strings, codes: ["de", "fr"], ask: ai.ask, onProgress: ({ packs }) => kept.push(packs) });
  assert.match(result.failed.message, /busy/);
  assert.equal(result.requests, 2);
  assert.ok(Object.keys(result.packs.de).length > 0 && Object.keys(result.packs.de).length < 40, "what came before the failure is kept");
  assert.deepEqual(kept.at(-1), result.packs, "and was handed over as it arrived");
  assert.equal(`Event number 0 ${"long text ".repeat(100)}`.trim() in result.packs.fr, false);
  // Stopped from outside: nothing more is asked.
  const controller = new AbortController();
  controller.abort(new Error("Stopped."));
  const stopped = fakeAI();
  const none = await generateScenarioLanguagePacks({ strings, codes: ["de"], ask: stopped.ask, signal: controller.signal });
  assert.equal(stopped.asked.length, 0);
  assert.match(none.failed.message, /Stopped/);
});

test("a game fetches one language's pack from the library, and nothing for English or a bad code", async () => {
  const asked = [];
  const fetchImpl = async (address) => {
    asked.push(address);
    return { ok: true, json: async () => ({ code: "de", strings: { Bohemia: "Böhmen" } }) };
  };
  assert.deepEqual(await fetchScenarioLanguagePack("thirty years", "de", { fetchImpl }), { Bohemia: "Böhmen" });
  assert.deepEqual(asked, ["/api/scenarios/thirty%20years/languages/de"]);
  assert.deepEqual(await fetchScenarioLanguagePack("s", "en", { fetchImpl }), {});
  assert.deepEqual(await fetchScenarioLanguagePack("s", "../x", { fetchImpl }), {});
  assert.deepEqual(await fetchScenarioLanguagePack("", "de", { fetchImpl }), {});
  assert.equal(asked.length, 1);
  assert.deepEqual(await fetchScenarioLanguagePack("s", "de", { fetchImpl: async () => ({ ok: false }) }), {});
  assert.deepEqual(await fetchScenarioLanguagePack("s", "de", { fetchImpl: async () => { throw new Error("offline"); } }), {});
});
