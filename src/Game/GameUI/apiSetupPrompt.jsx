import React, { useId, useMemo, useState } from "react";
import { APP_HEIGHT, SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP, useTouchPrimary } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useBackToClose } from "../../runtime/backToClose.js";
import { usePresenceLeaving } from "./presence.jsx";
import {
  DEFAULT_PROVIDER,
  GEMINI_DEFAULT_CHAIN,
  OPENAI_DEFAULT_MODEL,
  providerOptionsFor,
  applyQuickAiSetup,
  getProviderMeta,
  getRecentModels,
  providerSetupRequirement,
} from "../AI/providerConfig.js";
import { useBrowserOnline } from "../../runtime/networkStatus.js";

// Shown when a game starts and the selected AI provider has nothing to call
// with — no key for a hosted provider, no endpoint for a self-hosted one. The
// game itself runs without it, but every time skip would fall back to canned
// events, and a new player had no way of knowing that until the first jump
// went wrong. Mounted through Presence (GameUI/main.jsx), so it fades in with
// the other surfaces and eases out when answered.
//
// The prompt is the setup, not a pointer to it: provider, key (or endpoint)
// and model are entered right here and saved into the Connections and the
// Fallback list (providerConfig.js applyQuickAiSetup), the tutorial video
// shows someone who has never made an API key how to get one, and a button
// opens Google AI Studio where the free Gemini key lives. Full settings stay
// one click away for anyone who wants the whole list.

const TUTORIAL_VIDEO_ID = "YdalQ8UqMR4";
const TUTORIAL_VIDEO_URL = `https://www.youtube.com/watch?v=${TUTORIAL_VIDEO_ID}`;
// The privacy-enhanced embed host: no YouTube cookies until the video plays.
// Even so, loading the player tells YouTube who opened this prompt, so the
// frame is only put on the page once the player presses the button that stands
// in its place (TutorialVideo below). It starts playing then: that press was
// the one asking for it.
const TUTORIAL_EMBED_URL = `https://www.youtube-nocookie.com/embed/${TUTORIAL_VIDEO_ID}?rel=0&autoplay=1`;
const AI_STUDIO_KEY_URL = "https://aistudio.google.com/app/apikey";

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

export const ApiSetupPrompt = ({ providerLabel = "the selected provider", missing = "an API key", onConfigure, onDismiss }) => {
  const [provider, setProvider] = useState(DEFAULT_PROVIDER);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [showTutorial, setShowTutorial] = useState(true);
  // Offline the embed is the WebView's own "Webpage not available" page; say
  // what the video needs instead, and show it when the network is back.
  const online = useBrowserOnline();
  const modelListId = useId();
  const selfHosted = providerSetupRequirement(provider) === "endpoint";
  const meta = getProviderMeta(provider);
  const recentModels = useMemo(() => getRecentModels(provider), [provider]);
  const canSave = selfHosted ? endpoint.trim().length > 0 : apiKey.trim().length > 0;
  const isMobile = useIsMobile();
  const isTouch = useTouchPrimary();
  const leaving = usePresenceLeaving();
  // On a phone "Not now" is a long scroll away, under the video and the form,
  // so the card gets a ✕ at the top as well, and Back answers it the same way.
  const phone = isMobile || isTouch;
  useBackToClose(!leaving, onDismiss);

  const choose = (next) => {
    setProvider(next);
    setError("");
    setEndpoint(ENDPOINT_PLACEHOLDERS[next] && providerSetupRequirement(next) === "endpoint" ? ENDPOINT_PLACEHOLDERS[next] : "");
  };

  const save = () => {
    if (!canSave) return;
    try {
      // Nothing to call back: main.jsx closes the prompt once the provider
      // it watches is ready.
      applyQuickAiSetup({ provider, apiKey, endpoint, model });
      setError("");
    } catch (failure) {
      setError(failure?.message || "The settings could not be saved.");
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Set up your AI provider"
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
          background: "rgba(32,32,35,0.965)",
          border: "1px solid var(--oh-hud-border)",
          borderRadius: "16px",
          boxShadow: "var(--oh-hud-shadow)",
          color: "white",
          fontFamily: "sans-serif",
          maxHeight: `calc(${APP_HEIGHT} - 2rem - ${SAFE_TOP} - ${SAFE_BOTTOM})`,
          overflowY: "auto",
          padding: "1.35rem 1.4rem 1.2rem",
          width: "min(34rem, 100%)",
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
        <div style={{ color: "rgba(255,255,255,0.64)", fontSize: "0.8rem", lineHeight: 1.55, marginTop: "0.5rem" }}>
          Open Historia writes every turn, advisor reply and diplomatic message with an AI model, and {providerLabel} has {missing} missing.
          Until it is set, time skips fall back to canned events and the advisor cannot answer. Paste your details below and you are ready to play.
        </div>

        <div
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: "12px",
            marginTop: "0.9rem",
            padding: "0.8rem 0.9rem",
          }}
        >
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
          <div>
            <label htmlFor={`${modelListId}-provider`} style={labelStyle}>Provider</label>
            <select
              id={`${modelListId}-provider`}
              data-no-translate
              value={provider}
              onChange={(event) => choose(event.target.value)}
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
          <div>
            <label htmlFor={`${modelListId}-key`} style={labelStyle}>{selfHosted ? "API key (optional)" : `${meta.label} API key`}</label>
            <div style={{ alignItems: "center", display: "flex", position: "relative" }}>
              <input
                id={`${modelListId}-key`}
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") save(); }}
                placeholder={selfHosted ? "Leave empty if your server needs none" : `Paste your ${meta.label} API key`}
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
            <div style={helperStyle}>Stored only in this browser. It is sent to {meta.label} and nowhere else.</div>
          </div>
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
        </div>

        {error && (
          <div style={{ color: "#fca5a5", fontSize: "0.76rem", marginTop: "0.7rem" }}>{error}</div>
        )}

        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1.1rem" }}>
          <button type="button" className="oh-tap-row" onClick={onDismiss} style={quietButtonStyle}>
            Not now
          </button>
          <button type="button" className="oh-tap-row" onClick={onConfigure} style={quietButtonStyle}>
            Open full settings
          </button>
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
        </div>
      </div>
    </div>
  );
};

export default ApiSetupPrompt;
