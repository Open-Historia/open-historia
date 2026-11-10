/*! Open Historia — Rostra's Search: what people in a place are saying © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Rostra's Search tab (social.jsx): "integrate the old listen in into rostra by
// making it so you can search countries or regions in a search tab at the
// bottem where the your country currently is" (the owner, 2026-11-03).
//
// It opens on the player's own country: what its people who make the news have
// posted on Rostra, as the old Your country tab showed. A search finds any
// country or region on the map, and a place shows what its ordinary people are
// posting today, as Listen in did: ONE AI request (AI/gameplay.js
// generatePlaceFeed), made because the player picked the place or pressed for
// new posts, never in a loop, and kept on the device (runtime/placeFeedStore.js)
// so the same place on the same game day opens at once and costs nothing. A
// request still running when the tab is left is finished and kept all the same:
// it was paid for. The player's own country is never asked for by itself: its
// people's posts come on a press.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadRegionCatalog } from "../../runtime/assets.js";
import { formatGameDateReadable } from "../../runtime/gameDates.js";
import { readGameData } from "../../runtime/gameState.js";
import { getStoredLanguage, languageDisplayName } from "../../runtime/i18n.js";
import { getLibraryState } from "../../runtime/library.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import {
  addPlaceFeedBatch,
  createPlaceFeedBatch,
  placeFeedAgeLabel,
  placeFeedAvatar,
  placeFeedBatchLine,
  placeFeedCountLabel,
  placeFeedCountryOf,
  placeFeedPlace,
  placeFeedPlaceKey,
  placeFeedPlaceTitle,
  placeFeedReadingLanguage,
  placeFeedRequestKey,
  placeFeedSearch,
  placeFeedView,
} from "../../runtime/placeFeed.js";
import { readPlaceFeedStore, updatePlaceFeedStore } from "../../runtime/placeFeedStore.js";
import { socialFeedView } from "../../runtime/socialFeed.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { generatePlaceFeed } from "../AI/gameplayLazy.js";
import { createReportRequests } from "../Selection/reportRequests.js";
import { RS } from "./rostraLooks.js";
import { RefreshButton, RefreshIcon } from "./rostraRefresh.jsx";

// A place's feed being written, by game, place, day and language, outside the
// tab: it is left and opened again while one is on its way, and the second
// opening joins the first request (Selection/reportRequests.js).
const feedRequests = createReportRequests();

// Colours from Rostra's look (rostraLooks.js).
const { INK, INK_SOFT, INK_FAINT, LINE, WASH, WASH_FAINT, EDGE, SCREEN, WARN } = RS;
const LIKED = "#f43f5e";

const iconProps = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
const ReplyIcon = () => <svg {...iconProps}><path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l2-5.6A8.4 8.4 0 1 1 21 11.5z" /></svg>;
const RepostIcon = () => <svg {...iconProps}><path d="M17 2l4 4-4 4" /><path d="M3 12V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 12v3a3 3 0 0 1-3 3H3" /></svg>;
const HeartIcon = ({ filled }) => <svg {...iconProps} fill={filled ? "currentColor" : "none"}><path d="M20.8 5.6a5.2 5.2 0 0 0-7.4 0L12 7l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21.8l8.8-8.8a5.2 5.2 0 0 0 0-7.4z" /></svg>;
const SearchGlyph = () => <svg {...iconProps} width={16} height={16}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.5-4.5" /></svg>;
const ClearGlyph = () => <svg {...iconProps} width={14} height={14} strokeWidth={2.2}><path d="M6 6l12 12M18 6L6 18" /></svg>;
const PinGlyph = () => <svg {...iconProps} width={15} height={15}><path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></svg>;
const FlagGlyph = () => <svg {...iconProps} width={15} height={15}><path d="M5 21V4" /><path d="M5 4.5c4.5-2 7.5 2 14 0v9c-6.5 2-9.5-2-14 0" /></svg>;

const STYLE_ID = "rostra-search-styles";
const ensureStyles = () => {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
  @keyframes rostraShimmer { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
  .rostra-search-input::placeholder { color: ${INK_FAINT}; }
  .rostra-search-hit:hover { background: ${WASH}; }
  @media (prefers-reduced-motion: reduce) { .rostra-shimmer { animation: none !important; } }
  `;
  document.head.appendChild(style);
};

const pillButtonStyle = {
  background: INK,
  border: "none",
  borderRadius: "999px",
  color: SCREEN,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "0.78rem",
  fontWeight: 800,
  marginTop: "0.65rem",
  padding: "0.42rem 1.05rem",
};

const actionStyle = {
  alignItems: "center",
  background: "none",
  border: "none",
  color: INK_FAINT,
  cursor: "default",
  display: "inline-flex",
  fontFamily: "inherit",
  fontSize: "0.72rem",
  gap: "0.3rem",
  minWidth: "2.8rem",
  padding: "0.15rem 0",
};

const PersonAvatar = ({ author }) => {
  const { initials, colour } = placeFeedAvatar(author);
  return (
    <span aria-hidden="true" style={{ alignItems: "center", background: colour, borderRadius: "50%", color: "#fff", display: "flex", flex: "0 0 auto", fontSize: "0.8rem", fontWeight: 700, height: "2.4rem", justifyContent: "center", letterSpacing: "0.02em", width: "2.4rem" }}>
      {initials}
    </span>
  );
};

// One post by someone who lives there. The words are the model's and already in
// the player's language, so the page's translator leaves the post alone.
const PersonPost = ({ post, language, liked, onLike }) => (
  <article data-no-translate className="rostra-post" style={{ borderBottom: `1px solid ${LINE}`, display: "flex", gap: "0.65rem", padding: "0.8rem 1rem" }}>
    <PersonAvatar author={post.author} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ alignItems: "baseline", display: "flex", gap: "0.3rem", minWidth: 0 }}>
        <span style={{ color: INK, flex: "0 1 auto", fontSize: "0.84rem", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.author}</span>
        {post.handle && <span style={{ color: INK_SOFT, flex: "0 10 auto", fontSize: "0.78rem", minWidth: "2rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`@${post.handle}`}</span>}
        <span style={{ color: INK_SOFT, flex: "0 0 auto", fontSize: "0.78rem" }}>{`· ${placeFeedAgeLabel(post.minutesAgo, language)}`}</span>
      </div>
      {post.about && <div style={{ color: INK_FAINT, fontSize: "0.7rem", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.about}</div>}
      <div style={{ color: INK, fontSize: "0.86rem", lineHeight: 1.45, marginTop: "0.25rem", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{post.text}</div>
      <div style={{ alignItems: "center", display: "flex", gap: "1.1rem", marginTop: "0.5rem" }}>
        <span style={actionStyle}><ReplyIcon />{placeFeedCountLabel(post.replies, language)}</span>
        <span style={actionStyle}><RepostIcon />{placeFeedCountLabel(post.reposts, language)}</span>
        <button
          type="button"
          // The one that answers a tap: finger-sized on a touch screen.
          className="oh-tap-row"
          aria-pressed={liked}
          aria-label="Like"
          onClick={onLike}
          style={{ ...actionStyle, color: liked ? LIKED : INK_FAINT, cursor: "pointer" }}
        >
          <HeartIcon filled={liked} />{placeFeedCountLabel(post.likes + (liked ? 1 : 0), language)}
        </button>
      </div>
    </div>
  </article>
);

// What stands in for the posts while the request is out.
const SkeletonPost = ({ width }) => {
  const bar = (w, h = "0.65rem") => ({ animation: "rostraShimmer 1.4s cubic-bezier(0.45, 0, 0.55, 1) infinite", background: EDGE, borderRadius: "999px", height: h, width: w });
  return (
    <div aria-hidden="true" style={{ borderBottom: `1px solid ${LINE}`, display: "flex", gap: "0.65rem", padding: "0.8rem 1rem" }}>
      <span className="rostra-shimmer" style={{ ...bar("2.4rem", "2.4rem"), borderRadius: "50%", flex: "0 0 auto" }} />
      <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: "0.5rem", paddingTop: "0.2rem" }}>
        <span className="rostra-shimmer" style={bar("45%")} />
        <span className="rostra-shimmer" style={bar("92%")} />
        <span className="rostra-shimmer" style={bar(width)} />
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
  fontSize: "0.8rem",
  fontWeight: 750,
  minWidth: 0,
  overflow: "hidden",
  padding: "0.55rem 0.5rem 0.45rem",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const sectionLabel = { color: INK_SOFT, fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.08em", padding: "0.65rem 1rem 0.35rem", textTransform: "uppercase" };

// The game, the day and the language a feed answers for, read when the tab is
// first shown and again on another day. The language is handed to the request as
// it is, so a feed is kept under the very name it is looked up by.
const readSession = async (world) => {
  const game = await readGameData().catch(() => ({}));
  const uiLanguage = getStoredLanguage();
  return {
    gameId: String(getLibraryState()?.activeGameId ?? ""),
    gameDate: String(game?.gameDate ?? ""),
    uiLanguage,
    language: placeFeedReadingLanguage({
      uiLanguage,
      uiLanguageName: languageDisplayName(uiLanguage),
      saveLanguage: world?.language || game?.language,
    }),
  };
};

const selectSearchWorld = (world) => world;
// What the search needs of the world, as one string, so a write elsewhere does
// not redraw the tab unless a region changed hands or a country was renamed.
const ownershipKeyOf = (world) => {
  const overrides = world?.regionOwnershipOverrides ?? {};
  const names = world?.polityOverrides ?? {};
  return `${Object.keys(overrides).length}:${JSON.stringify(overrides).length}:${Object.keys(names).length}:${world?.customRegions ? 1 : 0}`;
};

// The stock tiles' regions a hand-drawn world does not have are left out, as
// the time skip leaves them out (AI/promptContext.js filterToRenderedRegions).
const STOCK_REGION_ID = /^[A-Z]{3}\.\d+(?:_\d+)?$/;
const regionsOnMap = (catalog, world) => {
  const overrides = world?.regionOwnershipOverrides ?? {};
  const list = Array.isArray(catalog) ? catalog : [];
  const drawn = Boolean(world?.customRegions) && list.some((region) => !STOCK_REGION_ID.test(String(region?.id ?? "")));
  return list
    .filter((region) => !drawn || !STOCK_REGION_ID.test(String(region?.id ?? "")) || region?.custom === true || overrides[String(region?.id)] !== undefined)
    .map((region) => {
      const holder = String(overrides[String(region?.id)] ?? "").trim() || String(region?.country ?? "").trim();
      return { id: String(region.id), name: String(region.name ?? region.id), owner: holder ? toCountryName(holder) || holder : "" };
    });
};

const RostraSearch = ({ shown, opened = null, country, feed, renderPost }) => {
  const world = useRuntimeState("world", selectSearchWorld);
  const ownership = ownershipKeyOf(world);
  const own = useMemo(() => placeFeedPlace({ polity: country, polityKey: country }), [country]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null);
  const [nationwide, setNationwide] = useState(false);
  const [catalog, setCatalog] = useState(null);
  const [session, setSession] = useState(null);
  const [store, setStore] = useState(null);
  // By request key: what was asked for, what is being written, what failed,
  // and which places the player picked (picking one is the asking, once).
  const [asked, setAsked] = useState({});
  const [loading, setLoading] = useState({});
  const [failed, setFailed] = useState({});
  const [wanted, setWanted] = useState({});
  const [liked, setLiked] = useState(() => new Set());
  const sessionRef = useRef(null);
  const mounted = useRef(true);
  const inputRef = useRef(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { ensureStyles(); }, []);

  // The game and what is kept for it, once the tab is first shown, and again
  // when the game moves on to another day or is another game.
  const gameDate = useRuntimeState("game", (game) => String(game?.gameDate ?? ""));
  useEffect(() => {
    if (!shown) return undefined;
    let cancelled = false;
    (async () => {
      const next = await readSession(world);
      const kept = await readPlaceFeedStore(next.gameId);
      if (cancelled) return;
      sessionRef.current = next;
      setSession(next);
      setStore(kept);
    })();
    return () => { cancelled = true; };
    // The world is read for its language only: not a reason to read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, gameDate]);

  // The map's regions, read once the player starts to search.
  useEffect(() => {
    if (!shown || !query.trim() || catalog) return undefined;
    let cancelled = false;
    loadRegionCatalog()
      .then((rows) => { if (!cancelled) setCatalog(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setCatalog([]); });
    return () => { cancelled = true; };
  }, [shown, query, catalog]);

  const regions = useMemo(() => (catalog ? regionsOnMap(catalog, world) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, ownership]);
  const countries = useMemo(() => {
    const names = new Set();
    for (const region of regions) if (region.owner) names.add(region.owner);
    for (const [key, record] of Object.entries(world?.polityOverrides ?? {})) names.add(String(record?.name ?? "").trim() || key);
    if (country) names.add(country);
    return [...names].filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions, ownership, country]);
  const hits = useMemo(() => placeFeedSearch({ query, countries, regions }), [query, countries, regions]);

  const target = picked ?? own;
  const countryOfTarget = useMemo(() => (target?.scope === "region" ? placeFeedCountryOf(target) : null), [target]);
  const place = nationwide && countryOfTarget ? countryOfTarget : target;
  const requestKey = session && place ? placeFeedRequestKey({ ...session, place }) : "";
  const failure = requestKey ? failed[requestKey] : undefined;
  // What to show, and whether picking this place is itself the asking
  // (runtime/placeFeed.js placeFeedView: once, never in a loop). The player's
  // own country, shown when the tab opens, is never asked for by itself.
  const { batches, shouldAsk, waiting, canAsk, trends } = placeFeedView({
    store: session ? store : null,
    place,
    gameDate: session?.gameDate,
    language: session?.language,
    asked: Boolean(asked[requestKey]) || !wanted[placeFeedPlaceKey(place)],
    loading: Boolean(loading[requestKey]),
    failed: failure !== undefined,
  });

  // One request for the place shown. Joined if one is already on its way; kept
  // on the device when it lands, whether or not the tab still shows it.
  const load = useCallback((where, key, language) => {
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
      const answer = await generatePlaceFeed({ place: where, language });
      const batch = createPlaceFeedBatch(answer);
      await updatePlaceFeedStore(answer.campaignId, (kept) => addPlaceFeedBatch(kept, where, batch));
      return { campaignId: answer.campaignId, gameDate: answer.gameDate };
    });
    request
      .then(async (outcome) => {
        // What is kept now, which holds any other feed that landed meanwhile.
        const kept = await readPlaceFeedStore(outcome.campaignId);
        const open = sessionRef.current;
        if (!mounted.current || !open || open.gameId !== outcome.campaignId) return;
        setStore(kept);
        // A feed is stamped with the day the game was really on; should that
        // not be the day read when the tab opened, the tab follows it.
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

  // A place picked with nothing for today: that is the player asking, once.
  useEffect(() => {
    if (shown && shouldAsk) load(place, requestKey, session.language);
  }, [shown, shouldAsk, load, place, requestKey, session]);

  // A place a map card opened Rostra on (rostraOpen.js): shown, and not asked
  // for by itself; its Refresh asks.
  useEffect(() => {
    if (!opened?.place) return;
    setPicked(opened.place);
    setNationwide(false);
    setQuery("");
  }, [opened]);

  const pick = (next) => {
    setPicked(next);
    setNationwide(false);
    setQuery("");
    setWanted((all) => ({ ...all, [placeFeedPlaceKey(next)]: true }));
  };
  const ask = () => {
    if (!session || !place) return;
    setWanted((all) => ({ ...all, [placeFeedPlaceKey(place)]: true }));
    load(place, requestKey, session.language);
  };
  const toggleLike = (id) => setLiked((all) => {
    const next = new Set(all);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  // The country's own posts on Rostra: its people who make the news, and its
  // leader. Shown on the country's tab, newest first.
  const polity = place?.scope === "country" ? place.polity : "";
  const rostraPosts = useMemo(
    () => (polity ? socialFeedView(feed, { tab: "country", country: polity }).slice(0, 6) : []),
    [feed, polity],
  );
  const searching = Boolean(query.trim());
  const title = placeFeedPlaceTitle(place);
  const dateLong = formatGameDateReadable(session?.gameDate) || "";

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      {/* The search box: a country or a region. */}
      <div style={{ borderBottom: `1px solid ${LINE}`, padding: "0.65rem 0.85rem" }}>
        <label style={{ alignItems: "center", background: WASH, border: `1px solid ${EDGE}`, borderRadius: "999px", color: INK_SOFT, display: "flex", gap: "0.45rem", padding: "0.38rem 0.75rem" }}>
          <SearchGlyph />
          <input
            ref={inputRef}
            className="rostra-search-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && hits[0]) pick(hits[0]);
              if (event.key === "Escape" && query) {
                event.stopPropagation();
                setQuery("");
              }
            }}
            placeholder="Search countries and regions"
            aria-label="Search countries and regions"
            enterKeyHint="search"
            style={{ background: "transparent", border: "none", color: INK, flex: 1, fontFamily: "inherit", fontSize: "0.84rem", minWidth: 0, outline: "none", padding: 0 }}
          />
          {query && (
            <button type="button" className="oh-tap" aria-label="Clear the search" onClick={() => { setQuery(""); inputRef.current?.focus(); }} style={{ alignItems: "center", background: "none", border: "none", color: INK_SOFT, cursor: "pointer", display: "inline-flex", padding: 0 }}>
              <ClearGlyph />
            </button>
          )}
        </label>
      </div>

      {searching ? (
        <div role="listbox" aria-label="Places">
          {catalog === null && <div style={{ color: INK_SOFT, fontSize: "0.76rem", padding: "0.8rem 1rem" }}>Reading the map…</div>}
          {catalog !== null && hits.length === 0 && <div style={{ color: INK_SOFT, fontSize: "0.78rem", padding: "0.9rem 1rem" }}>No country or region by that name.</div>}
          {hits.map((hit) => (
            <button
              key={placeFeedPlaceKey(hit)}
              type="button"
              role="option"
              aria-selected="false"
              className="oh-tap-row rostra-search-hit"
              onClick={() => pick(hit)}
              style={{ alignItems: "center", background: "none", border: "none", borderBottom: `1px solid ${LINE}`, color: INK, cursor: "pointer", display: "flex", fontFamily: "inherit", gap: "0.65rem", padding: "0.6rem 1rem", textAlign: "left", width: "100%" }}
            >
              <span style={{ color: INK_SOFT, display: "inline-flex", flex: "0 0 auto" }}>{hit.scope === "region" ? <PinGlyph /> : <FlagGlyph />}</span>
              <span style={{ minWidth: 0 }}>
                <span data-no-translate style={{ display: "block", fontSize: "0.84rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{placeFeedPlaceTitle(hit)}</span>
                <span style={{ color: INK_FAINT, display: "block", fontSize: "0.7rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {hit.scope !== "region" ? "Country" : hit.polity ? <span data-no-translate>{hit.polity}</span> : "Held by no country"}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <>
          {/* Where and when, and new posts (one AI request). */}
          <div style={{ alignItems: "center", display: "flex", gap: "0.6rem", padding: "0.6rem 1rem 0.45rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div data-no-translate style={{ fontSize: "0.98rem", fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
              <div style={{ color: INK_SOFT, fontSize: "0.68rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dateLong}</div>
            </div>
            {picked && (
              <button type="button" className="oh-tap-row" onClick={() => { setPicked(null); setNationwide(false); }} style={{ background: WASH, border: "none", borderRadius: "999px", color: INK_SOFT, cursor: "pointer", fontFamily: "inherit", fontSize: "0.68rem", fontWeight: 700, padding: "0.32rem 0.7rem" }}>
                Your country
              </button>
            )}
            <button
              type="button"
              className="oh-tap"
              aria-label="Load new posts"
              title="Load new posts (one AI request)"
              disabled={!canAsk}
              onClick={ask}
              style={{ alignItems: "center", background: WASH, border: "none", borderRadius: "999px", color: INK, cursor: canAsk ? "pointer" : "default", display: "inline-flex", flex: "0 0 auto", height: "2rem", justifyContent: "center", opacity: canAsk ? 1 : 0.45, padding: 0, width: "2rem" }}
            >
              <RefreshIcon />
            </button>
          </div>

          {/* A region turns to the whole of its country and back. */}
          {countryOfTarget && (
            <div role="tablist" style={{ borderBottom: `1px solid ${LINE}`, display: "flex", flex: "0 0 auto" }}>
              <button type="button" role="tab" aria-selected={!nationwide} className="oh-tap-row" onClick={() => setNationwide(false)} style={tabStyle(!nationwide)}><span data-no-translate>{target.regionName}</span></button>
              <button type="button" role="tab" aria-selected={nationwide} className="oh-tap-row" onClick={() => setNationwide(true)} style={tabStyle(nationwide)}><span data-no-translate>{countryOfTarget.polity}</span></button>
            </div>
          )}

          {trends.length > 0 && (
            <div style={{ borderBottom: `1px solid ${LINE}`, padding: "0.6rem 1rem 0.65rem" }}>
              <div style={{ ...sectionLabel, padding: "0 0 0.4rem" }}>Trending</div>
              <div data-no-translate style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                {trends.map((trend) => (
                  <span key={trend} style={{ background: WASH, borderRadius: "999px", color: INK, fontSize: "0.74rem", fontWeight: 650, padding: "0.22rem 0.6rem" }}>{trend}</span>
                ))}
              </div>
            </div>
          )}

          {rostraPosts.length > 0 && (
            <section aria-label="On Rostra">
              <div style={sectionLabel}>On Rostra</div>
              {rostraPosts.map((post) => renderPost(post))}
            </section>
          )}

          <section aria-label="What people are saying">
            <div style={sectionLabel}>What people are saying</div>
            {waiting && session && wanted[placeFeedPlaceKey(place)] && (
              <div role="status">
                <div style={{ color: INK_SOFT, fontSize: "0.74rem", padding: "0.2rem 1rem 0.2rem" }}>Tuning in…</div>
                <SkeletonPost width="70%" />
                <SkeletonPost width="48%" />
                <SkeletonPost width="82%" />
              </div>
            )}
            {failure !== undefined && !waiting && (
              <div role="alert" style={{ borderBottom: `1px solid ${LINE}`, padding: "1rem", textAlign: "center" }}>
                <div style={{ fontSize: "0.86rem", fontWeight: 700 }}>The posts could not be loaded.</div>
                {failure && <div data-no-translate style={{ color: INK_SOFT, fontSize: "0.72rem", lineHeight: 1.4, marginTop: "0.3rem", overflowWrap: "anywhere" }}>{failure}</div>}
                <button type="button" className="oh-tap-row" onClick={ask} style={pillButtonStyle}>Try again</button>
              </div>
            )}
            {/* Nothing kept for today: one press asks. */}
            {!waiting && failure === undefined && batches.length === 0 && session && (
              <div style={{ padding: "1.1rem 1rem 1.4rem", textAlign: "center" }}>
                <div style={{ color: INK, fontSize: "0.86rem", fontWeight: 750 }}>Nothing has been posted here yet.</div>
                <div style={{ color: INK_SOFT, fontSize: "0.76rem", lineHeight: 1.45, marginTop: "0.3rem" }}>
                  {`Refresh to see what ordinary people in ${title} are posting.`}
                </div>
                <RefreshButton onClick={ask} />
              </div>
            )}
            {batches.map((batch, index) => {
              // A feed read on an earlier day says which; an earlier one of the
              // same day only that it is earlier.
              const line = placeFeedBatchLine(batches, index, session?.gameDate);
              return (
                <div key={batch.id}>
                  {line && (
                    <div style={{ background: WASH_FAINT, borderBottom: `1px solid ${LINE}`, color: INK_SOFT, fontSize: "0.68rem", fontWeight: 700, padding: "0.38rem 1rem", textAlign: "center" }}>
                      {line.kind === "date" ? formatGameDateReadable(line.gameDate) || line.gameDate : "Earlier"}
                    </div>
                  )}
                  {batch.posts.map((post) => (
                    <PersonPost key={post.id} post={post} language={session?.uiLanguage} liked={liked.has(post.id)} onLike={() => toggleLike(post.id)} />
                  ))}
                </div>
              );
            })}
            {batches.length > 0 && (
              <div style={{ color: INK_FAINT, fontSize: "0.66rem", lineHeight: 1.45, padding: "0.85rem 1.2rem 1.1rem", textAlign: "center" }}>
                Written by your AI model. Each new feed is one AI request.
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default RostraSearch;
