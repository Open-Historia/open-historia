/*! Open Historia — the corner button's drop-down in a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Under the game menu button in a shared game (gameMenuItems.js): the game
// menu, as the button opened it before, and Players, which drops down who plays
// what, the same list as the round bar's Players panel (country, player, "(you)",
// the host, who is away). Single player never shows it: there the button opens
// the game menu at once.
//
// Closes on Escape, on a press outside it, and when an item is chosen. The
// seats come from the bridge (client/sharedGameBridge.js), so the game's UI
// loads none of the multiplayer code for it.

import React, { useEffect, useRef, useState } from "react";
import { gameMenuItems, playerListRows } from "./gameMenuItems.js";
import { playedByAPerson } from "../../multiplayer/client/seatRoster.js";
import { SAFE_LEFT } from "../../runtime/mobileUi.js";
import { reduceMotionEnabled } from "../../runtime/mapSettings.js";

const panel = {
  background: "rgba(24,24,27,0.95)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "12px",
  boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
  boxSizing: "border-box",
  color: "rgba(246,246,248,0.94)",
  fontFamily: "sans-serif",
  maxWidth: `calc(100vw - 1rem - ${SAFE_LEFT})`,
  overflow: "hidden",
  padding: "0.3rem",
  width: "17.5rem",
};
const item = {
  alignItems: "center",
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: "8px",
  color: "inherit",
  cursor: "pointer",
  display: "flex",
  fontSize: "0.84rem",
  fontWeight: 650,
  gap: "0.5rem",
  minHeight: "2.4rem",
  padding: "0 0.6rem",
  textAlign: "start",
  width: "100%",
};
const itemOpen = { ...item, background: "rgba(43,193,243,0.14)", borderColor: "rgba(43,193,243,0.45)" };
const soft = { color: "rgba(255,255,255,0.6)", fontSize: "0.76rem" };
const isolate = { unicodeBidi: "isolate" };
// The drop-down opens with a short fall and fade; none with Reduce motion.
const dropStyle = { animation: "ohGameMenuDrop 140ms ease-out both" };

// Who plays what, one row a seat.
export const PlayerList = ({ seats }) => {
  const rows = playerListRows(seats);
  if (!rows.length) return <div style={{ ...soft, padding: "0.4rem 0.6rem" }}>No one has taken a country yet.</div>;
  return (
    <div role="list" style={{ maxHeight: "min(50dvh, 22rem)", overflowY: "auto", padding: "0.15rem 0.6rem 0.35rem" }}>
      {rows.map((row) => (
        <div key={row.key} role="listitem" style={{ alignItems: "baseline", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", flexWrap: "wrap", fontSize: "0.82rem", gap: "0.15rem 0.5rem", padding: "0.35rem 0" }}>
          <span data-no-translate style={{ ...isolate, flex: "1 1 8rem", fontWeight: 650, minWidth: 0, overflowWrap: "anywhere" }}>{row.country}</span>
          <span style={{ ...isolate, color: "rgba(255,255,255,0.7)", minWidth: 0, overflowWrap: "anywhere" }}>
            {row.name ? <span data-no-translate>{row.name}</span> : null}
            {row.you ? <span> (you)</span> : null}
          </span>
          {row.state ? <span style={soft}>{row.state}</span> : null}
        </div>
      ))}
    </div>
  );
};

// Mounted only while open, so the list folds back up whenever the menu closes
// and it opens on its items.
const OpenMenu = ({ items, seats, top, onOpenGameMenu, onClose }) => {
  const [showPlayers, setShowPlayers] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose?.(); };
    // A press outside the menu and outside the button that toggles it.
    const onPress = (event) => {
      if (ref.current?.contains(event.target)) return;
      if (event.target?.closest?.("[data-oh-game-menu-button]")) return;
      onClose?.();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPress, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPress, true);
    };
  }, [onClose]);

  const still = reduceMotionEnabled();
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Game menu"
      data-oh-theme-hud=""
      style={{
        ...panel,
        left: `calc(0.5rem + ${SAFE_LEFT})`,
        position: "fixed",
        top,
        zIndex: 9999,
        ...(still ? null : dropStyle),
      }}
    >
      {still ? null : <style>{"@keyframes ohGameMenuDrop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}"}</style>}
      {items.map((entry) => {
        if (entry.id === "players") {
          return (
            <React.Fragment key={entry.id}>
              <button type="button" role="menuitem" className="oh-tap-row" aria-expanded={showPlayers} style={showPlayers ? itemOpen : item} onClick={() => setShowPlayers(!showPlayers)}>
                <span aria-hidden="true" style={{ color: "#2bc1f3", width: "1rem" }}>{"★"}</span>
                <span style={{ flex: 1 }}>Players</span>
                <span data-no-translate style={soft}>{seats.filter(playedByAPerson).length}</span>
                <span aria-hidden="true" style={{ ...soft, display: "inline-block", transform: showPlayers ? "rotate(180deg)" : "none" }}>{"▾"}</span>
              </button>
              {showPlayers ? <PlayerList seats={seats} /> : null}
            </React.Fragment>
          );
        }
        return (
          <button key={entry.id} type="button" role="menuitem" className="oh-tap-row" style={item} onClick={() => { onClose?.(); onOpenGameMenu?.(); }}>
            <span aria-hidden="true" style={{ color: "rgba(255,255,255,0.7)", width: "1rem" }}>{"☰"}</span>
            <span style={{ flex: 1 }}>Game menu</span>
          </button>
        );
      })}
    </div>
  );
};

export default function GameMenuDropdown({ open, seats, top, onOpenGameMenu, onClose }) {
  const items = gameMenuItems({ seats });
  if (!open || !items.length) return null;
  return <OpenMenu items={items} seats={seats} top={top} onOpenGameMenu={onOpenGameMenu} onClose={onClose} />;
}
