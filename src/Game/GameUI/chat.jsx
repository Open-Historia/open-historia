/*! Open Historia — portions (era diplomacy + mobile panel sizing) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { dedupeByName } from "../../runtime/countryList.js";
import ReactDOM from "react-dom";
import { sendDiplomaticMessage, startDiplomaticChat, loadDiplomaticHistory } from "../AI/main.jsx";
import { chooseNextDiplomaticSpeaker, ensureCountryAssessed, isChatGenerationLikely, processPendingEventOutreach } from "../AI/gameplay.js";
import {
    MAX_ACTIVE_SPIES, activeSpies, deploySpy, expelSpy, foreignSpies, intelligenceOf, normalizeIntercepts, normalizeSpies,
    recallSpy, redactExchange, setCoverStory, signalClarity, turnSpy,
} from "../../runtime/spycraft.js";
import { isSeal, newSeal, openExchange } from "../../runtime/spySeal.js";
import { Actions } from "./actions";
import { Projects } from "./projects";
import { Presence } from "./presence.jsx";
import { useMainMenuOpen } from "./libraryBar";
import {
    JSON_URLS,
    getNationColors,
    getNationFlags,
    loadCountryNames as loadCachedCountryNames,
    readJson,
} from "../../runtime/assets.js";
import { flagEmojiFromGid, flagImageUrlFromGid } from "../../runtime/countryFlags.js";
import { resolvePolityFlag } from "../../runtime/polityFlags.js";
import { fetchCommunityFlags, loadCommunityFlagDataUrl } from "../../runtime/communityFlags.js";
import { logDebugEvent } from "../../runtime/debugLog.js";
import { getLibraryState } from "../../runtime/library.js";
import { readChatsState, writeChatsState, readInterceptsState, readWorldState, readWorldStateView, writeWorldState, applyProjectOpsToWorld } from "../../runtime/gameState.js";
import { spyOperationOps } from "../../runtime/projects.js";
import Markdown, { MarkdownStyleInjector } from "./markdown.jsx";

// ── Storage ───────────────────────────────────────────────────────────────────

const saveAllChats = async (chats) => {
    try {
        await writeChatsState(chats);
    } catch (err) { console.error("Failed to save chats:", err); }
};

const loadAllChats = async ({ force = false } = {}) => {
    try {
        return await readChatsState({ force });
    } catch { return []; }
};

// ── PMTiles country loader ────────────────────────────────────────────────────

const loadCountryNames = async () => {
    return loadCachedCountryNames();
};

const countryMatchesIdentity = (country, identity) => {
    const normalizedIdentity = String(identity ?? "").trim().toLowerCase();
    if (!normalizedIdentity) return false;
    return [country?.name, country?.code]
        .some(value => String(value ?? "").trim().toLowerCase() === normalizedIdentity);
};

// ── Flags ─────────────────────────────────────────────────────────────────────
// Country flags render as images rather than emoji. Resolution order per
// country, the same as the map, the polity badge and the country panel:
//   1. polityFlags.js resolvePolityFlag — the scenario author's flag for the
//      polity (flags.json, by stable key, name or alias), a legacy per-polity
//      flag, an explicit map reference, then the stock flag of the polity's
//      own identity. This is what makes a 1911 Kingdom of Greece or a Russian
//      flag over the Grand Duchy of Finland show up here and not only on the
//      map — the picker used to jump straight to flagcdn for any name that
//      had a modern country code, which is the wrong flag for every
//      historical polity.
//   2. flagcdn.com artwork by code, then by name (countryFlags.js) — the
//      resolver declines when a stock identity is ambiguous (two Chinas, a
//      Pakistan beside an Islamic Republic of Pakistan) and the picker's code
//      still knows which one this tile is.
//   3. the scenario's flags.json by code, then a community-hub flag post.

const FALLBACK_FLAG_EMOJI = "🏳";

// "code::name" -> Promise<string|null>. Module-level so every component asking
// about the same country shares one resolution, and the hub/flags.json are
// each fetched once.
const flagUrlCache = new Map();
let communityFlagsPromise = null;
let nationFlagsPromise = null;

const getCommunityFlagPosts = () => {
    if (!communityFlagsPromise) communityFlagsPromise = fetchCommunityFlags().catch(() => []);
    return communityFlagsPromise;
};

// getNationFlags() itself memoizes on the scenario token and is invalidated on
// write (see assets.js), so this wrapper only needs its own promise for the
// duration of one resolveFlagImageUrl batch
const getScenarioFlagMap = () => {
    if (!nationFlagsPromise) nationFlagsPromise = getNationFlags().catch(() => ({}));
    return nationFlagsPromise;
};

const findCommunityFlagPost = (posts, { code, name }) => {
    const normalizedCode = String(code ?? "").trim().toUpperCase();
    const normalizedName = String(name ?? "").trim().toLowerCase();
    return posts.find((post) => {
        if (post.fromScenario || !post.imageUrl) return false;
        if (normalizedCode && post.code && post.code.toUpperCase() === normalizedCode) return true;
        return normalizedName && String(post.title ?? "").trim().toLowerCase() === normalizedName;
    }) ?? null;
};

// The read-only world view: resolvePolityFlag needs the polity records
// (aliases, mapRefs, legacy flags) to find an authored flag by identity.
const getWorldForFlags = () => readWorldStateView().catch(() => ({}));

const resolveFlagImageUrl = ({ code, name } = {}) => {
    if (!code && !name) return Promise.resolve(null);
    const key = `${code ?? ""}::${name ?? ""}`;
    if (flagUrlCache.has(key)) return flagUrlCache.get(key);

    const promise = Promise.all([getScenarioFlagMap(), getWorldForFlags()])
        .then(([flags, world]) => {
            try {
                const resolved = resolvePolityFlag({ polity: { name, code }, world: world || {}, flags: flags || {} });
                if (resolved?.imageUrl) return resolved.imageUrl;
            } catch {
                /* fall through to the stock artwork */
            }
            const builtIn = flagImageUrlFromGid(code) ?? flagImageUrlFromGid(name);
            if (builtIn) return builtIn;
            const scenarioFlag = code && flags?.[code];
            if (scenarioFlag) return scenarioFlag;
            return getCommunityFlagPosts()
                .then((posts) => {
                    const match = findCommunityFlagPost(posts, { code, name });
                    return match ? loadCommunityFlagDataUrl(match).catch(() => null) : null;
                })
                .catch(() => null);
        })
        .catch(() => flagImageUrlFromGid(code) ?? flagImageUrlFromGid(name) ?? null);

    flagUrlCache.set(key, promise);
    return promise;
};

// Resolved URLs are cached for the session, so they have to be dropped when the
// answer can change: the author saves a flag (assets.js dispatches this on the
// flags write) or another save becomes active (its own flags, its own world).
if (typeof window !== "undefined") {
    const dropFlagCaches = () => {
        flagUrlCache.clear();
        nationFlagsPromise = null;
    };
    window.addEventListener("oh:flags-updated", dropFlagCaches);
    window.addEventListener("oh:active-game-changed", dropFlagCaches);
}

const useCountryFlagUrl = ({ code, name } = {}) => {
    const [url, setUrl] = useState(null);
    useEffect(() => {
        let cancelled = false;
        setUrl(null);
        resolveFlagImageUrl({ code, name }).then((resolved) => { if (!cancelled) setUrl(resolved); });
        return () => { cancelled = true; };
    }, [code, name]);
    return url;
};

const useCountryFlagUrls = (countries) => {
    const depsKey = countries.map(c => `${c.name}:${c.code ?? ""}`).join(",");
    const [urls, setUrls] = useState({});
    useEffect(() => {
        let cancelled = false;
        Promise.all(
            countries.map(({ name, code }) => resolveFlagImageUrl({ code, name }).then((url) => [name, url])),
        ).then((entries) => { if (!cancelled) setUrls(Object.fromEntries(entries)); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [depsKey]);
    return urls;
};

// Renders the resolved flag image, or the fallback glyph while unresolved/unmatched.
const FlagImg = ({ url, alt = "", size = "1em", width, height }) => {
    const w = width ?? size;
    const h = height ?? size;
    return url ? (
        <img
            src={url}
            alt={alt}
            style={{
                width: w, height: h, objectFit: "cover", borderRadius: "2px",
                display: "inline-block", verticalAlign: "middle",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.12)", flexShrink: 0,
            }}
        />
    ) : (
        <span aria-hidden="true" style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: w, height: h, verticalAlign: "middle", fontSize: size, flexShrink: 0,
        }}>{FALLBACK_FLAG_EMOJI}</span>
    );
};

// ── Nation colors (from colors.json, same source as WorldMap) ─────────────────
const countryAccentColor = (name) => {
    const colors = ["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#8b5cf6","#ec4899"];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return colors[h % colors.length];
};

// ── Nation colors ─────────────────────────────────────────────────────────────

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const nationColorFromCode = (code, map) => {
    if (!code) return null;
    if (map && map[code]) {
        const [r, g, b] = map[code];
        return `rgb(${r},${g},${b})`;
    }
    if (code.length >= 3) {
        const r = 64 + ALPHA.indexOf(code[0]) * 5;
        const g = 64 + ALPHA.indexOf(code[2]) * 5;
        const b = 64 + ALPHA.indexOf(code[1]) * 5;
        return `rgb(${r},${g},${b})`;
    }
    return null;
};

const useNationColor = (code) => {
    const [color, setColor] = useState(null);
    useEffect(() => {
        if (!code) return;
        let cancelled = false;
        getNationColors().then(map => {
            if (!cancelled) setColor(nationColorFromCode(code, map));
        });
            return () => { cancelled = true; };
    }, [code]);
    return color;
};

// ── ThinkingDots ──────────────────────────────────────────────────────────────

const ThinkingDots = () => {
    const [dots, setDots] = useState(0);
    useEffect(() => {
        const iv = setInterval(() => setDots(d => (d + 1) % 4), 500);
        return () => clearInterval(iv);
    }, []);
    return <span style={{ opacity: 0.6 }}>Thinking{".".repeat(dots)}&nbsp;</span>;
};

// Cycles 1-3 dots (never empty, unlike ThinkingDots' 0-3) — used where there's
// no room for surrounding words, just the toolbar badge and the list banner
// below signalling "something is being generated" on their own.
const PulsingDots = () => {
    const [dots, setDots] = useState(1);
    useEffect(() => {
        const iv = setInterval(() => setDots(d => (d % 3) + 1), 450);
        return () => clearInterval(iv);
    }, []);
    return <>{".".repeat(dots)}</>;
};

// ── Icons ─────────────────────────────────────────────────────────────────────

const SearchIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
);

const BackIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 5l-7 7 7 7"/>
    </svg>
);

// Drawn rather than typed, like every other icon here. The list row used the
// U+1F5D1 emoji, which has no colour glyph in Windows' default UI font and falls
// back to a monochrome symbol face; an inline SVG renders the same everywhere and
// matches the stroke weight of its neighbours.
const TrashIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    </svg>
);

const RetryIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
    </svg>
);

// Filled = currently unread (click to mark read, envelope "sealed"); outline =
// currently read (click to mark unread, envelope "opened").
const EnvelopeIcon = ({ filled }) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3.5 6.5 8.5 6 8.5-6" stroke={filled ? "rgba(24,24,27,0.9)" : "currentColor"} />
    </svg>
);





// ── Message bubble ────────────────────────────────────────────────────────────

const MessageBubble = ({ msg, onRetry }) => {
    const isPlayer = msg.role === "user";
    const isError  = msg.role === "error";
    const flagUrl  = useCountryFlagUrl(isPlayer || isError ? {} : { code: msg.code, name: msg.speaker });
    const reactions = Object.entries(msg.reactions ?? {});
    const reactionFlags = useCountryFlagUrls(reactions.map(([name, { code }]) => ({ name, code })));
    const nationColor = useNationColor(!isPlayer && !isError ? msg.code : null);
    const accentColor = nationColor ?? ((!isPlayer && !isError) ? countryAccentColor(msg.speaker ?? "") : null);

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: isPlayer ? "flex-end" : "flex-start", overflow: "visible" }}>
        <div style={{ position: "relative", maxWidth: "90%", overflow: "visible" }}>

        {!isPlayer && (
            <span style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                fontSize: "0.7rem",
                color: "rgba(255,255,255,0.4)",
                       marginBottom: "0.25rem",
                       whiteSpace: "nowrap",
            }}>
            {isError ? "⚠️ Error" : <><FlagImg url={flagUrl} alt={msg.speaker} size="0.95em" />{msg.speaker}</>}
            </span>
        )}

        {isPlayer && reactions.length > 0 && (
            <div style={{ display: "flex", flexDirection: "row-reverse", gap: "0.15rem", marginBottom: "0.3rem" }}>
            {reactions.map(([country, { emoji, code }]) => (
                <ReactionBubble key={country} country={country} emoji={emoji} flagUrl={reactionFlags[country] ?? null} code={code} />
            ))}
            </div>
        )}

        {/* Player-typed text stays verbatim under UI translation. */}
        <div data-no-translate={isPlayer ? "" : undefined} style={{
            padding: "0.6rem 0.85rem",
            borderRadius: isPlayer ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
            backgroundColor: isPlayer
            ? "#3b82f6"
            : isError
            ? "rgba(239,68,68,0.2)"
            : `color-mix(in srgb, ${accentColor} 5%, rgba(38,38,41,0.95))`,
            fontSize: "0.85rem", lineHeight: "1.5", whiteSpace: "pre-wrap", wordBreak: "break-word",
            border: isPlayer
            ? "none"
            : isError
            ? "1px solid rgba(239,68,68,0.3)"
            : `1px solid color-mix(in srgb, ${accentColor} 35%, transparent)`,
            borderLeft: (!isPlayer && !isError)
            ? `2px solid ${accentColor}`
            : undefined,
            boxSizing: "border-box",
        }}>
        {isPlayer ? msg.text : <Markdown className="chat-markdown">{msg.text}</Markdown>}
        </div>

        {/* A failed request is the transport dropping, not the leader refusing
            to answer — so the player re-sends the same message rather than
            retyping it. Only offered on the newest error (see the caller). */}
        {isError && onRetry && (
            <button onClick={onRetry}
            style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginTop: "0.4rem", padding: "0.3rem 0.6rem", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.12)", color: "#fca5a5", fontSize: "0.75rem", fontWeight: 600, fontFamily: "sans-serif", cursor: "pointer", transition: "all 0.12s ease" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.22)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.6)"; e.currentTarget.style.color = "#fecaca"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(239,68,68,0.12)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.35)"; e.currentTarget.style.color = "#fca5a5"; }}>
            <RetryIcon /> Retry
            </button>
        )}

        {!isPlayer && msg.time && (
            <span style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.3)", marginTop: "0.25rem", display: "block" }}>
            {new Date(msg.time).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}
            </span>
        )}
        </div>
        </div>
    );
};

// ── Reaction bubble ───────────────────────────────────────────────────────────

