/*! Open Historia — portions (era diplomacy + mobile panel sizing) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import ReactMarkdown from "react-markdown";
import { appendDiplomaticPlayerMessage, sendDiplomaticMessage, startDiplomaticChat, loadDiplomaticHistory } from "../AI/main.jsx";
import { chooseNextDiplomaticSpeaker } from "../AI/gameplay.js";
import { Actions } from "./actions";
import {
    getNationColors,
    getNationFlags,
    loadCountryNames as loadCachedCountryNames,
} from "../../runtime/assets.js";
import { resolvePolityFlag } from "../../runtime/polityFlags.js";
import {
    chatParticipantSetKey,
    mergeIncomingChats,
    readChatsState,
    readGameData,
    readWorldState,
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
    const flag     = useCountryFlag(isPlayer || isError ? {} : { code: msg.code, name: msg.speaker, polityKey: msg.polityKey });
    const reactions = Object.entries(msg.reactions ?? {});
    const reactionFlags = useCountryFlags(reactions.map(([name, { code, polityKey }]) => ({ name, code, polityKey })));
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
};

const TypingBubble = ({ speaker, code, polityKey }) => {
    const flag = useCountryFlag({ code, name: speaker, polityKey });
    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <span style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)", marginBottom: "0.25rem", display: "flex", alignItems: "center", gap: "0.3rem" }}><FlagMark info={flag} width={18} height={11} /> {speaker}</span>
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

const ConversationView = ({ chat, playerCountry, world, gameDate, onDelete, onBack, onMessagesUpdate }) => {
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

    const lastPlayerMessage = useRef("");
    const messagesEndRef    = useRef(null);
    const messagesRef       = useRef(chat.messages ?? []);
    const groupSpeakersThisTurnRef = useRef([]);

    useEffect(() => {
        // Flag images resolve lazily from the shared cached catalog.
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
                const { reply, reaction } = await sendDiplomaticMessage(
                    playerMessage,
                    country.name,
                    countries,
                    { appendPlayerMessage: false },
                );

                const leaderMessage = {
                    role: "leader",
                    speaker: country.name,
                    code: country.code,
                    polityKey: country.polityKey || "",
                    text: reply,
                    time: gameDate,
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
            appendDiplomaticPlayerMessage(text);
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
            {messages.map((msg, i) => <MessageBubble key={i} msg={msg} chatCountries={countries} />)}
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
};

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

// ── Chat list item ────────────────────────────────────────────────────────────

const ChatListItem = ({ chat, onClick, onDelete, unread = false }) => {
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
        <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => { setHovered(false); setConfirming(false); }} style={{ position: "relative" }}>
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
};

// ── Main ChatPanel ────────────────────────────────────────────────────────────

// Bridge so the map region popup can request a diplomatic chat with a country.
const _chatOpenSubs = new Set();
export const requestDiplomaticChat = (country) => {
    if (!country || !country.name) return;
    _chatOpenSubs.forEach((fn) => { try { fn(country); } catch { /* noop */ } });
};

