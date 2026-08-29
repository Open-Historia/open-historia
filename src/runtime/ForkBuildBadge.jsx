/*! Open Historia — SeventhDread beta badge. Beta-branch only; see the header below. */

// ============================================================================
// FORK-ONLY — REMOVE BEFORE ANY UPSTREAM MERGE.
//
// This file, the `/api/fork-build` route in server/server.js, and the single
// <ForkBuildBadge /> line in src/App.jsx are the whole feature. They exist so a
// tester running the SeventhDread beta build can never mistake it for the
// official app — nor for anyone else's beta — when they file feedback or post a
// screenshot. The two installs share one save library, so "which build was this?"
// is otherwise unanswerable.
//
// Deleting all three leaves upstream byte-identical to what it was.
// ============================================================================

import { useEffect, useState } from "react";

import { useIsMobile } from "./useIsMobile.js";

// Only the SeventhDread desktop beta answers this with a channel; everything else —
// the website, the APK, a dev run, the stable desktop app — answers {} and the
// badge stays unmounted. (A phone browser pointed at a desktop beta over the LAN
// setting does get it, which is why the narrow layout below matters.)
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
  // Never wider than the viewport, whatever the build string turns out to be.
  maxWidth: "calc(100vw - 1.2rem)",
  // The badge is a label, not a control: clicks fall through to the map unless
  // they land on the feedback link below.
  pointerEvents: "none",
};

// The bottom edge is the busiest row in the HUD: the toolbar sits bottom-left
// (three buttons, ~12.8rem since Projects was added) and the advisor launcher
// bottom-right (~4rem). On a phone that leaves roughly five characters of gap in
// the middle, and the full badge — nowrap, at z-index 10055 — simply lay across
// both of them, hiding the Chat/Actions/Projects buttons behind a label.
//
// So the narrow layout drops to what actually identifies the build: the dot and
// the words SD BETA. The build number and the wording move into the title, and the
// whole pill becomes the feedback link rather than carrying a separate one, so
// nothing is lost but the width.
const compactWrap = {
  ...wrap,
  gap: "0.35rem",
  padding: "0.24rem 0.5rem",
  pointerEvents: "auto",
  textDecoration: "none",
  color: "#f4ead0",
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
  const isMobile = useIsMobile();

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

  const build = info.build ? `#${info.build.slice(-6)}` : "";
  const full = `SEVENTHDREAD BETA · unofficial beta build${build ? ` ${build}` : ""}`;

  if (isMobile) {
    const label = (
      <>
        <span style={dot} />
        <span>SD BETA</span>
      </>
    );
    // A link only where there is somewhere to send them; otherwise the same pill
    // as a plain label, so the markup never promises a tap that does nothing.
    return info.feedback ? (
      <a
        style={compactWrap}
        role="status"
        title={`${full} — tap to report feedback`}
        href={info.feedback}
        target="_blank"
        rel="noopener noreferrer"
      >
        {label}
      </a>
    ) : (
      <div style={{ ...compactWrap, pointerEvents: "none" }} role="status" title={full}>
        {label}
      </div>
    );
  }

  return (
    <div style={wrap} role="status">
      <span style={dot} />
      <span>SEVENTHDREAD BETA · unofficial beta build</span>
      {build ? <span style={muted}>{build}</span> : null}
      {info.feedback ? (
        <a style={link} href={info.feedback} target="_blank" rel="noopener noreferrer">
          Report feedback
        </a>
      ) : null}
    </div>
  );
}
