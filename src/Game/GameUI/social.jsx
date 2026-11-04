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
//
// It is drawn as a phone, as Listen in was, but one that rises from the dock as
// the dock's other windows do, not one in the middle of the screen: "I want it
// to look like a phone like before. dont have it in the middle of the screen
// like it was tho, make it popup like the other menus in that section" (the
// owner, 2026-11-02). On a real phone, or a touch screen on its side, the frame
// is already in the player's hand: there it is the app alone, risen from the
// dock as wide as the screen.

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getNationFlags } from "../../runtime/assets.js";
import { isComposerSendKey } from "../../runtime/composerKeys.js";
import { bundledFlagUrl, flagImageUrlFromGid } from "../../runtime/countryFlags.js";
import { formatGameDateReadable } from "../../runtime/gameDates.js";
import { mutateWorldState } from "../../runtime/gameState.js";
import { getLibraryState } from "../../runtime/library.js";
import { logDebugEvent } from "../../runtime/debugLog.js";
import { APP_HEIGHT, useShortTouchScreen, useTouchPrimary } from "../../runtime/mobileUi.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import {
  POLL_CHOICES_MAX,
  POLL_CHOICES_MIN,
  POLL_CHOICE_MAX_CHARS,
  SOCIAL_POST_MAX_CHARS,
  compactCount,
  leaderOf,
  mentionsPlayer,
  newestPostNumber,
  playerAccount,
  pollWinner,
  postEngagement,
  postsAfter,
  socialFeedView,
  withPlayerPost,
} from "../../runtime/socialFeed.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { inSharedGame, requestFromHost } from "../../multiplayer/client/sharedGameBridge.js";
import { useTurnRunning } from "./useTurnRunning.js";
import { resolvePolityFlag } from "../../runtime/polityFlags.js";
import { buildPolityIdentityIndex } from "../../runtime/polityIdentity.js";
import { getWorldStateSnapshot } from "../Map/useWorldState.js";
import RostraSearch from "./rostraSearch.jsx";
import { onRostraPlace, takeRostraPlace } from "./rostraOpen.js";
import EmptyFeedRefresh from "./rostraRefresh.jsx";

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
// The phone: its screen, and the frame round it.
const SCREEN = "#0b0b0d";
const FRAME = "#17171a";
const FRAME_BUTTON = "#2c2c31";

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

// A modern smartphone.
const RostraDockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" strokeWidth="1.9" {...stroke}>
    <rect x="5.5" y="2" width="13" height="20" rx="3" />
    <path d="M10.5 5h3" />
    <path d="M9.5 19h5" />
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
// A fountain pen's nib, point down to the left, its slit and breather hole,
// and the grip above it: write a post (the owner, after a picture of one:
// "make it use the fountain pen icon that the image used").
const PenIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" strokeWidth="1.7" {...stroke}>
    <path d="M3 21l3.4-9.4 3.8-1.8 4 4-1.8 3.8z" />
    <path d="M10.2 9.8l4.6-4.6a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2l-4.6 4.6" />
    <path d="M3 21l5.6-5.6" />
    <circle cx="10" cy="14" r="1.4" />
  </svg>
);
// Three bars: a poll.
const PollIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth="1.9" {...stroke}>
    <path d="M4 6h11" />
    <path d="M4 12h16" />
    <path d="M4 18h7" />
  </svg>
);

// The tab bar's: the feed, a search for any place, what answers them, their own.
const HomeIcon = () => (
  <svg width="21" height="21" viewBox="0 0 24 24" strokeWidth="1.8" {...stroke}>
    <path d="M4 10.5L12 4l8 6.5V20h-5.5v-5.5h-5V20H4z" />
  </svg>
);
const SearchIcon = () => (
  <svg width="21" height="21" viewBox="0 0 24 24" strokeWidth="1.8" {...stroke}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.5-4.5" />
  </svg>
);
const BellIcon = () => (
  <svg width="21" height="21" viewBox="0 0 24 24" strokeWidth="1.8" {...stroke}>
    <path d="M18 9a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
);
const PersonIcon = () => (
  <svg width="21" height="21" viewBox="0 0 24 24" strokeWidth="1.8" {...stroke}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 21c.8-4.2 3.3-6.3 7.5-6.3s6.7 2.1 7.5 6.3" />
  </svg>
);

