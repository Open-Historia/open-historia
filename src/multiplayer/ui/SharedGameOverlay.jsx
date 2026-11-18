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
import { OWN_MAP_NOTE, hostLines, joinStage } from "../client/joinProgress.js";
import { languageDisplayName } from "../../runtime/i18n.js";

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
const problemText = { color: "#fca5a5" };

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
};

// A free country to take. `asking`: the player already plays one and the game
// is under way, so the change is asked of the host, who allows it or not.
const CountryPicker = ({ lobby, asking = false }) => {
  // A country another player holds is not free, whoever minds it now.
  const held = useMemo(() => new Set((lobby?.seats ?? []).filter((seat) => seat.held).map((seat) => seat.country)), [lobby]);
  const free = (lobby?.countries ?? []).filter((country) => !held.has(country));
  const [choice, setChoice] = useState("");
  const [status, setStatus] = useState({ text: "", problem: false });
  const pick = async () => {
    setStatus({ text: "", problem: false });
    const answer = await sharedRequest("pick", { country: choice });
    if (!answer.ok) setStatus({ text: REFUSAL_LABELS[answer.error] || answer.error || "The host refused.", problem: true });
    else if (answer.result?.asked) setStatus({ text: `You asked the host to let you play ${answer.result.asked}.`, problem: false });
  };
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
    </>
  );
};

// Who answers a player's message to a country the AI plays (host/settings.js
// `replies`). The host sets it, here too while the game runs; everyone else is
// told when it is their own AI that answers, since they need one set up.
const RepliesSetting = ({ shared }) => {
  if (!shared.lobby) return null;
  const mode = shared.lobby.settings?.replies === "own" ? "own" : "host";
  if (shared.role !== "host") {
    return mode === "own" ? <div style={{ ...small, marginTop: "0.5rem", textAlign: "end" }}>Countries the AI plays answer your messages with your own AI key.</div> : null;
  }
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
      {/* Players' names are in these lines: never text for the translator. */}
      {people.map((line) => (
        <div key={line.text} data-no-translate="" style={{ ...small, ...isolate, ...(line.problem ? problemText : null), marginTop: "0.35rem" }}>{line.text}</div>
      ))}
    </div>
  );
};

const Lobby = ({ shared, me }) => {
  const { lobby, role, error } = shared;
  // Which step of joining this is, once it is past looking for the host.
  const stage = lobby ? "" : joinStage(shared);
  const waiting = !lobby && role !== "host" && !error;

  // Under way, where the host lets nobody new in: nothing to choose.
  const closed = Boolean(lobby?.started) && lobby?.settings?.allowMidGameJoin === false;

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
      </div>

      {!me && lobby && role !== "host" && shared.standIn !== "ready" && !error ? (
        <div style={{ ...small, marginTop: "1rem" }}>Setting up the map…</div>
      ) : null}
      {!me && lobby && role !== "host" && shared.standIn === "ready" && closed ? (
        <div style={{ ...small, marginTop: "1rem" }}>{REFUSAL_LABELS["game-started"]}</div>
      ) : null}
      {!me && lobby && role !== "host" && shared.standIn === "ready" && !closed ? <CountryPicker lobby={lobby} /> : null}
      {me && !lobby?.started ? (
        <div style={{ ...small, marginTop: "1rem" }}>
          You play <span style={isolate}>{me}</span>. {role === "host" ? "Start when everyone is in." : "Waiting for the host to start."}
          {role !== "host" ? <button type="button" style={{ ...button, marginLeft: "0.5rem" }} onClick={() => sharedRequest("unpick")}>Change</button> : null}
        </div>
      ) : null}

      {error ? <div style={{ color: "#fca5a5", fontSize: "0.82rem", marginTop: "0.7rem" }}>{error}</div> : null}

      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1.1rem" }}>
        <button type="button" style={button} onClick={leave}>{role === "host" ? "Stop sharing" : "Leave"}</button>
        {role === "host" && lobby && !lobby.started ? <button type="button" style={primary} onClick={() => hostControl("start")}>Start the game</button> : null}
      </div>
    </div>
  );
};

