/*! Open Historia — the prompts' guidance, in the player's language © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every default prompt is a fixed English template (the placeholders that
// inject the world, the output contracts the game parses, the map rules) with
// passages of guidance inside it: the role, the tone, what makes a good event
// (src/Game/AI/promptGuidance.js). The language packs carry those passages
// translated (public/lang/prompts/<code>.json, keyed by the English passage),
// so a player who reads Spanish gets them in Spanish: in the Prompts tab, where
// an author reads and edits them, and in what the AI receives wherever the
// scenario has not written its own. The template around them stays English,
// because the game parses what it asks for.
//
// Keyed by the English text, not by segment id, so a passage whose wording
// changes simply falls back to English until the packs are regenerated, and a
// branch whose prompts differ finds only the passages it shares.

const listeners = new Set();
let translations = new Map();
let loadedLanguage = "en";
let version = 0;

const announce = () => {
  version += 1;
  listeners.forEach((listener) => {
    try { listener(); } catch { /* a listener's failure is its own */ }
  });
};

// Installs a language's passages directly (tests, and the loader below).
export const setPromptTranslations = (code, entries) => {
  const next = new Map();
  for (const [english, translated] of Object.entries(entries ?? {})) {
    if (typeof english === "string" && typeof translated === "string" && translated.trim()) {
      next.set(english, translated);
    }
  }
  translations = next;
  loadedLanguage = code || "en";
  announce();
};

// Fetches the shipped passages for a language; English, or a language with no
// pack, leaves the English defaults in place. Never throws.
export const loadPromptTranslations = async (code, { fetchImpl = globalThis.fetch } = {}) => {
  if (!code || code === "en" || typeof fetchImpl !== "function") return false;
  if (code === loadedLanguage && translations.size) return true;
  try {
    const base = typeof import.meta !== "undefined" && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : "/";
    const response = await fetchImpl(`${base.replace(/\/?$/, "/")}lang/prompts/${encodeURIComponent(code)}.json`);
    if (!response?.ok) return false;
    setPromptTranslations(code, await response.json());
    return true;
  } catch {
    return false;
  }
};

export const promptTranslationLanguage = () => loadedLanguage;
export const promptTranslationsVersion = () => version;

export const subscribePromptTranslations = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// One passage: its translation, or the English passage itself.
export const translateGuidancePassage = (english) => {
  if (typeof english !== "string" || !translations.size) return english;
  return translations.get(english) ?? english;
};

// A whole guidance-defaults tree ({ advisor, leader, tasks: { key: {...} } },
// segment id → passage), translated passage by passage.
export const localizeGuidanceTree = (tree) => {
  if (!tree || typeof tree !== "object" || !translations.size) return tree;
  const walk = (node) => {
    if (typeof node === "string") return translateGuidancePassage(node);
    if (!node || typeof node !== "object" || Array.isArray(node)) return node;
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, walk(value)]));
  };
  return walk(tree);
};

// An author's guidance edits ({ advisor, leader, tasks }, as normalizePack-
// Guidance returns them) less every passage identical to its default in the
// player's language: the Prompts tab shows that text as the default, and
// storing it would pin one language's wording into a scenario every other
// player also reads.
export const withoutLocalizedDefaults = (guidance, localized) => {
  const keep = (section, defaults) => Object.fromEntries(
    Object.entries(section ?? {}).filter(([id, text]) =>
      typeof defaults?.[id] !== "string" || defaults[id].trim() !== String(text).trim()),
  );
  const tasks = {};
  for (const [key, section] of Object.entries(guidance?.tasks ?? {})) {
    const kept = keep(section, localized?.tasks?.[key]);
    if (Object.keys(kept).length) tasks[key] = kept;
  }
  return {
    advisor: keep(guidance?.advisor, localized?.advisor),
    leader: keep(guidance?.leader, localized?.leader),
    tasks,
  };
};

// What one prompt section is composed from: its defaults in the player's
// language, under the author's own passages (theirs, in whatever language
// they wrote them).
export const localizedPassages = (localizedSection, edits) => ({ ...(localizedSection ?? {}), ...(edits ?? {}) });