const ReactionBubble = ({ country, emoji, flagUrl, code }) => {
    const [hovered, setHovered] = useState(false);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const anchorRef = useRef(null);
    const nationColor = useNationColor(code ?? null);

    const handleMouseEnter = () => {
        if (anchorRef.current) {
            const r = anchorRef.current.getBoundingClientRect();
            setPos({ x: r.left + r.width / 2, y: r.top });
        }
        setHovered(true);
    };

    const tooltip = hovered ? ReactDOM.createPortal(
        <div style={{
            position: "fixed",
            left: pos.x,
            top: pos.y - 2,
            transform: "translate(-50%, -100%)",
                                                    backgroundColor: "rgba(24,24,27,0.95)",
                                                    border: "1px solid rgba(255,255,255,0.12)",
                                                    borderRadius: "6px",
                                                    padding: "0.2rem 0.45rem",
                                                    fontSize: "0.7rem",
                                                    color: "rgba(255,255,255,0.85)",
                                                    whiteSpace: "nowrap",
                                                    pointerEvents: "none",
                                                    zIndex: 99999,
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: "0.3rem",
        }}>
        <FlagImg url={flagUrl} alt={country} size="0.9em" /> {country}
        </div>,
        document.body
    ) : null;

    return (
        <div style={{ position: "relative", marginBottom: "-1rem" }}>
        {tooltip}
        <div
        ref={anchorRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setHovered(false)}
        style={{
            width: "1.6rem", height: "1.6rem", borderRadius: "50%",
            backgroundColor: nationColor
            ? `color-mix(in srgb, ${nationColor} 25%, rgba(31,31,34,0.98))`
            : "rgba(41,41,45,0.95)",
            border: nationColor
            ? `1.5px solid ${nationColor}`
            : "1px solid rgba(255,255,255,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.85rem", cursor: "default", lineHeight: 1,
        }}
        >
        {emoji}
        </div>
        </div>
    );
};

const TypingBubble = ({ speaker, code }) => {
    const flagUrl = useCountryFlagUrl({ code, name: speaker });
    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.7rem", color: "rgba(255,255,255,0.4)", marginBottom: "0.25rem" }}><FlagImg url={flagUrl} alt={speaker} size="0.95em" /> {speaker}</span>
        <div style={{ padding: "0.6rem 0.85rem", borderRadius: "12px 12px 12px 4px", backgroundColor: "rgba(255,255,255,0.08)", fontSize: "0.85rem" }}>
        <ThinkingDots />
        </div>
        </div>
    );
};

// ── Country selector ──────────────────────────────────────────────────────────

const CountryTile = ({ country, code, flagUrl, isSelected, onToggle }) => {
    const [hovered, setHovered] = React.useState(false);
    const shortName = country.length > 12 ? country.slice(0, 11) + "…" : country;
    return (
        <button
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.35rem",
            height: "5.5rem",
            padding: "0 0.4rem",
            borderRadius: "10px",
            border: isSelected
            ? "1px solid rgba(59,130,246,0.6)"
            : hovered
            ? "1px solid rgba(255,255,255,0.15)"
            : "1px solid rgba(255,255,255,0.07)",
            background: isSelected
            ? "rgba(59,130,246,0.18)"
            : hovered
            ? "rgba(255,255,255,0.07)"
            : "rgba(255,255,255,0.04)",
            cursor: "pointer",
            transition: "all 0.12s ease",
            fontFamily: "sans-serif",
            position: "relative",
            width: "100%",
            boxSizing: "border-box",
        }}
        >
        {isSelected && (
            <div style={{ position: "absolute", top: "0.3rem", right: "0.3rem", width: "14px", height: "14px", borderRadius: "50%", background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.55rem", color: "white", fontWeight: 700 }}>✓</div>
        )}
        <FlagImg url={flagUrl} alt={country} width="2.3rem" height="1.6rem" />
        <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.8)", textAlign: "center", lineHeight: 1.3 }}>{shortName}</span>
        </button>
    );
};

const CountrySelectorModal = ({
    countries, loading, onStart, onCancel,
    title = "Start New Diplomatic Chat",
    subtitle = "Select countries to invite to the conversation",
    selectedLabel = "Selected Countries",
    emptyLabel = "No countries selected yet",
    confirmLabel = (n) => `Chat with ${n} ${n === 1 ? "country" : "countries"}`,
    single = false,
}) => {
    const [search, setSearch]     = React.useState("");
    const [selected, setSelected] = React.useState([]);
    // Deduped before anything is rendered: the tiles and the selection are both
    // keyed by name, so a repeated name collides React keys — the same country
    // appears several times, a search misses what it matched, and clicking one
    // tile marks another selected without highlighting it. countryList.js fixes
    // the source of the duplicates; this makes the picker safe from any source.
    const filtered = useMemo(
        () => dedupeByName(countries).filter(c => c.name.toLowerCase().includes(search.toLowerCase())),
        [countries, search],
    );
    const filteredFlagUrls = useCountryFlagUrls(filtered);
    const selectedFlagUrls = useCountryFlagUrls(selected);
    const isSelectedName = (name) => selected.some(s => s.name === name);
    // single: a spy goes to ONE country, so picking another replaces the pick
    // rather than adding to it, and picking the same one again clears it.
    const toggle = ({ name, code }) => setSelected(prev => prev.some(s => s.name === name)
        ? prev.filter(s => s.name !== name)
        : single ? [{ name, code }] : [...prev, { name, code }]);

    return (
        <div style={{ position: "absolute", inset: 0, backgroundColor: "rgba(24,24,27,0.98)", borderRadius: "16px", display: "flex", flexDirection: "column", zIndex: 10 }}>
        <div style={{ padding: "1.1rem 1.25rem 0.6rem", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
        <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "white" }}>{title}</div>
        <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.4)", marginTop: "0.2rem" }}>{subtitle}</div>
        </div>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.5)", fontSize: "1.1rem", padding: "0.1rem 0.3rem", borderRadius: "6px", lineHeight: 1 }}
        onMouseEnter={e => { e.currentTarget.style.color = "white"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.5)"; e.currentTarget.style.background = "none"; }}>✕</button>
        </div>
        <div style={{ marginTop: "0.85rem", padding: "0.65rem 0.9rem", borderRadius: "10px", backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{selectedLabel}{single ? "" : ` (${selected.length})`}:</div>
        <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.35)", marginTop: "0.2rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem" }}>
        {selected.length === 0 ? emptyLabel : selected.map((c, i) => (
            <span key={c.name} style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <FlagImg url={selectedFlagUrls[c.name]} alt={c.name} size="0.9em" />{c.name}{i < selected.length - 1 ? "," : ""}
            </span>
        ))}
        </div>
        </div>
        <div style={{ position: "relative", display: "flex", alignItems: "center", marginTop: "0.75rem" }}>
        <span style={{ position: "absolute", left: "0.75rem", color: "rgba(255,255,255,0.35)", display: "flex", pointerEvents: "none" }}><SearchIcon /></span>
        <input type="text" placeholder="Search countries..." value={search} onChange={e => setSearch(e.target.value)}
        style={{ width: "100%", padding: "0.55rem 0.85rem 0.55rem 2.2rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "white", fontSize: "0.82rem", outline: "none", boxSizing: "border-box", fontFamily: "sans-serif" }}
        onFocus={e => e.target.style.borderColor = "rgba(139,92,246,0.5)"}
        onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.12)"} />
        </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "0.5rem 1rem", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridAutoRows: "5.5rem", gap: "0.5rem", alignContent: "start" }}>
        {loading && <p style={{ gridColumn: "1/-1", color: "rgba(255,255,255,0.35)", fontSize: "0.82rem", fontStyle: "italic", textAlign: "center" }}>Loading countries…</p>}
        {filtered.map(c => (
            <CountryTile key={c.name} country={c.name} code={c.code} flagUrl={filteredFlagUrls[c.name] ?? null} isSelected={isSelectedName(c.name)} onToggle={() => toggle(c)} />
        ))}
        </div>
        <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: "0.5rem", flexShrink: 0 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: "0.65rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.8)", fontSize: "0.85rem", fontWeight: 500, cursor: "pointer", fontFamily: "sans-serif" }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
        onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}>Cancel</button>
        <button onClick={() => selected.length > 0 && onStart(selected)} disabled={selected.length === 0}
        style={{ flex: 2, padding: "0.65rem", borderRadius: "10px", border: "none", background: selected.length > 0 ? "#3b82f6" : "rgba(59,130,246,0.3)", color: "white", fontSize: "0.85rem", fontWeight: 600, cursor: selected.length > 0 ? "pointer" : "not-allowed", fontFamily: "sans-serif" }}
        onMouseEnter={e => { if (selected.length > 0) e.currentTarget.style.background = "#2563eb"; }}
        onMouseLeave={e => { if (selected.length > 0) e.currentTarget.style.background = "#3b82f6"; }}>
        {confirmLabel(selected.length)}
        </button>
        </div>
        </div>
    );
};

// ── Conversation view ─────────────────────────────────────────────────────────

// 12rem at the default 16px root, matching the composer's max-height below.
const COMPOSER_MAX_HEIGHT = 192;

