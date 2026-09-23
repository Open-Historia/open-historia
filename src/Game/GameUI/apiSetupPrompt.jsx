import React, { useId, useMemo, useState } from "react";
import {
  DEFAULT_PROVIDER,
  GEMINI_DEFAULT_CHAIN,
  OPENAI_DEFAULT_MODEL,
  PROVIDER_OPTIONS,
  applyQuickAiSetup,
  getProviderMeta,
  getRecentModels,
  providerSetupRequirement,
} from "../AI/providerConfig.js";

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
const TUTORIAL_EMBED_URL = `https://www.youtube-nocookie.com/embed/${TUTORIAL_VIDEO_ID}?rel=0`;
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

const groupedProviders = () => {
  const groups = new Map();
  for (const option of PROVIDER_OPTIONS) {
    const name = option.group || "Providers";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(option);
  }
  return [...groups.entries()];
};

export const ApiSetupPrompt = ({ providerLabel = "the selected provider", missing = "an API key", onConfigure, onDismiss, onSaved }) => {
  const [provider, setProvider] = useState(DEFAULT_PROVIDER);
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [showTutorial, setShowTutorial] = useState(true);
  const modelListId = useId();
  const selfHosted = providerSetupRequirement(provider) === "endpoint";
  const meta = getProviderMeta(provider);
  const recentModels = useMemo(() => getRecentModels(provider), [provider]);
  const canSave = selfHosted ? endpoint.trim().length > 0 : apiKey.trim().length > 0;

  const choose = (next) => {
    setProvider(next);
    setError("");
    setEndpoint(ENDPOINT_PLACEHOLDERS[next] && providerSetupRequirement(next) === "endpoint" ? ENDPOINT_PLACEHOLDERS[next] : "");
  };

  const save = () => {
    if (!canSave) return;
    try {
      applyQuickAiSetup({ provider, apiKey, endpoint, model });
      setError("");
      onSaved?.();
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
        padding: "1rem",
        position: "fixed",
        zIndex: 10040,
      }}
    >
      <div
        style={{
          background: "linear-gradient(180deg, rgba(46,46,50,0.96), rgba(17,17,19,0.97))",
          border: "1px solid var(--oh-hud-border)",
          borderRadius: "16px",
          boxShadow: "var(--oh-hud-shadow)",
          color: "white",
          fontFamily: "sans-serif",
          maxHeight: "calc(100vh - 2rem)",
          overflowY: "auto",
          padding: "1.35rem 1.4rem 1.2rem",
          width: "min(34rem, 100%)",
        }}
      >
        <div style={{ fontSize: "1.05rem", fontWeight: 900 }}>Set up your AI provider</div>
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
            <a href={AI_STUDIO_KEY_URL} target="_blank" rel="noopener noreferrer" style={linkButtonStyle}>
              Get a key at Google AI Studio ↗
            </a>
          </div>
          {showTutorial ? (
            <div style={{ marginTop: "0.7rem" }}>
              <div style={{ aspectRatio: "16 / 9", background: "rgba(0,0,0,0.5)", borderRadius: "10px", overflow: "hidden", width: "100%" }}>
                <iframe
                  title="How to get a Gemini API key (tutorial)"
                  src={TUTORIAL_EMBED_URL}
                  allow="accelerometer; encrypted-media; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  style={{ border: 0, display: "block", height: "100%", width: "100%" }}
                />
              </div>
              <div style={{ alignItems: "center", display: "flex", gap: "0.8rem", justifyContent: "space-between", marginTop: "0.4rem" }}>
                <a href={TUTORIAL_VIDEO_URL} target="_blank" rel="noopener noreferrer" style={{ color: "rgba(147,197,253,0.9)", fontSize: "0.7rem" }}>
                  Watch on YouTube ↗
                </a>
                <button type="button" onClick={() => setShowTutorial(false)} style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.45)", cursor: "pointer", fontSize: "0.7rem", padding: 0 }}>
                  Hide the video
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setShowTutorial(true)} style={{ ...quietButtonStyle, fontSize: "0.72rem", marginTop: "0.6rem", padding: "0.35rem 0.7rem" }}>
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
            <input
              id={`${modelListId}-key`}
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") save(); }}
              placeholder={selfHosted ? "Leave empty if your server needs none" : `Paste your ${meta.label} API key`}
              autoComplete="off"
              spellCheck={false}
              style={inputStyle}
            />
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
          <button type="button" onClick={onDismiss} style={quietButtonStyle}>
            Not now
          </button>
          <button type="button" onClick={onConfigure} style={quietButtonStyle}>
            Open full settings
          </button>
          <button
            type="button"
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
