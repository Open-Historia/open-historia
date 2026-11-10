/*! Open Historia — the game in the player's language © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// How the game reads in another language (docs/i18n.md):
//
// 1. The INTERFACE, every fixed string the game renders, ships translated for
//    the languages in SHIPPED_PACK_LANGUAGES (i18n.js): public/lang/<code>.json,
//    built from the source by scripts/i18n/. This module applies it to the DOM
//    as it renders: exact strings, patterns built around a value
//    (phraseBook.js), and a run of text nodes React rendered from one template
//    ("Found ", "12", " regions") read as the one string it is. A string the
//    pack lacks stays English and is listed in window.__ohI18n.missing, for
//    the next pack.
// 2. CONTENT, what a scenario's author or a player made (scenario and game
//    names and descriptions, polities and their roles, a scenario's own
//    events, custom stats, region names, country names the pack lacks,
//    Community posts), is translated on this device by a translation model
//    (translationModels.js, translationModel.js, translationWorker.js), and
//    saved to the server's language pack so each string is translated once.
//    Region names go only once they are shown. A language the model covers
//    and no pack does (Danish, Hungarian, Romanian) has its interface
//    translated by it as well.
// 3. What the AI writes during play (events, chats, the advisor) arrives in
//    the player's language already (languageDirective) and is left alone.
//
// A scenario may ship its own text translated by its author's AI
// (server/scenarioLanguages.js, made in the Workshop's Languages tab). For the
// open game's scenario that pack is laid over everything else in the book
// (setScenarioLanguagePack): its strings come from it first, and never reach
// the model or the player's own AI.
//
// Nothing here is an AI request unless the player turned on Translate with my
// AI (aiTranslation.js): then what the model would translate goes to their AI
// provider instead, in big batches, and the model takes over whenever a
// request fails; with it off the AI is never asked. A language with a model is
// played in only once the player has said yes to its download
// (switchLanguage); said no, the game is in English. The interface language
// changes where the player is, without a reload: what was written over the
// page is put back to English and the new language is laid over it.
//
// What is translated is decided in translationRules.js, which the tests call
// directly.

import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  canTranslateTo,
  getStoredLanguage,
  hasShippedPack,
  isRtlLanguage,
  languageDisplayName,
  setStoredLanguage,
  syncLanguageFromServer,
} from "./i18n.js";
import { createDateLocalizer } from "./localDates.js";
import { createPhraseBook, fillSlots } from "./phraseBook.js";
import { loadPromptTranslations, setPromptTranslations } from "./promptTranslations.js";
import {
  formatModelSize,
  modelChoiceKey,
  readModelChoice,
  translationModelFor,
} from "./translationModels.js";
import {
  AI_CACHE_PREFIX,
  AI_TRANSLATION_SETTING,
  aiTranslationOffered,
  aiTranslationPrompt,
  createTranslationRouter,
  readAiTranslationSetting,
} from "./aiTranslation.js";
import {
  authoredEventText,
  collectContentText,
  isNumericDate,
  isTranslatable,
  routeUnknownText,
} from "./translationRules.js";

// v2: the shipped packs replaced the AI's translations of the interface, so
// the old per-language caches (which were mostly those) are dropped on boot.
// What they held that the server's pack does not is sent to it first.
const CACHE_PREFIX = "i18n_v2_";
const LEGACY_CACHE_PREFIX = "i18n_cache_";
const CACHE_LIMIT = 8000;
const MISSING_LIMIT = 3000;
const SCAN_DEBOUNCE_MS = 350;
const NOTICE_MS = 12000;
// The download prompt is over everything, Settings and the first-time setup
// included (Settings is 2147483000).
const CARD_Z = 2147483200;
const TRANSLATED_ATTRIBUTES = ["placeholder", "title", "aria-label", "aria-description", "alt"];

// Elements whose text is user-authored, machine-formatted, or must stay
// verbatim. [data-no-translate] lets any component opt out explicitly.
// (<select> is NOT skipped — dropdown options are UI text too; the language
// picker itself opts out via data-no-translate.)
//
// Text a player typed is theirs wherever it is shown, not only while it is in
// the box they typed it in. A queued order, shown in the Actions panel once it
// was written, was read as interface text: in a language with no shipped pack
// it was translated over the player's own words, and with a pack a `{{slot}}` pattern or a " / " list could rewrite a piece
// of it (a player's report, 2026-11-02: "the client overwrites text inputs
// through translation layers"). Such text, and the Game Master's preview the
// model wrote in the player's language, carry data-no-translate (actions.jsx,
// cheats.jsx).
const SKIP_SELECTOR = "script, style, noscript, input, textarea, [contenteditable], [data-no-translate]";
// An input's own placeholder and title are interface text all the same.
const ATTRIBUTE_SKIP_SELECTOR = "script, style, noscript, [contenteditable], [data-no-translate]";

// The progress pill's text: a pattern in the packs like any other string.
const PROGRESS_TEXT = {
  label: "Translating to {{language}}…",
};

// The translation model's prompt and its download (translationModels.js).
const MODEL_PROMPT_TEXT = {
  ask: "Playing in {{language}} needs a one-time download of its translation model ({{size}}).",
  download: "Download",
  keepEnglish: "Keep English",
  cancel: "Cancel",
  downloading: "Downloading the translation model… {{progress}}%",
  failed: "The translation model could not be downloaded.",
  retry: "Try again",
  unavailable: "The translation model could not be loaded. What it translates stays in English.",
};

// Said once a session, when a request to the player's AI fails and the model
// translates instead.
const AI_FAILED_TEXT = "Your AI could not translate, so the translation model on this device did.";

let language = DEFAULT_LANGUAGE;
// A shipped pack covers the interface: only content goes to the model.
let packed = false;
// Everything known: the server's pack (shipped + saved), over what this device
// translated itself; and the game's dates, written the player's way
// (localDates.js). Made for the language in startInLanguage.
let book = createPhraseBook();
// Translations the model made on this device, kept until the server has them.
let learned = new Map();
let pending = new Set();
// The map's region names, not queued up front (a few thousand of them on the
// built-in map): one goes to the model once it is shown (routeUnknownText).
let regionNames = new Set();
// Strings the model gave no usable answer for: left in English, and not asked
// about again this session.
let unusable = new Set();
let missing = new Set();
// The generation of the language in use: each start in a language is a new
// one, and work begun for an older one is dropped when it ends.
let generation = 0;
// The generation whose queue is being worked through, or 0.
let inFlight = 0;
let stopped = false;
// The translation model (translationModels.js): loaded this session, failed to
// load (what it would translate stays English), or on its way; the language
// a switch already loaded it for; the prompt's card, plain DOM like the pill.
let modelReady = false;
let modelFailed = false;
let modelLoading = null;
let preparedModel = "";
let modelDownloading = false;
let modelCardEl = null;
let noticeTimer = null;
// The pill holds a notice (showNotice) until its time is up.
let noticeUp = false;
let observer = null;
let scanTimer = null;
let persistTimer = null;
let progressEl = null;
let unsyncedEntries = {};
let syncTimer = null;
let updatedEventTimer = null;
let translatorActive = false;
let listenersInstalled = false;
let switching = null;
// Translate with my AI (aiTranslation.js). The AI's translations, kept on this
// device apart from the model's; the shipped pack's own strings, never asked
// for (null until known; empty for a language with no pack); the server's
// pack as it was read, so the book can be laid again when the switch changes;
// the content strings seen, which in a language with a pack are all the model
// translates; who translates the next batch; and whether the AI's
// translations are laid over the book now.
let aiEntries = new Map();
let shippedKeys = null;
let serverPack = {};
let contentStrings = new Set();
let router = null;
let aiShown = false;
let aiPersistTimer = null;
let aiNoticeShown = false;

// node → { english, written }: the English last rendered there, and what this
// module wrote over it. A value equal to `written` is ours; anything else is
// new English from React, so a re-render is translated again and our own
// writes are never mistaken for source text.
const nodeRecords = new WeakMap();
// element → { [attribute]: { english, written } }, the same for attributes.
const attributeRecords = new WeakMap();
let titleRecord = null;
// Runs already visited in the current pass (a run is reached from each of its
// text nodes).
const runsThisPass = new Set();

const cacheKey = () => `${CACHE_PREFIX}${language}`;

// New translations are pushed to the server's language pack (debounced), so
// every device, and every future session, reuses them instead of translating
// them again. The pack lives under server/data, which the update script never
// touches.
const sendEntries = async (code, entries) => {
  if (Object.keys(entries).length === 0) return;
  try {
    await fetch(`/api/lang/${code}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
  } catch {
    // Old server / offline: localStorage still has them for this device.
  }
};

const syncEntriesToServer = () => {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const entries = unsyncedEntries;
    unsyncedEntries = {};
    void sendEntries(language, entries);
  }, 2000);
};

// Lets map-label builders re-render once translations have (newly) arrived.
const announceUpdate = () => {
  clearTimeout(updatedEventTimer);
  updatedEventTimer = setTimeout(() => {
    window.dispatchEvent(new Event("i18n:updated"));
  }, 800);
};

const readStoredEntries = (key) => {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const loadCache = () => {
  const current = readStoredEntries(cacheKey());
  // First boot after the packs: this language's old cache is carried over (the
  // server pack is checked against it below), every language's is removed.
  const legacy = current ? null : readStoredEntries(`${LEGACY_CACHE_PREFIX}${language}`);
  learned = new Map(Object.entries(current ?? legacy ?? {}).filter(([, value]) => typeof value === "string"));
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(LEGACY_CACHE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: nothing to clean.
  }
  book.setAll(learned);
};

const writeCache = () => {
  if (language === DEFAULT_LANGUAGE || !learned.size) return;
  try {
    const entries = Array.from(learned.entries()).slice(-CACHE_LIMIT);
    localStorage.setItem(cacheKey(), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage full/blocked: translations still work for this session.
  }
};

const persistCache = () => {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(writeCache, 1500);
};

// The AI's translations (Translate with my AI), on this device only: never
// sent to the server's pack, which holds the model's.
const aiCacheKey = () => `${AI_CACHE_PREFIX}${language}`;

const loadAiCache = () => {
  aiEntries = new Map(Object.entries(readStoredEntries(aiCacheKey()) ?? {}).filter(([, value]) => typeof value === "string"));
};

const writeAiCache = () => {
  if (language === DEFAULT_LANGUAGE || !aiEntries.size) return;
  try {
    const entries = Array.from(aiEntries.entries()).slice(-CACHE_LIMIT);
    localStorage.setItem(aiCacheKey(), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage full/blocked: they still apply for this session.
  }
};

const persistAiCache = () => {
  clearTimeout(aiPersistTimer);
  aiPersistTimer = setTimeout(writeAiCache, 1500);
};

// ---- progress pill (plain DOM — must exist before/outside React) ----

const showProgress = () => {
  if (progressEl || typeof document === "undefined" || !document.body) return;
  progressEl = document.createElement("div");
  progressEl.setAttribute("data-no-translate", "");
  progressEl.style.cssText =
    `position:fixed;bottom:5.2rem;left:50%;transform:translateX(-50%);z-index:${CARD_Z};` +
    "background:var(--oh-ui-surface,rgba(24,24,27,0.96));border:1px solid var(--oh-ui-line,rgba(255,255,255,0.25));border-radius:999px;" +
    "color:var(--oh-ui-text,#fff);font-family:sans-serif;font-size:0.8rem;font-weight:600;padding:0.45rem 0.95rem;" +
    "box-shadow:0 6px 24px rgba(0,0,0,0.5);pointer-events:none;";
  document.body.appendChild(progressEl);
};

// The pill is up only while the queue is being worked through: when the queue
// stops, done, given up or with nothing to do, so does the pill, whatever is
// still pending (it is taken up again by the next scan).
const updateProgress = () => {
  // The download's own words stay in the pill while it lasts, and a notice
  // its time: the model failing is said, not taken off the screen at once.
  if (!progressEl || modelDownloading || noticeUp) return;
  if (pending.size === 0 || modelCardEl || !translating() || !inFlight) {
    progressEl.remove();
    progressEl = null;
    return;
  }
  const native = LANGUAGES.find((entry) => entry.code === language)?.native || languageDisplayName(language);
  const english = PROGRESS_TEXT.label.replace("{{language}}", native);
  progressEl.textContent = book.translate(english) ?? english;
};

// One line in the pill for a while: why the rest stays in English.
const showNotice = (english) => {
  showProgress();
  if (!progressEl) return;
  progressEl.textContent = book.translate(english) ?? english;
  noticeUp = true;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    noticeUp = false;
    progressEl?.remove();
    progressEl = null;
  }, NOTICE_MS);
};

// ---- lookups ----

// A rendered string the book has nothing for (translationRules.js
// routeUnknownText). With a shipped pack the interface stays English and is
// listed for the next pack; without one it goes to the model. A region name is
// content either way.
const noteUnknown = (trimmed) => {
  if (unusable.has(trimmed)) return;
  const route = routeUnknownText(trimmed, { packed, isContent: (text) => regionNames.has(text) });
  if (route === "content") {
    queueContent(trimmed);
  } else if (route === "missing") {
    if (missing.size < MISSING_LIMIT) missing.add(trimmed);
  } else if (translating()) {
    pending.add(trimmed);
  }
};

// A string the book has a translation for that the AI is to translate again:
// with Translate with my AI on, one the model made (never the pack's), in a
// language with a pack only content, as the model only translates that there.
const noteForAi = (trimmed) => {
  if (!aiWants(trimmed) || book.get(trimmed) === undefined) return;
  if (packed && !regionNames.has(trimmed) && !contentStrings.has(trimmed)) return;
  pending.add(trimmed);
};

// The translation of a whole value with its surrounding whitespace kept, or
// null when there is none.
const translateValue = (value, { note = true } = {}) => {
  const trimmed = value.trim();
  const numericDate = isNumericDate(trimmed);
  if (!numericDate && !isTranslatable(trimmed)) return null;
  const translated = book.translate(trimmed);
  if (translated == null) {
    if (note && !numericDate) noteUnknown(trimmed);
    return null;
  }
  if (note && aiShown && !numericDate) noteForAi(trimmed);
  const leading = value.slice(0, value.length - value.trimStart().length);
  const trailing = value.slice(value.trimEnd().length);
  return leading + translated + trailing;
};

// ---- the DOM ----

const englishOf = (node) => {
  const value = node.nodeValue ?? "";
  const record = nodeRecords.get(node);
  return record && value === record.written ? record.english : value;
};

const writeText = (node, english, written) => {
  if (written === english) {
    nodeRecords.delete(node);
  } else {
    nodeRecords.set(node, { english, written });
  }
  if (node.nodeValue !== written) node.nodeValue = written;
};

// A parent whose children are all text nodes: React renders `Found {count}
// regions` as three of them, and the pack knows the sentence, not its pieces.
const runParentOf = (node) => {
  const parent = node.parentNode;
  if (!parent || parent.nodeType !== Node.ELEMENT_NODE) return null;
  const children = parent.childNodes;
  if (children.length < 2) return null;
  for (const child of children) {
    if (child.nodeType !== Node.TEXT_NODE) return null;
  }
  return parent;
};

const visitPiece = (node, english) => {
  const translated = translateValue(english);
  writeText(node, english, translated ?? english);
};

const visitRun = (parent) => {
  const nodes = Array.from(parent.childNodes);
  const parts = nodes.map(englishOf);
  const translated = translateValue(parts.join(""), { note: false });
  if (translated != null) {
    // The whole sentence goes in the first node; the rest are emptied (and
    // still remember their English, so React's next write to one is read
    // against it).
    nodes.forEach((node, index) => writeText(node, parts[index], index === 0 ? translated : ""));
    return;
  }
  // Nothing for the whole: each piece on its own ("Press " and " to close").
  nodes.forEach((node, index) => visitPiece(node, parts[index]));
};

const visitTextNode = (node) => {
  const run = runParentOf(node);
  if (run) {
    if (!runsThisPass.has(run)) {
      runsThisPass.add(run);
      visitRun(run);
    }
    return;
  }
  visitPiece(node, englishOf(node));
};

const visitAttributes = (element) => {
  for (const attribute of TRANSLATED_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value == null) continue;
    let records = attributeRecords.get(element);
    const record = records?.[attribute];
    const english = record && value === record.written ? record.english : value;
    const translated = translateValue(english) ?? english;
    if (translated === english) {
      if (record) delete records[attribute];
    } else {
      if (!records) {
        records = {};
        attributeRecords.set(element, records);
      }
      records[attribute] = { english, written: translated };
    }
    if (value !== translated) element.setAttribute(attribute, translated);
  }
};

const visitTitle = () => {
  const value = document.title;
  const english = titleRecord && value === titleRecord.written ? titleRecord.english : value;
  const translated = translateValue(english) ?? english;
  titleRecord = translated === english ? null : { english, written: translated };
  if (value !== translated) document.title = translated;
};

// Exported for translator.test.js: what the walker leaves alone.
export const textIsSkipped = (node) => !node.parentElement || Boolean(node.parentElement.closest(SKIP_SELECTOR));
export const attributesAreSkipped = (element) => Boolean(element.closest(ATTRIBUTE_SKIP_SELECTOR));
const ATTRIBUTE_SELECTOR = TRANSLATED_ATTRIBUTES.map((attribute) => `[${attribute}]`).join(",");

const walkSubtree = (root) => {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    if (!textIsSkipped(root)) visitTextNode(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (textIsSkipped(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    visitTextNode(node);
  }

  const withAttributes = root.matches?.(ATTRIBUTE_SELECTOR) ? [root] : [];
  for (const element of [...withAttributes, ...(root.querySelectorAll?.(ATTRIBUTE_SELECTOR) ?? [])]) {
    if (!attributesAreSkipped(element)) visitAttributes(element);
  }
};

const scan = () => {
  if (stopped || !document.body) {
    return;
  }

  runsThisPass.clear();
  walkSubtree(document.body);
  visitTitle();
  void processQueue();
};

const scheduleScan = () => {
  if (stopped) {
    return;
  }

  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, SCAN_DEBOUNCE_MS);
};

// Mutations apply what is known SYNCHRONOUSLY (no debounce, no model wait) so
// new panels open translated instead of flashing English; only new content
// waits for the debounced scan and the model.
const handleMutations = (mutations) => {
  if (stopped) return;
  runsThisPass.clear();
  for (const mutation of mutations) {
    if (mutation.type === "characterData") {
      if (!textIsSkipped(mutation.target)) visitTextNode(mutation.target);
    } else if (mutation.type === "attributes") {
      const element = mutation.target;
      if (element.isConnected && !attributesAreSkipped(element)) visitAttributes(element);
    } else {
      for (const added of mutation.addedNodes) {
        walkSubtree(added);
      }
      // A node leaving a run changes the sentence the others spell (or ends
      // the run, leaving one node that may still hold the whole translation).
      if (mutation.removedNodes.length && mutation.target.nodeType === Node.ELEMENT_NODE) {
        for (const child of mutation.target.childNodes) {
          if (child.nodeType === Node.TEXT_NODE && !textIsSkipped(child)) visitTextNode(child);
        }
      }
    }
  }
  scheduleScan();
};

// Done with: translated, or given up on for this session.
const settle = (source) => {
  pending.delete(source);
};

// Everything this module wrote over the page, put back to the English React
// rendered, so another language can be laid over it (or none).
const restoreEnglish = () => {
  if (typeof document === "undefined" || !document.body) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const record = nodeRecords.get(node);
    if (!record) continue;
    if (node.nodeValue === record.written) node.nodeValue = record.english;
    nodeRecords.delete(node);
  }
  for (const element of document.body.querySelectorAll(ATTRIBUTE_SELECTOR)) {
    const records = attributeRecords.get(element);
    if (!records) continue;
    for (const [attribute, record] of Object.entries(records)) {
      if (element.getAttribute(attribute) === record.written) element.setAttribute(attribute, record.english);
    }
    attributeRecords.delete(element);
  }
  if (titleRecord && document.title === titleRecord.written) document.title = titleRecord.english;
  titleRecord = null;
};

// ---- the translation model on this device ----

// The player's answer for a language (translationModels.js modelChoiceKey).
const storedModelChoice = (code) => {
  try {
    return readModelChoice(localStorage.getItem(modelChoiceKey(code)));
  } catch {
    return "";
  }
};

// What was answered this session, for a device that cannot store it.
const sessionModelChoices = new Map();

const modelChoice = (code = language) => storedModelChoice(code) || sessionModelChoices.get(code) || "";

const storeModelChoice = (choice, code) => {
  sessionModelChoices.set(code, choice);
  try {
    localStorage.setItem(modelChoiceKey(code), choice);
  } catch {
    // Storage blocked: the answer holds for this session.
  }
};

// The model translates for the language in use: it has one, the player said
// yes to it, and it has not failed this session.
const modelInUse = () => Boolean(translationModelFor(language)) && modelChoice() === "yes" && !modelFailed;

// ---- Translate with my AI (aiTranslation.js) ----

// The switch, read once and again whenever a setting changes (it is asked
// about for every string on the page).
let aiSetting = null;
const aiSettingOn = () => {
  if (aiSetting === null) {
    try {
      aiSetting = readAiTranslationSetting(localStorage.getItem(AI_TRANSLATION_SETTING));
    } catch {
      aiSetting = false;
    }
  }
  return aiSetting;
};

// The AI translates for the language in use: the switch is on, it is offered
// there (a model the player downloaded), the pack's own strings are known so
// none is ever asked for, and the AI has not been given up on this session.
const aiInUse = () => language !== DEFAULT_LANGUAGE && aiSettingOn()
  && aiTranslationOffered({ language, modelChoice: modelChoice() })
  && shippedKeys !== null && Boolean(router) && !router.halted();

// Someone translates for the language in use: the model, or the AI.
const translating = () => modelInUse() || aiInUse();

// A string the AI may be asked for: not the pack's, not answered by it
// already, not put to it this session, and not given up on.
const aiWants = (text) => Boolean(shippedKeys && router) && !shippedKeys.has(text) && !aiEntries.has(text)
  && !inScenarioPack(text) && !pending.has(text) && !unusable.has(text) && !router.tried(text) && isTranslatable(text) && aiInUse();

// Whether the switch is offered for the interface language (Settings).
export const aiTranslationAvailable = () => {
  const code = getStoredLanguage();
  return aiTranslationOffered({ language: code, modelChoice: modelChoice(code) });
};

// The shipped pack's own strings: never the AI's. Read from the pack itself,
// as the server's merges in the model's. Only while the switch is on; until it
// is read (and should it not be), the AI is not used.
const loadShippedKeys = async (run) => {
  if (shippedKeys || !packed) {
    if (!shippedKeys) shippedKeys = new Set();
    return;
  }
  try {
    const base = typeof import.meta !== "undefined" && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : "/";
    const response = await fetch(`${base.replace(/\/?$/, "/")}lang/${encodeURIComponent(language)}.json`, { cache: "no-cache" });
    if (!response.ok) return;
    const pack = await response.json();
    if (run !== generation || !pack || typeof pack !== "object" || Array.isArray(pack)) return;
    shippedKeys = new Set(Object.keys(pack).map((key) => key.trim()));
  } catch {
    // Offline: the model translates, as with the switch off.
  }
};

// The book laid again: what this device's model learned, the server's pack
// over it, and with the AI in use its translations over all but the pack's.
const layBook = () => {
  aiShown = aiInUse();
  book = createPhraseBook({ localizeValue: createDateLocalizer(language) });
  book.setAll(learned);
  book.setAll(serverPack);
  if (aiShown) {
    for (const [source, translated] of aiEntries) {
      if (!shippedKeys.has(source)) book.set(source, translated);
    }
  }
  // The scenario's own pack over all of it (setScenarioLanguagePack).
  applyScenarioPack();
};

// The switch, or whether it applies, changed: the book is laid again and the
// page walked with it, at once. Off, the model's translations are back and
// what only the AI had goes to the model; on, what the model made is asked of
// the AI (once each, in big batches).
const followAiSwitch = async () => {
  const run = generation;
  aiSetting = null;
  if (aiSettingOn()) await loadShippedKeys(run);
  if (run !== generation || !translatorActive || aiInUse() === aiShown) return;
  layBook();
  for (const source of [...pending]) {
    if (book.has(source)) pending.delete(source);
  }
  unusable.clear();
  scan();
  // Content is queued as it is gathered (in a language with a pack the page's
  // own unknown text is not), so it is gathered again for whoever takes it now.
  void collectAndTranslate();
};

const askAi = async (batch) => {
  // Loaded only here: with the switch off the AI's modules are never touched.
  const [{ callAI }, { BACKGROUND_REQUEST }] = await Promise.all([
    import("../Game/AI/main.jsx"),
    import("../Game/AI/requestBudget.js"),
  ]);
  // Named, so Settings → AI → Used today says what these were; a background
  // request, as nobody pressed a button for it.
  return callAI(aiTranslationPrompt({ language, name: languageDisplayName(language), packed, count: batch.length }), [
    { role: "user", parts: [{ text: JSON.stringify(batch) }] },
  ], {
    languageMode: "none",
    taskKey: "translation",
    requestKind: BACKGROUND_REQUEST,
  });
};

// Nobody pressed anything for a translation, so it is background work
// (requestBudget.js), like idle diplomacy and the agents' reports between
// turns: it stops at the day's fixed cap and never takes the last tenth of
// the day's limit, and the translation model on this device translates
// meanwhile. Loaded only here, as the AI's modules are.
const mayAskAi = async () => {
  const { backgroundAiAllowance } = await import("../Game/AI/requestBudget.js");
  return backgroundAiAllowance().allowed;
};

const aiFailed = (error, { halted }) => {
  console.warn(
    `[i18n] your AI did not translate (${error?.message || "unknown"}); the translation model on this device did instead` +
    (halted ? ", and does for the rest of this session." : "."),
  );
  if (!aiNoticeShown) {
    aiNoticeShown = true;
    showNotice(AI_FAILED_TEXT);
  }
};

// The model's translation already in hand for a string, if any.
const modelKnows = (source) => (Object.hasOwn(serverPack, source) ? serverPack[source] : learned.get(source));

const loadModelModule = () => import("./translationModel.js");

const removeModelCard = () => {
  modelCardEl?.remove();
  modelCardEl = null;
};

// The card the prompt and the download share, over whatever is on screen: a
// game, a menu, Settings or the first-time setup. In the interface theme's
// colours (runtime/uiTheme.js), the original grey without one.
const modelCard = (code) => {
  if (typeof document === "undefined" || !document.body) return null;
  removeModelCard();
  modelCardEl = document.createElement("div");
  modelCardEl.setAttribute("data-no-translate", "");
  modelCardEl.style.cssText =
    `position:fixed;inset:0;z-index:${CARD_Z};display:flex;align-items:center;justify-content:center;` +
    "padding:1rem;box-sizing:border-box;background:rgba(0,0,0,0.55);";
  const card = document.createElement("div");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.dir = isRtlLanguage(code) ? "rtl" : "ltr";
  card.style.cssText =
    "width:min(26rem,100%);box-sizing:border-box;background:var(--oh-ui-surface,#1b1b1e);" +
    "border:1px solid var(--oh-ui-line,rgba(255,255,255,0.14));border-radius:12px;" +
    "color:var(--oh-ui-text,#f4f4f5);font-family:sans-serif;font-size:0.88rem;line-height:1.45;" +
    "padding:1rem 1.1rem;box-shadow:0 18px 48px rgba(0,0,0,0.55);";
  modelCardEl.append(card);
  document.body.appendChild(modelCardEl);
  return card;
};

// A text of the card in a language: the slots filled, then looked up whole,
// as the pill's is.
const say = (english, slots = {}, words = book) => {
  const filled = english.replace(/\{\{(\w+)\}\}/g, (match, name) => (name in slots ? String(slots[name]) : match));
  return words.translate(filled) ?? filled;
};

// The words of the language being chosen, so it is asked about in itself: its
// shipped pack, where it has one, else English.
const wordsFor = async (code) => {
  if (code === language) return book;
  const words = createPhraseBook({ localizeValue: createDateLocalizer(code) });
  if (!hasShippedPack(code)) return words;
  try {
    const response = await fetch(`/api/lang/${code}`);
    if (response.ok) words.setAll(await response.json());
  } catch {
    // Offline: asked in English.
  }
  return words;
};

const cardButton = (label, primary, onClick) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.cssText =
    "font:inherit;font-weight:600;border-radius:7px;padding:0.45rem 0.95rem;cursor:pointer;" +
    (primary
      ? "background:var(--oh-ui-text,#f4f4f5);color:var(--oh-ui-bg,#0b0b0d);border:1px solid var(--oh-ui-text,#f4f4f5);"
      : "background:transparent;color:var(--oh-ui-text,rgba(255,255,255,0.85));border:1px solid var(--oh-ui-line,rgba(255,255,255,0.25));");
  button.addEventListener("click", onClick);
  return button;
};

const cardText = (card, text) => {
  const paragraph = document.createElement("p");
  paragraph.style.margin = "0 0 0.8rem";
  paragraph.textContent = text;
  card.append(paragraph);
  return paragraph;
};

const cardActions = (card, ...buttons) => {
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;justify-content:flex-end;flex-wrap:wrap;gap:0.5rem;";
  actions.append(...buttons);
  card.append(actions);
};

// Downloads (once) and loads a language's model, with its progress.
const prepareModel = async (code, onProgress) => {
  const { loadTranslationModel, translationModelCached } = await loadModelModule();
  const cached = await translationModelCached(code);
  await loadTranslationModel(code, ({ loaded, total }) => {
    if (!cached && total) onProgress((loaded / total) * 100);
  });
  preparedModel = code;
};

// Asked before a language with a model is played in: its size, and Download
// or Keep English. A yes downloads it there and then, the card showing how far
// it is. Resolves true once the model is ready, false when the player keeps
// the language they had.
const askForModel = (code) => new Promise((resolve) => {
  const entry = translationModelFor(code);
  if (!entry) {
    resolve(true);
    return;
  }
  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    removeModelCard();
    resolve(value);
  };
  void wordsFor(code).then((words) => {
    const native = LANGUAGES.find((item) => item.code === code)?.native || languageDisplayName(code);
    const declineLabel = language === DEFAULT_LANGUAGE || language === code ? MODEL_PROMPT_TEXT.keepEnglish : MODEL_PROMPT_TEXT.cancel;
    const decline = () => {
      storeModelChoice("no", code);
      finish(false);
    };
    const download = () => {
      storeModelChoice("yes", code);
      const card = modelCard(code);
      if (!card) {
        finish(false);
        return;
      }
      card.setAttribute("role", "status");
      const text = cardText(card, say(MODEL_PROMPT_TEXT.downloading, { progress: 0 }, words));
      const track = document.createElement("div");
      track.style.cssText = "height:4px;border-radius:2px;background:rgba(255,255,255,0.12);overflow:hidden;";
      const fill = document.createElement("span");
      fill.style.cssText = "display:block;height:100%;width:0;background:var(--oh-ui-text,#f4f4f5);transition:width .25s;";
      track.append(fill);
      card.append(track);
      prepareModel(code, (percent) => {
        const value = Math.max(0, Math.min(100, Math.floor(percent)));
        text.textContent = say(MODEL_PROMPT_TEXT.downloading, { progress: value }, words);
        fill.style.width = `${value}%`;
      }).then(() => finish(true), (error) => {
        console.warn(`[i18n] the translation model did not download (${error?.message || "unknown"}).`);
        failed();
      });
    };
    const failed = () => {
      const card = modelCard(code);
      if (!card) {
        finish(false);
        return;
      }
      cardText(card, say(MODEL_PROMPT_TEXT.failed, {}, words));
      cardActions(card,
        cardButton(say(declineLabel, {}, words), false, decline),
        cardButton(say(MODEL_PROMPT_TEXT.retry, {}, words), true, download));
    };
    const card = modelCard(code);
    if (!card) {
      finish(false);
      return;
    }
    cardText(card, say(MODEL_PROMPT_TEXT.ask, { language: native, size: formatModelSize(entry.bytes) }, words));
    cardActions(card,
      cardButton(say(declineLabel, {}, words), false, decline),
      cardButton(say(MODEL_PROMPT_TEXT.download, {}, words), true, download));
  });
});

// Loads the model the player already said yes to: from this device, or
// downloaded again (the pill says how far) should its copy have gone. One that
// will not load leaves what it would translate in English for the session.
const ensureModel = () => {
  if (!modelLoading) {
    const code = language;
    const run = generation;
    modelLoading = (async () => {
      const { loadTranslationModel, translationModelCached } = await loadModelModule();
      const cached = await translationModelCached(code);
      if (!cached) modelDownloading = true;
      await loadTranslationModel(code, ({ loaded, total }) => {
        if (cached || !total || run !== generation) return;
        showProgress();
        if (progressEl) progressEl.textContent = say(MODEL_PROMPT_TEXT.downloading, { progress: Math.floor((loaded / total) * 100) });
      });
      modelDownloading = false;
      if (run !== generation) return;
      modelReady = true;
      updateProgress();
    })().catch((error) => {
      modelDownloading = false;
      if (run !== generation) return;
      modelFailed = true;
      console.warn(`[i18n] the translation model is not available (${error?.message || "unknown"}); what it would translate stays in English.`);
      showNotice(MODEL_PROMPT_TEXT.unavailable);
    });
  }
  return modelLoading;
};

// One batch through the model: its translation of each string, or null where
// it has none (that string stays English for the session). Loaded first if it
// is not yet; one that will not load or stops answers nothing.
const modelAnswers = async (batch) => {
  const none = () => batch.map(() => null);
  if (!modelInUse()) return none();
  const run = generation;
  if (!modelReady) {
    await ensureModel();
    if (!modelReady || run !== generation) return none();
  }
  try {
    const { translateWithModel } = await loadModelModule();
    return await translateWithModel(language, batch);
  } catch (error) {
    if (run === generation) {
      modelFailed = true;
      console.warn(`[i18n] the translation model stopped (${error?.message || "unknown"}); what it would translate stays in English.`);
    }
    return none();
  }
};

// What a step of the router settled. The model's translations are kept and
// saved to the server's pack; the AI's are kept on this device.
const applyStep = (result) => {
  for (const { source, text, by } of result.translated) {
    if (by === "ai") {
      aiEntries.set(source, text);
      if (aiShown) book.set(source, text);
      persistAiCache();
    } else {
      book.set(source, text);
      learned.set(source, text);
      unsyncedEntries[source] = text;
    }
    settle(source);
  }
  for (const source of result.kept) settle(source);
  for (const source of result.unusable) {
    unusable.add(source);
    settle(source);
  }
};

const processQueue = async () => {
  const run = generation;
  if (inFlight === run || stopped || pending.size === 0 || !translating() || !router) {
    return;
  }

  inFlight = run;
  try {
    while (pending.size > 0 && !stopped && run === generation && translating()) {
      // A request to the AI when the switch is on (the model takes what it
      // fails), else a batch through the model (aiTranslation.js).
      const result = await router.step(pending);
      if (run !== generation) break;
      applyStep(result);
      const settled = result.translated.length + result.kept.length + result.unusable.length;
      if (!settled && result.asked !== "ai") break;
      updateProgress();
      persistCache();
      syncEntriesToServer();
      announceUpdate();
      // Apply what we just learned (and pick up anything rendered meanwhile).
      scan();
    }
  } finally {
    if (inFlight === run) inFlight = 0;
    updateProgress();
  }
};

// ---- content ----

// A content string for the model: once, and only when nothing has it yet.
// With Translate with my AI on, also one only the model has translated.
const queueContent = (value) => {
  if (typeof value !== "string" || !translating()) return false;
  const trimmed = value.trim();
  if (!trimmed || !isTranslatable(trimmed) || pending.has(trimmed) || unusable.has(trimmed)) return false;
  contentStrings.add(trimmed);
  if (book.has(trimmed) && !(aiShown && aiWants(trimmed))) return false;
  pending.add(trimmed);
  return true;
};

// Everything a scenario or a player made that the game can show, gathered up
// front so it translates once instead of drip-translating panels as they open.
const collectContentStrings = async () => {
  const add = (value) => { queueContent(value); };
  const addCard = (entry) => {
    for (const key of ["name", "subtitle", "description", "eyebrow", "heroTitle", "heroSubtitle"]) {
      add(entry?.[key]);
    }
  };

  // Scenario + game cards (the built-in ones are in the pack).
  for (const url of ["/api/scenarios", "/api/games"]) {
    try {
      const data = await (await fetch(url)).json();
      const list = Array.isArray(data) ? data : data.scenarios ?? data.games ?? [];
      list.forEach(addCard);
    } catch {
      // Endpoint unreachable — those strings translate when next collected.
    }
  }

  // Country names the pack lacks, the scenario's polities (names, aliases,
  // the author's roles and notes, map labels), and its own events.
  try {
    const { JSON_URLS, loadCountryNames, readJson } = await import("./assets.js");
    (await loadCountryNames().catch(() => [])).forEach((country) => add(country?.name));
    const world = await readJson(JSON_URLS.world, { defaultValue: {} });
    for (const polity of Object.values(world?.polityOverrides ?? {})) {
      for (const key of ["name", "role", "note", "mapLabel", "mapDistinctLabel"]) add(polity?.[key]);
      (polity?.aliases ?? []).forEach(add);
    }
    authoredEventText(await readJson(JSON_URLS.events, { defaultValue: [] })).forEach(add);
  } catch {
    // Runtime assets unavailable (editor-only page etc.) — skip.
  }

  // A custom Stats sheet: its sections, stats, their descriptions and units.
  try {
    const { loadStatSheetDefinition } = await import("./statsSheet.js");
    const { flattenStatSheetRows } = await import("./statIndexDefinitions.js");
    const definition = await loadStatSheetDefinition();
    if (definition?.custom) {
      for (const stat of flattenStatSheetRows(definition)) {
        for (const key of ["label", "description", "sectionLabel", "prefix", "suffix"]) add(stat?.[key]);
      }
    }
  } catch { /* no custom sheet, or none loadable yet */ }

  // Community-hub posts (titles + descriptions), so the tab opens translated.
  try {
    const { fetchHubPosts } = await import("../Game/GameUI/communityHub.jsx");
    for (const post of await fetchHubPosts().catch(() => [])) {
      add(post?.title);
      add(post?.description);
    }
  } catch { /* hub unreachable — translated when the tab fetches them */ }

  // Region names — the big set (tags, owned-region pills, event impacts):
  // 4,848 on the built-in map, most of them names the player never looks at.
  // So they are only remembered here, and each goes to the model once it is
  // shown (noteUnknown).
  // Only the map in use: a scenario with its own map shows its own regions
  // (the stock ones are not drawn over it, or share its ids and take its names).
  try {
    const { loadRegionCatalog, loadScenarioRegionCatalog } = await import("./assets.js");
    const own = await loadScenarioRegionCatalog().catch(() => []);
    const regions = own?.length ? own : await loadRegionCatalog().catch(() => []);
    regionNames = new Set(regions.map((region) => (typeof region?.name === "string" ? region.name.trim() : "")).filter(Boolean));
  } catch { /* optional */ }
};

