/*! Open Historia — the first-time setup © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Shown once a device, before the vault door: on a new install, and the first
// time a device runs a build that has it (the owner, 2026-11-05: "a first time
// setup where you pick your language and it says the words Hello Welcome
// cycling through different languages and then once you select your language
// the next page is for you to select your theme and then after that it goes
// away and shows you the vault door"). App.jsx mounts it;
// runtime/firstSetupDue.js says whether it is owed.
//
// The language is applied where it is picked (runtime/translator.js
// switchLanguage): one with a translation model asks to download it first, and
// the theme page is then already in that language. Each theme is applied as it
// is picked (runtime/uiTheme.js), and the setup itself is drawn in the theme's
// colours, so the choice is seen at once.

import React, { useEffect, useMemo, useState } from "react";
import { rememberFirstSetup } from "../../runtime/firstSetupDue.js";
import { GREETINGS } from "../../runtime/greetings.js";
import { DEFAULT_LANGUAGE, getStoredLanguage, getUiLanguageOptions, isRtlLanguage } from "../../runtime/i18n.js";
import { reduceMotionEnabled } from "../../runtime/mapSettings.js";
import { switchLanguage } from "../../runtime/translator.js";
import { DEFAULT_UI_THEME, UI_THEME_PRESETS, selectUiTheme, useUiTheme } from "../../runtime/uiTheme.js";
import "./firstSetup.css";

const GREETING_MS = 4400;

// What the Default (Original) card shows: the interface's own greys.
const ORIGINAL_COLORS = { background: "#131315", surface: "#232327", accent: "#D4D4D8" };

const stillWanted = () => {
  let system = false;
  try {
    system = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    system = false;
  }
  return reduceMotionEnabled() || system;
};

const Greeting = ({ still }) => {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (still) return undefined;
    const timer = setInterval(() => setAt((value) => (value + 1) % GREETINGS.length), GREETING_MS);
    return () => clearInterval(timer);
  }, [still]);
  const shown = GREETINGS[at];
  return (
    <div className="oh-setup-greeting" data-no-translate aria-hidden="true">
      <div key={shown.code} className="oh-setup-greeting-words" dir={isRtlLanguage(shown.code) ? "rtl" : "ltr"} lang={shown.code}>
        <span className="oh-setup-hello">{shown.hello}</span>
        <span className="oh-setup-welcome">{shown.welcome}</span>
      </div>
    </div>
  );
};

const Steps = ({ step }) => (
  <div className="oh-setup-steps" aria-hidden="true">
    <span data-on={step === 0 || undefined} />
    <span data-on={step === 1 || undefined} />
  </div>
);

const LanguagePage = ({ onChosen }) => {
  const [current, setCurrent] = useState(getStoredLanguage);
  const [busy, setBusy] = useState("");
  const still = useMemo(() => stillWanted(), []);
  const options = useMemo(() => getUiLanguageOptions(), []);

  const choose = async (code) => {
    if (busy) return;
    setBusy(code);
    try {
      const shown = await switchLanguage(code);
      setCurrent(getStoredLanguage());
      if (shown === code) onChosen();
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="oh-setup-page">
      <Greeting still={still} />
      <h1 className="oh-setup-title">Choose your language</h1>
      <div className="oh-setup-languages" role="group" aria-label="Language">
        {options.map((option) => (
          <button
            key={option.code}
            type="button"
            className="oh-setup-language"
            aria-pressed={current === option.code || (option.code === DEFAULT_LANGUAGE && !current)}
            aria-busy={busy === option.code || undefined}
            disabled={Boolean(busy) && busy !== option.code}
            onClick={() => choose(option.code)}
            lang={option.code}
            data-no-translate
          >
            <span className="oh-setup-language-native" dir={isRtlLanguage(option.code) ? "rtl" : "ltr"}>{option.native}</span>
            {option.native !== option.name && <span className="oh-setup-language-name">{option.name}</span>}
          </button>
        ))}
      </div>
    </div>
  );
};

const ThemeSample = ({ colors }) => (
  <div className="oh-setup-sample" style={{ "--s-bg": colors.background, "--s-surface": colors.surface, "--s-accent": colors.accent }} aria-hidden="true">
    <div className="oh-setup-sample-rail"><span /><span /><span /></div>
    <div className="oh-setup-sample-main">
      <div className="oh-setup-sample-bar" />
      <div className="oh-setup-sample-cards"><span /><span /></div>
      <div className="oh-setup-sample-button" />
    </div>
  </div>
);

const ThemePage = ({ onBack, onDone }) => {
  const theme = useUiTheme();
  const choices = [
    { id: DEFAULT_UI_THEME, name: "Default (Original)", colors: ORIGINAL_COLORS },
    ...UI_THEME_PRESETS.map((preset) => ({ id: preset.id, name: preset.name, colors: preset.colors })),
  ];
  return (
    <div className="oh-setup-page">
      <h1 className="oh-setup-title oh-setup-title-large">Choose your theme</h1>
      <div className="oh-setup-themes" role="group" aria-label="Interface theme">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className="oh-setup-theme"
            aria-pressed={theme.preset === choice.id}
            onClick={() => selectUiTheme(choice.id)}
          >
            <ThemeSample colors={choice.colors} />
            <span className="oh-setup-theme-name">{choice.name}</span>
          </button>
        ))}
      </div>
      <div className="oh-setup-actions">
        <button type="button" className="oh-setup-back" onClick={onBack}>Back</button>
        <button type="button" className="oh-setup-continue" onClick={onDone}>Continue</button>
      </div>
    </div>
  );
};

export default function FirstSetup({ onDone }) {
  const [step, setStep] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const still = useMemo(() => stillWanted(), []);
  const finish = () => {
    rememberFirstSetup();
    if (still) {
      onDone?.();
      return;
    }
    setLeaving(true);
    setTimeout(() => onDone?.(), 320);
  };
  return (
    <div className="oh-setup" data-leaving={leaving || undefined} data-still={still || undefined} role="region" aria-label="First-time setup">
      <div className="oh-setup-body" key={step}>
        {step === 0
          ? <LanguagePage onChosen={() => setStep(1)} />
          : <ThemePage onBack={() => setStep(0)} onDone={finish} />}
      </div>
      <Steps step={step} />
    </div>
  );
}
