import React from "react";

// Shown when a game starts and the selected AI provider has nothing to call
// with — no key for a hosted provider, no endpoint for a self-hosted one. The
// game itself runs without it, but every time skip would fall back to canned
// events, and a new player had no way of knowing that until the first jump
// went wrong. Mounted through Presence (GameUI/main.jsx), so it fades in with
// the other surfaces and eases out when answered.
const buttonStyle = {
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "10px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "0.82rem",
  fontWeight: 750,
  padding: "0.6rem 1rem",
};

export const ApiSetupPrompt = ({ providerLabel = "the selected provider", missing = "an API key", onConfigure, onDismiss }) => (
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
        background: "linear-gradient(180deg, rgba(46,46,50,0.92), rgba(17,17,19,0.95))",
        border: "1px solid var(--oh-hud-border)",
        borderRadius: "16px",
        boxShadow: "var(--oh-hud-shadow)",
        color: "white",
        fontFamily: "sans-serif",
        padding: "1.35rem 1.4rem 1.2rem",
        width: "min(30rem, 100%)",
      }}
    >
      <div style={{ fontSize: "1.05rem", fontWeight: 900 }}>Set up your AI provider</div>
      <div style={{ color: "rgba(255,255,255,0.64)", fontSize: "0.8rem", lineHeight: 1.55, marginTop: "0.5rem" }}>
        Open Historia writes every turn, advisor reply and diplomatic message with an AI model, and {providerLabel} has {missing} missing.
        Until it is set, time skips fall back to canned events and the advisor cannot answer.
      </div>
      <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.7rem", lineHeight: 1.5, marginTop: "0.55rem" }}>
        Keys stay in this browser. You can change the provider or add one later under the game menu, Settings, AI.
      </div>
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1.1rem" }}>
        <button
          type="button"
          onClick={onDismiss}
          style={{ ...buttonStyle, background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.78)" }}
        >
          Not now
        </button>
        <button
          type="button"
          onClick={onConfigure}
          style={{ ...buttonStyle, background: "rgba(59,130,246,0.22)", border: "1px solid rgba(96,165,250,0.4)", color: "#dbeafe" }}
        >
          Configure AI
        </button>
      </div>
    </div>
  </div>
);

export default ApiSetupPrompt;