const collectAndTranslate = async () => {
  const run = generation;
  await collectContentStrings();
  if (stopped || run !== generation) return;
  // Started first, so the pill only comes up over a queue that is running.
  void processQueue();
  if (pending.size > 10 && inFlight) {
    showProgress();
    updateProgress();
  }
};

// ---- a scenario's own pack ----

// The open game's scenario's translations of its own strings into one
// language (scenarioLanguagePacks.js useScenarioLanguagePack), or none.
let scenarioPack = { code: "", entries: {} };

// Laid over the book while the game is in that language: after the server's
// pack and this device's, so the author's translation wins, and anything
// queued for the model that it has is taken off the queue.
const applyScenarioPack = () => {
  if (language === DEFAULT_LANGUAGE || scenarioPack.code !== language) return false;
  book.setAll(scenarioPack.entries);
  for (const source of Object.keys(scenarioPack.entries)) pending.delete(source.trim());
  return true;
};

// Whether the scenario's pack for the language in use has a string: then it is
// never asked of the player's AI (aiWants).
const inScenarioPack = (text) => scenarioPack.code === language && Object.hasOwn(scenarioPack.entries, text);

// The pack of the scenario in play for `code` (source -> translation); an
// empty one when it has none. Kept for the language it is in, and applied once
// the game is in it.
export const setScenarioLanguagePack = (code, entries) => {
  scenarioPack = {
    code: typeof code === "string" ? code : "",
    entries: entries && typeof entries === "object" && !Array.isArray(entries) ? entries : {},
  };
  if (!applyScenarioPack() || !translatorActive) return;
  scan();
  announceUpdate();
};