const ChatPanel = ({ isOpen, onClose, requestedCountry, onConsumeRequest }) => {
    const [countries, setCountries]               = useState([]);
    const [loadingCountries, setLoadingCountries] = useState(true);
    const [playerCountry, setPlayerCountry]       = useState("your nation");
    const [gameDate, setGameDate]                 = useState("");
    const [world, setWorld]                       = useState(null);
    const [flagCatalog, setFlagCatalog]           = useState({});
    const [chats, setChats]                       = useState([]);
    const [activeChat, setActiveChat]             = useState(null);
    const [showSelector, setShowSelector]         = useState(false);
    const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
    const wasOpenRef = useRef(false);
    const identitySignatureRef = useRef("");
    const identityRefreshSeqRef = useRef(0);
    const openChats = chats.filter((chat) => chat.status !== "closed" && Array.isArray(chat.countries) && chat.countries.length > 0);

    const refreshDiplomaticIdentityState = async ({ preserveActiveChat = true } = {}) => {
        const refreshSeq = ++identityRefreshSeqRef.current;
        const [gameData, nextWorld, nextCountries, nextFlags] = await Promise.all([
            readGameData({ force: true }),
            readWorldState({ force: true }),
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
        setCountries(nextCountries.map((country) => canonicalCountry(country, nextWorld)));
        setFlagCatalog(nextFlags || {});

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
        const justOpened = isOpen && !wasOpenRef.current;
        wasOpenRef.current = isOpen;

        if (!justOpened || !hasLoadedInitialData) return;

        refreshDiplomaticIdentityState()
            .catch(() => {
                // Keep the last good UI state if a refresh fails.
            });
        // `refreshDiplomaticIdentityState` intentionally reads the live save on open.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, hasLoadedInitialData]);

    useEffect(() => {
        if (!isOpen || hasLoadedInitialData) return;

        let cancelled = false;
        (async () => {
            try {
                const [countryList, gameData, worldData, flags] = await Promise.all([
                    loadCountryNames(),
                    readGameData({ force: true }),
                    readWorldState({ force: true }),
                    getNationFlags({ force: true }).catch(() => ({})),
                ]);
                if (cancelled) return;

                const currentPlayer = gameData.country || "your nation";
                const savedChats = await loadAllChats({
                    force: true,
                    world: worldData,
                    playerCountry: currentPlayer,
                });
                if (cancelled) return;

                setCountries(countryList.map((country) => canonicalCountry(country, worldData)));
                setPlayerCountry(currentPlayer);
                setGameDate(gameData.gameDate || "");
                setWorld(worldData);
                setFlagCatalog(flags || {});
                identitySignatureRef.current = polityIdentitySignature(worldData);
                setLoadingCountries(false);
                setChats(savedChats);
                lastStoredChatSignatureRef.current = chatStorageSignature(savedChats);
                setHasLoadedInitialData(true);

                // Persist the one-time migration immediately: player aliases are
                // stripped from participant lists and duplicate open threads created
                // by [counterpart, player] vs [counterpart] collapse in storage too.
                saveAllChats(savedChats);
            } catch {
                if (!cancelled) {
                    setLoadingCountries(false);
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
            getNationFlags({ force: true })
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
        if (!isOpen || !hasLoadedInitialData) return;

        let cancelled = false;
        let lastSignature = `${playerCountry}|${gameDate}`;
        const go = async () => {
            try {
                const data = await readGameData({ force: true });
                if (cancelled) return;

                const nextCountry = data.country || playerCountry;
                const nextDate = data.gameDate || gameDate;
                const signature = `${nextCountry}|${nextDate}`;

                setPlayerCountry(nextCountry);
                setGameDate(nextDate);

                // A date/country change means a turn may have renamed/reconstituted
                // polities. Refresh world identity and the dynamic country catalog
                // only then, rather than force-reading world.json every five seconds.
                if (signature !== lastSignature) {
                    lastSignature = signature;
                    const [nextWorld, nextCountries] = await Promise.all([
                        readWorldState({ force: true }),
                        loadCountryNames(),
                    ]);
                    if (cancelled) return;
                    setWorld(nextWorld);
                    setCountries(nextCountries.map((country) => canonicalCountry(country, nextWorld)));
                    identitySignatureRef.current = polityIdentitySignature(nextWorld);
                    setChats((prev) => {
                        const reconciled = reconcileChatsForPlayer(prev, nextWorld, nextCountry);
                        lastStoredChatSignatureRef.current = chatStorageSignature(reconciled);
                        saveAllChats(reconciled);
                        return reconciled;
                    });
                }
            } catch { /* keep the last good UI state */ }
        };

        const iv = setInterval(go, 5000);
        return () => {
            cancelled = true;
            clearInterval(iv);
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
        if (!isOpen || !hasLoadedInitialData || !world) return;

        let cancelled = false;
        const sync = () => loadAllChats({ force: true })
        .then((saved) => {
            if (cancelled || !Array.isArray(saved)) return;
            const storedSignature = chatStorageSignature(saved);

            setChats((prev) => {
                const localSignature = chatStorageSignature(prev);
                if (storedSignature === localSignature ||
                    storedSignature === lastStoredChatSignatureRef.current) {
                    lastStoredChatSignatureRef.current = storedSignature;
                    return prev;
                }

                // An in-flight local save can make storage temporarily OLDER than
                // React state. Never invoke the expensive semantic merger merely to
                // rediscover that local state already has more messages.
                if (!storageAddsChatInformation(prev, saved)) {
                    return prev;
                }

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
        })
        .catch(() => {});

        const iv = setInterval(sync, 5000);
        return () => {
            cancelled = true;
            clearInterval(iv);
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

    const handleMessagesUpdate = (chatId, newMessages) => {
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
    };

    const openCountrySelector = async () => {
        setShowSelector(true);
        try {
            await refreshDiplomaticIdentityState({ preserveActiveChat: true });
        } catch {
            // The selector can still use the last good identity/flag catalog if a
            // one-off refresh fails. No polling or retry loop is introduced here.
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
    const handleDeleteChat = (id) => {
        setChats(prev => {
            const updated = prev.map(chat => chat.id === id ? { ...chat, status: "closed" } : chat);
            lastStoredChatSignatureRef.current = chatStorageSignature(updated);
            saveAllChats(updated);
            return updated;
        });
        if (activeChat?.id === id) setActiveChat(null);
    };

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

        return (
            <FlagContext.Provider value={{ flags: flagCatalog, world }}>
            <>
            <MarkdownStyleInjector />
            <div style={{ position: "fixed", bottom: isOpen ? "4.25rem" : "-40rem", left: "0rem", width: "26.25rem", maxWidth: "calc(100vw - 1rem)", height: "min(calc(100vh - 9rem), max(calc(100vh - 33rem), 30rem))", minHeight: "10rem", backgroundColor: "rgba(17,24,39,0.95)", backdropFilter: "blur(8px)", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "-4px 0 24px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.06)", zIndex: 9998, overflow: "hidden", transition: "bottom 0.35s cubic-bezier(0.4,0,0.2,1),opacity 0.35s ease", opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? "auto" : "none", fontFamily: "sans-serif", color: "white", display: "flex", flexDirection: "column" }}>

            {showSelector && <CountrySelectorModal countries={availableCountries} loading={loadingCountries} onStart={handleStartChat} onCancel={() => setShowSelector(false)} />}

            {activeChat && Array.isArray(activeChat.countries) && activeChat.countries.length > 0 ? (
                <ConversationView chat={activeChat} playerCountry={playerCountry} world={world} gameDate={gameDate} onDelete={() => handleDeleteChat(activeChat.id)} onBack={() => setActiveChat(null)} onMessagesUpdate={handleMessagesUpdate} />
            ) : (
                <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.25rem 0.75rem", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                <span style={{ fontWeight: 700, fontSize: "1rem" }}>Diplomatic Chats</span>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: "1.1rem", lineHeight: 1, padding: "0.15rem 0.3rem", borderRadius: "6px" }}
                onMouseEnter={e => { e.currentTarget.style.color = "white"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.5)"; e.currentTarget.style.background = "none"; }}>✕</button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {openChats.length === 0 ? (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.25)", fontSize: "0.82rem", fontStyle: "italic", textAlign: "center", padding: "2rem" }}>
                    No diplomatic conversations yet.<br />Start one below.
                    </div>
                ) : orderedChats.map(chat => <ChatListItem key={chat.id} chat={chat} unread={unreadIds.has(String(chat.id))} onClick={() => openChatFromList(chat)} onDelete={() => handleDeleteChat(chat.id)} />)}
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
            </FlagContext.Provider>
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
            <button title="Chat" style={{ width: "3.3rem", height: "3.3rem", borderRadius: "10px", border: hovered ? "1px solid rgba(255,255,255,0.2)" : isOpen ? "1px solid rgba(139,92,246,0.5)" : "1px solid rgba(255,255,255,0.1)", background: isOpen ? "linear-gradient(145deg,rgba(109,40,217,0.4),rgba(76,29,149,0.4))" : hovered ? "linear-gradient(145deg,rgba(40,55,80,0.95),rgba(20,30,50,0.95))" : "linear-gradient(145deg,rgba(30,42,65,0.95),rgba(15,22,40,0.95))", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.12s ease", boxShadow: hovered ? "inset 0 1px 0 rgba(255,255,255,0.1),0 2px 8px rgba(0,0,0,0.4)" : "inset 0 1px 0 rgba(255,255,255,0.06),inset 0 -1px 0 rgba(0,0,0,0.3),0 2px 6px rgba(0,0,0,0.35)", fontSize: "1.2rem", outline: "none", transform: hovered ? "translateY(-1px)" : "translateY(0)", color: "white", fontFamily: "sans-serif", flexShrink: 0 }}
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
        <div style={{ position: "fixed", bottom: "0.5rem", left: "0.5rem", height: "4rem", width: "8.75rem", gap: "0.75rem", padding: "0 0.1rem", backgroundColor: "rgba(17,24,39,0.9)", backdropFilter: "blur(4px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontFamily: "sans-serif", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 24px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.05)" }}>
        <Chat hovered={hoveredChat} setHovered={setHoveredChat} isOpen={activePanel === "chat"} onToggle={() => onTogglePanel("chat")} />
        <Actions onOpenAdvisor={onOpenAdvisor} hovered={hoveredActions} setHovered={setHoveredActions} isOpen={activePanel === "actions"} onToggle={() => onTogglePanel("actions")} />
        </div>
    );
});

export { Toolbar, Chat, ChatPanel };
