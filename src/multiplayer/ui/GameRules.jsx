/*! Open Historia — a shared game's rules, as every player reads them, and the host's hand on them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// In the lobby, and in the round bar's dropdowns (ui/SharedGameOverlay.jsx):
//   - everything the Game Master has changed in this game (host/gameMaster.js),
//     where the host may use it (decision 8, "behind a visible notice": the
//     round bar's mark);
//   - for the host: how many answers of its AI each player has a round, with
//     each player's own AI answering (host/settings.js hostAnswers), and the
//     Game Master's command itself.
// The lines that told the round's rules and who pays were taken out of the
// lobby and the Players panel at the owner's word ("get rid of all this text
// that appears", 2026-11-18); the host's choices stay as controls.

import React, { useState } from "react";
import { hostControl } from "../client/sharedGame.js";
import { HOST_ANSWER_CHOICES, payerLineOf } from "../costRules.js";
import { gameMasterAllowed } from "../host/settings.js";
import { GAME_MASTER_COMMAND_MAX, gameMasterChangeLines } from "../host/gameMaster.js";
import { latestNoticeAbout } from "../client/threadNotes.js";

// The theme's colours (runtime/uiTheme.js), Default's as the fallbacks.
const small = { color: "var(--oh-ui-muted, rgba(255,255,255,0.6))", fontSize: "0.76rem", lineHeight: 1.45 };
const heading = { ...small, marginBottom: "0.25rem", marginTop: "0.7rem", textTransform: "uppercase" };
const isolate = { unicodeBidi: "isolate" };
const button = {
  alignItems: "center", background: "var(--oh-ui-glass-chip, rgba(255,255,255,0.07))", border: "1px solid var(--oh-ui-glass-line, rgba(255,255,255,0.12))", borderRadius: "999px",
  color: "var(--oh-ui-text, rgba(246,246,248,0.94))", cursor: "pointer", display: "inline-flex", fontFamily: "inherit", fontSize: "0.8rem", fontWeight: 650, gap: "0.35rem",
  justifyContent: "center", minHeight: "2rem", padding: "0 0.9rem",
};
const primary = { ...button, background: "var(--oh-ui-glass-active, rgba(43,193,243,0.2))", border: "1px solid var(--oh-ui-glass-active-line, rgba(43,193,243,0.6))", color: "var(--oh-ui-glass-active-text, #e6f8ff)" };

// The host's number of answers a round, while the game runs: in the lobby
// under GameRules, and in the round bar's Host dropdown.
export const HostAnswersSetting = ({ settings }) => {
  const value = Number(settings.hostAnswers) || 0;
  const choices = HOST_ANSWER_CHOICES.includes(value) ? HOST_ANSWER_CHOICES : [...HOST_ANSWER_CHOICES, value].sort((a, b) => a - b);
  return (
    <label style={{ ...small, alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.4rem" }}>
      Your AI's answers per player a round
      <select value={String(value)} onChange={(event) => hostControl("hostAnswers", { count: Number(event.target.value) })} style={{ ...button, justifyContent: "flex-start" }}>
        {choices.map((count) => <option key={count} value={String(count)}>{count === 0 ? "None" : String(count)}</option>)}
      </select>
    </label>
  );
};

// What the Game Master has changed in this game, newest first: the AI's own
// words for it, then what it touched, each in a whole sentence of this
// screen's language (host/gameMaster.js gameMasterChangeLines).
export const GameMasterLog = ({ entries }) => (entries ?? []).slice().reverse().map((entry, index) => (
  <div key={`${entry.round}:${index}`} style={{ ...small, marginTop: "0.25rem" }}>
    <span>{entry.date ? `Round ${entry.round}, ${entry.date}:` : `Round ${entry.round}:`}</span>{" "}
    <span style={isolate}>{entry.summary}</span>
    {gameMasterChangeLines(entry).map((line) => <React.Fragment key={line}>{" "}<span style={isolate}>{line}</span></React.Fragment>)}
  </div>
));

// What the Game Master has changed, under its heading, for every player: the
// round bar's Players dropdown.
export const GameMasterChanges = ({ shared }) => {
  const changes = shared.lobby?.gameMaster ?? [];
  if (!changes.length) return null;
  return (
    <div>
      <div style={heading}>Game Master changes</div>
      <GameMasterLog entries={changes} />
    </div>
  );
};

export const GameRules = ({ shared }) => {
  const settings = shared.lobby?.settings;
  if (!settings) return null;
  const host = shared.role === "host";
  const changes = shared.lobby?.gameMaster ?? [];
  if (!(host && settings.replies === "own") && !changes.length) return null;
  return (
    <div style={{ marginTop: "0.4rem" }}>
      {host && settings.replies === "own" ? <HostAnswersSetting settings={settings} /> : null}
      {changes.length ? <div style={heading}>Game Master changes</div> : null}
      <GameMasterLog entries={changes} />
    </div>
  );
};

// The host's command to the Game Master, in a game that allows it. What it
// changed reaches every player as a notice and in the lobby's log; why it
// changed nothing reaches the host the same way.
export const GameMasterBox = ({ shared }) => {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState("");
  // When the last command was given: what came of it is said here, where it
  // was given (a notice about the Game Master, game/messages.js `about`).
  const [sentAt, setSentAt] = useState(0);
  if (shared.role !== "host" || !gameMasterAllowed(shared.lobby?.settings)) return null;
  const busy = shared.engine?.gameMasterBusy === true;
  const resolving = shared.round?.phase === "resolving";
  const send = () => {
    const text = command.trim();
    if (!text || busy || resolving) return;
    setSentAt(Date.now());
    hostControl("gm", { command: text.slice(0, GAME_MASTER_COMMAND_MAX) });
    setCommand("");
  };
  const outcome = sentAt && !busy ? latestNoticeAbout(shared.notices, "gm", sentAt) : null;
  if (!open) return <button type="button" style={button} onClick={() => setOpen(true)}>Game Master</button>;
  return (
    <div style={{ display: "flex", flexBasis: "100%", flexDirection: "column", gap: "0.4rem" }}>
      <textarea
        value={command}
        maxLength={GAME_MASTER_COMMAND_MAX}
        onChange={(event) => setCommand(event.target.value)}
        placeholder="What should change in the world?"
        rows={3}
        style={{ background: "var(--oh-ui-overlay-card, rgba(255,255,255,0.05))", border: "1px solid var(--oh-ui-glass-line, rgba(255,255,255,0.12))", borderRadius: "10px", color: "inherit", fontFamily: "inherit", fontSize: "0.82rem", padding: "0.5rem 0.6rem", resize: "vertical" }}
      />
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <button type="button" style={primary} disabled={!command.trim() || busy || resolving} onClick={send}>{busy ? "The Game Master is at work…" : "Change it"}</button>
        <button type="button" style={button} onClick={() => setOpen(false)}>Close</button>
        <span style={small}>{resolving ? "Not while a round is being resolved." : "It changes the world at once, and every player is told what it changed."}</span>
      </div>
      {outcome ? <div style={{ ...small, ...isolate, ...(outcome.level === "warn" ? { color: "#fca5a5" } : null) }}>{outcome.text}</div> : null}
    </div>
  );
};

// A standing mark on every player's round bar, in a game whose host may use
// the Game Master: "behind a visible notice" (decision 8). Its changes are
// listed under Players. `compact`: the bar's own, its count in its title.
export const GameMasterMark = ({ shared, compact = false }) => {
  if (!gameMasterAllowed(shared.lobby?.settings)) return null;
  const changes = shared.lobby?.gameMaster?.length ?? 0;
  const text = !changes ? "Game Master on" : changes === 1 ? "Game Master on: 1 change" : `Game Master on: ${changes} changes`;
  return (
    <span title={compact ? text : undefined} style={{ ...small, border: "1px solid var(--oh-ui-glass-line, rgba(255,255,255,0.18))", borderRadius: "999px", flexShrink: 0, lineHeight: 1.3, padding: "0.1rem 0.5rem", whiteSpace: "nowrap" }}>
      {compact ? "Game Master on" : text}
    </span>
  );
};

// Whose device pays the round, with the host's taking it on itself when that
// device failed or is away (settings.payment "cycle").
export const PayerLine = ({ shared, me, style = null }) => {
  const round = shared.round;
  const text = payerLineOf({ payer: round?.payer ?? "", me, phase: round?.phase ?? "" });
  if (!text) return null;
  return <span style={{ ...small, ...isolate, flexBasis: "100%", textAlign: "center", ...style }}>{text}</span>;
};

// For the host, beside "Try again now" on a round that could not be resolved.
export const PayItYourself = ({ shared }) => {
  const round = shared.round;
  if (shared.role !== "host" || shared.lobby?.settings?.payment !== "cycle" || !["planning", "countdown"].includes(round?.phase)) return null;
  return <button type="button" style={button} onClick={() => hostControl("payRound")}>Pay it yourself</button>;
};
