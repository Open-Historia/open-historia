/*! Open Historia — a shared game's lobby and round bar © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Over the game while a shared game is open (client/sharedGame.js):
//   - the lobby: who plays what, a country to take, and for the host the invite
//     token to send and the button that starts the game. Until the host's
//     lobby has arrived, a player is told which step of joining they are on,
//     and the host is told who is connecting and who could not
//     (client/joinProgress.js);
//   - once it has started, the round bar: where the round is, how long is left,
//     who is ready, and the player's own Ready. The host also has pause and
//     "end the round now", answers players who ask to change country, and
//     releases or bans a seat a player holds (a seat is its player's device's
//     until the host releases it). A player whose country is gone watches,
//     and takes a free country under Players;
//   - the host's notices: the newest for a moment on the bar, and every one
//     kept, listed under Players (and in the lobby), those not yet read
//     counted on the Players button; a refusal or answer said where the
//     player acted too (Ready, Change, the country picker, the Game Master);
//   - Leave, and for the host Stop, which asks once more: it ends the game
//     for every player.
// The bar is as wide as what it holds, up to the screen's width; on a phone
// it is one row (the round, its clock, Ready and Players) and the rest is
// under Players.
// Mounted by App.jsx outside the game's UI, so it survives the UI remounting
// when the page switches to the shared game.

import React, { useEffect, useMemo, useState } from "react";
import {
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
import { failureText, readyText, roundClockText, unreadLabel, waitsForTheHost } from "./roundBar.js";
import { languageDisplayName } from "../../runtime/i18n.js";
import { difficultyMeta } from "../../runtime/difficulty.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { GameMasterBox, GameMasterMark, GameRules, PayItYourself, PayerLine } from "./GameRules.jsx";
import { roundCostLinesOf } from "../costRules.js";

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
  justifyContent: "center", minHeight: "2rem", padding: "0 0.75rem",
};
const primary = { ...button, background: "rgba(43,193,243,0.2)", borderColor: "rgba(43,193,243,0.6)", color: "#e6f8ff" };
const small = { color: "rgba(255,255,255,0.6)", fontSize: "0.76rem" };
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

// Who plays what: the lobby's list, and the round bar's when it is opened ("how
// can I see who is playing?", a player asked mid-game). `ready` marks those
// who are ready in the round; `host` gives the host its hand on each seat
// another player holds.
const SeatList = ({ seats, ready = [], host = false }) => (seats ?? []).map((seat) => (
  <div key={`${seat.status}:${seat.country}`} style={{ alignItems: "center", display: "flex", flexWrap: "wrap", fontSize: "0.86rem", gap: "0.5rem", padding: "0.2rem 0" }}>
    <span style={{ ...isolate, flex: 1 }}>{seat.country}</span>
    <span style={{ ...isolate, color: "rgba(255,255,255,0.6)" }}>{seat.you ? `${seat.name} (you)` : seat.name}</span>
    <span style={small}>{seatState(seat, ready)}</span>
    {host && seat.held && !seat.you && seat.status !== "watching" ? <SeatActions country={seat.country} /> : null}
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
const RepliesSetting = ({ shared }) => {
  if (!shared.lobby) return null;
  const mode = shared.lobby.settings?.replies === "own" ? "own" : "host";
  // A player is told under "Who pays" (ui/GameRules.jsx), with what the host's
  // AI still answers: "Countries the AI plays answer your messages with your
  // own AI key" was said here, and some of them never did.
  if (shared.role !== "host") return null;
  // At the end of its row: during a game the Events panel lies over the start
  // of the round bar's lower rows, and covered the start of this one.
  return (
    <label style={{ ...small, alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.5rem" }}>
      Countries the AI plays answer with
      <select value={mode} onChange={(event) => hostControl("replies", { mode: event.target.value })} style={{ ...button, justifyContent: "flex-start" }}>
        <option value="host">Your AI key</option>
        <option value="own">Each player&apos;s own AI key</option>
      </select>
    </label>
  );
};

// The language the world is written in, a rule of the game the host set in
// the lobby (host/settings.js `language`), for everyone to see.
const WorldLanguage = ({ shared }) => {
  const code = String(shared.lobby?.settings?.language || "");
  if (!code) return null;
  return <div style={{ ...small, marginTop: "0.5rem", textAlign: "end" }}>{`The world is written in ${languageDisplayName(code)}.`}</div>;
};

// What decides every round, as the host states it (game/messages.js lobby
// `rules`, host/hostRules.js): one difficulty for every player, what a round
// costs and how long it waits on a silent AI, by who pays for it
// (multiplayer/costRules.js roundCostLinesOf), how long a leaver's country
// waits for them, and what a shared game does not do between rounds. On the
// host's computer alone, these used to be nobody else's to see.
const betweenRoundsLine = (features) => {
  const letters = features?.idleDiplomacy?.enabled !== false;
  const agents = features?.espionage?.enabled !== false;
  if (letters && agents) return "Between rounds no country writes and no agent reports: both come with each round.";
  if (letters) return "Between rounds no country writes: letters come with each round.";
  if (agents) return "Between rounds no agent reports: reports come with each round.";
  return "";
};
const RoundRules = ({ shared }) => {
  const lobby = shared.lobby;
  if (!lobby) return null;
  const rules = lobby.rules;
  const grace = Number(lobby.settings?.leaverGraceMinutes) || 0;
  const lines = [
    rules ? `Difficulty: ${difficultyMeta(rules.difficulty).label} for every player against the countries the AI plays; between players it favours nobody.` : "",
    ...roundCostLinesOf(rules, lobby.settings),
    grace
      ? `A player who leaves keeps their country for ${grace} minutes; then the AI plays it until they are back.`
      : "A player who leaves has their country played by the AI until they are back.",
    betweenRoundsLine(lobby.features),
  ].filter(Boolean);
  return lines.map((line) => <div key={line} style={{ ...small, marginTop: "0.35rem", textAlign: "end" }}>{line}</div>);
};

// The host's invite code, its relays, and who is coming in or could not
// (client/joinProgress.js): in the lobby, and under Players while the game
// runs, where a game taken up again opens and its players need the code to
// come back.
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
        <code style={{ background: "rgba(255,255,255,0.06)", borderRadius: "8px", flex: 1, fontSize: "0.72rem", minWidth: 0, overflow: "hidden", padding: "0.45rem 0.6rem", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{token}</code>
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

  return (
    <div style={{ ...glass, left: "50%", maxHeight: "80vh", maxWidth: "min(34rem, calc(100vw - 2rem))", overflowY: "auto", padding: "1.2rem 1.3rem", position: "fixed", top: "12vh", transform: "translateX(-50%)", width: "100%", zIndex: 4000 }}>
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
        <WorldLanguage shared={shared} />
        {/* What decides every round (host/hostRules.js), then who pays for what and the Game Master (multiplayer/costRules.js). */}
        <RoundRules shared={shared} />
        <GameRules shared={shared} />
      </div>

      {!me && lobby && role !== "host" && shared.standIn !== "ready" && !error ? (
        <div style={{ ...small, marginTop: "1rem" }}>Setting up the map…</div>
      ) : null}
      {!me && lobby && role !== "host" && shared.standIn === "ready" && closed ? (
        <div style={{ ...small, marginTop: "1rem" }}>{REFUSAL_LABELS["game-started"]}</div>
      ) : null}
      {!me && lobby && role !== "host" && shared.standIn === "ready" && !closed ? <CountryPicker lobby={lobby} notices={shared.notices} /> : null}
      {me && !lobby?.started ? (
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
          {/* One sentence with the country in it, so a language puts the
              country where its grammar wants it ("You play" and ". Start
              when everyone is in." were pieces either side of it). */}
          <span style={{ ...small, ...isolate }}>{role === "host" ? `You play ${country}. Start when everyone is in.` : `You play ${country}. Waiting for the host to start.`}</span>
          {role !== "host" ? <button type="button" style={button} onClick={change}>Change</button> : null}
        </div>
      ) : null}
      {changeRefused ? <div style={{ ...small, ...problemText, ...isolate, marginTop: "0.35rem" }}>{changeRefused}</div> : null}

      {error ? <div style={{ color: "#fca5a5", fontSize: "0.82rem", marginTop: "0.7rem" }}>{error}</div> : null}

      {/* What the host has said, kept (a refusal, a country gone, a change of country answered). */}
      <NoticeList notices={shared.notices} readAt={shared.noticesReadAt} limit={6} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1.1rem" }}>
        <LeaveButton role={role} label="Stop sharing" />
        {role === "host" && lobby && !lobby.started ? <button type="button" style={primary} onClick={() => hostControl("start")}>Start the game</button> : null}
      </div>
    </div>
  );
};

