/*! Open Historia — post-generation satisfaction rating toast. Ported from Abdulrahman Azmy's fork. */
// A small floating bar after each narrative-shaping generation, while the
// "Rate AI generations" setting is on. A rating writes straight into the
// telemetry record (a human satisfaction baseline, 1-10). Its own tiny module
// so the debug console can stay a lazy chunk.

import React, { useEffect, useState } from "react";
import {
  GENERATION_COMPLETE_EVENT,
  RATING_ELIGIBLE_TASKS,
  TELEMETRY_SETTINGS_EVENT,
  isRatingEnabled,
  setGenerationRating,
} from "../AI/telemetry.js";

const TASK_LABELS = {
  jumpForward: "time skip",
  autoJumpForward: "auto time skip",
  gameMaster: "Game Master edit",
  catalystExecutor: "catalyst",
  catalystSummary: "catalyst summary",
};

const barStyle = {
  position: "fixed",
  bottom: "6rem",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  gap: "0.6rem",
  padding: "0.55rem 0.8rem",
  borderRadius: "12px",
  border: "1px solid rgba(255,255,255,0.16)",
  backgroundColor: "rgba(16,21,24,0.96)",
  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
  color: "white",
  fontFamily: "sans-serif",
  fontSize: "0.78rem",
  pointerEvents: "auto",
};

const scoreStyle = {
  width: "1.5rem",
  height: "1.5rem",
  borderRadius: "6px",
  border: "1px solid rgba(255,255,255,0.16)",
  backgroundColor: "rgba(0,0,0,0.25)",
  color: "rgba(255,255,255,0.8)",
  fontSize: "0.7rem",
  fontWeight: 700,
  cursor: "pointer",
  padding: 0,
};

export const GenerationRatingToast = () => {
  const [pending, setPending] = useState(null); // { recordId, taskKey }
  const [enabled, setEnabled] = useState(() => isRatingEnabled());

  useEffect(() => {
    const onSettingChange = () => setEnabled(isRatingEnabled());
    window.addEventListener(TELEMETRY_SETTINGS_EVENT, onSettingChange);
    return () => window.removeEventListener(TELEMETRY_SETTINGS_EVENT, onSettingChange);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let hideTimer = null;
    const handler = (event) => {
      const { recordId, taskKey, ok } = event.detail ?? {};
      if (!recordId || ok === false || !RATING_ELIGIBLE_TASKS.has(taskKey)) return;
      setPending({ recordId, taskKey });
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setPending(null), 60000);
    };
    window.addEventListener(GENERATION_COMPLETE_EVENT, handler);
    return () => {
      window.removeEventListener(GENERATION_COMPLETE_EVENT, handler);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [enabled]);

  if (!enabled || !pending) return null;

  return (
    <div style={barStyle} role="group" aria-label="Rate this generation">
      <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
        Rate this {TASK_LABELS[pending.taskKey] || "generation"}
      </span>
      <div style={{ display: "flex", gap: "0.2rem" }}>
        {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
          <button
            key={value}
            type="button"
            title={`${value}/10`}
            style={scoreStyle}
            onClick={async () => {
              await setGenerationRating(pending.recordId, value);
              setPending(null);
            }}
          >
            {value}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setPending(null)}
        style={{ ...scoreStyle, width: "auto", padding: "0 0.5rem", color: "rgba(255,255,255,0.6)" }}
      >
        Skip
      </button>
    </div>
  );
};

export default GenerationRatingToast;
