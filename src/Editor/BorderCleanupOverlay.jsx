/*!
 * Open Historia Map Editor — "Cleaning up the borders" loading screen
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Shown by MapEditor.jsx from the moment a scenario save starts, or an export
// from the standalone editor, until the map is written. The whole-map
// topology pass blocks the main thread for a few seconds on a large world,
// chunk by chunk; this screen is what says the page is working rather than
// frozen, and what it is working on. After ten seconds it also offers "Save
// now": the sweep then stops at its next step, applies what it has found, and
// the save goes on. (The sweep stops on its own after
// BORDER_CLEANUP.maxMillis; the button is for the player who will not wait
// that long.)

import { useEffect, useRef, useState } from "react";
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
  const { fraction, headline, detail, leftAlone = [] } = describeCleanupProgress(state);
  const startedAt = Number(state.startedAt) || now;
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const searching = state.phase !== "save" && state.phase !== "done";
  const canStop = typeof onStop === "function" && searching && seconds * 1000 >= SAVE_NOW_AFTER_MS;
  // The sweep's width as the text below gives it: 0.5 km for the quick clean,
  // 1.5 km for the deep one (the sweep's progress carries the one it runs at).
  const maxWidthKm = (Number(state.maxWidth) || BORDER_CLEANUP.maxWidth) / 1000;
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
        {/* What the guards left alone, once the result is in: a line each. */}
        {leftAlone.map((line) => (
          <div key={line} style={{ fontSize: 12, color: "rgba(255,255,255,0.62)", fontVariantNumeric: "tabular-nums" }}>
            {line}
          </div>
        ))}
        <div style={{ fontSize: 12, lineHeight: 1.5, color: "rgba(255,255,255,0.55)" }}>
          The Workshop is not frozen. Before the map is saved it checks every region for cracks and slivers between {BORDER_CLEANUP.minWidth} m and {maxWidthKm} km wide and repairs them as one undo step, then looks again around each repair until nothing is left. A whole world takes about ten seconds; a very detailed map stops after {Math.round(BORDER_CLEANUP.maxMillis / 1000)} s, keeps what it repaired, and says so.
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

// Which clean the author chose last, kept on this device so the question
// opens with that answer under the keyboard. Deep until one is chosen: it is
// what every save ran before it asked.
const CLEAN_MODE_KEY = "oh_editor_border_clean";
export const lastCleanMode = () => {
  try {
    return window.localStorage.getItem(CLEAN_MODE_KEY) === "quick" ? "quick" : "deep";
  } catch {
    return "deep";
  }
};
export const rememberCleanMode = (mode) => {
  try {
    window.localStorage.setItem(CLEAN_MODE_KEY, mode === "quick" ? "quick" : "deep");
  } catch {
    // A device that keeps nothing asks with the deep clean first, as at the start.
  }
};

const CHOICE_BUTTON = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  width: "100%",
  padding: "11px 14px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.07)",
  color: "white",
  textAlign: "left",
  cursor: "pointer",
};
const CHOICE_TITLE = { fontSize: 14.5, fontWeight: 800 };
const CHOICE_TEXT = { fontSize: 12, lineHeight: 1.45, color: "rgba(255,255,255,0.68)" };

// What a save asks before it cleans the borders (MapEditor.jsx chooseClean):
// a quick clean or a deep one. Both read every region; they differ in how
// wide a crack or a sliver may be and still be repaired
// (topologySweep.js CLEANUP_MODES). `choice` is { last } while the question
// is up, `last` being the answer given last time; `onChoose` hears "quick",
// "deep", or null when the author backs out, and then nothing is saved.
// Each sentence is in an element of its own, so the translator finds it whole.
export const BorderCleanupChoice = ({ choice, onChoose }) => {
  const lastRef = useRef(null);
  // The editor redraws while the question is up (its autosave ticks), and each
  // time hands in a new function: read through a ref, so the focus is given
  // once, when the question opens, and not taken back with every redraw.
  const chooseRef = useRef(onChoose);
  useEffect(() => {
    chooseRef.current = onChoose;
  });
  useEffect(() => {
    if (!choice) return undefined;
    lastRef.current?.focus?.();
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      chooseRef.current(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [choice]);
  if (!choice) return null;
  const deepKm = BORDER_CLEANUP.maxWidth / 1000;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="oh-border-clean-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onChoose(null);
      }}
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
        <div id="oh-border-clean-title" style={{ fontSize: 17, fontWeight: 800 }}>Clean up the borders</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "rgba(255,255,255,0.7)" }}>
          Every region is checked for cracks and slivers first, and the ones narrow enough are repaired. Choose how wide one may be and still be repaired.
        </div>
        <button type="button" ref={choice.last === "quick" ? lastRef : null} onClick={() => onChoose("quick")} style={CHOICE_BUTTON}>
          <div style={CHOICE_TITLE}>Quick clean</div>
          <div style={CHOICE_TEXT}>{`Up to ${BORDER_CLEANUP.quickWidth} m wide. Leaves the wider gaps as they are.`}</div>
        </button>
        <button type="button" ref={choice.last === "quick" ? null : lastRef} onClick={() => onChoose("deep")} style={CHOICE_BUTTON}>
          <div style={CHOICE_TITLE}>Deep clean</div>
          <div style={CHOICE_TEXT}>{`Up to ${deepKm} km wide. Closes the wider gaps too, so there is more to repair.`}</div>
        </button>
        <div>
          <button
            type="button"
            onClick={() => onChoose(null)}
            style={{
              padding: "7px 14px",
              borderRadius: 9,
              border: "1px solid rgba(255,255,255,0.22)",
              background: "transparent",
              color: "rgba(255,255,255,0.8)",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

// The result left beside the save buttons for a few seconds after a plain Save
// (Save & Exit and Apply & Play leave the Workshop), and after an export from
// the standalone editor: what was repaired, then a line for each kind of
// thing the guards left alone. Each line is an element of its own, so the
// translator looks each sentence up by itself.
export const BorderCleanupNote = ({ lines, top = 56 }) => {
  if (!lines?.length) return null;
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
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
};

export default BorderCleanupOverlay;