// ---- public lookups (map labels, proactive callers) ----

// Synchronous best-effort translation for text drawn OUTSIDE the DOM (map
// country labels): names, so content. Unknown ones are queued for the model,
// and an "i18n:updated" event fires once they resolve, so callers can rebuild.
export const translateLabel = (text) => {
  if (!translatorActive || typeof text !== "string") {
    return text;
  }
  const translated = book.get(text);
  if (translated) {
    if (aiShown && queueContent(text)) scheduleScan();
    return translated;
  }
  if (queueContent(text)) {
    scheduleScan();
  }
  return text;
};

// The loading screen's own text (StartupScreen.jsx), looked up in what the
// book already holds and nothing more. The DOM translator waits for that screen
// to go, so it translates itself through this: never queued, never a request,
// never a wait. Until the pack arrives, and in English, the text is returned
// as it is.
export const translateNow = (text) => {
  if (language === DEFAULT_LANGUAGE || typeof text !== "string" || !text) {
    return text;
  }
  return book.translate(text) ?? text;
};

// The language pack's translation of a name drawn outside the DOM, or null.
// Unlike translateLabel it never queues: for names every player of a language
// needs alike (the map's cities), which ship in the packs rather than cost
// each player requests.
export const lookupLabel = (text) => {
  if (!translatorActive || typeof text !== "string") return null;
  return book.get(text) ?? null;
};

