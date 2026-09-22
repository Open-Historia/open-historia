/*!
 * Open Historia Map Editor — "Cleaning up the borders" loading screen
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Shown by MapEditor.jsx from the moment a scenario save starts until the map
// is written. The whole-map topology pass blocks the main thread for a few
// seconds on a large world, chunk by chunk; this screen is what says the page
// is working rather than frozen, and what it is working on. After ten seconds
// it also offers "Save now": the sweep then stops at its next step, applies
// what it has found, and the save goes on. (The sweep stops on its own after
// BORDER_CLEANUP.maxMillis; the button is for the player who will not wait
// that long.)

import { useEffect, useState } from "react";
import { BORDER_CLEANUP, describeCleanupProgress } from "./topologySweep.js";

export const SAVE_NOW_AFTER_MS = 10_000;

// One save's card: mounted fresh per save (keyed on the sweep's start), so the
// clock and the button's pressed state begin again with each one.
const CleanupCard = ({ state, onStop }) => {
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const { fraction, headline, detail } = describeCleanupProgress(state);
  const startedAt = Number(state.startedAt) || now;
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const searching = state.phase !== "save" && state.phase !== "done";
  const canStop = typeof onStop === "function" && searching && seconds * 1000 >= SAVE_NOW_AFTER_MS;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(8,8,9,0.82)",
      }}
    >
      <style>{"@keyframes oh-border-cleanup-spin { to { transform: rotate(360deg); } }"}</style>
      <div
        style={{
          width: "min(440px, 100%)",
          borderRadius: 14,
          background: "#1b1b1e",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
          padding: "22px 24px",
          color: "white",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            aria-hidden="true"
            style={{
              width: 34,
              height: 34,
              flexShrink: 0,
              borderRadius: "50%",
              border: "3px solid rgba(255,255,255,0.11)",
              borderTopColor: "rgba(255,255,255,0.28)",
              animation: "oh-border-cleanup-spin 0.9s linear infinite",
            }}
          />
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>Cleaning up the borders</div>
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.7)" }}>{headline}…</div>
          </div>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
          <div
            style={{
              width: `${Math.round(fraction * 100)}%`,
              height: "100%",
              background: "rgba(231,231,234,0.72)",
              transition: "width 220ms ease",
            }}
          />
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.62)", fontVariantNumeric: "tabular-nums" }}>
          {detail ? `${detail} · ` : ""}{seconds} s
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: "rgba(255,255,255,0.55)" }}>
          The Workshop is not frozen. Before the map is saved it checks every region for hairline cracks and thin slivers between {BORDER_CLEANUP.minWidth} m and {BORDER_CLEANUP.maxWidth} m wide and repairs them — the same conservative pass as the Topology panel, kept as one undo step — and looks again around each repair until nothing is left. A whole world takes about ten seconds; a very detailed map stops after {Math.round(BORDER_CLEANUP.maxMillis / 1000)} s, keeps what it repaired, and says so.
        </div>
        {canStop ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              onClick={() => {
                setStopping(true);
                onStop();
              }}
              disabled={stopping}
              style={{
                padding: "7px 14px",
                borderRadius: 9,
                border: "1px solid rgba(255,255,255,0.22)",
                background: stopping ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.12)",
                color: "white",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: stopping ? "default" : "pointer",
              }}
            >
              {stopping ? "Stopping after this step…" : "Save now"}
            </button>
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>
              Keeps what has been repaired so far; the rest waits for the next save.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

const BorderCleanupOverlay = ({ state, onStop }) => {
  if (!state) return null;
  return <CleanupCard key={Number(state.startedAt) || 0} state={state} onStop={onStop} />;
};

// The one-line result left beside the save buttons for a few seconds after a
// plain Save (Save & Exit and Apply & Play leave the Workshop).
export const BorderCleanupNote = ({ text, top = 56 }) => {
  if (!text) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top,
        right: 12,
        zIndex: 41,
        maxWidth: 380,
        padding: "8px 12px",
        borderRadius: 10,
        background: "rgba(17,24,39,0.92)",
        border: "1px solid rgba(52,211,153,0.4)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
        color: "white",
        fontSize: 12.5,
        lineHeight: 1.45,
      }}
    >
      {text}
    </div>
  );
};

export default BorderCleanupOverlay;