const ConversationView = ({ chat, playerCountry, gameDate, onDelete, onBack, onMessagesUpdate, unread = false, onToggleRead, draft = "", onDraftApplied }) => {
    // Two-step delete, matching the list row. Disarms on blur so a half-pressed
    // delete never sits waiting to catch a later click.
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const countries = useMemo(
        () => Array.isArray(chat?.countries)
            ? chat.countries.filter((country) => country && (country.name || country.code))
            : [],
        [chat?.countries],
    );
    const isGroup = countries.length > 1;

    const [messages, setMessages]               = useState(chat.messages ?? []);
    const [visibleMessageLimit, setVisibleMessageLimit] = useState(CHAT_INITIAL_RENDER_WINDOW);
    const [phase, setPhase]                     = useState("player");
    const [isLoading, setIsLoading]             = useState(false);
    const [playerInput, setPlayerInput]         = useState("");
    const [pendingCountry, setPendingCountry]   = useState(null);
    const [remainingQueue, setRemainingQueue]   = useState([]);
    const [speakingCountry, setSpeakingCountry] = useState(null);

    const nextSpeakerIdx    = useRef(0);
    const lastPlayerMessage = useRef("");
    const messagesEndRef    = useRef(null);
    const messagesRef       = useRef(chat.messages ?? []);
    const composerRef       = useRef(null);

    useEffect(() => {
        countries.forEach(({ name, code }) => resolveFlagImageUrl({ code, name }));
    }, [countries]);

    // Grows the composer to fit what is in it, up to the 12rem the stylesheet
    // caps it at — past which it scrolls, since a drafted letter runs to many
    // more lines than that and every one of them has to be reachable. The
    // textarea is rows={1}, so without this a letter would sit in a one-line box.
    const fitComposer = React.useCallback(() => {
        const el = composerRef.current;
        if (!el) return;
        el.style.height = "auto";
        // scrollHeight measures the PADDING box, but styles.css sets
        // `* { box-sizing: border-box }`, so a height of scrollHeight leaves the
        // content 2px short of its own 1px borders. The box then overflows by
        // exactly that, and overflow-y:auto shows a scrollbar on a single line of
        // text. Add the borders back and the bar appears only when it is real.
        const borders = el.offsetHeight - el.clientHeight;
        el.style.height = `${Math.min(el.scrollHeight + borders, COMPOSER_MAX_HEIGHT)}px`;
    }, []);

    // A letter the advisor drafted, arriving in the composer for the player to
    // read over and send. It is only ever text in a box: nothing is sent, and
    // nothing reaches the transcript, until they press the button themselves.
    useEffect(() => {
        if (!draft) return;
        setPlayerInput(draft);
        onDraftApplied?.();
        // After paint, so the textarea holds the new value: put the caret at the
        // end, ready to edit.
        requestAnimationFrame(() => {
            const el = composerRef.current;
            if (!el) return;
            el.focus();
            // Caret at the end, so a stray keystroke appends rather than landing
            // in the middle of the letter — but scrolled to the TOP, because a
            // long letter is there to be read from its opening line.
            el.selectionStart = el.selectionEnd = el.value.length;
            el.scrollTop = 0;
        });
    }, [draft, onDraftApplied]);

    // Covers the changes onInput never sees: a draft arriving, and the box being
    // emptied on send (which would otherwise leave it standing at letter height).
    useEffect(() => { fitComposer(); }, [playerInput, fitComposer]);

    useEffect(() => {
        const saved = chat.messages ?? [];
        // Which thread this is, logged where the switch happens. AI/main.jsx
        // records the messages but holds one module-level history for whichever
        // chat is open, so without this line a log of two threads read one after
        // the other is a single run-on conversation.
        logDebugEvent("diplomacy",
            `Opened chat #${chat.id} with ${countries.map((country) => country.name).join(", ") || "(nobody)"} — ${saved.length} saved message(s).`,
            undefined, { verbose: true });
        if (saved.length > 0) loadDiplomaticHistory(saved);
        else startDiplomaticChat();
        setVisibleMessageLimit(CHAT_INITIAL_RENDER_WINDOW);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chat.id]);

        useEffect(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, [messages, isLoading, phase]);

        const pushMessages = (updated) => {
            messagesRef.current = updated;
            setMessages(updated);
            onMessagesUpdate(chat.id, updated);
        };

        const isPlayerCountry = (country) => countryMatchesIdentity(country, playerCountry);

        const fetchLeaderResponse = async (country, playerMessage, queueAfter) => {
            // Captured before the request, not in the catch: by the time an
            // error lands, offerNextCountry may already have rotated the index
            // on, and a retry has to replay this turn from where it started.
            const speakerIdxAtStart = nextSpeakerIdx.current;
            if (isPlayerCountry(country)) {
                setPendingCountry(null);
                setRemainingQueue([]);
                setPhase("player");
                return;
            }
            setIsLoading(true);
            setSpeakingCountry(country);
            try {
                const { reply, reaction, memorySummary } = await sendDiplomaticMessage(playerMessage, country.name, countries);
                // The thread's rolling durable memory rides on the reply that
                // produced it, so a reopened thread, the advisor's one-off sends
                // and the world director read the same continuity.
                const leaderMessage = {
                    role: "leader", speaker: country.name, code: country.code, text: reply, time: gameDate,
                    ...(memorySummary ? { memorySummary } : {}),
                };

                if (reaction) {
                    const msgs = [...messagesRef.current];
                    const lastUserIdx = msgs.map(m => m.role).lastIndexOf("user");
                    if (lastUserIdx !== -1) {
                        msgs[lastUserIdx] = {
                            ...msgs[lastUserIdx],
                            reactions: { ...(msgs[lastUserIdx].reactions ?? {}), [country.name]: { emoji: reaction, code: country.code } },
                        };
                    }
                    pushMessages([...msgs, leaderMessage]);
                } else {
                    pushMessages([...messagesRef.current, leaderMessage]);
                }
            } catch (err) {
                pushMessages([...messagesRef.current, {
                    role: "error", speaker: country.name, code: country.code, text: err.message, time: gameDate,
                    // Everything handleRetry needs to re-issue this exact turn.
                    // Plain data so it survives a save/reload of the chat.
                    retry: {
                        country: { name: country.name, code: country.code ?? "" },
                        playerMessage,
                        queue: queueAfter.map(({ name, code }) => ({ name, code: code ?? "" })),
                        speakerIdx: speakerIdxAtStart,
                    },
                }]);
            } finally {
                setIsLoading(false);
                setSpeakingCountry(null);
            }
            if (queueAfter.length > 0) {
                offerNextCountry(queueAfter);
            } else {
                setPhase("player");
            }
        };

        const buildRoundQueue = () => {
            const n = countries.length;
            if (n === 0) return [];
            const s = nextSpeakerIdx.current % n;
            return [...countries.slice(s), ...countries.slice(0, s)];
        };

        const buildResponsiveQueue = async (updatedMessages) => {
            const rotatedQueue = buildRoundQueue();
            const suggestedSpeaker = await chooseNextDiplomaticSpeaker({
                chat: {
                    ...chat,
                    messages: updatedMessages,
                },
                excludeSpeaker: updatedMessages.at(-1)?.speaker || updatedMessages.at(-1)?.role || "",
            }).catch(() => "");

            if (!suggestedSpeaker) {
                return rotatedQueue;
            }

            const suggestedCountry = rotatedQueue.find((country) => country.name.toLowerCase() === suggestedSpeaker.toLowerCase());
            if (!suggestedCountry) {
                return rotatedQueue;
            }

            return [
                suggestedCountry,
                ...rotatedQueue.filter((country) => country.name !== suggestedCountry.name),
            ];
        };

        const offerNextCountry = (queue) => {
            const [next, ...rest] = queue;
            if (!next || countries.length === 0) {
                setPhase("player");
                return;
            }
            nextSpeakerIdx.current = (nextSpeakerIdx.current + 1) % countries.length;
            if (isPlayerCountry(next)) {
                setPendingCountry(null);
                setRemainingQueue([]);
                setPhase("player");
                return;
            }
            setPendingCountry(next);
            setRemainingQueue(rest);
            setPhase("pending");
        };

        const handlePlayerSubmit = async () => {
            const text = playerInput.trim();
            if (!text || isLoading) return;
            lastPlayerMessage.current = text;
            const nextMessages = [...messagesRef.current, { role: "user", speaker: playerCountry, text, time: gameDate }];
            pushMessages(nextMessages);
            setPlayerInput("");
            const queue = await buildResponsiveQueue(nextMessages);
            // Who was asked, and in what order. A group chat sends the same
            // message to each leader in turn, so "France answered as if it had
            // heard Prussia's reply" is a question about this order — and the
            // order is chosen by a model call (chooseNextDiplomaticSpeaker) that
            // can quietly fall back to plain rotation.
            logDebugEvent("diplomacy",
                `Player sent in chat #${chat.id}; reply order: ${queue.map((country) => country.name).join(" → ") || "(nobody)"}.`,
                undefined, { verbose: true });
            if (queue.length === 0) {
                pushMessages([...nextMessages, { role: "error", speaker: "System", text: "This chat has no valid participants.", time: gameDate }]);
                return;
            }
            if (isGroup) {
                // At most three NPC replies to one player message; the rotation
                // ends at the player's own slot as it always did.
                offerNextCountry(queue.filter((country) => !isPlayerCountry(country)).slice(0, MAX_GROUP_NPC_RESPONSES_PER_PLAYER_MESSAGE));
            } else {
                await fetchLeaderResponse(queue[0], text, []);
            }
        };

        // Re-sends the message that failed. The error bubble is dropped first so
        // a successful retry leaves the thread reading as if nothing went wrong;
        // a second failure just pushes a fresh one. sendDiplomaticMessage already
        // rolls its own history back on error, so the model sees no duplicate.
        const handleRetry = async (index) => {
            if (isLoading) return;
            const retry = messagesRef.current[index]?.retry;
            if (!retry) return;
            logDebugEvent("diplomacy", `Retrying ${retry.country?.name || "a leader"}'s reply in chat #${chat.id}.`, undefined, { verbose: true });
            pushMessages(messagesRef.current.filter((_, i) => i !== index));
            setPendingCountry(null);
            setRemainingQueue([]);
            setPhase("player");
            nextSpeakerIdx.current = retry.speakerIdx ?? nextSpeakerIdx.current;
            lastPlayerMessage.current = retry.playerMessage;
            await fetchLeaderResponse(retry.country, retry.playerMessage, retry.queue ?? []);
        };

        const handleSpeakInstead = () => {
            setPendingCountry(null);
            setRemainingQueue([]);
            setPhase("player");
        };

        const handleLetSpeak = async () => {
            const country = pendingCountry;
            const rest    = remainingQueue;
            setPendingCountry(null);
            setRemainingQueue([]);
            await fetchLeaderResponse(country, lastPlayerMessage.current, rest);
        };

        const typingSpeaker = speakingCountry ?? countries[0];
        const visibleMessages = messages.length > visibleMessageLimit
            ? messages.slice(messages.length - visibleMessageLimit)
            : messages;
        const hiddenMessageCount = messages.length - visibleMessages.length;

        return (
            <>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.85rem 1rem", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
            <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", display: "flex", padding: "0.2rem", borderRadius: "6px" }}
            onMouseEnter={e => { e.currentTarget.style.color = "white"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.6)"; e.currentTarget.style.background = "none"; }}>
            <BackIcon />
            </button>
            <span style={{ flex: 1, fontWeight: 700, fontSize: "0.95rem", color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Chat with {countries.map(c => c.name).join(", ") || "unknown participant"}
            </span>
            <button onClick={() => onToggleRead?.()}
            title={unread ? "Mark as read" : "Mark as unread"}
            aria-label={unread ? "Mark as read" : "Mark as unread"}
            style={{ display: "flex", alignItems: "center", background: "none", border: "1px solid transparent", cursor: "pointer", color: "rgba(96,165,250,0.75)", padding: "0.25rem", borderRadius: "6px", lineHeight: 1 }}
            onMouseEnter={e => { e.currentTarget.style.color = "rgba(96,165,250,1)"; e.currentTarget.style.background = "rgba(96,165,250,0.12)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "rgba(96,165,250,0.75)"; e.currentTarget.style.background = "none"; }}>
            <EnvelopeIcon filled={unread} />
            </button>
            {/* Two-step, same as the list row: one click arms, the next confirms. */}
            <button title={confirmingDelete ? "Click again to delete this chat" : "Delete chat"}
            aria-label={confirmingDelete ? "Confirm deleting this chat" : "Delete chat"}
            onClick={() => { if (confirmingDelete) { onDelete?.(); } else { setConfirmingDelete(true); } }}
            onBlur={() => setConfirmingDelete(false)}
            style={{ display: "flex", alignItems: "center", gap: "0.3rem", background: confirmingDelete ? "rgba(239,68,68,0.18)" : "none", border: `1px solid ${confirmingDelete ? "rgba(239,68,68,0.55)" : "transparent"}`, cursor: "pointer", color: confirmingDelete ? "#fca5a5" : "rgba(239,68,68,0.65)", fontSize: "0.72rem", fontWeight: 600, fontFamily: "sans-serif", padding: confirmingDelete ? "0.25rem 0.5rem" : "0.25rem", borderRadius: "6px", lineHeight: 1 }}
            onMouseEnter={e => { if (!confirmingDelete) { e.currentTarget.style.color = "rgba(239,68,68,1)"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; } }}
            onMouseLeave={e => { if (!confirmingDelete) { e.currentTarget.style.color = "rgba(239,68,68,0.65)"; e.currentTarget.style.background = "none"; } }}>
            {confirmingDelete ? "Delete?" : <TrashIcon />}
            </button>
            <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.45)", fontSize: "1rem", lineHeight: 1, padding: "0.25rem 0.3rem", borderRadius: "6px" }}
            onMouseEnter={e => { e.currentTarget.style.color = "white"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.45)"; e.currentTarget.style.background = "none"; }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", overflowX: "visible", scrollbarWidth: "none", padding: "0.75rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            {messages.length === 0 && !isLoading && (
                <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.35)", fontStyle: "italic", textAlign: "center", marginTop: "2rem" }}>
                Begin the diplomatic conversation.
                </p>
            )}
            {hiddenMessageCount > 0 && (
                <button
                    type="button"
                    onClick={() => setVisibleMessageLimit((current) => current + CHAT_RENDER_WINDOW_STEP)}
                    style={{
                        alignSelf: "center",
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.09)",
                        borderRadius: "999px",
                        color: "rgba(255,255,255,0.58)",
                        cursor: "pointer",
                        fontSize: "0.68rem",
                        padding: "0.35rem 0.65rem",
                    }}
                >
                    Show {Math.min(hiddenMessageCount, CHAT_RENDER_WINDOW_STEP)} earlier message{Math.min(hiddenMessageCount, CHAT_RENDER_WINDOW_STEP) === 1 ? "" : "s"} ({hiddenMessageCount} hidden)
                </button>
            )}
            {/* Retry is offered on the last message only: an older error has
                already been answered past, and re-running it would splice a
                reply into the middle of the thread. A date separator opens
                every new game day. */}
            {visibleMessages.map((msg, i) => {
                const index = hiddenMessageCount + i;
                const dateKey = chatDateKey(msg?.time);
                const showDateSeparator = Boolean(dateKey) && (i === 0 || dateKey !== chatDateKey(visibleMessages[i - 1]?.time));
                return (
                    <React.Fragment key={index}>
                    {showDateSeparator && <ChatDateSeparator value={msg.time} />}
                    <MessageBubble msg={msg} chatCountries={countries}
                    onRetry={msg.retry && !isLoading && index === messages.length - 1 ? () => handleRetry(index) : undefined} />
                    </React.Fragment>
                );
            })}
            {isLoading && typingSpeaker && <TypingBubble speaker={typingSpeaker.name} code={typingSpeaker.code} />}
            <div ref={messagesEndRef} />
            </div>

            {phase === "pending" && !isLoading && pendingCountry ? (
                <div style={{ padding: "0.75rem 1rem 0.9rem", borderTop: "1px solid rgba(255,255,255,0.07)", backgroundColor: "rgba(0,0,0,0.15)", flexShrink: 0 }}>
                <p style={{ margin: "0 0 0.55rem 0", fontSize: "0.78rem", color: "rgba(255,255,255,0.35)", textAlign: "center" }}>
                <CountryTurnLabel country={pendingCountry} remaining={remainingQueue.length} />
                </p>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                onClick={handleSpeakInstead}
                style={{ flex: 1, padding: "0.58rem 0.7rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.8)", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", fontFamily: "sans-serif", transition: "all 0.12s ease" }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.11)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; }}
                >Speak</button>
                <button
                onClick={handleLetSpeak}
                style={{ flex: 2, padding: "0.58rem 0.7rem", borderRadius: "10px", border: "1px solid rgba(139,92,246,0.3)", background: "rgba(139,92,246,0.12)", color: "rgba(255,255,255,0.88)", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", fontFamily: "sans-serif", transition: "all 0.12s ease" }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(139,92,246,0.24)"; e.currentTarget.style.borderColor = "rgba(139,92,246,0.55)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(139,92,246,0.12)"; e.currentTarget.style.borderColor = "rgba(139,92,246,0.3)"; }}
                >Let {pendingCountry.name} speak →</button>
                </div>
                </div>
            ) : phase === "player" && !isLoading ? (
                <div style={{ padding: "1rem", borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                <textarea
                ref={composerRef}
                placeholder="Send a diplomatic message…"
                rows={1} value={playerInput}
                onChange={e => setPlayerInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handlePlayerSubmit(); } }}
                onInput={fitComposer}
                style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "10px", color: "white", fontSize: "0.875rem", padding: "0.6rem 0.75rem", resize: "none", outline: "none", fontFamily: "sans-serif", lineHeight: "1.5", maxHeight: "12rem", overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.22) transparent", transition: "border-color 0.2s" }}
                onFocus={e => e.target.style.borderColor = "rgba(59,130,246,0.6)"}
                onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.15)"}
                />
                <button onClick={handlePlayerSubmit} disabled={!playerInput.trim()}
                style={{ backgroundColor: playerInput.trim() ? "#3b82f6" : "rgba(59,130,246,0.3)", border: "none", borderRadius: "10px", width: "2.5rem", height: "2.5rem", display: "flex", alignItems: "center", justifyContent: "center", cursor: playerInput.trim() ? "pointer" : "not-allowed", flexShrink: 0, fontSize: "1rem", transition: "background-color 0.2s" }}
                onMouseEnter={e => { if (playerInput.trim()) e.currentTarget.style.backgroundColor = "#2563eb"; }}
                onMouseLeave={e => { if (playerInput.trim()) e.currentTarget.style.backgroundColor = "#3b82f6"; }}
                >🚀</button>
                </div>
            ) : null}
            </>
        );
};

const CountryTurnLabel = ({ country, remaining }) => {
    const flagUrl = useCountryFlagUrl({ code: country.code, name: country.name });
    return (
        <>
        <FlagImg url={flagUrl} alt={country.name} size="0.95em" /> <strong style={{ color: "rgba(255,255,255,0.65)", fontWeight: 600 }}>{country.name}</strong> would like to respond
        {remaining > 0 && <span style={{ color: "rgba(255,255,255,0.22)" }}> · {remaining} more after</span>}
        </>
    );
};

// ── Conversation date separators ────────────────────────────────────────────

const chatDateKey = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const isoDay = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    return isoDay || raw;
};

const formatChatDateLabel = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    // Bare YYYY-MM-DD parses as UTC in browsers, which can shift a displayed day in
    // some time zones. Noon-local keeps an in-game calendar date exactly on that day.
    const isoDay = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const parsed = isoDay
        ? new Date(Number(isoDay[1]), Number(isoDay[2]) - 1, Number(isoDay[3]), 12, 0, 0)
        : new Date(raw);

    return Number.isNaN(parsed.getTime())
        ? raw
        : parsed.toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" });
};

const ChatDateSeparator = ({ value }) => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", margin: "0.15rem 0 0.05rem" }}>
        <div style={{ height: "1px", flex: 1, background: "rgba(255,255,255,0.08)" }} />
        <span style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.32)", whiteSpace: "nowrap", fontWeight: 600 }}>
            {formatChatDateLabel(value)}
        </span>
        <div style={{ height: "1px", flex: 1, background: "rgba(255,255,255,0.08)" }} />
    </div>
);

// A long thread renders its recent tail first; older messages come in on demand.
const CHAT_INITIAL_RENDER_WINDOW = 12;
const CHAT_RENDER_WINDOW_STEP = 40;
// A group chat takes at most this many NPC replies to one player message; the
// floor then returns to the player rather than letting a six-way table monologue.
const MAX_GROUP_NPC_RESPONSES_PER_PLAYER_MESSAGE = 3;

// ── Incoming diplomacy notifications ──────────────────────────────────────────
//
// The toolbar already performs a cheap stored-chat poll for its unread badge.
// The notifications reuse THAT SAME watcher for toasts/sound/center updates;
// there is no second polling loop and no AI/network work beyond the existing
// chat-state read.
//
// Message fingerprints intentionally exclude mutable speaker display names. A
// mid-campaign polity rename or identity reconciliation therefore cannot make an
// old message look newly arrived merely because "Austrian Empire" became
// "Austria-Hungary".
const NOTIFICATION_CURSOR_KEY = "oh:chat-notification-cursors-v2";
const NOTIFICATION_SOUND_KEY = "oh:chat-notification-sound-v1";
const MAX_NOTIFICATION_ITEMS = 40;
const ACTIVE_REPLY_GRACE_MS = 15000;

// Shared floating-UI spacing. The toast is anchored immediately LEFT of the
// native top-right date/turn control rather than to a fixed screen corner.
const FLOATING_UI_EDGE_GAP = "0.75rem";

// Event-driven, with a slow safety interval (see the toolbar watcher).
const NOTIFICATION_VISIBLE_POLL_MS = 0; // event-driven; external safety runs on tab return
const NOTIFICATION_HIDDEN_POLL_MS = 0; // event-driven

let activeDiplomaticChatId = "";
let notificationAudioContext = null;
const recentOutgoingByChat = new Map();

// Fingerprint only the immutable-ish tail fields needed to detect an in-place
// replacement. Speaker display names / polity identity metadata are excluded so
// renames and reconciliation cannot make an old message appear newly arrived.
const notificationTailFingerprint = (message) => [
    String(message?.role ?? "").trim(),
    String(message?.time ?? message?.date ?? message?.timestamp ?? "").trim(),
    String(message?.text ?? message?.content ?? message?.message ?? "").trim(),
].join("\u001e");

const notificationCursorForChat = (chat) => {
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    return {
        count: messages.length,
        tail: messages.length ? notificationTailFingerprint(messages.at(-1)) : "",
    };
};

const notificationCursorSnapshot = (chats) => Object.fromEntries(
    (Array.isArray(chats) ? chats : []).map((chat) => [
        String(chat?.id ?? ""),
        notificationCursorForChat(chat),
    ]),
);

// One baseline per save: the ids of another save's threads must never be
// read as this save's, whether after an in-app switch or a reload after one.
const notificationCursorStorageKey = () => {
    const gameId = String(getLibraryState()?.activeGameId || "").trim();
    return gameId ? `${NOTIFICATION_CURSOR_KEY}:${gameId}` : NOTIFICATION_CURSOR_KEY;
};

