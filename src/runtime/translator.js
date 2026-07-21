/*! Open Historia — AI-powered UI translator (pre-translating) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Translates the game into the player's language using whatever AI provider
// is configured. Two layers:
//
// 1. A one-time PRE-TRANSLATION pass per language: on boot (and after
//    switching languages) every string the game can show — the rendered DOM,
//    scenario/game catalogs, country and polity names, region names, events,
//    difficulty labels, Community-hub posts — is translated up front, with a
//    progress pill, and cached in localStorage. After the pass, menus and
//    tabs open already-translated: cached strings are applied synchronously
//    as elements appear, so there is no English flash.
// 2. A MutationObserver keeps applying the cache to new DOM and quietly
//    translates the few strings the pre-pass couldn't know (AI replies
//    already arrive in-language via languageDirective, so this is rare).

import {
  DEFAULT_LANGUAGE,
  getStoredLanguage,
  isRtlLanguage,
  languageDisplayName,
  syncLanguageFromServer,
} from "./i18n.js";

const CACHE_PREFIX = "i18n_cache_";
const CACHE_LIMIT = 8000;
const BATCH_SIZE = 60;
const MAX_CONCURRENT_BATCHES = 3;
const SCAN_DEBOUNCE_MS = 350;
const MAX_CONSECUTIVE_FAILURES = 3;
const TRANSLATED_ATTRIBUTES = ["placeholder", "title", "aria-label"];

// Elements whose text is user-authored, machine-formatted, or must stay
// verbatim. [data-no-translate] lets any component opt out explicitly.
// (<select> is NOT skipped — dropdown options are UI text too; the language
// picker itself opts out via data-no-translate.)
const SKIP_SELECTOR = "script, style, noscript, input, textarea, [contenteditable], [data-no-translate]";

let language = DEFAULT_LANGUAGE;
let cache = new Map();
let pending = new Set();
let inFlight = false;
let stopped = false;
let cooldownUntil = 0;
let failureCount = 0;
let observer = null;
let scanTimer = null;
let persistTimer = null;
let progressEl = null;
let unsyncedEntries = {};
let syncTimer = null;
let updatedEventTimer = null;
// node → the source (English) string we last saw there, so re-renders that
// restore English are re-translated and our own writes are recognized.
const nodeSources = new WeakMap();

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

const loadCache = () => {
  try {
    const raw = localStorage.getItem(cacheKey());
    cache = new Map(Object.entries(raw ? JSON.parse(raw) : {}));
  } catch {
    cache = new Map();
  }
};

const persistCache = () => {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const entries = Array.from(cache.entries()).slice(-CACHE_LIMIT);
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
    "background:rgba(17,24,39,0.96);border:1px solid rgba(139,92,246,0.5);border-radius:999px;" +
    "color:#fff;font-family:sans-serif;font-size:0.8rem;font-weight:600;padding:0.45rem 0.95rem;" +
    "box-shadow:0 6px 24px rgba(0,0,0,0.5);pointer-events:none;";
  document.body.appendChild(progressEl);
};

const updateProgress = () => {
  if (!progressEl) return;
  if (pending.size === 0) {
    progressEl.remove();
    progressEl = null;
    return;
  }
  progressEl.textContent = `Translating to ${languageDisplayName(language)}…`;
};

// ---- string filters & application ----

// Only strings with real words need translating; glyphs, numbers, dates-only
// fragments and emoji stay as-is. The authored language is English, so
// requiring two Latin letters is a safe "has words" test.
const isTranslatable = (text) => {
  const trimmed = text.trim();
  return trimmed.length > 1 && trimmed.length < 3000 && /[A-Za-z]{2}/.test(trimmed);
};

const applyToTextNode = (node, translated) => {
  const leading = node.nodeValue.match(/^\s*/)[0];
  const trailing = node.nodeValue.match(/\s*$/)[0];
  node.nodeValue = leading + translated + trailing;
};

