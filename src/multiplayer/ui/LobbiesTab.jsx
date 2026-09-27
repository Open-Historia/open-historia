/*! Open Historia — the main menu's Lobbies tab © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Where shared games are found, joined and hosted, all in the main game's menu:
//   - at the top, an invite code: the way into a private lobby;
//   - "Host a lobby", the tab's action in the menu bar (libraryBar.jsx), opens
//     the host's settings under it. A lobby is the game the player has open,
//     and the desktop app runs it;
//   - below, every public lobby, with filters. It is built, and waits behind
//     "Coming soon" until there is a server to list them on (PublicLobbies.jsx).

import React, { useEffect, useState } from "react";
import { useLibraryState } from "../../runtime/library.js";
import { MAX_SEATS, SEATS_AVAILABLE_NOW, DEFAULT_SETTINGS } from "../host/settings.js";
import { hostSharedGame, joinSharedGame, useSharedGame } from "../client/sharedGame.js";
import PublicLobbies from "./PublicLobbies.jsx";

const card = {
  background: "rgba(255,255,255,0.035)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "18px",
  padding: "1.2rem 1.3rem",
};
const heading = { color: "#fff", fontSize: "1.1rem", fontWeight: 800, letterSpacing: "-0.01em", margin: "0 0 0.35rem" };
const lead = { color: "rgba(255,255,255,0.62)", fontSize: "0.86rem", lineHeight: 1.55, margin: "0 0 1rem" };
const label = { color: "rgba(255,255,255,0.72)", display: "block", fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.04em", marginBottom: "0.4rem", textTransform: "uppercase" };
const input = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px", color: "#f8fafc", fontSize: "0.9rem", outline: "none", padding: "0.7rem 0.85rem", width: "100%", boxSizing: "border-box" };
const button = {
  alignItems: "center", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "999px",
  color: "rgba(246,246,248,0.94)", cursor: "pointer", display: "inline-flex", fontSize: "0.84rem", fontWeight: 650, gap: "0.4rem",
  justifyContent: "center", minHeight: "2.3rem", padding: "0 1.1rem",
};
const primary = { ...button, background: "rgba(43,193,243,0.18)", borderColor: "rgba(43,193,243,0.55)", color: "#e6f8ff" };
const note = { color: "rgba(255,255,255,0.55)", fontSize: "0.78rem", lineHeight: 1.5, margin: "0.8rem 0 0" };
const errorText = { color: "#fca5a5", fontSize: "0.82rem", margin: "0.7rem 0 0" };
const grid = { display: "grid", gap: "0.85rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" };

const NAME_KEY = "oh:mp:name";
const rememberedName = () => {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
};
const rememberName = (name) => {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // not remembered
  }
};

const Field = ({ title, children, hint, style }) => (
  <label style={{ display: "block", ...style }}>
    <span style={label}>{title}</span>
    {children}
    {hint ? <span style={{ ...note, display: "block", marginTop: "0.35rem" }}>{hint}</span> : null}
  </label>
);

// The top of the tab: a private lobby's invite code.
const InviteBar = ({ onEnterGame }) => {
  const shared = useSharedGame();
  const [code, setCode] = useState("");
  const [name, setName] = useState(rememberedName);
  const [error, setError] = useState("");

  const join = async (event) => {
    event.preventDefault();
    if (!code.trim() || shared.mode !== "off") return;
    setError("");
    try {
      rememberName(name);
      // A bad code is refused here, with the menu still showing why.
      await joinSharedGame({ token: code, name: name || "Player" });
      onEnterGame?.();
    } catch (failure) {
      setError(String(failure?.message || failure));
    }
  };

  return (
    <form style={card} aria-label="Join a private lobby" onSubmit={join}>
      <h3 style={heading}>Join a private lobby</h3>
      <p style={lead}>Enter the invite code the host sent you. You will need the lobby&apos;s scenario in your library.</p>
      <div style={{ alignItems: "flex-end", display: "flex", flexWrap: "wrap", gap: "0.7rem" }}>
        <Field title="Invite code" style={{ flex: "3 1 16rem" }}>
          <input style={input} value={code} onChange={(event) => setCode(event.target.value)} placeholder="oh1-…" spellCheck={false} autoComplete="off" />
        </Field>
        <Field title="Your name" style={{ flex: "1 1 9rem" }}>
          <input style={input} value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="Player" />
        </Field>
        <button type="submit" style={{ ...primary, minHeight: "2.75rem" }} disabled={!code.trim() || shared.mode !== "off"}>Join</button>
      </div>
      <p style={note}>Your computer connects straight to the host&apos;s, so the host can see your IP address. Other players cannot.</p>
      {error ? <p style={errorText}>{error}</p> : null}
    </form>
  );
};

// "Host a lobby": the game this player has open, shared.
const HostPanel = ({ onClose, onEnterGame }) => {
  const { activeGame } = useLibraryState();
  const shared = useSharedGame();
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS, name: activeGame?.name ? `${activeGame.name}` : DEFAULT_SETTINGS.name });
  const [name, setName] = useState(rememberedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [desktop, setDesktop] = useState(null);

  useEffect(() => {
    let live = true;
    fetch("/api/multiplayer/engine")
      .then((response) => response.json())
      .then((answer) => { if (live) setDesktop(Boolean(answer?.supported)); })
      .catch(() => { if (live) setDesktop(false); });
    return () => { live = false; };
  }, []);

  const update = (key) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.type === "range" || event.target.type === "number" ? Number(event.target.value) : event.target.value;
    setSettings((previous) => ({ ...previous, [key]: value }));
  };

  const open = async () => {
    setBusy(true);
    setError("");
    try {
      rememberName(name);
      await hostSharedGame({ settings, name: name || "Host" });
      onClose?.();
      onEnterGame?.();
    } catch (failure) {
      setError(String(failure?.message || failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={card} aria-label="Host a lobby">
      <h3 style={heading}>Host a lobby</h3>
      <p style={lead}>
        Your lobby is the game you have open. You keep playing your own country; players you send the invite code to take others.
        Your computer runs the game and pays for its AI with your key.
      </p>
      {desktop === false && !import.meta.env?.DEV ? (
        <p style={note}>Hosting needs the desktop app. You can still join lobbies from here.</p>
      ) : !activeGame ? (
        <p style={note}>Open a game first (the Games tab), then come back to host it.</p>
      ) : (
        <>
          <div style={grid}>
            <Field title="Your name"><input style={input} value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="Host" /></Field>
            <Field title="Lobby name"><input style={input} value={settings.name} maxLength={60} onChange={update("name")} /></Field>
            <Field title={`Players: ${settings.seats}`} hint={`Up to ${SEATS_AVAILABLE_NOW} for now; up to ${MAX_SEATS} is coming later.`}>
              <input type="range" min={2} max={MAX_SEATS} value={settings.seats} onChange={(event) => setSettings((previous) => ({ ...previous, seats: Math.min(SEATS_AVAILABLE_NOW, Number(event.target.value)) }))} style={{ width: "100%" }} />
            </Field>
            <Field title="Round length (minutes)"><input type="number" style={input} min={1} max={10080} value={settings.roundMinutes} onChange={update("roundMinutes")} /></Field>
            <Field title="Ready share to start the countdown" hint="When this share of players is ready, the countdown starts.">
              <select style={input} value={String(settings.readyThreshold)} onChange={(event) => setSettings((previous) => ({ ...previous, readyThreshold: Number(event.target.value) }))}>
                <option value={String(0.5)}>Half</option>
                <option value={String(2 / 3)}>Two thirds</option>
                <option value={String(0.75)}>Three quarters</option>
                <option value={String(1)}>Everyone</option>
              </select>
            </Field>
            <Field title="Countdown (seconds)"><input type="number" style={input} min={0} max={3600} value={settings.countdownSeconds} onChange={update("countdownSeconds")} /></Field>
            <Field title="Game time per round (days)"><input type="number" style={input} min={1} max={3650} value={settings.daysPerRound} onChange={update("daysPerRound")} /></Field>
            <Field title="A leaver's country waits (minutes)" hint="Then the AI plays it until they come back."><input type="number" style={input} min={0} max={1440} value={settings.leaverGraceMinutes} onChange={update("leaverGraceMinutes")} /></Field>
          </div>
          <label style={{ alignItems: "center", color: "rgba(255,255,255,0.8)", display: "flex", fontSize: "0.85rem", gap: "0.5rem", marginTop: "0.9rem" }}>
            <input type="checkbox" checked={settings.allowMidGameJoin} onChange={update("allowMidGameJoin")} />
            Players may join a game already under way, taking a country the AI plays
          </label>
          <p style={note}>
            Until relays are available, players connect straight to your computer: you and each player can see each other&apos;s IP address.
            Players never see one another&apos;s. Some strict networks (many mobile carriers) cannot connect this way.
          </p>
        </>
      )}
      <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem" }}>
        {activeGame && (desktop !== false || import.meta.env?.DEV) ? (
          <button type="button" style={primary} disabled={busy || shared.mode !== "off"} onClick={open}>
            {busy ? "Opening…" : "Open the lobby"}
          </button>
        ) : null}
        <button type="button" style={button} onClick={onClose}>Cancel</button>
      </div>
      {error ? <p style={errorText}>{error}</p> : null}
    </section>
  );
};

export default function LobbiesTab({ hosting = false, onHostingChange, onEnterGame }) {
  return (
    <div style={{ display: "grid", gap: "1.1rem", maxWidth: "62rem", margin: "0 auto" }}>
      <InviteBar onEnterGame={onEnterGame} />
      {hosting ? <HostPanel onClose={() => onHostingChange?.(false)} onEnterGame={onEnterGame} /> : null}
      <PublicLobbies />
    </div>
  );
}