// The top of a phone's screen: the time (here, the game's day), the island, and
// the signal, wireless and battery marks. Only drawn inside the frame.
const StatusBar = ({ date }) => (
  <div aria-hidden="true" style={{ alignItems: "center", color: INK, display: "grid", flex: "0 0 auto", fontSize: "0.7rem", fontWeight: 700, gridTemplateColumns: "1fr auto 1fr", height: "2.5rem", padding: "0.3rem 1.35rem 0" }}>
    <span data-no-translate style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{date}</span>
    <span style={{ background: "#000", borderRadius: "999px", boxShadow: "0 0 0 1px rgba(255,255,255,0.05)", height: "1.45rem", width: "5.2rem" }} />
    <span style={{ alignItems: "center", display: "flex", gap: "0.28rem", justifyContent: "flex-end" }}>
      <svg width="16" height="10" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="0.7" /><rect x="4.6" y="5" width="3" height="6" rx="0.7" /><rect x="9.2" y="2.6" width="3" height="8.4" rx="0.7" /><rect x="13.8" y="0" width="3" height="11" rx="0.7" /></svg>
      <svg width="14" height="10" viewBox="0 0 15 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M1 4.2a9.2 9.2 0 0 1 13 0" /><path d="M3.4 6.7a5.8 5.8 0 0 1 8.2 0" /><circle cx="7.5" cy="9.3" r="0.9" fill="currentColor" stroke="none" /></svg>
      <svg width="22" height="10" viewBox="0 0 24 11" fill="none"><rect x="0.5" y="0.5" width="20" height="10" rx="2.6" stroke="currentColor" opacity="0.45" /><rect x="2" y="2" width="14" height="7" rx="1.4" fill="currentColor" /><rect x="21.6" y="3.4" width="1.6" height="4.2" rx="0.8" fill="currentColor" opacity="0.5" /></svg>
    </span>
  </div>
);

// --- Who wrote it ---------------------------------------------------------------

const initials = (name) => {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return letters.map((word) => Array.from(word)[0] ?? "").join("").toUpperCase() || "?";
};

