/*! Open Historia — the scenario in play reads in its own language pack © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// While a scenario is in play and the player's interface language is one it
// has a pack for (server/scenarioLanguages.js), that pack is fetched from the
// library, once per scenario and language, and handed to the translator
// (translator.js setScenarioLanguagePack), which looks the scenario's strings
// up in it before anything else. No AI request: the pack is a file the
// scenario carries. Nothing happens in English or for a scenario without one.

import { useEffect, useState } from "react";
import { DEFAULT_LANGUAGE, getStoredLanguage } from "./i18n.js";
import { setScenarioLanguagePack } from "./translator.js";
import { fetchScenarioLanguagePack } from "./scenarioLanguagePacks.js";

// The interface language, following a switch made where the player is.
const useInterfaceLanguage = () => {
  const [language, setLanguage] = useState(getStoredLanguage);
  useEffect(() => {
    const changed = (event) => setLanguage(event?.detail?.language || getStoredLanguage());
    window.addEventListener("oh:ui-language-changed", changed);
    return () => window.removeEventListener("oh:ui-language-changed", changed);
  }, []);
  return language;
};

// `scenario` is the library's entry for the scenario in play (its
// `languageCodes` say which packs it has), or null.
export const useScenarioLanguagePack = (scenario) => {
  const language = useInterfaceLanguage();
  const id = scenario?.id || "";
  const has = Array.isArray(scenario?.languageCodes) && scenario.languageCodes.includes(language);
  // A save of the scenario changes its updatedAt: its pack may have changed too.
  const version = has ? `${id}:${language}:${scenario?.updatedAt || ""}` : "";
  useEffect(() => {
    if (!version || language === DEFAULT_LANGUAGE) {
      setScenarioLanguagePack("", {});
      return undefined;
    }
    let current = true;
    void fetchScenarioLanguagePack(id, language).then((strings) => {
      if (current) setScenarioLanguagePack(language, strings);
    });
    return () => { current = false; };
  }, [version, id, language]);
};
