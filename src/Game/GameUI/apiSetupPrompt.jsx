import React, { useId, useMemo, useState } from "react";
import { APP_HEIGHT, SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP, useTouchPrimary } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useBackToClose } from "../../runtime/backToClose.js";
import { usePresenceLeaving } from "./presence.jsx";
import {
  COMMANDCODE_KEYS_URL,
  COMMANDCODE_PRICING_URL,
  COMMANDCODE_TEMPLATE,
  GEMINI_DEFAULT_CHAIN,
  OPENAI_DEFAULT_MODEL,
  providerOptionsFor,
  applyQuickAiSetup,
  applyTemplateAiSetup,
  getProviderMeta,
  getRecentModels,
  providerSetupRequirement,
} from "../AI/providerConfig.js";
import { endpointIsLocal } from "../AI/localEndpoint.js";
import { setNoRequestLimit } from "../AI/requestBudget.js";
import { useBrowserOnline } from "../../runtime/networkStatus.js";

// Shown when a game starts and the selected AI provider has nothing to call
// with — no key for a hosted provider, no endpoint for a self-hosted one. The
// game itself runs without it, but every time skip would fall back to canned
// events, and a new player had no way of knowing that until the first jump
// went wrong. Mounted through Presence (GameUI/main.jsx), so it fades in with
// the other surfaces and eases out when answered.
//
// The prompt is the setup, not a pointer to it. "update the popup to configure
// a free Gemini api key to have 3 boxes one with a gemini logo and another with
// an commandcode logo and another with that's custom and has 3 dots on it"
// (the owner, 2026-11-07). It opens on three choices:
//   Gemini        best free option: the tutorial video, a button to Google AI
//                 Studio where the free key is made, and the key;
//   Command Code  best quality option, recommended: its $10 GOAT plan and its
//                 API keys page, then only the key — the address and GLM-5.3
//                 Flash are filled in (providerConfig.js COMMANDCODE_TEMPLATE);
//   Custom        any provider, any model or a local model: provider, key or
//                 endpoint, and model, with full settings one click away.
// Each is saved into the Connections and the Fallback list (providerConfig.js
// applyQuickAiSetup, applyTemplateAiSetup), at the top, and main.jsx closes the
// prompt once the list can answer.
//
// Each also sets Settings → AI → AI requests' one switch, "My key has no request
// limit" (requestBudget.js), without asking: on for Command Code (the GOAT plan
// is a paid key) and for a server on the player's own machine or network
// through Custom (a local model), off for Gemini's free key. The steps show it
// as already set. Any other Custom provider leaves it as it is.

const TUTORIAL_VIDEO_ID = "YdalQ8UqMR4";
const TUTORIAL_VIDEO_URL = `https://www.youtube.com/watch?v=${TUTORIAL_VIDEO_ID}`;
// The privacy-enhanced embed host: no YouTube cookies until the video plays.
// Even so, loading the player tells YouTube who opened this prompt, so the
// frame is only put on the page once the player presses the button that stands
// in its place (TutorialVideo below). It starts playing then: that press was
// the one asking for it.
const TUTORIAL_EMBED_URL = `https://www.youtube-nocookie.com/embed/${TUTORIAL_VIDEO_ID}?rel=0&autoplay=1`;
const AI_STUDIO_KEY_URL = "https://aistudio.google.com/app/apikey";

// The three cards, in the order they are shown.
export const SETUP_CHOICES = Object.freeze(["gemini", "commandcode", "custom"]);

// What the Custom card starts on: a server of the player's own (a local model,
// a gateway); the list holds every other provider.
const CUSTOM_START_PROVIDER = "openai-compatible";
const providerFor = (choice) => (choice === "custom" ? CUSTOM_START_PROVIDER : choice === "commandcode" ? COMMANDCODE_TEMPLATE.provider : "gemini");

const MODEL_PLACEHOLDERS = {
  // Blank keeps the default list: the default model first, its backup behind it.
  gemini: `Blank: ${GEMINI_DEFAULT_CHAIN[0]}, ${GEMINI_DEFAULT_CHAIN[1]} as backup`,
  anthropic: "claude-haiku-4-5",
  "anthropic-compatible": "claude-haiku-4-5",
  openai: `Blank: ${OPENAI_DEFAULT_MODEL}`,
  "openai-compatible": "Blank picks a chat model from the server",
};

