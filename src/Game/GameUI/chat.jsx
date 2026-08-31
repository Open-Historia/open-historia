/*! Open Historia — portions (era diplomacy + mobile panel sizing) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import ReactMarkdown from "react-markdown";
import { appendDiplomaticPlayerMessage, sendDiplomaticMessage, startDiplomaticChat, loadDiplomaticHistory } from "../AI/main.jsx";
import { chooseNextDiplomaticSpeaker, processPendingEventOutreach } from "../AI/gameplay.js";
import { Actions } from "./actions";
import {
    getNationColors,
    getNationFlags,
    JSON_URLS,
    loadCountryNames as loadCachedCountryNames,
} from "../../runtime/assets.js";
import { resolvePolityFlag } from "../../runtime/polityFlags.js";
import {
    chatParticipantSetKey,
    mergeIncomingChats,
    readChatsState,
    readChatsStateView,
    readGameData,
    readWorldState,
    readWorldStateView,
    reconcileChatsForPlayer,
    resolveChatParticipantIdentity,
    writeChatsState,
} from "../../runtime/gameState.js";

// ── Storage ───────────────────────────────────────────────────────────────────

const saveAllChats = async (chats, { world = null, playerCountry = "" } = {}) => {
    try {
        await writeChatsState(chats, { world, playerCountry });
    } catch (err) { console.error("Failed to save chats:", err); }
};

const loadAllChats = async ({ force = false, world = null, playerCountry = "" } = {}) => {
    try {
        if (!world) return await readChatsStateView({ force });
        return await readChatsState({ force, world, playerCountry });
    } catch { return []; }
};

// Polling must stay structural/cheap. Semantic reconciliation walks every chat
// message through the save-aware polity resolver; doing that every five seconds
// can monopolize the browser main thread on established campaigns. These helpers
// detect whether storage actually contains NEW information before paying that cost.
const chatStorageSignature = (list) => (Array.isArray(list) ? list : []).map((chat) => {
    const countries = (chat?.countries ?? [])
        .map((country) => country?.polityKey || country?.name || country?.code || "")
        .join(",");
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    const last = messages.at(-1);
    return [
        chat?.id ?? "",
        chat?.status ?? "",
        countries,
        messages.length,
        last?.role ?? "",
        last?.speaker ?? "",
        last?.time ?? "",
        last?.text ?? "",
    ].join("\u001e");
}).join("\u001f");

const chatsNeedIdentityMigration = (list) =>
    (Array.isArray(list) ? list : []).some((chat) =>
        (Array.isArray(chat?.countries) ? chat.countries : []).some((country) =>
            country && typeof country === "object" && !String(country?.polityKey || "").trim()
        )
    );

const storageAddsChatInformation = (local, stored) => {
    const localById = new Map((Array.isArray(local) ? local : []).map((chat) => [String(chat?.id ?? ""), chat]));
    for (const chat of Array.isArray(stored) ? stored : []) {
        const current = localById.get(String(chat?.id ?? ""));
        if (!current) return true;
        if ((chat?.status ?? "open") !== (current?.status ?? "open")) return true;

        const storedMessages = Array.isArray(chat?.messages) ? chat.messages : [];
        const localMessages = Array.isArray(current?.messages) ? current.messages : [];
        if (storedMessages.length > localMessages.length) return true;

        // Same count but different tail can happen when an external writer edits or
        // replaces a message rather than appending one. Treat that as new information.
        if (storedMessages.length === localMessages.length && storedMessages.length > 0) {
            const a = storedMessages.at(-1);
            const b = localMessages.at(-1);
            if (String(a?.text ?? "") !== String(b?.text ?? "") ||
                String(a?.speaker ?? "") !== String(b?.speaker ?? "") ||
                String(a?.time ?? "") !== String(b?.time ?? "")) {
                return true;
            }
        }
    }
    return false;
};

// ── PMTiles country loader ────────────────────────────────────────────────────

const loadCountryNames = async () => {
    return loadCachedCountryNames();
};

const rawIdentityTokens = (entry) => {
    if (typeof entry === "string") return [entry];
    return [entry?.polityKey, entry?.name, entry?.code];
};

const countryMatchesIdentity = (country, identity, world = null) => {
    if (world) {
        const left = resolveChatParticipantIdentity(country, world);
        const right = resolveChatParticipantIdentity(
            typeof identity === "string" ? { name: identity } : identity,
            world,
        );
        if (left.safe && right.safe && left.polityKey && right.polityKey) {
            return left.polityKey.toLowerCase() === right.polityKey.toLowerCase();
        }
    }

    const left = rawIdentityTokens(country)
        .map(value => String(value ?? "").trim().toLowerCase())
        .filter(Boolean);
    const right = rawIdentityTokens(identity)
        .map(value => String(value ?? "").trim().toLowerCase())
        .filter(Boolean);
    return left.some(value => right.includes(value));
};

const polityIdentitySignature = (world) => JSON.stringify(
    Object.entries(world?.polityOverrides || {})
        .sort(([a], [b]) => String(a).localeCompare(String(b)))
        .map(([key, record]) => [
            key,
            String(record?.name || ""),
            String(record?.code || ""),
            String(record?.status || ""),
            [...(Array.isArray(record?.aliases) ? record.aliases : [])]
                .map((value) => String(value || ""))
                .sort(),
        ]),
);

const canonicalCountry = (country, world) => {
    if (!country || !world) return country;

    // The selector is fed by the map/asset catalog, whose entries do not always
    // carry a stable polityKey after a mid-campaign rename. Map popups already
    // know the owner lineage directly, but the selector may only have the new
    // display name ("Austria-Hungary"). Bind an exact current name/code/alias
    // match back to the declared stable key before falling through to the general
    // resolver. Exact-only keeps rival/civil-war identities fail-safe.
    const rawName = String(country?.name ?? "").trim().toLowerCase();
    const rawCode = String(country?.code ?? "").trim().toLowerCase();
    const rawKey = String(country?.polityKey ?? country?.identityKey ?? "").trim().toLowerCase();
    const declaredMatches = Object.entries(world?.polityOverrides || {}).filter(([key, record]) => {
        const tokens = [
            key,
            record?.code,
            record?.name,
            ...(Array.isArray(record?.aliases) ? record.aliases : []),
        ]
            .map((value) => String(value ?? "").trim().toLowerCase())
            .filter(Boolean);
        return (rawKey && tokens.includes(rawKey)) ||
            (rawName && tokens.includes(rawName)) ||
            (rawCode && tokens.includes(rawCode));
    });

    if (declaredMatches.length === 1) {
        const [polityKey, record] = declaredMatches[0];
        return {
            ...country,
            polityKey,
            name: String(record?.name || country?.name || polityKey).trim(),
            // Preserve the catalog code as presentation metadata. Political
            // identity is the stable key above, never this field.
            code: country?.code || record?.code || polityKey,
        };
    }

    const resolved = resolveChatParticipantIdentity(country, world);
    if (!resolved.safe || !resolved.participant) return country;
    return {
        ...resolved.participant,
        // The catalog's compact map code is presentation metadata used for flags.
        // Keep it when present while polityKey remains the political identity.
        code: country.code || resolved.participant.code || "",
    };
};

// ── Flags ─────────────────────────────────────────────────────────────────────
// Diplomacy now renders the same image-backed polity flags as the map. Political
// identity comes from polityKey/lineage; a GADM code is only an asset fallback.
// One provider per open panel means flags.json is loaded once, not once per row.
const FlagContext = React.createContext({ flags: {}, world: null });

const useCountryFlag = (country = {}) => {
    const { flags, world } = React.useContext(FlagContext);
    return useMemo(
        () => resolvePolityFlag({ polity: country, world, flags }),
        [country?.polityKey, country?.name, country?.code, world, flags],
    );
};

const useCountryFlags = (countries) => {
    const { flags, world } = React.useContext(FlagContext);
    const depsKey = (countries || []).map(c => `${c?.polityKey ?? ""}:${c?.name ?? ""}:${c?.code ?? ""}`).join(",");
    return useMemo(() => {
        const resolved = {};
        for (const country of countries || []) {
            const key = country?.polityKey || country?.name || country?.code || "";
            if (!key) continue;
            const info = resolvePolityFlag({ polity: country, world, flags });
            resolved[key] = info;
            if (country?.name) resolved[country.name] = info;
        }
        return resolved;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [depsKey, world, flags]);
};

const FlagMark = ({ info, width = 22, height = 14, radius = 2 }) => {
    if (info?.imageUrl) {
        return <img src={info.imageUrl} alt="" style={{ width, height, objectFit: "cover", borderRadius: radius, display: "inline-block", flexShrink: 0, boxShadow: "0 0 0 1px rgba(255,255,255,0.16)" }} />;
    }
    return <span aria-label="No flag" style={{ width, height, borderRadius: radius, display: "inline-block", flexShrink: 0, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.04)" }} />;
};

const FlagStack = ({ countries, max = 4 }) => {
    const shown = (countries || []).slice(0, max);
    const resolved = useCountryFlags(shown);
    return (
        <span style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, paddingRight: shown.length > 1 ? "0.35rem" : 0 }}>
        {shown.map((country, index) => {
            const key = country?.polityKey || country?.name || country?.code || String(index);
            return (
                <span key={key} style={{ display: "inline-flex", marginLeft: index === 0 ? 0 : "-0.35rem", zIndex: shown.length - index }}>
                <FlagMark info={resolved[key] || resolved[country?.name]} width={24} height={15} radius={2} />
                </span>
            );
        })}
        </span>
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

const NationColorContext = React.createContext({});

const useNationColor = (code) => {
    const map = React.useContext(NationColorContext);
    return useMemo(() => nationColorFromCode(code, map), [code, map]);
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

const MessageBubble = memo(function MessageBubble({ msg }) {
    const isPlayer = msg.role === "user";
    const isError  = msg.role === "error";
    const flag     = useCountryFlag(isPlayer || isError ? {} : { code: msg.code, name: msg.speaker, polityKey: msg.polityKey });
    const reactions = Object.entries(msg.reactions ?? {});
    const reactionFlags = useCountryFlags(reactions.map(([name, { code, polityKey }]) => ({ name, code, polityKey })));
    const nationColor = useNationColor(!isPlayer && !isError ? msg.code : null);
    const accentColor = nationColor ?? ((!isPlayer && !isError) ? countryAccentColor(msg.speaker ?? "") : null);

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: isPlayer ? "flex-end" : "flex-start", overflow: "visible", contentVisibility: "auto", containIntrinsicSize: "0 88px" }}>
        <div style={{ position: "relative", maxWidth: "90%", overflow: "visible" }}>

        {!isPlayer && (
            <span style={{
                display: "block",
                fontSize: "0.7rem",
                color: "rgba(255,255,255,0.4)",
                       marginBottom: "0.25rem",
                       whiteSpace: "nowrap",
            }}>
            {isError ? "⚠️ Error" : <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}><FlagMark info={flag} width={18} height={11} /> <span>{msg.speaker}</span></span>}
            </span>
        )}

        {isPlayer && reactions.length > 0 && (
            <div style={{ display: "flex", flexDirection: "row-reverse", gap: "0.15rem", marginBottom: "0.3rem" }}>
            {reactions.map(([country, { emoji, code }]) => (
                <ReactionBubble key={country} country={country} emoji={emoji} flag={reactionFlags[country]} code={code} />
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

        </div>
        </div>
    );
});

// ── Reaction bubble ───────────────────────────────────────────────────────────

const ReactionBubble = memo(function ReactionBubble({ country, emoji, flag, code }) {
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
        <FlagMark info={flag} width={18} height={11} /> {country}
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
});

const TypingBubble = memo(function TypingBubble({ speaker, code, polityKey }) {
    const flag = useCountryFlag({ code, name: speaker, polityKey });
    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <span style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)", marginBottom: "0.25rem", display: "flex", alignItems: "center", gap: "0.3rem" }}><FlagMark info={flag} width={18} height={11} /> {speaker}</span>
        <div style={{ padding: "0.6rem 0.85rem", borderRadius: "12px 12px 12px 4px", backgroundColor: "rgba(255,255,255,0.08)", fontSize: "0.85rem" }}>
        <ThinkingDots />
        </div>
        </div>
    );
});

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
        <FlagMark info={flag} width={30} height={19} radius={3} />
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
    const selectionKey = (country) => country?.polityKey || country?.code || country?.name || "";
    const isSelectedCountry = (country) => selected.some(s => selectionKey(s) === selectionKey(country));
    const toggle = (country) => setSelected(prev =>
        prev.some(s => selectionKey(s) === selectionKey(country))
            ? prev.filter(s => selectionKey(s) !== selectionKey(country))
            : [...prev, country]
    );

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
        {selected.length === 0 ? "No countries selected yet" : (
            <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: "0.45rem" }}>
            {selected.map((c, index) => {
                const key = selectionKey(c);
                const info = selectedFlags[key] || selectedFlags[c.name];
                return (
                    <span key={key || `${c.name}-${index}`} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                    <FlagMark info={info} width={18} height={11} />
                    <span>{c.name}{index < selected.length - 1 ? "," : ""}</span>
                    </span>
                );
            })}
            </span>
        )}
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
            <CountryTile key={c.polityKey || c.code || c.name} country={c.name} code={c.code} flag={filteredFlags[c.polityKey || c.name || c.code] || filteredFlags[c.name]} isSelected={isSelectedCountry(c)} onToggle={() => toggle(c)} />
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

// A group can have a short natural burst of replies, but never an endless model
// parliament. Each NPC may speak at most once per player message and the burst is
// capped even in very large conferences.
const MAX_GROUP_NPC_RESPONSES_PER_PLAYER_MESSAGE = 3;
const CHAT_INITIAL_RENDER_WINDOW = 4;
const CHAT_AUTO_RENDER_TARGET = 12;
const CHAT_RENDER_WINDOW_STEP = 40;
const CHAT_PROGRESSIVE_RENDER_STEP = 1;
const CHAT_AI_HISTORY_WINDOW = 24;
const CHAT_LIST_INITIAL_WINDOW = 12;
const CHAT_LIST_WINDOW_STEP = 12;

const ConversationView = memo(function ConversationView({ chat, playerCountry, world, gameDate, onDelete, onBack, onMessagesUpdate }) {
    // Two-step delete, matching the list row. Disarms on blur so a half-pressed
    // delete never sits waiting to catch a later click.
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const playerIdentity = useMemo(
        () => world ? resolveChatParticipantIdentity({ name: playerCountry }, world) : null,
        [playerCountry, world],
    );
    const playerDisplayName = playerIdentity?.safe
        ? playerIdentity.participant.name
        : playerCountry;
    const playerPolityKey = playerIdentity?.safe ? playerIdentity.polityKey : "";
    const countries = useMemo(
        () => Array.isArray(chat?.countries)
            ? chat.countries
                .filter((country) => country && (country.name || country.code))
                .map((country) => canonicalCountry(country, world))
                .filter((country) => !countryMatchesIdentity(country, playerCountry, world))
            : [],
        [chat?.countries, playerCountry, world],
    );
    const isGroup = countries.length > 1;

    const [messages, setMessages]               = useState(chat.messages ?? []);
    const [phase, setPhase]                     = useState("player");
    const [isLoading, setIsLoading]             = useState(false);
    const [playerInput, setPlayerInput]         = useState("");
    const [pendingCountry, setPendingCountry]   = useState(null);
    const [speakingCountry, setSpeakingCountry] = useState(null);
    const [visibleMessageLimit, setVisibleMessageLimit] = useState(CHAT_INITIAL_RENDER_WINDOW);

    const lastPlayerMessage = useRef("");
    const messagesEndRef    = useRef(null);
    const messagesRef       = useRef(chat.messages ?? []);
    const groupSpeakersThisTurnRef = useRef([]);

    useEffect(() => {
        // Flag images resolve lazily from the shared cached catalog.
    }, [countries]);

    useEffect(() => {
        const saved = chat.messages ?? [];
        setVisibleMessageLimit(Math.min(CHAT_INITIAL_RENDER_WINDOW, Math.max(1, saved.length)));

        let cancelled = false;
        let idleHandle = null;
        let timer = null;

        // UI and AI context are separate concerns. Paint a small recent tail first;
        // then hydrate the bounded diplomatic model history after the browser has had
        // a chance to render. Rolling memorySummary exists specifically so a long
        // negotiation does not require replaying hundreds of messages on every open.
        const hydrateAiHistory = () => {
            if (cancelled) return;
            if (saved.length > 0) {
                loadDiplomaticHistory(saved.slice(-CHAT_AI_HISTORY_WINDOW));
            } else {
                startDiplomaticChat();
            }
        };

        if (typeof window.requestIdleCallback === "function") {
            idleHandle = window.requestIdleCallback(hydrateAiHistory, { timeout: 1800 });
        } else {
            timer = window.setTimeout(hydrateAiHistory, 50);
        }

        return () => {
            cancelled = true;
            if (idleHandle != null && typeof window.cancelIdleCallback === "function") {
                window.cancelIdleCallback(idleHandle);
            }
            if (timer) window.clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chat.id]);

    const visibleMessages = useMemo(
        () => messages.length > visibleMessageLimit
            ? messages.slice(messages.length - visibleMessageLimit)
            : messages,
        [messages, visibleMessageLimit],
    );
    const hiddenMessageCount = Math.max(0, messages.length - visibleMessages.length);

    useEffect(() => {
        const target = Math.min(CHAT_AUTO_RENDER_TARGET, messages.length);
        if (visibleMessageLimit >= target) return undefined;

        let cancelled = false;
        let idleHandle = null;
        let timer = null;
        const reveal = () => {
            if (cancelled) return;
            setVisibleMessageLimit((current) =>
                Math.min(target, current + CHAT_PROGRESSIVE_RENDER_STEP)
            );
        };

        if (typeof window.requestIdleCallback === "function") {
            idleHandle = window.requestIdleCallback(reveal, { timeout: 700 });
        } else {
            timer = window.setTimeout(reveal, 16);
        }

        return () => {
            cancelled = true;
            if (idleHandle != null && typeof window.cancelIdleCallback === "function") {
                window.cancelIdleCallback(idleHandle);
            }
            if (timer) window.clearTimeout(timer);
        };
    }, [messages.length, visibleMessageLimit]);

        useEffect(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
        }, [messages, isLoading, phase]);

        const pushMessages = (updated) => {
            messagesRef.current = updated;
            setMessages(updated);
            onMessagesUpdate(chat.id, updated);
        };

        const isPlayerCountry = (country) => countryMatchesIdentity(country, playerCountry, world);

        const chooseResponsiveSpeaker = async (updatedMessages) => {
            const alreadySpoken = groupSpeakersThisTurnRef.current;
            if (alreadySpoken.length >= MAX_GROUP_NPC_RESPONSES_PER_PLAYER_MESSAGE) return null;

            const suggestedSpeaker = await chooseNextDiplomaticSpeaker({
                chat: {
                    ...chat,
                    countries,
                    messages: updatedMessages,
                },
                excludeSpeaker: updatedMessages.at(-1)?.speaker || updatedMessages.at(-1)?.role || "",
                excludedSpeakers: alreadySpoken.map((country) => country.name),
            }).catch(() => "");

            if (!suggestedSpeaker) return null;

            return countries.find((country) =>
                !alreadySpoken.some((spoken) => countryMatchesIdentity(country, spoken, world)) &&
                countryMatchesIdentity(country, suggestedSpeaker, world)
            ) || null;
        };

        const offerNextCountry = (country) => {
            if (!country || isPlayerCountry(country)) {
                setPendingCountry(null);
                setPhase("player");
                return;
            }
            setPendingCountry(country);
            setPhase("pending");
        };

        const fetchLeaderResponse = async (country, playerMessage, { continueGroup = false } = {}) => {
            if (!country || isPlayerCountry(country)) {
                setPendingCountry(null);
                setPhase("player");
                return;
            }

            setIsLoading(true);
            setSpeakingCountry(country);
            let updatedMessages = null;
            let replySucceeded = false;
            try {
                const { reply, reaction, memorySummary } = await sendDiplomaticMessage(
                    playerMessage,
                    country.name,
                    countries,
                    {
                        appendPlayerMessage: false,
                        messageTime: gameDate,
                    },
                );

                const leaderMessage = {
                    role: "leader",
                    speaker: country.name,
                    code: country.code,
                    polityKey: country.polityKey || "",
                    text: reply,
                    time: gameDate,
                    ...(memorySummary ? { memorySummary } : {}),
                };

                if (reaction) {
                    const msgs = [...messagesRef.current];
                    const lastUserIdx = msgs.map(m => m.role).lastIndexOf("user");
                    if (lastUserIdx !== -1) {
                        msgs[lastUserIdx] = {
                            ...msgs[lastUserIdx],
                            reactions: { ...(msgs[lastUserIdx].reactions ?? {}), [country.name]: { emoji: reaction, code: country.code, polityKey: country.polityKey || "" } },
                        };
                    }
                    updatedMessages = [...msgs, leaderMessage];
                } else {
                    updatedMessages = [...messagesRef.current, leaderMessage];
                }

                pushMessages(updatedMessages);
                replySucceeded = true;
            } catch (err) {
                updatedMessages = [...messagesRef.current, { role: "error", speaker: country.name, code: country.code, polityKey: country.polityKey || "", text: err.message, time: gameDate }];
                pushMessages(updatedMessages);
            } finally {
                setIsLoading(false);
                setSpeakingCountry(null);
            }

            if (!continueGroup || !replySucceeded) {
                setPhase("player");
                return;
            }

            groupSpeakersThisTurnRef.current = [
                ...groupSpeakersThisTurnRef.current,
                country,
            ];

            if (groupSpeakersThisTurnRef.current.length >= MAX_GROUP_NPC_RESPONSES_PER_PLAYER_MESSAGE) {
                setPhase("player");
                return;
            }

            // Do NOT walk a prebuilt queue. After every actual reply, ask whether
            // anybody else has a distinct reason to take the floor. Null = player turn.
            setPhase("choosing");
            const next = await chooseResponsiveSpeaker(updatedMessages);
            offerNextCountry(next);
        };

        const handlePlayerSubmit = async () => {
            const text = playerInput.trim();
            if (!text || isLoading || phase === "choosing") return;
            if (countries.length === 0) {
                pushMessages([...messagesRef.current, { role: "error", speaker: "System", text: "This chat has no valid participants.", time: gameDate }]);
                return;
            }

            lastPlayerMessage.current = text;
            const nextMessages = [...messagesRef.current, {
                role: "user",
                speaker: playerDisplayName,
                polityKey: playerPolityKey,
                text,
                time: gameDate,
            }];
            pushMessages(nextMessages);
            appendDiplomaticPlayerMessage(text, gameDate, playerDisplayName);
            setPlayerInput("");

            if (!isGroup) {
                // Bilateral diplomacy remains dependable: the one counterpart answers.
                await fetchLeaderResponse(countries[0], text, { continueGroup: false });
                return;
            }

            groupSpeakersThisTurnRef.current = [];
            setPhase("choosing");
            const next = await chooseResponsiveSpeaker(nextMessages);
            offerNextCountry(next);
        };

        const handleSpeakInstead = () => {
            setPendingCountry(null);
            setPhase("player");
        };

        const handleLetSpeak = async () => {
            const country = pendingCountry;
            setPendingCountry(null);
            await fetchLeaderResponse(country, lastPlayerMessage.current, { continueGroup: true });
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
                    Show {Math.min(hiddenMessageCount, CHAT_RENDER_WINDOW_STEP)} earlier message{Math.min(hiddenMessageCount, CHAT_RENDER_WINDOW_STEP) === 1 ? "" : "s"}
                </button>
            )}
            {visibleMessages.map((msg, i) => {
                const previous = visibleMessages[i - 1];
                const dateKey = chatDateKey(msg?.time);
                const previousDateKey = chatDateKey(previous?.time);
                const showDateSeparator = Boolean(dateKey) && (i === 0 || dateKey !== previousDateKey);

                return (
                    <React.Fragment key={`${messages.length - visibleMessages.length + i}-${dateKey || "undated"}`}>
                    {showDateSeparator && <ChatDateSeparator value={msg.time} />}
                    <MessageBubble msg={msg} />
                    </React.Fragment>
                );
            })}
            {isLoading && typingSpeaker && <TypingBubble speaker={typingSpeaker.name} code={typingSpeaker.code} polityKey={typingSpeaker.polityKey} />}
            <div ref={messagesEndRef} />
            </div>

            {phase === "pending" && !isLoading && pendingCountry ? (
                <div style={{ padding: "0.75rem 1rem 0.9rem", borderTop: "1px solid rgba(255,255,255,0.07)", backgroundColor: "rgba(0,0,0,0.15)", flexShrink: 0 }}>
                <p style={{ margin: "0 0 0.55rem 0", fontSize: "0.78rem", color: "rgba(255,255,255,0.35)", textAlign: "center" }}>
                <CountryTurnLabel country={pendingCountry} />
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
});

const CountryTurnLabel = ({ country }) => {
    const flag = useCountryFlag(country);
    return (
        <>
        <FlagMark info={flag} width={18} height={11} /> <strong style={{ color: "rgba(255,255,255,0.65)", fontWeight: 600 }}>{country.name}</strong> would like to respond
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

// ── Incoming diplomacy notifications ──────────────────────────────────────────
//
// The toolbar already performs a cheap stored-chat poll for its unread badge.
// 5D.4 reuses THAT SAME watcher for toasts/sound/notification-center updates;
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
const TOAST_DATE_CONTROL_GAP_PX = 8;
const TOAST_DATE_CONTROL_FALLBACK_RIGHT_PX = 184;

// Keep the pre-5D.4 toolbar's background cadence instead of increasing it.
// Hidden tabs back off further because responsiveness matters less there.
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

const readNotificationCursors = () => {
    try {
        const raw = localStorage.getItem(NOTIFICATION_CURSOR_KEY);
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
        localStorage.setItem(NOTIFICATION_CURSOR_KEY, JSON.stringify(cursors || {}));
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

// Locate the native turn/date control in the top-right. This is intentionally
// presentation-only and runs only when React renders this toolbar component; it
// does NOT add a MutationObserver or polling work.
//
// Prefer the smallest visible element near the top-right whose text looks like
// the game's current date. If the native markup changes, fall back to the tuned
// right offset used by the current UI instead of breaking notifications.
const nativeTopRightDateControlRect = () => {
    if (typeof document === "undefined" || typeof window === "undefined") return null;

    const vw = Math.max(1, window.innerWidth || 0);
    const dateLike = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b[\s\S]{0,24}\b\d{4}\b/i;

    const candidates = [...document.querySelectorAll("button, [role='button'], div")]
        .map((node) => {
            const text = String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
            if (!text || !dateLike.test(text)) return null;

            const rect = node.getBoundingClientRect?.();
            if (!rect) return null;
            if (rect.top < 0 || rect.top > 120) return null;
            if (rect.right < vw * 0.72) return null;
            if (rect.width < 100 || rect.width > 420) return null;
            if (rect.height < 28 || rect.height > 110) return null;

            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return null;

            return { rect, area: rect.width * rect.height };
        })
        .filter(Boolean)
        .sort((a, b) => a.area - b.area);

    return candidates[0]?.rect || null;
};

const toastRightOffsetPx = () => {
    const rect = nativeTopRightDateControlRect();
    if (!rect || typeof window === "undefined") {
        return TOAST_DATE_CONTROL_FALLBACK_RIGHT_PX;
    }

    return Math.max(
        TOAST_DATE_CONTROL_GAP_PX,
        Math.round(window.innerWidth - rect.left + TOAST_DATE_CONTROL_GAP_PX),
    );
};

// ── Chat list item ────────────────────────────────────────────────────────────

// The inbox is chronological by IN-GAME diplomatic activity, not by storage order.
// Scan backwards because a thread may contain old/legacy messages without dates.
const chatLastActivityDate = (chat) => {
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const time = String(messages[index]?.time ?? "").trim();
        if (time) return time;
    }
    return "";
};

const chatActivitySortValue = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return Number.NEGATIVE_INFINITY;

    // ISO in-game dates are the normal shape and sort safely. Date.parse is only
    // a compatibility fallback for older saves that may contain a fuller timestamp.
    const isoDay = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDay) {
        return Date.UTC(Number(isoDay[1]), Number(isoDay[2]) - 1, Number(isoDay[3]));
    }

    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
};

const ChatListDateSeparator = ({ value }) => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", margin: "0.55rem 0 0.15rem" }}>
        <div style={{ height: "1px", flex: 1, background: "rgba(255,255,255,0.09)" }} />
        <span style={{ fontSize: "0.69rem", color: "rgba(255,255,255,0.42)", whiteSpace: "nowrap", fontWeight: 600 }}>
            {value ? formatChatDateLabel(value) : "No dated activity"}
        </span>
        <div style={{ height: "1px", flex: 1, background: "rgba(255,255,255,0.09)" }} />
    </div>
);

const ChatListItem = memo(function ChatListItem({ chat, onClick, onDelete, unread = false }) {
    const [hovered, setHovered] = React.useState(false);
    // Deleting a chat is not undoable, so the bin arms first and deletes on the
    // second click. Resets whenever the pointer leaves the row, so a half-pressed
    // delete never sits waiting to catch a later click.
    const [confirming, setConfirming] = React.useState(false);
    const previewCountries = chat.countries.slice(0, 4);
    const names    = chat.countries.map(c => c.name).join(", ");
    const lastMsg  = chat.messages?.at(-1);
    const preview  = lastMsg ? lastMsg.text.replace(/\*\*/g, "").slice(0, 60) + (lastMsg.text.length > 60 ? "…" : "") : "No messages yet";

    return (
        <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => { setHovered(false); setConfirming(false); }} style={{ position: "relative", contentVisibility: "auto", containIntrinsicSize: "0 64px" }}>
        <button onClick={onClick} style={{ width: "100%", padding: "0.7rem 0.9rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.07)", background: hovered ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)", display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer", transition: "background 0.15s", fontFamily: "sans-serif", textAlign: "left" }}>
        {/* Fixed-width slot, always rendered, so read and unread rows stay aligned. */}
        <div style={{ width: "0.5rem", flexShrink: 0, display: "flex", justifyContent: "center" }} aria-hidden="true">
        {unread && <div style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: "#60a5fa" }} />}
        </div>
        <FlagStack countries={previewCountries} />
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
});

