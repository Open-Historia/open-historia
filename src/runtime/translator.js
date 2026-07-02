/*! Pax Historia — AI-powered live UI translator © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Translates the rendered DOM into the player's language using whatever AI
// provider the game is already configured with. This is deliberately a
// DOM-level translator rather than a string-catalog i18n system: the UI,
// scenario names/descriptions, AI-generated events — everything that reaches
// the screen — flows through here, with no per-component wiring and no
// 200-language catalog to maintain. Translations are cached per language in
// localStorage, so each string costs one AI call ever.
//
// AI chat/turn replies are additionally requested in-language at the source
// (see languageDirective in i18n.js) — native answers read better than
// post-translation; this module then leaves them untouched because the
// model returns already-target-language strings unchanged.

import {
  DEFAULT_LANGUAGE,
  getStoredLanguage,
  isRtlLanguage,
  languageDisplayName,
} from "./i18n.js";

const CACHE_PREFIX = "i18n_cache_";
const CACHE_LIMIT = 6000;
const BATCH_SIZE = 60;
const SCAN_DEBOUNCE_MS = 350;
const MAX_CONSECUTIVE_FAILURES = 3;
const TRANSLATED_ATTRIBUTES = ["placeholder", "title", "aria-label"];

// Elements whose text is user-authored, machine-formatted, or must stay
// verbatim. [data-no-translate] lets any component opt out explicitly.
const SKIP_SELECTOR = "script, style, noscript, input, textarea, select, [contenteditable], [data-no-translate]";

let language = DEFAULT_LANGUAGE;
let cache = new Map();
let pending = new Set();
let inFlight = false;
let stopped = false;
let failureCount = 0;
let observer = null;
let scanTimer = null;
let persistTimer = null;
// node → the source (English) string we last saw there, so re-renders that
// restore English are re-translated and our own writes are recognized.
const nodeSources = new WeakMap();

const cacheKey = () => `${CACHE_PREFIX}${language}`;

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

const scan = () => {
  if (stopped || !document.body) {
    return;
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement && !node.parentElement.closest(SKIP_SELECTOR)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    visitTextNode(node);
  }

  const attrSelector = TRANSLATED_ATTRIBUTES.map((attr) => `[${attr}]`).join(",");
  for (const element of document.body.querySelectorAll(attrSelector)) {
    if (!element.closest(SKIP_SELECTOR) || element.matches("input, textarea")) {
      // Inputs keep user-typed values verbatim but their placeholders are UI text.
      if (!element.closest("[data-no-translate]")) {
        visitElementAttributes(element);
      }
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
    `- Country, ruler, and place names take their standard ${name} forms when they exist; otherwise keep them unchanged.\n` +
    `- If a string is already in ${name} or is a proper name/code with no translation, return it unchanged.\n` +
    `- Never add commentary, keys, or markdown.`;

  const raw = await callAI(systemPrompt, [
    { role: "user", parts: [{ text: JSON.stringify(strings) }] },
  ]);
  const translations = extractJsonArray(raw);

  if (!translations) {
    throw new Error("translation response was not a JSON array");
  }

  return translations;
};

const processQueue = async () => {
  if (inFlight || stopped || pending.size === 0) {
    return;
  }

  inFlight = true;
  try {
    while (pending.size > 0 && !stopped) {
      const batch = Array.from(pending).slice(0, BATCH_SIZE);
      let translations;
      try {
        translations = await translateBatch(batch);
        failureCount = 0;
      } catch (error) {
        failureCount += 1;
        if (failureCount >= MAX_CONSECUTIVE_FAILURES) {
          stopped = true;
          console.warn(
            `[i18n] translation stopped after ${failureCount} failed attempts (${error?.message || error}). ` +
            `Check the AI provider settings; the game continues in English.`,
          );
        }
        return;
      }

      for (let index = 0; index < batch.length; index += 1) {
        const translated = typeof translations[index] === "string" ? translations[index].trim() : "";
        cache.set(batch[index], translated || batch[index]);
        pending.delete(batch[index]);
      }

      persistCache();
      // Apply what we just learned (and pick up anything rendered meanwhile).
      scan();
    }
  } finally {
    inFlight = false;
  }
};

export const startTranslator = () => {
  language = getStoredLanguage();
  if (language === DEFAULT_LANGUAGE || typeof document === "undefined") {
    return;
  }

  document.documentElement.lang = language;
  if (isRtlLanguage(language)) {
    // Text direction only — flipping the whole HUD layout would fight the
    // fixed-position map UI, so panels stay put but text reads correctly.
    document.body.style.direction = "rtl";
  }

  loadCache();
  observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  scan();
};

export const stopTranslator = () => {
  stopped = true;
  observer?.disconnect();
  clearTimeout(scanTimer);
};