// A polity's flag by the precedence every flag in the game follows (see
// resolvePolityFlag in polityFlags.js): custom uploaded flag, polity record flag,
// map-ref GADM/ISO base flag, or stock national flag.
//
// Resolved once a name for each world, with one identity index for all the
// names: building that index reads every region's owner, and a feed draws a
// flag for every post.
const flagCache = new WeakMap();
const resolvedFlag = (name, customFlags) => {
  const world = getWorldStateSnapshot();
  if (!world || typeof world !== "object") return "";
  let entry = flagCache.get(world);
  if (!entry || entry.flags !== customFlags) {
    entry = { flags: customFlags, index: null, names: new Map() };
    flagCache.set(world, entry);
  }
  if (!entry.names.has(name)) {
    entry.index ??= buildPolityIdentityIndex(world);
    entry.names.set(name, resolvePolityFlag({ polity: name, world, flags: customFlags || {}, identityIndex: entry.index })?.imageUrl || "");
  }
  return entry.names.get(name);
};
const flagFor = (country, customFlags, polities) => {
  const name = String(country ?? "").trim();
  if (!name) return "";
  const resolved = resolvedFlag(name, customFlags);
  if (resolved) return resolved;
  const key = polities?.[name]
    ? name
    : Object.keys(polities ?? {}).find((entry) => String(polities[entry]?.name ?? "").trim().toLowerCase() === name.toLowerCase()) || name;
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

// A poll under its question: the choices while the public votes (until the next
// time skip), then each choice's share as a bar, the winner ticked, how many
// voted, and what the public said. The choices are the player's own words and
// the consensus the model's, already in the player's language.
const PollCard = ({ poll }) => {
  const results = poll?.results;
  const winner = pollWinner(poll);
  const votes = results?.votes ? Number(results.votes).toLocaleString() : "";
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid rgba(255,255,255,0.1)`, borderRadius: "12px", marginTop: "0.6rem", padding: "0.6rem 0.65rem 0.55rem" }}>
      <div style={{ display: "grid", gap: "0.38rem" }}>
        {poll.choices.map((choice, index) => {
          const share = results ? results.shares[index] ?? 0 : null;
          const won = index === winner;
          return results ? (
            <div key={choice} style={{ background: "rgba(255,255,255,0.05)", borderRadius: "8px", overflow: "hidden", position: "relative" }}>
              <div aria-hidden="true" style={{ background: won ? "rgba(43,193,243,0.28)" : "rgba(255,255,255,0.1)", bottom: 0, left: 0, position: "absolute", top: 0, width: `${share}%` }} />
              <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between", padding: "0.42rem 0.6rem", position: "relative" }}>
                <span data-no-translate style={{ color: INK, fontSize: "0.8rem", fontWeight: won ? 800 : 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {won ? `✓ ${choice}` : choice}
                </span>
                <span data-no-translate style={{ color: won ? ACCENT : INK_SOFT, flexShrink: 0, fontSize: "0.78rem", fontWeight: 800 }}>{`${share}%`}</span>
              </div>
            </div>
          ) : (
            <div key={choice} data-no-translate style={{ border: `1px solid ${ACCENT_EDGE}`, borderRadius: "8px", color: INK, fontSize: "0.8rem", fontWeight: 650, padding: "0.4rem 0.6rem" }}>
              {choice}
            </div>
          );
        })}
      </div>
      <div style={{ alignItems: "center", color: INK_FAINT, display: "flex", fontSize: "0.68rem", gap: "0.5rem", justifyContent: "space-between", marginTop: "0.45rem" }}>
        {results ? (
          <>
            <span>{votes ? `${votes} votes` : ""}</span>
            <span>Final results</span>
          </>
        ) : (
          <span>The public votes until the next time skip.</span>
        )}
      </div>
      {results?.consensus && (
        <div style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${LINE}`, borderRadius: "8px", color: INK_SOFT, fontSize: "0.74rem", lineHeight: 1.45, marginTop: "0.5rem", padding: "0.45rem 0.55rem" }}>
          <strong style={{ color: INK }}>Public consensus:</strong>{" "}
          <span data-no-translate>{results.consensus}</span>
        </div>
      )}
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
        {(post.role || post.country || post.poll) && (
          <div style={{ alignItems: "center", color: INK_FAINT, display: "flex", fontSize: "0.7rem", gap: "0.35rem", marginTop: "0.05rem", minWidth: 0 }}>
            {/* A poll says so under its author's name, as such apps have it. */}
            {post.poll && (
              <span style={{ background: ACCENT_SOFT, border: `1px solid ${ACCENT_EDGE}`, borderRadius: "5px", color: ACCENT, flexShrink: 0, fontSize: "0.6rem", fontWeight: 800, padding: "0 0.3rem" }}>
                Poll
              </span>
            )}
            <span data-no-translate style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {[post.role, post.country && post.country !== post.author ? post.country : ""].filter(Boolean).join(" · ")}
            </span>
          </div>
        )}
        <div data-no-translate style={{ color: INK, fontSize: "0.84rem", lineHeight: 1.5, marginTop: "0.35rem", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
          {post.text}
        </div>
        {post.poll && <PollCard poll={post.poll} />}
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

// The tab bar along the foot of the screen, as such apps have it. Search took
// the place of Your country (rostraSearch.jsx), and opens on the player's own.
const TABS = [
  ["all", "For you", HomeIcon],
  ["search", "Search", SearchIcon],
  ["mentions", "Mentions", BellIcon],
  ["mine", "Your posts", PersonIcon],
];

const EMPTY_TEXTS = {
  mentions: "Nobody has mentioned you yet. Post something, and the answers come with the next time skip.",
  mine: "You have not posted yet.",
};

// A poll's choices as the box starts them: two, both blank.
const NEW_CHOICES = Object.freeze(["", ""]);

const SocialPanel = ({ isOpen, onClose, onSeen }) => {
  const game = useRuntimeState("game", selectGame);
  const feed = useRuntimeState("world", selectFeed);
  const polities = useRuntimeState("world", selectPolities);
  const country = toCountryName(game.country) || game.country;
  const [author, role, leader] = useRuntimeState("world", accountOf(country), country).split("\u0000");
  const turnRunning = useTurnRunning(isOpen);
  const isMobile = useIsMobile();
  const isTouch = useTouchPrimary();
  const shortTouch = useShortTouchScreen();
  const framed = !isMobile && !shortTouch;
  const [tab, setTab] = useState("all");
  // The box to write in is put away until the pen in the header is pressed
  // ("make it so the thing to write a post isnt always there, its only there
  // when you click the pen icon in the top corner", the owner, 2026-11-03).
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  // A poll's choices while the post is one; null when it is not.
  const [choices, setChoices] = useState(null);
  const [quoting, setQuoting] = useState(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [posted, setPosted] = useState(false);
  const [customFlags, setCustomFlags] = useState(() => ({}));
  const boxRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => { ensureStyles(); }, []);

  // A place a map card opened Rostra on (rostraOpen.js): Search, showing it.
  const [opened, setOpened] = useState(null);
  useEffect(() => {
    const show = () => {
      const place = takeRostraPlace();
      if (!place) return;
      setTab("search");
      setOpened({ place });
    };
    show();
    return onRostraPlace(show);
  }, []);

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
  const posts = useMemo(() => (tab === "search" ? [] : socialFeedView(feed, { tab, country, leader })), [feed, tab, country, leader]);
  const mentionCount = useMemo(
    () => feed.filter((post) => mentionsPlayer(post, { feed, country, leader }) && Number(post.round) >= game.round).length,
    [feed, country, leader, game.round],
  );
  const canPost = Boolean(country) && !turnRunning;
  const length = Array.from(draft.trim()).length;
  const tooLong = length > SOCIAL_POST_MAX_CHARS;
  const typedChoices = (choices ?? []).map((choice) => choice.trim()).filter(Boolean);
  const pollReady = !choices || typedChoices.length >= POLL_CHOICES_MIN;
  const ready = Boolean(draft.trim()) && !tooLong && canPost && pollReady;

  const openComposer = useCallback(() => {
    setComposing(true);
    setError("");
    setPosted(false);
    scrollRef.current?.scrollTo?.({ top: 0, behavior: "smooth" });
    window.setTimeout(() => boxRef.current?.focus(), 60);
  }, []);
  // Put away: what was typed stays for next time, the poll and the quote go.
  const closeComposer = () => {
    setComposing(false);
    setChoices(null);
    setQuoting(null);
    setError("");
  };

  const startQuote = useCallback((post) => {
    setQuoting(post);
    openComposer();
  }, [openComposer]);

  const submit = async () => {
    const text = draft.trim();
    if (!ready || posting) return;
    const poll = choices ? typedChoices : null;
    setPosting(true);
    setError("");
    try {
      if (inSharedGame()) {
        // The host writes it, as the leader of this seat's country.
        const answer = await requestFromHost("post", { text, quote: quoting?.id || "", ...(poll ? { choices: poll } : {}) });
        if (!answer.ok) {
          setError(answer.error || "The host did not take the post.");
          return;
        }
      } else {
        // Read and written in the save's own queue, so nothing written meanwhile is lost.
        let refusal = "";
        await mutateWorldState((world) => {
          const made = withPlayerPost(world, { by: country, text, quote: quoting?.id || "", date: game.gameDate, round: game.round, choices: poll });
          refusal = made.error || "";
          return made.error ? null : made.world;
        });
        if (refusal) {
          setError(refusal);
          return;
        }
      }
      logDebugEvent("action", `Posted on Rostra${quoting ? ` (quoting ${quoting.id})` : ""}${poll ? ` (a poll: ${poll.join(" / ")})` : ""}: ${text}`);
      setDraft("");
      setQuoting(null);
      setChoices(null);
      setComposing(false);
      setPosted(true);
      if (tab !== "all" && tab !== "mine") setTab("all");
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

  // Where it rises from and how it goes, as the dock's other windows do
  // (actions.jsx): up from below the dock, fading in.
  const rising = {
    bottom: shown ? "4.25rem" : "-50rem",
    color: INK,
    display: "flex",
    fontFamily: "sans-serif",
    left: "0rem",
    maxWidth: "calc(100vw - 1rem)",
    opacity: shown ? 1 : 0,
    pointerEvents: shown ? "auto" : "none",
    position: "fixed",
    transition: "bottom 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease",
    zIndex: 9998,
  };
  const frameStyle = framed
    ? {
      ...rising,
      // A phone's proportions, as tall as the room above the dock allows,
      // never past the 9rem the top UI needs.
      aspectRatio: "9 / 19",
      background: FRAME,
      borderRadius: "2.6rem",
      boxShadow: "0 0 0 1px #3a3a40, 0 0 0 3px #0e0e10, 0 24px 60px rgba(0,0,0,0.55)",
      boxSizing: "border-box",
      height: `min(46rem, calc(${APP_HEIGHT} - 9rem))`,
      minHeight: "24rem",
      minWidth: "min(17.5rem, calc(100vw - 1rem))",
      padding: "0.5rem",
    }
    : {
      ...rising,
      backdropFilter: "blur(8px)",
      backgroundColor: "rgba(11, 11, 13, 0.97)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "16px",
      boxShadow: "-4px 0 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
      height: `min(calc(${APP_HEIGHT} - 9rem), max(calc(${APP_HEIGHT} - 16rem), 30rem))`,
      minHeight: "10rem",
      overflow: "hidden",
      width: isMobile ? "calc(100vw - 1rem)" : "31rem",
    };

  return (
    <div role="dialog" aria-label="Rostra" style={frameStyle}>
      {framed && (
        <>
          {/* The side buttons, as the frame's only ornament. */}
          <span aria-hidden="true" style={{ background: FRAME_BUTTON, borderRadius: "2px 0 0 2px", height: "1.8rem", left: "-3px", position: "absolute", top: "6.2rem", width: "3px" }} />
          <span aria-hidden="true" style={{ background: FRAME_BUTTON, borderRadius: "2px 0 0 2px", height: "3rem", left: "-3px", position: "absolute", top: "9rem", width: "3px" }} />
          <span aria-hidden="true" style={{ background: FRAME_BUTTON, borderRadius: "0 2px 2px 0", height: "4.4rem", position: "absolute", right: "-3px", top: "9.6rem", width: "3px" }} />
        </>
      )}
      <div style={{ background: framed ? SCREEN : "transparent", borderRadius: framed ? "2.1rem" : 0, display: "flex", flex: 1, flexDirection: "column", minHeight: 0, minWidth: 0, overflow: "hidden" }}>
        {framed && <StatusBar date={postDate(game.gameDate)} />}

        {/* The app's header: the mark, the name, and put away. */}
        <div style={{ alignItems: "center", borderBottom: `1px solid ${LINE}`, display: "flex", flexShrink: 0, gap: "0.6rem", padding: framed ? "0.25rem 0.95rem 0.6rem" : isTouch ? "0.6rem 0.9rem 0.55rem" : "0.85rem 1.1rem 0.65rem" }}>
          <RostraMark />
          <div style={{ minWidth: 0 }}>
            <div data-no-translate style={{ color: INK, fontSize: "1.05rem", fontWeight: 900, letterSpacing: "0.04em", lineHeight: 1.05 }}>Rostra</div>
            <div style={{ color: INK_FAINT, fontSize: "0.62rem", marginTop: "0.1rem" }}>What the world is saying</div>
          </div>
          {/* In the frame the day is on the status bar. */}
          {!framed && <span style={{ color: INK_FAINT, fontSize: "0.68rem", marginLeft: "auto" }}>{postDate(game.gameDate)}</span>}
          {/* The pen: write a post (and put the box away again). */}
          <button
            type="button"
            className="oh-tap"
            onClick={composing ? closeComposer : openComposer}
            disabled={!country}
            aria-label={composing ? "Put the post away" : "Write a post"}
            aria-pressed={composing}
            title={composing ? "Put the post away" : "Write a post"}
            style={{ alignItems: "center", background: composing ? ACCENT_SOFT : "rgba(255,255,255,0.06)", border: composing ? `1px solid ${ACCENT_EDGE}` : "1px solid transparent", borderRadius: "999px", color: composing ? ACCENT : INK_SOFT, cursor: country ? "pointer" : "default", display: "inline-flex", flex: "0 0 auto", height: "2rem", justifyContent: "center", marginLeft: framed ? "auto" : undefined, padding: 0, width: "2rem" }}
          >
            <PenIcon />
          </button>
          <button
            type="button"
            className="oh-tap"
            onClick={onClose}
            aria-label="Close Rostra"
            style={{ alignItems: "center", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: "999px", color: INK_SOFT, cursor: "pointer", display: "inline-flex", flex: "0 0 auto", height: "2rem", justifyContent: "center", padding: 0, width: "2rem" }}
          >
            <CloseIcon />
          </button>
        </div>

        <div ref={scrollRef} className="rostra-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
          {/* The box, when the pen opened it: the player posts as their country's leader. */}
          {composing && (
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
                placeholder={!canPost ? "You can post again once the time skip has ended." : choices ? "Ask the public a question" : "What would you like to tell the world?"}
                rows={isTouch || framed ? 2 : 3}
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
              {/* A poll's choices: two to four, each a short line. */}
              {choices && (
                <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.4rem" }}>
                  {choices.map((choice, index) => (
                    <div key={index} style={{ alignItems: "center", display: "flex", gap: "0.35rem" }}>
                      <input
                        className="rostra-composer"
                        value={choice}
                        maxLength={POLL_CHOICE_MAX_CHARS}
                        disabled={!canPost}
                        onChange={(event) => setChoices((all) => all.map((entry, at) => (at === index ? event.target.value : entry)))}
                        placeholder={`Choice ${index + 1}`}
                        aria-label={`Choice ${index + 1}`}
                        style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${ACCENT_EDGE}`, borderRadius: "8px", boxSizing: "border-box", color: INK, flex: 1, fontFamily: "sans-serif", fontSize: "0.8rem", minWidth: 0, outline: "none", padding: "0.38rem 0.55rem" }}
                      />
                      {choices.length > POLL_CHOICES_MIN && (
                        <button
                          type="button"
                          className="oh-tap"
                          onClick={() => setChoices((all) => all.filter((_, at) => at !== index))}
                          aria-label={`Remove choice ${index + 1}`}
                          style={{ alignItems: "center", background: "none", border: "none", color: INK_FAINT, cursor: "pointer", display: "inline-flex", padding: "0.2rem" }}
                        >
                          <CloseIcon />
                        </button>
                      )}
                    </div>
                  ))}
                  <div style={{ alignItems: "center", display: "flex", gap: "0.6rem", justifyContent: "space-between" }}>
                    {choices.length < POLL_CHOICES_MAX ? (
                      <button type="button" className="oh-tap-row" onClick={() => setChoices((all) => [...all, ""])} style={{ background: "none", border: "none", color: ACCENT, cursor: "pointer", fontFamily: "sans-serif", fontSize: "0.72rem", fontWeight: 700, padding: "0.2rem 0", whiteSpace: "nowrap" }}>
                        Add a choice
                      </button>
                    ) : <span />}
                    <span style={{ color: INK_FAINT, fontSize: "0.66rem" }}>The public votes until the next time skip.</span>
                  </div>
                </div>
              )}
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
              <div style={{ alignItems: "center", borderTop: `1px solid ${LINE}`, display: "flex", gap: "0.6rem", justifyContent: "flex-end", marginTop: "0.5rem", paddingTop: "0.5rem" }}>
                {/* A poll, or a plain post again. */}
                <button
                  type="button"
                  className="oh-tap"
                  onClick={() => setChoices((all) => (all ? null : [...NEW_CHOICES]))}
                  disabled={!canPost}
                  aria-pressed={Boolean(choices)}
                  aria-label={choices ? "Remove the poll" : "Add a poll"}
                  title={choices ? "Remove the poll" : "Add a poll"}
                  style={{ alignItems: "center", background: choices ? ACCENT_SOFT : "none", border: "none", borderRadius: "999px", color: choices ? ACCENT : INK_SOFT, cursor: canPost ? "pointer" : "default", display: "inline-flex", fontFamily: "sans-serif", fontSize: "0.72rem", fontWeight: 700, gap: "0.3rem", marginRight: "auto", padding: "0.3rem 0.55rem" }}
                >
                  <PollIcon />
                  <span>Poll</span>
                </button>
                <span data-no-translate style={{ color: tooLong ? "#f87171" : INK_FAINT, fontSize: "0.7rem" }}>
                  {length}/{SOCIAL_POST_MAX_CHARS}
                </span>
                <button
                  type="button"
                  className="oh-tap-row"
                  onClick={() => void submit()}
                  disabled={!ready || posting}
                  style={{
                    background: ready ? ACCENT : "rgba(43,193,243,0.25)",
                    border: "none",
                    borderRadius: "999px",
                    color: "#06171d",
                    cursor: ready && !posting ? "pointer" : "default",
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
          )}
          {posted && !composing && (
            <div role="status" style={{ borderBottom: `1px solid ${LINE}`, color: ACCENT, fontSize: "0.74rem", padding: "0.6rem 1rem" }}>
              Posted. The world answers with the next time skip.
            </div>
          )}

          {tab === "search" ? (
            <RostraSearch
              shown={isOpen}
              opened={opened}
              country={country}
              feed={feed}
              renderPost={(post) => (
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
              )}
            />
          ) : posts.length === 0 && tab === "all" ? (
            <EmptyFeedRefresh canPost={canPost} />
          ) : posts.length === 0 ? (
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

        {/* The tab bar: everything, a search for any place, what answers or
            names them, and their own posts. */}
        <div role="tablist" style={{ borderTop: `1px solid ${LINE}`, display: "flex", flexShrink: 0, padding: framed ? "0.3rem 0.35rem 0.05rem" : "0.3rem 0.35rem 0.35rem" }}>
          {TABS.map(([key, label, Icon]) => {
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
                  background: "none",
                  border: "none",
                  color: active ? INK : INK_FAINT,
                  cursor: "pointer",
                  display: "flex",
                  flex: "1 1 0",
                  flexDirection: "column",
                  fontFamily: "sans-serif",
                  fontSize: "0.6rem",
                  fontWeight: active ? 800 : 650,
                  gap: "0.18rem",
                  minWidth: 0,
                  padding: "0.3rem 0.1rem",
                }}
              >
                <span style={{ display: "inline-flex", position: "relative" }}>
                  <Icon />
                  {count > 0 && (
                    <span data-no-translate style={{ alignItems: "center", background: ACCENT, border: `1.5px solid ${framed ? SCREEN : "#18181b"}`, borderRadius: 999, color: "#06171d", display: "inline-flex", fontSize: ".55rem", fontWeight: 800, height: "1.05rem", justifyContent: "center", minWidth: "1.05rem", padding: "0 .2rem", position: "absolute", right: "-0.6rem", top: "-0.4rem" }}>
                      {count > 9 ? "9+" : count}
                    </span>
                  )}
                </span>
                <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
              </button>
            );
          })}
        </div>
        {framed && (
          <div aria-hidden="true" style={{ display: "flex", flex: "0 0 auto", justifyContent: "center", padding: "0.3rem 0 0.45rem" }}>
            <span style={{ background: "rgba(244,244,245,0.85)", borderRadius: "999px", height: "0.26rem", width: "6.6rem" }} />
          </div>
        )}
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

  // Check in Rostra on a map card opens the panel (rostraOpen.js).
  useEffect(() => onRostraPlace(() => {
    setHasOpened(true);
    if (!isOpen) onToggle();
  }), [isOpen, onToggle]);

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
