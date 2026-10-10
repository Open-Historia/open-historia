/*! Open Historia — the notice that the map fell back to simpler borders © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// When the boundary worker cannot run (a WebView without module workers) or
// fails twice (a low-memory phone), the map shows canonical fills with the
// simpler labels and no derived borders. Without a word about it, that reads
// as a broken game. Shown once the map has settled (runtime/mapReadiness.js
// records the failure only when no retry is left), until dismissed; this UI is
// remounted per game, so each game says it once.

import React, { useEffect, useState } from "react";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import {
  MAP_IDLE_EVENT,
  MAP_POLITIES_READY_EVENT,
  politiesFailed,
  politiesSettled,
} from "../../runtime/mapReadiness.js";

const noticeStyle = {
  position: "fixed",
  top: "4.25rem",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 9999,
  display: "flex",
  alignItems: "flex-start",
  gap: "0.6rem",
  maxWidth: "min(34rem, calc(100vw - 2rem))",
  padding: "0.6rem 0.8rem",
  borderRadius: "12px",
  border: "1px solid rgba(43,193,243,0.32)",
  backgroundColor: "rgba(16,21,24,0.96)",
  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
  color: "#e5e7eb",
  fontFamily: "sans-serif",
  fontSize: "0.76rem",
  lineHeight: 1.45,
  pointerEvents: "auto",
};

// As fallbackSwitchNotice.jsx: as wide as its words on a phone, below the
// game-menu button.
const phoneNoticeStyle = {
  top: "4.75rem",
  width: "max-content",
};

export const BordersFallbackNotice = () => {
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    const check = () => setFailed(politiesSettled() && politiesFailed());
    window.addEventListener(MAP_POLITIES_READY_EVENT, check);
    window.addEventListener(MAP_IDLE_EVENT, check);
    check();
    return () => {
      window.removeEventListener(MAP_POLITIES_READY_EVENT, check);
      window.removeEventListener(MAP_IDLE_EVENT, check);
    };
  }, []);

  if (!failed || dismissed) return null;
  return (
    <div role="status" aria-live="polite" style={{ ...noticeStyle, ...(isMobile ? phoneNoticeStyle : null) }}>
      <span aria-hidden="true" style={{ color: "#2bc1f3", fontWeight: 800 }}>!</span>
      <span style={{ flex: 1 }}>Borders and labels could not be drawn in full on this device, so the map shows a simpler version.</span>
      <button
        type="button"
        className="oh-tap"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: "0.9rem", lineHeight: 1, padding: 0 }}
      >
        ×
      </button>
    </div>
  );
};

export default BordersFallbackNotice;