// The interface's own words for a sentence the DOM translator never reaches:
// one the game puts in a composer for the player to edit or send as theirs
// (textareas are skipped, and the player's bubbles are data-no-translate).
// `text` is the English as the packs key it, a `{{slot}}` pattern included,
// and `params` fill its slots. Synchronous, from the shipped pack and what
// the server's pack has learned: without an entry it is the English.
export const uiString = (text, params = {}) => book.format(text, params) ?? fillSlots(text, params);

// Proactively queue content that exists as data but may not be rendered yet
// (e.g. freshly fetched Community-hub posts). Only unknown strings cost a call.
export const enqueueStrings = (strings) => {
  if (!translatorActive) return;
  let added = false;
  for (const value of strings ?? []) {
    if (queueContent(value)) added = true;
  }
  if (added) {
    void processQueue();
  }
};

// Human-readable fields inside written content (translationRules.js
// collectContentText). When an author saves a scenario or a game, these are
// pulled out and translated right away — and land in the server pack —
// instead of waiting to be rendered somewhere first.
export const enqueueContentStrings = (payload) => {
  if (!translatorActive || !payload) return;
  enqueueStrings(collectContentText(payload));
};

// An event log as it is written: only the scenario's own events are content
// (isAuthoredEvent); the AI's arrive in the player's language.
export const enqueueEventStrings = (events) => {
  if (!translatorActive || !Array.isArray(events)) return;
  enqueueStrings(authoredEventText(events));
};

