/*! Open Historia — the notice that an edited prompt passage was too long to use © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Says, once for each passage (runtime/promptLimitNotice.js), that a prompt
// passage this game's scenario or save carries is longer than the limit, so
// the AI reads the built-in passage in its place. Styled as the other game
// notices (bordersFallbackNotice.jsx), until dismissed.

import React, { useEffect, useState } from "react";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import {
  PROMPT_LIMIT_NOTICE_EVENT,
  markPromptLimitNoticeSeen,
  pendingPromptLimitNotice,
} from "../../runtime/promptLimitNotice.js";

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
  border: "1px solid color-mix(in srgb, var(--oh-ui-accent, #2bc1f3) 32%, transparent)",
  backgroundColor: "var(--oh-ui-overlay-strong, rgba(16,21,24,0.96))",
  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
  color: "#e5e7eb",
  fontFamily: "sans-serif",
  fontSize: "0.76rem",
  lineHeight: 1.45,
  pointerEvents: "auto",
};

const phoneNoticeStyle = {
  top: "4.75rem",
  width: "max-content",
};

export const PromptLimitNotice = () => {
  const [entries, setEntries] = useState([]);
  const isMobile = useIsMobile();

  useEffect(() => {
    const take = () => {
      const waiting = pendingPromptLimitNotice();
      if (!waiting.length) return;
      setEntries((current) => {
        const known = new Set(current.map((entry) => entry.id));
        return [...current, ...waiting.filter((entry) => !known.has(entry.id))];
      });
      markPromptLimitNoticeSeen();
    };
    window.addEventListener(PROMPT_LIMIT_NOTICE_EVENT, take);
    take();
    return () => window.removeEventListener(PROMPT_LIMIT_NOTICE_EVENT, take);
  }, []);

  if (!entries.length) return null;
  return (
    <div role="status" aria-live="polite" style={{ ...noticeStyle, ...(isMobile ? phoneNoticeStyle : null) }}>
      <span aria-hidden="true" style={{ color: "#2bc1f3", fontWeight: 800 }}>!</span>
      <span style={{ flex: 1 }}>
        <span>
          {entries.length === 1
            ? "A prompt passage in this game is more than 20% longer than the built-in one, so the AI uses the built-in passage instead. Shorten it in the Prompts tab to use it."
            : "Some prompt passages in this game are more than 20% longer than the built-in ones, so the AI uses the built-in passages instead. Shorten them in the Prompts tab to use them."}
        </span>
        <span style={{ display: "block", marginTop: "0.3rem", color: "rgba(255,255,255,0.62)" }}>
          {entries.map((entry) => (
            <span key={entry.id} style={{ display: "block" }}>
              <span>{entry.sectionLabel}</span>
              {": "}
              <span>{entry.segmentLabel}</span>
            </span>
          ))}
        </span>
      </span>
      <button
        type="button"
        className="oh-tap"
        aria-label="Dismiss"
        onClick={() => setEntries([])}
        style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: "0.9rem", lineHeight: 1, padding: 0 }}
      >
        ×
      </button>
    </div>
  );
};

export default PromptLimitNotice;
