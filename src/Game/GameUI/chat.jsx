/*! Open Historia — portions (era diplomacy + mobile panel sizing) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { dedupeByName } from "../../runtime/countryList.js";
import ReactDOM from "react-dom";
import ReactMarkdown from "react-markdown";
import { sendDiplomaticMessage, startDiplomaticChat, loadDiplomaticHistory } from "../AI/main.jsx";
import { chooseNextDiplomaticSpeaker } from "../AI/gameplay.js";
import {
    MAX_ACTIVE_SPIES, activeSpies, deploySpy, expelSpy, foreignSpies, intelligenceOf, normalizeIntercepts, normalizeSpies,
    recallSpy, redactExchange, setCoverStory, signalClarity, turnSpy,
} from "../../runtime/spycraft.js";
import { isSeal, newSeal, openExchange } from "../../runtime/spySeal.js";
import { Actions } from "./actions";
import { Presence } from "./presence.jsx";
import {
    JSON_URLS,
    getNationColors,
    getNationFlags,
    loadCountryNames as loadCachedCountryNames,
    readJson,
} from "../../runtime/assets.js";
import { flagImageUrlFromGid } from "../../runtime/countryFlags.js";
import { fetchCommunityFlags, loadCommunityFlagDataUrl } from "../../runtime/communityFlags.js";
import { readChatsState, writeChatsState, readInterceptsState, readWorldState, writeWorldState } from "../../runtime/gameState.js";

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
// country: 1 flagcdn.com artwork via countryFlags.js 2. for a custom nation that table doesn't know, the map
// author's own flag for that owner code, from the scenario's flags.json getNationFlags) 

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

const resolveFlagImageUrl = ({ code, name } = {}) => {
    if (!code && !name) return Promise.resolve(null);
    const key = `${code ?? ""}::${name ?? ""}`;
    if (flagUrlCache.has(key)) return flagUrlCache.get(key);

    const builtIn = flagImageUrlFromGid(code) ?? flagImageUrlFromGid(name);
    const promise = builtIn
        ? Promise.resolve(builtIn)
        : getScenarioFlagMap()
            .then((flags) => (code && flags?.[code]) || null)
            .catch(() => null)
            .then((scenarioFlag) => {
                if (scenarioFlag) return scenarioFlag;
                return getCommunityFlagPosts()
                    .then((posts) => {
                        const match = findCommunityFlagPost(posts, { code, name });
                        return match ? loadCommunityFlagDataUrl(match).catch(() => null) : null;
                    })
                    .catch(() => null);
            });

    flagUrlCache.set(key, promise);
    return promise;
};

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

// ── Markdown styles ───────────────────────────────────────────────────────────

const markdownStyles = `
.chat-markdown p { margin: 0 0 0.5rem 0; }
.chat-markdown p:last-child { margin-bottom: 0; }
.chat-markdown ul, .chat-markdown ol { margin: 0.25rem 0 0.5rem 1.25rem; padding: 0; }
.chat-markdown li { margin-bottom: 0.2rem; }
.chat-markdown strong { color: rgba(255,255,255,0.95); }
.chat-markdown em { color: rgba(255,255,255,0.75); }
.chat-markdown blockquote { border-left: 2px solid rgba(139,92,246,0.6); margin: 0.5rem 0; padding-left: 0.75rem; color: rgba(255,255,255,0.6); }
`;

const MarkdownStyleInjector = () => {
    useEffect(() => {
        if (!document.getElementById("chat-md-styles")) {
            const style = document.createElement("style");
            style.id = "chat-md-styles";
            style.textContent = markdownStyles;
            document.head.appendChild(style);
        }
    }, []);
    return null;
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





// ── Message bubble ────────────────────────────────────────────────────────────

const MessageBubble = ({ msg }) => {
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
        {isPlayer ? msg.text : <div className="chat-markdown"><ReactMarkdown>{msg.text}</ReactMarkdown></div>}
        </div>

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

const ConversationView = ({ chat, playerCountry, gameDate, onDelete, onBack, onMessagesUpdate }) => {
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

    useEffect(() => {
        countries.forEach(({ name, code }) => resolveFlagImageUrl({ code, name }));
    }, [countries]);

    useEffect(() => {
        const saved = chat.messages ?? [];
        if (saved.length > 0) loadDiplomaticHistory(saved);
        else startDiplomaticChat();
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
            if (isPlayerCountry(country)) {
                setPendingCountry(null);
                setRemainingQueue([]);
                setPhase("player");
                return;
            }
            setIsLoading(true);
            setSpeakingCountry(country);
            try {
                const { reply, reaction } = await sendDiplomaticMessage(playerMessage, country.name, countries);

                if (reaction) {
                    const msgs = [...messagesRef.current];
                    const lastUserIdx = msgs.map(m => m.role).lastIndexOf("user");
                    if (lastUserIdx !== -1) {
                        msgs[lastUserIdx] = {
                            ...msgs[lastUserIdx],
                            reactions: { ...(msgs[lastUserIdx].reactions ?? {}), [country.name]: { emoji: reaction, code: country.code } },
                        };
                        pushMessages([...msgs, { role: "leader", speaker: country.name, code: country.code, text: reply, time: gameDate }]);
                    } else {
                        pushMessages([...msgs, { role: "leader", speaker: country.name, code: country.code, text: reply, time: gameDate }]);
                    }
                } else {
                    pushMessages([...messagesRef.current, { role: "leader", speaker: country.name, code: country.code, text: reply, time: gameDate }]);
                }
            } catch (err) {
                pushMessages([...messagesRef.current, { role: "error", speaker: country.name, code: country.code, text: err.message, time: gameDate }]);
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
            if (queue.length === 0) {
                pushMessages([...nextMessages, { role: "error", speaker: "System", text: "This chat has no valid participants.", time: gameDate }]);
                return;
            }
            if (isGroup) {
                offerNextCountry(queue);
            } else {
                await fetchLeaderResponse(queue[0], text, []);
            }
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
            {messages.map((msg, i) => <MessageBubble key={i} msg={msg} chatCountries={countries} />)}
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
                placeholder="Send a diplomatic message…"
                rows={1} value={playerInput}
                onChange={e => setPlayerInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handlePlayerSubmit(); } }}
                onInput={e => { e.target.style.height = "auto"; }}
                style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "10px", color: "white", fontSize: "0.875rem", padding: "0.6rem 0.75rem", resize: "none", outline: "none", fontFamily: "sans-serif", lineHeight: "1.5", overflowY: "hidden", transition: "border-color 0.2s" }}
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

// ── Chat list item ────────────────────────────────────────────────────────────

const ChatListItem = ({ chat, onClick, onDelete, unread = false }) => {
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
        <div style={{ display: "flex", gap: "0.15rem", flexShrink: 0 }}>
        {previewCountries.map((c) => (
            <FlagImg key={c.name} url={flagUrlMap[c.name] ?? null} alt={c.name} width="1.3rem" height="0.9rem" />
        ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "0.82rem", fontWeight: unread ? 700 : 600, color: unread ? "#fff" : "rgba(255,255,255,0.9)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{names}{unread && <span style={{ fontWeight: 400, fontSize: "0.7rem", color: "#60a5fa", marginLeft: "0.4rem" }}>new</span>}</div>
        <div style={{ fontSize: "0.75rem", color: unread ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.35)", marginTop: "0.15rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{preview}</div>
        </div>
        </button>
        {hovered && (
            <button onClick={e => { e.stopPropagation(); if (confirming) { onDelete(); } else { setConfirming(true); } }}
            title={confirming ? "Click again to delete this chat" : "Delete chat"}
            aria-label={confirming ? "Confirm deleting this chat" : "Delete chat"}
            style={{ position: "absolute", top: "50%", right: "0.6rem", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: "0.3rem", background: confirming ? "rgba(239,68,68,0.18)" : "none", border: `1px solid ${confirming ? "rgba(239,68,68,0.55)" : "transparent"}`, cursor: "pointer", color: confirming ? "#fca5a5" : "rgba(239,68,68,0.7)", fontSize: "0.72rem", fontWeight: 600, fontFamily: "sans-serif", padding: confirming ? "0.25rem 0.5rem" : "0.25rem", borderRadius: "6px", lineHeight: 1 }}
            onMouseEnter={e => { if (!confirming) { e.currentTarget.style.color = "rgba(239,68,68,1)"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; } }}
            onMouseLeave={e => { if (!confirming) { e.currentTarget.style.color = "rgba(239,68,68,0.7)"; e.currentTarget.style.background = "none"; } }}>
            {confirming ? "Delete?" : <TrashIcon />}</button>
        )}
        </div>
    );
};

// ── Main ChatPanel ────────────────────────────────────────────────────────────

// Bridge so the map region popup can request a diplomatic chat with a country.
const _chatOpenSubs = new Set();
export const requestDiplomaticChat = (country) => {
    if (!country || !country.name) return;
    _chatOpenSubs.forEach((fn) => { try { fn(country); } catch { /* noop */ } });
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
        await writeWorldState({ ...fresh, spies: next, spySeal: isSeal(fresh?.spySeal) ? fresh.spySeal : newSeal() });
        await refresh();
    };

    const handleExpel = async (spy) => {
        setError("");
        try { await commitSpies(expelSpy(world, spy.id, { date: gameDate })); } catch (err) { setError(err?.message || String(err)); }
    };
    const handleTurn = async (spy) => {
        setError("");
        try { await commitSpies(turnSpy(world, spy.id, { date: gameDate, coverStory: storyDraft[spy.id] || "" })); } catch (err) { setError(err?.message || String(err)); }
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
            {spy.target}{spy.suspected && <span title="Your analysts think this agent's reports are being fed to you" style={{ marginLeft: "0.4rem", color: "#fbbf24", fontSize: "0.7rem" }}>⚠ possibly compromised</span>}
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
            <button key={exchange.id} onClick={() => setOpen({ target, exchange })}
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

const ChatPanel = ({ isOpen, onClose, requestedCountry, onConsumeRequest }) => {
    // "chats" is the diplomacy the player is party to; "spy" is everyone else's.
    const [view, setView] = useState("chats");
    const [countries, setCountries]               = useState([]);
    const [loadingCountries, setLoadingCountries] = useState(true);
    const [playerCountry, setPlayerCountry]       = useState("your nation");
    const [gameDate, setGameDate]                 = useState("");
    const [chats, setChats]                       = useState([]);
    const [activeChat, setActiveChat]             = useState(null);
    const [showSelector, setShowSelector]         = useState(false);
    const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
    const openChats = chats.filter((chat) => chat.status !== "closed" && Array.isArray(chat.countries) && chat.countries.length > 0);

    // Which chats to flag as unread, snapshotted when the panel OPENS and held
    // until it closes — rows must not reshuffle under the cursor while the player
    // is reading them. Reopening the panel is what re-sorts.
    const [unreadIds, setUnreadIds] = useState(() => new Set());
    const snapshotTakenRef = useRef(false);

    useEffect(() => {
        if (!isOpen) { snapshotTakenRef.current = false; return; }
        if (snapshotTakenRef.current || !hasLoadedInitialData) return;
        snapshotTakenRef.current = true;
        setUnreadIds(new Set(openChats.filter((chat) => isChatUnread(chat, readSeen())).map((chat) => String(chat.id))));
        // Everything on screen now counts as seen: the toolbar badge clears, and the
        // next open only flags what arrived in between.
        writeSeen(seenTotals(openChats));
    }, [isOpen, hasLoadedInitialData, openChats]);

    // Unread first, everything else in the order it already had — a stable
    // partition, so chats the player has read don't jump around too.
    const orderedChats = [
        ...openChats.filter((chat) => unreadIds.has(String(chat.id))),
        ...openChats.filter((chat) => !unreadIds.has(String(chat.id))),
    ];

    // Opening a chat marks it read, so messages that landed while the panel was
    // already open don't come back flagged on the next open.
    const openChatFromList = (chat) => {
        setActiveChat(chat);
        writeSeen({ ...(readSeen() || {}), [String(chat.id)]: chatMessageCount(chat) });
    };

    useEffect(() => {
        if (!isOpen || hasLoadedInitialData) return;

        let cancelled = false;
        Promise.all([loadCountryNames(), loadAllChats()])
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
            if (cancelled || !Array.isArray(saved)) return;
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
        })
        .catch(() => {});

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

    // Open (or reuse) a 1-on-1 chat with a country requested from the region popup.
    const consumePending = (country) => {
        setShowSelector(false);
        setChats(prev => {
            const existing = prev.find(
                c => c.status !== "closed" && Array.isArray(c.countries) && c.countries.length === 1 &&
                     (c.countries[0]?.name || "").toLowerCase() === country.name.toLowerCase(),
            );
            if (existing) { setActiveChat(existing); return prev; }
            const newChat = { id: Date.now(), countries: [{ name: country.name, code: country.code || "" }], messages: [], status: "open" };
            const u = [newChat, ...prev];
            saveAllChats(u);
            setActiveChat(newChat);
            return u;
        });
    };

    useEffect(() => {
        if (!isOpen || !requestedCountry) return;
        consumePending(requestedCountry);
        onConsumeRequest?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, requestedCountry]);

        return (
            <>
            <MarkdownStyleInjector />
            <div style={{ position: "fixed", bottom: isOpen ? "4.25rem" : "-40rem", left: "0rem", width: "26.25rem", maxWidth: "calc(100vw - 1rem)", height: "min(calc(100vh - 9rem), max(calc(100vh - 33rem), 30rem))", minHeight: "10rem", backgroundColor: "rgba(24,24,27,0.95)", backdropFilter: "blur(8px)", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "-4px 0 24px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.06)", zIndex: 9998, overflow: "hidden", transition: "bottom 0.35s cubic-bezier(0.4,0,0.2,1),opacity 0.35s ease", opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? "auto" : "none", fontFamily: "sans-serif", color: "white", display: "flex", flexDirection: "column" }}>

            <Presence open={showSelector}><CountrySelectorModal countries={availableCountries} loading={loadingCountries} onStart={handleStartChat} onCancel={() => setShowSelector(false)} /></Presence>

            {activeChat && Array.isArray(activeChat.countries) && activeChat.countries.length > 0 ? (
                <ConversationView chat={activeChat} playerCountry={playerCountry} gameDate={gameDate} onDelete={() => handleDeleteChat(activeChat.id)} onBack={() => setActiveChat(null)} onMessagesUpdate={handleMessagesUpdate} />
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
                <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {openChats.length === 0 ? (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.25)", fontSize: "0.82rem", fontStyle: "italic", textAlign: "center", padding: "2rem" }}>
                    No diplomatic conversations yet.<br />Start one below.
                    </div>
                ) : orderedChats.map(chat => <ChatListItem key={chat.id} chat={chat} unread={unreadIds.has(String(chat.id))} onClick={() => openChatFromList(chat)} onDelete={() => handleDeleteChat(chat.id)} />)}
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
    const [unseenCount, setUnseenCount] = useState(0);
    const setChatOpen = () => { onToggle(); };

    useEffect(() => {
        if (isOpen) setHasOpened(true);
    }, [isOpen]);

    // Unread badge: countries now message the player unprompted (jump
    // invitations, the idle outreach drip), so the toolbar button must say so.
    // A cheap poll of the stored chat list counts open chats that gained
    // messages (or appeared) since the panel was last open.
    useEffect(() => {
        let cancelled = false;
        const check = () => loadAllChats({ force: true })
        .then((saved) => {
            if (cancelled || !Array.isArray(saved)) return;
            const open = saved.filter((c) => c.status !== "closed" && Array.isArray(c.countries) && c.countries.length > 0);
            // The badge only READS the baseline. The panel writes it when it opens,
            // and it must be the only writer: if this poll also wrote on isOpen it
            // could clear the baseline first and the list would find nothing unread.
            if (isOpen) { setUnseenCount(0); return; }
            const seen = readSeen();
            if (seen === null) {
                // First look ever — seed the baseline instead of declaring every
                // chat that already existed unread.
                writeSeen(seenTotals(open));
                setUnseenCount(0);
                return;
            }
            setUnseenCount(open.filter((c) => isChatUnread(c, seen)).length);
        })
        .catch(() => {});

        check();
        const iv = setInterval(check, 15000);
        return () => {
            cancelled = true;
            clearInterval(iv);
        };
    }, [isOpen]);

    useEffect(() => {
        const handler = (country) => {
            setPendingCountry(country);
            if (!isOpen) onToggle();
        };
        _chatOpenSubs.add(handler);
        return () => _chatOpenSubs.delete(handler);
    }, [isOpen, onToggle]);
        return (
            <>
            {hasOpened && <ChatPanel isOpen={isOpen} onClose={onToggle} requestedCountry={pendingCountry} onConsumeRequest={() => setPendingCountry(null)} />}
            <button title="Chat" style={{ width: "3.3rem", height: "3.3rem", borderRadius: "10px", border: hovered ? "1px solid rgba(255,255,255,0.2)" : isOpen ? "1px solid rgba(139,92,246,0.5)" : "1px solid rgba(255,255,255,0.1)", background: isOpen ? "linear-gradient(145deg,rgba(109,40,217,0.4),rgba(76,29,149,0.4))" : hovered ? "linear-gradient(145deg,rgba(54,54,59,0.95),rgba(32,32,35,0.95))" : "linear-gradient(145deg,rgba(43,43,47,0.95),rgba(24,24,27,0.95))", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.12s ease", boxShadow: hovered ? "inset 0 1px 0 rgba(255,255,255,0.1),0 2px 8px rgba(0,0,0,0.4)" : "inset 0 1px 0 rgba(255,255,255,0.06),inset 0 -1px 0 rgba(0,0,0,0.3),0 2px 6px rgba(0,0,0,0.35)", fontSize: "1.2rem", outline: "none", transform: hovered ? "translateY(-1px)" : "translateY(0)", color: "white", fontFamily: "sans-serif", flexShrink: 0 }}
            onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
            onClick={() => setChatOpen(o => !o)}>
            <span style={{ position: "relative", display: "inline-flex" }}>
                💬
                {unseenCount > 0 && !isOpen && (
                    <span style={{ position: "absolute", top: "-0.55rem", right: "-0.8rem", minWidth: "1.05rem", height: "1.05rem", padding: "0 0.2rem", borderRadius: "999px", background: "#dc2626", border: "1px solid rgba(255,255,255,0.35)", color: "white", fontSize: "0.62rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, boxShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>
                        {unseenCount > 9 ? "9+" : unseenCount}
                    </span>
                )}
            </span>
            </button>
            </>
        );
};

// ── Toolbar ───────────────────────────────────────────────────────────────────

const Toolbar = memo(({ onOpenAdvisor, activePanel, onTogglePanel }) => {
    const [hoveredChat, setHoveredChat]       = useState(false);
    const [hoveredActions, setHoveredActions] = useState(false);
    return (
        <div style={{ position: "fixed", bottom: "0.5rem", left: "0.5rem", height: "4rem", width: "8.75rem", gap: "0.75rem", padding: "0 0.1rem", backgroundColor: "rgba(24,24,27,0.9)", backdropFilter: "blur(4px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontFamily: "sans-serif", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 24px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.05)" }}>
        <Chat hovered={hoveredChat} setHovered={setHoveredChat} isOpen={activePanel === "chat"} onToggle={() => onTogglePanel("chat")} />
        <Actions onOpenAdvisor={onOpenAdvisor} hovered={hoveredActions} setHovered={setHoveredActions} isOpen={activePanel === "actions"} onToggle={() => onTogglePanel("actions")} />
        </div>
    );
});

export { Toolbar, Chat, ChatPanel };