const ENDPOINT_PLACEHOLDERS = {
  "openai-compatible": "http://localhost:11434/v1",
  "anthropic-compatible": "https://my-proxy.example/v1",
};

// The providers' own marks, from their own sites, as published: Gemini's
// sparkle (gemini.google.com's icon, scaled to 96 px) and Command Code's
// logomark (its brand page's symbol.svg, unchanged). public/brands/.
const BRAND_BASE = `${import.meta.env?.BASE_URL ?? "/"}brands/`;
const LOGO_SIZE = 40;

const BrandMark = ({ file, size = LOGO_SIZE }) => (
  <img src={`${BRAND_BASE}${file}`} alt="" width={size} height={size} draggable={false} style={{ display: "block", flexShrink: 0, height: size, width: size }} />
);

// Custom's mark: three dots on a grey tile the size of the others.
const MoreMark = ({ size = LOGO_SIZE }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
    <rect x="0.5" y="0.5" width="39" height="39" rx="11" fill="var(--oh-ui-raised, #2a2a2e)" stroke="var(--oh-ui-line, rgba(255,255,255,0.14))" />
    <circle cx="11" cy="20" r="3" fill="var(--oh-ui-text, #f4f4f5)" />
    <circle cx="20" cy="20" r="3" fill="var(--oh-ui-text, #f4f4f5)" />
    <circle cx="29" cy="20" r="3" fill="var(--oh-ui-text, #f4f4f5)" />
  </svg>
);

const EyeIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const ACCENT = "var(--oh-ui-accent, #2bc1f3)";
// Wider for the three cards side by side than for one choice's form.
const DIALOG_WIDTH_STYLE = { chooser: "min(40rem, 100%)", steps: "min(34rem, 100%)" };

const buttonStyle = {
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "10px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "0.82rem",
  fontWeight: 750,
  padding: "0.6rem 1rem",
};

const primaryButtonStyle = {
  ...buttonStyle,
  background: "rgba(59,130,246,0.22)",
  border: "1px solid rgba(96,165,250,0.4)",
  color: "#dbeafe",
};

const quietButtonStyle = {
  ...buttonStyle,
  background: "rgba(255,255,255,0.05)",
  color: "rgba(255,255,255,0.78)",
};

const linkButtonStyle = {
  ...buttonStyle,
  alignItems: "center",
  background: "rgba(34,197,94,0.14)",
  border: "1px solid rgba(74,222,128,0.35)",
  color: "#bbf7d0",
  display: "inline-flex",
  gap: "0.4rem",
  textDecoration: "none",
};

// Command Code's links: grey, the card it came from being the one in colour.
const greyLinkStyle = {
  ...buttonStyle,
  alignItems: "center",
  background: "var(--oh-ui-overlay-card, rgba(255,255,255,0.06))",
  border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.14))",
  color: "var(--oh-ui-text, #f4f4f5)",
  display: "inline-flex",
  gap: "0.4rem",
  textDecoration: "none",
};

const labelStyle = {
  color: "rgba(255,255,255,0.72)",
  display: "block",
  fontSize: "0.72rem",
  fontWeight: 700,
  letterSpacing: "0.03em",
  marginBottom: "0.3rem",
  textTransform: "uppercase",
};

const inputStyle = {
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: "8px",
  boxSizing: "border-box",
  color: "white",
  fontFamily: "inherit",
  fontSize: "0.86rem",
  padding: "0.55rem 0.65rem",
  width: "100%",
};

const helperStyle = { color: "rgba(255,255,255,0.45)", fontSize: "0.7rem", lineHeight: 1.45, marginTop: "0.3rem" };

const panelStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: "12px",
  marginTop: "0.9rem",
  padding: "0.8rem 0.9rem",
};