// ── Main ChatPanel ────────────────────────────────────────────────────────────

// Bridge so the map region popup can request a diplomatic chat with a country.
const _chatOpenSubs = new Set();
export const requestDiplomaticChat = (country) => {
    if (!country || !country.name) return;
    _chatOpenSubs.forEach((fn) => { try { fn(country); } catch { /* noop */ } });
};

const ChatPanel = memo(function ChatPanel({ isOpen, onClose, requestedCountry, onConsumeRequest, requestedChatId, onConsumeRequestedChat }) {
    const [countries, setCountries]               = useState([]);
    const [loadingCountries, setLoadingCountries] = useState(true);
    const [playerCountry, setPlayerCountry]       = useState("your nation");
    const [gameDate, setGameDate]                 = useState("");
    const [world, setWorld]                       = useState(null);
    const [identityWorld, setIdentityWorld]       = useState(null);
    const [flagCatalog, setFlagCatalog]           = useState({});
    const [colorCatalog, setColorCatalog]         = useState({});
    const [chats, setChats]                       = useState([]);
    const [activeChat, setActiveChat]             = useState(null);
    const [showSelector, setShowSelector]         = useState(false);
    const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
    const wasOpenRef = useRef(false);
    const identitySignatureRef = useRef("");
    const identityRefreshSeqRef = useRef(0);
    const [visibleChatLimit, setVisibleChatLimit] = useState(CHAT_LIST_INITIAL_WINDOW);
    const openChats = useMemo(
        () => chats.filter((chat) =>
            chat.status !== "closed" &&
            Array.isArray(chat.countries) &&
            chat.countries.length > 0
        ),
        [chats],
    );

    // Expose only the currently VISIBLE conversation to the lightweight watcher.
    // New messages arriving in this exact thread are marked seen and never toast.
    useEffect(() => {
        activeDiplomaticChatId = isOpen && activeChat ? String(activeChat.id) : "";
        if (isOpen && activeChat) {
            writeSeen({
                ...(readSeen() || {}),
                [String(activeChat.id)]: chatMessageCount(activeChat),
            });
        }
        return () => {
            if (activeDiplomaticChatId === String(activeChat?.id ?? "")) {
                activeDiplomaticChatId = "";
            }
        };
    }, [isOpen, activeChat?.id, activeChat?.messages?.length]);

    const refreshDiplomaticIdentityState = async ({ preserveActiveChat = true } = {}) => {
        const refreshSeq = ++identityRefreshSeqRef.current;
        setLoadingCountries(true);
        const [gameData, nextWorld, nextCountries, nextFlags] = await Promise.all([
            readGameData({ force: false }),
            readWorldStateView({ force: false }),
            loadCountryNames(),
            getNationFlags().catch(() => ({})),
        ]);

        // If a newer explicit refresh finished/started while this one was in flight,
        // discard this result rather than letting stale state win.
        if (refreshSeq !== identityRefreshSeqRef.current) return null;

        const nextPlayer = gameData.country || playerCountry || "your nation";
        const nextGameDate = gameData.gameDate || gameDate || "";
        const nextIdentitySignature = polityIdentitySignature(nextWorld);
        const identityChanged = Boolean(
            identitySignatureRef.current &&
            identitySignatureRef.current !== nextIdentitySignature
        );

        setPlayerCountry(nextPlayer);
        setGameDate(nextGameDate);
        setWorld(nextWorld);
        setIdentityWorld(nextWorld);
        setCountries(nextCountries.map((country) => canonicalCountry(country, nextWorld)));
        setFlagCatalog(nextFlags || {});
        setLoadingCountries(false);

        // Reopening diplomacy and opening the country selector should normally be
        // cheap: fresh world + flags + country catalog only. Full semantic chat
        // reconciliation happens ONLY when polity identity metadata actually changed
        // (rename/reconstitution/alias/lifecycle update), never on every open.
        if (!identityChanged) {
            identitySignatureRef.current = nextIdentitySignature;
            return {
                identityChanged: false,
                nextWorld,
                nextPlayer,
            };
        }

        const refreshedChats = await loadAllChats({
            force: true,
            world: nextWorld,
            playerCountry: nextPlayer,
        });
        if (refreshSeq !== identityRefreshSeqRef.current) return null;

        identitySignatureRef.current = nextIdentitySignature;
        setChats(refreshedChats);
        lastStoredChatSignatureRef.current = chatStorageSignature(refreshedChats);

        if (preserveActiveChat) {
            setActiveChat((current) => {
                if (!current) return current;
                return refreshedChats.find((chat) => String(chat.id) === String(current.id)) || current;
            });
        }

        // readChatsState already performed the expensive semantic reconciliation.
        // Persist that finished result WITHOUT passing world again, avoiding a second
        // full lineage walk over the same history.
        saveAllChats(refreshedChats);

        return {
            identityChanged: true,
            nextWorld,
            nextPlayer,
            refreshedChats,
        };
    };

    // Which chats to flag as unread, snapshotted when the panel OPENS and held
    // until it closes — rows must not reshuffle under the cursor while the player
    // is reading them. Reopening the panel is what re-sorts.
    const [unreadIds, setUnreadIds] = useState(() => new Set());
    const snapshotTakenRef = useRef(false);
    const lastStoredChatSignatureRef = useRef("");

    useEffect(() => {
        if (!isOpen) { snapshotTakenRef.current = false; return; }
        if (snapshotTakenRef.current || !hasLoadedInitialData) return;
        snapshotTakenRef.current = true;
        setUnreadIds(new Set(openChats.filter((chat) => isChatUnread(chat, readSeen())).map((chat) => String(chat.id))));
        // Everything on screen now counts as seen: the toolbar badge clears, and the
        // next open only flags what arrived in between.
        writeSeen(seenTotals(openChats));
    }, [isOpen, hasLoadedInitialData, openChats]);

    // Most recently USED diplomatic threads always come first. The old list used
    // unread-first + storage order, which is why a newly active thread could remain
    // buried near the bottom. Grouping is by the date of each thread's latest dated
    // message, matching the date semantics used inside the conversation itself.
    const orderedChats = useMemo(
        () => openChats
            .map((chat, index) => ({
                chat,
                index,
                activityDate: chatLastActivityDate(chat),
                unread: unreadIds.has(String(chat.id)),
            }))
            .sort((left, right) => {
                const byDate = chatActivitySortValue(right.activityDate) - chatActivitySortValue(left.activityDate);
                if (byDate !== 0) return byDate;

                // Within the same in-game day there may be no wall-clock timestamp.
                // Prefer unread/new material, then newer storage insertion as a stable
                // approximation without adding another persistence field or timer.
                if (left.unread !== right.unread) return left.unread ? -1 : 1;
                return right.index - left.index;
            })
            .map((entry) => entry.chat),
        [openChats, unreadIds],
    );

    const visibleOrderedChats = useMemo(
        () => orderedChats.slice(0, Math.max(CHAT_LIST_INITIAL_WINDOW, visibleChatLimit)),
        [orderedChats, visibleChatLimit],
    );
    const hiddenChatCount = Math.max(0, orderedChats.length - visibleOrderedChats.length);

    // Opening a chat marks it read, so messages that landed while the panel was
    // already open don't come back flagged on the next open.
    const openChatFromList = (chat) => {
        setActiveChat(chat);
        writeSeen({ ...(readSeen() || {}), [String(chat.id)]: chatMessageCount(chat) });
    };

    useEffect(() => {
        const justOpened = isOpen && !wasOpenRef.current;
        wasOpenRef.current = isOpen;
        if (!justOpened) return;

        setVisibleChatLimit(CHAT_LIST_INITIAL_WINDOW);
        if (!hasLoadedInitialData) return;

        // Opening diplomacy is presentation, not world reconstruction. While the
        // panel was closed it intentionally ignored its heavier semantic listeners,
        // so catch up from the canonical normalized chat view only. A normal turn's
        // writeChatsState() already primes this cache.
        let cancelled = false;
        const refreshCachedArchive = async () => {
            try {
                const saved = await readChatsStateView({ force: false });
                if (cancelled || !Array.isArray(saved)) return;
                startTransition(() => {
                    setChats((current) => current === saved ? current : saved);
                    setActiveChat((current) => {
                        if (!current) return current;
                        return saved.find((candidate) => candidate.id === current.id) || current;
                    });
                });
            } catch {
                // Keep the last good panel state. Opening the drawer must never
                // become a save/world retry loop.
            }
        };

        if (typeof window.requestAnimationFrame === "function") {
            window.requestAnimationFrame(() => void refreshCachedArchive());
        } else {
            window.setTimeout(() => void refreshCachedArchive(), 0);
        }

        return () => { cancelled = true; };
    }, [isOpen, hasLoadedInitialData]);

    useEffect(() => {
        if (!isOpen || hasLoadedInitialData) return;

        let cancelled = false;
        (async () => {
            try {
                // Minimum first-paint dependency set. Country PMTiles, custom flags,
                // and nation colors are selector/decorative data and must not sit in
                // front of the diplomatic drawer opening.
                const [gameData, worldData, rawChats] = await Promise.all([
                    readGameData({ force: false }),
                    readWorldStateView({ force: false }),
                    loadAllChats({ force: false }),
                ]);
                if (cancelled) return;

                const currentPlayer = gameData.country || "your nation";
                const needsMigration = chatsNeedIdentityMigration(rawChats);
                const savedChats = needsMigration
                    ? reconcileChatsForPlayer(rawChats, worldData, currentPlayer)
                    : rawChats;
                if (cancelled) return;

                setPlayerCountry(currentPlayer);
                setGameDate(gameData.gameDate || "");
                setWorld(worldData);
                setIdentityWorld(worldData);
                identitySignatureRef.current = polityIdentitySignature(worldData);
                setChats(savedChats);
                lastStoredChatSignatureRef.current = chatStorageSignature(savedChats);
                setHasLoadedInitialData(true);

                // The expensive country PMTiles catalog is loaded only if the player
                // explicitly opens Start New Chat.
                setLoadingCountries(true);

                // Visual catalogs enrich an already-painted panel.
                const enrichVisualCatalogs = async () => {
                    try {
                        const [flags, colors] = await Promise.all([
                            getNationFlags().catch(() => ({})),
                            getNationColors().catch(() => ({})),
                        ]);
                        if (cancelled) return;
                        startTransition(() => {
                            setFlagCatalog(flags || {});
                            setColorCatalog(colors || {});
                        });
                    } catch {
                        // Stock/fallback presentation remains valid without overrides.
                    }
                };

                if (typeof window.requestIdleCallback === "function") {
                    window.requestIdleCallback(() => void enrichVisualCatalogs(), { timeout: 1800 });
                } else {
                    window.setTimeout(() => void enrichVisualCatalogs(), 50);
                }

                // Persist only genuine legacy identity migration. Established saves
                // already carry polityKey and must not rewrite the whole chat archive
                // merely because the panel was opened.
                if (needsMigration) saveAllChats(savedChats);
            } catch {
                if (!cancelled) {
                    setHasLoadedInitialData(true);
                }
            }
        })();

        return () => { cancelled = true; };
    }, [hasLoadedInitialData, isOpen]);

    useEffect(() => {
        if (!isOpen || !hasLoadedInitialData) return;
        let cancelled = false;
        const refresh = () => {
            getNationFlags()
                .then((flags) => { if (!cancelled) setFlagCatalog(flags || {}); })
                .catch(() => {});
        };
        window.addEventListener("oh:flags-updated", refresh);
        return () => {
            cancelled = true;
            window.removeEventListener("oh:flags-updated", refresh);
        };
    }, [isOpen, hasLoadedInitialData]);

    useEffect(() => {
        if (!isOpen || !hasLoadedInitialData || typeof window === "undefined") return undefined;

        let cancelled = false;

        const onGameUpdated = (event) => {
            const data = event?.detail?.game;
            if (!data || cancelled) return;
            const nextCountry = data.country || playerCountry;
            const nextDate = data.gameDate || gameDate;
            setPlayerCountry((current) => current === nextCountry ? current : nextCountry);
            setGameDate((current) => current === nextDate ? current : nextDate);
        };

        const onWorldUpdated = (event) => {
            const nextWorld = event?.detail?.world;
            if (!nextWorld || cancelled) return;
            const nextSignature = polityIdentitySignature(nextWorld);
            const identityChanged = nextSignature !== identitySignatureRef.current;

            setWorld(nextWorld);
            if (!identityChanged) return;

            identitySignatureRef.current = nextSignature;
            setIdentityWorld(nextWorld);
            setCountries((current) => current.map((country) => canonicalCountry(country, nextWorld)));
            setChats((current) => {
                const reconciled = reconcileChatsForPlayer(current, nextWorld, playerCountry);
                lastStoredChatSignatureRef.current = chatStorageSignature(reconciled);
                saveAllChats(reconciled);
                return reconciled;
            });
        };

        window.addEventListener("oh:game-updated", onGameUpdated);
        window.addEventListener("oh:world-updated", onWorldUpdated);
        return () => {
            cancelled = true;
            window.removeEventListener("oh:game-updated", onGameUpdated);
            window.removeEventListener("oh:world-updated", onWorldUpdated);
        };
    }, [isOpen, hasLoadedInitialData, playerCountry, gameDate]);

    // Chats created OUTSIDE this panel — a jump's diplomatic invitations, the
    // idle outreach drip — are merged into LOCAL state instead of replacing it.
    //
    // IMPORTANT PERFORMANCE RULE: the five-second poll is STRUCTURAL ONLY. The
    // save-aware reconciler is intentionally expensive because it resolves aliases,
    // lifecycle identity and ambiguity safely. Running it over every historical
    // message every five seconds caused multi-second main-thread stalls. We now pay
    // that semantic cost only when storage contains information the local UI does
    // not already have.
    useEffect(() => {
        if (!isOpen || !hasLoadedInitialData || !world || typeof window === "undefined") return undefined;

        let cancelled = false;

        const applySaved = (saved) => {
            if (cancelled || !Array.isArray(saved)) return;
            const storedSignature = chatStorageSignature(saved);

            setChats((prev) => {
                const localSignature = chatStorageSignature(prev);
                if (storedSignature === localSignature ||
                    storedSignature === lastStoredChatSignatureRef.current) {
                    lastStoredChatSignatureRef.current = storedSignature;
                    return prev;
                }

                if (!storageAddsChatInformation(prev, saved)) return prev;

                const merged = mergeIncomingChats(prev, saved, world, { playerCountry });
                lastStoredChatSignatureRef.current = chatStorageSignature(merged);

                setActiveChat((ac) => {
                    if (!ac) return ac;
                    const direct = merged.find((c) => c.id === ac.id);
                    if (direct) return direct;

                    const key = chatParticipantSetKey(ac, world);
                    if (!key) return ac;
                    return merged.find((c) =>
                        c.status !== "closed" && chatParticipantSetKey(c, world) === key
                    ) || ac;
                });
                return merged;
            });
        };

        const adoptCanonicalArchive = async () => {
            try {
                const saved = await readChatsStateView({ force: false });
                if (cancelled || !Array.isArray(saved)) return;

                const storedSignature = chatStorageSignature(saved);
                lastStoredChatSignatureRef.current = storedSignature;

                startTransition(() => {
                    setChats((current) =>
                        chatStorageSignature(current) === storedSignature ? current : saved
                    );
                    setActiveChat((current) => {
                        if (!current) return current;
                        return saved.find((candidate) => candidate.id === current.id) || current;
                    });
                });
            } catch {
                // Explicit diplomacy update fallback below remains available.
            }
        };

        const onRuntimeUpdate = (event) => {
            if (event?.detail?.url !== JSON_URLS.chat) return;
            void adoptCanonicalArchive();
        };
        const onDiplomacyUpdate = () => {
            loadAllChats({ force: false }).then(applySaved).catch(() => {});
        };

        window.addEventListener("oh:runtime-json-updated", onRuntimeUpdate);
        window.addEventListener("oh:diplomacy-chats-updated", onDiplomacyUpdate);
        return () => {
            cancelled = true;
            window.removeEventListener("oh:runtime-json-updated", onRuntimeUpdate);
            window.removeEventListener("oh:diplomacy-chats-updated", onDiplomacyUpdate);
        };
    }, [isOpen, hasLoadedInitialData, world, playerCountry]);

    const availableCountries = useMemo(() => {
        const seen = new Set();
        const available = [];
        for (const country of countries.map((entry) => canonicalCountry(entry, world))) {
            if (!country || countryMatchesIdentity(country, playerCountry, world)) continue;
            const key = String(country?.polityKey || country?.code || country?.name || "").trim().toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            available.push(country);
        }
        return available;
    }, [countries, playerCountry, world]);

    const handleMessagesUpdate = useCallback((chatId, newMessages) => {
        if (newMessages?.at(-1)?.role === "user") {
            recordRecentDiplomaticOutgoing(chatId);
        }

        setChats(prev => {
            // Participants were canonicalized when the thread entered the UI and
            // every newly-created message already carries polityKey. Re-running the
            // whole campaign identity reconciler for every bubble is wasted work.
            const updated = prev.map(c => c.id === chatId ? { ...c, messages: newMessages } : c);
            lastStoredChatSignatureRef.current = chatStorageSignature(updated);
            saveAllChats(updated);
            setActiveChat(ac => ac?.id === chatId ? { ...ac, messages: newMessages } : ac);
            return updated;
        });
    }, []);

    const openCountrySelector = async () => {
        setShowSelector(true);
        setLoadingCountries(true);
        try {
            await refreshDiplomaticIdentityState({ preserveActiveChat: true });
        } catch {
            // The selector can still use the last good identity/flag catalog if a
            // one-off refresh fails. No polling or retry loop is introduced here.
            setLoadingCountries(false);
        }
    };

    const handleStartChat = (selected) => {
        if (!world) return;
        const candidate = reconcileChatsForPlayer([{
            id: Date.now(),
            countries: selected,
            messages: [],
            status: "open",
            source: "manual",
        }], world, playerCountry)[0];
        if (!candidate) {
            setShowSelector(false);
            return;
        }

        const candidateKey = chatParticipantSetKey(candidate, world);
        setChats(prev => {
            const existing = candidateKey
                ? prev.find(c =>
                    c.status !== "closed" &&
                    chatParticipantSetKey(c, world) === candidateKey
                )
                : null;
            if (existing) {
                setActiveChat(existing);
                return prev;
            }

            const next = mergeIncomingChats(prev, [candidate], world, { playerCountry });
            const opened = candidateKey
                ? next.find(c => c.status !== "closed" && chatParticipantSetKey(c, world) === candidateKey)
                : candidate;
            lastStoredChatSignatureRef.current = chatStorageSignature(next);
            saveAllChats(next, { world, playerCountry });
            setActiveChat(opened || candidate);
            return next;
        });
        setShowSelector(false);
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
    const handleDeleteChat = useCallback((id) => {
        setChats(prev => {
            const updated = prev.map(chat => chat.id === id ? { ...chat, status: "closed" } : chat);
            lastStoredChatSignatureRef.current = chatStorageSignature(updated);
            saveAllChats(updated);
            return updated;
        });
        if (activeChat?.id === id) setActiveChat(null);
    }, [activeChat?.id]);

    // Open (or reuse) a 1-on-1 chat requested from a region popup, using stable
    // lineage identity rather than the current display-name spelling.
    const consumePending = (country) => {
        setShowSelector(false);
        if (!world || countryMatchesIdentity(country, playerCountry, world)) return;

        const candidate = reconcileChatsForPlayer([{
            id: Date.now(),
            countries: [canonicalCountry(country, world)],
            messages: [],
            status: "open",
            source: "manual",
        }], world, playerCountry)[0];
        if (!candidate) return;
        const candidateKey = chatParticipantSetKey(candidate, world);

        setChats(prev => {
            const existing = candidateKey
                ? prev.find(c =>
                    c.status !== "closed" &&
                    chatParticipantSetKey(c, world) === candidateKey
                )
                : null;
            if (existing) { setActiveChat(existing); return prev; }

            const next = mergeIncomingChats(prev, [candidate], world, { playerCountry });
            const opened = candidateKey
                ? next.find(c => c.status !== "closed" && chatParticipantSetKey(c, world) === candidateKey)
                : candidate;
            lastStoredChatSignatureRef.current = chatStorageSignature(next);
            saveAllChats(next, { world, playerCountry });
            setActiveChat(opened || candidate);
            return next;
        });
    };

    useEffect(() => {
        if (!isOpen || !requestedCountry) return;
        consumePending(requestedCountry);
        onConsumeRequest?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, requestedCountry]);

    // Notification/toast clicks target an existing thread directly. They never
    // synthesize a new chat just to navigate to diplomacy that already exists.
    useEffect(() => {
        if (!isOpen || !requestedChatId || !hasLoadedInitialData) return;
        const target = openChats.find((chat) => String(chat.id) === String(requestedChatId));
        if (target) openChatFromList(target);
        onConsumeRequestedChat?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, requestedChatId, hasLoadedInitialData, chats]);

        const closeActiveChat = useCallback(() => setActiveChat(null), []);
        const deleteActiveChat = useCallback(() => {
            if (activeChat?.id != null) handleDeleteChat(activeChat.id);
        }, [activeChat?.id, handleDeleteChat]);

        const flagContextValue = useMemo(
            () => ({ flags: flagCatalog, world: identityWorld || world }),
            [flagCatalog, identityWorld, world],
        );

        return (
            <FlagContext.Provider value={flagContextValue}>
            <NationColorContext.Provider value={colorCatalog}>
            <>
            <MarkdownStyleInjector />
            <div style={{ position: "fixed", bottom: isOpen ? "4.25rem" : "-40rem", left: "0rem", width: "26.25rem", maxWidth: "calc(100vw - 1rem)", height: "min(calc(100vh - 9rem), max(calc(100vh - 33rem), 30rem))", minHeight: "10rem", backgroundColor: "rgba(17,24,39,0.95)", backdropFilter: "blur(8px)", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "-4px 0 24px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.06)", zIndex: 9998, overflow: "hidden", transition: "bottom 0.35s cubic-bezier(0.4,0,0.2,1),opacity 0.35s ease", opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? "auto" : "none", fontFamily: "sans-serif", color: "white", display: "flex", flexDirection: "column" }}>

            {showSelector && <CountrySelectorModal countries={availableCountries} loading={loadingCountries} onStart={handleStartChat} onCancel={() => setShowSelector(false)} />}

            {activeChat && Array.isArray(activeChat.countries) && activeChat.countries.length > 0 ? (
                <ConversationView key={String(activeChat.id)} chat={activeChat} playerCountry={playerCountry} world={identityWorld || world} gameDate={gameDate} onDelete={deleteActiveChat} onBack={closeActiveChat} onMessagesUpdate={handleMessagesUpdate} />
            ) : (
                <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.25rem 0.75rem", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                <span style={{ fontWeight: 700, fontSize: "1rem" }}>Diplomatic Chats</span>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: "1.1rem", lineHeight: 1, padding: "0.15rem 0.3rem", borderRadius: "6px" }}
                onMouseEnter={e => { e.currentTarget.style.color = "white"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.5)"; e.currentTarget.style.background = "none"; }}>✕</button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {!hasLoadedInitialData ? (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.32)", fontSize: "0.82rem", fontStyle: "italic", textAlign: "center", padding: "2rem" }}>
                    Loading diplomatic conversations…
                    </div>
                ) : openChats.length === 0 ? (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.25)", fontSize: "0.82rem", fontStyle: "italic", textAlign: "center", padding: "2rem" }}>
                    No diplomatic conversations yet.<br />Start one below.
                    </div>
                ) : visibleOrderedChats.map((chat, index) => {
                    const activityDate = chatLastActivityDate(chat);
                    const previousActivityDate = index > 0
                        ? chatLastActivityDate(visibleOrderedChats[index - 1])
                        : null;
                    const showDateSeparator = index === 0 ||
                        chatDateKey(activityDate) !== chatDateKey(previousActivityDate);

                    return (
                        <React.Fragment key={chat.id}>
                        {showDateSeparator && <ChatListDateSeparator value={activityDate} />}
                        <ChatListItem
                            chat={chat}
                            unread={unreadIds.has(String(chat.id))}
                            onClick={() => openChatFromList(chat)}
                            onDelete={() => handleDeleteChat(chat.id)}
                        />
                        </React.Fragment>
                    );
                })}
                {hiddenChatCount > 0 && (
                    <button
                        onClick={() => setVisibleChatLimit((current) =>
                            Math.min(orderedChats.length, current + CHAT_LIST_WINDOW_STEP)
                        )}
                        style={{
                            marginTop: "0.35rem",
                            padding: "0.55rem",
                            borderRadius: "9px",
                            border: "1px solid rgba(255,255,255,0.08)",
                            background: "rgba(255,255,255,0.035)",
                            color: "rgba(255,255,255,0.58)",
                            cursor: "pointer",
                            fontSize: "0.72rem",
                            fontFamily: "sans-serif",
                        }}
                    >
                        Show {Math.min(CHAT_LIST_WINDOW_STEP, hiddenChatCount)} older conversations · {hiddenChatCount} hidden
                    </button>
                )}
                </div>
                <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                <button onClick={openCountrySelector} style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.85)", fontSize: "0.85rem", fontWeight: 500, cursor: "pointer", fontFamily: "sans-serif" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.12)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.07)"}>Start New Chat</button>
                </div>
                </>
            )}
            </div>
            </>
            </NationColorContext.Provider>
            </FlagContext.Provider>
        );
});