const visitTextNode = (node) => {
  const value = node.nodeValue ?? "";
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }

  const known = nodeSources.get(node);
  // Our own write, or a source we already queued — nothing new to do
  // (translated values usually fail isTranslatable's English test anyway,
  // but Latin-script languages need the exact-match check).
  if (known && (trimmed === (cache.get(known.source) ?? "").trim() || trimmed === known.source)) {
    if (trimmed === known.source) {
      const translated = cache.get(known.source);
      if (translated && translated !== known.source) {
        applyToTextNode(node, translated);
      }
    }
    return;
  }

  if (!isTranslatable(trimmed)) {
    return;
  }

  nodeSources.set(node, { source: trimmed });
  const translated = cache.get(trimmed);
  if (translated) {
    if (translated !== trimmed) {
      applyToTextNode(node, translated);
    }
  } else {
    pending.add(trimmed);
  }
};

const visitElementAttributes = (element) => {
  for (const attr of TRANSLATED_ATTRIBUTES) {
    const value = element.getAttribute(attr);
    if (!value || !isTranslatable(value)) {
      continue;
    }

    const translated = cache.get(value.trim());
    if (translated) {
      if (translated !== value.trim()) {
        element.setAttribute(attr, translated);
      }
    } else {
      pending.add(value.trim());
    }
  }
};

const skippedByAncestors = (element) =>
  Boolean(element && element.closest(SKIP_SELECTOR) && !element.matches("input, textarea"));

const walkSubtree = (root) => {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    if (root.parentElement && !root.parentElement.closest(SKIP_SELECTOR)) {
      visitTextNode(root);
    }
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement && !node.parentElement.closest(SKIP_SELECTOR)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    visitTextNode(node);
  }

  const attrSelector = TRANSLATED_ATTRIBUTES.map((attr) => `[${attr}]`).join(",");
  const withAttrs = root.matches?.(attrSelector) ? [root] : [];
  for (const element of [...withAttrs, ...(root.querySelectorAll?.(attrSelector) ?? [])]) {
    if (!skippedByAncestors(element) || element.matches("input, textarea")) {
      if (!element.closest("[data-no-translate]")) {
        visitElementAttributes(element);
      }
    }
  }
};

const scan = () => {
  if (stopped || !document.body) {
    return;
  }

  walkSubtree(document.body);

  const title = document.title.trim();
  if (title && isTranslatable(title)) {
    const translatedTitle = cache.get(title);
    if (translatedTitle && translatedTitle !== title) {
      document.title = translatedTitle;
    } else if (!translatedTitle) {
      pending.add(title);
    }
  }

  void processQueue();
};

const scheduleScan = () => {
  if (stopped) {
    return;
  }

  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, SCAN_DEBOUNCE_MS);
};

// Mutations apply the cache SYNCHRONOUSLY (no debounce, no AI wait) so new
// panels open translated instead of flashing English; only genuinely new
// strings wait for the debounced scan + AI round-trip.
const handleMutations = (mutations) => {
  if (stopped) return;
  for (const mutation of mutations) {
    if (mutation.type === "characterData") {
      const parent = mutation.target.parentElement;
      if (parent && !parent.closest(SKIP_SELECTOR)) {
        visitTextNode(mutation.target);
      }
    } else {
      for (const added of mutation.addedNodes) {
        walkSubtree(added);
      }
    }
  }
  scheduleScan();
};

// ---- translation calls ----