// One of the three choices. Side by side on a wide screen (the mark above its
// words), one under another on a phone (the mark beside them).
const ChoiceCard = ({ choice, mark, name, brand = false, label, recommended = false, stacked, onChoose }) => (
  <button
    type="button"
    className="oh-tap-row"
    data-setup-choice={choice}
    onClick={() => onChoose(choice)}
    style={{
      alignItems: "center",
      background: recommended
        ? `color-mix(in srgb, ${ACCENT} 10%, var(--oh-ui-overlay-card, rgba(255,255,255,0.05)))`
        : "var(--oh-ui-overlay-card, rgba(255,255,255,0.05))",
      border: recommended ? `1.5px solid ${ACCENT}` : "1px solid var(--oh-ui-line, rgba(255,255,255,0.12))",
      borderRadius: "14px",
      boxSizing: "border-box",
      color: "var(--oh-ui-text, #f4f4f5)",
      cursor: "pointer",
      display: "flex",
      flexDirection: stacked ? "row" : "column",
      fontFamily: "inherit",
      gap: stacked ? "0.8rem" : "0.55rem",
      justifyContent: "flex-start",
      minHeight: stacked ? "4.4rem" : "9.5rem",
      padding: stacked ? "0.75rem 0.9rem" : "1.5rem 0.7rem 1.1rem",
      position: "relative",
      textAlign: stacked ? "left" : "center",
      width: "100%",
    }}
  >
    {recommended && (
      <span
        style={{
          background: ACCENT,
          borderRadius: "999px",
          color: "#0b0d10",
          fontSize: "0.6rem",
          fontWeight: 850,
          letterSpacing: "0.06em",
          padding: "0.18rem 0.55rem",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          ...(stacked
            ? { position: "absolute", right: "0.9rem", top: "-0.62rem" }
            : { left: "50%", position: "absolute", top: "-0.62rem", transform: "translateX(-50%)" }),
        }}
      >
        Recommended
      </span>
    )}
    {mark}
    <span style={{ display: "flex", flexDirection: "column", gap: "0.2rem", minWidth: 0 }}>
      <span data-no-translate={brand || undefined} style={{ fontSize: "0.95rem", fontWeight: 850 }}>{name}</span>
      <span style={{ color: recommended ? ACCENT : "rgba(255,255,255,0.62)", fontSize: "0.74rem", fontWeight: recommended ? 750 : 600, lineHeight: 1.4 }}>{label}</span>
    </span>
  </button>
);

