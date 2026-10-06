/*! Open Historia — Listen in: the phone © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The Listen in button on a region's card and in a country's panel opens this:
// a phone showing what ordinary people in that place are posting
// (runtime/listenIn.js). On a desktop it is drawn as a phone in the middle of
// the screen; on a real phone it is the whole screen, since the frame is
// already in the player's hand.
//
// A feed is one AI request (AI/gameplay.js generateListenInFeed), made when the
// phone opens on a place it has nothing for today, or when the player asks for
// new posts. What comes back is kept on the device (runtime/listenInStore.js),
// so the same place on the same game day opens at once and costs nothing, and
// scrolling down goes back through the days it was read on. A request still
// running when the phone is closed is finished and kept all the same: it was
// paid for.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useBackToClose } from "../../runtime/backToClose.js";
import { useActiveFeatures } from "../../runtime/gameFeatures.js";
import { formatGameDateReadable } from "../../runtime/gameDates.js";
import { readGameData, readWorldStateView } from "../../runtime/gameState.js";
import { getStoredLanguage, languageDisplayName } from "../../runtime/i18n.js";
import { getLibraryState } from "../../runtime/library.js";
import {
  addListenInBatch,
  createListenInBatch,
  listenInAgeLabel,
  listenInAvatar,
  listenInBatchLine,
  listenInCountLabel,
  listenInCountryOf,
  listenInFeedLanguage,
  listenInFeedView,
  listenInPlace,
  listenInRequestKey,
} from "../../runtime/listenIn.js";
import { readListenInStore, updateListenInStore } from "../../runtime/listenInStore.js";
import { APP_HEIGHT, SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP, useShortTouchScreen } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { generateListenInFeed } from "../AI/gameplayLazy.js";
import { getWorldStateSnapshot } from "../Map/useWorldState.js";
import { createReportRequests } from "../Selection/reportRequests.js";

// Bridge: the region card and the country panel open the phone from outside it.
let _open = null;

// `place`: { regionId, regionName, polity, polityKey } for a region, or
// { polity, polityKey } for a country (runtime/listenIn.js listenInPlace).
export const openListenIn = (place) => {
  _open?.(place);
};

// Feeds being written, by game, place, day and language, outside the phone: it
// is closed and reopened while one is on its way, and the second opening joins
// the first request (Selection/reportRequests.js).
const feedRequests = createReportRequests();

// Above the country panel (10042), and above the cheats panel, whose number it
// shares: the phone is put in the document when it opens, after anything that
// could be open under it. Under the main menu (10046) and what the menu opens.
const Z_INDEX = 10045;

const STYLE_ID = "listen-in-phone-styles";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
  @keyframes listenInRise {
    from { opacity: 0; transform: translateY(18px) scale(0.985); }
    to   { opacity: 1; transform: none; }
  }
  @keyframes listenInFade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes listenInShimmer {
    from { background-position: 180% 0; }
    to   { background-position: -80% 0; }
  }
  .listen-in-scroll { scrollbar-width: none; }
  .listen-in-scroll::-webkit-scrollbar { display: none; }
  .listen-in-action:hover { color: rgba(244,244,245,0.9); }
  @media (prefers-reduced-motion: reduce) {
    .listen-in-anim { animation: none !important; }
  }
  `;
  document.head.appendChild(style);
}

const INK = "#f4f4f5";
const INK_SOFT = "rgba(244,244,245,0.56)";
const INK_FAINT = "rgba(244,244,245,0.34)";
const LINE = "rgba(255,255,255,0.09)";
const SCREEN = "#0b0b0d";
const LIKED = "#f43f5e";

const iconProps = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
const ReplyIcon = () => <svg {...iconProps}><path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l2-5.6A8.4 8.4 0 1 1 21 11.5z" /></svg>;
const RepostIcon = () => <svg {...iconProps}><path d="M17 2l4 4-4 4" /><path d="M3 12V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 12v3a3 3 0 0 1-3 3H3" /></svg>;
const HeartIcon = ({ filled }) => <svg {...iconProps} fill={filled ? "currentColor" : "none"}><path d="M20.8 5.6a5.2 5.2 0 0 0-7.4 0L12 7l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21.8l8.8-8.8a5.2 5.2 0 0 0 0-7.4z" /></svg>;
const ShareIcon = () => <svg {...iconProps}><path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v13" /></svg>;
const RefreshIcon = () => <svg {...iconProps}><path d="M21 4v6h-6" /><path d="M3 20v-6h6" /><path d="M5.2 9a8 8 0 0 1 13.6-2.6L21 10" /><path d="M18.8 15a8 8 0 0 1-13.6 2.6L3 14" /></svg>;
const CloseIcon = () => <svg {...iconProps}><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>;
const HomeIcon = () => <svg {...iconProps} width={22} height={22} fill="currentColor" stroke="none"><path d="M12 3l9 8h-2.5v9h-5v-6h-3v6h-5v-9H3z" /></svg>;
const SearchIcon = () => <svg {...iconProps} width={22} height={22}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.5-4.5" /></svg>;
const BellIcon = () => <svg {...iconProps} width={22} height={22}><path d="M18 9a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>;
const MailIcon = () => <svg {...iconProps} width={22} height={22}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>;

// The top of a phone's screen: the time (here, the game's day), the island,
// and the signal, wireless and battery marks. Only drawn inside the frame.
const StatusBar = ({ date }) => (
  <div aria-hidden="true" style={{ alignItems: "center", color: INK, display: "grid", flex: "0 0 auto", fontSize: "0.72rem", fontWeight: 700, gridTemplateColumns: "1fr auto 1fr", height: "2.75rem", padding: "0.35rem 1.5rem 0" }}>
    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{date}</span>
    <span style={{ background: "#000", borderRadius: "999px", boxShadow: "0 0 0 1px rgba(255,255,255,0.05)", height: "1.55rem", width: "5.6rem" }} />
    <span style={{ alignItems: "center", display: "flex", gap: "0.3rem", justifyContent: "flex-end" }}>
      <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="0.7" /><rect x="4.6" y="5" width="3" height="6" rx="0.7" /><rect x="9.2" y="2.6" width="3" height="8.4" rx="0.7" /><rect x="13.8" y="0" width="3" height="11" rx="0.7" /></svg>
      <svg width="15" height="11" viewBox="0 0 15 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M1 4.2a9.2 9.2 0 0 1 13 0" /><path d="M3.4 6.7a5.8 5.8 0 0 1 8.2 0" /><circle cx="7.5" cy="9.3" r="0.9" fill="currentColor" stroke="none" /></svg>
      <svg width="24" height="11" viewBox="0 0 24 11" fill="none"><rect x="0.5" y="0.5" width="20" height="10" rx="2.6" stroke="currentColor" opacity="0.45" /><rect x="2" y="2" width="14" height="7" rx="1.4" fill="currentColor" /><rect x="21.6" y="3.4" width="1.6" height="4.2" rx="0.8" fill="currentColor" opacity="0.5" /></svg>
    </span>
  </div>
);

const headerButtonStyle = {
  alignItems: "center",
  background: "rgba(255,255,255,0.06)",
  border: "none",
  borderRadius: "999px",
  color: INK,
  cursor: "pointer",
  display: "inline-flex",
  flex: "0 0 auto",
  height: "2rem",
  justifyContent: "center",
  padding: 0,
  width: "2rem",
};

// The one filled button the screen has: try again, load posts.
const pillButtonStyle = {
  background: INK,
  border: "none",
  borderRadius: "999px",
  color: SCREEN,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "0.8rem",
  fontWeight: 800,
  marginTop: "0.7rem",
  padding: "0.45rem 1.1rem",
};

const Avatar = ({ author }) => {
  const { initials, colour } = listenInAvatar(author);
  return (
    <span aria-hidden="true" style={{ alignItems: "center", background: colour, borderRadius: "50%", color: "#fff", display: "flex", flex: "0 0 auto", fontSize: "0.82rem", fontWeight: 700, height: "2.5rem", justifyContent: "center", letterSpacing: "0.02em", width: "2.5rem" }}>
      {initials}
    </span>
  );
};

const actionStyle = {
  alignItems: "center",
  background: "none",
  border: "none",
  color: INK_FAINT,
  cursor: "default",
  display: "inline-flex",
  fontFamily: "inherit",
  fontSize: "0.74rem",
  gap: "0.3rem",
  minWidth: "3rem",
  padding: "0.15rem 0",
};

// One post. The words are the model's and already in the player's language, so
// the page's translator leaves the whole post alone (data-no-translate).
const Post = ({ post, language, liked, onLike }) => (
  <article data-no-translate style={{ borderBottom: `1px solid ${LINE}`, display: "flex", gap: "0.7rem", padding: "0.8rem 1rem" }}>
    <Avatar author={post.author} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ alignItems: "baseline", display: "flex", gap: "0.3rem", minWidth: 0 }}>
        <span style={{ color: INK, flex: "0 1 auto", fontSize: "0.9rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.author}</span>
        {post.handle && (
          <span style={{ color: INK_SOFT, flex: "0 10 auto", fontSize: "0.82rem", minWidth: "2rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`@${post.handle}`}</span>
        )}
        <span style={{ color: INK_SOFT, flex: "0 0 auto", fontSize: "0.82rem" }}>{`· ${listenInAgeLabel(post.minutesAgo, language)}`}</span>
      </div>
      {post.about && (
        <div style={{ color: INK_FAINT, fontSize: "0.74rem", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.about}</div>
      )}
      <div style={{ color: INK, fontSize: "0.92rem", lineHeight: 1.42, marginTop: "0.2rem", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{post.text}</div>
      <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginTop: "0.5rem", maxWidth: "17rem" }}>
        <span className="listen-in-action" style={actionStyle}><ReplyIcon />{listenInCountLabel(post.replies, language)}</span>
        <span className="listen-in-action" style={actionStyle}><RepostIcon />{listenInCountLabel(post.reposts, language)}</span>
        <button
          type="button"
          // The one of the four that answers a tap: finger-sized on a touch screen.
          className="listen-in-action oh-tap-row"
          aria-pressed={liked}
          onClick={onLike}
          style={{ ...actionStyle, color: liked ? LIKED : INK_FAINT, cursor: "pointer" }}
        >
          <HeartIcon filled={liked} />{listenInCountLabel(post.likes + (liked ? 1 : 0), language)}
        </button>
        <span className="listen-in-action" style={{ ...actionStyle, minWidth: 0 }}><ShareIcon /></span>
      </div>
    </div>
  </article>
);

// What stands in for the posts while the request is out.
const SkeletonPost = ({ width }) => {
  const bar = (w, h = "0.7rem") => ({
    animationDuration: "1.4s",
    animationIterationCount: "infinite",
    animationName: "listenInShimmer",
    animationTimingFunction: "linear",
    background: "linear-gradient(90deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.13) 40%, rgba(255,255,255,0.06) 80%)",
    backgroundSize: "260% 100%",
    borderRadius: "999px",
    height: h,
    width: w,
  });
  return (
    <div aria-hidden="true" style={{ borderBottom: `1px solid ${LINE}`, display: "flex", gap: "0.7rem", padding: "0.8rem 1rem" }}>
      <span className="listen-in-anim" style={{ ...bar("2.5rem", "2.5rem"), borderRadius: "50%", flex: "0 0 auto" }} />
      <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: "0.5rem", paddingTop: "0.2rem" }}>
        <span className="listen-in-anim" style={bar("45%")} />
        <span className="listen-in-anim" style={bar("92%")} />
        <span className="listen-in-anim" style={bar(width)} />
      </div>
    </div>
  );
};

const tabStyle = (active) => ({
  background: "none",
  border: "none",
  borderBottom: `2px solid ${active ? INK : "transparent"}`,
  color: active ? INK : INK_SOFT,
  cursor: "pointer",
  flex: 1,
  fontFamily: "inherit",
  fontSize: "0.84rem",
  fontWeight: 700,
  minWidth: 0,
  overflow: "hidden",
  padding: "0.6rem 0.5rem 0.5rem",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

// The game day, the campaign and the language a feed answers for, read when the
// phone opens. The language is handed to the request as it is, so a feed is
// kept under the very name the phone looks it up by (runtime/listenIn.js).
const readSession = async () => {
  const game = await readGameData().catch(() => ({}));
  // The map's live world when it has one, as the country panel reads it.
  const world = getWorldStateSnapshot() ?? await readWorldStateView().catch(() => null);
  const uiLanguage = getStoredLanguage();
  return {
    gameId: String(getLibraryState()?.activeGameId ?? ""),
    gameDate: String(game?.gameDate ?? ""),
    uiLanguage,
    language: listenInFeedLanguage({
      uiLanguage,
      uiLanguageName: languageDisplayName(uiLanguage),
      saveLanguage: world?.language || game?.language,
    }),
  };
};

const ListenInPhone = () => {
  // The whole screen on a phone, upright or on its side (runtime/mobileUi.js);
  // a phone drawn in the middle of anything larger.
  const isMobile = useIsMobile();
  const shortTouch = useShortTouchScreen();
  const fullScreen = isMobile || shortTouch;
  const enabled = useActiveFeatures().listenIn?.enabled !== false;
  // The place the phone was opened on, and whether it shows that place or, for
  // a region, the country it is in.
  const [target, setTarget] = useState(null);
  const [nationwide, setNationwide] = useState(false);
  const [session, setSession] = useState(null);
  const [store, setStore] = useState(null);
  // By request key: what this opening has asked for, what is being written,
  // and what failed. Opening the phone on a place asks for it once; anything
  // after that is the player's own press, so a feed can never be asked for in
  // a loop, whatever comes back.
  const [asked, setAsked] = useState({});
  const [loading, setLoading] = useState({});
  const [failed, setFailed] = useState({});
  const [liked, setLiked] = useState(() => new Set());
  const sessionRef = useRef(null);
  const mounted = useRef(true);
  const closeButton = useRef(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const close = useCallback(() => {
    setTarget(null);
    setSession(null);
    setStore(null);
    sessionRef.current = null;
  }, []);

  _open = (place) => {
    const next = listenInPlace(place);
    if (!next || !enabled) return;
    setTarget(next);
    setNationwide(false);
    setSession(null);
    setStore(null);
    setAsked({});
    setLoading({});
    setFailed({});
    setLiked(new Set());
    sessionRef.current = null;
  };

  // Read the game and what is kept for it, once per opening.
  useEffect(() => {
    if (!target) return undefined;
    let cancelled = false;
    (async () => {
      const next = await readSession();
      const kept = await readListenInStore(next.gameId);
      if (cancelled) return;
      sessionRef.current = next;
      setSession(next);
      setStore(kept);
    })();
    return () => { cancelled = true; };
  }, [target]);

  // Another save, or the feature switched off under an open phone: put it away.
  useEffect(() => {
    if (!target) return undefined;
    if (!enabled) {
      close();
      return undefined;
    }
    window.addEventListener("oh:active-game-changed", close);
    return () => window.removeEventListener("oh:active-game-changed", close);
  }, [target, enabled, close]);

  // Escape puts the phone away and nothing else: it is on top, and the panels
  // under it (a country's, the statistics) listen for the same key.
  useEffect(() => {
    if (!target) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    closeButton.current?.focus?.();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [target, close]);

  // Back on a phone closes it (runtime/backToClose.js).
  useBackToClose(Boolean(target), close);

  const country = useMemo(() => (target?.scope === "region" ? listenInCountryOf(target) : null), [target]);
  const shown = nationwide && country ? country : target;
  const requestKey = session && shown ? listenInRequestKey({ ...session, place: shown }) : "";
  const failure = requestKey ? failed[requestKey] : undefined;
  // What to show, and whether opening on this place is itself the asking
  // (runtime/listenIn.js listenInFeedView: once per opening, never in a loop).
  const { batches, shouldAsk, waiting, canAsk, trends } = listenInFeedView({
    store: session ? store : null,
    place: shown,
    gameDate: session?.gameDate,
    language: session?.language,
    asked: Boolean(asked[requestKey]),
    loading: Boolean(loading[requestKey]),
    failed: failure !== undefined,
  });

  // One request for the place shown. Joined if one is already on its way; kept
  // on the device when it lands, whether or not the phone is still open on it.
  const load = useCallback((place, key, language) => {
    const without = (all) => {
      const { [key]: _gone, ...rest } = all;
      return rest;
    };
    setAsked((all) => ({ ...all, [key]: true }));
    setFailed(without);
    setLoading((all) => ({ ...all, [key]: true }));
    const request = feedRequests.request(key, async () => {
      // An answer always holds a post (the request fails otherwise), and a
      // batch without one would simply not be kept.
      const answer = await generateListenInFeed({ place, language });
      const batch = createListenInBatch(answer);
      await updateListenInStore(answer.campaignId, (kept) => addListenInBatch(kept, place, batch));
      return { campaignId: answer.campaignId, gameDate: answer.gameDate };
    });
    request
      .then(async (outcome) => {
        // What is kept now, which holds any other feed that landed meanwhile.
        const kept = await readListenInStore(outcome.campaignId);
        const open = sessionRef.current;
        if (!mounted.current || !open || open.gameId !== outcome.campaignId) return;
        setStore(kept);
        // A feed is stamped with the day the game was really on. Should that
        // not be the day the phone read when it opened, the phone follows it:
        // the feed it has just paid for is filed under that day.
        if (outcome.gameDate && outcome.gameDate !== open.gameDate) {
          const next = { ...open, gameDate: outcome.gameDate };
          sessionRef.current = next;
          setSession(next);
        }
      })
      .catch((error) => {
        if (mounted.current) setFailed((all) => ({ ...all, [key]: String(error?.message || "") }));
      })
      .then(() => {
        if (mounted.current) setLoading(without);
      });
  }, []);

  // Opened on a place with nothing for today: that is the player asking, once.
  useEffect(() => {
    if (shouldAsk) load(shown, requestKey, session.language);
  }, [shouldAsk, load, shown, requestKey, session]);

  if (!target) return null;

  const title = shown?.scope === "region" ? shown.regionName : shown?.polity;
  const dateLong = formatGameDateReadable(session?.gameDate) || "";
  const dateShort = formatGameDateReadable(session?.gameDate, "D MMM YYYY") || "";
  const ask = () => load(shown, requestKey, session.language);
  const toggleLike = (id) => setLiked((all) => {
    const next = new Set(all);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const screen = (
    <div style={{ background: SCREEN, color: INK, display: "flex", flex: 1, flexDirection: "column", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif", maxWidth: fullScreen ? "40rem" : undefined, minHeight: 0, overflow: "hidden" }}>
      {!fullScreen && <StatusBar date={dateShort} />}

      {/* The app's own header: put away, where and when, new posts. */}
      <div style={{ alignItems: "center", display: "flex", flex: "0 0 auto", gap: "0.6rem", padding: fullScreen ? `calc(0.6rem + ${SAFE_TOP}) 0.9rem 0.5rem` : "0.35rem 0.9rem 0.5rem" }}>
        <button ref={closeButton} type="button" className="oh-tap" aria-label="Close Listen in" title="Close" onClick={close} style={headerButtonStyle}>
          <CloseIcon />
        </button>
        <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
          <div style={{ fontSize: "0.98rem", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
          <div style={{ color: INK_SOFT, fontSize: "0.7rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dateLong}</div>
        </div>
        <button
          type="button"
          className="oh-tap"
          aria-label="Load new posts"
          title="Load new posts (one AI request)"
          disabled={!canAsk}
          onClick={ask}
          style={{ ...headerButtonStyle, cursor: canAsk ? "pointer" : "default", opacity: canAsk ? 1 : 0.45 }}
        >
          <RefreshIcon />
        </button>
      </div>

      {/* A region's phone can turn to the whole country and back. */}
      {country && (
        <div role="tablist" style={{ borderBottom: `1px solid ${LINE}`, display: "flex", flex: "0 0 auto" }}>
          <button type="button" role="tab" aria-selected={!nationwide} className="oh-tap-row" onClick={() => setNationwide(false)} style={tabStyle(!nationwide)}>{target.regionName}</button>
          <button type="button" role="tab" aria-selected={nationwide} className="oh-tap-row" onClick={() => setNationwide(true)} style={tabStyle(nationwide)}>{country.polity}</button>
        </div>
      )}

      <div className="listen-in-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", paddingBottom: shortTouch ? SAFE_BOTTOM : undefined }}>
        {trends.length > 0 && (
          <div style={{ borderBottom: `1px solid ${LINE}`, padding: "0.65rem 1rem 0.7rem" }}>
            <div style={{ color: INK_SOFT, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em", marginBottom: "0.4rem", textTransform: "uppercase" }}>Trending</div>
            <div data-no-translate style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
              {trends.map((trend) => (
                <span key={trend} style={{ background: "rgba(255,255,255,0.07)", borderRadius: "999px", color: INK, fontSize: "0.76rem", fontWeight: 600, padding: "0.22rem 0.6rem" }}>{trend}</span>
              ))}
            </div>
          </div>
        )}

        {waiting && (
          <div role="status">
            <div style={{ color: INK_SOFT, fontSize: "0.76rem", padding: "0.7rem 1rem 0.2rem" }}>Tuning in…</div>
            <SkeletonPost width="70%" />
            <SkeletonPost width="48%" />
            <SkeletonPost width="82%" />
          </div>
        )}

        {failure !== undefined && !waiting && (
          <div role="alert" style={{ borderBottom: `1px solid ${LINE}`, padding: "1.1rem 1rem", textAlign: "center" }}>
            <div style={{ fontSize: "0.9rem", fontWeight: 700 }}>The feed could not be loaded.</div>
            {failure && <div data-no-translate style={{ color: INK_SOFT, fontSize: "0.74rem", lineHeight: 1.4, marginTop: "0.3rem", overflowWrap: "anywhere" }}>{failure}</div>}
            <button type="button" className="oh-tap-row" onClick={ask} style={pillButtonStyle}>
              Try again
            </button>
          </div>
        )}

        {/* Asked, answered, and still nothing to show for this place. */}
        {!waiting && failure === undefined && batches.length === 0 && (
          <div style={{ padding: "1.6rem 1rem", textAlign: "center" }}>
            <div style={{ color: INK_SOFT, fontSize: "0.86rem" }}>Nothing has come through yet.</div>
            <button type="button" className="oh-tap-row" onClick={ask} style={pillButtonStyle}>
              Load posts
            </button>
          </div>
        )}

        {batches.map((batch, index) => {
          // A feed read on an earlier day says which, as a feed's date line
          // does; an earlier one of the same day only that it is earlier.
          const line = listenInBatchLine(batches, index, session.gameDate);
          return (
            <section key={batch.id}>
              {line && (
                <div style={{ background: "rgba(255,255,255,0.03)", borderBottom: `1px solid ${LINE}`, color: INK_SOFT, fontSize: "0.7rem", fontWeight: 700, padding: "0.4rem 1rem", textAlign: "center" }}>
                  {line.kind === "date" ? formatGameDateReadable(line.gameDate) || line.gameDate : "Earlier"}
                </div>
              )}
              {batch.posts.map((post) => (
                <Post key={post.id} post={post} language={session.uiLanguage} liked={liked.has(post.id)} onLike={() => toggleLike(post.id)} />
              ))}
            </section>
          );
        })}

        {batches.length > 0 && (
          <div style={{ color: INK_FAINT, fontSize: "0.68rem", lineHeight: 1.45, padding: "0.9rem 1.2rem 1.2rem", textAlign: "center" }}>
            Written by your AI model. Each new feed is one AI request.
          </div>
        )}
      </div>

      {/* The bar every such app has at the bottom. Here it is only the look, so
          a phone on its side, with no height to spare, goes without. */}
      {!shortTouch && (
        <div aria-hidden="true" style={{ borderTop: `1px solid ${LINE}`, color: INK_SOFT, display: "flex", flex: "0 0 auto", justifyContent: "space-around", padding: fullScreen ? `0.55rem 1rem calc(0.55rem + ${SAFE_BOTTOM})` : "0.55rem 1rem 0.3rem" }}>
          <span style={{ color: INK, display: "flex" }}><HomeIcon /></span>
          <span style={{ display: "flex" }}><SearchIcon /></span>
          <span style={{ display: "flex" }}><BellIcon /></span>
          <span style={{ display: "flex" }}><MailIcon /></span>
        </div>
      )}
      {!fullScreen && (
        <div aria-hidden="true" style={{ display: "flex", flex: "0 0 auto", justifyContent: "center", padding: "0.35rem 0 0.5rem" }}>
          <span style={{ background: "rgba(244,244,245,0.85)", borderRadius: "999px", height: "0.28rem", width: "7.4rem" }} />
        </div>
      )}
    </div>
  );

  // On a real phone the app is the whole screen (a column of it, on its side).
  if (fullScreen) {
    return createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Listen in"
        className="listen-in-anim"
        style={{ animation: "listenInFade 0.16s ease-out both", background: SCREEN, display: "flex", height: APP_HEIGHT, justifyContent: "center", left: 0, paddingLeft: SAFE_LEFT, paddingRight: SAFE_RIGHT, position: "fixed", right: 0, top: 0, zIndex: Z_INDEX }}
      >
        {screen}
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      className="listen-in-anim"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      style={{ alignItems: "center", animation: "listenInFade 0.16s ease-out both", background: "rgba(6,6,8,0.62)", display: "flex", inset: 0, justifyContent: "center", position: "fixed", zIndex: Z_INDEX }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Listen in"
        className="listen-in-anim"
        style={{
          animation: "listenInRise 0.26s cubic-bezier(0.22, 1, 0.36, 1) both",
          background: "#17171a",
          borderRadius: "3.1rem",
          boxShadow: "0 0 0 1px #3a3a40, 0 0 0 3px #0e0e10, 0 32px 80px rgba(0,0,0,0.65)",
          display: "flex",
          height: `min(49rem, calc(${APP_HEIGHT} - 2rem))`,
          padding: "0.6rem",
          position: "relative",
          width: "min(23.5rem, calc(100vw - 2rem))",
        }}
      >
        {/* The side buttons, as the frame's only ornament. */}
        <span aria-hidden="true" style={{ background: "#2c2c31", borderRadius: "2px 0 0 2px", height: "2rem", left: "-3px", position: "absolute", top: "7.2rem", width: "3px" }} />
        <span aria-hidden="true" style={{ background: "#2c2c31", borderRadius: "2px 0 0 2px", height: "3.4rem", left: "-3px", position: "absolute", top: "10.4rem", width: "3px" }} />
        <span aria-hidden="true" style={{ background: "#2c2c31", borderRadius: "0 2px 2px 0", height: "5rem", position: "absolute", right: "-3px", top: "11rem", width: "3px" }} />
        <div style={{ borderRadius: "2.55rem", display: "flex", flex: 1, minWidth: 0, overflow: "hidden" }}>
          {screen}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ListenInPhone;
