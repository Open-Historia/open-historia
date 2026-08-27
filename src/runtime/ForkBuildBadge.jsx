/*! Open Historia — fork beta badge. Fork-only; see the header below. */

// ============================================================================
// FORK-ONLY — REMOVE BEFORE ANY UPSTREAM MERGE.
//
// This file, the `/api/fork-build` route in server/server.js, and the single
// <ForkBuildBadge /> line in src/App.jsx are the whole feature. They exist so a
// tester running the SeventhDread fork build can never mistake it for the
// official app when they file feedback or post a screenshot — the two installs
// share one save library, so "which build was this?" is otherwise unanswerable.
//
// Deleting all three leaves upstream byte-identical to what it was.
// ============================================================================

import { useEffect, useState } from "react";

// Only the fork's desktop beta answers this with a channel; everything else —
// the website, the APK, a dev run, the stable desktop app — answers {} and the
// badge stays unmounted.
const wrap = {
  position: "fixed",
  bottom: "0.6rem",
  left: "50%",
  transform: "translateX(-50%)",
  // Above the game's panels (9999) AND above the full-screen library/menu
  // overlay (10050, libraryBar.jsx) — the badge is useless if the screen a
  // tester spends their first minute on is the one screen that hides it. Still
  // below the update banner and the modal dialogs (10060+), which it must never
  // cover.
  zIndex: 10055,
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.28rem 0.7rem",
  borderRadius: "999px",
  background: "rgba(17,24,39,0.82)",
  backdropFilter: "blur(4px)",
  border: "1px solid rgba(212,175,55,0.45)",
  boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
  color: "#f4ead0",
  font: "600 0.7rem/1 system-ui, sans-serif",
  letterSpacing: "0.02em",
  whiteSpace: "nowrap",
  // The badge is a label, not a control: clicks fall through to the map unless
  // they land on the feedback link below.
  pointerEvents: "none",
};
const dot = {
  width: "0.42rem",
  height: "0.42rem",
  borderRadius: "50%",
  background: "#d4af37",
  flex: "0 0 auto",
};
const muted = { color: "rgba(244,234,208,0.55)", fontWeight: 400 };
const link = {
  color: "#d4af37",
  textDecoration: "none",
  fontWeight: 700,
  pointerEvents: "auto",
};

export default function ForkBuildBadge() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let dropped = false;
    // One shot, at mount. The channel of a running build cannot change under it.
    fetch("/api/fork-build", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!dropped && data && data.channel) setInfo(data);
      })
      .catch(() => {
        /* no endpoint (website, APK, upstream build) = no badge */
      });
    return () => {
      dropped = true;
    };
  }, []);

  if (!info) return null;
  return (
    <div style={wrap} role="status">
      <span style={dot} />
      <span>BETA · unofficial fork build</span>
      {info.build ? <span style={muted}>#{info.build.slice(-6)}</span> : null}
      {info.feedback ? (
        <a style={link} href={info.feedback} target="_blank" rel="noopener noreferrer">
          Report feedback
        </a>
      ) : null}
    </div>
  );
}
