/*! Open Historia — portions (era diplomacy + mobile panel sizing) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import ReactMarkdown from "react-markdown";
import { sendDiplomaticMessage, startDiplomaticChat, loadDiplomaticHistory } from "../AI/main.jsx";
import { chooseNextDiplomaticSpeaker, isChatGenerationLikely } from "../AI/gameplay.js";
import { Actions } from "./actions";
import { Projects } from "./projects";
import {
    JSON_URLS,
    getNationColors,
    loadCountryNames as loadCachedCountryNames,
    readJson,
} from "../../runtime/assets.js";
import { flagEmojiFromGid } from "../../runtime/countryFlags.js";
import { readChatsState, writeChatsState } from "../../runtime/gameState.js";

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
// Flag emoji are derived locally from each nation's GID_0 country code. (The
// previous source, restcountries.com, deprecated its public API and no longer
// returns flag data.)

const FALLBACK_FLAG = "🏳";

const getCountryFlag = ({ code } = {}) => flagEmojiFromGid(code) ?? FALLBACK_FLAG;

const useCountryFlag = ({ code } = {}) =>
    useMemo(() => getCountryFlag({ code }), [code]);

const useCountryFlags = (countries) => {
    const depsKey = countries.map(c => `${c.name}:${c.code ?? ""}`).join(",");
    return useMemo(() => {
        const flags = {};
        for (const { name, code } of countries) flags[name] = getCountryFlag({ code });
        return flags;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [depsKey]);
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
    <path d="m3.5 6.5 8.5 6 8.5-6" stroke={filled ? "rgba(17,24,39,0.9)" : "currentColor"} />
    </svg>
);





// ── Message bubble ────────────────────────────────────────────────────────────

const MessageBubble = ({ msg, onRetry }) => {
    const isPlayer = msg.role === "user";
    const isError  = msg.role === "error";
    const flag     = useCountryFlag(isPlayer || isError ? {} : { code: msg.code, name: msg.speaker });
    const reactions = Object.entries(msg.reactions ?? {});
    const reactionFlags = useCountryFlags(reactions.map(([name, { code }]) => ({ name, code })));
    const nationColor = useNationColor(!isPlayer && !isError ? msg.code : null);
    const accentColor = nationColor ?? ((!isPlayer && !isError) ? countryAccentColor(msg.speaker ?? "") : null);

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: isPlayer ? "flex-end" : "flex-start", overflow: "visible" }}>
        <div style={{ position: "relative", maxWidth: "90%", overflow: "visible" }}>

        {!isPlayer && (
            <span style={{
                display: "block",
                fontSize: "0.7rem",
                color: "rgba(255,255,255,0.4)",
                       marginBottom: "0.25rem",
                       whiteSpace: "nowrap",
            }}>
            {isError ? "⚠️ Error" : `${flag} ${msg.speaker}`}
            </span>
        )}

        {isPlayer && reactions.length > 0 && (
            <div style={{ display: "flex", flexDirection: "row-reverse", gap: "0.15rem", marginBottom: "0.3rem" }}>
            {reactions.map(([country, { emoji, code }]) => (
                <ReactionBubble key={country} country={country} emoji={emoji} flag={reactionFlags[country] ?? "🏳"} code={code} />
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
            : `color-mix(in srgb, ${accentColor} 5%, rgba(30,35,50,0.95))`,
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

const ReactionBubble = ({ country, emoji, flag, code }) => {
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
                                                    backgroundColor: "rgba(17,24,39,0.95)",
                                                    border: "1px solid rgba(255,255,255,0.12)",
                                                    borderRadius: "6px",
                                                    padding: "0.2rem 0.45rem",
                                                    fontSize: "0.7rem",
                                                    color: "rgba(255,255,255,0.85)",
                                                    whiteSpace: "nowrap",
                                                    pointerEvents: "none",
                                                    zIndex: 99999,
        }}>
        {flag} {country}
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
            ? `color-mix(in srgb, ${nationColor} 25%, rgba(20,28,48,0.98))`
            : "rgba(30,40,60,0.95)",
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
    const flag = useCountryFlag({ code, name: speaker });
    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <span style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)", marginBottom: "0.25rem" }}>{flag} {speaker}</span>
        <div style={{ padding: "0.6rem 0.85rem", borderRadius: "12px 12px 12px 4px", backgroundColor: "rgba(255,255,255,0.08)", fontSize: "0.85rem" }}>
        <ThinkingDots />
        </div>
        </div>
    );
};

// ── Country selector ──────────────────────────────────────────────────────────

const CountryTile = ({ country, code, flag, isSelected, onToggle }) => {
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
        <span style={{ fontSize: "1.6rem", lineHeight: 1 }}>{flag}</span>
        <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.8)", textAlign: "center", lineHeight: 1.3 }}>{shortName}</span>
        </button>
    );
};

const CountrySelectorModal = ({ countries, loading, onStart, onCancel }) => {
    const [search, setSearch]     = React.useState("");
    const [selected, setSelected] = React.useState([]);
    const filtered      = useMemo(() => countries.filter(c => c.name.toLowerCase().includes(search.toLowerCase())), [countries, search]);
    const filteredFlags = useCountryFlags(filtered);
    const selectedFlags = useCountryFlags(selected);
    const isSelectedName = (name) => selected.some(s => s.name === name);
    const toggle = ({ name, code }) => setSelected(prev => prev.some(s => s.name === name) ? prev.filter(s => s.name !== name) : [...prev, { name, code }]);

    return (
        <div style={{ position: "absolute", inset: 0, backgroundColor: "rgba(17,24,39,0.98)", borderRadius: "16px", display: "flex", flexDirection: "column", zIndex: 10 }}>
        <div style={{ padding: "1.1rem 1.25rem 0.6rem", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
        <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "white" }}>Start New Diplomatic Chat</div>
        <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.4)", marginTop: "0.2rem" }}>Select countries to invite to the conversation</div>
        </div>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.5)", fontSize: "1.1rem", padding: "0.1rem 0.3rem", borderRadius: "6px", lineHeight: 1 }}
        onMouseEnter={e => { e.currentTarget.style.color = "white"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.5)"; e.currentTarget.style.background = "none"; }}>✕</button>
        </div>
        <div style={{ marginTop: "0.85rem", padding: "0.65rem 0.9rem", borderRadius: "10px", backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>Selected Countries ({selected.length}):</div>
        <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.35)", marginTop: "0.2rem" }}>
        {selected.length === 0 ? "No countries selected yet" : selected.map(c => `${selectedFlags[c.name] ?? "🏳"} ${c.name}`).join(", ")}
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
            <CountryTile key={c.name} country={c.name} code={c.code} flag={filteredFlags[c.name] ?? "🏳"} isSelected={isSelectedName(c.name)} onToggle={() => toggle(c)} />
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
        Chat with {selected.length} {selected.length === 1 ? "country" : "countries"}
        </button>
        </div>
        </div>
    );
};

// ── Conversation view ─────────────────────────────────────────────────────────

const ConversationView = ({ chat, playerCountry, gameDate, onDelete, onBack, onMessagesUpdate, unread = false, onToggleRead }) => {
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
        countries.forEach(({ name, code }) => getCountryFlag({ code, name }));
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

        // Re-sends the message that failed. The error bubble is dropped first so
        // a successful retry leaves the thread reading as if nothing went wrong;
        // a second failure just pushes a fresh one. sendDiplomaticMessage already
        // rolls its own history back on error, so the model sees no duplicate.
        const handleRetry = async (index) => {
            if (isLoading) return;
            const retry = messagesRef.current[index]?.retry;
            if (!retry) return;
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
            {/* Retry is offered on the last message only: an older error has
                already been answered past, and re-running it would splice a
                reply into the middle of the thread. */}
            {messages.map((msg, i) => (
                <MessageBubble key={i} msg={msg} chatCountries={countries}
                onRetry={msg.retry && !isLoading && i === messages.length - 1 ? () => handleRetry(i) : undefined} />
            ))}
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
    const flag = useCountryFlag({ code: country.code, name: country.name });
    return (
        <>
        {flag} <strong style={{ color: "rgba(255,255,255,0.65)", fontWeight: 600 }}>{country.name}</strong> would like to respond
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

// Sits above the chat list while isChatGenerationLikely() is true (an idle-
// diplomacy roll or a jump/game-master command in flight) — the visible half
// of "before the chat is generated": a note that's about to exist doesn't
// read as a stuck panel while the player is looking right at an empty list.
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
    const flagMap  = useCountryFlags(previewCountries);
    const flags    = previewCountries.map(c => flagMap[c.name] ?? "🏳").join(" ");
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
        <div style={{ fontSize: "1.3rem", flexShrink: 0, lineHeight: 1 }}>{flags}</div>
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

// Bridge so the map region popup can request a diplomatic chat with a country.
const _chatOpenSubs = new Set();
export const requestDiplomaticChat = (country) => {
    if (!country || !country.name) return;
    _chatOpenSubs.forEach((fn) => { try { fn(country); } catch { /* noop */ } });
};

const ChatPanel = ({ isOpen, onClose, requestedCountry, onConsumeRequest, isGenerating = false }) => {
    const [countries, setCountries]               = useState([]);
    const [loadingCountries, setLoadingCountries] = useState(true);
    const [playerCountry, setPlayerCountry]       = useState("your nation");
    const [gameDate, setGameDate]                 = useState("");
    const [chats, setChats]                       = useState([]);
    const [activeChat, setActiveChat]             = useState(null);
    const [showSelector, setShowSelector]         = useState(false);
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

    // Opening a chat marks it read immediately (list row clears right away, not
    // just in storage). The effect below keeps it marked read for as long as it
    // stays the active chat, so messages that arrive WHILE the player is looking
    // at it (an incoming reply, a background poll merge) don't get left stranded
    // above the last-seen baseline and resurface as unread on the next visit.
    const openChatFromList = (chat) => {
        setActiveChat(chat);
        setChatReadState(chat, true);
    };

    useEffect(() => {
        if (!activeChat) return;
        setChatReadState(activeChat, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeChat?.id, activeChat?.messages?.length]);

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
            <div style={{ position: "fixed", bottom: isOpen ? "4.25rem" : "-40rem", left: "0rem", width: "26.25rem", maxWidth: "calc(100vw - 1rem)", height: "min(calc(100vh - 9rem), max(calc(100vh - 33rem), 30rem))", minHeight: "10rem", backgroundColor: "rgba(17,24,39,0.95)", backdropFilter: "blur(8px)", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "-4px 0 24px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.06)", zIndex: 9998, overflow: "hidden", transition: "bottom 0.35s cubic-bezier(0.4,0,0.2,1),opacity 0.35s ease", opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? "auto" : "none", fontFamily: "sans-serif", color: "white", display: "flex", flexDirection: "column" }}>

            {showSelector && <CountrySelectorModal countries={availableCountries} loading={loadingCountries} onStart={handleStartChat} onCancel={() => setShowSelector(false)} />}

            {activeChat && Array.isArray(activeChat.countries) && activeChat.countries.length > 0 ? (
                <ConversationView chat={activeChat} playerCountry={playerCountry} gameDate={gameDate} onDelete={() => handleDeleteChat(activeChat.id)} onBack={() => setActiveChat(null)} onMessagesUpdate={handleMessagesUpdate}
                unread={unreadIds.has(String(activeChat.id))} onToggleRead={() => setChatReadState(activeChat, unreadIds.has(String(activeChat.id)))} />
            ) : (
                <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.25rem 0.75rem", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                <span style={{ fontWeight: 700, fontSize: "1rem" }}>Diplomatic Chats</span>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: "1.1rem", lineHeight: 1, padding: "0.15rem 0.3rem", borderRadius: "6px" }}
                onMouseEnter={e => { e.currentTarget.style.color = "white"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.5)"; e.currentTarget.style.background = "none"; }}>✕</button>
                </div>
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
            </div>
            </>
        );
};

// ── Chat toolbar button ───────────────────────────────────────────────────────

const Chat = ({ hovered, setHovered, isOpen, onToggle }) => {
    const [hasOpened, setHasOpened] = useState(false);
    const [pendingCountry, setPendingCountry] = useState(null);
    const [unseenCount, setUnseenCount] = useState(0);
    const [isGenerating, setIsGenerating] = useState(false);
    const setChatOpen = () => { onToggle(); };

    // "Someone might be typing": isChatGenerationLikely() is a plain synchronous
    // getter (idle-diplomacy roll or a jump/game-master command in flight), not
    // an event — polled at a fast, animation-friendly cadence so the badge and
    // the panel's banner (below) feel live rather than laggy. Runs regardless of
    // isOpen (unlike the unread poll) since the panel's own banner needs it too.
    useEffect(() => {
        const iv = setInterval(() => setIsGenerating(isChatGenerationLikely()), 800);
        return () => clearInterval(iv);
    }, []);

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
            // The badge only READS the baseline (bar the one-time seed below) —
            // it is advanced solely by opening a chat or "Mark all read". While
            // the panel is open the badge is behind it and says nothing; closing
            // re-runs this effect, so whatever is still genuinely unread comes
            // straight back rather than being silently cleared by the visit.
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
            {hasOpened && <ChatPanel isOpen={isOpen} onClose={onToggle} requestedCountry={pendingCountry} onConsumeRequest={() => setPendingCountry(null)} isGenerating={isGenerating} />}
            <button title={isGenerating ? "Chat — diplomacy in progress" : "Chat"} style={{ width: "3.3rem", height: "3.3rem", borderRadius: "10px", border: hovered ? "1px solid rgba(255,255,255,0.2)" : isOpen ? "1px solid rgba(139,92,246,0.5)" : "1px solid rgba(255,255,255,0.1)", background: isOpen ? "linear-gradient(145deg,rgba(109,40,217,0.4),rgba(76,29,149,0.4))" : hovered ? "linear-gradient(145deg,rgba(40,55,80,0.95),rgba(20,30,50,0.95))" : "linear-gradient(145deg,rgba(30,42,65,0.95),rgba(15,22,40,0.95))", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.12s ease", boxShadow: hovered ? "inset 0 1px 0 rgba(255,255,255,0.1),0 2px 8px rgba(0,0,0,0.4)" : "inset 0 1px 0 rgba(255,255,255,0.06),inset 0 -1px 0 rgba(0,0,0,0.3),0 2px 6px rgba(0,0,0,0.35)", fontSize: "1.2rem", outline: "none", transform: hovered ? "translateY(-1px)" : "translateY(0)", color: "white", fontFamily: "sans-serif", flexShrink: 0 }}
            onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
            onClick={() => setChatOpen(o => !o)}>
            <span style={{ position: "relative", display: "inline-flex" }}>
                💬
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

const Toolbar = memo(({ onOpenAdvisor, activePanel, onTogglePanel, mapRef }) => {
    const [hoveredChat, setHoveredChat]       = useState(false);
    const [hoveredActions, setHoveredActions] = useState(false);
    const [hoveredProjects, setHoveredProjects] = useState(false);
    return (
        <div style={{ position: "fixed", bottom: "0.5rem", left: "0.5rem", height: "4rem", width: "12.8rem", gap: "0.75rem", padding: "0 0.1rem", backgroundColor: "rgba(17,24,39,0.9)", backdropFilter: "blur(4px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontFamily: "sans-serif", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 24px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.05)" }}>
        <Chat hovered={hoveredChat} setHovered={setHoveredChat} isOpen={activePanel === "chat"} onToggle={() => onTogglePanel("chat")} />
        <Actions onOpenAdvisor={onOpenAdvisor} hovered={hoveredActions} setHovered={setHoveredActions} isOpen={activePanel === "actions"} onToggle={() => onTogglePanel("actions")} />
        <Projects onOpenAdvisor={onOpenAdvisor} mapRef={mapRef} hovered={hoveredProjects} setHovered={setHoveredProjects} isOpen={activePanel === "projects"} onToggle={() => onTogglePanel("projects")} />
        </div>
    );
});

export { Toolbar, Chat, ChatPanel };