// ---- lifecycle ----

// The server's language pack: the shipped pack, over every translation any
// device has saved (server.js / web/settingsStore.js merge them, the shipped
// entries winning). It is laid over what this device learned, so a stale
// local translation never hides the pack's; and what this device learned that
// the server lacks (an earlier save that failed) is sent to it again.
const loadServerPack = async () => {
  try {
    const response = await fetch(`/api/lang/${language}`);
    if (!response.ok) return;
    const pack = await response.json();
    if (!pack || typeof pack !== "object") return;
    serverPack = pack;
    book.setAll(pack);
    for (const [source, translated] of learned) {
      if (Object.hasOwn(pack, source)) {
        learned.delete(source);
      } else {
        unsyncedEntries[source] = translated;
      }
    }
    persistCache();
    syncEntriesToServer();
  } catch {
    // Old server / offline: the localStorage cache still applies.
  }
};

// Translation must NEVER interfere with game startup: wait until the loading
// screen is gone (or a generous timeout) before touching the DOM at all.
const whenStartupScreenGone = () => new Promise((resolve) => {
  const startedAt = Date.now();
  const check = () => {
    if (!document.querySelector("[data-startup-screen]") || Date.now() - startedAt > 180000) {
      resolve();
    } else {
      setTimeout(check, 250);
    }
  };
  check();
});