// A key box with its show/hide eye.
const KeyField = ({ id, label, value, onChange, onEnter, placeholder, helper }) => {
  const [showApiKey, setShowApiKey] = useState(false);
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <div style={{ alignItems: "center", display: "flex", position: "relative" }}>
        <input
          id={id}
          type={showApiKey ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") onEnter(); }}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          style={{ ...inputStyle, paddingRight: "2.5rem" }}
        />
        <button
          type="button"
          className="oh-tap"
          onClick={() => setShowApiKey((show) => !show)}
          title={showApiKey ? "Hide API key" : "Show API key"}
          aria-label={showApiKey ? "Hide API key" : "Show API key"}
          style={{
            alignItems: "center",
            background: "transparent",
            border: "none",
            borderRadius: "6px",
            color: showApiKey ? "#38bdf8" : "inherit",
            cursor: "pointer",
            display: "inline-flex",
            height: "2rem",
            justifyContent: "center",
            opacity: showApiKey ? 1 : 0.65,
            padding: "0",
            position: "absolute",
            right: "0.35rem",
            top: "50%",
            transform: "translateY(-50%)",
            transition: "opacity 0.2s ease, background-color 0.2s ease, color 0.2s ease",
            width: "2.1rem",
            zIndex: 20,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "1";
            e.currentTarget.style.background = "rgba(128, 128, 128, 0.18)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = showApiKey ? "1" : "0.65";
            e.currentTarget.style.background = "transparent";
          }}
        >
          {showApiKey ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
        </button>
      </div>
      <div style={helperStyle}>{helper}</div>
    </div>
  );
};

// Whether the key a choice sets up has no request limit: true, false, or null
// for a choice that says nothing about it (a hosted provider through Custom).
export const noRequestLimitFor = (choice, { provider = "", endpoint = "" } = {}) => {
  if (choice === "commandcode") return true;
  if (choice === "gemini") return false;
  if (choice === "custom" && providerSetupRequirement(provider) === "endpoint" && endpointIsLocal(endpoint)) return true;
  return null;
};

// What saving each choice writes: Gemini and Custom the provider, key or
// endpoint, and model typed; Command Code its template with the key. Then the
// switch, once the setup itself was saved.
export const saveSetupChoice = (choice, { provider, apiKey = "", endpoint = "", model = "" } = {}) => {
  const saved = choice === "commandcode"
    ? applyTemplateAiSetup(COMMANDCODE_TEMPLATE, apiKey)
    : choice === "gemini"
    ? applyQuickAiSetup({ provider: "gemini", apiKey, model })
    : applyQuickAiSetup({ provider, apiKey, endpoint, model });
  const noLimit = noRequestLimitFor(choice, { provider, endpoint });
  if (noLimit !== null) setNoRequestLimit(noLimit);
  return saved;
};

// The switch as the choice sets it, shown on the steps of a choice that turns
// it on: a fact, with nothing to answer.
const NoRequestLimitRow = () => (
  <div data-setup-no-request-limit="on" style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
    <span style={{ ...labelStyle, display: "inline", marginBottom: 0 }}>My key has no request limit</span>
    <span style={{ fontSize: "0.84rem", fontWeight: 750 }}>On</span>
  </div>
);

// The tutorial's place on the card: a button until it is pressed, the YouTube
// player after. Nothing is asked of YouTube before the press, and the button
// says that pressing it will. Unmounted by "Hide the video", so showing the
// tutorial again starts from the button.
const TutorialVideo = () => {
  const [playing, setPlaying] = useState(false);
  return (
    <div style={{ aspectRatio: "16 / 9", background: "rgba(0,0,0,0.5)", borderRadius: "10px", overflow: "hidden", width: "100%" }}>
      {playing ? (
        <iframe
          title="How to get a Gemini API key (tutorial)"
          src={TUTORIAL_EMBED_URL}
          allow="accelerometer; autoplay; encrypted-media; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          style={{ border: 0, display: "block", height: "100%", width: "100%" }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          style={{ alignItems: "center", background: "transparent", border: 0, color: "rgba(255,255,255,0.86)", cursor: "pointer", display: "flex", fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 750, gap: "0.5rem", height: "100%", justifyContent: "center", padding: "0.6rem", width: "100%" }}
        >
          <span aria-hidden="true">▶</span>
          <span>{"Play the video (loads YouTube)"}</span>
        </button>
      )}
    </div>
  );
};

const groupedProviders = () => {
  const groups = new Map();
  // The player's own Agent needs no key, so it is not set up here (ADR 0008).
  for (const option of providerOptionsFor({ localServer: false })) {
    const name = option.group || "Providers";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(option);
  }
  return [...groups.entries()];
};

// `initialChoice` opens straight on one choice's steps (the tests draw each).
export const ApiSetupPrompt = ({ providerLabel = "the selected provider", missing = "an API key", onConfigure, onDismiss, initialChoice = null }) => {
  const [choice, setChoice] = useState(SETUP_CHOICES.includes(initialChoice) ? initialChoice : null);
  const [provider, setProvider] = useState(() => providerFor(initialChoice));
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState(initialChoice === "custom" ? ENDPOINT_PLACEHOLDERS[CUSTOM_START_PROVIDER] : "");
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [showTutorial, setShowTutorial] = useState(true);
  // Offline the embed is the WebView's own "Webpage not available" page; say
  // what the video needs instead, and show it when the network is back.
  const online = useBrowserOnline();
  const modelListId = useId();
  const selfHosted = choice === "custom" && providerSetupRequirement(provider) === "endpoint";
  const meta = getProviderMeta(provider);
  const commandCode = { label: COMMANDCODE_TEMPLATE.name };
  const recentModels = useMemo(() => getRecentModels(provider), [provider]);
  const canSave = selfHosted ? endpoint.trim().length > 0 : apiKey.trim().length > 0;
  const isMobile = useIsMobile();
  const isTouch = useTouchPrimary();
  const leaving = usePresenceLeaving();
  // On a phone "Not now" is a long scroll away, under the video and the form,
  // so the card gets a ✕ at the top as well, and Back answers it the same way.
  const phone = isMobile || isTouch;
  useBackToClose(!leaving, onDismiss);

  const chooseProvider = (next) => {
    setProvider(next);
    setError("");
    setEndpoint(ENDPOINT_PLACEHOLDERS[next] && providerSetupRequirement(next) === "endpoint" ? ENDPOINT_PLACEHOLDERS[next] : "");
  };

  const open = (next) => {
    setChoice(next);
    setApiKey("");
    setModel("");
    setError("");
    chooseProvider(providerFor(next));
  };

  const save = () => {
    if (!canSave) return;
    try {
      // Nothing to call back: main.jsx closes the prompt once the provider
      // it watches is ready.
      saveSetupChoice(choice, { provider, apiKey, endpoint, model });
      setError("");
    } catch (failure) {
      setError(failure?.message || "The settings could not be saved.");
    }
  };

  const chooser = (
    <>
      <div style={{ color: "rgba(255,255,255,0.64)", fontSize: "0.8rem", lineHeight: 1.55, marginTop: "0.5rem" }}>
        Open Historia writes every turn, advisor reply and diplomatic message with an AI model, and {providerLabel} has {missing} missing.
        Until it is set, time skips fall back to canned events and the advisor cannot answer.
      </div>
      <div
        style={{
          display: "grid",
          gap: isMobile ? "0.8rem" : "0.7rem",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
          marginTop: isMobile ? "1.2rem" : "1.4rem",
        }}
      >
        <ChoiceCard choice="gemini" stacked={isMobile} onChoose={open} mark={<BrandMark file="gemini.png" />} name="Gemini" brand label="Best free option" />
        <ChoiceCard choice="commandcode" stacked={isMobile} onChoose={open} mark={<BrandMark file="commandcode.svg" />} name={COMMANDCODE_TEMPLATE.name} brand label="Best quality option" recommended />
        <ChoiceCard choice="custom" stacked={isMobile} onChoose={open} mark={<MoreMark />} name="Custom" label="Configure any provider and any model, or a local model" />
      </div>
    </>
  );

  // The step a choice leads to opens under its own mark and name.
  const stepHeading = (mark, name, brand = true) => (
    <div style={{ alignItems: "center", display: "flex", gap: "0.6rem", marginTop: "0.8rem" }}>
      {mark}
      <span data-no-translate={brand || undefined} style={{ fontSize: "0.95rem", fontWeight: 850 }}>{name}</span>
    </div>
  );

  const modelField = (
    <div>
      <label htmlFor={`${modelListId}-model`} style={labelStyle}>Model (optional)</label>
      <input
        id={`${modelListId}-model`}
        type="text"
        value={model}
        onChange={(event) => setModel(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") save(); }}
        placeholder={MODEL_PLACEHOLDERS[provider] || "Model id"}
        autoComplete="off"
        spellCheck={false}
        list={recentModels.length ? `${modelListId}-models` : undefined}
        style={inputStyle}
      />
      {recentModels.length > 0 && (
        <datalist id={`${modelListId}-models`}>
          {recentModels.map((entry) => <option key={entry} value={entry} />)}
        </datalist>
      )}
      <div style={helperStyle}>Leave blank for the default. You can add more models and backup providers later under the game menu, Settings, AI.</div>
    </div>
  );

  const keyField = (label, placeholder, helper) => (
    <KeyField id={`${modelListId}-key`} label={label} value={apiKey} onChange={setApiKey} onEnter={save} placeholder={placeholder} helper={helper} />
  );

  const geminiSteps = (
    <>
      {stepHeading(<BrandMark file="gemini.png" size={28} />, "Gemini")}
      <div style={panelStyle}>
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: "0.86rem", fontWeight: 800 }}>New to API keys?</div>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.72rem", lineHeight: 1.45, marginTop: "0.15rem" }}>
              A Gemini key is free. The video walks through getting one; the button opens the page where it is made.
            </div>
          </div>
          <a href={AI_STUDIO_KEY_URL} target="_blank" rel="noopener noreferrer" className="oh-tap-row" style={linkButtonStyle}>
            Get a key at Google AI Studio ↗
          </a>
        </div>
        {showTutorial ? (
          <div style={{ marginTop: "0.7rem" }}>
            {online ? (
              <TutorialVideo />
            ) : (
              <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: "10px", color: "rgba(255,255,255,0.6)", fontSize: "0.74rem", lineHeight: 1.45, padding: "0.8rem 0.9rem" }}>
                The video needs an internet connection. It plays here as soon as you are back online, and so does getting a key.
              </div>
            )}
            <div style={{ alignItems: "center", display: "flex", gap: "0.8rem", justifyContent: "space-between", marginTop: "0.4rem" }}>
              {/* A finger-high row on a touch screen, with the words kept in
                  its middle as a button's are. */}
              <a href={TUTORIAL_VIDEO_URL} target="_blank" rel="noopener noreferrer" className="oh-tap-row" style={{ color: "rgba(147,197,253,0.9)", fontSize: "0.7rem", ...(isTouch ? { alignItems: "center", display: "inline-flex" } : null) }}>
                Watch on YouTube ↗
              </a>
              <button type="button" className="oh-tap-row" onClick={() => setShowTutorial(false)} style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.45)", cursor: "pointer", fontSize: "0.7rem", padding: 0 }}>
                Hide the video
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="oh-tap-row" onClick={() => setShowTutorial(true)} style={{ ...quietButtonStyle, fontSize: "0.72rem", marginTop: "0.6rem", padding: "0.35rem 0.7rem" }}>
            Show the video tutorial
          </button>
        )}
      </div>
      <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.95rem" }}>
        {keyField(`${meta.label} API key`, `Paste your ${meta.label} API key`, `Stored only in this browser. It is sent to ${meta.label} and nowhere else.`)}
        {modelField}
      </div>
    </>
  );

  const commandCodeSteps = (
    <>
      {stepHeading(<BrandMark file="commandcode.svg" size={28} />, COMMANDCODE_TEMPLATE.name)}
      <div style={{ ...panelStyle, display: "grid", gap: "0.7rem" }}>
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "space-between" }}>
          <div style={{ fontSize: "0.84rem", fontWeight: 800 }}>1. Get the GOAT plan, $10 a month</div>
          <a href={COMMANDCODE_PRICING_URL} target="_blank" rel="noopener noreferrer" className="oh-tap-row" style={greyLinkStyle} data-setup-link="pricing">
            Open the plans ↗
          </a>
        </div>
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "space-between" }}>
          <div style={{ fontSize: "0.84rem", fontWeight: 800 }}>2. Generate an API key</div>
          <a href={COMMANDCODE_KEYS_URL} target="_blank" rel="noopener noreferrer" className="oh-tap-row" style={greyLinkStyle} data-setup-link="keys">
            Open the API keys page ↗
          </a>
        </div>
      </div>
      <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.95rem" }}>
        {keyField(`${commandCode.label} API key`, `Paste your ${commandCode.label} API key`, `Stored only in this browser. It is sent to ${commandCode.label} and nowhere else.`)}
        <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
          <span style={{ ...labelStyle, display: "inline", marginBottom: 0 }}>Model</span>
          <span data-no-translate style={{ fontSize: "0.84rem", fontWeight: 750 }}>GLM 5.3 Flash</span>
        </div>
        <NoRequestLimitRow />
      </div>
    </>
  );

  const customSteps = (
    <>
      {stepHeading(<MoreMark size={28} />, "Custom", false)}
      <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.95rem" }}>
        <div>
          <label htmlFor={`${modelListId}-provider`} style={labelStyle}>Provider</label>
          <select
            id={`${modelListId}-provider`}
            data-no-translate
            value={provider}
            onChange={(event) => chooseProvider(event.target.value)}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            {groupedProviders().map(([group, options]) => (
              <optgroup key={group} label={group}>
                {options.map((option) => (
                  <option key={option.value} value={option.value} style={{ color: "black" }}>
                    {option.label} — {option.description}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {selfHosted && (
          <div>
            <label htmlFor={`${modelListId}-endpoint`} style={labelStyle}>API endpoint</label>
            <input
              id={`${modelListId}-endpoint`}
              type="text"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder={ENDPOINT_PLACEHOLDERS[provider] || "https://…"}
              autoComplete="off"
              spellCheck={false}
              style={inputStyle}
            />
            <div style={helperStyle}>
              {provider === "openai-compatible"
                ? "Base URL that exposes /chat/completions and /models (Ollama, LM Studio, OpenRouter, a gateway)."
                : "Base URL of a self-hosted proxy that speaks the Anthropic Messages API."}
            </div>
          </div>
        )}
        {keyField(
          selfHosted ? "API key (optional)" : `${meta.label} API key`,
          selfHosted ? "Leave empty if your server needs none" : `Paste your ${meta.label} API key`,
          `Stored only in this browser. It is sent to ${meta.label} and nowhere else.`,
        )}
        {modelField}
        {noRequestLimitFor("custom", { provider, endpoint }) && <NoRequestLimitRow />}
      </div>
    </>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Set up your AI provider"
      data-setup-choice-open={choice || "none"}
      style={{
        alignItems: "center",
        background: "rgba(0,0,0,0.42)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        // Clear of a notch and a home indicator (the insets are 0 elsewhere).
        padding: `calc(1rem + ${SAFE_TOP}) calc(1rem + ${SAFE_RIGHT}) calc(1rem + ${SAFE_BOTTOM}) calc(1rem + ${SAFE_LEFT})`,
        position: "fixed",
        zIndex: 10040,
      }}
    >
      <div
        style={{
          background: "var(--oh-ui-overlay-strong, rgba(32,32,35,0.965))",
          border: "1px solid var(--oh-hud-border)",
          borderRadius: "16px",
          boxShadow: "var(--oh-hud-shadow)",
          color: "white",
          fontFamily: "sans-serif",
          maxHeight: `calc(${APP_HEIGHT} - 2rem - ${SAFE_TOP} - ${SAFE_BOTTOM})`,
          overflowY: "auto",
          padding: "1.35rem 1.4rem 1.2rem",
          width: choice ? DIALOG_WIDTH_STYLE.steps : DIALOG_WIDTH_STYLE.chooser,
        }}
      >
        {phone ? (
          <div style={{ alignItems: "flex-start", display: "flex", gap: "0.75rem", justifyContent: "space-between" }}>
            <div style={{ fontSize: "1.05rem", fontWeight: 900 }}>Set up your AI provider</div>
            <button
              type="button"
              className="oh-tap"
              onClick={onDismiss}
              aria-label="Not now"
              title="Not now"
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", display: "flex", flexShrink: 0, fontSize: "1.1rem", lineHeight: 1, margin: "-0.6rem -0.7rem 0 0", padding: "0.15rem 0.3rem" }}
            >
              ✕
            </button>
          </div>
        ) : (
          <div style={{ fontSize: "1.05rem", fontWeight: 900 }}>Set up your AI provider</div>
        )}

        {choice === null && chooser}
        {choice === "gemini" && geminiSteps}
        {choice === "commandcode" && commandCodeSteps}
        {choice === "custom" && customSteps}

        {error && (
          <div style={{ color: "#fca5a5", fontSize: "0.76rem", marginTop: "0.7rem" }}>{error}</div>
        )}

        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1.1rem" }}>
          {choice !== null && (
            <button type="button" className="oh-tap-row" onClick={() => { setChoice(null); setError(""); }} style={{ ...quietButtonStyle, marginRight: "auto" }}>
              ← Back
            </button>
          )}
          <button type="button" className="oh-tap-row" onClick={onDismiss} style={quietButtonStyle}>
            Not now
          </button>
          {(choice === null || choice === "custom") && (
            <button type="button" className="oh-tap-row" data-setup-action="full-settings" onClick={onConfigure} style={quietButtonStyle}>
              Open full settings
            </button>
          )}
          {choice !== null && (
            <button
              type="button"
              className="oh-tap-row"
              onClick={save}
              disabled={!canSave}
              style={{ ...primaryButtonStyle, cursor: canSave ? "pointer" : "not-allowed", opacity: canSave ? 1 : 0.5 }}
              title={canSave ? "Save these settings and start playing" : selfHosted ? "Enter the server endpoint first" : "Paste an API key first"}
            >
              Save and play
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ApiSetupPrompt;
