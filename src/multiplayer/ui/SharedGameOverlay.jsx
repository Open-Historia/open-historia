/*! Open Historia — a shared game's lobby and round bar © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Over the game while a shared game is open (client/sharedGame.js):
//   - the lobby: who plays what, a country to take, and for the host the invite
//     token to send and the button that starts the game;
//   - once it has started, the round bar: where the round is, how long is left,
//     who is ready, and the player's own Ready. The host also has pause and
//     "end the round now";
//   - the host's notices, and Leave.
// Mounted by App.jsx outside the game's UI, so it survives the UI remounting
// when the page switches to the shared game.

import React, { useEffect, useMemo, useState } from "react";
import {
  hostControl,
  leaveSharedGame,
  sharedRemainingMs,
  sharedRequest,
  useSharedGame,
} from "../client/sharedGame.js";

const glass = {
  background: "rgba(19,19,21,0.86)",
  backdropFilter: "blur(14px)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "16px",
  boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
  color: "rgba(246,246,248,0.94)",
};
const button = {
  alignItems: "center", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "999px",
  color: "rgba(246,246,248,0.94)", cursor: "pointer", display: "inline-flex", fontSize: "0.8rem", fontWeight: 650, gap: "0.35rem",
  justifyContent: "center", minHeight: "2rem", padding: "0 0.9rem",
};
const primary = { ...button, background: "rgba(43,193,243,0.2)", borderColor: "rgba(43,193,243,0.6)", color: "#e6f8ff" };
const small = { color: "rgba(255,255,255,0.6)", fontSize: "0.76rem" };
const isolate = { unicodeBidi: "isolate" };

const PHASES = {
  lobby: "Lobby",
  planning: "Planning",
  countdown: "Countdown",
  resolving: "The world moves…",
  revealing: "What happened",
};

const clock = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const leave = async () => {
  await leaveSharedGame();
  // Every cache back to this device's own game.
  window.location.reload();
};

const Lobby = ({ shared, me }) => {
  const { lobby, role, token, engine, error } = shared;
  const taken = useMemo(() => new Set((lobby?.seats ?? []).map((seat) => seat.country)), [lobby]);
  const free = (lobby?.countries ?? []).filter((country) => !taken.has(country));
  const [choice, setChoice] = useState("");
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);

  const pick = async () => {
    setStatus("");
    const answer = await sharedRequest("pick", { country: choice });
    if (!answer.ok) setStatus(answer.error === "taken" ? "Someone has taken that country." : answer.error || "The host refused.");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div style={{ ...glass, left: "50%", maxHeight: "80vh", maxWidth: "min(34rem, calc(100vw - 2rem))", overflowY: "auto", padding: "1.2rem 1.3rem", position: "fixed", top: "12vh", transform: "translateX(-50%)", width: "100%", zIndex: 4000 }}>
      <div style={{ fontSize: "1.15rem", fontWeight: 800, marginBottom: "0.2rem" }}><span style={isolate}>{lobby?.settings?.name || "Shared game"}</span></div>
      <div style={small}>
        {lobby ? <>On <span style={isolate}>{lobby.scenario?.name || "a scenario"}</span> · {lobby.settings?.roundMinutes} min rounds · {lobby.settings?.daysPerRound} days a round</> : "Finding the host…"}
      </div>

      {role === "host" && token ? (
        <div style={{ marginTop: "1rem" }}>
          <div style={small}>Invite code: anyone who has it can join, up to {lobby?.settings?.seats ?? 8} players.</div>
          <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", marginTop: "0.35rem" }}>
            <code style={{ background: "rgba(255,255,255,0.06)", borderRadius: "8px", flex: 1, fontSize: "0.72rem", overflow: "hidden", padding: "0.45rem 0.6rem", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{token}</code>
            <button type="button" style={button} onClick={copy}>{copied ? "Copied" : "Copy"}</button>
            <button type="button" style={button} onClick={() => hostControl("rotate")} title="A new code: the old one stops working">New code</button>
          </div>
          <div style={{ ...small, marginTop: "0.35rem" }}>
            Relays: {engine?.relays ? `${engine.relays.connected ?? 0} of ${engine.relays.total ?? 0} connected` : "connecting…"}
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: "1rem" }}>
        <div style={{ ...small, marginBottom: "0.35rem", textTransform: "uppercase" }}>Players</div>
        {(lobby?.seats ?? []).map((seat) => (
          <div key={seat.country} style={{ display: "flex", fontSize: "0.86rem", gap: "0.5rem", padding: "0.2rem 0" }}>
            <span style={{ ...isolate, flex: 1 }}>{seat.country}</span>
            <span style={{ ...isolate, color: "rgba(255,255,255,0.6)" }}>{seat.name}{seat.you ? " (you)" : ""}</span>
            <span style={small}>{seat.status === "human" ? "" : seat.status === "away" ? "away" : "AI"}</span>
          </div>
        ))}
      </div>

      {!me && lobby && role !== "host" && shared.standIn !== "ready" && !error ? (
        <div style={{ ...small, marginTop: "1rem" }}>Setting up the map…</div>
      ) : null}
      {!me && lobby && role !== "host" && shared.standIn === "ready" ? (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
          <select value={choice} onChange={(event) => setChoice(event.target.value)} style={{ ...button, flex: 1, justifyContent: "flex-start" }}>
            <option value="">Choose your country…</option>
            {free.map((country) => <option key={country} value={country}>{country}</option>)}
          </select>
          <button type="button" style={primary} disabled={!choice} onClick={pick}>Take it</button>
        </div>
      ) : null}
      {me && !lobby?.started ? (
        <div style={{ ...small, marginTop: "1rem" }}>
          You play <span style={isolate}>{me}</span>. {role === "host" ? "Start when everyone is in." : "Waiting for the host to start."}
          {role !== "host" ? <button type="button" style={{ ...button, marginLeft: "0.5rem" }} onClick={() => sharedRequest("unpick")}>Change</button> : null}
        </div>
      ) : null}

      {status || error ? <div style={{ color: "#fca5a5", fontSize: "0.82rem", marginTop: "0.7rem" }}>{status || error}</div> : null}

      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1.1rem" }}>
        <button type="button" style={button} onClick={leave}>{role === "host" ? "Stop sharing" : "Leave"}</button>
        {role === "host" && lobby && !lobby.started ? <button type="button" style={primary} onClick={() => hostControl("start")}>Start the game</button> : null}
      </div>
    </div>
  );
};

const RoundBar = ({ shared, me }) => {
  const { round, role, notices } = shared;
  // The clock is read in the timer, never while rendering: the time left and
  // the moment it was read are state like any other.
  const [clockState, setClockState] = useState({ remaining: 0, at: 0 });
  useEffect(() => {
    const read = () => setClockState({ remaining: sharedRemainingMs(), at: Date.now() });
    read();
    const timer = setInterval(read, 500);
    return () => clearInterval(timer);
  }, [round]);
  const ready = Boolean(me && round?.ready?.includes(me));
  const timed = ["planning", "countdown", "revealing"].includes(round?.phase);
  const latest = notices?.at(-1);
  const recent = latest && clockState.at - latest.at < 8000 ? latest : null;

  return (
    <div style={{ ...glass, alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.6rem", left: "50%", maxWidth: "calc(100vw - 1.5rem)", padding: "0.45rem 0.6rem 0.45rem 0.9rem", position: "fixed", top: "calc(3.4rem + env(safe-area-inset-top, 0px))", transform: "translateX(-50%)", zIndex: 3500 }}>
      <span style={{ fontSize: "0.82rem", fontWeight: 750 }}>Round {round?.round ?? "–"} · {PHASES[round?.phase] ?? "…"}</span>
      {timed ? <span style={{ fontVariantNumeric: "tabular-nums", fontSize: "0.82rem" }}>{round?.paused ? "paused" : clock(clockState.remaining)}</span> : null}
      <span style={small}>{round ? `${round.ready?.length ?? 0} of ${round.counted ?? 0} ready${round.needed ? ` (countdown at ${round.needed})` : ""}` : ""}</span>
      {["planning", "countdown"].includes(round?.phase) && me ? (
        <button type="button" style={ready ? primary : button} onClick={() => sharedRequest("ready", { value: !ready })}>{ready ? "Ready ✓" : "Ready"}</button>
      ) : null}
      {role === "host" && ["planning", "countdown"].includes(round?.phase) ? (
        <>
          <button type="button" style={button} onClick={() => hostControl(round?.paused ? "resume" : "pause")}>{round?.paused ? "Resume" : "Pause"}</button>
          <button type="button" style={button} onClick={() => hostControl("resolveNow")}>End round now</button>
        </>
      ) : null}
      <button type="button" style={button} onClick={leave}>{role === "host" ? "Stop" : "Leave"}</button>
      {recent ? <span style={{ ...small, flexBasis: "100%", textAlign: "center" }}>{recent.text}</span> : null}
    </div>
  );
};

export default function SharedGameOverlay() {
  const shared = useSharedGame();
  if (shared.mode === "off") return null;
  const me = shared.lobby?.seats?.find((seat) => seat.you && seat.status !== "ai")?.country ?? "";
  if (shared.mode === "ended") {
    return (
      <div style={{ ...glass, left: "50%", padding: "1rem 1.2rem", position: "fixed", top: "15vh", transform: "translateX(-50%)", zIndex: 4000 }}>
        <div style={{ fontWeight: 750 }}>The shared game ended</div>
        <div style={{ ...small, margin: "0.4rem 0 0.8rem" }}>{shared.error || "The connection closed."}</div>
        <button type="button" style={button} onClick={leave}>Back to my games</button>
      </div>
    );
  }
  const started = Boolean(shared.lobby?.started);
  return started && me ? <RoundBar shared={shared} me={me} /> : <Lobby shared={shared} me={me} />;
}