const extractJsonArray = (raw) => {
  const text = String(raw ?? "").replace(/```(?:json)?/gi, "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const translateBatch = async (strings) => {
  // Late import: translator boots at app start, before the AI module's
  // dependency chain (prompt packs, provider config) needs to exist.
  const { callAI } = await import("../Game/AI/main.jsx");
  const name = languageDisplayName(language);

  const systemPrompt =
    `You are the translation engine for a grand-strategy game's interface. ` +
    `Translate each English string in the user's JSON array into ${name} (${language}).\n` +
    `Rules:\n` +
    `- Answer with ONLY a JSON array of ${strings.length} strings: the translations, same order, same length.\n` +
    `- Keep numbers, dates' meaning, emoji, punctuation style, and placeholders such as \${...} intact.\n` +
    `- Country, region, and place names take their standard ${name} forms when they exist; otherwise keep them unchanged.\n` +
    `- If a string is already in ${name} or is a proper name/code with no translation, return it unchanged.\n` +
    `- Never add commentary, keys, or markdown.`;

  const raw = await callAI(systemPrompt, [
    { role: "user", parts: [{ text: JSON.stringify(strings) }] },
  ], { languageMode: "none" });
  const translations = extractJsonArray(raw);

  if (!translations) {
    throw new Error("translation response was not a JSON array");
  }

  return translations;
};

const processQueue = async () => {
  if (inFlight || stopped || pending.size === 0 || Date.now() < cooldownUntil) {
    return;
  }

  inFlight = true;
  try {
    while (pending.size > 0 && !stopped && Date.now() >= cooldownUntil) {
      const slice = Array.from(pending).slice(0, BATCH_SIZE * MAX_CONCURRENT_BATCHES);
      const batches = [];
      for (let index = 0; index < slice.length; index += BATCH_SIZE) {
        batches.push(slice.slice(index, index + BATCH_SIZE));
      }

      const results = await Promise.all(
        batches.map((batch) =>
          translateBatch(batch)
            .then((translations) => ({ batch, translations }))
            .catch((error) => ({ batch, error })),
        ),
      );

      let failures = 0;
      for (const result of results) {
        if (result.error) {
          failures += 1;
          continue;
        }
        result.batch.forEach((source, index) => {
          const translated = typeof result.translations[index] === "string"
            ? result.translations[index].trim()
            : "";
          cache.set(source, translated || source);
          unsyncedEntries[source] = translated || source;
          pending.delete(source);
        });
      }

      if (failures === results.length) {
        failureCount += 1;
        if (failureCount >= MAX_CONSECUTIVE_FAILURES) {
          // Back off instead of giving up for the session: a provider hiccup
          // shouldn't leave the rest of the UI untranslated forever.
          failureCount = 0;
          cooldownUntil = Date.now() + 60000;
          console.warn(
            `[i18n] translation paused for 60s after repeated failures (${results[0]?.error?.message || "unknown"}). ` +
            `Check the AI provider settings; untranslated text stays in English meanwhile.`,
          );
          if (progressEl) {
            progressEl.remove();
            progressEl = null;
          }
        }
      } else {
        failureCount = 0;
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

// ---- pre-translation catalog ----

// Everything the game COULD show, gathered up front so switching languages
// translates once instead of drip-translating panels as they open.
const collectCatalogStrings = async () => {
  const add = (value) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed && isTranslatable(trimmed) && !cache.has(trimmed)) {
      pending.add(trimmed);
    }
  };
  const addCatalogEntry = (entry) => {
    for (const key of ["name", "subtitle", "description", "eyebrow", "heroTitle", "heroSubtitle"]) {
      add(entry?.[key]);
    }
  };

  // Scenario + game cards.
  for (const url of ["/api/scenarios", "/api/games"]) {
    try {
      const data = await (await fetch(url)).json();
      const list = Array.isArray(data) ? data : data.scenarios ?? data.games ?? [];
      list.forEach(addCatalogEntry);
    } catch {
      // Endpoint unreachable — those strings translate live instead.
    }
  }

  // Country names, era polities + aliases, events.
  try {
    const { JSON_URLS, loadCountryNames, readJson } = await import("./assets.js");
    (await loadCountryNames().catch(() => [])).forEach((country) => add(country?.name));
    const world = await readJson(JSON_URLS.world, { defaultValue: {} });
    for (const polity of Object.values(world?.polityOverrides ?? {})) {
      add(polity?.name);
      (polity?.aliases ?? []).forEach(add);
    }
    const events = await readJson(JSON_URLS.events, { defaultValue: [] });
    for (const event of Array.isArray(events) ? events : []) {
      add(event?.title);
      add(event?.description);
    }
  } catch {
    // Runtime assets unavailable (editor-only page etc.) — skip.
  }

  // Difficulty labels.
  try {
    const { DIFFICULTY_LEVELS } = await import("./difficulty.js");
    for (const level of DIFFICULTY_LEVELS) {
      add(level.label);
      add(level.blurb);
    }
  } catch { /* optional */ }

  // Community-hub posts (titles + descriptions), so the tab opens translated.
  try {
    const { fetchHubPosts } = await import("../Game/GameUI/communityHub.jsx");
    for (const post of await fetchHubPosts().catch(() => [])) {
      add(post?.title);
      add(post?.description);
    }
  } catch { /* hub unreachable — translate live when opened */ }

  // Region names — the big set (tags, owned-region pills, event impacts).
  // Queued last so the visible UI translates first.
  try {
    const { loadRegionCatalog } = await import("./assets.js");
    (await loadRegionCatalog().catch(() => [])).forEach((region) => add(region?.name));
  } catch { /* optional */ }
};

// ---- public lookups (map labels, proactive callers) ----

let translatorActive = false;

// Synchronous best-effort translation for text drawn OUTSIDE the DOM (map
// country labels). Unknown strings are queued and an "i18n:updated" event
// fires once they resolve, so callers can rebuild.
export const translateLabel = (text) => {
  if (!translatorActive || typeof text !== "string") {
    return text;
  }
  const trimmed = text.trim();
  const translated = cache.get(trimmed);
  if (translated) {
    return translated;
  }
  if (isTranslatable(trimmed)) {
    pending.add(trimmed);
    scheduleScan();
  }
  return text;
};

// Proactively queue strings that exist as data but may not be rendered yet
// (e.g. freshly fetched Community-hub posts). Only uncached ones cost a call.
export const enqueueStrings = (strings) => {
  if (!translatorActive) return;
  let added = false;
  for (const value of strings ?? []) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed && isTranslatable(trimmed) && !cache.has(trimmed)) {
      pending.add(trimmed);
      added = true;
    }
  }
  if (added) {
    void processQueue();
  }
};

// Human-readable fields inside written game content. When the player edits a
// description (or the AI writes new events/polities), these are pulled out
// and translated right away — and land in the server pack — instead of
// waiting to be rendered somewhere first.
const CONTENT_TEXT_KEYS = new Set([
  "name", "title", "subtitle", "description", "eyebrow", "heroTitle",
  "heroSubtitle", "summary", "blurb", "note", "label",
]);

export const enqueueContentStrings = (payload) => {
  if (!translatorActive || !payload) return;
  const found = [];
  const walk = (value, depth) => {
    if (depth > 6 || value == null) return;
    if (Array.isArray(value)) {
      if (value.length <= 500) value.forEach((entry) => walk(entry, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      // Geometry payloads can be enormous and contain no UI text.
      if (key === "features" || key === "geometry" || key === "coordinates") continue;
      if (typeof entry === "string") {
        if (CONTENT_TEXT_KEYS.has(key)) found.push(entry);
      } else if (key === "aliases" && Array.isArray(entry)) {
        entry.forEach((alias) => typeof alias === "string" && found.push(alias));
      } else {
        walk(entry, depth + 1);
      }
    }
  };
  walk(payload, 0);
  enqueueStrings(found);
};

// ---- lifecycle ----

// Merge the server's language pack (shipped top-10 packs + every translation
// any device has generated) into the local cache.
const loadServerPack = async () => {
  try {
    const response = await fetch(`/api/lang/${language}`);
    if (!response.ok) return;
    const pack = await response.json();
    for (const [source, translated] of Object.entries(pack ?? {})) {
      if (typeof source === "string" && typeof translated === "string" && !cache.has(source)) {
        cache.set(source, translated);
      }
    }
    persistCache();
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
      setTimeout(check, 400);
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
    }
  });

  language = getStoredLanguage();
  if (language === DEFAULT_LANGUAGE) {
    return;
  }

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
      childList: true,
      characterData: true,
      subtree: true,
    });
    scan();
    announceUpdate();

    // One-time pre-translation of everything the game can show. On later
    // boots the pack + cache already cover it and this drains instantly.
    await collectCatalogStrings();
    if (pending.size > 10) {
      showProgress();
      updateProgress();
    }
    void processQueue();
  })();
};

export const stopTranslator = () => {
  stopped = true;
  observer?.disconnect();
  clearTimeout(scanTimer);
  progressEl?.remove();
  progressEl = null;
};