// `watching`: the country of a player whose country is gone, who watches it
// and may take any free country under Players.
const RoundBar = ({ shared, me, watching = "" }) => {
  const { round, role, notices } = shared;
  // Open from the start for a player who watches.
  const [showPlayers, setShowPlayers] = useState(Boolean(watching));
  // And for the host of a game taken up again, which opens paused: its players
  // need the invite code to come back. Read from the first round status this
  // bar is given, which may come after the bar itself.
  const [roundSeen, setRoundSeen] = useState(false);
  if (!roundSeen && round) {
    setRoundSeen(true);
    if (role === "host" && round.paused) setShowPlayers(true);
  }
  // Players asking the host to change country, for the host to answer.
  const asking = role === "host" ? shared.lobby?.changes?.length ?? 0 : 0;
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
      {timed ? <span style={{ fontVariantNumeric: "tabular-nums", fontSize: "0.82rem" }}>{round?.paused ? "Paused" : clock(clockState.remaining)}</span> : null}
      <span style={small}>{round ? `${round.ready?.length ?? 0} of ${round.counted ?? 0} ready${round.needed ? ` (countdown at ${round.needed})` : ""}` : ""}</span>
      {["planning", "countdown"].includes(round?.phase) && me ? (
        <button type="button" style={ready ? primary : button} onClick={() => sharedRequest("ready", { value: !ready })}>{ready ? "Ready ✓" : "I'm ready"}</button>
      ) : null}
      {role === "host" && ["planning", "countdown"].includes(round?.phase) ? (
        <>
          <button type="button" style={button} onClick={() => hostControl(round?.paused ? "resume" : "pause")}>{round?.paused ? "Resume" : "Pause"}</button>
          <button type="button" style={button} onClick={() => hostControl("resolveNow")}>End round now</button>
        </>
      ) : null}
      <button type="button" style={showPlayers || asking ? primary : button} aria-expanded={showPlayers} onClick={() => setShowPlayers((open) => !open)}>{asking ? `Players (${asking} asking)` : "Players"}</button>
      <button type="button" style={button} onClick={leave}>{role === "host" ? "Stop" : "Leave"}</button>
      {round?.failed ? (
        // A round that could not be resolved, said until one lands (round.js).
        <span style={{ ...small, ...problemText, alignItems: "center", display: "flex", flexBasis: "100%", flexWrap: "wrap", gap: "0.5rem", justifyContent: "center" }}>
          <span style={isolate}>{`Round ${round.failed} could not be resolved: ${round.failure || "the host's AI did not answer."}`}</span>
          {role === "host" && ["planning", "countdown"].includes(round?.phase) ? <button type="button" style={button} onClick={() => hostControl("resolveNow")}>Try again now</button> : null}
        </span>
      ) : null}
      {watching ? <span style={{ ...small, ...isolate, flexBasis: "100%", textAlign: "center" }}>{`${watching} is gone: you are watching. Take a free country under Players.`}</span> : null}
      {recent ? <span style={{ ...small, flexBasis: "100%", textAlign: "center" }}>{recent.text}</span> : null}
      {showPlayers ? (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", flexBasis: "100%", maxHeight: "40vh", overflowY: "auto", paddingTop: "0.3rem" }}>
          {role === "host" ? <ChangeRequests changes={shared.lobby?.changes} /> : null}
          <SeatList seats={shared.lobby?.seats} ready={round?.ready ?? []} host={role === "host"} />
          {role === "host" ? <HostInvite shared={shared} /> : null}
          {role !== "host" && (me || watching) ? <CountryPicker lobby={shared.lobby} asking={Boolean(me)} /> : null}
          <RepliesSetting shared={shared} />
          <WorldLanguage shared={shared} />
        </div>
      ) : null}
    </div>
  );
};

export default function SharedGameOverlay() {
  const shared = useSharedGame();
  if (shared.mode === "off") return null;
  const mine = shared.lobby?.seats?.find((seat) => seat.you) ?? null;
  // The country this player plays, or the one they watch now that it is gone.
  const me = mine && !["ai", "watching"].includes(mine.status) ? mine.country : "";
  const watching = mine?.status === "watching" ? mine.country : "";
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
  return started && (me || watching) ? <RoundBar shared={shared} me={me} watching={watching} /> : <Lobby shared={shared} me={me} />;
}