const readNotificationCursors = () => {
    try {
        const raw = localStorage.getItem(notificationCursorStorageKey());
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : null;
    } catch {
        return null;
    }
};

const writeNotificationCursors = (cursors) => {
    try {
        localStorage.setItem(notificationCursorStorageKey(), JSON.stringify(cursors || {}));
    } catch { /* private mode / quota */ }
};

const readNotificationSoundEnabled = () => {
    try {
        const raw = localStorage.getItem(NOTIFICATION_SOUND_KEY);
        return raw == null ? true : raw !== "0";
    } catch {
        return true;
    }
};

const writeNotificationSoundEnabled = (enabled) => {
    try { localStorage.setItem(NOTIFICATION_SOUND_KEY, enabled ? "1" : "0"); } catch { /* noop */ }
};

const ensureNotificationAudioContext = () => {
    if (typeof window === "undefined") return null;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;

    if (!notificationAudioContext || notificationAudioContext.state === "closed") {
        try {
            notificationAudioContext = new AudioCtor();
        } catch {
            return null;
        }
    }

    if (notificationAudioContext.state === "suspended") {
        notificationAudioContext.resume().catch(() => {});
    }
    return notificationAudioContext;
};

const playDiplomaticNotificationSound = () => {
    const ctx = ensureNotificationAudioContext();
    if (!ctx || ctx.state !== "running") return false;

    try {
        const now = ctx.currentTime;
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, now);
        master.gain.exponentialRampToValueAtTime(0.028, now + 0.008);
        master.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
        master.connect(ctx.destination);

        for (const note of [
            { frequency: 740, delay: 0.000, duration: 0.115 },
            { frequency: 988, delay: 0.082, duration: 0.145 },
        ]) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const start = now + note.delay;
            const stop = start + note.duration;

            osc.type = "sine";
            osc.frequency.setValueAtTime(note.frequency, start);
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.72, start + 0.006);
            gain.gain.exponentialRampToValueAtTime(0.0001, stop);
            osc.connect(gain);
            gain.connect(master);
            osc.start(start);
            osc.stop(stop + 0.01);
        }
        return true;
    } catch {
        return false;
    }
};

const recordRecentDiplomaticOutgoing = (chatId) => {
    if (chatId == null) return;
    recentOutgoingByChat.set(String(chatId), Date.now());
};

const notificationPreview = (message) => {
    const body = String(message?.text ?? message?.content ?? message?.message ?? "")
        .replace(/\*\*/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!body) return "New diplomatic message received.";
    return body.length <= 180 ? body : `${body.slice(0, 177)}…`;
};

const foreignChatSender = (chat, message) =>
    String(message?.speaker || chat?.countries?.[0]?.name || "Diplomatic message").trim();

const isIncomingDiplomaticMessage = (message) => {
    const role = String(message?.role ?? "").trim().toLowerCase();
    return role === "leader" || role === "assistant" || role === "npc";
};


// ── Unread tracking ───────────────────────────────────────────────────────────

// Message totals per chat as of the last time the panel was open. Module-level
// AND persisted because two separate components need the SAME baseline: the
// toolbar's unread badge and the panel's chat list. It used to be a useRef
// inside the toolbar button, so the list could not read it and every remount
// silently reset it.
const SEEN_KEY = "oh:chat-seen";

// null (not {}) when nothing has ever been recorded — the two cases differ: no
// baseline at all means "first run, don't shout about chats that were already
// there", while an empty baseline means every chat really is new.
const readSeen = () => {
    try {
        const raw = localStorage.getItem(SEEN_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
};

const writeSeen = (totals) => {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(totals)); } catch { /* private mode / quota */ }
};

const chatMessageCount = (chat) => chat?.messages?.length ?? 0;
const seenTotals = (list) => Object.fromEntries(list.map((c) => [String(c.id), chatMessageCount(c)]));

// Unread = more messages than when the panel was last open. A chat with no entry
// is unread (that is how a brand-new conversation surfaces) — but only once a
// baseline exists, so a first run doesn't light up every existing chat.
const isChatUnread = (chat, seen) => {
    if (!seen) return false;
    const prev = seen[String(chat.id)];
    return prev === undefined || chatMessageCount(chat) > prev;
};

// ── Ordering & date grouping ──────────────────────────────────────────────────
// Sorted purely by last-message recency (a brand-new, still-empty chat counts
// as the most recent — the player just opened it) rather than pinning unread
// ones to the top: recency already surfaces anything newly active, and this
// way the list reads as one clean timeline instead of two competing orders.
// The unread dot/bold on each row (ChatListItem) is what still marks "new".

// Walks BACKWARD from the last message to the first usable `time` — not just
// the very last message. AI-opened chats used to leave their opener's `time`
// blank (fixed in gameplay.js's foldGeneratedChatsIntoStorage, but that fix
// only stops NEW blanks; every chat already saved with one needs this to
// self-heal), and a one-sided note the player never replied to has no OTHER
// message to fall back on if only the last one were checked.
const chatLastMessageTime = (chat) => {
    const messages = chat.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const raw = messages[i]?.time;
        if (!raw) continue;
        const ms = new Date(raw).getTime();
        if (Number.isFinite(ms)) return ms;
    }
    return null;
};

// The label a chat's row groups under — the in-game date of its most recent
// TIMED message (not the real-world calendar day, which would be meaningless
// against a historical or alt-history timeline). "New" is reserved for a chat
// with literally no messages yet; one with messages but no usable date at all
// (every one blank/unparseable) falls back to "Undated" rather than being
// mistaken for a chat that was just opened. Chats sharing a label render under
// one header, in the order sortChatsByRecency already put them in.
const chatGroupLabel = (chat) => {
    if (!chat.messages?.length) return "New";
    const ms = chatLastMessageTime(chat);
    return ms === null
        ? "Undated"
        : new Date(ms).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" });
};

// A brand-new, still-empty chat ("New") and a chat with real messages that
// just happen to carry no usable date ("Undated") both resolve to `null` from
// chatLastMessageTime — but they don't belong in the same spot: "New" is
// current (the player just opened it) and belongs at the top, "Undated" is
// unknown-age history and belongs at the bottom, not floated above chats that
// DO have a real, recent date.
const chatSortKey = (chat) => {
    if (!chat.messages?.length) return "new";
    const ms = chatLastMessageTime(chat);
    return ms === null ? "undated" : ms;
};

const sortChatsByRecency = (list) => [...list].sort((a, b) => {
    const ka = chatSortKey(a);
    const kb = chatSortKey(b);
    if (ka === "new") return kb === "new" ? 0 : -1;
    if (kb === "new") return 1;
    if (ka === "undated") return kb === "undated" ? 0 : 1;
    if (kb === "undated") return -1;
    return kb - ka; // both dated — most recent message first
});

// Clusters an already-ordered list into {label, chats[]} runs — consecutive
// same-label chats become one section rather than repeating the header per row.
const groupChatsByDate = (orderedList) => {
    const groups = [];
    for (const chat of orderedList) {
        const label = chatGroupLabel(chat);
        const current = groups[groups.length - 1];
        if (current && current.label === label) current.chats.push(chat);
        else groups.push({ label, chats: [chat] });
    }
    return groups;
};

const ChatGroupHeader = ({ label }) => (
    <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.05em", margin: "0.7rem 0 0.15rem", padding: "0 0.15rem", textTransform: "uppercase" }}>
    {label}
    </div>
);

// Sits above the chat list while isChatGenerationLikely() is true — i.e. while
// the idle poll is actually asking whether a polity would send a note, and only
// then. It is the visible half of "before the chat is generated": a note that's
// about to exist doesn't read as a stuck panel while the player is looking right
// at an empty list. A turn simulation or an advisor exchange no longer trips it;
// those merely COULD produce a chat, and saying so for the length of every jump
// made the indicator meaningless.
const GeneratingBanner = () => (
    <div style={{ alignItems: "center", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.3)", borderRadius: "10px", display: "flex", gap: "0.55rem", padding: "0.6rem 0.8rem" }}>
    <span style={{ flexShrink: 0, fontSize: "1rem" }}>🖊</span>
    <span style={{ color: "rgba(216,196,255,0.9)", fontSize: "0.78rem", fontWeight: 600 }}>
    Diplomacy in progress<PulsingDots /><span style={{ color: "rgba(255,255,255,0.4)", fontWeight: 400 }}> — a country may be reaching out</span>
    </span>
    </div>
);

// ── Chat list item ────────────────────────────────────────────────────────────

const ChatListItem = ({ chat, onClick, onDelete, onToggleRead, unread = false }) => {
    const [hovered, setHovered] = React.useState(false);
    // Deleting a chat is not undoable, so the bin arms first and deletes on the
    // second click. Resets whenever the pointer leaves the row, so a half-pressed
    // delete never sits waiting to catch a later click.
    const [confirming, setConfirming] = React.useState(false);
    const previewCountries = chat.countries.slice(0, 4);
    const flagUrlMap = useCountryFlagUrls(previewCountries);
    const names    = chat.countries.map(c => c.name).join(", ");
    const lastMsg  = chat.messages?.at(-1);
    const preview  = lastMsg ? lastMsg.text.replace(/\*\*/g, "").slice(0, 60) + (lastMsg.text.length > 60 ? "…" : "") : "No messages yet";

    return (
        <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => { setHovered(false); setConfirming(false); }} style={{ position: "relative" }}>
        <button onClick={onClick} style={{ width: "100%", padding: "0.7rem 0.9rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.07)", background: hovered ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)", display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer", transition: "background 0.15s", fontFamily: "sans-serif", textAlign: "left" }}>
        {/* Fixed-width slot, always rendered, so read and unread rows stay aligned. */}
        <div style={{ width: "0.5rem", flexShrink: 0, display: "flex", justifyContent: "center" }} aria-hidden="true">
        {unread && <div style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: "#60a5fa" }} />}
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, paddingRight: previewCountries.length > 1 ? "0.35rem" : 0 }}>
        {previewCountries.map((c, index) => (
            <span key={c.name} style={{ display: "inline-flex", marginLeft: index === 0 ? 0 : "-0.35rem", zIndex: previewCountries.length - index }}>
            <FlagImg url={flagUrlMap[c.name] ?? null} alt={c.name} width="1.3rem" height="0.9rem" />
            </span>
        ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "0.82rem", fontWeight: unread ? 700 : 600, color: unread ? "#fff" : "rgba(255,255,255,0.9)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{names}{unread && <span style={{ fontWeight: 400, fontSize: "0.7rem", color: "#60a5fa", marginLeft: "0.4rem" }}>new</span>}</div>
        <div style={{ fontSize: "0.75rem", color: unread ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.35)", marginTop: "0.15rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{preview}</div>
        </div>
        </button>
        {hovered && (
            <div style={{ position: "absolute", top: "50%", right: "0.6rem", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: "0.3rem" }}>
            <button onClick={e => { e.stopPropagation(); onToggleRead?.(); }}
            title={unread ? "Mark as read" : "Mark as unread"}
            aria-label={unread ? "Mark as read" : "Mark as unread"}
            style={{ display: "flex", alignItems: "center", background: "none", border: "1px solid transparent", cursor: "pointer", color: "rgba(96,165,250,0.75)", padding: "0.25rem", borderRadius: "6px", lineHeight: 1 }}
            onMouseEnter={e => { e.currentTarget.style.color = "rgba(96,165,250,1)"; e.currentTarget.style.background = "rgba(96,165,250,0.12)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "rgba(96,165,250,0.75)"; e.currentTarget.style.background = "none"; }}>
            <EnvelopeIcon filled={unread} /></button>
            <button onClick={e => { e.stopPropagation(); if (confirming) { onDelete(); } else { setConfirming(true); } }}
            title={confirming ? "Click again to delete this chat" : "Delete chat"}
            aria-label={confirming ? "Confirm deleting this chat" : "Delete chat"}
            style={{ display: "flex", alignItems: "center", gap: "0.3rem", background: confirming ? "rgba(239,68,68,0.18)" : "none", border: `1px solid ${confirming ? "rgba(239,68,68,0.55)" : "transparent"}`, cursor: "pointer", color: confirming ? "#fca5a5" : "rgba(239,68,68,0.7)", fontSize: "0.72rem", fontWeight: 600, fontFamily: "sans-serif", padding: confirming ? "0.25rem 0.5rem" : "0.25rem", borderRadius: "6px", lineHeight: 1 }}
            onMouseEnter={e => { if (!confirming) { e.currentTarget.style.color = "rgba(239,68,68,1)"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; } }}
            onMouseLeave={e => { if (!confirming) { e.currentTarget.style.color = "rgba(239,68,68,0.7)"; e.currentTarget.style.background = "none"; } }}>
            {confirming ? "Delete?" : <TrashIcon />}</button>
            </div>
        )}
        </div>
    );
};

// ── Main ChatPanel ────────────────────────────────────────────────────────────

// Bridge so the map region popup can request a diplomatic chat with a country —
// and so the advisor can hand one a letter it drafted, which lands in the
// composer for the player to read over and send themselves. Nothing here sends
// anything: `draft` is text in a textarea until the player presses the button.
const _chatOpenSubs = new Set();
export const requestDiplomaticChat = (country, { draft = "" } = {}) => {
    if (!country || !country.name) return;
    _chatOpenSubs.forEach((fn) => { try { fn(country, draft); } catch { /* noop */ } });
};

// ---- Spy tab ----------------------------------------------------------------
// The player's intelligence service. Plant a spy in a polity and its private
// diplomacy with third parties shows up here as intercepts — redacted word by
// word, with the player's intelligence stat against the target's deciding how
// much survives. The AI moves that stat like reputation (polityChanges), so a
// player who builds the service up reads more of the SAME intercepts: redaction
// is applied at render time, never baked into what was stored.

const spyBtn = (accent) => ({
    padding: "0.35rem 0.6rem", borderRadius: "8px", fontSize: "0.72rem", fontWeight: 600, cursor: "pointer", fontFamily: "sans-serif",
    border: "1px solid " + (accent ? "rgba(167,139,250,0.45)" : "rgba(255,255,255,0.12)"),
    background: accent ? "rgba(139,92,246,0.22)" : "rgba(255,255,255,0.06)", color: accent ? "#e9d5ff" : "rgba(255,255,255,0.8)",
});

const ClarityMeter = ({ clarity }) => {
    const pct = Math.round(clarity * 100);
    return (
        <div title="How much of the intercept your service could decode">
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "rgba(255,255,255,0.5)", marginBottom: "0.2rem" }}>
        <span>Signal clarity</span><span data-no-translate style={{ color: "#c4b5fd", fontWeight: 700 }}>{pct}%</span>
        </div>
        <div style={{ height: "0.3rem", borderRadius: "999px", background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: "linear-gradient(90deg,#7c3aed,#c4b5fd)" }} />
        </div>
        </div>
    );
};

const InterceptView = ({ target, exchange, clarity, seal, onBack }) => {
    const [opened, setOpened] = useState(null);
    useEffect(() => {
        let live = true;
        // No seal (a record from before sealing) reads as-is; otherwise open it here
        // and nowhere else. The plaintext lives in this component's state only for
        // as long as the view is on screen.
        (isSeal(seal) ? openExchange(seal, exchange) : Promise.resolve(exchange))
            .then((value) => { if (live) setOpened(value); })
            .catch(() => { if (live) setOpened(exchange); });
        return () => { live = false; };
    }, [exchange, seal]);
    const shown = useMemo(() => redactExchange(opened ?? { ...exchange, messages: [] }, clarity), [opened, exchange, clarity]);
    return (
        <>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.85rem 1rem 0.6rem", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
        <button onClick={onBack} aria-label="Back" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", padding: "0.2rem", display: "flex" }}><BackIcon /></button>
        <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: "0.9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>🕵 {target} ↔ {exchange.counterpart}</div>
        <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.5)" }}>{exchange.subject}{exchange.date ? " · " + exchange.date : ""}</div>
        </div>
        </div>
        <div style={{ padding: "0.6rem 1rem 0.2rem", flexShrink: 0 }}><ClarityMeter clarity={clarity} /></div>
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "0.6rem 1rem 1rem", display: "flex", flexDirection: "column", gap: "0.55rem" }}>
        {shown.messages.map((message, index) => {
            const mine = message.speaker === target;
            return (
                <div key={index} style={{ alignSelf: mine ? "flex-start" : "flex-end", maxWidth: "88%" }}>
                <div style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.45)", marginBottom: "0.15rem", textAlign: mine ? "left" : "right" }}>{message.speaker}</div>
                <div data-no-translate style={{ padding: "0.55rem 0.75rem", borderRadius: "12px", fontSize: "0.82rem", lineHeight: 1.45, fontFamily: "ui-monospace, Consolas, monospace", letterSpacing: "0.01em", userSelect: "none",
                    background: mine ? "rgba(139,92,246,0.18)" : "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.08)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {message.text}
                </div>
                </div>
            );
        })}
        <div style={{ fontSize: "0.66rem", color: "rgba(255,255,255,0.35)", fontStyle: "italic", marginTop: "0.4rem", textAlign: "center" }}>
        Improve your intelligence service to decode more of this exchange.
        </div>
        </div>
        </>
    );
};

