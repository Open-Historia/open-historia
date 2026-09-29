/*! Open Historia — the game in the player's language © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// How the game reads in another language (docs/i18n.md):
//
// 1. The INTERFACE, every fixed string the game renders, ships translated for
//    the languages in SHIPPED_PACK_LANGUAGES (i18n.js): public/lang/<code>.json,
//    built from the source by scripts/i18n/. This module applies it to the DOM
//    as it renders: exact strings, patterns built around a value
//    (phraseBook.js), and a run of text nodes React rendered from one template
//    ("Found ", "12", " regions") read as the one string it is. In those
//    languages the interface never costs an AI request. A string the pack
//    lacks stays English and is listed in window.__ohI18n.missing, for the
//    next pack.
// 2. CONTENT, what a scenario's author or a player made (scenario and game
//    names and descriptions, polities and their roles, a scenario's own
//    events, custom stats, region names, country names the pack lacks,
//    Community posts), is translated by the configured AI model, in as few
//    requests as possible, and saved to the server's language pack so each
//    string is paid for once. Nobody pressed a button for these: they are
//    background requests, sent only while Background AI allows
//    (AI/requestBudget.js). Region names go only once they are shown.
// 3. What the AI writes during play (events, chats, the advisor) arrives in
//    the player's language already (languageDirective) and is left alone.
//
// A language without a shipped pack still works the old way: there the
// interface goes through the AI as well, a batch at a time, and is saved to
// the server's pack like content.
//
// What is sent, and what of the answer is kept, is decided in
// translationRules.js, which the tests call directly.

import { BACKGROUND_REQUEST, backgroundAiAllowance } from "../Game/AI/requestBudget.js";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  getStoredLanguage,
  hasShippedPack,
  isRtlLanguage,
  languageDisplayName,
  syncLanguageFromServer,
} from "./i18n.js";
import { createDateLocalizer } from "./localDates.js";
import { createPhraseBook, fillSlots } from "./phraseBook.js";
import { loadPromptTranslations } from "./promptTranslations.js";
import {
  BATCH_MAX_STRINGS,
  BATCH_MIN_STRINGS,
  authoredEventText,
  chooseTranslationBatch,
  collectContentText,
  isNumericDate,
  isTranslatable,
  readTranslationReply,
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
const MAX_CONSECUTIVE_FAILURES = 3;
// A run of failures pauses translation for a minute; the second run in a
// session stops it until the game is reloaded, and the pill says so. Before,
// the next DOM change restarted the cycle with the same strings, for as long
// as the game was open.
const MAX_COOLDOWNS = 2;
const COOLDOWN_MS = 60000;
const NOTICE_MS = 12000;
const TRANSLATED_ATTRIBUTES = ["placeholder", "title", "aria-label", "aria-description", "alt"];

// Elements whose text is user-authored, machine-formatted, or must stay
// verbatim. [data-no-translate] lets any component opt out explicitly.
// (<select> is NOT skipped — dropdown options are UI text too; the language
// picker itself opts out via data-no-translate.)
const SKIP_SELECTOR = "script, style, noscript, input, textarea, [contenteditable], [data-no-translate]";
// An input's own placeholder and title are interface text all the same.
const ATTRIBUTE_SKIP_SELECTOR = "script, style, noscript, [contenteditable], [data-no-translate]";

// The progress pill's text: a pattern in the packs like any other string.
const PROGRESS_TEXT = {
  label: "Translating to {{language}}…",
  paused: "Translation paused — check your AI model in Settings → AI",
};

let language = DEFAULT_LANGUAGE;
// A shipped pack covers the interface: only content goes to the AI.
let packed = false;
// Everything known: the server's pack (shipped + saved), over what this device
// translated itself; and the game's dates, written the player's way
// (localDates.js). Made for the language in startTranslator.
let book = createPhraseBook();
// Translations the AI made on this device, kept until the server has them.
let learned = new Map();
let pending = new Set();
// The queued strings that are content only (queueContent): sent as background
// requests while Background AI allows. Anything else in `pending` is the
// interface of a language without a pack.
const contentQueued = new Set();
// The map's region names, not queued up front (a few thousand of them on the
// built-in map): one goes to the AI once it is shown (routeUnknownText).
let regionNames = new Set();
// Strings the model answered with an empty or non-text entry: not kept, and
// not asked about again this session.
const unusable = new Set();
const missing = new Set();
let inFlight = false;
let stopped = false;
let cooldownUntil = 0;
let failureCount = 0;
let cooldownCount = 0;
// Set by repeated failures (MAX_COOLDOWNS): nothing more is sent this session.
let halted = false;
// Content is waiting on Background AI: the pill is not shown for it.
let heldBack = false;
let noticeTimer = null;
let observer = null;
let scanTimer = null;
let persistTimer = null;
let progressEl = null;
let unsyncedEntries = {};
let syncTimer = null;
let updatedEventTimer = null;
let translatorActive = false;

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
// every device — and every future session — reuses them instead of paying
// for the same AI call again. The pack lives under server/data, which the
// update script never touches.
const syncEntriesToServer = () => {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    const entries = unsyncedEntries;
    unsyncedEntries = {};
    if (Object.keys(entries).length === 0) return;
    try {
      await fetch(`/api/lang/${language}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
    } catch {
      // Old server / offline: localStorage still has them for this device.
    }
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

const persistCache = () => {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const entries = Array.from(learned.entries()).slice(-CACHE_LIMIT);
      localStorage.setItem(cacheKey(), JSON.stringify(Object.fromEntries(entries)));
    } catch {
      // Storage full/blocked: translations still work for this session.
    }
  }, 1500);
};

// ---- progress pill (plain DOM — must exist before/outside React) ----

const showProgress = () => {
  if (progressEl || typeof document === "undefined" || !document.body) return;
  progressEl = document.createElement("div");
  progressEl.setAttribute("data-no-translate", "");
  progressEl.style.cssText =
    "position:fixed;bottom:5.2rem;left:50%;transform:translateX(-50%);z-index:10075;" +
    "background:rgba(24,24,27,0.96);border:1px solid rgba(255,255,255,0.25);border-radius:999px;" +
    "color:#fff;font-family:sans-serif;font-size:0.8rem;font-weight:600;padding:0.45rem 0.95rem;" +
    "box-shadow:0 6px 24px rgba(0,0,0,0.5);pointer-events:none;";
  document.body.appendChild(progressEl);
};

const updateProgress = () => {
  if (!progressEl || halted) return;
  if (pending.size === 0 || heldBack) {
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
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    progressEl?.remove();
    progressEl = null;
  }, NOTICE_MS);
};

// ---- lookups ----

// A rendered string the book has nothing for (translationRules.js
// routeUnknownText). With a shipped pack the interface stays English and is
// listed for the next pack; without one it goes to the AI. A region name is
// content either way.
const noteUnknown = (trimmed) => {
  if (unusable.has(trimmed)) return;
  const route = routeUnknownText(trimmed, { packed, isContent: (text) => regionNames.has(text) });
  if (route === "content") {
    queueContent(trimmed);
  } else if (route === "missing") {
    if (missing.size < MISSING_LIMIT) missing.add(trimmed);
  } else {
    // Needed by the interface now, whatever queued it first.
    contentQueued.delete(trimmed);
    pending.add(trimmed);
  }
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

const textIsSkipped = (node) => !node.parentElement || Boolean(node.parentElement.closest(SKIP_SELECTOR));
const attributesAreSkipped = (element) => Boolean(element.closest(ATTRIBUTE_SKIP_SELECTOR));
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

// Mutations apply what is known SYNCHRONOUSLY (no debounce, no AI wait) so new
// panels open translated instead of flashing English; only new content waits
// for the debounced scan and the AI round-trip.
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

// ---- translation calls ----

// `kind` (translationRules.js chooseTranslationBatch): "interface" or
// "content". Either way nobody pressed a button for it, so it is counted as a
// background request.
const translateBatch = async (strings, kind) => {
  // Late import: translator boots at app start, before the AI module's
  // dependency chain (prompt packs, provider config) needs to exist.
  const { callAI } = await import("../Game/AI/main.jsx");
  const name = languageDisplayName(language);

  const systemPrompt =
    `You are the translation engine for a grand-strategy game. ` +
    (packed
      ? `The strings are the game's content: names of countries, polities and places, scenario and saved-game names and descriptions, custom statistics, community posts. `
      : `The strings are its interface and its content. `) +
    `Translate each English string in the user's JSON array into ${name} (${language}).\n` +
    `Rules:\n` +
    `- Answer with ONLY a JSON array of ${strings.length} strings: the translations, same order, same length.\n` +
    `- Keep numbers, dates' meaning, emoji, punctuation style, and placeholders such as \${...} intact.\n` +
    `- Country, region, and place names take their standard ${name} forms when they exist; otherwise keep them unchanged.\n` +
    `- If a string is already in ${name} or is a proper name/code with no translation, return it unchanged.\n` +
    `- Never add commentary, keys, or markdown.`;

  // Named, so the request count (AI/requestBudget.js) can say what these were:
  // a first pass over a new language is requests nobody pressed a button for,
  // and "Used today, by task" is where a player finds that out.
  return callAI(systemPrompt, [
    { role: "user", parts: [{ text: JSON.stringify(strings) }] },
  ], {
    languageMode: "none",
    logLabel: kind === "content" ? "content translation" : "interface translation",
    taskKey: "translation",
    requestKind: BACKGROUND_REQUEST,
  });
};

// Shrinks on failure, recovers on success (see BATCH_MIN_STRINGS).
let batchStrings = BATCH_MAX_STRINGS;

// Background AI's say (the switch, its daily cap, the reserve), asked before
// each batch of content. The interface of a language without a pack is not
// held back by it: without it that language cannot be read at all.
const contentAllowed = () => {
  try {
    return backgroundAiAllowance().allowed;
  } catch {
    return false;
  }
};

// Done with: translated, or given up on for this session.
const settle = (source) => {
  pending.delete(source);
  contentQueued.delete(source);
};

// A run of failures pauses for a minute; the MAX_COOLDOWNS-th run stops
// translation for the session and says so in the pill.
const noteFailure = (error) => {
  failureCount += 1;
  if (failureCount < MAX_CONSECUTIVE_FAILURES) return;
  failureCount = 0;
  cooldownCount += 1;
  if (cooldownCount >= MAX_COOLDOWNS) {
    halted = true;
    console.warn(
      `[i18n] translation stopped for this session after repeated failures (${error?.message || "unknown"}). ` +
      `Untranslated text stays in English; check the AI provider settings and reload to try again.`,
    );
    showNotice(PROGRESS_TEXT.paused);
    return;
  }
  cooldownUntil = Date.now() + COOLDOWN_MS;
  console.warn(
    `[i18n] translation paused for 60s after repeated failures (${error?.message || "unknown"}). ` +
    `Check the AI provider settings; untranslated text stays in English meanwhile.`,
  );
  if (progressEl) {
    progressEl.remove();
    progressEl = null;
  }
};

const processQueue = async () => {
  if (inFlight || stopped || halted || pending.size === 0 || Date.now() < cooldownUntil) {
    return;
  }

  inFlight = true;
  try {
    while (pending.size > 0 && !stopped && !halted && Date.now() >= cooldownUntil) {
      // ONE request at a time: a big batch in flight on its own, rather than
      // three racing each other into a per-minute rate limit.
      const next = chooseTranslationBatch(pending, {
        isContent: (text) => contentQueued.has(text),
        contentAllowed,
        maxStrings: batchStrings,
      });
      // Only content is left and Background AI says no: it waits, in English.
      heldBack = !next;
      if (!next) break;
      const batch = next.strings;
      const result = await translateBatch(batch, next.kind)
        .then((raw) => ({ reply: readTranslationReply(raw, batch) }))
        .catch((error) => ({ error }));
      if (result.error) {
        if (result.error.misaligned) {
          // Paired by position, so none of it is kept. Asked again in halves;
          // a single string the model cannot answer as one is given up on.
          if (batch.length === 1) {
            unusable.add(batch[0]);
            settle(batch[0]);
          }
          batchStrings = Math.max(1, Math.floor(Math.min(batchStrings, batch.length) / 2));
        } else {
          batchStrings = Math.max(BATCH_MIN_STRINGS, Math.floor(batchStrings / 2));
        }
        noteFailure(result.error);
      } else {
        if (batchStrings < BATCH_MAX_STRINGS) batchStrings = BATCH_MAX_STRINGS;
        failureCount = 0;
        for (const [source, value] of result.reply.pairs) {
          book.set(source, value);
          learned.set(source, value);
          unsyncedEntries[source] = value;
          settle(source);
        }
        // Never saved as their own translation: left in English, not asked again.
        for (const source of result.reply.unusable) {
          unusable.add(source);
          settle(source);
        }
      }

      updateProgress();
      persistCache();
      syncEntriesToServer();
      announceUpdate();
      // Apply what we just learned (and pick up anything rendered meanwhile).
      scan();
    }
  } finally {
    inFlight = false;
    updateProgress();
  }
};

// ---- content ----

// A content string for the AI: once, and only when nothing has it yet.
const queueContent = (value) => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || !isTranslatable(trimmed) || book.has(trimmed) || pending.has(trimmed) || unusable.has(trimmed)) return false;
  pending.add(trimmed);
  contentQueued.add(trimmed);
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
  // 4,848 on the built-in map, twenty-odd requests if all were sent up front,
  // most of them for names the player never looks at. So they are only
  // remembered here, and each goes to the AI once it is shown (noteUnknown).
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
  await collectContentStrings();
  if (stopped) return;
  if (pending.size > 10 && !halted) {
    showProgress();
    updateProgress();
  }
  void processQueue();
};

// ---- public lookups (map labels, proactive callers) ----

// Synchronous best-effort translation for text drawn OUTSIDE the DOM (map
// country labels): names, so content. Unknown ones are queued, and an
// "i18n:updated" event fires once they resolve, so callers can rebuild.
export const translateLabel = (text) => {
  if (!translatorActive || typeof text !== "string") {
    return text;
  }
  const translated = book.get(text);
  if (translated) {
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
// the server's pack has learned; never sent to the AI: without an entry it
// is the English.
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
      startInLanguage(getStoredLanguage());
    }
  });

  startInLanguage(getStoredLanguage());
};

const startInLanguage = (code) => {
  language = code;
  if (language === DEFAULT_LANGUAGE) {
    return;
  }
  packed = hasShippedPack(language);
  book = createPhraseBook({ localizeValue: createDateLocalizer(language) });
  // The prompts' guidance passages in this language, before any prompt is built.
  if (packed) void loadPromptTranslations(language);
  // For bug reports and tests: what is queued for the AI, what the pack lacks,
  // and a way to walk the page again.
  window.__ohI18n = { language, packed, pending, missing, unusable, rescan: () => scan() };

  document.documentElement.lang = language;
  if (isRtlLanguage(language)) {
    // Text direction only — flipping the whole HUD layout would fight the
    // fixed-position map UI, so panels stay put but text reads correctly.
    document.body.style.direction = "rtl";
  }

  loadCache();

  void (async () => {
    // Server pack first (cheap, instant), then wait out the loading screen.
    await loadServerPack();
    await whenStartupScreenGone();
    if (stopped) return;

    translatorActive = true;
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

    // Content, translated once: on later boots the server pack already has it
    // and this drains without a request. A switch to another save brings its
    // scenario's content.
    window.addEventListener("oh:active-game-changed", () => {
      void collectAndTranslate();
    });
    await collectAndTranslate();
  })();
};

export const stopTranslator = () => {
  stopped = true;
  translatorActive = false;
  observer?.disconnect();
  clearTimeout(scanTimer);
  clearTimeout(noticeTimer);
  progressEl?.remove();
  progressEl = null;
};
