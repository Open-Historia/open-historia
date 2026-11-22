/*! Open Historia — the desktop app's own words, in the player's language © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The page is translated by src/runtime/translator.js from the shipped language
// packs (public/lang). What the main process shows by itself never passes
// through the page: the right-click menu, the box when the page stops or the
// app cannot start, an update that failed. That stayed English in every
// language. uiWord() looks it up in the same pack, keyed by the same English
// (scripts/i18n/extractStrings.mjs reads what is handed to it into the
// catalog), in the language the player chose (the server's ui-settings.json,
// which the page writes). `{{name}}` slots are filled from `params`. With no
// choice, no pack or no entry, it is the English.

const fs = require("node:fs");
const path = require("node:path");

const SLOT = /\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}/g;

let config = null;
let cached = { code: "", pack: null };

// `dataDir`: the server's data folder (ui-settings.json); `langDirs`: where the
// shipped packs are, first found wins (the built dist/lang, else public/lang).
const configureUiWords = ({ dataDir, langDirs = [] } = {}) => {
  config = { dataDir, langDirs: langDirs.filter(Boolean) };
  cached = { code: "", pack: null };
};

const fillWords = (text, params = {}) => String(text ?? "").replace(SLOT, (whole, name) => (
  Object.hasOwn(params, name) && params[name] != null ? String(params[name]) : whole
));

const chosenLanguage = () => {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(config.dataDir, "ui-settings.json"), "utf8"));
    return typeof settings?.language === "string" ? settings.language.trim().toLowerCase() : "";
  } catch {
    return "";
  }
};

const packFor = (code) => {
  if (!/^[a-z]{2,3}$/.test(code) || code === "en") return null;
  if (cached.code === code) return cached.pack;
  let pack = null;
  for (const dir of config.langDirs) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        pack = parsed;
        break;
      }
    } catch {
      // Not in this folder: the next one.
    }
  }
  cached = { code, pack };
  return pack;
};

const uiWord = (text, params = {}) => {
  let template = text;
  if (config) {
    const translated = packFor(chosenLanguage())?.[text];
    if (typeof translated === "string" && translated.trim()) template = translated;
  }
  return fillWords(template, params);
};

module.exports = { configureUiWords, fillWords, uiWord };
