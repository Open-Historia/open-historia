/*! Open Historia — a scenario's language packs, made in the Workshop © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The Workshop's Languages tab (GameUI/ScenarioLanguagesPanel.jsx) translates a
// scenario's own text into other languages once, with its author's AI, so
// that every player of the scenario reads it properly translated and none of
// them spends a request or runs the on-device model on it. The record itself,
// and its limits, are server/scenarioLanguages.js; how a game uses it is
// translator.js (setScenarioLanguagePack) fed by useScenarioLanguagePack.js; the
// request itself, Game/AI/scenarioTranslation.js.
//
// Generation is economical by construction:
//   - only the scenario's own strings are collected (collectScenarioStrings),
//     each once however often it appears;
//   - a string a pack already has is never asked about again (the pack is keyed
//     by the English, so a string the author rewrote is a new, missing one);
//   - a string the game's own shipped pack has (a stock country, region or
//     city) is left to it;
//   - what is left goes in large batches, several languages to one request
//     when they lack the same strings (planScenarioTranslation).
// A typical scenario (a few hundred strings) is a handful of requests for all
// of its languages; a later run asks only for what changed.

import { languageDisplayName, LANGUAGES } from "./i18n.js";
import { isTranslatable } from "./translationRules.js";
import { SCENARIO_TRANSLATION_TOOL } from "../Game/AI/scenarioTranslation.js";
import {
  MAX_SCENARIO_LANGUAGE_SOURCE,
  normalizeScenarioLanguages,
  scenarioLanguageCode,
  scenarioLanguageKey,
} from "../../server/scenarioLanguages.js";

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// ---- what a scenario says ----------------------------------------------------

// What a string is, for the translator's prompt: a name is translated as a
// name, a title as a title, prose as prose.
export const STRING_KINDS = Object.freeze({
  scenarioName: "the scenario's name",
  scenarioText: "the scenario's card or description text",
  polity: "a country or polity name",
  polityText: "a country's role or note",
  group: "a group (alliance, bloc, movement) name",
  groupText: "a group's description",
  politics: "an institution, party, office, agreement or political actor",
  eventTitle: "an event title",
  eventText: "an event's text",
  stat: "a statistic's label or unit",
  city: "a city name",
  region: "a region name",
});

// Fields of the Politics tab's records that are shown to a player.
const POLITICS_TEXT_KEYS = new Set([
  "name", "shortName", "title", "label", "role", "note", "summary", "description", "terms", "text", "quote",
]);
const POLITICS_FIELDS = ["institutions", "politicalActors", "powerStatus", "agreements"];
const MAX_WALK_DEPTH = 7;
const MAX_WALK_ARRAY = 2000;

// Every string the scenario itself shows a player, once each, in the order a
// player meets them: its card, its countries and groups, its politics, its
// events and backstory, its stats, then the names on its own map. `scenario`
// is its details (or the editor's form, which may be ahead of them), `data`
// the details' data, and `assets` what the caller could load of its own map
// and sheet: { regionsGeojson, citiesGeojson, stats }.
//   -> [{ text, kind }]
export const collectScenarioStrings = ({ scenario = {}, data = {}, assets = {} } = {}) => {
  const seen = new Set();
  const found = [];
  const add = (value, kind) => {
    const text = scenarioLanguageKey(value);
    if (!text || seen.has(text) || text.length > MAX_SCENARIO_LANGUAGE_SOURCE || !isTranslatable(text)) return;
    seen.add(text);
    found.push({ text, kind });
  };
  const world = isRecord(data.world) ? data.world : {};

  add(scenario.name, "scenarioName");
  add(scenario.heroTitle, "scenarioName");
  for (const key of ["eyebrow", "subtitle", "heroSubtitle", "description"]) add(scenario[key], "scenarioText");

  for (const [key, polity] of Object.entries(isRecord(world.polityOverrides) ? world.polityOverrides : {})) {
    if (!isRecord(polity)) continue;
    add(polity.name || key, "polity");
    for (const label of ["mapLabel", "mapDistinctLabel"]) add(polity[label], "polity");
    for (const alias of Array.isArray(polity.aliases) ? polity.aliases : []) add(alias, "polity");
    for (const text of ["role", "note"]) add(polity[text], "polityText");
  }
  for (const [key, group] of Object.entries(isRecord(world.groups) ? world.groups : {})) {
    if (!isRecord(group)) continue;
    add(group.name || key, "group");
    add(group.description, "groupText");
  }

  const walk = (value, depth) => {
    if (depth > MAX_WALK_DEPTH || value == null) return;
    if (Array.isArray(value)) {
      if (value.length <= MAX_WALK_ARRAY) value.forEach((entry) => walk(entry, depth + 1));
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "string") {
        if (POLITICS_TEXT_KEYS.has(key)) add(entry, "politics");
      } else {
        walk(entry, depth + 1);
      }
    }
  };
  for (const field of POLITICS_FIELDS) walk(world[field], 0);

  // The scenario's own events (the AI's arrive in the player's language), and
  // the backstory it opens with.
  const ownEvents = (Array.isArray(data.events) ? data.events : []).filter((event) => !event?.source || event.source === "scenario");
  const prehistory = isRecord(world.prehistory) ? world.prehistory : {};
  for (const event of [...ownEvents, ...(Array.isArray(prehistory.events) ? prehistory.events : [])]) {
    if (!isRecord(event)) continue;
    add(event.title, "eventTitle");
    add(event.description, "eventText");
    add(event.quote, "eventText");
  }
  add(prehistory.summary, "eventText");

  // A custom Stats sheet: its sections, stats, their descriptions and units.
  const sheet = isRecord(assets.stats) ? assets.stats : null;
  for (const section of Array.isArray(sheet?.sections) ? sheet.sections : []) {
    if (!isRecord(section)) continue;
    add(section.label, "stat");
    for (const stat of Array.isArray(section.stats) ? section.stats : []) {
      if (!isRecord(stat)) continue;
      for (const key of ["label", "description", "prefix", "suffix"]) add(stat[key], "stat");
    }
  }

  // The names on its own map, last: there can be thousands, and a pack that
  // runs out of room loses these first.
  for (const feature of Array.isArray(assets.citiesGeojson?.features) ? assets.citiesGeojson.features : []) {
    add(feature?.properties?.city ?? feature?.properties?.name, "city");
  }
  for (const feature of Array.isArray(assets.regionsGeojson?.features) ? assets.regionsGeojson.features : []) {
    add(feature?.properties?.name, "region");
  }
  return found;
};

// ---- how far each language is --------------------------------------------------

// What a language's pack lacks of `strings`: not translated yet, or written
// since (a rewritten string is a new key). `covered` is what the game's own
// shipped pack for that language already has, which needs no translation.
export const missingStrings = (strings, pack = {}, covered = null) => strings.filter((item) =>
  !(isRecord(pack) && Object.hasOwn(pack, item.text)) && !(covered && Object.hasOwn(covered, item.text)));

// How much of `strings` a language has: { done, total, missing }, with what the
// game's pack covers counted as done.
export const languageCoverage = (strings, pack = {}, covered = null) => {
  const missing = missingStrings(strings, pack, covered).length;
  return { done: strings.length - missing, total: strings.length, missing };
};

// The entries of a pack that no string of the scenario has any more: what the
// author rewrote or took out. Dropped on generation, so a pack stays the size
// of the scenario.
export const staleEntries = (strings, pack = {}) => {
  const current = new Set(strings.map((item) => item.text));
  return Object.keys(isRecord(pack) ? pack : {}).filter((source) => !current.has(source));
};

// ---- the requests ------------------------------------------------------------

// What one request may hold: the answer is every string in every language of
// the request, and has to fit in what any model the author may have set up
// answers in one go (8k tokens is the common floor; a character of a
// translation is about a third of a token in Latin script and more in others).
export const REQUEST_ANSWER_CHARS = 20000;
export const REQUEST_MAX_STRINGS = 300;
export const REQUEST_MAX_LANGUAGES = 4;

// The requests that bring every language up to date. Strings missing from the
// same languages travel together, so a first run asks for a string in all of
// them at once; languages go at most REQUEST_MAX_LANGUAGES to a request, and
// strings in batches whose answer fits REQUEST_ANSWER_CHARS.
//   missingByCode: { [code]: [{ text, kind }] }
//   -> [{ codes: [...], items: [{ id, text, kind }] }]
export const planScenarioTranslation = (missingByCode, {
  answerChars = REQUEST_ANSWER_CHARS,
  maxStrings = REQUEST_MAX_STRINGS,
  maxLanguages = REQUEST_MAX_LANGUAGES,
} = {}) => {
  // Each string, and the languages that lack it.
  const lacking = new Map();
  for (const code of Object.keys(missingByCode ?? {}).sort()) {
    for (const item of missingByCode[code] ?? []) {
      if (!lacking.has(item.text)) lacking.set(item.text, { item, codes: [] });
      lacking.get(item.text).codes.push(code);
    }
  }
  // Grouped by those languages, then cut into requests.
  const groups = new Map();
  for (const { item, codes } of lacking.values()) {
    const key = codes.join(",");
    if (!groups.has(key)) groups.set(key, { codes, items: [] });
    groups.get(key).items.push(item);
  }
  const requests = [];
  for (const { codes, items } of groups.values()) {
    for (let start = 0; start < codes.length; start += maxLanguages) {
      const chunk = codes.slice(start, start + maxLanguages);
      let batch = [];
      let chars = 0;
      const flush = () => {
        if (batch.length) requests.push({ codes: chunk, items: batch.map((entry, index) => ({ id: String(index + 1), ...entry })) });
        batch = [];
        chars = 0;
      };
      for (const item of items) {
        const cost = item.text.length * chunk.length;
        if (batch.length && (chars + cost > answerChars || batch.length >= maxStrings)) flush();
        batch.push({ text: item.text, kind: item.kind });
        chars += cost;
      }
      flush();
    }
  }
  return requests;
};

const languageLine = (code) => {
  const entry = LANGUAGES.find((language) => language.code === code);
  return entry ? `${code}: ${entry.name} (${entry.native})` : `${code}: ${languageDisplayName(code)}`;
};

// The instructions, the same for every request of a scenario so a provider
// that caches a prompt's start can reuse it.
export const buildTranslationSystemPrompt = ({ name = "", startDate = "", description = "" } = {}) => [
  "You translate the text of one scenario of Open Historia, a historical grand-strategy game, from English into other languages, for players who read the game in those languages. Your translations ship with the scenario and every player of it reads them, so they must read as if written in the language by a careful historian and editor.",
  "",
  `The scenario: ${String(name).trim() || "(untitled)"}${startDate ? `, starting on ${startDate}` : ""}.`,
  ...(description ? [`What it is about: ${String(description).trim().slice(0, 800)}`] : []),
  "",
  "Rules:",
  "1. Names of countries, states, dynasties, empires, regions, provinces, cities, rivers, seas, people and institutions: write the name the language has for that place or body, as published histories in the language name it for the scenario's period (for example English \"Bohemia\" is German \"Böhmen\", \"Holy Roman Empire\" is French \"Saint-Empire romain germanique\", \"Ottoman Empire\" is Turkish \"Osmanlı İmparatorluğu\"). Where the language has no name of its own, keep the original name, transliterated into the language's script where the language does so by convention. Never invent a name, and never translate the parts of a proper name word by word.",
  "2. Be consistent: the same English string always gets the same translation, and a term (a title, an office, a party, an army) is rendered the same way in every string where it appears.",
  "3. Keep exactly as they are: anything in double curly braces ({{like_this}}), %s and %d style placeholders, HTML tags, Markdown, line breaks, numbers, years and dates. Put them where they read naturally.",
  "4. Each string says what it is (its kind). A name stays a name: no article, explanation or bracketed original added unless the language's grammar requires it. A title stays as short as the original. Prose keeps its tone, register and length.",
  "5. A string the language writes exactly as English does (a name it keeps) is returned unchanged.",
  "6. Translate every string into every language asked for. Do not skip any, merge any or add notes.",
  "",
  `Answer by calling ${SCENARIO_TRANSLATION_TOOL.name} once, or, if you cannot call it, with this JSON object and nothing else: {"translations":[{"id":"1","lang":"de","text":"..."}]}`,
].join("\n");

// The user turn of one request: the languages, then the strings as JSON.
export const buildTranslationRequest = ({ codes, items }) => [
  "Translate into these languages (code: name):",
  ...codes.map(languageLine),
  "",
  "The strings (id, kind, text):",
  JSON.stringify(items.map((item) => ({ id: item.id, kind: STRING_KINDS[item.kind] ?? "text", text: item.text }))),
].join("\n");

// Every `{{slot}}` of a text, in order.
const slotsOf = (text) => (String(text).match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).map((slot) => slot.replace(/\s+/g, "")).sort();
const sameSlots = (source, translation) => slotsOf(source).join("|") === slotsOf(translation).join("|");

// A request's answer, read as a stranger's: { [code]: { [source]: text } }, only
// for strings and languages it was asked about, never empty, and with every
// placeholder of the source kept. What is not usable stays missing.
export const readTranslationAnswer = (answer, request) => {
  const byId = new Map(request.items.map((item) => [item.id, item.text]));
  const codes = new Set(request.codes);
  const list = Array.isArray(answer?.translations) ? answer.translations : Array.isArray(answer) ? answer : [];
  const out = Object.fromEntries(request.codes.map((code) => [code, {}]));
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const id = String(entry.id ?? "").trim();
    const code = String(entry.lang ?? entry.language ?? "").trim();
    const text = typeof entry.text === "string" ? entry.text.trim() : "";
    if (!byId.has(id) || !codes.has(code) || !text) continue;
    const source = byId.get(id);
    if (!sameSlots(source, text)) continue;
    out[code][source] = text;
  }
  return out;
};

// ---- a run ---------------------------------------------------------------

// Brings the packs of `codes` up to date with `strings`:
//   ask(systemPrompt, userMessage, tool, { signal }) -> the answer object
//   packs: the scenario's record as it is (normalizeScenarioLanguages's shape)
//   covered: { [code]: shipped pack } — strings the game's own pack has
//   onProgress({ done, total, packs }) after each request: `packs` is the whole
//   record so far, so what was done is kept should a later request fail.
// Resolves to { packs, requests, failed }: `failed` is the error that stopped
// the run, if one did (what came before it is in `packs`).
export const generateScenarioLanguagePacks = async ({
  strings,
  codes,
  packs = null,
  covered = {},
  scenario = {},
  ask,
  onProgress = () => {},
  signal = null,
  plan = {},
} = {}) => {
  const wanted = [...new Set((codes ?? []).map(scenarioLanguageCode).filter(Boolean))];
  const next = { ...(normalizeScenarioLanguages(packs) ?? {}) };
  // A pack drops what the scenario no longer says.
  for (const code of wanted) {
    const pack = { ...(next[code] ?? {}) };
    for (const source of staleEntries(strings, pack)) delete pack[source];
    next[code] = pack;
  }
  const missingByCode = Object.fromEntries(wanted.map((code) => [code, missingStrings(strings, next[code], covered?.[code])]));
  const requests = planScenarioTranslation(missingByCode, plan);
  const systemPrompt = buildTranslationSystemPrompt(scenario);
  const tidy = () => normalizeScenarioLanguages(next);
  let done = 0;
  onProgress({ done, total: requests.length, packs: tidy() });
  for (const request of requests) {
    if (signal?.aborted) return { packs: tidy(), requests: done, failed: signal.reason ?? new Error("Stopped.") };
    let answer;
    try {
      answer = await ask(systemPrompt, buildTranslationRequest(request), SCENARIO_TRANSLATION_TOOL, { signal });
    } catch (error) {
      return { packs: tidy(), requests: done, failed: error };
    }
    const translated = readTranslationAnswer(answer, request);
    for (const code of request.codes) next[code] = { ...(next[code] ?? {}), ...translated[code] };
    done += 1;
    onProgress({ done, total: requests.length, packs: tidy() });
  }
  return { packs: tidy(), requests: done, failed: null };
};

// The game's own shipped pack for a language (public/lang/<code>.json): what
// it has needs no translation. Empty when there is none or it cannot be read.
export const loadShippedPackFor = async (code, { fetchImpl = globalThis.fetch } = {}) => {
  try {
    const base = typeof location !== "undefined" ? new URL(import.meta.env?.BASE_URL || "/", location.origin) : null;
    if (!base || typeof fetchImpl !== "function") return {};
    const response = await fetchImpl(new URL(`lang/${code}.json`, base));
    if (!response.ok) return {};
    const pack = await response.json();
    return isRecord(pack) ? pack : {};
  } catch {
    return {};
  }
};

// ---- in a game -------------------------------------------------------------

// One language's pack of a scenario, from the library (both stores answer
// GET /api/scenarios/:id/languages/:code). Empty when it has none.
export const fetchScenarioLanguagePack = async (scenarioId, code, { fetchImpl = globalThis.fetch } = {}) => {
  const wanted = scenarioLanguageCode(code);
  if (!scenarioId || !wanted) return {};
  try {
    const response = await fetchImpl(`/api/scenarios/${encodeURIComponent(scenarioId)}/languages/${encodeURIComponent(wanted)}`);
    if (!response.ok) return {};
    const body = await response.json();
    return isRecord(body?.strings) ? body.strings : {};
  } catch {
    return {};
  }
};
