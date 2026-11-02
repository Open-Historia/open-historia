/*! Open Historia — Rostra, the world's social network © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The dock's third launcher opens Rostra: the posts of the people who make the
// news, written by each time skip in the answer it already gives, and the
// player's own, written as their country's leader (runtime/socialFeed.js has
// the rules, AI/gameplay.js the skip's side). Named after the speakers'
// platform of the Roman Forum: where a leader spoke to the city in public.
//
// Posting costs no request. A post is kept on the world (world.socialFeed), and
// the next time skip reads it as a public statement by the player's leader: the
// world answers it then, in posts that quote it and in what happens. A post is
// written only between skips (the skip writes the feed back with the world),
// and in a shared game through the host, as the leader of the seat's own country.
//
// Quoting works as it does on the networks people know: Quote under a post puts
// it in the box, and what is posted carries it embedded. The skip quotes the
// same way, by a post's id.

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getNationFlags } from "../../runtime/assets.js";
import { isComposerSendKey } from "../../runtime/composerKeys.js";
import { bundledFlagUrl, flagImageUrlFromGid } from "../../runtime/countryFlags.js";
import { formatGameDateReadable } from "../../runtime/gameDates.js";
import { mutateWorldState } from "../../runtime/gameState.js";
import { getLibraryState } from "../../runtime/library.js";
import { logDebugEvent } from "../../runtime/debugLog.js";
import { APP_HEIGHT, useTouchPrimary } from "../../runtime/mobileUi.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import {
  SOCIAL_POST_MAX_CHARS,
  compactCount,
  leaderOf,
  mentionsPlayer,
  newestPostNumber,
  playerAccount,
  postEngagement,
  postsAfter,
  socialFeedView,
  withPlayerPost,
} from "../../runtime/socialFeed.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { inSharedGame, requestFromHost } from "../../multiplayer/client/sharedGameBridge.js";
import { useTurnRunning } from "./useTurnRunning.js";

// Rostra's own colours: the game's grey, and the accent for what is the
// player's and what can be pressed.
const ACCENT = "#2bc1f3";
const ACCENT_SOFT = "rgba(43,193,243,0.14)";
const ACCENT_EDGE = "rgba(43,193,243,0.45)";
const INK = "#f4f4f5";
const INK_SOFT = "rgba(244,244,245,0.62)";
const INK_FAINT = "rgba(244,244,245,0.38)";
const LINE = "rgba(255,255,255,0.08)";
const CARD = "rgba(255,255,255,0.025)";
const AVATAR = "#2a2a2f";

const STYLE_ID = "rostra-styles";
const ensureStyles = () => {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
  @keyframes rostraIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .rostra-post { animation: rostraIn 0.28s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
  .rostra-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.2) transparent; }
  .rostra-action:hover { color: ${ACCENT}; }
  .rostra-composer::placeholder { color: ${INK_FAINT}; }
  @media (prefers-reduced-motion: reduce) { .rostra-post { animation: none; } }
  `;
  document.head.appendChild(style);
};

// --- Glyphs (the launchers' stroke family) -------------------------------------

const stroke = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

// A speaker at a lectern, speaking to the world.
const RostraDockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" strokeWidth="1.9" {...stroke}>
    <path d="M7.5 21h9l-1.4-8.5H8.9z" />
    <path d="M5.5 12.5h13" />
    <path d="M12 12.5V8.2" />
    <circle cx="12" cy="6.4" r="1.6" />
    <path d="M16.6 4.2a4.2 4.2 0 0 1 0 4.6" />
    <path d="M7.4 4.2a4.2 4.2 0 0 0 0 4.6" />
  </svg>
);

// Rostra's mark: the lectern in a speech bubble, in the accent.
const RostraMark = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <path d="M6 3h20a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H13l-6 5v-5H6a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z" fill={ACCENT} />
    <path d="M12 21h8l-1.2-7.5h-5.6z" fill="#0b1a20" />
    <path d="M9.5 13.5h13" stroke="#0b1a20" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="16" cy="9" r="2" fill="#0b1a20" />
  </svg>
);

const QuoteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth="1.8" {...stroke}>
    <path d="M7 7h4v4c0 2.5-1.3 4-4 5" />
    <path d="M14 7h4v4c0 2.5-1.3 4-4 5" />
  </svg>
);
const RepostIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth="1.8" {...stroke}>
    <path d="M17 3l3 3-3 3" />
    <path d="M4 12V9a3 3 0 0 1 3-3h13" />
    <path d="M7 21l-3-3 3-3" />
    <path d="M20 12v3a3 3 0 0 1-3 3H4" />
  </svg>
);
const HeartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth="1.8" {...stroke}>
    <path d="M20.5 5.8a5 5 0 0 0-7.1 0L12 7.2l-1.4-1.4a5 5 0 0 0-7.1 7.1L12 21.4l8.5-8.5a5 5 0 0 0 0-7.1z" />
  </svg>
);
const CloseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" strokeWidth="2.2" {...stroke}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

// --- Who wrote it ---------------------------------------------------------------

const initials = (name) => {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return letters.map((word) => Array.from(word)[0] ?? "").join("").toUpperCase() || "?";
};

// A polity's flag by the precedence every flag in the game follows (see
// resolveOwnerFlagUrl in projects.jsx): the scenario's own upload, then the
// polity's, then the ISO flag its name resolves to.
const flagFor = (country, customFlags, polities) => {
  const name = String(country ?? "").trim();
  if (!name) return "";
  const key = polities?.[name]
    ? name
    : Object.keys(polities ?? {}).find((entry) => String(polities[entry]?.name ?? "").trim() === name) || name;
  return customFlags?.[key] || customFlags?.[name] || polities?.[key]?.flag || flagImageUrlFromGid(key) || flagImageUrlFromGid(name) || "";
};

const Avatar = ({ name, flagUrl, mine, size = 2.4 }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [flagUrl]);
  return (
    <span aria-hidden="true" style={{ flexShrink: 0, height: `${size}rem`, position: "relative", width: `${size}rem` }}>
      <span style={{
        alignItems: "center",
        background: mine ? ACCENT_SOFT : AVATAR,
        border: `1px solid ${mine ? ACCENT_EDGE : "rgba(255,255,255,0.1)"}`,
        borderRadius: "999px",
        color: mine ? ACCENT : INK_SOFT,
        display: "flex",
        fontSize: `${size * 0.34}rem`,
        fontWeight: 800,
        height: "100%",
        justifyContent: "center",
        letterSpacing: "0.02em",
        width: "100%",
      }}
      >
        {initials(name)}
      </span>
      {flagUrl && !failed && (
        <img
          alt=""
          src={bundledFlagUrl(flagUrl)}
          onError={() => setFailed(true)}
          style={{
            border: "1.5px solid #18181b",
            borderRadius: "3px",
            bottom: "-0.12rem",
            height: `${size * 0.36}rem`,
            objectFit: "cover",
            position: "absolute",
            right: "-0.2rem",
            width: `${size * 0.52}rem`,
          }}
        />
      )}
    </span>
  );
};

const postDate = (date) => formatGameDateReadable(date, "D MMM YYYY") || "";

// The quoted post, embedded under the one that quotes it.
const QuotedPost = ({ post, gone, flags }) => {
  if (gone || !post) {
    return (
      <div style={{ border: `1px solid ${LINE}`, borderRadius: "10px", color: INK_FAINT, fontSize: "0.74rem", fontStyle: "italic", marginTop: "0.55rem", padding: "0.55rem 0.7rem" }}>
        This post is no longer available.
      </div>
    );
  }
  return (
    <div style={{ border: `1px solid rgba(255,255,255,0.12)`, borderRadius: "10px", marginTop: "0.55rem", padding: "0.55rem 0.7rem" }}>
      <div style={{ alignItems: "center", display: "flex", gap: "0.45rem", minWidth: 0 }}>
        <Avatar name={post.author} flagUrl={flagFor(post.country, flags.custom, flags.polities)} mine={post.kind === "player"} size={1.3} />
        <span data-no-translate style={{ color: INK, fontSize: "0.76rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.author}</span>
        {post.role && <span data-no-translate style={{ color: INK_FAINT, fontSize: "0.7rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.role}</span>}
        <span style={{ color: INK_FAINT, flexShrink: 0, fontSize: "0.68rem", marginLeft: "auto" }}>{postDate(post.date)}</span>
      </div>
      <div data-no-translate style={{ color: INK_SOFT, display: "-webkit-box", fontSize: "0.78rem", lineHeight: 1.45, marginTop: "0.3rem", overflow: "hidden", WebkitBoxOrient: "vertical", WebkitLineClamp: 4, whiteSpace: "pre-wrap" }}>
        {post.text}
      </div>
    </div>
  );
};

const Count = ({ icon, value, label }) => (
  <span title={label} style={{ alignItems: "center", color: INK_FAINT, display: "inline-flex", fontSize: "0.72rem", gap: "0.3rem" }}>
    {icon}
    <span data-no-translate>{compactCount(value)}</span>
  </span>
);

const PostCard = memo(({ post, feed, round, flags, mine, onQuote, canPost }) => {
  const engagement = postEngagement(post, feed, round);
  const waiting = post.kind === "player" && Number(round) <= Number(post.round);
  return (
    <article className="rostra-post" style={{ borderBottom: `1px solid ${LINE}`, display: "flex", gap: "0.65rem", padding: "0.8rem 1rem" }}>
      <Avatar name={post.author} flagUrl={flagFor(post.country, flags.custom, flags.polities)} mine={mine} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ alignItems: "baseline", display: "flex", gap: "0.4rem", minWidth: 0 }}>
          <span data-no-translate style={{ color: INK, fontSize: "0.84rem", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.author}</span>
          {mine && (
            <span style={{ background: ACCENT_SOFT, border: `1px solid ${ACCENT_EDGE}`, borderRadius: "999px", color: ACCENT, flexShrink: 0, fontSize: "0.58rem", fontWeight: 800, letterSpacing: "0.06em", padding: "0.05rem 0.4rem", textTransform: "uppercase" }}>
              You
            </span>
          )}
          <span style={{ color: INK_FAINT, flexShrink: 0, fontSize: "0.7rem", marginLeft: "auto" }}>{postDate(post.date)}</span>
        </div>
        {(post.role || post.country) && (
          <div data-no-translate style={{ color: INK_FAINT, fontSize: "0.7rem", marginTop: "0.05rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {[post.role, post.country && post.country !== post.author ? post.country : ""].filter(Boolean).join(" · ")}
          </div>
        )}
        <div data-no-translate style={{ color: INK, fontSize: "0.84rem", lineHeight: 1.5, marginTop: "0.35rem", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
          {post.text}
        </div>
        {post.quote && <QuotedPost post={post.quoted} gone={post.quoteGone || !post.quoted} flags={flags} />}
        <div style={{ alignItems: "center", display: "flex", gap: "1.1rem", marginTop: "0.55rem" }}>
          <button
            type="button"
            className="oh-tap rostra-action"
            disabled={!canPost}
            onClick={() => onQuote(post)}
            aria-label="Quote this post"
            title={canPost ? "Quote this post" : "You can post again once the time skip has ended."}
            style={{ alignItems: "center", background: "none", border: "none", color: INK_FAINT, cursor: canPost ? "pointer" : "default", display: "inline-flex", fontFamily: "inherit", fontSize: "0.72rem", gap: "0.3rem", opacity: canPost ? 1 : 0.5, padding: 0 }}
          >
            <QuoteIcon />
            <span data-no-translate>{compactCount(engagement.quotes)}</span>
          </button>
          {waiting ? (
            <span style={{ color: INK_FAINT, fontSize: "0.7rem", fontStyle: "italic" }}>The world answers with the next time skip.</span>
          ) : (
            <>
              <Count icon={<RepostIcon />} value={engagement.reposts} label="Reposts" />
              <Count icon={<HeartIcon />} value={engagement.likes} label="Likes" />
            </>
          )}
        </div>
      </div>
    </article>
  );
});

// --- The panel -------------------------------------------------------------------

const selectGame = (game) => ({
  country: String(game?.country ?? ""),
  gameDate: String(game?.gameDate ?? ""),
  round: Number(game?.round) || 0,
});
const selectFeed = (world) => (Array.isArray(world?.socialFeed) ? world.socialFeed : []);
const selectPolities = (world) => world?.polityOverrides ?? {};
// The player's account, as a pair of strings, so a world write elsewhere does
// not redraw the panel unless the leader changed.
const accountOf = (country) => (world) => {
  const account = playerAccount(world, country);
  return `${account.author}\u0000${account.role}\u0000${leaderOf(world, country)?.name ?? ""}`;
};

const TABS = [
  ["all", "For you"],
  ["country", "Your country"],
  ["mentions", "Mentions"],
  ["mine", "Your posts"],
];

const EMPTY_TEXTS = {
  all: "Nothing has been posted yet. The people who make the news post as time passes, and you can post first.",
  country: "Nobody from your country has posted yet.",
  mentions: "Nobody has mentioned you yet. Post something, and the answers come with the next time skip.",
  mine: "You have not posted yet.",
};

const SocialPanel = ({ isOpen, onClose, onSeen }) => {
  const game = useRuntimeState("game", selectGame);
  const feed = useRuntimeState("world", selectFeed);
  const polities = useRuntimeState("world", selectPolities);
  const country = toCountryName(game.country) || game.country;
  const [author, role, leader] = useRuntimeState("world", accountOf(country), country).split("\u0000");
  const turnRunning = useTurnRunning(isOpen);
  const isMobile = useIsMobile();
  const isTouch = useTouchPrimary();
  const [tab, setTab] = useState("all");
  const [draft, setDraft] = useState("");
  const [quoting, setQuoting] = useState(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [posted, setPosted] = useState(false);
  const [customFlags, setCustomFlags] = useState(() => ({}));
  const boxRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => { ensureStyles(); }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    getNationFlags()
      .then((flags) => { if (!cancelled) setCustomFlags(flags || {}); })
      .catch(() => { /* the avatars fall back to the ISO flag, then to none */ });
    return () => { cancelled = true; };
  }, [isOpen]);

  // Everything in the feed is seen once the panel is open on it.
  useEffect(() => {
    if (isOpen) onSeen?.(newestPostNumber(feed));
  }, [isOpen, feed, onSeen]);

  // Closed, the box keeps what was typed and what it quotes; the notes under it go.
  useEffect(() => {
    if (!isOpen) {
      setPosted(false);
      setError("");
    }
  }, [isOpen]);

  const flags = useMemo(() => ({ custom: customFlags, polities }), [customFlags, polities]);
  const posts = useMemo(() => socialFeedView(feed, { tab, country, leader }), [feed, tab, country, leader]);
  const mentionCount = useMemo(
    () => feed.filter((post) => mentionsPlayer(post, { feed, country, leader }) && Number(post.round) >= game.round).length,
    [feed, country, leader, game.round],
  );
  const canPost = Boolean(country) && !turnRunning;
  const length = Array.from(draft.trim()).length;
  const tooLong = length > SOCIAL_POST_MAX_CHARS;

  const startQuote = useCallback((post) => {
    setQuoting(post);
    setError("");
    setPosted(false);
    scrollRef.current?.scrollTo?.({ top: 0, behavior: "smooth" });
    window.setTimeout(() => boxRef.current?.focus(), 60);
  }, []);

  const submit = async () => {
    const text = draft.trim();
    if (!text || tooLong || posting || !canPost) return;
    setPosting(true);
    setError("");
    try {
      if (inSharedGame()) {
        // The host writes it, as the leader of this seat's country.
        const answer = await requestFromHost("post", { text, quote: quoting?.id || "" });
        if (!answer.ok) {
          setError(answer.error || "The host did not take the post.");
          return;
        }
      } else {
        // Read and written in the save's own queue, so nothing written meanwhile is lost.
        let refusal = "";
        await mutateWorldState((world) => {
          const made = withPlayerPost(world, { by: country, text, quote: quoting?.id || "", date: game.gameDate, round: game.round });
          refusal = made.error || "";
          return made.error ? null : made.world;
        });
        if (refusal) {
          setError(refusal);
          return;
        }
      }
      logDebugEvent("action", `Posted on Rostra${quoting ? ` (quoting ${quoting.id})` : ""}: ${text}`);
      setDraft("");
      setQuoting(null);
      setPosted(true);
      if (tab === "mentions" || tab === "country") setTab("all");
    } catch (failure) {
      console.error("[social] the post could not be saved:", failure);
      setError("The post could not be saved. Try again.");
    } finally {
      setPosting(false);
    }
  };

  const onKeyDown = (event) => {
    if (isComposerSendKey(event, { touch: isTouch })) {
      event.preventDefault();
      void submit();
    }
  };

  const playerFlag = flagFor(country, customFlags, polities);
  const shown = isOpen;

  return (
    <div
      role="dialog"
      aria-label="Rostra"
      style={{
        backdropFilter: "blur(8px)",
        backgroundColor: "rgba(24, 24, 27, 0.96)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "16px",
        bottom: shown ? "4.25rem" : "-36rem",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
        color: INK,
        display: "flex",
        flexDirection: "column",
        fontFamily: "sans-serif",
        height: `min(calc(${APP_HEIGHT} - 9rem), max(calc(${APP_HEIGHT} - 16rem), 30rem))`,
        left: "0rem",
        maxWidth: "calc(100vw - 1rem)",
        minHeight: "10rem",
        opacity: shown ? 1 : 0,
        overflow: "hidden",
        pointerEvents: shown ? "auto" : "none",
        position: "fixed",
        transition: "bottom 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease",
        width: isMobile ? "calc(100vw - 1rem)" : "31rem",
        zIndex: 9998,
      }}
    >
      {/* The masthead: the mark, the name, and the game's day. */}
      <div style={{ borderBottom: `1px solid ${LINE}`, flexShrink: 0, padding: isTouch ? "0.6rem 0.9rem 0.45rem" : "0.85rem 1.1rem 0.55rem" }}>
        <div style={{ alignItems: "center", display: "flex", gap: "0.6rem" }}>
          <RostraMark />
          <div style={{ minWidth: 0 }}>
            <div data-no-translate style={{ color: INK, fontSize: "1.05rem", fontWeight: 900, letterSpacing: "0.04em", lineHeight: 1.05 }}>Rostra</div>
            <div style={{ color: INK_FAINT, fontSize: "0.62rem", marginTop: "0.1rem" }}>What the world is saying</div>
          </div>
          <span style={{ color: INK_FAINT, fontSize: "0.68rem", marginLeft: "auto" }}>{postDate(game.gameDate)}</span>
          <button
            type="button"
            className="oh-tap"
            onClick={onClose}
            aria-label="Close Rostra"
            style={{ background: "none", border: "none", borderRadius: "6px", color: INK_SOFT, cursor: "pointer", display: "flex", padding: "0.2rem" }}
          >
            <CloseIcon />
          </button>
        </div>
        {/* Four tabs are wider than a phone's header: there they stay one row
            that scrolls sideways. */}
        <div role="tablist" style={{ display: "flex", gap: "0.35rem", marginTop: "0.55rem", overflowX: "auto", scrollbarWidth: "none" }}>
          {TABS.map(([key, label]) => {
            const active = tab === key;
            const count = key === "mentions" ? mentionCount : 0;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                className="oh-tap-row"
                onClick={() => setTab(key)}
                style={{
                  alignItems: "center",
                  background: active ? "var(--oh-grey-selected)" : "rgba(255,255,255,.025)",
                  border: `1px solid ${active ? "var(--oh-grey-border-strong)" : "rgba(255,255,255,.07)"}`,
                  borderRadius: "8px",
                  color: active ? INK : "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                  display: "flex",
                  flex: "0 0 auto",
                  fontFamily: "sans-serif",
                  fontSize: ".72rem",
                  fontWeight: 750,
                  gap: ".35rem",
                  padding: isTouch ? ".3rem .58rem" : ".34rem .68rem",
                  whiteSpace: "nowrap",
                }}
              >
                <span>{label}</span>
                {count > 0 && (
                  <span data-no-translate style={{ alignItems: "center", background: active ? "rgba(255,255,255,.14)" : ACCENT_SOFT, borderRadius: 999, color: active ? "#fff" : ACCENT, display: "inline-flex", fontSize: ".57rem", fontWeight: 800, height: "1.05rem", justifyContent: "center", minWidth: "1.05rem", padding: "0 .25rem" }}>
                    {count > 9 ? "9+" : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={scrollRef} className="rostra-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {/* The box: the player posts as their country's leader. */}
        <div style={{ borderBottom: `1px solid ${LINE}`, display: "flex", gap: "0.65rem", padding: "0.85rem 1rem" }}>
          <Avatar name={author} flagUrl={playerFlag} mine />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: INK_FAINT, fontSize: "0.68rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span>Posting as</span>
              {" "}
              <span data-no-translate style={{ color: INK_SOFT, fontWeight: 700 }}>{[author, role].filter(Boolean).join(", ")}</span>
            </div>
            <textarea
              ref={boxRef}
              className="rostra-composer"
              value={draft}
              disabled={!canPost}
              onChange={(event) => { setDraft(event.target.value); setPosted(false); }}
              onKeyDown={onKeyDown}
              placeholder={canPost ? "What would you like to tell the world?" : "You can post again once the time skip has ended."}
              rows={isTouch ? 2 : 3}
              enterKeyHint="enter"
              style={{
                background: "transparent",
                border: "none",
                boxSizing: "border-box",
                color: INK,
                fontFamily: "sans-serif",
                fontSize: "0.9rem",
                lineHeight: 1.45,
                marginTop: "0.3rem",
                outline: "none",
                padding: 0,
                resize: "none",
                width: "100%",
              }}
            />
            {quoting && (
              <div style={{ position: "relative" }}>
                <QuotedPost post={quoting} gone={false} flags={flags} />
                <button
                  type="button"
                  className="oh-tap"
                  onClick={() => setQuoting(null)}
                  aria-label="Remove the quote"
                  title="Remove the quote"
                  style={{ alignItems: "center", background: "#18181b", border: "1px solid rgba(255,255,255,0.18)", borderRadius: "999px", color: INK_SOFT, cursor: "pointer", display: "flex", height: "1.4rem", justifyContent: "center", padding: 0, position: "absolute", right: "-0.35rem", top: "0.2rem", width: "1.4rem" }}
                >
                  <CloseIcon />
                </button>
              </div>
            )}
            {error && <div role="alert" style={{ color: "rgba(253,186,116,0.95)", fontSize: "0.72rem", marginTop: "0.45rem" }}>{error}</div>}
            {posted && !error && <div style={{ color: ACCENT, fontSize: "0.72rem", marginTop: "0.45rem" }}>Posted. The world answers with the next time skip.</div>}
            <div style={{ alignItems: "center", borderTop: `1px solid ${LINE}`, display: "flex", gap: "0.6rem", justifyContent: "flex-end", marginTop: "0.5rem", paddingTop: "0.5rem" }}>
              <span data-no-translate style={{ color: tooLong ? "#f87171" : INK_FAINT, fontSize: "0.7rem" }}>
                {length}/{SOCIAL_POST_MAX_CHARS}
              </span>
              <button
                type="button"
                className="oh-tap-row"
                onClick={() => void submit()}
                disabled={!draft.trim() || tooLong || posting || !canPost}
                style={{
                  background: draft.trim() && !tooLong && canPost ? ACCENT : "rgba(43,193,243,0.25)",
                  border: "none",
                  borderRadius: "999px",
                  color: "#06171d",
                  cursor: draft.trim() && !tooLong && canPost && !posting ? "pointer" : "default",
                  fontFamily: "sans-serif",
                  fontSize: "0.78rem",
                  fontWeight: 800,
                  padding: "0.4rem 1.05rem",
                }}
              >
                {posting ? "Posting…" : "Post"}
              </button>
            </div>
          </div>
        </div>

        {posts.length === 0 ? (
          <p style={{ color: INK_FAINT, fontSize: "0.78rem", fontStyle: "italic", lineHeight: 1.5, margin: 0, padding: "1.2rem 1.1rem" }}>
            {EMPTY_TEXTS[tab]}
          </p>
        ) : posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            feed={feed}
            round={game.round}
            flags={flags}
            mine={post.kind === "player" && String(post.by || post.country).toLocaleLowerCase() === country.toLocaleLowerCase()}
            onQuote={startQuote}
            canPost={canPost}
          />
        ))}
      </div>
    </div>
  );
};

// --- The launcher -----------------------------------------------------------------

// How far into this game's feed the player has read, per game on this device.
const SEEN_KEY = "oh:rostra-seen";
const readSeenNumbers = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
};
const writeSeenNumber = (gameId, number) => {
  try {
    const seen = readSeenNumbers();
    if ((Number(seen[gameId]) || 0) >= number) return;
    // The newest forty games are kept; an older one's count starts again.
    const kept = Object.entries({ ...seen, [gameId]: number }).slice(-40);
    localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Storage refused: the badge counts from the start of the session.
  }
};
const activeGameId = () => {
  try {
    return String(getLibraryState()?.activeGameId ?? "").trim() || "game";
  } catch {
    return "game";
  }
};

const Social = ({ hovered, isOpen, onToggle, setHovered }) => {
  const [hasOpened, setHasOpened] = useState(false);
  const feed = useRuntimeState("world", selectFeed);
  // Read from storage in an effect, never while rendering: the compiler would
  // keep the first render's answer.
  const [seen, setSeen] = useState(0);
  const gameId = activeGameId();

  useEffect(() => {
    if (isOpen) setHasOpened(true);
  }, [isOpen]);

  useEffect(() => {
    setSeen(Number(readSeenNumbers()[gameId]) || 0);
  }, [gameId]);

  const markSeen = useCallback((number) => {
    if (!number) return;
    writeSeenNumber(gameId, number);
    setSeen((current) => Math.max(current, number));
  }, [gameId]);

  const unseen = isOpen ? 0 : postsAfter(feed, seen);

  return (
    <>
      {hasOpened && <SocialPanel isOpen={isOpen} onClose={onToggle} onSeen={markSeen} />}
      <button
        type="button"
        title="Rostra"
        aria-label={unseen > 0 ? `Rostra, ${unseen} new post${unseen === 1 ? "" : "s"}` : "Rostra"}
        style={{
          alignItems: "center",
          background: isOpen
            ? "rgba(59,130,246,0.16)"
            : hovered
              ? "rgba(255,255,255,0.08)"
              : "rgba(255,255,255,0.04)",
          border: isOpen ? "1px solid rgba(96,165,250,0.34)" : "1px solid rgba(255,255,255,0.1)",
          borderRadius: "10px",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
          color: "white",
          cursor: "pointer",
          display: "flex",
          fontFamily: "inherit",
          fontSize: "1.2rem",
          height: "3.3rem",
          justifyContent: "center",
          outline: "none",
          transform: hovered ? "translateY(-1px)" : "translateY(0)",
          transition: "all 0.12s ease",
          width: "3.3rem",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onToggle}
      >
        <span style={{ display: "inline-flex", position: "relative" }}>
          <RostraDockIcon />
          {unseen > 0 && (
            <span data-no-translate style={{ alignItems: "center", background: ACCENT, border: "1px solid rgba(255,255,255,0.35)", borderRadius: "999px", boxShadow: "0 1px 4px rgba(0,0,0,0.5)", color: "#06171d", display: "flex", fontSize: "0.62rem", fontWeight: 800, height: "1.05rem", justifyContent: "center", lineHeight: 1, minWidth: "1.05rem", padding: "0 0.2rem", position: "absolute", right: "-0.8rem", top: "-0.55rem" }}>
              {unseen > 9 ? "9+" : unseen}
            </span>
          )}
        </span>
      </button>
    </>
  );
};

export { Social, SocialPanel };