// A language the game can be shown in (i18n.js canTranslateTo), else English,
// kept so: a language with neither a pack nor a model was translated by the
// AI, which no longer translates.
const usableLanguage = (code) => {
  if (canTranslateTo(code)) return code;
  void setStoredLanguage(DEFAULT_LANGUAGE);
  return DEFAULT_LANGUAGE;
};

export const startTranslator = () => {
  if (typeof document === "undefined") {
    return;
  }

  // The server's stored choice wins over this device's copy, so a language
  // picked on desktop applies in the Android app (and vice versa). Runs even
  // when this device thinks it's English — a fresh install has no local copy.
  void syncLanguageFromServer().then((changed) => {
    if (changed) {
      window.location.reload();
    } else if (language === DEFAULT_LANGUAGE && getStoredLanguage() !== DEFAULT_LANGUAGE) {
      // This device could not store the choice (i18n.js holds it for the
      // page), so a reload would come back in English: start in it now.
      startInLanguage(usableLanguage(getStoredLanguage()));
    }
  });

  startInLanguage(usableLanguage(getStoredLanguage()));
};

const installListeners = () => {
  if (listenersInstalled) return;
  listenersInstalled = true;
  // A switch to another save brings its scenario's content.
  window.addEventListener("oh:active-game-changed", () => {
    if (translatorActive) void collectAndTranslate();
  });
  // Translate with my AI turned on or off (Settings; mapSettings.js).
  window.addEventListener("mapSettings:updated", () => {
    aiSetting = null;
    if (translatorActive) void followAiSwitch();
  });
};

