/*! Open Historia — Rostra's empty feed and its Refresh © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "if there are no posts, it should say refresh page with a refresh button to
// generate them" (the owner, 2026-11-03). A new game's feed is empty until the
// first time skip writes posts; Refresh asks for them now: ONE AI request
// (AI/gameplay.js generateRostraPosts), made on the press and never by itself,
// which writes the posts into the feed. In a shared game the feed is the
// host's to write, so there the posts come with the next time skip.
//
// Kept apart from social.jsx, which asks no model of its own; Search's place
// feeds use the same button (rostraSearch.jsx).

import React, { useState } from "react";

import { inSharedGame } from "../../multiplayer/client/sharedGameBridge.js";
import { RS } from "./rostraLooks.js";
import { generateRostraPosts } from "../AI/gameplayLazy.js";

// Colours from Rostra's look (rostraLooks.js).
const { INK, INK_SOFT, INK_FAINT, WASH, WASH_FAINT, EDGE, SCREEN, WARN } = RS;

export const RefreshIcon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 4v6h-6" />
    <path d="M3 20v-6h6" />
    <path d="M5.2 9a8 8 0 0 1 13.6-2.6L21 10" />
    <path d="M18.8 15a8 8 0 0 1-13.6 2.6L3 14" />
  </svg>
);

// The one filled button an empty screen has: Refresh, with the cost under it.
export const RefreshButton = ({ busy = false, disabled = false, onClick }) => (
  <>
    <button
      type="button"
      className="oh-tap-row"
      onClick={onClick}
      disabled={busy || disabled}
      style={{ alignItems: "center", background: INK, border: "none", borderRadius: "999px", color: SCREEN, cursor: busy || disabled ? "default" : "pointer", display: "inline-flex", fontFamily: "inherit", fontSize: "0.78rem", fontWeight: 800, gap: "0.4rem", marginTop: "0.65rem", opacity: disabled ? 0.5 : 1, padding: "0.42rem 1.05rem" }}
    >
      <RefreshIcon />
      <span>{busy ? "Refreshing…" : "Refresh"}</span>
    </button>
    <div style={{ color: INK_FAINT, fontSize: "0.66rem", marginTop: "0.5rem" }}>One AI request</div>
  </>
);

// The main feed with nothing in it. `canPost`: not while a time skip runs (it
// writes the feed back with the world).
const EmptyFeedRefresh = ({ canPost = true }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shared = inSharedGame();
  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { kept } = await generateRostraPosts();
      if (!kept) setError("No posts came back. Try again.");
    } catch (failure) {
      setError(String(failure?.message || failure || "The posts could not be loaded."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ padding: "1.6rem 1.1rem", textAlign: "center" }}>
      <div style={{ color: INK, fontSize: "0.9rem", fontWeight: 750 }}>Nothing has been posted yet.</div>
      {shared ? (
        <div style={{ color: INK_SOFT, fontSize: "0.76rem", lineHeight: 1.45, marginTop: "0.35rem" }}>
          The people who make the news post with the next time skip.
        </div>
      ) : (
        <>
          <div style={{ color: INK_SOFT, fontSize: "0.76rem", lineHeight: 1.45, marginTop: "0.35rem" }}>
            Refresh to see what the people who make the news are posting.
          </div>
          <RefreshButton busy={busy} disabled={!canPost} onClick={() => void refresh()} />
          {error && <div role="alert" data-no-translate style={{ color: WARN, fontSize: "0.72rem", lineHeight: 1.4, marginTop: "0.6rem", overflowWrap: "anywhere" }}>{error}</div>}
        </>
      )}
    </div>
  );
};

export default EmptyFeedRefresh;
