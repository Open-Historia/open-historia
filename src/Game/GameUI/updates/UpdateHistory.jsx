/*! Open Historia — every update, on a timeline © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make it so by clicking the open historia logo in the top left in the main
// menu you can open the history to view a timeline with every update and their
// banner on the time line (including minor ones)" (the owner, 2026-10-15).
//
// Every update in notes.js, newest first, by month along a line: a major one
// as a card in its own colours (its theme's, or its palette's) whose banners
// open whole (UpdateNotice.jsx) with View; a minor one plainly, its lines
// shown where it stands. Opened from the main menu's mark (libraryBar.jsx
// MenuRail); nothing in it is remembered as seen.

import React, { useEffect, useMemo, useRef, useState } from "react";

import { SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP } from "../../../runtime/mobileUi.js";
import { UPDATES } from "./notes.js";
import { NOTICE_Z, formatUpdateDate, noticeDate, useStill, motion } from "./updateKit.jsx";
import { UpdateNotice, chromeOf } from "./UpdateNotice.jsx";

const INK = "#f4f4f5";
const SOFT = "rgba(244,244,245,0.66)";
const FAINT = "rgba(244,244,245,0.42)";
const LINE = "rgba(255,255,255,0.12)";
// The month an update falls in, as the timeline heads it: "October 2026" (in the player's language).
const monthOf = (date) => formatUpdateDate(String(date || "").slice(0, 7), { month: "long", year: "numeric" });

const UpdateCard = ({ update, onView, delay }) => {
  const still = useStill();
  const release = update.kind === "release";
  const major = update.kind === "major" || release;
  const first = release ? { title: update.title, subtitle: update.subtitle, lead: update.lead } : update.banners?.[0] ?? {};
  const chrome = chromeOf({ update, banner: first });
  const accent = release ? "#d9a441" : major ? chrome.dot.on : "rgba(244,244,245,0.5)";
  return (
    <li style={{ listStyle: "none", margin: "0 0 0.9rem", paddingLeft: "2.4rem", position: "relative", ...motion(still, "ohUpdRise", 500, delay) }}>
      <span
        aria-hidden="true"
        style={{
          background: major ? accent : "#0b0c0f",
          border: `2px solid ${accent}`,
          borderRadius: major ? "4px" : "50%",
          height: major ? "0.95rem" : "0.6rem",
          left: major ? "0.62rem" : "0.8rem",
          position: "absolute",
          top: major ? "0.95rem" : "1.05rem",
          transform: major ? "rotate(45deg)" : "none",
          width: major ? "0.95rem" : "0.6rem",
        }}
      />
      <div
        style={{
          background: major ? "#15181d" : "rgba(255,255,255,0.03)",
          border: `1px solid ${major ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.06)"}`,
          borderLeft: `3px solid ${accent}`,
          borderRadius: "10px",
          padding: major ? "0.85rem 1rem 0.9rem" : "0.6rem 0.85rem 0.65rem",
        }}
      >
        <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <span style={{ color: major ? accent : FAINT, fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>{release ? <>Version <span data-no-translate>{update.version}</span></> : major ? <>Major update</> : <>Minor update</>}</span>
          <span style={{ color: FAINT, fontSize: "0.72rem" }}>{noticeDate(update.date)}</span>
          {update.channel === "beta" && <span style={{ border: `1px solid ${LINE}`, borderRadius: "999px", color: FAINT, fontSize: "0.64rem", padding: "0 0.4rem" }}>First on the beta</span>}
          {update.channel === "alpha" && <span style={{ border: `1px solid ${LINE}`, borderRadius: "999px", color: FAINT, fontSize: "0.64rem", padding: "0 0.4rem" }}>First on the alpha</span>}
        </div>
        <div style={{ color: INK, fontSize: major ? "1.15rem" : "0.92rem", fontWeight: 800, marginTop: "0.2rem" }}>
          {first.title}
          {major && first.subtitle && <span style={{ color: SOFT, fontWeight: 600 }}> · {first.subtitle}</span>}
        </div>
        {major && first.lead && <p style={{ color: SOFT, fontSize: "0.84rem", lineHeight: 1.5, margin: "0.35rem 0 0" }}>{first.lead}</p>}
        {major && !release && update.banners.length > 1 && (
          <div style={{ color: FAINT, fontSize: "0.76rem", marginTop: "0.4rem" }}>
            {update.banners.map((banner) => banner.title).join(" · ")}
          </div>
        )}
        {!major && (
          <ul style={{ color: SOFT, fontSize: "0.8rem", lineHeight: 1.5, margin: "0.35rem 0 0", paddingLeft: "1.05rem" }}>
            {update.banners.flatMap((banner) => banner.items ?? []).map((item) => <li key={item}>{item}</li>)}
          </ul>
        )}
        {major && (
          <button
            className="oh-tap"
            onClick={() => onView(update)}
            style={{ borderRadius: "8px", cursor: "pointer", fontSize: "0.8rem", fontWeight: 800, marginTop: "0.7rem", minHeight: "2.1rem", padding: "0.35rem 1rem", ...chrome.button }}
            type="button"
          >
            View
          </button>
        )}
      </div>
    </li>
  );
};

// The timeline, over the main menu. `onClose` takes it away.
export const UpdateHistory = ({ onClose, updates = UPDATES }) => {
  const still = useStill();
  const [viewing, setViewing] = useState(null);
  const viewingRef = useRef(null);
  viewingRef.current = viewing;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape" && !viewingRef.current) closeRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const months = useMemo(() => {
    const groups = [];
    for (const update of updates) {
      const month = monthOf(update.date);
      if (groups.at(-1)?.month !== month) groups.push({ month, updates: [] });
      groups.at(-1).updates.push(update);
    }
    return groups;
  }, [updates]);
  let order = 0;
  return (
    <>
      <div
        aria-label="Update history"
        aria-modal="true"
        className="oh-upd-anim"
        data-oh-no-motion={still ? "" : undefined}
        role="dialog"
        style={{ background: "#0b0c0f", color: INK, display: "flex", flexDirection: "column", fontFamily: "sans-serif", inset: 0, position: "fixed", zIndex: NOTICE_Z - 10, ...motion(still, "ohUpdFade", 250) }}
      >
        <div style={{ alignItems: "center", borderBottom: `1px solid ${LINE}`, display: "flex", flexShrink: 0, gap: "0.8rem", padding: `calc(0.8rem + ${SAFE_TOP}) calc(1rem + ${SAFE_RIGHT}) 0.8rem calc(1rem + ${SAFE_LEFT})` }}>
          <img alt="" src="/logo.png" style={{ height: "2.2rem", width: "2.2rem" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "1.05rem", fontWeight: 850 }}>Update history</div>
            <div style={{ color: FAINT, fontSize: "0.74rem" }}>Every update to Open Historia, newest first.</div>
          </div>
          <button
            aria-label="Close"
            className="oh-tap"
            onClick={onClose}
            style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${LINE}`, borderRadius: "999px", color: INK, cursor: "pointer", fontSize: "1.1rem", height: "2.3rem", width: "2.3rem" }}
            type="button"
          >
            ×
          </button>
        </div>
        <div className="oh-upd-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: `1.2rem calc(1rem + ${SAFE_RIGHT}) calc(2rem + ${SAFE_BOTTOM}) calc(1rem + ${SAFE_LEFT})` }}>
          <div style={{ margin: "0 auto", maxWidth: "46rem", position: "relative" }}>
            <span aria-hidden="true" style={{ background: LINE, bottom: 0, left: "1.06rem", position: "absolute", top: "0.4rem", width: "2px" }} />
            {months.map((group) => (
              <section key={group.month}>
                <div style={{ background: "#0b0c0f", color: FAINT, fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.14em", margin: "0.4rem 0 0.8rem", paddingLeft: "2.4rem", position: "relative", textTransform: "uppercase" }}>{group.month}</div>
                <ul style={{ margin: 0, padding: 0 }}>
                  {group.updates.map((update) => {
                    order += 1;
                    return <UpdateCard delay={Math.min(order, 12) * 50} key={update.id} onView={setViewing} update={update} />;
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
      {viewing && <UpdateNotice onClose={() => setViewing(null)} updates={[viewing]} />}
    </>
  );
};

export default UpdateHistory;