// ── Chat toolbar button + 5D.4 notification center ───────────────────────────

const Chat = memo(function Chat({ hovered, setHovered, isOpen, onToggle }) {
    const [hasOpened, setHasOpened] = useState(false);
    const [pendingCountry, setPendingCountry] = useState(null);
    const [pendingChatId, setPendingChatId] = useState("");
    const [unseenCount, setUnseenCount] = useState(0);
    const [notificationItems, setNotificationItems] = useState([]);
    const [toastItems, setToastItems] = useState([]);
    const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
    const [soundEnabled, setSoundEnabled] = useState(readNotificationSoundEnabled);
    const [desktopPermission, setDesktopPermission] = useState(() =>
        typeof Notification === "undefined" ? "unsupported" : Notification.permission
    );
    const notificationCursorsRef = useRef(null);
    const notificationPollStatsRef = useRef({
        chatsChecked: 0,
        messagesInspected: 0,
        changedChats: 0,
    });
    const toastTimersRef = useRef(new Map());
    const notificationSeqRef = useRef(0);

    useEffect(() => {
        if (isOpen) {
            setHasOpened(true);
            setNotificationCenterOpen(false);
            setNotificationItems([]);
            setToastItems([]);
            for (const timer of toastTimersRef.current.values()) clearTimeout(timer);
            toastTimersRef.current.clear();
        }
    }, [isOpen]);

    // 8A.8 — persistent Event Editor diplomatic reaction scheduler. The queue
    // lives in world.json, so refreshes do not cancel the grace window. This is
    // deadline-driven rather than another poll: read once, sleep until the next
    // pending evaluation, then let gameplay.js re-check the event and deliver (or
    // deliberately choose silence) through the canonical chat seam.
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
                const queue = Array.isArray(world?.pendingEventOutreach)
                    ? world.pendingEventOutreach
                    : [];
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
        document.addEventListener("visibilitychange", visibilityChanged);

        return () => {
            cancelled = true;
            clear();
            window.removeEventListener("oh:event-outreach-queue-changed", queueChanged);
            document.removeEventListener("visibilitychange", visibilityChanged);
        };
    }, []);

    useEffect(() => {
        const unlock = () => ensureNotificationAudioContext();
        document.addEventListener("pointerdown", unlock, true);
        document.addEventListener("keydown", unlock, true);
        return () => {
            document.removeEventListener("pointerdown", unlock, true);
            document.removeEventListener("keydown", unlock, true);
            for (const timer of toastTimersRef.current.values()) clearTimeout(timer);
            toastTimersRef.current.clear();
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
                const desktop = new Notification(`OpenHistoria — ${item.sender}`, {
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

    // Combined unread + incoming-message watcher. This REPLACES the previous
    // badge-only 15-second interval; it is not an additional poll. Normal checks
    // compare only per-chat count + tail fingerprint. Full history is never rescanned.
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

                // First run after installing 5D.4 v2: seed ONE cursor per chat.
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
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("oh:runtime-json-updated", onRuntimeUpdate);
        window.addEventListener("oh:diplomacy-chats-updated", onExternalChatUpdate);

        return () => {
            cancelled = true;
            document.removeEventListener("visibilitychange", onVisibilityChange);
            window.removeEventListener("oh:runtime-json-updated", onRuntimeUpdate);
            window.removeEventListener("oh:diplomacy-chats-updated", onExternalChatUpdate);
        };
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

    // Tiny native diagnostic API, analogous to the old AIO helper, so 5D.4 can
    // be tested without waiting for an autonomous foreign message.
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
                    text: "If you can see this toast and notification button, 5D.4 is working.",
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
                    )
                    .sort((a, b) =>
                        chatActivitySortValue(chatLastActivityDate(b)) -
                        chatActivitySortValue(chatLastActivityDate(a))
                    );

                const chat = open[0];
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
                    time: chatLastActivityDate(chat),
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
    }, [unseenCount, notificationItems.length, soundEnabled, desktopPermission]);

    const closePanel = useCallback(() => onToggle(), [onToggle]);
    const consumePendingCountry = useCallback(() => setPendingCountry(null), []);
    const consumePendingChat = useCallback(() => setPendingChatId(""), []);

    const notificationPortal = typeof document !== "undefined"
        ? ReactDOM.createPortal(
            <>
            <div
                style={{
                    position: "fixed",
                    top: FLOATING_UI_EDGE_GAP,
                    left: "auto",
                    right: `${toastRightOffsetPx()}px`,
                    width: "min(23rem, calc(100vw - 2rem))",
                    zIndex: 10002,
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
                            border: "1px solid rgba(96,165,250,0.35)",
                            borderRadius: "12px",
                            background: "rgba(15,23,42,0.97)",
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
                        left: "9.7rem",
                        bottom: FLOATING_UI_EDGE_GAP,
                        zIndex: 10001,
                        fontFamily: "sans-serif",
                    }}
                >
                    {notificationCenterOpen && (
                        <div
                            style={{
                                position: "absolute",
                                left: 0,
                                bottom: "3rem",
                                width: "min(22rem, calc(100vw - 1rem))",
                                maxHeight: "min(27rem, calc(100vh - 7rem))",
                                overflowY: "auto",
                                borderRadius: "14px",
                                border: "1px solid rgba(255,255,255,0.12)",
                                background: "rgba(15,23,42,0.98)",
                                boxShadow: "0 18px 50px rgba(0,0,0,0.48)",
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
                                    background: "rgba(15,23,42,0.99)",
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
                    )}

                    <button
                        onClick={() => setNotificationCenterOpen((open) => !open)}
                        title="Diplomatic notifications"
                        style={{
                            minWidth: "2.8rem",
                            height: "2.5rem",
                            padding: "0 0.65rem",
                            borderRadius: "10px",
                            border: "1px solid rgba(96,165,250,0.35)",
                            background: "rgba(15,23,42,0.96)",
                            color: "white",
                            boxShadow: "0 6px 18px rgba(0,0,0,0.38)",
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
        {hasOpened && (
            <ChatPanel
                isOpen={isOpen}
                onClose={closePanel}
                requestedCountry={pendingCountry}
                onConsumeRequest={consumePendingCountry}
                requestedChatId={pendingChatId}
                onConsumeRequestedChat={consumePendingChat}
            />
        )}

        {notificationPortal}

        <button
            title="Chat"
            style={{
                width: "3.3rem",
                height: "3.3rem",
                borderRadius: "10px",
                border: hovered
                    ? "1px solid rgba(255,255,255,0.2)"
                    : isOpen
                        ? "1px solid rgba(139,92,246,0.5)"
                        : "1px solid rgba(255,255,255,0.1)",
                background: isOpen
                    ? "linear-gradient(145deg,rgba(109,40,217,0.4),rgba(76,29,149,0.4))"
                    : hovered
                        ? "linear-gradient(145deg,rgba(40,55,80,0.95),rgba(20,30,50,0.95))"
                        : "linear-gradient(145deg,rgba(30,42,65,0.95),rgba(15,22,40,0.95))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "all 0.12s ease",
                boxShadow: hovered
                    ? "inset 0 1px 0 rgba(255,255,255,0.1),0 2px 8px rgba(0,0,0,0.4)"
                    : "inset 0 1px 0 rgba(255,255,255,0.06),inset 0 -1px 0 rgba(0,0,0,0.3),0 2px 6px rgba(0,0,0,0.35)",
                fontSize: "1.2rem",
                outline: "none",
                transform: hovered ? "translateY(-1px)" : "translateY(0)",
                color: "white",
                fontFamily: "sans-serif",
                flexShrink: 0,
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={onToggle}
        >
            <span style={{ position: "relative", display: "inline-flex" }}>
                💬
                {unseenCount > 0 && !isOpen && (
                    <span
                        style={{
                            position: "absolute",
                            top: "-0.55rem",
                            right: "-0.8rem",
                            minWidth: "1.05rem",
                            height: "1.05rem",
                            padding: "0 0.2rem",
                            borderRadius: "999px",
                            background: "#dc2626",
                            border: "1px solid rgba(255,255,255,0.35)",
                            color: "white",
                            fontSize: "0.62rem",
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            lineHeight: 1,
                            boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
                        }}
                    >
                        {unseenCount > 9 ? "9+" : unseenCount}
                    </span>
                )}
            </span>
        </button>
        </>
    );
});

// ── Toolbar ───────────────────────────────────────────────────────────────────

const Toolbar = memo(({ onOpenAdvisor, activePanel, onTogglePanel }) => {
    const [hoveredChat, setHoveredChat]       = useState(false);
    const [hoveredActions, setHoveredActions] = useState(false);
    const toggleChat = useCallback(() => onTogglePanel("chat"), [onTogglePanel]);
    const toggleActions = useCallback(() => onTogglePanel("actions"), [onTogglePanel]);
    return (
        <div style={{ position: "fixed", bottom: "0.5rem", left: "0.5rem", height: "4rem", width: "8.75rem", gap: "0.75rem", padding: "0 0.1rem", backgroundColor: "rgba(17,24,39,0.9)", backdropFilter: "blur(4px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontFamily: "sans-serif", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 24px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.05)" }}>
        <Chat hovered={hoveredChat} setHovered={setHoveredChat} isOpen={activePanel === "chat"} onToggle={toggleChat} />
        <Actions onOpenAdvisor={onOpenAdvisor} hovered={hoveredActions} setHovered={setHoveredActions} isOpen={activePanel === "actions"} onToggle={toggleActions} />
        </div>
    );
});

export { Toolbar, Chat, ChatPanel };