// The notices not yet read, counted on the Players button.
const Unread = ({ count }) => (count ? (
  <span
    aria-label={unreadLabel(count)}
    title={unreadLabel(count)}
    style={{ background: "#2bc1f3", borderRadius: "999px", color: "#06141a", fontSize: "0.66rem", fontVariantNumeric: "tabular-nums", fontWeight: 800, lineHeight: 1, minWidth: "1.05rem", padding: "0.18rem 0.32rem", textAlign: "center" }}
  >
    {count > 9 ? "9+" : String(count)}
  </span>
) : null);

// `watching`: the country of a player whose country is gone, who watches it
// and may take any free country under Players.
const RoundBar = ({ shared, me, watching = "" }) => {
  const { round, role, notices } = shared;
  // A phone's width: one row, and the rest under Players.
  const compact = useIsMobile();
  // Open from the start for a player who watches.
  const [showPlayers, setShowPlayers] = useState(Boolean(watching));
  // When the notices were read before the list was last opened: those after
  // it read as new while it is open.
  const [readBefore, setReadBefore] = useState(0);
  // And for the host of a game taken up again, which opens paused: its players
  // need the invite code to come back. Read from the first round status this
  // bar is given, which may come after the bar itself.
  const [roundSeen, setRoundSeen] = useState(false);
  if (!roundSeen && round) {
    setRoundSeen(true);
    if (role === "host" && round.paused) setShowPlayers(true);
  }
  const togglePlayers = () => {
    if (!showPlayers) setReadBefore(shared.noticesReadAt || 0);
    setShowPlayers(!showPlayers);
  };
  // Players asking the host to change country, for the host to answer.
  const asking = role === "host" ? shared.lobby?.changes?.length ?? 0 : 0;
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
  // The clock says who the round waits for, not a time.
  const clockInWords = waitingForRetry || Boolean(round?.paused && round?.hostAway && phase !== "resolving");
  // The game's date, and where the round lands (client/roundDates.js); while a
  // landed round is read, where the next one lands.
  const dates = roundDatesOf(shared.date, shared.lobby?.settings?.daysPerRound);
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

  const dateSpan = dates ? (
    <span style={{ ...small, ...isolate }} title="The game's date now, and the date the round lands on">
      {!dates.lands ? dates.now : dates.days === 1 ? `${dates.now} → ${dates.lands} (1 day)` : `${dates.now} → ${dates.lands} (${dates.days} days)`}
    </span>
  ) : null;
  // Who is ready, while being ready counts for something.
  const readySpan = round && planning && !waitingForRetry ? <span style={small}>{readyText(round)}</span> : null;
  const hostControls = role === "host" ? (
    <>
      {planning && !waitingForRetry ? (
        <>
          <button type="button" style={button} onClick={() => hostControl(round?.paused ? "resume" : "pause")}>{round?.paused ? "Resume" : "Pause"}</button>
          <button type="button" style={button} onClick={() => hostControl("resolveNow")}>End round now</button>
        </>
      ) : null}
      {/* A round being resolved, called off by the host (gameHost.js cancelRound). */}
      {phase === "resolving" ? <button type="button" style={button} onClick={() => hostControl("cancelRound")}>Cancel round</button> : null}
    </>
  ) : null;
  const step = phase === "resolving" && round?.step?.label ? round.step : null;
  // A line under the bar's row, as wide as the row and no wider: its words
  // wrap there (contain: inline-size), and never widen the bar to the screen's edge.
  const row = { ...small, contain: "inline-size", textAlign: "center" };
  // On a phone the bar's buttons are a little tighter, and its row never wraps:
  // the round's name gives way first (it ends in "…"), never Ready or Players.
  const barButton = compact ? { ...button, padding: "0 0.6rem" } : button;

  return (
    <div
      style={{
        ...glass, display: "flex", flexDirection: "column", gap: "0.35rem",
        // As wide as what it holds, up to the screen's width, and centred. It
        // was centred with left: 50% and a transform, which left it half the
        // screen to lay out in: two or three rows on a desktop, and on a phone
        // a narrow column of a dozen rows over the map.
        left: 0, right: 0, marginInline: "auto", width: "fit-content", maxWidth: "calc(100vw - 1.5rem)", boxSizing: "border-box",
        padding: compact ? "0.35rem 0.35rem 0.35rem 0.7rem" : "0.45rem 0.6rem 0.45rem 0.9rem",
        position: "fixed", top: "calc(3.4rem + env(safe-area-inset-top, 0px))", zIndex: 3500,
      }}
    >
      <div style={{ alignItems: "center", display: "flex", flexWrap: compact ? "nowrap" : "wrap", gap: compact ? "0.35rem" : "0.5rem", minWidth: 0 }}>
        <span style={{ fontSize: "0.82rem", fontWeight: 750, ...(compact ? { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : null) }}>Round {round?.round ?? "–"} · {PHASES[phase] ?? "…"}</span>
        {clockText && !(compact && clockInWords) ? <span style={{ flexShrink: 0, fontSize: "0.82rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", ...(waitingForRetry || round?.paused ? small : null) }}>{clockText}</span> : null}
        {compact ? null : <>{dateSpan}{readySpan}<GameMasterMark shared={shared} /></>}
        {planning && me && !waitingForRetry ? (
          <button type="button" style={{ ...(ready ? { ...barButton, ...primary, padding: barButton.padding } : barButton), flexShrink: 0 }} onClick={sayReady}>{ready ? "Ready ✓" : compact ? "Ready" : "I'm ready"}</button>
        ) : null}
        {compact ? null : hostControls}
        <button type="button" style={{ ...(showPlayers || asking ? { ...barButton, ...primary, padding: barButton.padding } : barButton), flexShrink: 0 }} aria-expanded={showPlayers} onClick={togglePlayers}>
          {asking ? `Players (${asking} asking)` : "Players"}
          <Unread count={showPlayers ? 0 : unread} />
        </button>
        {compact ? null : <LeaveButton role={role} label="Stop" />}
      </div>
      {/* On a phone, a clock that is words (who the round waits for) is a line of its own. */}
      {compact && clockInWords && clockText ? <span style={row}>{clockText}</span> : null}
      {/* What the round's skip is doing now, in single player's words (Game/AI/skipPhases.js). */}
      {step ? (
        <span style={{ ...row, display: "flex", flexWrap: "wrap", gap: "0.35rem", justifyContent: "center" }}>
          <span>{step.label}</span>
          {step.detail ? <span>{step.detail}</span> : null}
        </span>
      ) : null}
      {readyRefused.text && readyRefused.round === round?.round && planning ? <span style={{ ...row, ...problemText, ...isolate }}>{readyRefused.text}</span> : null}
      {round?.failed ? (
        // A round that could not be resolved, or was cancelled, said until one lands (round.js).
        <span style={{ ...row, ...problemText, alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "center" }}>
          <span style={isolate}>{failureText(round)}</span>
          {role === "host" && planning ? <button type="button" style={button} onClick={() => hostControl("resolveNow")}>Try again now</button> : null}
          <PayItYourself shared={shared} />
        </span>
      ) : null}
      {/* Whose device makes this round's request, when players take turns to pay. */}
      <PayerLine shared={shared} me={me} />
      {watching ? <span style={{ ...row, ...isolate }}>{`${watching} is gone: you are watching. Take a free country under Players.`}</span> : null}
      {recent && !showPlayers ? <span style={{ ...row, ...isolate, ...(recent.level === "warn" ? problemText : null) }}>{recent.text}</span> : null}
      {showPlayers ? (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", contain: "inline-size", maxHeight: compact ? "min(62vh, 34rem)" : "40vh", minWidth: compact ? 0 : "min(30rem, calc(100vw - 3rem))", overflowY: "auto", paddingTop: "0.3rem" }}>
          {/* On a phone, what the bar's one row leaves out. */}
          {compact ? (
            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem", paddingBottom: "0.45rem" }}>
              {dateSpan}{readySpan}<GameMasterMark shared={shared} />{hostControls}<LeaveButton role={role} label="Stop" />
            </div>
          ) : null}
          {role === "host" ? <ChangeRequests changes={shared.lobby?.changes} /> : null}
          <SeatList seats={shared.lobby?.seats} ready={round?.ready ?? []} host={role === "host"} />
          <NoticeList notices={notices} readAt={readBefore} />
          {role === "host" ? <HostInvite shared={shared} /> : null}
          {(role !== "host" || watching) && (me || watching) ? <CountryPicker lobby={shared.lobby} asking={Boolean(me)} notices={notices} /> : null}
          <RepliesSetting shared={shared} />
          <WorldLanguage shared={shared} />
          <RoundRules shared={shared} />
          <GameRules shared={shared} />
          {/* The host's command to the Game Master, where the game allows it. */}
          <div style={{ marginTop: "0.6rem" }}><GameMasterBox shared={shared} /></div>
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
        <button type="button" style={button} onClick={leave}>Back to my games</button>
      </div>
    );
  }
  const started = Boolean(shared.lobby?.started);
  return started && (me || watching) ? <RoundBar shared={shared} me={me} watching={watching} /> : <Lobby shared={shared} me={me} />;
}

export default function SharedGameOverlay() {
  const shared = useSharedGame();
  return <SharedGameView shared={shared} />;
}
