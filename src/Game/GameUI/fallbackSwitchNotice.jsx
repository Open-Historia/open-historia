/*! Open Historia — the notice that the game has moved down the Fallback list © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The short notice that the game has moved down the Fallback list: "gemini-3.7-
// flash (Main Google) has used today's allowance. Now using gemini-3.6-flash
// (Main Google)." Once per switch, never once per call — the AI layer
// (main.jsx announceFallbackSwitch) only announces the calls that found an
// entry newly unable to answer, so a turn of twenty calls says it once. When
// that call found nothing else able to answer, the notice says only what ran
// out; the call's own error says the rest.
//
// The writing may change with the model, and a player who does not know why
// will blame the game; that is the whole reason this exists.

import React, { useEffect, useState } from "react";
import { useIsMobile } from "../../runtime/useIsMobile.js";

const SHOW_MS = 12000;

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
  border: "1px solid rgba(96,165,250,0.32)",
  backgroundColor: "rgba(16,21,24,0.96)",
  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
  color: "#dbeafe",
  fontFamily: "sans-serif",
  fontSize: "0.76rem",
  lineHeight: 1.45,
  pointerEvents: "auto",
};

// On a phone. Centred from left: 50%, the notice could only be half the screen
// wide, which squeezed the message into a narrow column; there it is as wide as
// its words, up to the screen. And it drops below the game-menu button, whose
// bottom edge it covered.
const phoneNoticeStyle = {
  top: "4.75rem",
  width: "max-content",
};

export const FallbackSwitchNotice = () => {
  const [notices, setNotices] = useState([]); // [{ id, message }]
  const isMobile = useIsMobile();

  useEffect(() => {
    const timers = new Set();
    const onSwitch = (event) => {
      const message = String(event.detail?.message ?? "").trim();
      if (!message) return;
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setNotices((current) => [...current.filter((notice) => notice.message !== message), { id, message }].slice(-3));
      const timer = setTimeout(() => {
        timers.delete(timer);
        setNotices((current) => current.filter((notice) => notice.id !== id));
      }, SHOW_MS);
      timers.add(timer);
    };
    window.addEventListener("ai:fallback-switch", onSwitch);
    return () => {
      window.removeEventListener("ai:fallback-switch", onSwitch);
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  if (!notices.length) return null;
  return (
    <div role="status" aria-live="polite" style={{ ...noticeStyle, flexDirection: "column", ...(isMobile ? phoneNoticeStyle : null) }}>
      {notices.map((notice) => (
        <div key={notice.id} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", width: "100%" }}>
          <span aria-hidden="true" style={{ color: "#93c5fd", fontWeight: 800 }}>↓</span>
          <span style={{ flex: 1 }}>{notice.message}</span>
          <button
            type="button"
            className="oh-tap"
            aria-label="Dismiss"
            onClick={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}
            style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: "0.9rem", lineHeight: 1, padding: 0 }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

export default FallbackSwitchNotice;