const SpyView = ({ playerCountry, gameDate, countries, loadingCountries }) => {
    const [world, setWorld]           = useState(null);
    const [intercepts, setIntercepts] = useState({});
    const [open, setOpen]             = useState(null); // { target, exchange }
    const [choosing, setChoosing]     = useState(false);
    const [error, setError]           = useState("");

    const refresh = async () => {
        try {
            const [w, i] = await Promise.all([readWorldState({ force: true }), readInterceptsState({ force: true })]);
            setWorld(w); setIntercepts(normalizeIntercepts(i));
        } catch { /* keep what we have */ }
    };
    useEffect(() => { refresh(); const iv = setInterval(refresh, 5000); return () => clearInterval(iv); }, []);
    // Opening the tab is the first time most players meet their own service, and
    // sending an agent the first time they meet another's: each gets its stat
    // sheet and a first intelligence reading then (gameplay.js ensureCountryAssessed)
    // instead of every service sitting on the same "ordinary" default.
    useEffect(() => { void ensureCountryAssessed(playerCountry, { reason: "spies tab" }); }, [playerCountry]);

    const myIntel = intelligenceOf(world, playerCountry);
    // Pre-ownership records (no owner) were all the player's.
    const spies = activeSpies(world).filter((spy) => !spy.owner || spy.owner === playerCountry);
    const foreign = foreignSpies(world, playerCountry);
    const history = normalizeSpies(world?.spies).filter((spy) => (!spy.owner || spy.owner === playerCountry) && spy.status === "exposed").slice(-3);
    const [storyDraft, setStoryDraft] = useState({}); // spy id -> cover story being typed

    const commitSpies = async (next) => {
        // Re-read at write time so a jump's world write is never clobbered with
        // the copy this tab happened to load earlier. The seal is minted here, on
        // the first deployment, so every report ever stored has one to be sealed
        // under.
        const fresh = await readWorldState({ force: true });
        const committed = { ...fresh, spies: next, spySeal: isSeal(fresh?.spySeal) ? fresh.spySeal : newSeal() };
        // Open (or close) the covert operation on the Projects board in the same
        // write, so deploying an agent shows up there immediately instead of on
        // the next jump. The turn does the same sync for the agents espionage
        // itself moves — both call spyOperationOps, so they cannot disagree.
        const ops = spyOperationOps(next, committed.projects, { date: gameDate, playerPolity: playerCountry });
        const toWrite = ops.length
            ? applyProjectOpsToWorld({
                date: gameDate,
                ops,
                playerCountry,
                world: committed,
            }).world
            : committed;
        await writeWorldState(toWrite);
        await refresh();
    };

    const handleExpel = async (spy) => {
        setError("");
        try { await commitSpies(expelSpy(world, spy.id, { date: gameDate })); void ensureCountryAssessed(spy.owner, { reason: "foreign agent expelled" }); } catch (err) { setError(err?.message || String(err)); }
    };
    const handleTurn = async (spy) => {
        setError("");
        try { await commitSpies(turnSpy(world, spy.id, { date: gameDate, coverStory: storyDraft[spy.id] || "" })); void ensureCountryAssessed(spy.owner, { reason: "foreign agent turned" }); } catch (err) { setError(err?.message || String(err)); }
    };
    const handleStory = async (spy) => {
        setError("");
        try { await commitSpies(setCoverStory(world, spy.id, storyDraft[spy.id] ?? spy.coverStory)); } catch (err) { setError(err?.message || String(err)); }
    };

    const handleDeploy = async (selected) => {
        setChoosing(false); setError("");
        const target = selected?.[0]?.name;
        try {
            const next = deploySpy(world, target, { date: gameDate, playerPolity: playerCountry });
            await commitSpies(next);
            void ensureCountryAssessed(target, { reason: "agent deployed" });
        } catch (err) { setError(err?.message || String(err)); }
    };

    const handleRecall = async (spy) => {
        setError("");
        try { await commitSpies(recallSpy(world, spy.id)); } catch (err) { setError(err?.message || String(err)); }
    };

    if (open) {
        const clarity = signalClarity(myIntel, intelligenceOf(world, open.target));
        return <InterceptView target={open.target} exchange={open.exchange} clarity={clarity} seal={world?.spySeal} onBack={() => setOpen(null)} />;
    }

    const targets = Object.keys(intercepts);
    const sameCountry = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
    const candidates = countries.filter((c) =>
        !sameCountry(c.name, playerCountry) && !spies.some((s) => sameCountry(s.target, c.name)));
    const storyOf = (spy) => (storyDraft[spy.id] !== undefined ? storyDraft[spy.id] : spy.coverStory);
    const inputStyle = { width: "100%", boxSizing: "border-box", padding: "0.45rem 0.6rem", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)", color: "white", fontSize: "0.76rem", fontFamily: "sans-serif" };
    const full = spies.length >= MAX_ACTIVE_SPIES;

    return (
        <>
        <Presence open={choosing}>
            <CountrySelectorModal
                countries={candidates}
                loading={loadingCountries}
                onStart={handleDeploy}
                onCancel={() => setChoosing(false)}
                single
                title="Deploy a Spy"
                subtitle="Choose the country to plant an agent in"
                selectedLabel="Target"
                emptyLabel="No target chosen yet"
                confirmLabel={(n) => (n === 0 ? "Choose a target" : "Deploy the spy")}
            />
        </Presence>
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.55rem 0.75rem", borderRadius: "10px", background: "rgba(139,92,246,0.12)", border: "1px solid rgba(167,139,250,0.25)" }}>
        <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.7)" }}>🕵 Your intelligence service</span>
        <span data-no-translate style={{ fontSize: "0.85rem", fontWeight: 800, color: "#e9d5ff" }}>{myIntel}/100</span>
        </div>

        <div style={{ fontSize: "0.66rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginTop: "0.2rem" }}>Deployed spies · {spies.length}/{MAX_ACTIVE_SPIES}</div>
        {spies.length === 0 && (
            <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>No spies in the field. Deploy one to read a country's private diplomacy with others.</div>
        )}
        {spies.map((spy) => (
            <div key={spy.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.7rem", borderRadius: "10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {spy.target}{spy.suspected && <span title="Your analysts think this agent's reports are being fed to you" style={{ marginLeft: "0.4rem", color: "#fbbf24", fontSize: "0.7rem" }}>⚠ Possibly compromised</span>}
            </div>
            <div style={{ fontSize: "0.66rem", color: "rgba(255,255,255,0.45)" }}>
            {spy.deployedAt ? "since " + spy.deployedAt : "in place"} · their service {intelligenceOf(world, spy.target)}/100
            </div>
            </div>
            <button onClick={() => handleRecall(spy)} style={spyBtn(false)}>Recall</button>
            </div>
        ))}
        {history.length > 0 && (
            <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.4)", fontStyle: "italic" }}>
            {history.map((spy) => "Agent expelled by " + spy.target + (spy.exposedAt ? " on " + spy.exposedAt : "")).join(" · ")}
            </div>
        )}

        {/* Agents other polities have in the player. An undiscovered one is not
            listed — that is what makes the intelligence stat matter on defence.
            A discovered one waits for a decision; a turned one is fed whatever
            the player types here. */}
        {foreign.filter((spy) => spy.status !== "active").length > 0 && (
            <div style={{ fontSize: "0.66rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginTop: "0.4rem" }}>Foreign agents in {playerCountry}</div>
        )}
        {foreign.filter((spy) => spy.status !== "active").map((spy) => (
            <div key={spy.id} style={{ padding: "0.55rem 0.7rem", borderRadius: "10px", background: spy.status === "discovered" ? "rgba(251,191,36,0.08)" : "rgba(255,255,255,0.04)", border: "1px solid " + (spy.status === "discovered" ? "rgba(251,191,36,0.35)" : "rgba(255,255,255,0.08)") }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>{spy.status === "discovered" ? "🚨 " : "🎭 "}{spy.owner}</div>
            <div style={{ fontSize: "0.66rem", color: "rgba(255,255,255,0.45)" }}>
            {spy.status === "discovered" ? "agent in custody — decide what to do" : "double agent since " + (spy.turnedAt || "capture") + " — " + spy.owner + " still trusts them"}
            </div>
            </div>
            {spy.status === "discovered" && <button onClick={() => handleExpel(spy)} style={spyBtn(false)}>Expel</button>}
            {spy.status === "discovered" && <button onClick={() => handleTurn(spy)} style={spyBtn(true)}>Turn</button>}
            </div>
            {spy.status !== "exposed" && (
                <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <input value={storyOf(spy)} onChange={(e) => setStoryDraft((d) => ({ ...d, [spy.id]: e.target.value }))} placeholder={spy.status === "discovered" ? "Cover story to feed them if turned (optional)" : "What your double agent tells " + spy.owner}
                    style={inputStyle} />
                {spy.status === "turned" && <button onClick={() => handleStory(spy)} style={spyBtn(true)}>Save</button>}
                </div>
            )}
            </div>
        ))}

        {error && <div style={{ fontSize: "0.74rem", color: "#fca5a5", padding: "0.3rem 0.1rem" }}>{error}</div>}

        {targets.length > 0 && (
            <div style={{ fontSize: "0.66rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginTop: "0.4rem" }}>Intercepts</div>
        )}
        {targets.map((target) => intercepts[target].exchanges.map((exchange) => (
            <button key={exchange.id} onClick={() => { setOpen({ target, exchange }); void ensureCountryAssessed(target, { reason: "intercept read" }); }}
                style={{ width: "100%", padding: "0.6rem 0.8rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.03)", display: "flex", alignItems: "center", gap: "0.6rem", cursor: "pointer", fontFamily: "sans-serif", textAlign: "left", color: "white" }}>
            <span aria-hidden="true" style={{ fontSize: "1rem" }}>📡</span>
            <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{target} ↔ {exchange.counterpart}</span>
            <span style={{ display: "block", fontSize: "0.68rem", color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{exchange.subject}{exchange.date ? " · " + exchange.date : ""}</span>
            </span>
            </button>
        )))}
        </div>
        <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
        <button onClick={() => setChoosing(true)} disabled={full}
            style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", border: "1px solid rgba(167,139,250,0.35)", background: "rgba(139,92,246,0.18)", color: "#e9d5ff", fontSize: "0.85rem", fontWeight: 600, cursor: full ? "not-allowed" : "pointer", fontFamily: "sans-serif", opacity: full ? 0.5 : 1 }}>
        🕵 Deploy a spy
        </button>
        </div>
        </>
    );
};

const ChatPanel = ({ isOpen, onClose, requestedCountry, requestedDraft = "", onConsumeRequest, requestedChatId = "", onConsumeRequestedChat, isGenerating = false }) => {
    // "chats" is the diplomacy the player is party to; "spy" is everyone else's.
    const [view, setView] = useState("chats");
    const [countries, setCountries]               = useState([]);
    const [loadingCountries, setLoadingCountries] = useState(true);
    const [playerCountry, setPlayerCountry]       = useState("your nation");
    const [gameDate, setGameDate]                 = useState("");
    const [chats, setChats]                       = useState([]);
    const [activeChat, setActiveChat]             = useState(null);
    const [showSelector, setShowSelector]         = useState(false);
    // A letter the advisor drafted, waiting for the conversation it belongs to to
    // mount. Tied to a chat id so navigating to a DIFFERENT chat never inherits it.
    const [composerDraft, setComposerDraft]       = useState(null);
    const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
    const openChats = chats.filter((chat) => chat.status !== "closed" && Array.isArray(chat.countries) && chat.countries.length > 0);

    // Which chats to flag as unread: seeded from the persisted baseline when the
    // panel OPENS, then only ever added to (arrivals) or cleared per-chat (an
    // actual read) — never wholesale, so a row stays bold until its message is
    // opened. displayOrder freezes at open for a different reason: a background
    // message landing for some OTHER chat must not visibly jump it up the list
    // mid-read. Reopening the panel is what re-sorts.
    const [unreadIds, setUnreadIds] = useState(() => new Set());
    const [displayOrder, setDisplayOrder] = useState([]);
    const snapshotTakenRef = useRef(false);

    // `chats` is only refreshed while the panel is OPEN, so between opens it goes
    // stale — and the toolbar badge polls storage directly, with force. Opening
    // used to snapshot (and write the seen baseline from) that stale list, so a
    // message that had already landed was invisible AND left the baseline behind
    // it: the badge kept saying 1, the list kept showing nothing, and only an
    // open that outlived the 5s poll below caught up. Nothing is decided until
    // the poll's first forced read has landed for this open.
    const [freshSinceOpen, setFreshSinceOpen] = useState(false);

    useEffect(() => {
        if (!isOpen) { snapshotTakenRef.current = false; setFreshSinceOpen(false); return; }
        if (snapshotTakenRef.current || !hasLoadedInitialData || !freshSinceOpen) return;
        snapshotTakenRef.current = true;
        const seen = readSeen();
        if (seen === null) {
            // First look ever: seed the baseline rather than declare every chat
            // that already existed unread. The same seed the toolbar badge does —
            // whichever gets there first wins, and it only ever happens once.
            writeSeen(seenTotals(openChats));
            setUnreadIds(new Set());
        } else {
            setUnreadIds(new Set(openChats.filter((chat) => isChatUnread(chat, seen)).map((chat) => String(chat.id))));
        }
        setDisplayOrder(sortChatsByRecency(openChats).map((chat) => String(chat.id)));
        // Deliberately NOT writing the baseline here. Opening the panel is not
        // reading your mail: seeing a row in a list is not seeing the message.
        // The baseline only advances when a chat is actually opened
        // (setChatReadState, below) or "Mark all read" is clicked, so the badge
        // survives a look at the list and clears only for what was really read.
    }, [isOpen, hasLoadedInitialData, freshSinceOpen, openChats]);

    // A chat that arrives (or gains a message) while the panel sits open still
    // has to show as new — storage is the authority now that the baseline is no
    // longer wiped on open. Union-only, so it never un-flags a row mid-read, and
    // it skips the chat currently on screen, which the effect below marks read.
    useEffect(() => {
        if (!isOpen || !snapshotTakenRef.current) return;
        const seen = readSeen();
        if (!seen) return;
        const activeId = activeChat ? String(activeChat.id) : null;
        const arrived = openChats
            .filter((chat) => String(chat.id) !== activeId && isChatUnread(chat, seen))
            .map((chat) => String(chat.id));
        if (arrived.length === 0) return;
        setUnreadIds((prev) => (arrived.every((id) => prev.has(id)) ? prev : new Set([...prev, ...arrived])));
    }, [isOpen, openChats, activeChat]);

    // Follows the frozen displayOrder — each id's LIVE chat object, so unread
    // status and preview text still update in place — with anything that
    // arrived after the snapshot (an idle-diplomacy note while the panel sat
    // open) prepended rather than silently missing from the list.
    const orderedIds = new Set(displayOrder);
    const orderedChats = [
        ...openChats.filter((chat) => !orderedIds.has(String(chat.id))),
        ...displayOrder.map((id) => openChats.find((chat) => String(chat.id) === id)).filter(Boolean),
    ];

    // Unread filter — resets to off on every fresh open so it never silently
    // hides chats the player forgot they'd filtered down to last time.
    const [showUnreadOnly, setShowUnreadOnly] = useState(false);
    useEffect(() => {
        if (!isOpen) setShowUnreadOnly(false);
    }, [isOpen]);
    const visibleChats = showUnreadOnly
        ? orderedChats.filter((chat) => unreadIds.has(String(chat.id)))
        : orderedChats;
    const groupedChats = groupChatsByDate(visibleChats);

    // Single writer for a chat's read state: updates BOTH the persisted baseline
    // (localStorage, read back on the next panel/toolbar check) and the in-memory
    // `unreadIds` the list is actually rendered from. Writing only the baseline —
    // the old behaviour — left the list row still bold/"new" after being read,
    // because `unreadIds` is a snapshot that nothing else ever mutated; the row
    // only cleared once the panel was closed and reopened, which read as "read
    // doesn't always stick."
    const setChatReadState = (chat, read) => {
        const id = String(chat.id);
        const seen = { ...(readSeen() || {}) };
        if (read) seen[id] = chatMessageCount(chat);
        else delete seen[id]; // absent == unread, same convention isChatUnread already uses
        writeSeen(seen);
        setUnreadIds((prev) => {
            const has = prev.has(id);
            if (has === !read) return prev;
            const next = new Set(prev);
            if (read) next.delete(id); else next.add(id);
            return next;
        });
    };

    // One write instead of N: mostly here as a direct escape hatch if the unread
    // baseline is ever wrong for reasons outside the player's control (a fresh
    // profile/origin with no prior "seen" baseline, a save carried over from
    // somewhere else) — a single click clears it rather than opening every
    // wrongly-flagged chat by hand.
    const markAllRead = () => {
        const seen = { ...(readSeen() || {}) };
        for (const chat of openChats) seen[String(chat.id)] = chatMessageCount(chat);
        writeSeen(seen);
        setUnreadIds(new Set());
    };

    // The id of a chat the player has DELIBERATELY marked unread while reading it
    // — "leave this for later". The auto-mark-read effect below has to stand aside
    // for that, or the gesture is undone by the next message to arrive, which for
    // an open conversation is usually seconds later. Scoped to the chat: leaving
    // it and coming back is a fresh read.
    const [heldUnreadId, setHeldUnreadId] = useState(null);

    // Opening a chat marks it read immediately (list row clears right away, not
    // just in storage). The effect below keeps it marked read for as long as it
    // stays the active chat, so messages that arrive WHILE the player is looking
    // at it (an incoming reply, a background poll merge) don't get left stranded
    // above the last-seen baseline and resurface as unread on the next visit.
    const openChatFromList = (chat) => {
        setActiveChat(chat);
        setHeldUnreadId(null);
        setChatReadState(chat, true);
    };

    // The envelope in the conversation header. Marking the open chat unread has to
    // survive the effect below, so it is remembered here as well as written.
    const toggleActiveChatRead = (chat) => {
        const wasUnread = unreadIds.has(String(chat.id));
        setHeldUnreadId(wasUnread ? null : String(chat.id));
        setChatReadState(chat, wasUnread);
    };

    useEffect(() => {
        if (!activeChat) return;
        if (heldUnreadId === String(activeChat.id)) return;
        setChatReadState(activeChat, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeChat?.id, activeChat?.messages?.length, heldUnreadId]);

    // Leaving a chat ends the hold — the next visit is an ordinary read.
    useEffect(() => {
        if (!activeChat && heldUnreadId) setHeldUnreadId(null);
    }, [activeChat, heldUnreadId]);

    useEffect(() => {
        if (!isOpen || hasLoadedInitialData) return;

        let cancelled = false;
        Promise.all([loadCountryNames(), loadAllChats({ force: true })])
        .then(([countryList, savedChats]) => {
            if (cancelled) return;
            setCountries(countryList);
            setLoadingCountries(false);
            if (savedChats.length > 0) setChats(savedChats);
            setHasLoadedInitialData(true);
        })
        .catch(() => {
            if (!cancelled) {
                setLoadingCountries(false);
                setHasLoadedInitialData(true);
            }
        });

        return () => { cancelled = true; };
    }, [hasLoadedInitialData, isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        let cancelled = false;
        const go = () => readJson(JSON_URLS.game, { defaultValue: {}, force: true })
        .then((data) => {
            if (cancelled) return;
            if (data.country) setPlayerCountry(data.country);
            if (data.gameDate) setGameDate(data.gameDate);
        })
        .catch(() => {});

        go();
        const iv = setInterval(go, 5000);
        return () => {
            cancelled = true;
            clearInterval(iv);
        };
    }, [isOpen]);

    // Chats created OUTSIDE this panel — a jump's diplomatic invitations, the
    // idle outreach drip — used to be invisible until a full page reload (the
    // list loaded exactly once). Poll the stored list while the panel is open
    // and merge additions/updates in; the active conversation object is left
    // alone so an in-flight exchange is never clobbered mid-reply.
    useEffect(() => {
        if (!isOpen || !hasLoadedInitialData) return;

        let cancelled = false;
        const sync = () => loadAllChats({ force: true })
        .then((saved) => {
            if (cancelled) return;
            if (!Array.isArray(saved)) { setFreshSinceOpen(true); return; }
            setChats((prev) => {
                const signature = (list) => list.map((c) => `${c.id}:${c.status}:${c.messages?.length ?? 0}`).join("|");
                if (signature(saved) === signature(prev)) return prev;
                setActiveChat((ac) => {
                    if (!ac) return ac;
                    const updated = saved.find((c) => c.id === ac.id);
                    // Only adopt storage's copy when it has MORE messages (an
                    // outreach note landed); otherwise the in-panel state wins.
                    return updated && (updated.messages?.length ?? 0) > (ac.messages?.length ?? 0) ? updated : ac;
                });
                return saved;
            });
            // Batched with the setChats above, so the snapshot effect first runs
            // against the list this read produced, never the one it replaced.
            setFreshSinceOpen(true);
        })
        // A failed read must not wedge the panel on "waiting for fresh data" —
        // fall back to whatever is in hand and let the next tick try again.
        .catch(() => { if (!cancelled) setFreshSinceOpen(true); });

        // Run now, not in 5s: opening the panel is exactly the moment the list
        // has to be current, and a player who opens and closes inside the
        // interval would otherwise never see a read at all.
        sync();
        const iv = setInterval(sync, 5000);
        return () => {
            cancelled = true;
            clearInterval(iv);
        };
    }, [isOpen, hasLoadedInitialData]);

    const availableCountries = useMemo(
        () => countries.filter(country => !countryMatchesIdentity(country, playerCountry)),
                                       [countries, playerCountry]
    );

    const handleMessagesUpdate = (chatId, newMessages) => {
        if (newMessages?.at(-1)?.role === "user") recordRecentDiplomaticOutgoing(chatId);
        setChats(prev => {
            const updated = prev.map(c => c.id === chatId ? { ...c, messages: newMessages } : c);
            saveAllChats(updated);
            setActiveChat(ac => ac?.id === chatId ? { ...ac, messages: newMessages } : ac);
            return updated;
        });
    };

    const handleStartChat = (selected) => {
        const newChat = { id: Date.now(), countries: selected, messages: [], status: "open" };
        setChats(prev => { const u = [newChat, ...prev]; saveAllChats(u); return u; });
        setShowSelector(false);
        setActiveChat(newChat);
    };

    // Deleting hides the thread from the player; it does NOT erase it. gameplay.js
    // feeds closed chats back to the model as concluded-negotiation history, so
    // dropping the record outright would make the AI act as though the talks never
    // happened. Closing also means the next approach from that country opens a
    // FRESH chat instead of reviving this one — closed chats are excluded from the
    // "already talking to them" lookup.
    //
    // This is what the old Archive button did, so there is no separate archive
    // control any more: two buttons that both close a chat only invited the
    // question of which one really deleted it.
    const handleDeleteChat = (id) => {
        setChats(prev => {
            const updated = prev.map(chat => chat.id === id ? { ...chat, status: "closed" } : chat);
            saveAllChats(updated);
            return updated;
        });
        if (activeChat?.id === id) setActiveChat(null);
    };

    // Open (or reuse) a 1-on-1 chat with a country requested from the region popup
    // or from the advisor, optionally seeding the composer with a drafted letter.
    const consumePending = (country, draftText = "") => {
        setShowSelector(false);
        // The advisor knows a polity by name only; the flag and the nation colour
        // both key off the code, so fill it in from the loaded roster rather than
        // opening a chat wearing the fallback white flag.
        const code = country.code
            || countries.find(c => (c?.name || "").toLowerCase() === country.name.toLowerCase())?.code
            || "";
        setChats(prev => {
            const existing = prev.find(
                c => c.status !== "closed" && Array.isArray(c.countries) && c.countries.length === 1 &&
                     (c.countries[0]?.name || "").toLowerCase() === country.name.toLowerCase(),
            );
            if (existing) {
                setActiveChat(existing);
                if (draftText) setComposerDraft({ chatId: existing.id, text: draftText });
                return prev;
            }
            const newChat = { id: Date.now(), countries: [{ name: country.name, code }], messages: [], status: "open" };
            const u = [newChat, ...prev];
            saveAllChats(u);
            setActiveChat(newChat);
            if (draftText) setComposerDraft({ chatId: newChat.id, text: draftText });
            return u;
        });
    };

    // Waits for the initial load. A request that arrives while the panel is
    // mounting — which is the NORMAL case, since asking for a chat is what opens
    // the panel in the first place — would otherwise run against an empty `chats`
    // array: it would miss the existing conversation with that country, open a
    // duplicate, and then saveAllChats would persist that one chat as the whole
    // list, taking every other conversation with it. hasLoadedInitialData is set
    // on both the success and failure paths above, so this cannot strand a
    // request forever.
    useEffect(() => {
        if (!isOpen || !requestedCountry || !hasLoadedInitialData) return;
        consumePending(requestedCountry, requestedDraft);
        onConsumeRequest?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, requestedCountry, hasLoadedInitialData]);

    // Notification and toast clicks target an existing thread directly. They
    // never synthesize a new chat just to navigate to diplomacy that exists.
    useEffect(() => {
        if (!isOpen || !requestedChatId || !hasLoadedInitialData) return;
        const target = openChats.find((chat) => String(chat.id) === String(requestedChatId));
        if (target) openChatFromList(target);
        onConsumeRequestedChat?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, requestedChatId, hasLoadedInitialData, chats]);

    // Only the conversation on screen is exposed to the toolbar's incoming-message
    // watcher: a reply landing in this exact thread is being read, never toasted.
    const activeChatIdForWatcher = activeChat ? String(activeChat.id) : "";
    useEffect(() => {
        activeDiplomaticChatId = isOpen ? activeChatIdForWatcher : "";
        return () => {
            if (activeDiplomaticChatId === activeChatIdForWatcher) activeDiplomaticChatId = "";
        };
    }, [isOpen, activeChatIdForWatcher]);

        return (
            <>
            <MarkdownStyleInjector />
            <div style={{ position: "fixed", bottom: isOpen ? "4.25rem" : "-40rem", left: "0rem", width: "26.25rem", maxWidth: "calc(100vw - 1rem)", height: "min(calc(100vh - 9rem), max(calc(100vh - 33rem), 30rem))", minHeight: "10rem", backgroundColor: "rgba(24,24,27,0.95)", backdropFilter: "blur(8px)", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "-4px 0 24px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.06)", zIndex: 9998, overflow: "hidden", transition: "bottom 0.35s cubic-bezier(0.4,0,0.2,1),opacity 0.35s ease", opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? "auto" : "none", fontFamily: "sans-serif", color: "white", display: "flex", flexDirection: "column" }}>

            <Presence open={showSelector}><CountrySelectorModal countries={availableCountries} loading={loadingCountries} onStart={handleStartChat} onCancel={() => setShowSelector(false)} /></Presence>

            {activeChat && Array.isArray(activeChat.countries) && activeChat.countries.length > 0 ? (
                <ConversationView chat={activeChat} playerCountry={playerCountry} gameDate={gameDate} onDelete={() => handleDeleteChat(activeChat.id)} onBack={() => setActiveChat(null)} onMessagesUpdate={handleMessagesUpdate}
                unread={unreadIds.has(String(activeChat.id))} onToggleRead={() => toggleActiveChatRead(activeChat)}
                draft={composerDraft?.chatId === activeChat.id ? composerDraft.text : ""}
                onDraftApplied={() => setComposerDraft(null)} />
            ) : (
                <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.25rem 0.75rem", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                <div style={{ display: "flex", gap: "0.35rem" }}>
                {[["chats", "Diplomacy"], ["spy", "Spy"]].map(([key, label]) => (
                    <button key={key} onClick={() => setView(key)} style={{ padding: "0.3rem 0.7rem", borderRadius: "8px", fontSize: "0.85rem", fontWeight: 700, cursor: "pointer", fontFamily: "sans-serif",
                        border: "1px solid " + (view === key ? "rgba(167,139,250,0.45)" : "transparent"), background: view === key ? "rgba(139,92,246,0.22)" : "transparent", color: view === key ? "white" : "rgba(255,255,255,0.5)" }}>
                    {label}
                    </button>
                ))}
                </div>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: "1.1rem", lineHeight: 1, padding: "0.15rem 0.3rem", borderRadius: "6px" }}
                onMouseEnter={e => { e.currentTarget.style.color = "white"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.5)"; e.currentTarget.style.background = "none"; }}>✕</button>
                </div>
                {view === "spy" ? (
                    <SpyView playerCountry={playerCountry} gameDate={gameDate} countries={countries} loadingCountries={loadingCountries} />
                ) : (
                <>
                {/* The unread filter belongs to the diplomacy list only — the Spy
                    tab has no read/unread notion, so it sits inside this branch
                    rather than above the tab switch. */}
                {openChats.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", padding: "0.55rem 1.25rem", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
                    <button onClick={() => setShowUnreadOnly(v => !v)} style={{ alignItems: "center", background: showUnreadOnly ? "rgba(96,165,250,0.18)" : "rgba(255,255,255,0.05)", border: `1px solid ${showUnreadOnly ? "rgba(96,165,250,0.5)" : "rgba(255,255,255,0.12)"}`, borderRadius: "999px", color: showUnreadOnly ? "#93c5fd" : "rgba(255,255,255,0.6)", cursor: "pointer", display: "flex", fontFamily: "sans-serif", fontSize: "0.72rem", fontWeight: 600, gap: "0.3rem", padding: "0.28rem 0.65rem", transition: "all 0.12s ease" }}>
                    {showUnreadOnly && <span style={{ width: "0.4rem", height: "0.4rem", borderRadius: "50%", background: "#60a5fa" }} />}
                    Unread{unreadIds.size > 0 ? ` (${unreadIds.size})` : ""}
                    </button>
                    {unreadIds.size > 0 && (
                        <button onClick={markAllRead} style={{ background: "none", border: "none", color: "rgba(96,165,250,0.75)", cursor: "pointer", fontFamily: "sans-serif", fontSize: "0.72rem", fontWeight: 600, padding: "0.2rem" }}
                        onMouseEnter={e => e.currentTarget.style.color = "rgba(96,165,250,1)"}
                        onMouseLeave={e => e.currentTarget.style.color = "rgba(96,165,250,0.75)"}>
                        Mark all read
                        </button>
                    )}
                    </div>
                )}
                <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {isGenerating && <GeneratingBanner />}
                {openChats.length === 0 ? (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.25)", fontSize: "0.82rem", fontStyle: "italic", textAlign: "center", padding: "2rem" }}>
                    No diplomatic conversations yet.<br />Start one below.
                    </div>
                ) : visibleChats.length === 0 ? (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.25)", fontSize: "0.82rem", fontStyle: "italic", textAlign: "center", padding: "2rem" }}>
                    No unread chats — you're all caught up.
                    </div>
                ) : groupedChats.map((group, index) => (
                    <React.Fragment key={`${group.label}-${group.chats[0]?.id ?? index}`}>
                    <ChatGroupHeader label={group.label} />
                    {group.chats.map(chat => <ChatListItem key={chat.id} chat={chat} unread={unreadIds.has(String(chat.id))} onClick={() => openChatFromList(chat)} onDelete={() => handleDeleteChat(chat.id)} onToggleRead={() => setChatReadState(chat, unreadIds.has(String(chat.id)))} />)}
                    </React.Fragment>
                ))}
                </div>
                <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                <button onClick={() => setShowSelector(true)} style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.85)", fontSize: "0.85rem", fontWeight: 500, cursor: "pointer", fontFamily: "sans-serif" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.12)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.07)"}>Start New Chat</button>
                </div>
                </>
                )}
                </>
            )}
            </div>
            </>
        );
};

// ── Chat toolbar button ───────────────────────────────────────────────────────

const Chat = ({ hovered, setHovered, isOpen, onToggle }) => {
    const [hasOpened, setHasOpened] = useState(false);
    const [pendingCountry, setPendingCountry] = useState(null);
    const [pendingDraft, setPendingDraft] = useState("");
    const [unseenCount, setUnseenCount] = useState(0);
    // The bell and the toasts portal to document.body above the main menu's
    // layer, so they would sit on the home screen unless told not to.
    const mainMenuOpen = useMainMenuOpen();
    const [isGenerating, setIsGenerating] = useState(false);
    const setChatOpen = () => { onToggle(); };
    // Incoming diplomacy notifications: a toast and a chime for a foreign message
    // that lands while the player is not reading that thread, a 🔔 center that
    // keeps them until the panel opens, optional desktop notifications.
    const [pendingChatId, setPendingChatId] = useState("");
    const [notificationItems, setNotificationItems] = useState([]);
    const [toastItems, setToastItems] = useState([]);
    const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
    const [soundEnabled, setSoundEnabled] = useState(readNotificationSoundEnabled);
    const [desktopPermission, setDesktopPermission] = useState(() =>
        typeof Notification === "undefined" ? "unsupported" : Notification.permission
    );
    const notificationCursorsRef = useRef(null);
    const notificationGameKeyRef = useRef("");
    const notificationPollStatsRef = useRef({ chatsChecked: 0, messagesInspected: 0, changedChats: 0 });
    const toastTimersRef = useRef(new Map());
    const notificationSeqRef = useRef(0);

    // "Someone might be typing": isChatGenerationLikely() is a plain synchronous
    // getter (an idle poll rolling for a diplomatic note), not an event —
    // polled at a fast, animation-friendly cadence so the badge and
    // the panel's banner (below) feel live rather than laggy. Runs regardless of
    // isOpen (unlike the unread poll) since the panel's own banner needs it too.
    useEffect(() => {
        const iv = setInterval(() => setIsGenerating(isChatGenerationLikely()), 800);
        return () => clearInterval(iv);
    }, []);

    // Event Editor diplomatic reaction scheduler. The queue lives in world.json,
    // so refreshes do not cancel the grace window. Deadline-driven rather than a
    // poll: read once, sleep until the next pending evaluation, then let
    // gameplay.js re-check the event and deliver (or deliberately choose silence)
    // through the normal chat fold.
    useEffect(() => {
        let cancelled = false;
        let timer = null;

        const clear = () => {
            if (timer) clearTimeout(timer);
            timer = null;
        };

        const scheduleFromWorld = async (minimumDelayMs = 0) => {
            if (cancelled) return;
            clear();
            try {
                const world = await readWorldStateView({ force: false });
                const queue = Array.isArray(world?.pendingEventOutreach) ? world.pendingEventOutreach : [];
                if (queue.length === 0) return;

                const now = Date.now();
                const dueTimes = queue
                    .map((entry) => Date.parse(String(entry?.deliverAfter || "")))
                    .filter(Number.isFinite)
                    .sort((a, b) => a - b);
                if (dueTimes.length === 0) return;

                const delay = Math.max(minimumDelayMs, dueTimes[0] - now, 100);
                timer = setTimeout(async () => {
                    if (cancelled) return;
                    const result = await processPendingEventOutreach({ debug: true }).catch((error) => ({
                        reason: "scheduler-error",
                        retryAfterMs: 30000,
                        message: error?.message || String(error),
                    }));
                    if (cancelled) return;
                    const retry = Math.max(0, Number(result?.retryAfterMs) || 0);
                    scheduleFromWorld(retry);
                }, Math.min(delay, 2147483000));
            } catch {
                // A transient world read should not permanently orphan persisted work.
                timer = setTimeout(() => scheduleFromWorld(), 30000);
            }
        };

        const queueChanged = () => scheduleFromWorld();
        const visibilityChanged = () => {
            if (!document.hidden) scheduleFromWorld();
        };

        scheduleFromWorld();
        window.addEventListener("oh:event-outreach-queue-changed", queueChanged);
        window.addEventListener("oh:active-game-changed", queueChanged);
        document.addEventListener("visibilitychange", visibilityChanged);

        return () => {
            cancelled = true;
            clear();
            window.removeEventListener("oh:event-outreach-queue-changed", queueChanged);
            window.removeEventListener("oh:active-game-changed", queueChanged);
            document.removeEventListener("visibilitychange", visibilityChanged);
        };
    }, []);

    useEffect(() => {
        if (isOpen) {
            setHasOpened(true);
            // Opening the panel is where the messages get read; the toasts and
            // the center have done their job.
            setNotificationCenterOpen(false);
            setNotificationItems([]);
            setToastItems([]);
            for (const timer of toastTimersRef.current.values()) clearTimeout(timer);
            toastTimersRef.current.clear();
        }
    }, [isOpen]);

    useEffect(() => {
        const timers = toastTimersRef.current;
        const unlock = () => ensureNotificationAudioContext();
        document.addEventListener("pointerdown", unlock, true);
        document.addEventListener("keydown", unlock, true);
        return () => {
            document.removeEventListener("pointerdown", unlock, true);
            document.removeEventListener("keydown", unlock, true);
            for (const timer of timers.values()) clearTimeout(timer);
            timers.clear();
        };
    }, []);

    const removeToast = (id) => {
        const timer = toastTimersRef.current.get(id);
        if (timer) clearTimeout(timer);
        toastTimersRef.current.delete(id);
        setToastItems((current) => current.filter((item) => item.id !== id));
    };

    const openNotificationChat = (item) => {
        if (!item) return;
        removeToast(item.id);
        if (!item.chatId) return;

        setNotificationItems((current) => current.filter((entry) => entry.id !== item.id));
        setNotificationCenterOpen(false);
        setPendingChatId(String(item.chatId));
        if (!isOpen) onToggle();
    };

    const pushNotification = (chat, message, source = "poll") => {
        const item = {
            id: ++notificationSeqRef.current,
            at: Date.now(),
            source,
            chatId: String(chat?.id ?? ""),
            sender: foreignChatSender(chat, message),
            preview: notificationPreview(message),
            gameDate: String(message?.time ?? ""),
        };

        setNotificationItems((current) => [...current, item].slice(-MAX_NOTIFICATION_ITEMS));
        setToastItems((current) => [...current, item].slice(-4));

        const timer = setTimeout(() => removeToast(item.id), 12000);
        toastTimersRef.current.set(item.id, timer);

        if (soundEnabled) playDiplomaticNotificationSound();

        try {
            if (
                document.hidden &&
                typeof Notification !== "undefined" &&
                Notification.permission === "granted"
            ) {
                const desktop = new Notification(`Open Historia — ${item.sender}`, {
                    body: item.preview,
                    tag: `oh-diplomacy-${item.chatId}`,
                    renotify: true,
                });
                desktop.onclick = () => {
                    try { window.focus(); } catch { /* noop */ }
                    openNotificationChat(item);
                    try { desktop.close(); } catch { /* noop */ }
                };
            }
        } catch { /* browser notification failures must never affect diplomacy */ }

        console.info(`[OH native diplomacy] incoming message 🔔 ${item.sender}: ${item.preview}`);
        return item;
    };

    // Combined unread badge + incoming-message watcher, replacing the old
    // 15-second badge poll: event-driven (runtime JSON writes, the jump's chat
    // fold, tab visibility) with a slow safety interval. A check compares only
    // each chat's count and tail fingerprint; history is never rescanned.
    useEffect(() => {
        let cancelled = false;
        const check = async (provided = null, { force = false } = {}) => {
            try {
                const saved = provided ?? await loadAllChats({ force });
                if (cancelled || !Array.isArray(saved)) return;

                const open = saved.filter((chat) =>
                    chat.status !== "closed" &&
                    Array.isArray(chat.countries) &&
                    chat.countries.length > 0
                );

                // A baseline taken for another save is no baseline for this one.
                const gameKey = notificationCursorStorageKey();
                if (notificationCursorsRef.current != null && notificationGameKeyRef.current !== gameKey) {
                    notificationCursorsRef.current = null;
                }
                notificationGameKeyRef.current = gameKey;

                // First run: seed ONE cursor per chat.
                // This is O(number of chats), not O(total diplomatic messages), and
                // prevents an upgrade-time avalanche of historical notifications.
                if (notificationCursorsRef.current == null) {
                    notificationCursorsRef.current =
                        readNotificationCursors() || notificationCursorSnapshot(open);

                    // If a persisted cursor set predates a rollback and points beyond
                    // the current save, the per-chat logic below safely resets it.
                    writeNotificationCursors(notificationCursorsRef.current);
                }

                const cursors = notificationCursorsRef.current;
                const now = Date.now();
                let cursorChanged = false;
                let messagesInspected = 0;
                let changedChats = 0;

                for (const chat of open) {
                    const chatId = String(chat?.id ?? "");
                    if (!chatId) continue;

                    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
                    const current = notificationCursorForChat(chat);
                    const previous = cursors[chatId];

                    if (!previous) {
                        // A genuinely new thread normally contains one opening message.
                        // Inspect only this new thread, never the rest of history.
                        changedChats++;
                        for (const message of messages) {
                            messagesInspected++;

                            if (String(message?.role ?? "").trim().toLowerCase() === "user") {
                                recentOutgoingByChat.set(chatId, now);
                                continue;
                            }
                            if (!isIncomingDiplomaticMessage(message)) continue;

                            const currentlyViewing =
                                Boolean(isOpen) && activeDiplomaticChatId === chatId;
                            if (currentlyViewing) continue;

                            pushNotification(chat, message, "new-chat");
                        }

                        cursors[chatId] = current;
                        cursorChanged = true;
                        continue;
                    }

                    if (current.count < Number(previous.count || 0)) {
                        // Save rollback / thread rewrite backwards: reset baseline.
                        // Never reinterpret surviving historical messages as incoming.
                        cursors[chatId] = current;
                        cursorChanged = true;
                        changedChats++;
                        continue;
                    }

                    if (current.count === Number(previous.count || 0)) {
                        // Same count + same tail = the overwhelmingly common idle poll:
                        // O(1) work for this chat.
                        if (current.tail === String(previous.tail || "")) continue;

                        // Same-count replacement/canonicalization is treated as a state
                        // correction, not a new message, specifically to avoid false
                        // alerts from identity repair or message edits.
                        cursors[chatId] = current;
                        cursorChanged = true;
                        changedChats++;
                        continue;
                    }

                    // The thread GREW. Only inspect the appended suffix.
                    changedChats++;
                    const previousCount = Math.max(0, Number(previous.count || 0));
                    const appended = messages.slice(previousCount);

                    for (const message of appended) {
                        messagesInspected++;

                        // Stored order matters: if one check observes both the player's
                        // outbound message and the immediate reply, the outbound message
                        // arms the grace period before the reply is considered.
                        if (String(message?.role ?? "").trim().toLowerCase() === "user") {
                            recentOutgoingByChat.set(chatId, now);
                            continue;
                        }

                        if (!isIncomingDiplomaticMessage(message)) continue;

                        const recentlyOutgoing =
                            now - (recentOutgoingByChat.get(chatId) || 0) <= ACTIVE_REPLY_GRACE_MS;
                        const currentlyViewing =
                            Boolean(isOpen) && activeDiplomaticChatId === chatId;

                        if (recentlyOutgoing || currentlyViewing) {
                            console.debug(
                                "[OH native diplomacy] notification suppressed for active/recent chat:",
                                foreignChatSender(chat, message),
                            );
                            continue;
                        }

                        pushNotification(chat, message, "chat-watch");
                    }

                    cursors[chatId] = current;
                    cursorChanged = true;
                }

                // Remove cursors for threads no longer present/open. This keeps the
                // persisted baseline bounded by current open chat count.
                const liveIds = new Set(open.map((chat) => String(chat?.id ?? "")).filter(Boolean));
                for (const chatId of Object.keys(cursors)) {
                    if (!liveIds.has(chatId)) {
                        delete cursors[chatId];
                        cursorChanged = true;
                    }
                }

                if (cursorChanged) writeNotificationCursors(cursors);

                notificationPollStatsRef.current = {
                    chatsChecked: open.length,
                    messagesInspected,
                    changedChats,
                };

                // Existing badge semantics stay intact: unread count is per thread.
                if (isOpen) {
                    setUnseenCount(0);
                } else {
                    const seen = readSeen();
                    if (seen === null) {
                        writeSeen(seenTotals(open));
                        setUnseenCount(0);
                    } else {
                        setUnseenCount(open.filter((chat) => isChatUnread(chat, seen)).length);
                    }
                }
            } catch {
                // One failed read must not disturb the last good UI state.
            }
        };


        const onRuntimeUpdate = (event) => {
            if (event?.detail?.url !== JSON_URLS.chat) return;
            void check(event?.detail?.value);
        };

        const onExternalChatUpdate = () => {
            void loadAllChats({ force: false }).then((saved) => check(saved)).catch(() => {});
        };

        const onVisibilityChange = () => {
            if (document.hidden) return;
            const run = () => void check(null, { force: true });
            if (typeof window.requestIdleCallback === "function") {
                window.requestIdleCallback(run, { timeout: 2500 });
            } else {
                window.setTimeout(run, 250);
            }
        };

        void check(null, { force: false });
        const safety = setInterval(() => void check(null, { force: false }), 30000);
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("oh:runtime-json-updated", onRuntimeUpdate);
        window.addEventListener("oh:diplomacy-chats-updated", onExternalChatUpdate);
        // A save switch is a different set of threads: drop the baseline and the
        // pending toasts, and re-seed from the new save without announcing it.
        const onActiveGameChanged = () => {
            notificationCursorsRef.current = null;
            for (const timer of toastTimersRef.current.values()) clearTimeout(timer);
            toastTimersRef.current.clear();
            setToastItems([]);
            setNotificationItems([]);
            setNotificationCenterOpen(false);
            void check(null, { force: true });
        };
        window.addEventListener("oh:active-game-changed", onActiveGameChanged);

        return () => {
            cancelled = true;
            clearInterval(safety);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            window.removeEventListener("oh:runtime-json-updated", onRuntimeUpdate);
            window.removeEventListener("oh:diplomacy-chats-updated", onExternalChatUpdate);
            window.removeEventListener("oh:active-game-changed", onActiveGameChanged);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, soundEnabled]);

    useEffect(() => {
        const handler = (country) => {
            setPendingCountry(country);
            if (!isOpen) onToggle();
        };
        _chatOpenSubs.add(handler);
        return () => _chatOpenSubs.delete(handler);
    }, [isOpen, onToggle]);

    const toggleSound = () => {
        const next = !soundEnabled;
        setSoundEnabled(next);
        writeNotificationSoundEnabled(next);
        if (next) {
            ensureNotificationAudioContext();
            playDiplomaticNotificationSound();
        }
    };

    const enableDesktop = async () => {
        if (typeof Notification === "undefined") {
            setDesktopPermission("unsupported");
            return;
        }
        try {
            const permission = Notification.permission === "default"
                ? await Notification.requestPermission()
                : Notification.permission;
            setDesktopPermission(permission);
        } catch {
            setDesktopPermission("unsupported");
        }
    };

    // A small diagnostic API so the notifications can be exercised from the
    // console without waiting for a foreign message.
    useEffect(() => {
        if (typeof window === "undefined") return undefined;

        window.__OH_DIPLO_NOTIFICATIONS__ = {
            status: () => ({
                unreadChats: unseenCount,
                notificationItems: notificationItems.length,
                soundEnabled,
                desktopPermission:
                    typeof Notification === "undefined"
                        ? "unsupported"
                        : Notification.permission,
                audioState: notificationAudioContext?.state || "not-created",
                pollVisibleMs: NOTIFICATION_VISIBLE_POLL_MS,
                pollHiddenMs: NOTIFICATION_HIDDEN_POLL_MS,
                scanMode: "per-chat-cursor",
                lastPoll: { ...notificationPollStatsRef.current },
            }),
            testSound: () => playDiplomaticNotificationSound(),
            enableDesktop,
            clear: () => {
                for (const timer of toastTimersRef.current.values()) clearTimeout(timer);
                toastTimersRef.current.clear();
                setToastItems([]);
                setNotificationItems([]);
                setNotificationCenterOpen(false);
                return true;
            },
            test: () => pushNotification(
                { id: "", countries: [{ name: "Diplomatic notification test" }] },
                {
                    role: "leader",
                    speaker: "Diplomatic notification test",
                    text: "If you can see this toast and the notification button, diplomacy notifications are working.",
                },
                "manual-test",
            ),
            testExistingChat: async () => {
                const saved = await loadAllChats({ force: true });
                const open = (Array.isArray(saved) ? saved : [])
                    .filter((chat) =>
                        chat.status !== "closed" &&
                        Array.isArray(chat.countries) &&
                        chat.countries.length > 0
                    );
                const chat = sortChatsByRecency(open)[0];

                if (!chat) {
                    return { ok: false, reason: "no-open-chat" };
                }

                const messages = Array.isArray(chat.messages) ? chat.messages : [];
                const incoming = [...messages]
                    .reverse()
                    .find((message) => isIncomingDiplomaticMessage(message));

                const message = incoming || {
                    role: "leader",
                    speaker: chat?.countries?.[0]?.name || "Diplomatic contact",
                    text: "Manual click-through test for this existing diplomatic thread.",
                    time: chatLastMessageTime(chat),
                };

                const item = pushNotification(chat, message, "manual-existing-chat");
                return {
                    ok: true,
                    chatId: String(chat.id),
                    sender: item.sender,
                    preview: item.preview,
                };
            },
        };

        return () => {
            if (window.__OH_DIPLO_NOTIFICATIONS__) {
                delete window.__OH_DIPLO_NOTIFICATIONS__;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [unseenCount, notificationItems.length, soundEnabled, desktopPermission]);

    useEffect(() => {
        const handler = (country, draft) => {
            setPendingCountry(country);
            setPendingDraft(draft || "");
            if (!isOpen) onToggle();
        };
        _chatOpenSubs.add(handler);
        return () => _chatOpenSubs.delete(handler);
    }, [isOpen, onToggle]);
    const notificationPortal = typeof document !== "undefined" && !mainMenuOpen
        ? ReactDOM.createPortal(
            <>
            <div
                style={{
                    position: "fixed",
                    top: "4.35rem",
                    left: "auto",
                    // Advisor and Stats share the same resizable right drawer.
                    // That drawer publishes its live width as a CSS variable so
                    // diplomatic toasts can remain top-right without covering it.
                    right: "calc(var(--oh-right-drawer-safe-offset, 0px) + 0.75rem)",
                    width: "min(23rem, calc(100vw - 2rem))",
                    zIndex: 10050,
                    pointerEvents: "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.55rem",
                }}
            >
                {!isOpen && toastItems.map((item) => (
                    <div
                        key={item.id}
                        role={item.chatId ? "button" : undefined}
                        tabIndex={item.chatId ? 0 : -1}
                        onClick={() => {
                            if (item.chatId) openNotificationChat(item);
                        }}
                        onKeyDown={(event) => {
                            if (!item.chatId) return;
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openNotificationChat(item);
                            }
                        }}
                        style={{
                            pointerEvents: "auto",
                            position: "relative",
                            width: "100%",
                            textAlign: "left",
                            border: "1px solid rgba(230,230,233,0.20)",
                            borderRadius: "14px",
                            background: "linear-gradient(180deg, rgba(42,42,46,0.72), rgba(17,17,19,0.62))",
                            backdropFilter: "blur(26px) saturate(1.35)",
                            WebkitBackdropFilter: "blur(26px) saturate(1.35)",
                            color: "white",
                            padding: "0.75rem 2.35rem 0.75rem 0.85rem",
                            boxShadow: "0 14px 38px rgba(0,0,0,0.42)",
                            cursor: item.chatId ? "pointer" : "default",
                            fontFamily: "sans-serif",
                        }}
                        title={item.chatId ? "Open diplomatic chat" : "Notification test"}
                    >
                        <button
                            type="button"
                            aria-label="Dismiss diplomatic notification"
                            title="Dismiss"
                            onClick={(event) => {
                                event.stopPropagation();
                                removeToast(item.id);
                            }}
                            style={{
                                position: "absolute",
                                top: "0.45rem",
                                right: "0.45rem",
                                width: "1.55rem",
                                height: "1.55rem",
                                borderRadius: "7px",
                                border: "1px solid rgba(255,255,255,0.10)",
                                background: "rgba(255,255,255,0.06)",
                                color: "rgba(255,255,255,0.72)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                fontSize: "0.8rem",
                                lineHeight: 1,
                                padding: 0,
                            }}
                            onMouseEnter={(event) => {
                                event.currentTarget.style.background = "rgba(255,255,255,0.12)";
                                event.currentTarget.style.color = "white";
                            }}
                            onMouseLeave={(event) => {
                                event.currentTarget.style.background = "rgba(255,255,255,0.06)";
                                event.currentTarget.style.color = "rgba(255,255,255,0.72)";
                            }}
                        >
                            ✕
                        </button>

                        <div style={{ fontSize: "0.78rem", fontWeight: 800, marginBottom: "0.25rem" }}>
                            💬 {item.sender}
                        </div>
                        <div style={{ fontSize: "0.74rem", lineHeight: 1.35, color: "rgba(255,255,255,0.72)" }}>
                            {item.preview}
                        </div>
                    </div>
                ))}
            </div>

            {notificationItems.length > 0 && !isOpen && (
                <div
                    style={{
                        position: "fixed",
                        // The V2 command dock now owns the bottom-left edge. Keep the
                        // notification center immediately above it instead of colliding
                        // with / disappearing underneath the dock.
                        left: FLOATING_UI_EDGE_GAP,
                        bottom: "4.55rem",
                        zIndex: 10050,
                        fontFamily: "sans-serif",
                    }}
                >
                    <Presence open={notificationCenterOpen}>
                        <div
                            style={{
                                position: "absolute",
                                left: 0,
                                bottom: "3rem",
                                width: "min(22rem, calc(100vw - 1rem))",
                                maxHeight: "min(27rem, calc(100vh - 7rem))",
                                overflowY: "auto",
                                borderRadius: "16px",
                                border: "1px solid rgba(230,230,233,0.18)",
                                background: "linear-gradient(180deg, rgba(41,41,45,0.74), rgba(17,17,19,0.64))",
                                backdropFilter: "blur(28px) saturate(1.38)",
                                WebkitBackdropFilter: "blur(28px) saturate(1.38)",
                                boxShadow: "0 18px 50px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.08)",
                                color: "white",
                            }}
                        >
                            <div
                                style={{
                                    position: "sticky",
                                    top: 0,
                                    zIndex: 1,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.45rem",
                                    padding: "0.65rem 0.75rem",
                                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                                    background: "rgba(27,27,30,0.76)",
                                    backdropFilter: "blur(18px)",
                                    WebkitBackdropFilter: "blur(18px)",
                                }}
                            >
                                <strong style={{ flex: 1, fontSize: "0.78rem" }}>
                                    Diplomatic messages ({notificationItems.length})
                                </strong>
                                <button
                                    onClick={toggleSound}
                                    title={soundEnabled ? "Mute diplomacy notification sound" : "Enable diplomacy notification sound"}
                                    style={{ border: "none", background: "transparent", color: "rgba(255,255,255,0.72)", cursor: "pointer", fontSize: "0.82rem" }}
                                >
                                    {soundEnabled ? "🔊" : "🔇"}
                                </button>
                                <button
                                    onClick={enableDesktop}
                                    title="Desktop notification permission"
                                    style={{
                                        border: "none",
                                        background: "transparent",
                                        color: desktopPermission === "granted" ? "#86efac" : "rgba(255,255,255,0.55)",
                                        cursor: desktopPermission === "unsupported" ? "default" : "pointer",
                                        fontSize: "0.68rem",
                                    }}
                                >
                                    {desktopPermission === "granted" ? "Desktop ✓" : "Desktop"}
                                </button>
                                <button
                                    onClick={() => {
                                        setNotificationItems([]);
                                        setNotificationCenterOpen(false);
                                    }}
                                    style={{ border: "none", background: "transparent", color: "#93c5fd", cursor: "pointer", fontSize: "0.68rem" }}
                                >
                                    Clear
                                </button>
                            </div>

                            {[...notificationItems].reverse().map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => openNotificationChat(item)}
                                    disabled={!item.chatId}
                                    style={{
                                        width: "100%",
                                        border: "none",
                                        borderBottom: "1px solid rgba(255,255,255,0.07)",
                                        background: "transparent",
                                        color: "white",
                                        padding: "0.7rem 0.8rem",
                                        textAlign: "left",
                                        cursor: item.chatId ? "pointer" : "default",
                                        fontFamily: "sans-serif",
                                    }}
                                >
                                    <div style={{ fontSize: "0.76rem", fontWeight: 750 }}>{item.sender}</div>
                                    <div style={{ marginTop: "0.2rem", fontSize: "0.7rem", lineHeight: 1.35, color: "rgba(255,255,255,0.62)" }}>
                                        {item.preview}
                                    </div>
                                    <div style={{ marginTop: "0.25rem", fontSize: "0.62rem", color: "rgba(255,255,255,0.32)" }}>
                                        {item.gameDate ? formatChatDateLabel(item.gameDate) : new Date(item.at).toLocaleTimeString()}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </Presence>

                    <button
                        onClick={() => setNotificationCenterOpen((open) => !open)}
                        title="Diplomatic notifications"
                        style={{
                            minWidth: "2.8rem",
                            height: "2.5rem",
                            padding: "0 0.65rem",
                            borderRadius: "10px",
                            border: "1px solid rgba(230,230,233,0.20)",
                            background: "linear-gradient(180deg, rgba(45,45,49,0.72), rgba(18,18,20,0.62))",
                            backdropFilter: "blur(24px) saturate(1.35)",
                            WebkitBackdropFilter: "blur(24px) saturate(1.35)",
                            color: "white",
                            boxShadow: "0 8px 24px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.08)",
                            cursor: "pointer",
                            fontFamily: "sans-serif",
                            fontWeight: 800,
                            fontSize: "0.72rem",
                        }}
                    >
                        🔔 {notificationItems.length > 99 ? "99+" : notificationItems.length}
                    </button>
                </div>
            )}
            </>,
            document.body,
        )
        : null;


        return (
            <>
            {notificationPortal}
            {hasOpened && <ChatPanel isOpen={isOpen} onClose={onToggle} requestedCountry={pendingCountry} requestedDraft={pendingDraft} requestedChatId={pendingChatId} onConsumeRequestedChat={() => setPendingChatId("")} onConsumeRequest={() => { setPendingCountry(null); setPendingDraft(""); }} isGenerating={isGenerating} />}
            <button type="button" title={isGenerating ? "Chat — diplomacy in progress" : "Chat"} style={{
                alignItems: "center",
                background: isOpen
                ? "rgba(59,130,246,0.16)"
                : hovered
                ? "rgba(255,255,255,0.075)"
                : "rgba(255,255,255,0.035)",
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
            onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
            onClick={() => setChatOpen(o => !o)}>
            <span style={{ position: "relative", display: "inline-flex" }}>
                <DiplomacyDockIcon />
                {!isOpen && (isGenerating ? (
                    // "Someone is typing" — a country may be drafting an approach.
                    // Replaces the numeric badge (rather than sitting beside it) so
                    // the icon says one thing at a time; the count returns on its
                    // own once generation ends and the next 15s poll catches it.
                    <span style={{ position: "absolute", top: "-0.55rem", right: "-0.8rem", minWidth: "1.05rem", height: "1.05rem", padding: "0 0.3rem", borderRadius: "999px", background: "#7c3aed", border: "1px solid rgba(255,255,255,0.35)", color: "white", fontSize: "0.68rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, boxShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>
                        <PulsingDots />
                    </span>
                ) : unseenCount > 0 && (
                    <span style={{ position: "absolute", top: "-0.55rem", right: "-0.8rem", minWidth: "1.05rem", height: "1.05rem", padding: "0 0.2rem", borderRadius: "999px", background: "#dc2626", border: "1px solid rgba(255,255,255,0.35)", color: "white", fontSize: "0.62rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, boxShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>
                        {unseenCount > 9 ? "9+" : unseenCount}
                    </span>
                ))}
            </span>
            </button>
            </>
        );
};

// ── Toolbar ───────────────────────────────────────────────────────────────────

// Continuance's diplomacy glyph — the launcher icons are one stroke family.
const DiplomacyDockIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
        <path d="M8 9h8" />
        <path d="M8 13h5" />
    </svg>
);

const Toolbar = memo(({ onOpenAdvisor, activePanel, onTogglePanel, mapRef }) => {
    const [hoveredChat, setHoveredChat]       = useState(false);
    const [hoveredActions, setHoveredActions] = useState(false);
    const [hoveredProjects, setHoveredProjects] = useState(false);
    return (
        <div style={{ position: "fixed", bottom: "0.5rem", left: "0.5rem", height: "4rem", width: "12.8rem", gap: "0.75rem", padding: "0 0.1rem", backgroundColor: "var(--oh-hud-bg)", backdropFilter: "var(--oh-hud-blur)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontFamily: "sans-serif", borderRadius: "14px", border: "1px solid var(--oh-hud-border)", boxShadow: "var(--oh-hud-shadow-soft)" }}>
        <Chat hovered={hoveredChat} setHovered={setHoveredChat} isOpen={activePanel === "chat"} onToggle={() => onTogglePanel("chat")} />
        <Actions onOpenAdvisor={onOpenAdvisor} hovered={hoveredActions} setHovered={setHoveredActions} isOpen={activePanel === "actions"} onToggle={() => onTogglePanel("actions")} />
        <Projects onOpenAdvisor={onOpenAdvisor} mapRef={mapRef} hovered={hoveredProjects} setHovered={setHoveredProjects} isOpen={activePanel === "projects"} onToggle={() => onTogglePanel("projects")} />
        </div>
    );
});

export { Toolbar, Chat, ChatPanel };
