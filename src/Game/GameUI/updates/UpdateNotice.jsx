/*! Open Historia — the notice behind the vault door: what the update brings © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Shown once a device for each new update (updateNotices.js), over the main
// menu and under the vault door, so the door opens onto it (App.jsx). Every
// banner of the updates shown is a page; several are paged with arrows (and
// the arrow keys), and the last one's button closes it (as Escape does). A
// minor update's banner is a plain card, and several minor updates one card,
// their changelog (ChangelogBanner); a major one's is its theme's
// (themes/), or the decorated default here. The arrows, page markers, Skip and
// the button are dressed as the banner shown is: by its theme's chrome, the
// default's palette, or plainly for a minor one. How to add one: notes.js.

import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";

import { SAFE_BOTTOM, SAFE_TOP } from "../../../runtime/mobileUi.js";
import { THEMES } from "./themes/index.js";
import { ACCENT, Brackets, Emblem, FeatureCards, NOTICE_Z, Plate, Reveal, Rule, motion, noticeDate, useStill } from "./updateKit.jsx";
import { noticePages } from "./updateNotices.js";

// A release's announcement (notesReleases.js), a page of its own: loaded only when one is shown.
const ReleaseNotice = lazy(() => import("./ReleaseNotice.jsx"));

const INK = "#f4f4f5";
const SOFT = "rgba(244,244,245,0.72)";
const FAINT = "rgba(244,244,245,0.5)";

// A minor update's banner: a plain card, a title and a few lines.
export const MinorBanner = ({ banner, update }) => (
  <Plate surface={{ background: "#1c1e22", borderRadius: "14px", padding: "1.2rem 1.3rem" }}>
    <div style={{ color: FAINT, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
      Update{update.date ? <> · {noticeDate(update.date)}</> : null}
    </div>
    <div style={{ color: INK, fontSize: "1.05rem", fontWeight: 800, marginTop: "0.3rem" }}>{banner.title}</div>
    {(banner.items ?? []).length > 0 && (
      <ul style={{ color: SOFT, fontSize: "0.82rem", lineHeight: 1.5, margin: "0.6rem 0 0", paddingLeft: "1.1rem" }}>
        {banner.items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    )}
  </Plate>
);

// Several minor updates shown together (updateNotices.js noticePages): one plain card, a changelog of them, newest
// first, each its date in the accent, then its banners' titles and lines. A long one scrolls in the notice.
export const ChangelogBanner = ({ banner, updates = [] }) => (
  <Plate surface={{ background: "#1c1e22", borderRadius: "14px", padding: "1.2rem 1.3rem" }}>
    <div style={{ color: FAINT, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Updates</div>
    <div style={{ color: INK, fontSize: "1.05rem", fontWeight: 800, marginTop: "0.3rem" }}>{banner.title}</div>
    <ol style={{ listStyle: "none", margin: "0.4rem 0 0", padding: 0 }}>
      {updates.map((update, at) => (
        <li key={update.id} style={{ borderTop: at === 0 ? "none" : "1px solid rgba(255,255,255,0.08)", padding: "0.75rem 0 0.1rem" }}>
          {update.date && (
            <div style={{ color: ACCENT, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{noticeDate(update.date)}</div>
          )}
          {(update.banners ?? []).map((entry, index) => (
            <div key={`${update.id}#${index}`} style={{ marginTop: index === 0 ? "0.15rem" : "0.55rem" }}>
              <div style={{ color: INK, fontSize: "0.92rem", fontWeight: 800 }}>{entry.title}</div>
              {(entry.items ?? []).length > 0 && (
                <ul style={{ color: SOFT, fontSize: "0.82rem", lineHeight: 1.5, margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
                  {entry.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
            </div>
          ))}
        </li>
      ))}
    </ol>
  </Plate>
);

// A major update's banner with no theme of its own: decorated, in its palette.
export const DefaultBanner = ({ banner, update }) => {
  const accent = banner.palette?.accent || ACCENT;
  const ink = banner.palette?.ink || INK;
  const soft = banner.palette?.soft || SOFT;
  return (
    <Plate surface={banner.palette?.ground ? { background: banner.palette.ground } : null}>
      <Brackets colour={accent} />
      <div style={{ padding: "2rem 2rem 1.6rem" }}>
        <Reveal delay={150} style={{ alignItems: "center", display: "flex", gap: "1rem" }}>
          <Emblem colour={accent} delay={200} size={68} />
          <div>
            <div style={{ color: accent, fontSize: "0.74rem", fontWeight: 800, letterSpacing: "0.2em", textTransform: "uppercase" }}>
              Major update{update.date ? <> · {noticeDate(update.date)}</> : null}
            </div>
            <div style={{ color: ink, fontSize: "clamp(1.6rem, 5vw, 2.4rem)", fontWeight: 900, lineHeight: 1.08 }}>{banner.title}</div>
            {banner.subtitle && <div style={{ color: accent, fontSize: "0.95rem", fontWeight: 700, letterSpacing: "0.04em" }}>{banner.subtitle}</div>}
          </div>
        </Reveal>
        {banner.lead && (
          <Reveal delay={350}>
            <p style={{ color: soft, fontSize: "0.95rem", lineHeight: 1.55, margin: "1rem 0 0" }}>{banner.lead}</p>
          </Reveal>
        )}
        <Rule colour={accent} />
        <FeatureCards accent={accent} card={banner.palette?.card ? { background: banner.palette.card } : null} delay={450} sections={banner.sections ?? []} soft={soft} />
      </div>
    </Plate>
  );
};

// One page: the banner as its kind and theme draw it.
const BannerView = ({ page }) => {
  const { banner, update } = page;
  if (page.changelog) return <ChangelogBanner banner={banner} updates={page.changelog} />;
  if (update.kind !== "major") return <MinorBanner banner={banner} update={update} />;
  const Theme = banner.theme ? THEMES[banner.theme]?.Page : null;
  if (!Theme) return <DefaultBanner banner={banner} update={update} />;
  // (A theme is loaded when its banner is shown; until it is, nothing: the door is still opening.)
  return (
    <Suspense fallback={null}>
      <Theme banner={banner} update={update} />
    </Suspense>
  );
};

// How the way between pages is dressed for a page: its theme's chrome, the default's palette, or plain.
export const chromeOf = (page) => {
  const { banner, update } = page;
  if (update.kind !== "major") {
    return {
      button: { background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.16)", color: INK },
      arrow: {},
      dot: { on: "rgba(244,244,245,0.85)", off: "rgba(255,255,255,0.22)" },
      skip: {},
    };
  }
  const kept = banner.theme ? THEMES[banner.theme]?.chrome : null;
  const own = typeof kept === "function" ? kept(banner) : kept;
  if (own) return own;
  const accent = banner.palette?.accent || ACCENT;
  return {
    button: { background: accent, border: `1px solid ${accent}`, color: banner.palette?.buttonInk || "#06121a" },
    arrow: { color: accent },
    dot: { on: accent, off: "rgba(255,255,255,0.25)" },
    skip: {},
  };
};

const arrow = (disabled) => ({
  alignItems: "center",
  background: "rgba(255,255,255,0.07)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: "999px",
  color: INK,
  cursor: disabled ? "default" : "pointer",
  display: "inline-flex",
  fontSize: "1.1rem",
  height: "2.3rem",
  justifyContent: "center",
  opacity: disabled ? 0.3 : 1,
  width: "2.3rem",
});

// The notice: every banner of `updates` as a page, and the way between them.
const NoticePages = ({ updates = [], onClose }) => {
  const pages = useMemo(() => noticePages(updates), [updates]);
  const [at, setAt] = useState(0);
  const still = useStill();
  const last = at >= pages.length - 1;
  const move = (step) => setAt((now) => Math.max(0, Math.min(pages.length - 1, now + step)));
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const countRef = useRef(pages.length);
  countRef.current = pages.length;
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") closeRef.current?.();
      else if (event.key === "ArrowRight") setAt((now) => Math.min(countRef.current - 1, now + 1));
      else if (event.key === "ArrowLeft") setAt((now) => Math.max(0, now - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (pages.length === 0) return null;
  const page = pages[Math.min(at, pages.length - 1)];
  const minor = page.update.kind !== "major";
  const chrome = chromeOf(page);
  const several = pages.length > 1;
  return (
    <div
      aria-label={page.banner.title}
      aria-modal="true"
      className="oh-upd-anim"
      data-oh-no-motion={still ? "" : undefined}
      role="dialog"
      style={{
        alignItems: "center",
        background: "rgba(4, 6, 9, 0.84)",
        boxSizing: "border-box",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        padding: `calc(${SAFE_TOP} + 1rem) 1rem calc(${SAFE_BOTTOM} + 1rem)`,
        position: "fixed",
        zIndex: NOTICE_Z,
        ...motion(still, "ohUpdFade", 400),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem", maxHeight: "100%", maxWidth: minor ? "28rem" : "62rem", width: "100%" }}>
        <div className="oh-upd-scroll" key={page.key} style={{ minHeight: 0, overflowY: "auto" }}>
          <BannerView page={page} />
        </div>
        <div style={{ alignItems: "center", display: "flex", flex: "0 0 auto", flexWrap: "wrap", gap: "0.6rem", justifyContent: several ? "space-between" : "flex-end" }}>
          {several && (
            <div style={{ alignItems: "center", display: "flex", gap: "0.55rem" }}>
              <button aria-label="Previous" className="oh-tap" disabled={at === 0} onClick={() => move(-1)} style={{ ...arrow(at === 0), ...chrome.arrow }} type="button">‹</button>
              <div aria-label={`Update notice ${at + 1} of ${pages.length}`} style={{ display: "flex", gap: "0.35rem" }}>
                {pages.map((entry, index) => (
                  <button
                    aria-label={entry.banner.title}
                    className="oh-tap"
                    key={entry.key}
                    onClick={() => setAt(index)}
                    style={{ background: index === at ? chrome.dot.on : chrome.dot.off, border: "none", borderRadius: chrome.dot.radius ?? "999px", cursor: "pointer", height: "0.5rem", padding: 0, transition: "width 200ms cubic-bezier(0.2, 0.7, 0.2, 1)", width: index === at ? "1.4rem" : "0.5rem" }}
                    type="button"
                  />
                ))}
              </div>
              <button aria-label="Next" className="oh-tap" disabled={last} onClick={() => move(1)} style={{ ...arrow(last), ...chrome.arrow }} type="button">›</button>
            </div>
          )}
          <div style={{ alignItems: "center", display: "flex", gap: "0.8rem" }}>
            {several && !last && (
              <button className="oh-tap" onClick={onClose} style={{ background: "none", border: "none", color: FAINT, cursor: "pointer", fontSize: "0.8rem", fontWeight: 700, ...chrome.skip }} type="button">Skip</button>
            )}
            <button
              className="oh-tap"
              onClick={() => (last ? onClose() : move(1))}
              style={{ borderRadius: "8px", cursor: "pointer", fontSize: "0.88rem", fontWeight: 800, minHeight: "2.4rem", padding: "0.45rem 1.25rem", ...chrome.button }}
              type="button"
            >
              {last ? page.banner.button || "Continue" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// A release is shown as its own scrolling page; anything else as the notice's pages.
export const UpdateNotice = ({ updates = [], onClose }) => (updates[0]?.kind === "release"
  ? <Suspense fallback={null}><ReleaseNotice onClose={onClose} update={updates[0]} /></Suspense>
  : <NoticePages onClose={onClose} updates={updates} />);

export default UpdateNotice;