const startInLanguage = (code) => {
  generation += 1;
  const run = generation;
  language = code;
  if (language === DEFAULT_LANGUAGE) {
    return;
  }
  packed = hasShippedPack(language);
  book = createPhraseBook({ localizeValue: createDateLocalizer(language) });
  // The prompts' guidance passages in this language, before any prompt is built.
  if (packed) void loadPromptTranslations(language);
  // For bug reports and tests: what is queued for the model, what the pack
  // lacks, and a way to walk the page again.
  window.__ohI18n = { language, packed, pending, missing, unusable, rescan: () => scan() };

  document.documentElement.lang = language;
  // Text direction only — flipping the whole HUD layout would fight the
  // fixed-position map UI, so panels stay put but text reads correctly.
  document.body.style.direction = isRtlLanguage(language) ? "rtl" : "";

  loadCache();
  loadAiCache();
  shippedKeys = packed ? null : new Set();
  router = createTranslationRouter({
    isAiOn: () => run === generation && aiShown && aiInUse(),
    mayAskAi,
    askAi,
    askModel: modelAnswers,
    known: modelKnows,
    cache: aiEntries,
    onAiFailure: aiFailed,
  });

  void (async () => {
    // Server pack first (cheap, instant), then wait out the loading screen.
    await loadServerPack();
    if (aiSettingOn()) await loadShippedKeys(run);
    if (run !== generation) return;
    if (aiInUse()) layBook();
    // The scenario's own pack over it, when there is one for this language.
    applyScenarioPack();
    await whenStartupScreenGone();
    if (stopped || run !== generation) return;

    translatorActive = true;
    installListeners();
    observer = new MutationObserver(handleMutations);
    observer.observe(document.body, {
      attributeFilter: TRANSLATED_ATTRIBUTES,
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    scan();
    announceUpdate();

    // A language with a model is played in once the player has said yes to
    // its download; said no, the game goes back to English.
    if (translationModelFor(language) && modelChoice() !== "yes") {
      const kept = await askForModel(language);
      if (run !== generation) return;
      if (!kept) {
        await switchLanguage(DEFAULT_LANGUAGE);
        return;
      }
      modelReady = preparedModel === language;
      if (aiInUse() !== aiShown) layBook();
      scan();
    }

    // Content, translated once: on later boots the server pack already has it
    // and this drains without a model run.
    await collectAndTranslate();
  })();
};

// Leaves the language in use: what it wrote over the page goes back to
// English, what it learned is saved, and its queue is dropped.
const leaveLanguage = () => {
  observer?.disconnect();
  observer = null;
  clearTimeout(scanTimer);
  clearTimeout(noticeTimer);
  noticeUp = false;
  clearTimeout(persistTimer);
  writeCache();
  clearTimeout(syncTimer);
  void sendEntries(language, unsyncedEntries);
  unsyncedEntries = {};
  translatorActive = false;
  restoreEnglish();
  progressEl?.remove();
  progressEl = null;
  pending = new Set();
  missing = new Set();
  unusable = new Set();
  regionNames = new Set();
  learned = new Map();
  clearTimeout(aiPersistTimer);
  writeAiCache();
  aiEntries = new Map();
  shippedKeys = null;
  serverPack = {};
  contentStrings = new Set();
  router = null;
  aiShown = false;
  aiNoticeShown = false;
  modelReady = false;
  modelFailed = false;
  modelLoading = null;
  modelDownloading = false;
};

const restartIn = (code) => {
  leaveLanguage();
  if (code === DEFAULT_LANGUAGE) {
    generation += 1;
    language = DEFAULT_LANGUAGE;
    packed = false;
    book = createPhraseBook();
    setPromptTranslations(DEFAULT_LANGUAGE, {});
    document.documentElement.lang = DEFAULT_LANGUAGE;
    document.body.style.direction = "";
    delete window.__ohI18n;
  } else {
    if (code !== language) setPromptTranslations(DEFAULT_LANGUAGE, {});
    startInLanguage(code);
    modelReady = preparedModel === code;
  }
  window.dispatchEvent(new Event("i18n:updated"));
  window.dispatchEvent(new CustomEvent("oh:ui-language-changed", { detail: { language } }));
};

// The interface language, changed where the player is: no reload, so a game
// on screen stays as it was. A language with a translation model is asked
// about first, and its model downloaded on a yes; on a no the game keeps the
// language it had. Resolves to the language the game is in afterwards.
export const switchLanguage = (code) => {
  if (switching) return switching;
  switching = (async () => {
    const wanted = canTranslateTo(code) ? code : DEFAULT_LANGUAGE;
    if (translationModelFor(wanted) && modelChoice(wanted) !== "yes" && !(await askForModel(wanted))) {
      return language;
    }
    await setStoredLanguage(wanted);
    if (wanted !== language || (wanted !== DEFAULT_LANGUAGE && !translatorActive)) restartIn(wanted);
    return language;
  })().finally(() => {
    switching = null;
  });
  return switching;
};

export const stopTranslator = () => {
  stopped = true;
  translatorActive = false;
  observer?.disconnect();
  clearTimeout(scanTimer);
  clearTimeout(noticeTimer);
  noticeUp = false;
  progressEl?.remove();
  progressEl = null;
  removeModelCard();
};
