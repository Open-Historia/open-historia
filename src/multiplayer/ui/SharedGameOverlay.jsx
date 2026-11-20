/*! Open Historia — a shared game's lobby and round bar © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Over the game while a shared game is open (client/sharedGame.js):
//   - the lobby: who plays what, a country to take, and for the host the invite
//     token to send and the button that starts the game. Until the host's
//     lobby has arrived, a player is told which step of joining they are on,
//     and the host is told who is connecting and who could not
//     (client/joinProgress.js);
//   - once it has started, the round bar. "Make this whole overlay thing not
//     always be on screen ... a single bar at the top of the screen with a
//     couple essential controls, and all the host controls should be
//     accessible in a dropdown" (the owner, 2026-11-18). One slim row, in the
//     HUD's glass and the player's interface theme, under the game's top
//     edge: the round and its phase, its clock, the date it lands on, one
//     short mark for a state out of the ordinary (roundBar.js barStatus), the
//     player's own Ready, Players and, for the host, Host. Nothing else is
//     open unless asked for;
//   - Players, a dropdown: where the round is in words, who plays what (away
//     and ready marks), a free country to take or ask for (a player whose
//     country is gone watches, and takes one here), what the Game Master
//     changed, the host's notices, and a player's Leave;
//   - Host, a dropdown with every one of the host's controls: pause and
//     resume, end the round now, cancel it or try it again, pay it itself,
//     the players asking to change country, release or ban a seat a player
//     holds (a seat is its player's device's until the host releases it), the
//     invite code and its relays, whose AI answers and how often, the Game
//     Master, and Stop sharing, which asks once more: it ends the game for
//     every player;
//   - the host's notices: the newest for a moment in one line under the bar,
//     those not yet read counted on the Players button; a refusal or answer
//     said where the player acted too (Ready, Change, the country picker, the
//     Game Master).
// The bar is as wide as what it holds on a desktop; on a phone it is the row
// beside the game's ⌂ and the same five things at most (the round, its clock,
// Ready, Players, Host), the rest in the dropdowns. Each dropdown closes on a
// click outside it or Escape, which gives the focus back to its button.
// Mounted by App.jsx outside the game's UI, so it survives the UI remounting
// when the page switches to the shared game.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  dismissEndedNotice,
  hostControl,
  leaveSharedGame,
  markNoticesRead,
  sharedRemainingMs,
  sharedRequest,
  useSharedGame,
} from "../client/sharedGame.js";
import { OWN_MAP_NOTE, hostLines, joinStage, peopleOf } from "../client/joinProgress.js";
import { roundDatesOf } from "../client/roundDates.js";
import { latestNoticeAbout, unreadNotices } from "../client/threadNotes.js";
import { askingLabel, barStatus, failureText, readyText, roundClockText, unreadLabel, waitsForTheHost } from "./roundBar.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { SAFE_LEFT, SAFE_RIGHT, SAFE_TOP } from "../../runtime/mobileUi.js";
import { GameMasterBox, GameMasterChanges, GameMasterMark, GameRules, HostAnswersSetting, PayItYourself, PayerLine } from "./GameRules.jsx";
import { hostBusyLine } from "./hostBusy.js";
import { RECONNECTING } from "../client/hostGone.js";

const glass = {
  background: "rgba(19,19,21,0.86)",
  backdropFilter: "blur(14px)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "16px",
  boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
  color: "rgba(246,246,248,0.94)",
};
// The buttons and words take the player's interface theme (runtime/uiTheme.js),
// as the HUD's do; Default's greys and the accent are the fallbacks.
const button = {
  alignItems: "center", background: "var(--oh-ui-glass-chip, rgba(255,255,255,0.07))", border: "1px solid var(--oh-ui-glass-line, rgba(255,255,255,0.12))", borderRadius: "999px",
  color: "var(--oh-ui-text, rgba(246,246,248,0.94))", cursor: "pointer", display: "inline-flex", fontFamily: "inherit", fontSize: "0.8rem", fontWeight: 650, gap: "0.35rem",
  justifyContent: "center", minHeight: "2rem", padding: "0 0.75rem",
};
const primary = { ...button, background: "var(--oh-ui-glass-active, rgba(43,193,243,0.2))", border: "1px solid var(--oh-ui-glass-active-line, rgba(43,193,243,0.6))", color: "var(--oh-ui-glass-active-text, #e6f8ff)" };
const small = { color: "var(--oh-ui-muted, rgba(255,255,255,0.6))", fontSize: "0.76rem" };
const isolate = { unicodeBidi: "isolate" };
const problemText = { color: "#fca5a5" };

const PHASES = {
  lobby: "Lobby",
  planning: "Planning",
  countdown: "Countdown",
  resolving: "The world moves…",
  revealing: "What happened",
};

const leave = async () => {
  await leaveSharedGame();
  // Every cache back to this device's own game.
  window.location.reload();
};

// Leave, for a player; for the host, Stop, which ends the shared game for
// every player at once, mid-round: it asks once more, as Ban does. One click
// beside Players, in a bar that wrapped where it liked, sent everyone away.
const LeaveButton = ({ role, label }) => {
  const [asking, setAsking] = useState(false);
  if (role !== "host") return <button type="button" style={button} onClick={leave}>Leave</button>;
  if (!asking) return <button type="button" style={button} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <span style={{ alignItems: "center", display: "inline-flex", flexWrap: "wrap", gap: "0.35rem" }}>
      <button type="button" style={{ ...button, ...problemText }} onClick={leave}>Stop sharing for everyone</button>
      <button type="button" style={button} onClick={() => setAsking(false)}>Cancel</button>
    </span>
  );
};

// Every notice kept (client/gameClient.js, newest last), newest first, a
// problem in its own colour; those after `readAt` read as new.
const NoticeList = ({ notices, readAt = 0, limit = 20 }) => {
  const shown = (notices ?? []).slice(-limit).reverse();
  if (!shown.length) return null;
  return (
    <div style={{ marginTop: "0.6rem" }}>
      <div style={{ ...small, marginBottom: "0.25rem", textTransform: "uppercase" }}>Notices</div>
      {shown.map((notice, index) => (
        <div
          key={`${notice.at}:${index}`}
          style={{
            ...small, ...isolate, lineHeight: 1.45, marginTop: "0.2rem",
            color: notice.level === "warn" ? problemText.color : (notice.at || 0) > readAt ? "rgba(246,246,248,0.92)" : small.color,
            fontWeight: (notice.at || 0) > readAt ? 650 : 400,
          }}
        >
          {notice.text}
        </div>
      ))}
    </div>
  );
};

// The newest word from the host, for a moment, where the player is looking.
const NOTICE_SHOWN_MS = 8000;

// What a seat's player is doing, in words.
const seatState = (seat, ready) => {
  if (seat.status === "human") return ready.includes(seat.country) ? "Ready ✓" : "";
  if (seat.status === "away") return "Away";
  if (seat.status === "watching") return "Watching";
  // The AI minds a country its player still holds, until they come back.
  return seat.held ? "Away: the AI plays it" : "AI player";
};

// The host's hand on a seat another player holds: Release frees the country
// (anyone may take it, its player no longer can); Ban does that and keeps the
// player's device out of this game for good, so it asks once more.
const SeatActions = ({ country }) => {
  const [banning, setBanning] = useState(false);
  if (banning) {
    return (
      <span style={{ display: "inline-flex", gap: "0.3rem" }}>
        <button type="button" style={{ ...button, ...problemText, minHeight: "1.6rem" }} onClick={() => hostControl("kick", { country, ban: true })}>Ban for good</button>
        <button type="button" style={{ ...button, minHeight: "1.6rem" }} onClick={() => setBanning(false)}>Cancel</button>
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: "0.3rem" }}>
      <button type="button" style={{ ...button, minHeight: "1.6rem" }} title="Anyone may take this country; its player can no longer come back to it" onClick={() => hostControl("kick", { country })}>Release</button>
      <button type="button" style={{ ...button, minHeight: "1.6rem" }} title="Release this country and keep its player out of this game" onClick={() => setBanning(true)}>Ban</button>
    </span>
  );
};

// The host's hand reaches a seat another player holds.
const inHostsHand = (seat) => Boolean(seat.held && !seat.you && seat.status !== "watching");

// Who plays what: the lobby's list, and the round bar's Players dropdown ("how
// can I see who is playing?", a player asked mid-game). `ready` marks those
// who are ready in the round; `host` gives the host its hand on each seat
// another player holds; `handsOnly` lists those seats alone (the Host dropdown).
const SeatList = ({ seats, ready = [], host = false, handsOnly = false }) => (seats ?? []).filter((seat) => !handsOnly || inHostsHand(seat)).map((seat) => (
  <div key={`${seat.status}:${seat.country}`} style={{ alignItems: "center", display: "flex", flexWrap: "wrap", fontSize: "0.86rem", gap: "0.5rem", padding: "0.2rem 0" }}>
    <span style={{ ...isolate, flex: 1 }}>{seat.country}</span>
    <span style={{ ...isolate, color: "var(--oh-ui-muted, rgba(255,255,255,0.6))" }}>{seat.you ? `${seat.name} (you)` : seat.name}</span>
    <span style={small}>{seatState(seat, ready)}</span>
    {host && inHostsHand(seat) ? <SeatActions country={seat.country} /> : null}
  </div>
));

// Players asking the host to change country, once the game is under way (the
// owner's decision 12): the host's to allow or refuse.
const ChangeRequests = ({ changes }) => (changes ?? []).map((change) => {
  const who = change.name || change.from;
  return (
  <div key={change.from} style={{ alignItems: "center", display: "flex", flexWrap: "wrap", fontSize: "0.86rem", gap: "0.5rem", padding: "0.25rem 0" }}>
    <span style={{ ...isolate, flex: 1 }}>{`${who} (${change.from}) asks to play ${change.to}.`}</span>
    <button type="button" style={{ ...primary, minHeight: "1.6rem" }} onClick={() => hostControl("seat", { op: "allow", from: change.from })}>Allow</button>
    <button type="button" style={{ ...button, minHeight: "1.6rem" }} onClick={() => hostControl("seat", { op: "refuse", from: change.from })}>Refuse</button>
  </div>
  );
});

// Why a country could not be taken (host/seats.js claim), in words.
const REFUSAL_LABELS = {
  taken: "Another player holds that country.",
  "game-started": "The game is under way, and the host does not let new players join.",
  full: "The game is full.",
  "not-a-country": "That country is not in this game.",
  "ask-host": "Ask the host to change your country.",
  released: "The host released you from that country.",
};

// A free country to take. `asking`: the player already plays one and the game
// is under way, so the change is asked of the host, who allows it or not; the
// host's answer comes later, as a notice about the seat (game/messages.js
// notice `about`), and is said here, where it was asked.
const CountryPicker = ({ lobby, asking = false, notices = [] }) => {
  // A country another player holds is not free, whoever minds it now.
  const held = useMemo(() => new Set((lobby?.seats ?? []).filter((seat) => seat.held).map((seat) => seat.country)), [lobby]);
  const free = (lobby?.countries ?? []).filter((country) => !held.has(country));
  const [choice, setChoice] = useState("");
  const [status, setStatus] = useState({ text: "", problem: false, at: 0 });
  const pick = async () => {
    const at = Date.now();
    setStatus({ text: "", problem: false, at });
    const answer = await sharedRequest("pick", { country: choice });
    if (!answer.ok) setStatus({ text: REFUSAL_LABELS[answer.error] || answer.error || "The host refused.", problem: true, at });
    else if (answer.result?.asked) setStatus({ text: `You asked the host to let you play ${answer.result.asked}.`, problem: false, at });
  };
  // What the host said of the seat since the player last asked.
  const answered = status.at ? latestNoticeAbout(notices, "seat", status.at) : null;
  return (
    <>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
        <select value={choice} onChange={(event) => setChoice(event.target.value)} style={{ ...button, flex: 1, justifyContent: "flex-start", minWidth: 0 }}>
          <option value="">{asking ? "Ask to play another country…" : "Choose your country…"}</option>
          {free.map((country) => <option key={country} value={country}>{country}</option>)}
        </select>
        <button type="button" style={primary} disabled={!choice} onClick={pick}>{asking ? "Ask the host" : "Take it"}</button>
      </div>
      {status.text ? <div style={{ ...small, ...(status.problem ? problemText : null), ...isolate, marginTop: "0.45rem" }}>{status.text}</div> : null}
      {answered ? <div style={{ ...small, ...(answered.level === "warn" ? problemText : null), ...isolate, marginTop: "0.3rem" }}>{answered.text}</div> : null}
    </>
  );
};

// Who answers a player's message to a country the AI plays (host/settings.js
// `replies`). The host sets it, here too while the game runs; everyone else is
// told when it is their own AI that answers, since they need one set up.
const RepliesSetting = ({ shared, style = null }) => {
  if (!shared.lobby) return null;
  const mode = shared.lobby.settings?.replies === "own" ? "own" : "host";
  // A player is told under "Who pays" (ui/GameRules.jsx), with what the host's
  // AI still answers: "Countries the AI plays answer your messages with your
  // own AI key" was said here, and some of them never did.
  if (shared.role !== "host") return null;
  // At the end of its row: during a game the Events panel lies over the start
  // of the round bar's lower rows, and covered the start of this one.
  return (
    <label style={{ ...small, alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.5rem", ...style }}>
      AI countries answer with
      <select value={mode} onChange={(event) => hostControl("replies", { mode: event.target.value })} style={{ ...button, justifyContent: "flex-start" }}>
        <option value="host">Your AI key</option>
        <option value="own">Each player&apos;s own AI key</option>
      </select>
    </label>
  );
};

// The host's invite code, its relays, and who is coming in or could not
// (client/joinProgress.js): in the lobby, and in the Host dropdown while the
// game runs, which a game taken up again opens with: its players need the code
// to come back.
const HostInvite = ({ shared }) => {
  const { lobby, token, engine } = shared;
  const [copied, setCopied] = useState(false);
  const people = hostLines(engine);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  if (!token) return null;
  return (
    <div style={{ marginTop: "0.6rem" }}>
      <div style={small}>Invite code: anyone who has it can join, up to {lobby?.settings?.seats ?? 8} players.</div>
      <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", marginTop: "0.35rem" }}>
        <code style={{ background: "var(--oh-ui-overlay-card, rgba(255,255,255,0.06))", borderRadius: "8px", flex: 1, fontSize: "0.72rem", minWidth: 0, overflow: "hidden", padding: "0.45rem 0.6rem", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{token}</code>
        <button type="button" style={button} onClick={copy}>{copied ? "✓ Copied!" : "Copy"}</button>
        <button type="button" style={button} onClick={() => hostControl("rotate")} title="A new code: the old one stops working">New code</button>
      </div>
      <div style={{ ...small, marginTop: "0.35rem" }}>
        Relays: {engine?.relays ? `${engine.relays.connected ?? 0} of ${engine.relays.total ?? 0} connected` : "connecting…"}
      </div>
      {/* Each line a whole sentence, translated whole; the players it names
          after it, as they typed their names, never text for the translator
          (client/joinProgress.js hostLines). */}
      {people.map((line) => (
        <div key={line.text} style={{ ...small, ...(line.problem ? problemText : null), marginTop: "0.35rem" }}>
          <span>{line.text}</span>
          {line.people?.length ? <>{" "}<span data-no-translate="" style={isolate}>{peopleOf(line)}</span></> : null}
        </div>
      ))}
    </div>
  );
};

