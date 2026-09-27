/*! Open Historia — the public lobby list © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every lobby anyone can join, with filters, from a multiplayer server
// (signaling/publicServers.js), under the invite code in the Lobbies tab
// (LobbiesTab.jsx). Built, and covered by a large "Coming soon" until the
// user's own server is up: the user asked for exactly that. Lifting the cover
// is `comingSoon={false}` once a server is configured.

import React, { useEffect, useState } from "react";
import { configuredServer, listPublicRooms } from "../signaling/publicServers.js";

const card = {
  background: "rgba(255,255,255,0.035)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "18px",
  overflow: "hidden",
  padding: "1.2rem 1.3rem",
  position: "relative",
};
const input = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", color: "#f8fafc", fontSize: "0.84rem", outline: "none", padding: "0.5rem 0.7rem", boxSizing: "border-box" };
const cell = { borderTop: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.82)", fontSize: "0.82rem", padding: "0.55rem 0.5rem", textAlign: "left" };
// Anyone's text, kept from reordering the text around it.
const isolate = { unicodeBidi: "isolate" };

const SAMPLE = [
  { roomId: "sample-1", name: "The Baltic Question", scenario: { name: "Fault Lines" }, players: 4, seats: 8, round: { minutes: 20 }, language: "en", cheats: "off", payment: "host", password: false },
  { roomId: "sample-2", name: "Weltpolitik 1914", scenario: { name: "The Great War" }, players: 6, seats: 8, round: { minutes: 45 }, language: "de", cheats: "vote", payment: "host", password: false },
  { roomId: "sample-3", name: "Cold War, slow rounds", scenario: { name: "Modern Day" }, players: 2, seats: 6, round: { minutes: 1440 }, language: "en", cheats: "off", payment: "host", password: true },
];

export default function PublicLobbies({ comingSoon = true }) {
  const [filters, setFilters] = useState({ q: "", language: "", cheats: "", minOpen: "", password: "" });
  const [result, setResult] = useState({ rooms: comingSoon ? SAMPLE : [], total: 0, error: "" });
  const server = configuredServer();

  useEffect(() => {
    if (comingSoon || !server) return undefined;
    let live = true;
    const query = {
      q: filters.q,
      language: filters.language,
      cheats: filters.cheats,
      ...(filters.minOpen ? { minOpen: Number(filters.minOpen) } : {}),
      ...(filters.password ? { password: filters.password === "yes" } : {}),
    };
    const timer = setTimeout(() => {
      listPublicRooms({ server, filters: query }).then((next) => {
        if (live) setResult({ rooms: next.rooms ?? [], total: next.total ?? 0, error: next.error ?? "" });
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [comingSoon, server, filters]);

  const set = (key) => (event) => setFilters((previous) => ({ ...previous, [key]: event.target.value }));

  return (
    <section style={card} aria-label="Public lobbies">
      <div aria-hidden={comingSoon} style={{ filter: comingSoon ? "blur(2px) saturate(0.6)" : "none", opacity: comingSoon ? 0.5 : 1, pointerEvents: comingSoon ? "none" : "auto" }}>
        <h3 style={{ color: "#fff", fontSize: "1.1rem", fontWeight: 800, margin: "0 0 0.8rem" }}>Public lobbies</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.8rem" }}>
          <input style={{ ...input, flex: "1 1 12rem" }} placeholder="Search names and scenarios" value={filters.q} onChange={set("q")} maxLength={60} />
          <select style={input} value={filters.language} onChange={set("language")}>
            <option value="">Any language</option>
            <option value="en">English</option>
            <option value="de">German</option>
            <option value="fr">French</option>
            <option value="es">Spanish</option>
            <option value="ru">Russian</option>
          </select>
          <select style={input} value={filters.cheats} onChange={set("cheats")}>
            <option value="">Cheats: any</option>
            <option value="off">Cheats off</option>
            <option value="vote">Cheats by vote</option>
            <option value="host">Host's cheats</option>
          </select>
          <select style={input} value={filters.minOpen} onChange={set("minOpen")}>
            <option value="">Any open seats</option>
            <option value="1">1+ open</option>
            <option value="2">2+ open</option>
            <option value="4">4+ open</option>
          </select>
          <select style={input} value={filters.password} onChange={set("password")}>
            <option value="">Password: any</option>
            <option value="no">No password</option>
            <option value="yes">Password</option>
          </select>
        </div>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              {["Lobby", "Scenario", "Players", "Rounds", "Language", "Cheats", ""].map((title) => (
                <th key={title} style={{ ...cell, borderTop: "none", color: "rgba(255,255,255,0.55)", fontSize: "0.72rem", textTransform: "uppercase" }}>{title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rooms.map((room) => (
              <tr key={room.roomId}>
                <td style={cell}><span style={isolate}>{room.name}</span>{room.password ? " 🔒" : ""}</td>
                <td style={cell}><span style={isolate}>{room.scenario?.name}</span></td>
                <td style={cell}>{room.players} / {room.seats}</td>
                <td style={cell}>{room.round?.minutes >= 60 ? `${Math.round(room.round.minutes / 60)} h` : `${room.round?.minutes} min`}</td>
                <td style={cell}>{room.language}</td>
                <td style={cell}>{room.cheats}</td>
                <td style={cell}><button type="button" disabled style={{ ...input, cursor: "not-allowed" }}>Join</button></td>
              </tr>
            ))}
            {!result.rooms.length ? (
              <tr><td colSpan={7} style={{ ...cell, color: "rgba(255,255,255,0.5)" }}>{result.error || "No public lobbies match."}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {comingSoon ? (
        <div style={{ alignItems: "center", display: "flex", flexDirection: "column", inset: 0, justifyContent: "center", position: "absolute", textAlign: "center" }}>
          <div style={{ color: "#fff", fontSize: "clamp(2rem, 6vw, 3.4rem)", fontWeight: 900, letterSpacing: "-0.03em", textShadow: "0 4px 24px rgba(0,0,0,0.6)" }}>Coming soon</div>
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.9rem", marginTop: "0.5rem", maxWidth: "26rem", textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}>
            Public lobbies need a server of our own. Until then, join a private lobby with its invite code, or host one.
          </div>
        </div>
      ) : null}
    </section>
  );
}
