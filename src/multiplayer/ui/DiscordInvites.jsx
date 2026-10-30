/*! Open Historia — shared games joined through Discord © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make inviting someone to play on discord rich presence invite them to a
// multiplayer game. if they are online they should get a popup asking them to
// join" (the owner, 2026-10-28).
//
// In a shared game, the player's Discord presence carries the lobby's invite
// code as its join secret (server/discordPresence.js), so a friend can be
// invited from Discord, or ask to join. What Discord hands back waits in the
// local server's inbox, which this reads:
//   - a join: a friend pressed Join on this player's invitation (or Discord
//     started the game to join one): "Join" goes in as the Lobbies tab does;
//   - a request: someone asks to join this player's shared game: "Accept"
//     has Discord send them the invitation.
// The desktop app and the local server only, and only while the player lets
// the game show what they are playing on Discord.
import React, { useEffect, useState } from "react";
import { presenceAllowed, presenceAvailable, setDiscordParty } from "../../runtime/discordPresence.js";
import { enterActiveGameFromOutside } from "../../Game/GameUI/libraryBar.jsx";
import { joinSharedGame, sharedGameActive, useSharedGame } from "../client/sharedGame.js";

// How often the inbox is read.
export const INBOX_POLL_MS = 3000;

// The party Discord is told of: the lobby's invite code, who is in and how many
// seats it has. Null outside a shared game, or before its lobby is known.
export const discordPartyOf = (shared) => {
  if (!shared || !["lobby", "playing"].includes(shared.mode) || !shared.token || !shared.lobby) return null;
  const seats = Array.isArray(shared.lobby.seats) ? shared.lobby.seats : [];
  const players = seats.filter((seat) => seat && seat.status !== "ai").length;
  const total = Math.max(players, Number(shared.lobby.settings?.seats) || seats.length || 1);
  return { token: shared.token, players: Math.max(1, players), seats: Math.max(1, total) };
};

// The name a player joins under: the one last used in the Lobbies tab.
const NAME_KEY = "oh:mp:name";
const rememberedName = () => {
  try {
    return localStorage.getItem(NAME_KEY) || "Player";
  } catch {
    return "Player";
  }
};

const glass = {
  background: "rgba(20,20,23,0.94)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "14px",
  boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
  color: "#e2e2e5",
  fontFamily: "sans-serif",
};
const button = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: "10px",
  color: "#e2e2e5",
  cursor: "pointer",
  fontSize: "0.85rem",
  fontWeight: 700,
  minHeight: "2.4rem",
  padding: "0 1rem",
};
const primary = { ...button, background: "rgba(43,193,243,0.18)", borderColor: "rgba(43,193,243,0.55)", color: "#e6f8ff" };

const Card = ({ children }) => (
  <div role="alertdialog" style={{ ...glass, bottom: "calc(1.2rem + env(safe-area-inset-bottom, 0px))", left: "50%", maxWidth: "calc(100vw - 2rem)", padding: "1rem 1.1rem", position: "fixed", transform: "translateX(-50%)", width: "24rem", zIndex: 2147483300 }}>
    {children}
  </div>
);

export default function DiscordInvites() {
  const shared = useSharedGame();
  const [invite, setInvite] = useState(null);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const available = presenceAvailable();
  const party = discordPartyOf(shared);

  // The party Discord offers friends, for as long as the player is in it.
  useEffect(() => {
    setDiscordParty(available ? party : null);
    return () => setDiscordParty(null);
  }, [available, party?.token, party?.players, party?.seats]);

  // What Discord handed over.
  useEffect(() => {
    if (!available) return undefined;
    let stopped = false;
    const read = async () => {
      if (stopped || !presenceAllowed()) return;
      const inbox = await fetch("/api/presence/inbox").then((response) => response.json()).catch(() => null);
      if (stopped || !inbox) return;
      if (inbox.join?.token) {
        setError("");
        setInvite({ token: String(inbox.join.token) });
      }
      setRequests(Array.isArray(inbox.requests) ? inbox.requests : []);
    };
    void read();
    const timer = setInterval(read, INBOX_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [available]);

  const join = async () => {
    if (!invite || joining) return;
    setJoining(true);
    setError("");
    try {
      await joinSharedGame({ token: invite.token, name: rememberedName() });
      setInvite(null);
      enterActiveGameFromOutside();
    } catch (failure) {
      setError(String(failure?.message || failure));
    } finally {
      setJoining(false);
    }
  };

  const answer = (request, accept) => {
    setRequests((list) => list.filter((entry) => entry.id !== request.id));
    void fetch("/api/presence/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: request.id, accept }),
    }).catch(() => {});
  };

  if (!available) return null;
  const request = requests[0] ?? null;
  if (invite) {
    const busy = sharedGameActive();
    return (
      <Card>
        <div style={{ fontSize: "1rem", fontWeight: 800, marginBottom: "0.35rem" }}>A friend invited you to a shared game</div>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.82rem", lineHeight: 1.45, marginBottom: "0.8rem" }}>
          {busy ? <>Leave the shared game you are in first, then join this one.</> : <>You were invited on Discord. You will need the lobby&apos;s scenario in your library.</>}
        </div>
        {error ? <div style={{ color: "#fca5a5", fontSize: "0.8rem", marginBottom: "0.7rem" }}>{error}</div> : null}
        <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
          <button type="button" style={button} onClick={() => setInvite(null)}>Not now</button>
          <button type="button" style={primary} disabled={busy || joining} onClick={join}>{joining ? <>Joining…</> : <>Join</>}</button>
        </div>
      </Card>
    );
  }
  if (request) {
    return (
      <Card>
        <div style={{ fontSize: "1rem", fontWeight: 800, marginBottom: "0.35rem" }}>
          {request.name} asks to join your shared game
        </div>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.82rem", lineHeight: 1.45, marginBottom: "0.8rem" }}>Accept, and Discord sends them your invitation.</div>
        <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
          <button type="button" style={button} onClick={() => answer(request, false)}>Decline</button>
          <button type="button" style={primary} onClick={() => answer(request, true)}>Accept</button>
        </div>
      </Card>
    );
  }
  return null;
}