const Lobby = ({ shared, me }) => {
  const { lobby, role, error } = shared;
  // Which step of joining this is, once it is past looking for the host.
  // (The host's engine may first finish the game's start, host/gameStart.js:
  // its backstory can be a request to the host's AI, which takes a while.)
  const stage = lobby ? "" : role === "host" && shared.engine?.preparing ? "Setting up the start of the game before anyone joins…" : joinStage(shared);
  const waiting = !lobby && role !== "host" && !error;

  // Under way, where the host lets nobody new in: nothing to choose.
  const closed = Boolean(lobby?.started) && lobby?.settings?.allowMidGameJoin === false;
  // The country this player has taken, as the lines below name it.
  const country = me;
  // The host's answer to Change, when it refuses (its acks were ignored).
  const [changeRefused, setChangeRefused] = useState("");
  const change = async () => {
    setChangeRefused("");
    const answer = await sharedRequest("unpick");
    if (!answer.ok) setChangeRefused(REFUSAL_LABELS[answer.error] || answer.error || "The host refused.");
  };
  // Seen here, the notices are read.
  useEffect(() => {
    if (shared.notices?.length) markNoticesRead();
  }, [shared.notices]);
  // Start pressed: said for as long as the engine says the start is under way
  // (its entry waits for whatever the host's game is applying: busyLine says
  // what), until the lobby says the game has started; one that failed says why
  // (`error`) and can be pressed again. Until the engine's first word, the
  // press itself, for a while.
  const engineStarting = shared.engine?.starting === true;
  const [pressed, setPressed] = useState(false);
  const start = () => {
    setPressed(true);
    hostControl("start");
  };
  // Once the engine has said it, the engine's word is the one followed.
  const [saidStarting, setSaidStarting] = useState(engineStarting);
  if (saidStarting !== engineStarting) {
    setSaidStarting(engineStarting);
    if (engineStarting) setPressed(false);
  }
  useEffect(() => {
    if (!pressed) return undefined;
    const timer = setTimeout(() => setPressed(false), 15000);
    return () => clearTimeout(timer);
  }, [pressed]);
  const starting = pressed || engineStarting;
  const busyLine = role === "host" ? hostBusyLine(shared.engine?.busy) : "";

  return (
    // The box's actions (Stop sharing, Start the game) are pinned at its foot,
    // and what is above them scrolls: a long player list or notices pushed
    // them below the box's edge, where Start could not be reached.
    <div style={{ ...glass, boxSizing: "border-box", display: "flex", flexDirection: "column", left: 0, marginInline: "auto", maxHeight: "min(80vh, calc(100dvh - 12vh - 1rem))", maxWidth: "min(34rem, calc(100vw - 2rem))", overflow: "hidden", position: "fixed", right: 0, top: "12vh", width: "100%", zIndex: 4000 }}>
      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "1.2rem 1.3rem 0.4rem" }}>
      <div style={{ fontSize: "1.15rem", fontWeight: 800, marginBottom: "0.2rem" }}><span style={isolate}>{lobby?.settings?.name || "Shared game"}</span></div>
      <div style={small}>
        {lobby ? <><span style={isolate}>{lobby.scenario?.name || "Scenario"}</span> · {lobby.settings?.roundMinutes} min rounds · {lobby.settings?.daysPerRound} days a round</> : stage || (role === "host" ? "Opening your shared game…" : "Finding the host…")}
      </div>
      {waiting ? <div style={{ ...small, marginTop: "0.35rem" }}>{OWN_MAP_NOTE}</div> : null}

      {role === "host" ? <HostInvite shared={shared} /> : null}

      <div style={{ marginTop: "1rem" }}>
        <div style={{ ...small, marginBottom: "0.35rem", textTransform: "uppercase" }}>Players</div>
        <SeatList seats={lobby?.seats} host={role === "host"} />
        <RepliesSetting shared={shared} />
        <GameRules shared={shared} />
      </div>

      {!me && lobby && role !== "host" && shared.standIn !== "ready" && !error ? (
        <div style={{ ...small, marginTop: "1rem" }}>Setting up the map…</div>
      ) : null}
      {!me && lobby && role !== "host" && shared.standIn === "ready" && closed ? (
        <div style={{ ...small, marginTop: "1rem" }}>{REFUSAL_LABELS["game-started"]}</div>
      ) : null}
      {!me && lobby && role !== "host" && shared.standIn === "ready" && !closed ? <CountryPicker lobby={lobby} notices={shared.notices} /> : null}
      {me && !lobby?.started && role !== "host" ? (
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
          {/* One sentence with the country in it, so a language puts the
              country where its grammar wants it. */}
          <span style={{ ...small, ...isolate }}>{`You play ${country}. Waiting for the host to start.`}</span>
          <button type="button" style={button} onClick={change}>Change</button>
        </div>
      ) : null}
      {changeRefused ? <div style={{ ...small, ...problemText, ...isolate, marginTop: "0.35rem" }}>{changeRefused}</div> : null}

      {error ? <div style={{ color: "#fca5a5", fontSize: "0.82rem", marginTop: "0.7rem" }}>{error}</div> : null}

      {/* What the host has said, kept (a refusal, a country gone, a change of country answered). */}
      <NoticeList notices={shared.notices} readAt={shared.noticesReadAt} limit={6} />
      </div>

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", flex: "0 0 auto", padding: "0.7rem 1.3rem 0.9rem" }}>
        {/* What the host's game is still busy with, which Start waits behind (host/worldQueue.js onSlow). */}
        {busyLine ? <div style={{ ...small, ...problemText, marginBottom: "0.45rem", textAlign: "end" }}>{busyLine}</div> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "flex-end" }}>
          <LeaveButton role={role} label="Stop sharing" />
          {role === "host" && lobby && !lobby.started ? (
            <button type="button" style={primary} disabled={starting} onClick={start}>{starting ? "Starting…" : "Start the game"}</button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

/// The bar's own look: the HUD's glass and the player's interface theme, as the
// date widget and the session pill along the game's top edge take them
// (Game/GameUI/time.jsx widgetSurface, libraryBar.jsx surfaceStyle), so it
// reads as part of the same chrome and never as a slab of its own. Under
// Default the HUD's own glass. No gradient, no motion.
const barText = "var(--oh-ui-text, var(--oh-hud-text, #f8f8f9))";
const barMuted = "var(--oh-ui-muted, var(--oh-hud-muted, rgba(233,233,236,0.64)))";
const barSurface = {
  backdropFilter: "var(--oh-hud-blur)",
  WebkitBackdropFilter: "var(--oh-hud-blur)",
  backgroundColor: "var(--oh-ui-glass-pill, var(--oh-hud-bg-strong))",
  border: "1px solid var(--oh-hud-border)",
  borderRadius: "12px",
  boxShadow: "var(--oh-hud-shadow-soft)",
  color: barText,
};
// A dropdown: the theme's floating panel, as the Events panel's (time.jsx panelSurface).
const menuSurface = {
  backdropFilter: "var(--oh-hud-blur)",
  WebkitBackdropFilter: "var(--oh-hud-blur)",
  backgroundColor: "var(--oh-ui-overlay-strong, rgba(19,19,21,0.94))",
  border: "1px solid var(--oh-ui-line, var(--oh-hud-border))",
  borderRadius: "14px",
  boxShadow: "var(--oh-hud-shadow)",
  color: barText,
};
const section = { borderTop: "1px solid var(--oh-ui-glass-line, rgba(255,255,255,0.08))", marginTop: "0.65rem", paddingTop: "0.6rem" };
const heading = { ...small, marginBottom: "0.3rem", textTransform: "uppercase" };
const lineOf = { ...small, ...isolate, lineHeight: 1.45 };
const row = { alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem" };
// What may not wrap, and gives way with "…" when the bar is short of room.
const oneLine = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
// Words a screen reader says that the screen shows as an icon.
const unseen = { border: 0, height: "1px", margin: "-1px", overflow: "hidden", padding: 0, position: "absolute", whiteSpace: "nowrap", width: "1px" };

// A count on a bar button: the notices not yet read on Players, the players
// asking to change country on Host. The accent, sparingly.
const Badge = ({ count, label }) => (count ? (
  <span
    aria-label={label}
    title={label}
    style={{ background: "var(--oh-ui-accent, #2bc1f3)", borderRadius: "999px", color: "var(--oh-ui-bg, #06141a)", fontSize: "0.64rem", fontVariantNumeric: "tabular-nums", fontWeight: 800, lineHeight: 1, minWidth: "1rem", padding: "0.16rem 0.3rem", textAlign: "center" }}
  >
    {count > 9 ? "9+" : String(count)}
  </span>
) : null);

const PeopleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const Chevron = ({ open }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "none" }}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

// A dropdown under the bar: a dialog that is not modal, which takes the focus
// when it is opened from its button. On a phone it is as wide as the screen.
const Dropdown = ({ id, label, compact, menuRef, children }) => (
  <div
    id={id}
    ref={menuRef}
    role="dialog"
    aria-label={label}
    tabIndex={-1}
    style={{
      ...menuSurface, boxSizing: "border-box", outline: "none", overflowY: "auto", overscrollBehavior: "contain",
      padding: "0.75rem 0.9rem 0.85rem", position: "absolute", top: "calc(100% + 0.4rem)",
      maxHeight: `calc(100dvh - 8rem - ${SAFE_TOP})`,
      // The bar starts beside the game's ⌂ on a phone; its dropdowns span the screen from the left gutter.
      ...(compact ? { left: `calc(-3.65rem - ${SAFE_LEFT})`, right: 0 } : { right: 0, width: "min(26rem, calc(100vw - 1rem))" }),
    }}
  >
    {children}
  </div>
);

// `watching`: the country of a player whose country is gone, who watches it
// and may take any free country under Players. `cutOff`: this page's
// connection to the host is lost (client/hostGone.js), the whole sentence.
const RoundBar = ({ shared, me, watching = "", cutOff = "" }) => {
  const { round, role, notices } = shared;
  const host = role === "host";
  // A phone's width: the row beside the game's ⌂, five things at most.
  const compact = useIsMobile();
  // Which dropdown is open: "players", "host" or none. Players is open from
  // the start for a player who watches.
  const [open, setOpen] = useState(watching ? "players" : "");
  // When the notices were read before Players was last opened: those after
  // it read as new while it is open.
  const [readBefore, setReadBefore] = useState(0);
  // And Host for the host of a game taken up again, which opens paused: its
  // players need the invite code to come back, and the game needs Resume.
  // Read from the first round status this bar is given, which may come after
  // the bar itself.
  const [roundSeen, setRoundSeen] = useState(false);
  if (!roundSeen && round) {
    setRoundSeen(true);
    if (host && round.paused && !watching) setOpen("host");
  }
  const rootRef = useRef(null);
  const playersButton = useRef(null);
  const hostButton = useRef(null);
  const menuRef = useRef(null);
  // A dropdown opened from its button takes the focus; one opened by itself
  // (above) leaves it where it is.
  const focusMenu = useRef(false);
  const toggle = (which) => {
    if (open === which) {
      setOpen("");
      return;
    }
    if (which === "players") setReadBefore(shared.noticesReadAt || 0);
    focusMenu.current = true;
    setOpen(which);
  };
  useEffect(() => {
    if (!open || !focusMenu.current) return;
    focusMenu.current = false;
    menuRef.current?.focus();
  }, [open]);
  // Closed by a click anywhere outside the bar and its dropdown, or Escape,
  // which gives the focus back to the dropdown's button.
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen("");
    };
    const escape = (event) => {
      if (event.key !== "Escape") return;
      (open === "host" ? hostButton : playersButton).current?.focus();
      setOpen("");
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const showPlayers = open === "players";
  const showHost = host && open === "host";
  // Players asking the host to change country, for the host to answer.
  const asking = host ? shared.lobby?.changes?.length ?? 0 : 0;
  // The clock is read in the timer, never while rendering: the time left, the
  // moment it was read and when this round status came are state like any other.
  const [clockState, setClockState] = useState({ remaining: 0, at: 0, since: 0 });
  useEffect(() => {
    const since = Date.now();
    const read = () => setClockState({ remaining: sharedRemainingMs(), at: Date.now(), since });
    read();
    const timer = setInterval(read, 500);
    return () => clearInterval(timer);
  }, [round]);
  const phase = round?.phase ?? "";
  const planning = phase === "planning" || phase === "countdown";
  // A round that failed or was cancelled waits for the host to run it again:
  // being ready counts for nothing until then.
  const waitingForRetry = waitsForTheHost(round);
  const ready = Boolean(me && round?.ready?.includes(me));
  const elapsed = (Number(round?.elapsedMs) || 0) + Math.max(0, clockState.at - clockState.since);
  const clockText = roundClockText({ round, role, remaining: clockState.remaining, elapsed });
  // The clock says who the round waits for, not a time: in the dropdowns, and a mark on the bar.
  const clockInWords = waitingForRetry || Boolean(round?.paused && round?.hostAway && phase !== "resolving");
  // The game's date, and where the round lands (client/roundDates.js); while a
  // landed round is read, where the next one lands.
  const dates = roundDatesOf(shared.date, shared.lobby?.settings?.daysPerRound);
  const datesText = !dates ? "" : !dates.lands ? dates.now : dates.days === 1 ? `${dates.now} → ${dates.lands} (1 day)` : `${dates.now} → ${dates.lands} (${dates.days} days)`;
  const latest = notices?.at(-1);
  const recent = latest && clockState.at - latest.at < NOTICE_SHOWN_MS ? latest : null;
  const unread = unreadNotices(notices, shared.noticesReadAt);
  // Open, the list is in view: what comes is read.
  useEffect(() => {
    if (showPlayers && unread) markNoticesRead();
  }, [showPlayers, unread]);
  // The host's answer to Ready, when it refuses ("Not now: …"), for the round it was pressed in.
  const [readyRefused, setReadyRefused] = useState({ round: 0, text: "" });
  const sayReady = async () => {
    const asked = Number(round?.round) || 0;
    setReadyRefused({ round: 0, text: "" });
    const answer = await sharedRequest("ready", { value: !ready });
    if (!answer.ok) setReadyRefused({ round: asked, text: answer.error || "The host did not take that." });
  };
  const busyLine = host ? hostBusyLine(shared.engine?.busy) : "";
  const watchingText = watching ? `${watching} is gone: you are watching. Take a free country under Players.` : "";
  // The one short mark for a state out of the ordinary (roundBar.js), its sentence in its title and in the dropdown it opens.
  const status = barStatus({ round, role, cutOff, watching: watchingText, busyLine });
  const step = phase === "resolving" && round?.step?.label ? round.step : null;
  // One short line under the bar, for a moment: the host's answer to Ready, or its newest notice.
  const refused = readyRefused.text && readyRefused.round === round?.round && planning ? readyRefused.text : "";
  const note = refused ? { text: refused, problem: true } : recent && !open ? { text: recent.text, problem: recent.level === "warn" } : null;

  const barButton = { ...button, flexShrink: 0, fontSize: "0.76rem", minHeight: "1.75rem", padding: compact ? "0 0.45rem" : "0 0.7rem" };
  const chosen = (on) => (on ? { ...barButton, ...primary, fontSize: barButton.fontSize, minHeight: barButton.minHeight, padding: barButton.padding } : barButton);
  // The phone's row holds the round, a clock or the mark, Ready, Players and Host.
  const showClock = Boolean(clockText) && !clockInWords && !(compact && status);

  // Where the round is, in words: at the head of Players, for everyone.
  const roundLines = (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
      {cutOff ? <span role="status" style={{ ...lineOf, ...problemText }}>{cutOff}</span> : null}
      {round && planning && !waitingForRetry ? <span style={lineOf}>{readyText(round)}</span> : null}
      {datesText ? <span style={lineOf}>{datesText}</span> : null}
      {clockInWords && clockText ? <span style={lineOf}>{clockText}</span> : null}
      {round?.failed ? <span style={{ ...lineOf, ...problemText }}>{failureText(round)}</span> : null}
      {step?.detail ? <span style={lineOf}>{`${step.label} ${step.detail}`}</span> : null}
      {/* Whose device makes this round's request, when players take turns to pay. */}
      <PayerLine shared={shared} me={me} style={{ textAlign: "start" }} />
      {watchingText ? <span style={lineOf}>{watchingText}</span> : null}
      <span style={{ alignSelf: "flex-start" }}><GameMasterMark shared={shared} /></span>
    </div>
  );

  const playersMenu = showPlayers ? (
    <Dropdown id="oh-shared-players" label="Players" compact={compact} menuRef={menuRef}>
      {roundLines}
      <div style={section}>
        <SeatList seats={shared.lobby?.seats} ready={round?.ready ?? []} />
        {(!host || watching) && (me || watching) ? <CountryPicker lobby={shared.lobby} asking={Boolean(me)} notices={notices} /> : null}
      </div>
      <GameMasterChanges shared={shared} />
      <NoticeList notices={notices} readAt={readBefore} />
      {host ? null : (
        <div style={{ ...section, display: "flex", justifyContent: "flex-end" }}>
          <LeaveButton role={role} label="Leave" />
        </div>
      )}
    </Dropdown>
  ) : null;

  // Every one of the host's controls, and nothing that is not one.
  const hands = (shared.lobby?.seats ?? []).some(inHostsHand);
  const settings = shared.lobby?.settings;
  const hostMenu = showHost ? (
    <Dropdown id="oh-shared-host" label="Host controls" compact={compact} menuRef={menuRef}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
        {clockInWords && clockText ? <span style={lineOf}>{clockText}</span> : null}
        {/* A round that could not be resolved, or was cancelled, said until one lands (round.js). */}
        {round?.failed ? <span style={{ ...lineOf, ...problemText }}>{failureText(round)}</span> : null}
        {/* What the host's game is still busy with, which every request waits behind (host/worldQueue.js onSlow). */}
        {busyLine ? <span style={{ ...lineOf, ...problemText }}>{busyLine}</span> : null}
        <div style={row}>
          {planning && !waitingForRetry ? (
            <>
              <button type="button" style={round?.paused ? primary : button} onClick={() => hostControl(round?.paused ? "resume" : "pause")}>{round?.paused ? "Resume" : "Pause"}</button>
              <button type="button" style={button} onClick={() => hostControl("resolveNow")}>End round now</button>
            </>
          ) : null}
          {round?.failed && planning ? <button type="button" style={primary} onClick={() => hostControl("resolveNow")}>Try again now</button> : null}
          {round?.failed ? <PayItYourself shared={shared} /> : null}
          {/* A round being resolved, called off by the host (gameHost.js cancelRound). */}
          {phase === "resolving" ? <button type="button" style={button} onClick={() => hostControl("cancelRound")}>Cancel round</button> : null}
        </div>
      </div>
      {asking || hands ? (
        <div style={section}>
          <div style={heading}>Players</div>
          <ChangeRequests changes={shared.lobby?.changes} />
          <SeatList seats={shared.lobby?.seats} host handsOnly />
        </div>
      ) : null}
      <div style={section}><HostInvite shared={shared} /></div>
      <div style={section}>
        <RepliesSetting shared={shared} style={{ justifyContent: "flex-start", marginTop: 0 }} />
        {settings?.replies === "own" ? <HostAnswersSetting settings={settings} /> : null}
        {/* The host's command to the Game Master, where the game allows it. */}
        <div style={{ marginTop: "0.55rem" }}><GameMasterBox shared={shared} /></div>
      </div>
      <div style={{ ...section, display: "flex", justifyContent: "flex-end" }}>
        <LeaveButton role={role} label="Stop sharing" />
      </div>
    </Dropdown>
  ) : null;

  const roundName = `Round ${round?.round ?? "–"} · ${PHASES[phase] ?? "…"}`;
  return (
    <div
      ref={rootRef}
      style={{
        boxSizing: "border-box", fontFamily: "inherit", position: "fixed",
        // Under the game's top edge (the date widget and the session pill, 0.5rem from the top and 3.5rem tall), as
        // wide as what it holds and centred; on a phone, the row beside the game's ⌂ (libraryBar.jsx), across to the
        // screen's edge. Over the map and under the HUD, but an open dropdown over the panels it opens on.
        top: compact ? `calc(4rem + ${SAFE_TOP})` : `calc(4.4rem + ${SAFE_TOP})`,
        ...(compact
          ? { left: `calc(4.15rem + ${SAFE_LEFT})`, right: `calc(0.5rem + ${SAFE_RIGHT})` }
          : { left: 0, right: 0, marginInline: "auto", width: "fit-content", maxWidth: "calc(100vw - 1rem)" }),
        zIndex: open ? 9998 : 3500,
      }}
    >
      <div style={{ position: "relative" }}>
        <div
          role="toolbar"
          aria-label="Shared game"
          style={{
            ...barSurface, alignItems: "center", boxSizing: "border-box", display: "flex", flexWrap: "nowrap",
            gap: compact ? "0.25rem" : "0.45rem", minHeight: "2.3rem", minWidth: 0,
            padding: compact ? "0.22rem 0.25rem 0.22rem 0.5rem" : "0.22rem 0.3rem 0.22rem 0.85rem",
          }}
        >
          {/* On a phone the round alone: its phase is in the title, and in words at the head of Players. */}
          <span style={{ ...oneLine, flexShrink: 1, fontSize: "0.78rem", fontWeight: 750 }} title={roundName}>{compact ? `Round ${round?.round ?? "–"}` : roundName}</span>
          {showClock ? <span style={{ color: round?.paused ? barMuted : barText, flexShrink: 0, fontSize: "0.78rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{clockText}</span> : null}
          {/* Where the round lands; the date now and the days between in its title and under Players. */}
          {!compact && dates?.lands ? <span style={{ ...small, ...isolate, ...oneLine, flexShrink: 2, fontSize: "0.72rem" }} title={datesText}>{`Lands on ${dates.lands}`}</span> : null}
          {/* What the round's skip is doing now, in single player's words (Game/AI/skipPhases.js). */}
          {step ? <span style={{ ...small, ...oneLine, flexShrink: 3, fontSize: "0.72rem", maxWidth: compact ? "none" : "14rem" }} title={step.detail ? `${step.label} ${step.detail}` : step.label}>{step.label}</span> : null}
          {status ? (
            <button
              type="button"
              title={status.title}
              aria-label={status.title}
              onClick={() => (open === status.opens ? null : toggle(status.opens))}
              style={{
                ...button, ...oneLine, display: "inline-block", flexShrink: 1, fontSize: "0.7rem", fontWeight: 650, lineHeight: "1.45rem", minHeight: "1.5rem", padding: compact ? "0 0.45rem" : "0 0.55rem",
                ...(status.problem ? { ...problemText, border: "1px solid rgba(252,165,165,0.45)" } : { color: barMuted }),
              }}
            >
              {compact && status.short ? status.short : status.label}
            </button>
          ) : null}
          {/* On a phone Ready, Players and Host keep to the right edge, where the thumb finds them each time. */}
          {compact ? <span aria-hidden="true" style={{ flex: "1 1 0", minWidth: 0 }} /> : <GameMasterMark shared={shared} compact />}
          {planning && me && !waitingForRetry ? (
            <button type="button" style={chosen(ready)} aria-pressed={ready} onClick={sayReady}>{ready ? "Ready ✓" : compact ? "Ready" : "I'm ready"}</button>
          ) : null}
          <button
            ref={playersButton}
            type="button"
            style={chosen(showPlayers)}
            aria-expanded={showPlayers}
            aria-haspopup="dialog"
            aria-controls={showPlayers ? "oh-shared-players" : undefined}
            title={compact ? "Players" : undefined}
            onClick={() => toggle("players")}
          >
            {compact ? <><PeopleIcon /><span style={unseen}>Players</span></> : "Players"}
            <Badge count={showPlayers ? 0 : unread} label={unreadLabel(unread)} />
          </button>
          {host ? (
            <button
              ref={hostButton}
              type="button"
              style={chosen(showHost)}
              aria-expanded={showHost}
              aria-haspopup="dialog"
              aria-controls={showHost ? "oh-shared-host" : undefined}
              onClick={() => toggle("host")}
            >
              Host
              <Badge count={asking} label={askingLabel(asking)} />
              {compact ? null : <Chevron open={showHost} />}
            </button>
          ) : null}
        </div>
        {playersMenu}
        {hostMenu}
      </div>
      {note ? (
        <div
          role="status"
          title={note.text}
          style={{
            ...barSurface, ...small, ...isolate, ...oneLine, borderRadius: "10px", boxSizing: "border-box", contain: "inline-size",
            marginTop: "0.3rem", padding: "0.25rem 0.7rem", textAlign: "center", ...(note.problem ? problemText : null),
          }}
        >
          {note.text}
        </div>
      ) : null}
    </div>
  );
};

// The overlay for a shared game's state as client/sharedGame.js keeps it.
export function SharedGameView({ shared }) {
  if (!shared || shared.mode === "off") return null;
  const mine = shared.lobby?.seats?.find((seat) => seat.you) ?? null;
  // The country this player plays, or the one they watch now that it is gone.
  const me = mine && !["ai", "watching"].includes(mine.status) ? mine.country : "";
  const watching = mine?.status === "watching" ? mine.country : "";
  if (shared.mode === "ended") {
    // Centred by its margins, as wide as its words up to the screen's (a
    // transform left it half the screen to lay out in).
    return (
      <div style={{ ...glass, boxSizing: "border-box", left: 0, marginInline: "auto", maxWidth: "min(30rem, calc(100vw - 2rem))", padding: "1rem 1.2rem", position: "fixed", right: 0, top: "15vh", width: "fit-content", zIndex: 4000 }}>
        <div style={{ fontWeight: 750 }}>The shared game ended</div>
        <div style={{ ...small, margin: "0.4rem 0 0.8rem" }}>{shared.error || "The connection closed."}</div>
        {/* A game that ended: the page is out of it already, or being taken out (client/sharedGame.js endForThisPage), and
            OK only puts the word away. Only the host's screen whose engine window stopped answering keeps its game open
            (a busy window must not end it for every player): its host leaves itself. A page whose game is open has a role. */}
        {shared.leaving ? null : shared.role ? (
          <button type="button" style={button} onClick={leave}>Leave</button>
        ) : (
          <button type="button" style={button} onClick={dismissEndedNotice}>OK</button>
        )}
      </div>
    );
  }
  const started = Boolean(shared.lobby?.started);
  const inGame = started && (me || watching);
  // Cut off from the host: said at once, over whatever the guest is doing
  // (client/hostGone.js), until it is back in the game: a reconnection passes through "joining". Nothing it does is taken meanwhile.
  // In the game, the round bar's mark says it; over the lobby, a line of its own.
  const cutOff = shared.role === "guest" && shared.cutOff ? (
    <div role="status" style={{ ...glass, ...small, ...problemText, boxSizing: "border-box", left: 0, marginInline: "auto", maxWidth: "calc(100vw - 2rem)", padding: "0.45rem 0.9rem", position: "fixed", right: 0, top: "calc(0.5rem + env(safe-area-inset-top, 0px))", width: "fit-content", zIndex: 4100 }}>
      {RECONNECTING}
    </div>
  ) : null;
  return (
    <>
      {inGame ? null : cutOff}
      {inGame ? <RoundBar shared={shared} me={me} watching={watching} cutOff={cutOff ? RECONNECTING : ""} /> : <Lobby shared={shared} me={me} />}
    </>
  );
}

export default function SharedGameOverlay() {
  const shared = useSharedGame();
  return <SharedGameView shared={shared} />;
}
