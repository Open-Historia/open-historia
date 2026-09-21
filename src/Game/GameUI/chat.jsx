/*! Open Historia — portions (era diplomacy + mobile panel sizing) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { dedupeByName } from "../../runtime/countryList.js";
import ReactDOM from "react-dom";
import { sendDiplomaticMessage, startDiplomaticChat, loadDiplomaticHistory } from "../AI/main.jsx";
import { checkDemandReply, chooseNextDiplomaticSpeaker, ensureCountryAssessed, processPendingEventOutreach, runChatActionBatch } from "../AI/gameplayLazy.js";
import { eventsFromLegacyChat, projectChatThread } from "../../runtime/chatThreads.js";
import { openDemandOf, placeDemandCards, playerAnswerEvent, playerDemandEvent } from "../../runtime/demandCheck.js";
import { CHAT_REVEAL_PAUSE_MS, describeChatCutIn, planChatReveal } from "../AI/chatActions.js";
import { logForNextStep, startChatReveal } from "./chatReveal.js";
import { campaignChanged } from "../../runtime/campaignGuard.js";
import { isChatGenerationLikely } from "../AI/simulationStatus.js";
import {
    MAX_ACTIVE_SPIES, activeSpies, deploySpy, expelSpy, foreignSpies, intelligenceOf, normalizeIntercepts, normalizeSpies,
    recallSpy, redactExchange, setCoverStory, signalClarity, turnSpy,
} from "../../runtime/spycraft.js";
import { isSeal, newSeal, openExchange, openPoliticalAssessment } from "../../runtime/spySeal.js";
import { useActiveFeatures } from "../../runtime/gameFeatures.js";
import { Actions } from "./actions";
import { Projects } from "./projects";
import { DOCK_BOTTOM_REM, DOCK_GAP_REM, DOCK_HEIGHT_REM, DOCK_LEFT_REM, DOCK_WIDTH } from "./hudDock.js";
import { documentsReadableBy, isDocumentExchange } from "../../runtime/reportDelivery.js";
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
import { readChatsState, writeChatsState, readGameData, readWorldState, readWorldStateView, writeWorldState, applyProjectOpsToWorld, viewAsSeen } from "../../runtime/gameState.js";
import { describeRole, livePuppetsFor, puppetKindLabel } from "../../runtime/puppets.js";
import { buildThreadCatchUp } from "../AI/conversationCatchUp.js";
import { spyOperationOps } from "../../runtime/projects.js";
import Markdown, { MarkdownStyleInjector } from "./markdown.jsx";
import { compareGameDates, formatGameDateReadable, normalizeGameDate, parseGameDate } from "../../runtime/gameDates.js";
import { refreshRuntimeState, subscribeRuntime } from "../../runtime/runtimeStore.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { UNSEEN_EVENTS_CHANGED, withoutUnseenChats, withoutUnseenIntercepts, withoutUnseenMessages } from "../../runtime/unseenEvents.js";
import { unseenEventIdsFor, useUnseenEventIds } from "./useUnseenEvents.js";
import InstitutionsWorkspace, { Emblem as InstitutionEmblem, Facts as InstitutionFacts, SmallPill as InstitutionPill } from "./InstitutionsWorkspace.jsx";
import { buildInstitutionDiplomacyView } from "../../runtime/institutionalDiplomacyView.js";
import { buildPlayerPoliticalKnowledgeView } from "../../runtime/politicalKnowledge.js";
import { commitInstitutionLifecycleCommand, institutionLifecycleCasesForPolity, institutionLifecycleConversationState, institutionPortfolioForPolity } from "../../runtime/institutionLifecycle.js";
import { buildLifecycleReplyRevealPlan } from "./institutionLifecyclePresentation.js";

// Who the player is and when it is: all this panel reads of game.json.
const selectGameIdentity = (game) => ({
    country: game?.country || "",
    gameDate: game?.gameDate || "",
});

// ── Storage ───────────────────────────────────────────────────────────────────

const saveAllChats = async (chats) => {
    try {
        await writeChatsState(chats);
    } catch (err) { console.error("Failed to save chats:", err); }
};

// How far each leader has been shown of its other threads
// (AI/crossChatKnowledge.js). Written straight to world state, merged rather
// than replaced: a turn in one chat must not forget what another chat showed.
const saveChatKnowledgeCursors = async (cursors) => {
    try {
        const world = await readWorldState({ force: true });
        await writeWorldState({ ...world, chatKnowledgeCursors: { ...(world?.chatKnowledgeCursors ?? {}), ...cursors } });
    } catch (err) { console.error("Failed to save what each leader has been shown:", err); }
};

const loadAllChats = async ({ force = false } = {}) => {
    try {
        return await readChatsState({ force });
    } catch { return []; }
};

// ── What a thread missed ──────────────────────────────────────────────────────

// The moment the player is writing from: the events they have been shown and the
// date of the last of them — while a skip is being revealed, the reveal's front
// (gameState.js viewAsSeen). The player's line is dated there, so the thread's
// next catch-up picks up what the rest of the reveal showed.
const readSeenChatMoment = async (gameDate) => {
    try {
        const [events, world] = await Promise.all([
            readJson(JSON_URLS.events, { defaultValue: [] }),
            readJson(JSON_URLS.world, { defaultValue: {}, clone: false }),
        ]);
        const seen = await viewAsSeen({ world, events, game: { gameDate } });
        return { events: seen.events, date: seen.game?.gameDate || gameDate || "" };
    } catch {
        return { events: [], date: gameDate || "" };
    }
};

// The votes cast in this thread since an AI participant last spoke — the one
// thing the thread's own log knows that the leaders were not there to see.
const votesSinceLastTurn = (chat, player) => {
    const log = Array.isArray(chat?.events) ? chat.events : [];
    if (!log.length) return [];
    const me = String(player ?? "").trim().toLowerCase();
    const lastLeaderLine = log.reduce((at, entry, index) => (
        entry?.kind === "message" && entry.by && entry.by.trim().toLowerCase() !== me ? index : at
    ), -1);
    const { polls } = projectChatThread(log);
    return log.slice(lastLeaderLine + 1)
        .filter((entry) => entry?.kind === "poll_vote_cast")
        .map((entry) => {
            const poll = polls.find((candidate) => candidate.id === entry.pollId);
            const option = poll?.options.find((candidate) => candidate.id === entry.optionId);
            return poll && option ? `${entry.by} voted "${option.label}" on "${poll.question}"` : "";
        })
        .filter(Boolean);
};

// What the world did since this thread last spoke (AI/conversationCatchUp.js):
// nothing for a thread's first line, or when nothing moved and nobody voted.
const buildLeaderCatchUp = (messages, chat, player, moment) => {
    const previous = [...(Array.isArray(messages) ? messages : [])].reverse()
        .find((msg) => (msg.role === "user" || msg.role === "leader") && msg.time);
    if (!previous) return { text: "", label: "" };
    return buildThreadCatchUp({
        previousDate: previous.time,
        currentDate: moment?.date || "",
        events: moment?.events ?? [],
        votesSince: votesSinceLastTurn(chat, player),
        compareDates: compareGameDates,
        formatDate: (value) => formatGameDateReadable(value) || value,
    });
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

// Diplomacy is always presented from the player's point of view. A direct
// thread with France should read "France", not "Player Country, France".
// Explicitly renamed threads still win, but the generated fallback only names
// the people on the other side of the table.
const diplomaticCounterparts = (countries, playerCountry) => {
    const list = Array.isArray(countries) ? countries.filter(Boolean) : [];
    const others = list.filter((country) => !countryMatchesIdentity(country, playerCountry));
    return others.length ? others : list;
};

const summarizeDiplomaticParticipants = (countries) => {
    const names = (Array.isArray(countries) ? countries : []).map((country) => String(country?.name || "").trim()).filter(Boolean);
    if (!names.length) return "Unknown participant";
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} & ${names[1]}`;
    return `${names[0]}, ${names[1]} + ${names.length - 2}`;
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
    const colors = ["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#94a3b8","#ec4899"];
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

const ThinkingDots = ({ label = "Thinking" }) => {
    const [dots, setDots] = useState(0);
    useEffect(() => {
        const iv = setInterval(() => setDots(d => (d + 1) % 4), 500);
        return () => clearInterval(iv);
    }, []);
    return <span style={{ opacity: 0.6 }}>{label}{".".repeat(dots)}&nbsp;</span>;
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

const SendIcon = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M22 2 11 13" />
    <path d="m22 2-7 20-4-9-9-4Z" />
    </svg>
);

const CopyIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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

// A binding vote in a conversation (AI/chatActions.js). The AI participants
// vote in the same answer that opens one; the player casts their own, once.
// A poll is a record, not a control panel: there is no closing it and no
// changing a vote, because neither is a thing a government gets to do.
const PollCard = ({ poll, playerCountry, onVote }) => {
    const votes = poll?.votes ?? {};
    const mine = Object.entries(votes).find(([voter]) => voter.toLowerCase() === String(playerCountry ?? "").toLowerCase())?.[1] ?? "";
    const total = Object.keys(votes).length;
    return (
        <div style={{
            background: "rgba(59,130,246,0.08)",
            border: "1px solid rgba(96,165,250,0.30)",
            borderRadius: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "0.45rem",
            margin: "0.35rem 0",
            padding: "0.7rem 0.85rem",
        }}>
            <span style={{ fontSize: "0.68rem", letterSpacing: "0.04em", color: "rgba(147,197,253,0.9)", textTransform: "uppercase" }}>
                Vote{poll?.openedBy ? ` · called by ${poll.openedBy}` : ""}
            </span>
            <span style={{ fontSize: "0.85rem", fontWeight: 700, lineHeight: 1.35 }}>{poll?.question}</span>
            {(poll?.tally ?? []).map((option) => {
                const chosen = mine === option.id;
                const share = total ? Math.round((option.votes / total) * 100) : 0;
                const voters = Object.entries(votes).filter(([, id]) => id === option.id).map(([voter]) => voter);
                return (
                    <button
                        key={option.id}
                        type="button"
                        disabled={Boolean(mine)}
                        onClick={() => onVote?.(option.id)}
                        title={voters.length ? voters.join(", ") : "No vote yet"}
                        style={{
                            background: `linear-gradient(to right, rgba(96,165,250,0.28) ${share}%, rgba(255,255,255,0.05) ${share}%)`,
                            border: chosen ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.12)",
                            borderRadius: "8px",
                            color: "white",
                            cursor: mine ? "default" : "pointer",
                            display: "flex",
                            fontFamily: "inherit",
                            fontSize: "0.78rem",
                            justifyContent: "space-between",
                            padding: "0.4rem 0.6rem",
                            textAlign: "left",
                        }}
                    >
                        <span>{option.label}{chosen ? " ✓" : ""}</span>
                        <span data-no-translate style={{ color: "rgba(255,255,255,0.55)" }}>{option.votes}</span>
                    </button>
                );
            })}
            <span data-no-translate style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.68rem" }}>
                {total === 0 ? "Nobody has voted yet" : `${total} vote${total === 1 ? "" : "s"} cast`}
                {mine ? "" : " · your vote is yours to cast"}
            </span>
        </div>
    );
};

const ReactionChip = ({ emoji, members, flagUrlMap }) => {
    const [hovered, setHovered] = useState(false);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const anchorRef = useRef(null);
    const names = members.map((member) => member.country);

    const handleMouseEnter = () => {
        if (anchorRef.current) {
            const rect = anchorRef.current.getBoundingClientRect();
            setPos({ x: rect.left + rect.width / 2, y: rect.top });
        }
        setHovered(true);
    };

    const tooltip = hovered ? ReactDOM.createPortal(
        <div style={{
            position: "fixed", left: pos.x, top: pos.y - 5, transform: "translate(-50%, -100%)",
            background: "rgba(18,18,21,.98)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,.35)", padding: ".34rem .48rem", zIndex: 99999, pointerEvents: "none",
            display: "flex", flexDirection: "column", gap: ".2rem", color: "rgba(255,255,255,.82)", fontSize: ".66rem", whiteSpace: "nowrap",
        }}>
            {members.map((member) => (
                <span key={member.country} style={{ display: "inline-flex", alignItems: "center", gap: ".32rem" }}>
                    <FlagImg url={flagUrlMap[member.country] ?? null} alt={member.country} size=".9em" />
                    {member.country}
                </span>
            ))}
        </div>,
        document.body,
    ) : null;

    return (
        <>
        {tooltip}
        <div ref={anchorRef} onMouseEnter={handleMouseEnter} onMouseLeave={() => setHovered(false)} title={names.join(", ")} style={{
            minHeight: "1.55rem", padding: ".18rem .42rem", borderRadius: 999,
            border: "1px solid rgba(255,255,255,.12)", background: "rgba(31,31,35,.94)",
            display: "inline-flex", alignItems: "center", gap: ".28rem", lineHeight: 1, cursor: "default",
            boxShadow: "0 2px 8px rgba(0,0,0,.15)",
        }}>
            <span style={{ fontSize: ".78rem" }}>{emoji}</span>
            {members.length > 1 && <span style={{ fontSize: ".61rem", fontWeight: 750, color: "rgba(255,255,255,.62)" }}>{members.length}</span>}
            <span style={{ display: "inline-flex", alignItems: "center", marginLeft: members.length > 1 ? ".02rem" : 0 }}>
                {members.slice(0, 3).map((member, index) => (
                    <span key={member.country} style={{ display: "inline-flex", marginLeft: index ? "-.2rem" : 0, zIndex: 3 - index }}>
                        <FlagImg url={flagUrlMap[member.country] ?? null} alt={member.country} width=".78rem" height=".54rem" />
                    </span>
                ))}
            </span>
        </div>
        </>
    );
};

const ReactionStrip = ({ reactions, align = "left" }) => {
    const entries = Object.entries(reactions ?? {})
        .map(([key, value]) => ({ key, country: String(value?.country || key), value }))
        .filter(({ value }) => String(value?.emoji || "").trim());
    const flagUrlMap = useCountryFlagUrls(entries.map(({ country, value }) => ({ name: country, code: value?.code })));
    const groups = [];
    entries.forEach(({ country, value }) => {
        const emoji = String(value?.emoji || "").trim();
        let group = groups.find((candidate) => candidate.emoji === emoji);
        if (!group) {
            group = { emoji, members: [] };
            groups.push(group);
        }
        group.members.push({ country, code: value?.code });
    });
    if (!groups.length) return null;

    return (
        <div data-diplomacy-reactions="multi" style={{
            display: "flex", flexWrap: "wrap", gap: ".28rem", marginTop: ".28rem",
            justifyContent: align === "right" ? "flex-end" : "flex-start",
        }}>
            {groups.map((group) => <ReactionChip key={group.emoji} emoji={group.emoji} members={group.members} flagUrlMap={flagUrlMap} />)}
        </div>
    );
};

// A demand between the player and their own Overlord or Puppet
// (runtime/demandCheck.js, chatThreads.js), drawn like a poll: a card in the
// thread, answered by the side whose move it is, once. Two buttons and your own
// words, the shape of an interactive event's "play it out / let it pass" with an
// angle of your own. It appears only on DEMANDS — every other message from an
// Overlord is just a message.
//
//   the player is the Puppet, the demand open      → Accept · Refuse · an alternative
//   the player is the Puppet, having refused        → the same choice, to think again
//   the player is the Overlord, an alternative on it → Accept it · Reject (optionally revised)
//
// A card sits under the message that made the demand, where the conversation
// reached it, rather than at the foot of the thread.
//
// Only a Refuse costs the Puppet anything, and only once (gameState.js
// chargeRefusals). A refusal is not the end of it: the card stays answerable, so
// a player who thinks better of it agrees to the same demand instead of being
// handed a second one. Rejecting an alternative is demanding again: revised if
// you write something, the original restated if you do not.
const DEMAND_STATUS_TEXT = {
    accepted: "Accepted",
    refused: "Refused",
    settled: "Settled on the alternative",
    superseded: "Replaced by a new demand",
};

const DemandCard = ({ demand, playerCountry, busy = false, onAnswer, onAcceptAlternative, onReject }) => {
    const [text, setText] = useState("");
    const me = String(playerCountry ?? "").trim().toLowerCase();
    const iAmPuppet = String(demand?.target ?? "").trim().toLowerCase() === me;
    const iAmOverlord = String(demand?.by ?? "").trim().toLowerCase() === me;
    const reconsidering = iAmPuppet && demand?.status === "refused";
    const myMovePuppet = iAmPuppet && (demand?.status === "open" || reconsidering);
    const myMoveOverlord = iAmOverlord && demand?.status === "countered";
    const settled = myMovePuppet ? "" : DEMAND_STATUS_TEXT[demand?.status] ?? "";
    const standing = reconsidering ? "Refused" : "";

    const button = (label, onClick, tone = "neutral") => (
        <button
            type="button"
            disabled={busy}
            onClick={onClick}
            style={{
                background: tone === "danger" ? "rgba(248,113,113,0.14)" : tone === "go" ? "rgba(74,222,128,0.14)" : "rgba(255,255,255,0.06)",
                border: `1px solid ${tone === "danger" ? "rgba(248,113,113,0.45)" : tone === "go" ? "rgba(74,222,128,0.45)" : "rgba(255,255,255,0.16)"}`,
                borderRadius: "8px",
                color: "white",
                cursor: busy ? "default" : "pointer",
                flex: 1,
                fontFamily: "inherit",
                fontSize: "0.78rem",
                fontWeight: 700,
                opacity: busy ? 0.6 : 1,
                padding: "0.4rem 0.6rem",
            }}
        >{label}</button>
    );

    return (
        <div style={{
            background: "rgba(234,179,8,0.08)",
            border: "1px solid rgba(234,179,8,0.35)",
            borderRadius: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "0.45rem",
            margin: "0.35rem 0",
            opacity: settled ? 0.7 : 1,
            padding: "0.7rem 0.85rem",
        }}>
            <span style={{ fontSize: "0.68rem", letterSpacing: "0.04em", color: "rgba(250,204,21,0.9)", textTransform: "uppercase" }}>
                {iAmOverlord ? `Your demand · of ${demand?.target}` : `Demand · from ${demand?.by}`}
                {settled || standing ? ` · ${settled || standing}` : ""}
            </span>
            <span style={{ fontSize: "0.85rem", fontWeight: 700, lineHeight: 1.35 }}>{demand?.summary}</span>
            {demand?.alternative && (
                <span style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.78rem", lineHeight: 1.35 }}>
                    {iAmPuppet ? "You offered instead: " : `${demand?.target} offers instead: `}{demand.alternative}
                </span>
            )}

            {reconsidering && (
                <span style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.7rem", lineHeight: 1.35 }}>
                    You refused this. You can still change your mind.
                </span>
            )}

            {myMovePuppet && (
                <>
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                        {button(reconsidering ? "Accept after all" : "Accept", () => onAnswer?.("accepted", ""), "go")}
                        {!reconsidering && button("Refuse", () => onAnswer?.("refused", ""), "danger")}
                    </div>
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                        <input
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                            placeholder="Or offer an alternative…"
                            disabled={busy}
                            style={{ background: "rgba(0,0,0,0.28)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, color: "white", flex: 1, fontSize: "0.78rem", outline: "none", padding: "0.4rem 0.6rem" }}
                        />
                        {button("Offer", () => { if (text.trim()) { onAnswer?.("alternative", text.trim()); setText(""); } })}
                    </div>
                </>
            )}

            {myMoveOverlord && (
                <>
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                        {button("Accept alternative", () => onAcceptAlternative?.(), "go")}
                        {button("Reject", () => { onReject?.(text.trim()); setText(""); }, "danger")}
                    </div>
                    <input
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        placeholder="Revise your demand (or leave empty to insist on it)…"
                        disabled={busy}
                        style={{ background: "rgba(0,0,0,0.28)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, color: "white", fontSize: "0.78rem", outline: "none", padding: "0.4rem 0.6rem" }}
                    />
                </>
            )}

            {!settled && !myMovePuppet && !myMoveOverlord && (
                <span data-no-translate style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.68rem" }}>
                    {demand?.status === "countered"
                        ? `Waiting for ${demand?.by} to consider the alternative`
                        : `Waiting for ${demand?.target}'s answer`}
                </span>
            )}
        </div>
    );
};

const MessageBubble = ({ msg, onRetry, compact = false, showTime = true }) => {
    const isPlayer = msg.role === "user";
    const isError  = msg.role === "error";
    const [hovered, setHovered] = useState(false);
    const [copied, setCopied] = useState(false);
    const flagUrl  = useCountryFlagUrl(isPlayer || isError ? {} : { code: msg.code, name: msg.speaker });
    const nationColor = useNationColor(!isPlayer && !isError ? msg.code : null);
    const accentColor = nationColor ?? ((!isPlayer && !isError) ? countryAccentColor(msg.speaker ?? "") : null);

    const copyMessage = async () => {
        try {
            await navigator?.clipboard?.writeText?.(String(msg.text ?? ""));
            setCopied(true);
            setTimeout(() => setCopied(false), 900);
        } catch { /* clipboard may be unavailable in restricted desktop contexts */ }
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: isPlayer ? "flex-end" : "flex-start", overflow: "visible", marginTop: compact ? "-.55rem" : 0 }}>
        <div style={{ position: "relative", maxWidth: isError ? "82%" : "min(70%, 42rem)", overflow: "visible" }}>

        {!isPlayer && !compact && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: ".34rem", fontSize: ".7rem", color: "rgba(255,255,255,.46)", marginBottom: ".28rem", whiteSpace: "nowrap" }}>
            {isError ? "⚠️ Error" : <><FlagImg url={flagUrl} alt={msg.speaker} size=".95em" /><strong style={{ fontWeight: 650, color: "rgba(255,255,255,.58)" }}>{msg.speaker}</strong></>}
            </span>
        )}

        {isPlayer && msg.catchUpLabel && (
            <div title={msg.catchUp || ""} style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.66rem", marginBottom: "0.25rem", textAlign: "right" }}>
                ⏳ {msg.catchUpLabel}
            </div>
        )}

        <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ position: "relative" }}>
            <div data-no-translate={isPlayer ? "" : undefined} style={{
                padding: ".62rem .82rem",
                borderRadius: isPlayer ? "13px 13px 3px 13px" : "13px 13px 13px 3px",
                backgroundColor: isPlayer ? "rgba(59,130,246,.92)" : isError ? "rgba(239,68,68,0.16)" : `color-mix(in srgb, ${accentColor} 4%, rgba(35,35,39,0.96))`,
                fontSize: ".85rem", lineHeight: "1.5", whiteSpace: "pre-wrap", wordBreak: "break-word",
                border: isPlayer ? "1px solid rgba(147,197,253,.2)" : isError ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(255,255,255,.08)",
                borderLeft: (!isPlayer && !isError) ? `2px solid color-mix(in srgb, ${accentColor} 72%, white 8%)` : undefined,
                boxSizing: "border-box", boxShadow: "0 2px 10px rgba(0,0,0,.12)",
            }}>
            {isPlayer ? msg.text : <Markdown className="chat-markdown">{msg.text}</Markdown>}
            </div>
            {!isError && hovered && (
                <button type="button" onClick={copyMessage} title={copied ? "Copied" : "Copy message"} aria-label="Copy message" style={{
                    position: "absolute", top: ".2rem", [isPlayer ? "right" : "left"]: "calc(100% + .35rem)",
                    width: "1.6rem", height: "1.6rem", borderRadius: 7, border: "1px solid rgba(255,255,255,.09)",
                    background: "rgba(24,24,27,.94)", color: copied ? "#86efac" : "rgba(255,255,255,.46)",
                    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,.2)",
                }}>
                    <CopyIcon />
                </button>
            )}
        </div>

        <ReactionStrip reactions={msg.reactions} align={isPlayer ? "right" : "left"} />

        {isError && onRetry && (
            <button onClick={onRetry}
            style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginTop: "0.4rem", padding: "0.3rem 0.6rem", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.12)", color: "#fca5a5", fontSize: "0.75rem", fontWeight: 600, fontFamily: "sans-serif", cursor: "pointer", transition: "all 0.12s ease" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.22)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.6)"; e.currentTarget.style.color = "#fecaca"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(239,68,68,0.12)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.35)"; e.currentTarget.style.color = "#fca5a5"; }}>
            <RetryIcon /> Retry
            </button>
        )}

        {!isPlayer && showTime && msg.time && (
            <span style={{ fontSize: ".63rem", color: "rgba(255,255,255,.27)", marginTop: ".28rem", display: "block" }}>
            {formatGameDateReadable(msg.time, "MMM D, YYYY") || msg.time}
            </span>
        )}
        </div>
        </div>
    );
};


const InstitutionRecord = ({ msg }) => {
    const raw = String(msg?.text ?? "").trim();
    if (!raw) return null;
    const established = /institutional channel established\.?$/i.test(raw);
    const text = established ? raw.replace(/\s+institutional channel established\.?$/i, " council opened.") : raw;
    return (
        <div style={{ display: "flex", justifyContent: "center", padding: ".12rem .75rem" }}>
            <div style={{ maxWidth: "76%", display: "inline-flex", alignItems: "center", gap: ".45rem", border: "1px solid rgba(139,92,246,.28)", background: "rgba(139,92,246,.065)", borderRadius: 8, padding: ".34rem .58rem", color: "rgba(255,255,255,.58)", fontSize: ".6rem", lineHeight: 1.35 }}>
                <span aria-hidden="true" style={{ color: "#a78bfa", fontSize: ".72rem" }}>◇</span>
                <span style={{ color: "#a78bfa", fontSize: ".52rem", fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>Institution record</span>
                <span>{text}</span>
            </div>
        </div>
    );
};

// `label`: "Thinking" while the request is out, "Typing" while a line of the
// table's turn waits to be said.
const TypingBubble = ({ speaker, code, hint = "", label = "Thinking" }) => {
    const flagUrl = useCountryFlagUrl({ code, name: speaker });
    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.7rem", color: "rgba(255,255,255,0.4)", marginBottom: "0.25rem" }}><FlagImg url={flagUrl} alt={speaker} size="0.95em" /> {speaker}</span>
        <div style={{ padding: "0.6rem 0.85rem", borderRadius: "12px 12px 12px 4px", backgroundColor: "rgba(255,255,255,0.08)", fontSize: "0.85rem" }}>
        <ThinkingDots label={label} />
        </div>
        {hint && <span style={{ fontSize: "0.66rem", color: "rgba(255,255,255,0.32)", marginTop: "0.3rem" }}>{hint}</span>}
        </div>
    );
};

const LifecycleThinkingBubble = ({ count = 0 }) => (
    <div data-lifecycle-group-thinking="true" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
    <span style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.42)", marginBottom: "0.25rem" }}>
        {count > 1 ? `${count} invited governments` : "Invited government"}
    </span>
    <div style={{ display: "inline-flex", alignItems: "center", gap: ".55rem", padding: "0.6rem 0.85rem", borderRadius: "12px 12px 12px 4px", backgroundColor: "rgba(139,92,246,0.09)", border: "1px solid rgba(167,139,250,.14)", fontSize: "0.78rem", color: "rgba(255,255,255,.58)" }}>
        <span>Considering membership</span><ThinkingDots />
    </div>
    </div>
);

const lifecycleOutcomePresentation = (entry = {}) => {
    const status = String(entry?.status || "pending").trim().toLowerCase();
    if (status === "accepted") return { label: entry?.requestedStatus === "observer" ? "Observer accepted" : "Accepted", tone: "good" };
    if (status === "rejected") return { label: "Declined", tone: "bad" };
    if (status === "pending-approval") return { label: "Awaiting member approval", tone: "live" };
    if (status === "negotiating") return { label: entry?.decision === "delay" ? "Decision delayed" : "Negotiating terms", tone: "purple" };
    if (status === "resolved") return { label: "Resolved", tone: "good" };
    return { label: "Awaiting response", tone: "neutral" };
};

const LifecycleOutcomePanel = ({ cases = [], institution = null, concluded = false, onViewInstitution = null }) => {
    if (!cases.length) return null;
    return (
        <div data-lifecycle-outcome-panel="true" style={{ marginBottom: ".45rem", padding: ".55rem .62rem", border: `1px solid ${concluded ? "rgba(34,197,94,.2)" : "rgba(167,139,250,.16)"}`, borderRadius: 9, background: concluded ? "rgba(34,197,94,.045)" : "rgba(139,92,246,.045)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: ".55rem", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 15rem", minWidth: 0 }}>
                    <div style={{ fontSize: ".56rem", fontWeight: 850, color: concluded ? "#bbf7d0" : "#ddd6fe" }}>{concluded ? "Membership negotiation concluded" : "Membership responses"}</div>
                    {concluded && institution?.status && <div style={{ marginTop: ".14rem", fontSize: ".51rem", color: "rgba(255,255,255,.4)" }}>{institution.name || "Institution"} is now {String(institution.status).replace(/[-_]/g, " ")}.</div>}
                </div>
                {concluded && onViewInstitution && <button type="button" onClick={onViewInstitution} style={{ border: "1px solid rgba(167,139,250,.22)", borderRadius: 8, background: "rgba(139,92,246,.1)", color: "#ede9fe", padding: ".28rem .46rem", fontSize: ".54rem", fontWeight: 760, cursor: "pointer" }}>View institution →</button>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: ".3rem", marginTop: ".45rem" }}>
                {cases.map((entry) => {
                    const presentation = lifecycleOutcomePresentation(entry);
                    return <div key={entry.id || entry.polity} style={{ display: "flex", alignItems: "center", gap: ".45rem", minWidth: 0 }}><span style={{ flex: 1, minWidth: 0, fontSize: ".56rem", color: "rgba(255,255,255,.62)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.polity || "Government"}</span><InstitutionPill tone={presentation.tone}>{presentation.label}</InstitutionPill></div>;
                })}
            </div>
        </div>
    );
};

// The campaign in front of the player, for a write made seconds after the
// turn that produced it (runtime/campaignGuard.js).
const activeCampaignNow = () => String(getLibraryState()?.activeGameId ?? "").trim();

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
        onFocus={e => e.target.style.borderColor = "rgba(255,255,255,0.25)"}
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
        style={{ flex: 2, padding: "0.65rem", borderRadius: "10px", border: "none", background: selected.length > 0 ? "rgba(255,255,255,0.28)" : "rgba(59,130,246,0.3)", color: "white", fontSize: "0.85rem", fontWeight: 600, cursor: selected.length > 0 ? "pointer" : "not-allowed", fontFamily: "sans-serif" }}
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

const ConversationView = ({ chat, playerCountry, gameDate, world = {}, onDelete, onBack, onMessagesUpdate, onThreadUpdate, unread = false, onToggleRead, draft = "", onDraftApplied, onInstitutionNavigate, onLifecycleResult, embeddedInstitution = false }) => {
    // Two-step delete, matching the list row. Disarms on blur so a half-pressed
    // delete never sits waiting to catch a later click.
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const countries = useMemo(
        () => Array.isArray(chat?.countries)
            ? chat.countries.filter((country) => country && (country.name || country.code))
            : [],
        [chat?.countries],
    );
    const counterparts = useMemo(() => diplomaticCounterparts(countries, playerCountry), [countries, playerCountry]);
    const headerCountries = counterparts.slice(0, 4);
    const headerFlagUrls = useCountryFlagUrls(headerCountries);
    const displayThreadTitle = chat?.title || summarizeDiplomaticParticipants(counterparts);
    const participantCount = counterparts.length + (playerCountry ? 1 : 0);
    const isGroup = counterparts.length > 1;
    const isInstitutional = Boolean(chat?.institutionId);
    const isLifecycleConversation = Boolean(chat?.lifecycleInstitutionId && chat?.lifecycleCaseIds?.length);
    // A lifecycle accession hearing can carry institutionId so native formal
    // ballots work, while still being a diplomatic negotiation rather than the
    // institution's permanent Council workspace.
    const isInstitutionCouncil = isInstitutional && !isLifecycleConversation;
    const playerLifecycleCase = useMemo(() => {
        if (!isLifecycleConversation || !playerCountry) return null;
        const wanted = new Set((Array.isArray(chat?.lifecycleCaseIds) ? chat.lifecycleCaseIds : []).map((id) => String(id || "").trim()));
        return institutionLifecycleCasesForPolity(world, playerCountry, { pendingOnly: true })
            .find(({ institution, case: entry }) => (
                String(institution?.id || "").trim() === String(chat?.lifecycleInstitutionId || "").trim()
                && wanted.has(String(entry?.id || "").trim())
                && String(entry?.polity || "").trim().toLowerCase() === String(playerCountry || "").trim().toLowerCase()
                && ["invitation", "founding-invitation"].includes(String(entry?.kind || "").trim().toLowerCase())
            ))?.case || null;
    }, [isLifecycleConversation, chat?.lifecycleInstitutionId, chat?.lifecycleCaseIds, world, playerCountry]);
    const institutionView = useMemo(() => {
        if (!isInstitutional || !chat?.institutionId) return null;
        try {
            return buildInstitutionDiplomacyView({
                world,
                institutionId: chat.institutionId,
                playerCountry,
            });
        } catch {
            return null;
        }
    }, [isInstitutional, chat?.institutionId, world, playerCountry]);
    const institution = institutionView?.institution || null;
    const institutionPendingBallots = Number(institutionView?.playerPendingBallotCount || 0);
    const institutionPendingAmendments = Number(institutionView?.playerPendingAmendmentReviewCount || 0);
    const institutionPendingActions = institutionPendingBallots + institutionPendingAmendments;

    const [messages, setMessages]               = useState(chat.messages ?? []);
    // A letter an event of the skip being revealed delivered waits for the
    // reveal to reach that event (runtime/unseenEvents.js) — on screen and in
    // what the leader is sent. The stored thread keeps it all along.
    const unseen = useUnseenEventIds();
    const [visibleMessageLimit, setVisibleMessageLimit] = useState(CHAT_INITIAL_RENDER_WINDOW);
    const [phase, setPhase]                     = useState("player");
    const [isLoading, setIsLoading]             = useState(false);
    const [playerInput, setPlayerInput]         = useState("");
    const [pendingCountry, setPendingCountry]   = useState(null);
    const [remainingQueue, setRemainingQueue]   = useState([]);
    const [speakingCountry, setSpeakingCountry] = useState(null);
    const [lifecycleCaseOverrides, setLifecycleCaseOverrides] = useState({});
    const [lifecycleRevealInProgress, setLifecycleRevealInProgress] = useState(false);
    const [stagedLifecycleSpeaker, setStagedLifecycleSpeaker] = useState(null);

    const lifecycleState = useMemo(() => {
        if (!isLifecycleConversation) return { institution: null, cases: [], responseCases: [], awaitingApprovalCases: [], resolvedCases: [], responseComplete: false };
        const base = institutionLifecycleConversationState(world, { institutionId: chat.lifecycleInstitutionId, caseIds: chat.lifecycleCaseIds });
        if (!Object.keys(lifecycleCaseOverrides).length) return base;
        const cases = base.cases.map((entry) => {
            const override = lifecycleCaseOverrides[entry.id];
            if (!override) return entry;
            const baseStatus = String(entry?.status || "pending").toLowerCase();
            return ["pending", "negotiating"].includes(baseStatus) ? override : entry;
        });
        const responseCases = cases.filter((entry) => ["pending", "negotiating"].includes(String(entry?.status || "").toLowerCase()));
        const awaitingApprovalCases = cases.filter((entry) => String(entry?.status || "").toLowerCase() === "pending-approval");
        const resolvedCases = cases.filter((entry) => !["pending", "negotiating", "pending-approval"].includes(String(entry?.status || "").toLowerCase()));
        return { ...base, cases, responseCases, awaitingApprovalCases, resolvedCases, responseComplete: cases.length > 0 && responseCases.length === 0 };
    }, [isLifecycleConversation, world, chat.lifecycleInstitutionId, chat.lifecycleCaseIds, lifecycleCaseOverrides]);
    const lifecycleCanRequestResponse = isLifecycleConversation && !isInstitutional && (lifecycleState.cases.length === 0 || lifecycleState.responseCases.length > 0);
    const lifecycleTerminal = isLifecycleConversation
        && lifecycleState.cases.length > 0
        && lifecycleState.resolvedCases.length === lifecycleState.cases.length
        && !lifecycleRevealInProgress;
    const lifecycleNegotiationConcluded = isLifecycleConversation
        && lifecycleState.cases.length > 0
        && lifecycleState.responseComplete
        && !lifecycleRevealInProgress;
    const lifecycleHasRecordedResponse = lifecycleState.cases.some((entry) => Boolean(entry?.decision) || String(entry?.status || "pending").toLowerCase() !== "pending");

    const nextSpeakerIdx    = useRef(0);
    const lastPlayerMessage = useRef("");
    // What the last batch got wrong, told to the next one (AI/chatActions.js
    // describeChatActionFeedback). Kept on the view: it is about the exchange,
    // not the saved thread.
    const actionFeedbackRef = useRef("");
    const messagesEndRef    = useRef(null);
    const messagesScrollRef = useRef(null);
    const messagesRef       = useRef(chat.messages ?? []);
    const composerRef       = useRef(null);
    const lifecycleRevealTokenRef = useRef(0);
    // A group turn is said a line at a time (AI/chatActions.js planChatReveal):
    // the first at once, each later one after its speaker has been seen typing.
    // The lines still to come are held HERE, not in the thread, until they are
    // shown — so a line the player cuts in on was never said, and nothing has
    // to be taken back out of the saved thread. `typingNext` is who is typing.
    const revealRef = useRef(null);
    const [typingNext, setTypingNext] = useState(null);
    // The thread as last rendered, for a line shown seconds after its turn: a
    // vote the player cast in between is kept under it.
    const chatRef = useRef(chat);
    useEffect(() => { chatRef.current = chat; }, [chat]);

    // DEMANDS, in the one-on-one thread between the player and their own
    // Overlord or Puppet (runtime/demandCheck.js). What the other side is to the
    // player, from the same shared rule as the list's markers.
    const puppetStatesOn = useActiveFeatures().puppetStates?.enabled !== false;
    const puppetRelations = usePuppetMarkers();
    const theyAre = !isGroup ? puppetRelations[countries[0]?.name]?.theyAre ?? "" : "";
    // The composer offers "make this a demand" only to an Overlord writing to
    // its own Puppet; an Overlord's demands of the player arrive on their own.
    const canDemand = theyAre === "puppet";
    const [makeDemand, setMakeDemand] = useState(false);
    const [demandBusy, setDemandBusy] = useState(false);
    const newThreadId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    // Appends events to the thread's log, the way a poll vote is — but read from
    // the thread as LAST RENDERED, never the copy this closure started with: a
    // demand is often appended after a model request, seconds later, and writing
    // the older copy back would drop whatever the thread gained meanwhile.
    const appendThreadEvents = (newEvents) => {
        if (!newEvents?.length) return;
        const current = chatRef.current ?? chat;
        const events = [
            ...(current.events?.length ? current.events : eventsFromLegacyChat({ ...current, messages: messagesRef.current })),
            ...newEvents,
        ];
        const projected = projectChatThread(events);
        onThreadUpdate?.(current.id, {
            events,
            countries: projected.countries,
            title: projected.title,
            polls: projected.polls,
            demands: projected.demands,
        });
    };

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
        const shown = withoutUnseenMessages(saved, unseen);
        if (shown.length > 0) loadDiplomaticHistory(shown);
        else startDiplomaticChat();
        setVisibleMessageLimit(CHAT_INITIAL_RENDER_WINDOW);
        setLifecycleCaseOverrides({});
        setLifecycleRevealInProgress(false);
        setStagedLifecycleSpeaker(null);
        lifecycleRevealTokenRef.current += 1;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chat.id]);

    // The reveal moved on while this thread was open: the leader is sent what
    // the player can now see. Not mid-reply — that exchange is already under way.
    const unseenKey = [...unseen].join("|");
    const unseenKeyAtOpen = useRef(unseenKey);
    useEffect(() => {
        if (unseenKeyAtOpen.current === unseenKey || isLoading) return;
        unseenKeyAtOpen.current = unseenKey;
        const shown = withoutUnseenMessages(messagesRef.current, unseen);
        if (shown.length > 0) loadDiplomaticHistory(shown);
        else startDiplomaticChat();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [unseenKey]);

        useEffect(() => {
            const scroller = messagesScrollRef.current;
            if (!scroller) return;
            scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
        }, [messages, isLoading, phase, typingNext]);

        const pushMessages = (updated) => {
            messagesRef.current = updated;
            setMessages(updated);
            onMessagesUpdate(chat.id, updated);
        };

        const presentCommittedLifecycleReplies = async (fullMessages, newMessageIds) => {
            const plan = buildLifecycleReplyRevealPlan({ messages: fullMessages, newMessageIds });
            messagesRef.current = fullMessages;
            if (plan.length < 2) {
                setMessages(fullMessages);
                return;
            }
            const token = ++lifecycleRevealTokenRef.current;
            const replyIds = new Set(plan.map((row) => String(row.message?.id || "")));
            const baseMessages = fullMessages.filter((message) => !replyIds.has(String(message?.id || "")));
            setLifecycleRevealInProgress(true);
            setStagedLifecycleSpeaker(null);
            setMessages([...baseMessages, plan[0].message]);
            for (let index = 1; index < plan.length; index += 1) {
                const row = plan[index];
                if (lifecycleRevealTokenRef.current !== token) return;
                setStagedLifecycleSpeaker({ name: row.message?.speaker || "Government", code: row.message?.code || "" });
                await new Promise((resolve) => setTimeout(resolve, row.gapMs));
                if (lifecycleRevealTokenRef.current !== token) return;
                setMessages([...baseMessages, ...plan.slice(0, index + 1).map((entry) => entry.message)]);
            }
            if (lifecycleRevealTokenRef.current !== token) return;
            setMessages(fullMessages);
            setStagedLifecycleSpeaker(null);
            setLifecycleRevealInProgress(false);
        };

        // The panel's copy of a thread's messages, from its log's projection.
        const viewMessagesOf = (projected) => projected.messages.map((message) => ({
            id: message.id,
            role: message.role,
            speaker: message.speaker,
            code: message.code,
            text: message.text,
            time: message.time,
            reactions: message.reactions,
            ...(message.memorySummary ? { memorySummary: message.memorySummary } : {}),
            ...(message.eventId ? { eventId: message.eventId } : {}),
            ...(message.catchUp ? { catchUp: message.catchUp, catchUpLabel: message.catchUpLabel } : {}),
        }));

        // Adds a step of a group turn to its thread: the log, the roster, title
        // and polls, and the panel's messages when that thread is on screen.
        // Nothing is written once the player has switched campaign: the runtime
        // files follow the open campaign, so a late write would land on the one
        // switched to (runtime/campaignGuard.js).
        const addTurnEvents = (reveal, newEvents, { cursors = null, onScreen = true } = {}) => {
            if (campaignChanged(reveal.campaignId, activeCampaignNow())) return false;
            const live = chatRef.current;
            const events = [
                ...logForNextStep({ turnLog: reveal.events, wroteAny: reveal.written, chatId: reveal.chatId, liveChatId: live?.id, liveLog: live?.events }),
                ...newEvents,
            ];
            reveal.events = events;
            reveal.written = true;
            const projected = projectChatThread(events);
            const shown = viewMessagesOf(projected);
            if (onScreen && String(live?.id) === String(reveal.chatId)) pushMessages(shown);
            else onMessagesUpdate(reveal.chatId, shown);
            onThreadUpdate?.(reveal.chatId, { events, countries: projected.countries, title: projected.title, polls: projected.polls, demands: projected.demands, ...(cursors ? { cursors } : {}) });
            return true;
        };

        // The rest of a group turn, a line at a time (chatReveal.js): each
        // speaker is seen typing for CHAT_REVEAL_PAUSE_MS, then says the line.
        const sayLater = (reveal, steps) => {
            revealRef.current = reveal;
            reveal.controller = startChatReveal({
                steps,
                pauseMs: CHAT_REVEAL_PAUSE_MS,
                onTyping: (step) => setTypingNext(step
                    ? { speaker: step.speaker, code: countries.find((country) => (country.name || "").toLowerCase() === step.speaker.toLowerCase())?.code || "" }
                    : null),
                onSay: (step) => {
                    if (addTurnEvents(reveal, step.events)) return true;
                    logDebugEvent("diplomacy", `Chat #${reveal.chatId}: the campaign changed while the table was still talking; the rest of the turn was not written.`, undefined, { problem: true });
                    return false;
                },
                onEnd: () => { if (revealRef.current === reveal) revealRef.current = null; },
            });
        };

        // The player spoke while the table was still talking. What had not been
        // said yet never is — the way Intervene discards the events a skip's
        // reveal has not reached — and the next turn is told whose lines went
        // unsaid (describeChatCutIn).
        const cutIn = () => {
            const reveal = revealRef.current;
            const unsaid = reveal?.controller?.stop() ?? [];
            if (!unsaid.length) return;
            const note = describeChatCutIn({ player: playerCountry, steps: unsaid });
            if (note) actionFeedbackRef.current = [actionFeedbackRef.current, note].filter(Boolean).join("\n\n");
            logDebugEvent("diplomacy",
                `${playerCountry || "The player"} cut in on chat #${reveal.chatId}: ${unsaid.length} line(s) of the table's turn were never said.`,
                { unsaid: unsaid.map((step) => step.speaker) }, { verbose: true });
        };

        // Leaving the thread is not cutting in: what the table was still to say
        // is said, all at once, into the thread it belongs to.
        useEffect(() => () => {
            const reveal = revealRef.current;
            const rest = reveal?.controller?.stop() ?? [];
            if (rest.length) addTurnEvents(reveal, rest.flatMap((step) => step.events), { onScreen: false });
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [chat.id]);

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
            // The player's message as stored: the catch-up it was sent with
            // (AI/conversationCatchUp.js), and the moment it was asked from — a
            // reply is dated with its question. A retry finds the same one.
            const asked = [...messagesRef.current].reverse().find((msg) => msg.role === "user" && msg.text === playerMessage);
            const repliedOn = asked?.time || gameDate;
            try {
                const { reply, reaction, memorySummary } = await sendDiplomaticMessage(playerMessage, country.name, countries, { chatId: chat.id, catchUp: asked?.catchUp || "" });
                // The thread's rolling durable memory rides on the reply that
                // produced it, so a reopened thread, the advisor's one-off sends
                // and the world director read the same continuity. Its id is set
                // here so a demand this reply makes can be attached to it.
                const leaderMessage = {
                    id: newThreadId("msg"),
                    role: "leader", speaker: country.name, code: country.code, text: reply, time: repliedOn,
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
                // Did this reply make, answer or settle a demand? Only asked in
                // the one-on-one thread between the player and their own Overlord
                // or Puppet — everywhere else checkDemandReply returns at once,
                // without a request. It runs after the reply is shown, so the
                // player is never kept waiting for it; a failure records nothing.
                if (!isGroup && theyAre) {
                    void checkDemandReply({
                        chat: { ...(chatRef.current ?? chat), messages: messagesRef.current },
                        speaker: country.name,
                        reply,
                        answering: playerMessage,
                        messageId: leaderMessage.id,
                        time: repliedOn,
                    })
                        .then((events) => appendThreadEvents(events))
                        .catch((error) => logDebugEvent("diplomacy", `Demand check on ${country.name}'s reply failed; nothing recorded.`, error));
                }
            } catch (err) {
                pushMessages([...messagesRef.current, {
                    role: "error", speaker: country.name, code: country.code, text: err.message, time: repliedOn,
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

        // A GROUP turn in one request (AI/chatActions.js): every AI participant
        // acts in a single answer — who speaks, who only reacts, who brings
        // someone in, who calls a vote — instead of one request to pick the
        // speaker and one per leader after it. A failure falls back to the
        // rotation below, which is the behaviour this replaces.
        const runGroupTurn = async (text, nextMessages, { lifecycleResponseRequested = false } = {}) => {
            setIsLoading(true);
            // The player's line, with the catch-up it carries and its moment.
            const asked = nextMessages.at(-1);
            // The campaign this turn belongs to: nothing is written after a switch.
            const campaignId = activeCampaignNow();
            try {
                const outcome = await runChatActionBatch({
                    chat: { ...chat, messages: nextMessages, actionFeedback: actionFeedbackRef.current },
                    playerMessage: text,
                    playerCountry,
                    catchUp: asked?.catchUp || "",
                    time: asked?.time || "",
                    lifecycleResponseRequested,
                });
                const newEvents = outcome?.newEvents ?? [];
                const spoken = newEvents.filter((event) => event.kind === "message");
                const lifecycleApplied = Array.isArray(outcome?.lifecycle) && outcome.lifecycle.length > 0;
                if (!newEvents.length && !lifecycleApplied) return false;
                actionFeedbackRef.current = outcome?.feedback ?? "";
                if (lifecycleApplied) {
                    setLifecycleCaseOverrides((previous) => {
                        const next = { ...previous };
                        for (const entry of outcome.lifecycle) {
                            const lifecycleCase = entry?.lifecycleCase;
                            if (lifecycleCase?.id) next[lifecycleCase.id] = lifecycleCase;
                        }
                        return next;
                    });
                }

                // Lifecycle response batches are committed atomically by native institution
                // governance, then only PRESENTED one government at a time. Ordinary group
                // turns keep Beta's staged reveal so the player can cut in before later lines
                // are ever written to the thread.
                if (isLifecycleConversation && lifecycleResponseRequested && outcome.committed === true) {
                    const projected = projectChatThread(outcome.events);
                    const projectedMessages = viewMessagesOf(projected);
                    onThreadUpdate?.(chat.id, {
                        events: outcome.events,
                        countries: projected.countries,
                        title: projected.title,
                        polls: projected.polls,
                        demands: projected.demands,
                        cursors: outcome.cursors,
                        committed: true,
                    });
                    const newMessageIds = spoken.map((event) => event.id).filter(Boolean);
                    await presentCommittedLifecycleReplies(projectedMessages, newMessageIds);
                } else {
                    const [first, ...later] = planChatReveal(newEvents);
                    const reveal = {
                        chatId: chat.id,
                        campaignId,
                        events: outcome.events.slice(0, outcome.events.length - newEvents.length),
                        written: false,
                        controller: null,
                    };
                    if (!addTurnEvents(reveal, first.events, { cursors: outcome.cursors })) {
                        logDebugEvent("diplomacy", `Chat #${chat.id}: the campaign changed while the table was answering; nothing was written.`, undefined, { problem: true });
                        return true;
                    }
                    if (later.length) sayLater(reveal, later);
                }
                setPhase("player");
                return true;
            } catch (error) {
                logDebugEvent("diplomacy", `The one-request chat turn failed in chat #${chat.id}; falling back to the rotation.`, error, { problem: true });
                return false;
            } finally {
                setIsLoading(false);
                setSpeakingCountry(null);
            }
        };

        // The player's own vote. Appended to the thread's log like any other
        // event, and never cast for them by a model (chatActions.js refuses an
        // action whose actor is human-controlled).
        const handlePlayerVote = (poll, optionId) => {
            if (!poll?.id || !optionId) return;
            const already = Object.keys(poll.votes ?? {}).some((voter) => voter.toLowerCase() === String(playerCountry ?? "").toLowerCase());
            if (already) return;
            const events = [
                ...(chat.events?.length ? chat.events : eventsFromLegacyChat({ ...chat, messages: messagesRef.current })),
                { id: `vote-${poll.id}-${playerCountry}`, kind: "poll_vote_cast", time: gameDate, by: playerCountry, pollId: poll.id, optionId },
            ];
            const projected = projectChatThread(events);
            onThreadUpdate?.(chat.id, { events, countries: projected.countries, title: projected.title, polls: projected.polls });
            logDebugEvent("diplomacy", `${playerCountry} voted in chat #${chat.id}.`, { poll: poll.question, optionId }, { verbose: true });
        };

        // The demand card's moves (runtime/demandCheck.js). Each is appended to
        // the thread's log AND said, as a line from the player, so the other side
        // answers it the way it answers anything typed — and that answer is then
        // checked in turn. Only a refusal costs the Puppet anything.
        const answerDemand = async (demand, answer, text = "") => {
            const event = playerAnswerEvent({ demand, player: playerCountry, answer, text, time: gameDate, idFor: newThreadId });
            if (!event) return;
            setDemandBusy(true);
            try {
                appendThreadEvents([event]);
                // A change of mind says so, or the other side reads the
                // acceptance as coming out of nowhere.
                const reconsidered = demand.status === "refused";
                const line = answer === "accepted"
                    ? (reconsidered ? `We have reconsidered. We accept: ${demand.summary}.` : `We accept: ${demand.summary}.`)
                    : answer === "refused" ? "We refuse this demand."
                        : (reconsidered ? `We have reconsidered. ${text}` : text);
                await submitPlayerText(line);
            } finally {
                setDemandBusy(false);
            }
        };

        const acceptAlternative = async (demand) => {
            const event = playerAnswerEvent({ demand, player: playerCountry, answer: "alternative_accepted", time: gameDate, idFor: newThreadId });
            if (!event) return;
            setDemandBusy(true);
            try {
                appendThreadEvents([event]);
                await submitPlayerText(`We accept your alternative: ${demand.alternative}.`);
            } finally {
                setDemandBusy(false);
            }
        };

        // Rejecting an alternative is demanding again: the player's revision if
        // they wrote one, the original restated if not — "this is the demand".
        const rejectAlternative = async (demand, revised = "") => {
            setDemandBusy(true);
            try {
                await submitPlayerText(revised || `No. The demand stands: ${demand.summary}.`, {
                    onSent: ({ messageId, time }) => appendThreadEvents([playerDemandEvent({
                        player: playerCountry,
                        target: demand.target,
                        text: revised,
                        openDemand: demand,
                        messageId,
                        time,
                        idFor: newThreadId,
                    })].filter(Boolean)),
                });
            } finally {
                setDemandBusy(false);
            }
        };

        const handlePlayerSubmit = async () => {
            const text = playerInput.trim();
            if (!text || isLoading) return;
            setPlayerInput("");
            // "Make this a demand" — only offered to an Overlord writing to its
            // own Puppet, and only for this one message.
            const asDemand = canDemand && makeDemand;
            setMakeDemand(false);
            await submitPlayerText(text, {
                // Rejecting an alternative from the card is demanding again; so is
                // this. Either replaces whatever demand was still in play.
                onSent: asDemand
                    ? ({ messageId, time }) => appendThreadEvents([playerDemandEvent({
                        player: playerCountry,
                        target: countries[0]?.name,
                        text,
                        openDemand: openDemandOf(chatRef.current),
                        messageId,
                        time,
                        idFor: newThreadId,
                    })].filter(Boolean))
                    : null,
            });
        };

        // Sends a line as the player and gets the table's answer: the composer's
        // path, and the demand card's, so a button press is answered exactly as a
        // typed message is. `onSent` runs once the line is on the thread, with its
        // id — which is what a demand made by this line is attached to.
        const submitPlayerText = async (text, { onSent = null } = {}) => {
            if (!text || isLoading) return;
            // Speaking while the table is still talking cuts it off.
            cutIn();
            lastPlayerMessage.current = text;
            // What the world did since this thread last spoke, told to the
            // leaders with the player's line and kept on it (AI/conversationCatchUp.js
            // buildThreadCatchUp), dated from the moment the player is looking at.
            const moment = await readSeenChatMoment(gameDate);
            const catchUp = buildLeaderCatchUp(messagesRef.current, chat, playerCountry, moment);
            const messageId = newThreadId("msg");
            const nextMessages = [...messagesRef.current, {
                id: messageId, role: "user", speaker: playerCountry, text, time: moment.date || gameDate,
                ...(catchUp.text ? { catchUp: catchUp.text, catchUpLabel: catchUp.label } : {}),
            }];
            pushMessages(nextMessages);
            onSent?.({ messageId, time: moment.date || gameDate });
            // One request for the whole table. Only for a group: a one-on-one
            // chat is already a single request, and its streaming reply is what
            // the player watches arrive.
            if ((isGroup || (chat.lifecycleCaseIds?.length && chat.lifecycleInstitutionId)) && await runGroupTurn(text, nextMessages)) return;
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

        const handleLifecycleContinue = async () => {
            if (!isLifecycleConversation || isLoading || playerLifecycleCase) return;
            if (!isInstitutional && lifecycleState.cases.length > 0 && lifecycleState.responseCases.length === 0) return;
            await runGroupTurn("", messagesRef.current, { lifecycleResponseRequested: true });
        };

        const handlePlayerLifecycleDecision = async (decision) => {
            if (!playerLifecycleCase || isLoading) return;
            setIsLoading(true);
            try {
                const result = await commitInstitutionLifecycleCommand({
                    playerCountry,
                    date: gameDate,
                    expectedGameId: String(getLibraryState()?.activeGameId || ""),
                    command: {
                        type: "respond",
                        institutionId: chat.lifecycleInstitutionId,
                        caseId: playerLifecycleCase.id,
                        actorPolity: playerCountry,
                        decision,
                        authority: "player",
                    },
                });
                onLifecycleResult?.(result);
            } catch (error) {
                logDebugEvent("diplomacy", `Player institution lifecycle response failed in chat #${chat.id}.`, error, { problem: true });
                pushMessages([...messagesRef.current, { role: "error", speaker: "System", text: error?.message || "The institution response could not be recorded.", time: gameDate }]);
            } finally {
                setIsLoading(false);
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

        // One-request lifecycle turns ask every unresolved government at the table
        // in the same model call. Do not pretend the first roster entry alone is
        // "thinking" while that grouped request is in flight.
        const lifecycleGroupThinking = isLifecycleConversation && isLoading && !speakingCountry && !stagedLifecycleSpeaker && countries.length > 1;
        const typingSpeaker = stagedLifecycleSpeaker ?? speakingCountry ?? (!lifecycleGroupThinking ? countries[0] : null);
        // What the reveal has reached, each with its place in the stored thread
        // (a retry replays the stored message at that index).
        const shownEntries = messages
            .map((msg, index) => ({ msg, index }))
            .filter(({ msg }) => !unseen.has(String(msg?.eventId ?? "")));
        const visibleEntries = shownEntries.length > visibleMessageLimit
            ? shownEntries.slice(shownEntries.length - visibleMessageLimit)
            : shownEntries;
        const hiddenMessageCount = shownEntries.length - visibleEntries.length;

        // DEMANDS, placed in the conversation rather than under it
        // (runtime/demandCheck.js placeDemandCards).
        // A demand belongs to an overlord and its puppet, so a game with the
        // system switched off shows none — including ones a thread was already
        // carrying when it was switched off. They are not deleted: the thread
        // keeps its log, and switching back on brings the open ones back.
        const { byMessage: demandsByMessage, stranded: strandedDemands } = placeDemandCards({
            messages: visibleEntries.map(({ msg }) => msg),
            demands: puppetStatesOn ? chat.demands : [],
            isGroup,
        });
        const renderDemandCard = (demand) => (
            <DemandCard
                key={demand.id}
                demand={demand}
                playerCountry={playerCountry}
                busy={demandBusy || isLoading}
                onAnswer={(answer, text) => answerDemand(demand, answer, text)}
                onAcceptAlternative={() => acceptAlternative(demand)}
                onReject={(text) => rejectAlternative(demand, text)}
            />
        );

        return (
            <>
            {isInstitutionCouncil ? (!embeddedInstitution ? (
                <>
                {/* Institutional councils are canonical records and intentionally expose no delete control. */}
                <div style={{ display: "flex", alignItems: "center", gap: ".75rem", padding: ".75rem 1rem", borderBottom: "1px solid rgba(255,255,255,.07)", flexShrink: 0 }}>
                    <button onClick={onBack} aria-label="Back to institution" style={{ background: "none", border: 0, color: "rgba(255,255,255,.55)", cursor: "pointer", display: "flex", padding: ".22rem", borderRadius: 6 }}><BackIcon /></button>
                    {institution && <InstitutionEmblem institution={institution} size={48} />}
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: ".45rem" }}>
                            <strong style={{ fontSize: ".94rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{institution?.name || chat.title || "Institution council"}</strong>
                            {institution?.status && <InstitutionPill tone={String(institution.status).toLowerCase() === "active" ? "good" : "neutral"}>{institution.status}</InstitutionPill>}
                        </div>
                        <div style={{ marginTop: ".12rem", fontSize: ".56rem", color: "rgba(255,255,255,.38)" }}>
                            {String(institution?.kind || "institution").replace(/[-_]/g, " ")}{institution?.shortName ? ` · ${institution.shortName}` : ""}{institution?.foundedDate ? ` · founded ${institution.foundedDate}` : ""}
                        </div>
                    </div>
                    <button onClick={() => onToggleRead?.()} title={unread ? "Mark as read" : "Mark as unread"} aria-label={unread ? "Mark as read" : "Mark as unread"} style={{ display: "flex", alignItems: "center", background: "none", border: "1px solid transparent", cursor: "pointer", color: "rgba(147,197,253,.78)", padding: ".3rem", borderRadius: 6 }}><EnvelopeIcon filled={unread} /></button>
                </div>
                {institutionView && <div style={{ padding: ".55rem 1rem", flexShrink: 0 }}><InstitutionFacts view={institutionView} /></div>}
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".15rem", padding: "0 .7rem", borderBottom: "1px solid rgba(255,255,255,.06)", flexShrink: 0 }}>
                    {[
                        ["council", "Council"],
                        ["agenda", `Agenda${institutionView?.activeProposals?.length ? ` (${institutionView.activeProposals.length})` : ""}`],
                        ["decisions", `Decisions${institutionView?.decisionHistory?.length ? ` (${institutionView.decisionHistory.length})` : ""}`],
                        ["charter", "Charter"],
                        ["members", "Members"],
                        ["documents", "Documents"],
                    ].map(([key, label]) => <button key={key} onClick={() => key !== "council" && onInstitutionNavigate?.(key)} style={{ border: 0, borderBottom: `2px solid ${key === "council" ? "rgba(139,92,246,.95)" : "transparent"}`, background: "transparent", color: key === "council" ? "#ede9fe" : "rgba(255,255,255,.48)", padding: ".48rem .58rem .56rem", fontSize: ".61rem", fontWeight: 760, cursor: key === "council" ? "default" : "pointer" }}>{label}</button>)}
                </div>
                {institutionPendingActions > 0 && <button type="button" onClick={() => onInstitutionNavigate?.("agenda")} style={{ margin: ".65rem 1rem 0", padding: ".58rem .7rem", display: "flex", alignItems: "center", gap: ".7rem", border: "1px solid rgba(245,158,11,.28)", borderRadius: 10, background: "rgba(245,158,11,.08)", color: "#fde68a", cursor: "pointer", textAlign: "left", flexShrink: 0 }}>
                    <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: ".52rem", fontWeight: 850, letterSpacing: ".07em", textTransform: "uppercase", color: "rgba(253,230,138,.7)" }}>Action required</span><span style={{ display: "block", marginTop: ".12rem", fontSize: ".62rem", fontWeight: 700 }}>{institutionPendingBallots ? `${institutionPendingBallots} ballot${institutionPendingBallots === 1 ? "" : "s"} awaiting you` : ""}{institutionPendingBallots && institutionPendingAmendments ? " · " : ""}{institutionPendingAmendments ? `${institutionPendingAmendments} amendment review${institutionPendingAmendments === 1 ? "" : "s"}` : ""}</span></span>
                    <strong style={{ fontSize: ".6rem" }}>Review agenda →</strong>
                </button>}
                </>
            ) : null) : (
                <div data-diplomacy-header="modern" style={{ display: "flex", alignItems: "center", gap: ".72rem", padding: ".72rem 1rem", borderBottom: "1px solid rgba(255,255,255,.07)", background: "rgba(15,15,18,.26)", flexShrink: 0 }}>
                <button onClick={onBack} aria-label="Back to diplomacy" style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,.58)", display: "flex", padding: ".26rem", borderRadius: 7 }}><BackIcon /></button>
                <div style={{ display: "inline-flex", alignItems: "center", minWidth: headerCountries.length > 1 ? "2.5rem" : "1.55rem", paddingRight: headerCountries.length > 1 ? ".2rem" : 0, flexShrink: 0 }}>
                    {headerCountries.map((country, index) => (
                        <span key={`${country.name}-${country.code || index}`} style={{ display: "inline-flex", marginLeft: index ? "-.38rem" : 0, zIndex: headerCountries.length - index, filter: "drop-shadow(0 1px 2px rgba(0,0,0,.45))" }}>
                            <FlagImg url={headerFlagUrls[country.name] ?? null} alt={country.name} width="1.5rem" height="1rem" />
                        </span>
                    ))}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 750, fontSize: ".93rem", color: "rgba(255,255,255,.95)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayThreadTitle}</div>
                    <div style={{ marginTop: ".12rem", color: "rgba(255,255,255,.34)", fontSize: ".62rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {isLifecycleConversation ? (lifecycleNegotiationConcluded ? "Institution membership negotiation · concluded" : "Institution membership negotiation") : isGroup ? `${participantCount}-party diplomatic channel` : "Direct diplomatic channel"}
                    </div>
                </div>
                <button onClick={() => onToggleRead?.()} title={unread ? "Mark as read" : "Mark as unread"} aria-label={unread ? "Mark as read" : "Mark as unread"} style={{ display: "flex", alignItems: "center", background: "none", border: "1px solid transparent", cursor: "pointer", color: "rgba(96,165,250,.7)", padding: ".3rem", borderRadius: 7, lineHeight: 1 }}><EnvelopeIcon filled={unread} /></button>
                <button title={confirmingDelete ? "Click again to delete this chat" : "Delete chat"} aria-label={confirmingDelete ? "Confirm deleting this chat" : "Delete chat"} onClick={() => { if (confirmingDelete) { onDelete?.(); } else { setConfirmingDelete(true); } }} onBlur={() => setConfirmingDelete(false)} style={{ display: "flex", alignItems: "center", gap: ".3rem", background: confirmingDelete ? "rgba(239,68,68,.18)" : "none", border: `1px solid ${confirmingDelete ? "rgba(239,68,68,.55)" : "transparent"}`, cursor: "pointer", color: confirmingDelete ? "#fca5a5" : "rgba(239,68,68,.62)", fontSize: ".72rem", fontWeight: 600, fontFamily: "sans-serif", padding: confirmingDelete ? ".25rem .5rem" : ".3rem", borderRadius: 7, lineHeight: 1 }}>{confirmingDelete ? "Delete?" : <TrashIcon />}</button>
                <button onClick={onBack} aria-label="Close conversation" style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,.4)", fontSize: "1rem", lineHeight: 1, padding: ".28rem .34rem", borderRadius: 7 }}>✕</button>
                </div>
            )}

            <div ref={messagesScrollRef} data-institution-council-scroll={isInstitutionCouncil ? "messages" : undefined} style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "visible", scrollbarWidth: "none", padding: isInstitutionCouncil ? ".75rem" : "1rem 1.15rem", display: "flex", flexDirection: "column", gap: isInstitutionCouncil ? "1rem" : ".86rem" }}>
            {messages.length === 0 && !isLoading && (
                <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.35)", fontStyle: "italic", textAlign: "center", marginTop: "2rem" }}>
                {isInstitutionCouncil ? "The council floor is quiet. Address the institution when you are ready." : isLifecycleConversation ? "The accession table is open." : "Begin the diplomatic conversation."}
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
            {visibleEntries.map(({ msg, index }, i) => {
                const dateKey = chatDateKey(msg?.time);
                const previous = visibleEntries[i - 1]?.msg;
                const next = visibleEntries[i + 1]?.msg;
                const showDateSeparator = Boolean(dateKey) && (i === 0 || dateKey !== chatDateKey(previous?.time));
                const speakerKey = `${msg?.role || ""}::${String(msg?.speaker || "").trim().toLowerCase()}`;
                const previousKey = `${previous?.role || ""}::${String(previous?.speaker || "").trim().toLowerCase()}`;
                const nextKey = `${next?.role || ""}::${String(next?.speaker || "").trim().toLowerCase()}`;
                const compact = !showDateSeparator && msg?.role !== "system" && speakerKey === previousKey;
                const groupedWithNext = msg?.role !== "system" && speakerKey === nextKey && dateKey === chatDateKey(next?.time);
                return (
                    <React.Fragment key={index}>
                    {showDateSeparator && <ChatDateSeparator value={msg.time} />}
                    {isInstitutional && (msg.role === "system" || String(msg.speaker || "").toLowerCase() === "system")
                        ? <InstitutionRecord msg={msg} />
                        : <MessageBubble msg={msg} compact={compact} showTime={!groupedWithNext}
                            onRetry={msg.retry && !isLoading && index === messages.length - 1 ? () => handleRetry(index) : undefined} />}
                    {(demandsByMessage.get(msg.id) ?? []).map(renderDemandCard)}
                    </React.Fragment>
                );
            })}
            {/* Binding votes opened in this conversation (AI/chatActions.js).
                The AI participants vote in the same answer that opens one; the
                player votes here, and their vote is theirs alone to cast. */}
            {(chat.polls ?? []).map((poll) => (
                <PollCard
                    key={poll.id}
                    poll={poll}
                    playerCountry={playerCountry}
                    onVote={(optionId) => handlePlayerVote(poll, optionId)}
                />
            ))}
            {/* A demand whose message is older than the window, or which was
                never tied to one, still has to be answerable: it sits at the
                foot of the thread rather than nowhere. */}
            {strandedDemands.map(renderDemandCard)}
            {isLoading && lifecycleGroupThinking
                ? <LifecycleThinkingBubble count={lifecycleState.responseCases.length || countries.length} />
                : isLoading && typingSpeaker && <TypingBubble speaker={typingSpeaker.name} code={typingSpeaker.code} />}
            {!isLoading && typingNext && (
                <TypingBubble speaker={typingNext.speaker} code={typingNext.code} label="Typing" hint="Send a message now to cut in: what is still to come will not be said." />
            )}
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
                >{isInstitutionCouncil ? "Speak instead" : "Speak"}</button>
                <button
                onClick={handleLetSpeak}
                style={{ flex: 2, padding: "0.58rem 0.7rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.88)", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", fontFamily: "sans-serif", transition: "all 0.12s ease" }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.28)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
                >Let {pendingCountry.name} speak →</button>
                </div>
                </div>
            ) : lifecycleTerminal ? (
                <div data-lifecycle-terminal-history="true" style={{ padding: ".62rem 1rem .76rem", borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(13,13,16,.46)", flexShrink: 0 }}>
                    <LifecycleOutcomePanel cases={lifecycleState.cases} institution={lifecycleState.institution} concluded onViewInstitution={onInstitutionNavigate ? () => onInstitutionNavigate("members") : null} />
                </div>
            ) : phase === "player" && !isLoading ? (
                <div data-diplomacy-composer="modern" style={{ padding: isInstitutionCouncil ? ".65rem 1rem .8rem" : ".72rem 1rem .82rem", borderTop: "1px solid rgba(255,255,255,0.08)", background: isInstitutionCouncil ? "transparent" : "rgba(13,13,16,.56)", flexShrink: 0 }}>
                {isInstitutionCouncil && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".6rem", marginBottom: ".38rem" }}>
                    <span style={{ fontSize: ".52rem", fontWeight: 850, letterSpacing: ".07em", color: "rgba(255,255,255,.4)", textTransform: "uppercase" }}>Council message</span>
                    <button type="button" onClick={() => onInstitutionNavigate?.("agenda")} style={{ border: 0, background: "transparent", color: "#c4b5fd", cursor: "pointer", fontSize: ".58rem", fontWeight: 800 }}>Formal business →</button>
                </div>}
                {isLifecycleConversation && !lifecycleRevealInProgress && lifecycleHasRecordedResponse && <LifecycleOutcomePanel cases={lifecycleState.cases} institution={lifecycleState.institution} concluded={lifecycleTerminal || lifecycleNegotiationConcluded} onViewInstitution={onInstitutionNavigate ? () => onInstitutionNavigate("members") : null} />}
                {isLifecycleConversation && !lifecycleTerminal && <div data-institution-lifecycle-negotiation="true" style={{ marginBottom: ".45rem", padding: ".48rem .58rem", border: "1px solid rgba(167,139,250,.16)", borderRadius: 9, background: "rgba(139,92,246,.055)", display: "flex", alignItems: "center", gap: ".55rem", flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 18rem", minWidth: 0 }}><div style={{ fontSize: ".55rem", fontWeight: 820, color: "#ddd6fe" }}>{isInstitutional ? "Institution accession hearing" : "Institution membership negotiation"}</div><div style={{ marginTop: ".13rem", fontSize: ".51rem", lineHeight: 1.35, color: "rgba(255,255,255,.38)" }}>{playerLifecycleCase ? "This invitation requires your government's explicit decision. The AI cannot accept, reject or alter membership for you." : isInstitutional ? "The application is now before the institution's canonical voters. Their positions should follow current PWv2, relations, charter obligations and political fit; native governance records every formal ballot." : "The invited government decides from current PWv2, relations, strategic fit and the institution's charter. A diplomatic invitation is not membership."}</div></div>
                    {playerLifecycleCase ? <div data-player-lifecycle-chat-controls="true" style={{ display: "flex", gap: ".28rem", flexWrap: "wrap" }}>
                        <button type="button" disabled={isLoading} onClick={() => handlePlayerLifecycleDecision("accept")} style={{ border: "1px solid rgba(34,197,94,.25)", borderRadius: 8, background: "rgba(34,197,94,.09)", color: "#bbf7d0", padding: ".3rem .46rem", fontSize: ".54rem", fontWeight: 760, cursor: isLoading ? "wait" : "pointer" }}>Accept</button>
                        <button type="button" disabled={isLoading} onClick={() => handlePlayerLifecycleDecision("seek-observer")} style={{ border: "1px solid rgba(167,139,250,.25)", borderRadius: 8, background: "rgba(139,92,246,.1)", color: "#ddd6fe", padding: ".3rem .46rem", fontSize: ".54rem", cursor: isLoading ? "wait" : "pointer" }}>Observer instead</button>
                        <button type="button" disabled={isLoading} onClick={() => handlePlayerLifecycleDecision("delay")} style={{ border: "1px solid rgba(245,158,11,.2)", borderRadius: 8, background: "rgba(245,158,11,.07)", color: "#fde68a", padding: ".3rem .46rem", fontSize: ".54rem", cursor: isLoading ? "wait" : "pointer" }}>Later</button>
                        <button type="button" disabled={isLoading} onClick={() => handlePlayerLifecycleDecision("reject")} style={{ border: "1px solid rgba(239,68,68,.2)", borderRadius: 8, background: "rgba(239,68,68,.07)", color: "#fca5a5", padding: ".3rem .46rem", fontSize: ".54rem", cursor: isLoading ? "wait" : "pointer" }}>Reject</button>
                    </div> : isInstitutional && !lifecycleTerminal ? <button type="button" disabled={isLoading} onClick={handleLifecycleContinue} style={{ border: "1px solid rgba(167,139,250,.25)", borderRadius: 8, background: "rgba(139,92,246,.12)", color: "#ede9fe", padding: ".3rem .48rem", fontSize: ".55rem", fontWeight: 760, cursor: isLoading ? "wait" : "pointer", whiteSpace: "nowrap" }}>Continue hearing →</button> : lifecycleCanRequestResponse ? <button type="button" disabled={isLoading} onClick={handleLifecycleContinue} style={{ border: "1px solid rgba(167,139,250,.25)", borderRadius: 8, background: "rgba(139,92,246,.12)", color: "#ede9fe", padding: ".3rem .48rem", fontSize: ".55rem", fontWeight: 760, cursor: isLoading ? "wait" : "pointer", whiteSpace: "nowrap" }}>Request response →</button> : null}
                </div>}
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    {canDemand && (
                        <button
                        type="button"
                        onClick={() => setMakeDemand((on) => !on)}
                        aria-pressed={makeDemand}
                        title={makeDemand ? "This message is a demand. Click to send it as an ordinary message." : `Make this message a demand of ${countries[0]?.name}`}
                        style={{ background: makeDemand ? "rgba(234,179,8,0.22)" : "rgba(255,255,255,0.05)", border: `1px solid ${makeDemand ? "rgba(234,179,8,0.7)" : "rgba(255,255,255,0.15)"}`, borderRadius: "10px", color: makeDemand ? "rgb(250,204,21)" : "rgba(255,255,255,0.7)", cursor: "pointer", flexShrink: 0, fontFamily: "sans-serif", fontSize: "0.72rem", fontWeight: 700, height: "2.5rem", padding: "0 0.6rem" }}
                        >{makeDemand ? "⚑ Demand" : "⚑"}</button>
                    )}
                    <textarea
                    ref={composerRef}
                    placeholder={canDemand && makeDemand ? `Your demand of ${countries[0]?.name}…` : isInstitutionCouncil ? "Address the council…" : isLifecycleConversation ? "Address the accession table…" : "Send a diplomatic message…"}
                    rows={1} value={playerInput}
                    onChange={e => setPlayerInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handlePlayerSubmit(); } }}
                    onInput={fitComposer}
                    style={{ flex: 1, backgroundColor: isInstitutionCouncil ? "rgba(0,0,0,0.2)" : "rgba(9,9,12,.58)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "12px", color: "white", fontSize: "0.875rem", padding: ".62rem .78rem", resize: "none", outline: "none", fontFamily: "sans-serif", lineHeight: "1.5", maxHeight: "12rem", overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.22) transparent", boxShadow: "inset 0 1px 0 rgba(255,255,255,.025)", transition: "border-color 0.2s, background-color .2s" }}
                    onFocus={e => e.target.style.borderColor = isInstitutionCouncil ? "rgba(139,92,246,.65)" : "rgba(59,130,246,0.6)"}
                    onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.15)"}
                    />
                    <button onClick={handlePlayerSubmit} disabled={!playerInput.trim()}
                    style={{ backgroundColor: playerInput.trim() ? (isInstitutionCouncil ? "rgba(91,33,182,.85)" : "#3b82f6") : (isInstitutionCouncil ? "rgba(91,33,182,.28)" : "rgba(59,130,246,0.3)"), border: isInstitutionCouncil ? "1px solid rgba(167,139,250,.26)" : "none", borderRadius: "10px", minWidth: isInstitutionCouncil ? "4.3rem" : "2.5rem", height: "2.5rem", padding: isInstitutionCouncil ? "0 .7rem" : 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: playerInput.trim() ? "pointer" : "not-allowed", flexShrink: 0, fontSize: isInstitutionCouncil ? ".66rem" : "1rem", fontWeight: 800, color: "white", transition: "background-color 0.2s" }}
                    >{isInstitutionCouncil ? "Send ↗" : <SendIcon />}</button>
                </div>
                <div style={{ marginTop: ".28rem", fontSize: isInstitutionCouncil ? ".5rem" : ".54rem", color: "rgba(255,255,255,.26)" }}>Enter to send · Shift+Enter for a new line</div>
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
    return normalizeGameDate(raw) || raw;
};

const formatChatDateLabel = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    const parts = parseGameDate(raw);
    // Years before 1000 (BC included) go through the game-date formatter: the
    // locale formatter has no era unless asked and Date reads 0-99 as 1900+.
    if (parts && parts.year < 1000) return formatGameDateReadable(raw, "MMMM D, YYYY");
    // Bare YYYY-MM-DD parses as UTC in browsers, which can shift a displayed day in
    // some time zones. Noon-local keeps an in-game calendar date exactly on that day.
    const parsed = parts
        ? new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0)
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
    <div style={{ alignItems: "center", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "10px", display: "flex", gap: "0.55rem", padding: "0.6rem 0.8rem" }}>
    <span style={{ flexShrink: 0, fontSize: "1rem" }}>🖊</span>
    <span style={{ color: "#f4f4f5", fontSize: "0.78rem", fontWeight: 600 }}>
    Diplomacy in progress<PulsingDots /><span style={{ color: "rgba(255,255,255,0.4)", fontWeight: 400 }}> — a country may be reaching out</span>
    </span>
    </div>
);

// ── Chat list item ────────────────────────────────────────────────────────────

// Which threads are the ones that matter politically: your Overlord, and the
// countries you hold. Deliberately a MARKER on an existing row rather than a
// tab or a panel of its own - being somebody's Puppet is played out through the
// diplomacy the player already uses, and a new screen for it would be one more
// thing to learn for a relationship they can already see.
//
// The answer comes from runtime/puppets.js, like the country panel's and the
// map overlay's, so the three cannot disagree about the player's own empire.
const usePuppetMarkers = () => {
    const [markers, setMarkers] = React.useState({});
    React.useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                // The cached view, not a forced re-read: this decorates a list
                // row, and forcing world.json off the server every 15 s for the
                // life of the panel is a lot of traffic for a label.
                const [world, game] = await Promise.all([
                    readWorldStateView().catch(() => ({})),
                    readGameData().catch(() => ({})),
                ]);
                if (cancelled) return;
                // Per counterpart: the label, and what THEY are to the player —
                // the demand card and the composer's "make this a demand" need
                // the relationship itself, not a label to parse.
                const next = {};
                for (const row of livePuppetsFor(world, game?.country || "")) {
                    describeRole(row, {
                        puppet: () => { next[row.overlord] = { label: "YOUR OVERLORD", theyAre: "overlord" }; },
                        overlord: () => { next[row.puppet] = { label: `YOUR ${puppetKindLabel(row.kind).toUpperCase()}`, theyAre: "puppet" }; },
                        foreign: () => {},
                    });
                }
                setMarkers(next);
            } catch { /* a marker is decoration; never break the list for it */ }
        };
        load();
        const timer = setInterval(load, 15000);
        return () => { cancelled = true; clearInterval(timer); };
    }, []);
    return markers;
};

const ChatListItem = ({ chat, playerCountry, onClick, onDelete, onToggleRead, unread = false, puppetMarkers = {} }) => {
    const [hovered, setHovered] = React.useState(false);
    const [confirming, setConfirming] = React.useState(false);
    const counterparts = diplomaticCounterparts(chat?.countries, playerCountry);
    const previewCountries = counterparts.slice(0, 4);
    const flagUrlMap = useCountryFlagUrls(previewCountries);
    const names = chat?.title || summarizeDiplomaticParticipants(counterparts);
    const lastMsg = chat.messages?.at(-1);
    const rawPreview = String(lastMsg?.text || "No messages yet").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
    const preview = rawPreview.slice(0, 96) + (rawPreview.length > 96 ? "…" : "");
    const speaker = lastMsg?.role === "leader" || (lastMsg?.speaker && lastMsg?.role !== "user") ? String(lastMsg?.speaker || "") : "";
    const channelMeta = counterparts.length > 1 ? `${counterparts.length + (playerCountry ? 1 : 0)}-party channel` : "Direct channel";
    const chatMarker = counterparts.map((country) => puppetMarkers[country.name]?.label).find(Boolean) || "";

    return (
        <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => { setHovered(false); setConfirming(false); }} style={{ position: "relative" }}>
        <button data-diplomacy-thread-row="modern" onClick={onClick} style={{
            width: "100%", padding: ".76rem 3rem .76rem .9rem", borderRadius: 12,
            border: `1px solid ${hovered ? "rgba(255,255,255,.13)" : unread ? "rgba(96,165,250,.15)" : "rgba(255,255,255,.07)"}`,
            background: hovered ? "rgba(255,255,255,.065)" : unread ? "rgba(59,130,246,.035)" : "rgba(255,255,255,.025)",
            display: "flex", alignItems: "center", gap: ".78rem", cursor: "pointer",
            transition: "background .15s, border-color .15s, transform .15s", transform: hovered ? "translateY(-1px)" : "translateY(0)",
            fontFamily: "sans-serif", textAlign: "left", boxShadow: hovered ? "0 6px 18px rgba(0,0,0,.12)" : "none",
        }}>
            <div style={{ width: ".52rem", flexShrink: 0, display: "flex", justifyContent: "center" }} aria-hidden="true">
                {unread && <div style={{ width: ".46rem", height: ".46rem", borderRadius: "50%", background: "#60a5fa", boxShadow: "0 0 0 3px rgba(96,165,250,.08)" }} />}
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, minWidth: previewCountries.length > 1 ? "2.65rem" : "1.45rem", paddingRight: previewCountries.length > 1 ? ".25rem" : 0 }}>
                {previewCountries.map((country, index) => (
                    <span key={`${country.name}-${country.code || index}`} style={{ display: "inline-flex", marginLeft: index ? "-.38rem" : 0, zIndex: previewCountries.length - index, filter: "drop-shadow(0 1px 2px rgba(0,0,0,.4))" }}>
                        <FlagImg url={flagUrlMap[country.name] ?? null} alt={country.name} width="1.42rem" height=".96rem" />
                    </span>
                ))}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: ".48rem", minWidth: 0 }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: ".84rem", fontWeight: unread ? 740 : 650, color: unread ? "#fff" : "rgba(255,255,255,.9)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{names}</div>
                    <span style={{ flexShrink: 0, fontSize: ".59rem", color: chatMarker ? "rgba(234,179,8,.9)" : "rgba(255,255,255,.25)", textTransform: "uppercase", letterSpacing: ".045em" }}>{chatMarker || channelMeta}</span>
                </div>
                <div style={{ marginTop: ".17rem", fontSize: ".74rem", color: unread ? "rgba(255,255,255,.59)" : "rgba(255,255,255,.38)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {speaker && counterparts.length > 1 && <span style={{ color: "rgba(255,255,255,.5)", fontWeight: 600 }}>{speaker}: </span>}{preview}
                </div>
            </div>
        </button>
        <div style={{ position: "absolute", top: "50%", right: ".72rem", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: ".28rem" }}>
            {!hovered && <span aria-hidden="true" style={{ color: "rgba(255,255,255,.2)", fontSize: "1rem", lineHeight: 1 }}>›</span>}
            {hovered && (
                <>
                <button onClick={e => { e.stopPropagation(); onToggleRead?.(); }} title={unread ? "Mark as read" : "Mark as unread"} aria-label={unread ? "Mark as read" : "Mark as unread"}
                style={{ display: "flex", alignItems: "center", background: "rgba(24,24,27,.86)", border: "1px solid rgba(255,255,255,.08)", cursor: "pointer", color: "rgba(96,165,250,.78)", padding: ".3rem", borderRadius: 7, lineHeight: 1 }}>
                    <EnvelopeIcon filled={unread} />
                </button>
                <button onClick={e => { e.stopPropagation(); if (confirming) onDelete(); else setConfirming(true); }} title={confirming ? "Click again to delete this chat" : "Delete chat"} aria-label={confirming ? "Confirm deleting this chat" : "Delete chat"}
                style={{ display: "flex", alignItems: "center", gap: ".28rem", background: confirming ? "rgba(239,68,68,.18)" : "rgba(24,24,27,.86)", border: `1px solid ${confirming ? "rgba(239,68,68,.55)" : "rgba(255,255,255,.08)"}`, cursor: "pointer", color: confirming ? "#fca5a5" : "rgba(239,68,68,.68)", fontSize: ".68rem", fontWeight: 650, padding: confirming ? ".3rem .48rem" : ".3rem", borderRadius: 7, lineHeight: 1 }}>
                    {confirming ? "Delete?" : <TrashIcon />}
                </button>
                </>
            )}
        </div>
        </div>
    );
};


// ── Main ChatPanel ────────────────────────────────────────────────────────────

// Bridge so the map region popup can request a diplomatic chat with a country —
// and so the advisor can hand one a letter it drafted, which lands in the
// composer for the player to read over and send themselves. Nothing here sends
// anything: `draft` is text in a textarea until the player presses the button.
const _chatOpenSubs = new Set();
export const requestDiplomaticChat = (target, { draft = "" } = {}) => {
    if (!target) return;
    const normalized = typeof target === "string"
        ? { targetType: "private", country: target, name: target }
        : {
            ...target,
            targetType: String(target.targetType || "private").trim().toLowerCase(),
            country: String(target.country || target.name || "").trim(),
            name: String(target.name || target.country || "").trim(),
            institutionId: String(target.institutionId || "").trim(),
            caseId: String(target.caseId || "").trim(),
            threadId: String(target.threadId || "").trim(),
        };
    if (normalized.targetType === "private" && !normalized.name) return;
    if (normalized.targetType === "institution-council" && !normalized.institutionId && !normalized.threadId) return;
    if (normalized.targetType === "institution-lifecycle" && !normalized.threadId && (!normalized.institutionId || !normalized.caseId)) return;
    _chatOpenSubs.forEach((fn) => { try { fn(normalized, draft); } catch { /* noop */ } });
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
    border: "1px solid " + (accent ? "rgba(255,255,255,0.23)" : "rgba(255,255,255,0.12)"),
    background: accent ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.06)", color: accent ? "#f4f4f5" : "rgba(255,255,255,0.8)",
});

const ClarityMeter = ({ clarity }) => {
    const pct = Math.round(clarity * 100);
    return (
        <div title="How much of the intercept your service could decode">
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "rgba(255,255,255,0.5)", marginBottom: "0.2rem" }}>
        <span>Signal clarity</span><span data-no-translate style={{ color: "#e4e4e7", fontWeight: 700 }}>{pct}%</span>
        </div>
        <div style={{ height: "0.3rem", borderRadius: "999px", background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: "rgba(231,231,234,0.7)" }} />
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
                    background: mine ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.08)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
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

const intelCard = ({ tone = "neutral" } = {}) => {
    const tones = {
        purple: { bg: "rgba(139,92,246,.12)", border: "rgba(167,139,250,.28)", value: "#ddd6fe" },
        green: { bg: "rgba(34,197,94,.09)", border: "rgba(34,197,94,.25)", value: "#86efac" },
        amber: { bg: "rgba(245,158,11,.09)", border: "rgba(245,158,11,.25)", value: "#fde68a" },
        neutral: { bg: "rgba(255,255,255,.035)", border: "rgba(255,255,255,.09)", value: "rgba(255,255,255,.86)" },
    };
    return tones[tone] || tones.neutral;
};

const IntelligenceStatCard = ({ label, value, hint = "", tone = "neutral" }) => {
    const colors = intelCard({ tone });
    return (
        <div style={{ minWidth: 0, padding: ".7rem .8rem", borderRadius: 10, background: colors.bg, border: `1px solid ${colors.border}` }}>
            <div style={{ fontSize: ".58rem", letterSpacing: ".08em", textTransform: "uppercase", color: "rgba(255,255,255,.38)", fontWeight: 750 }}>{label}</div>
            <div style={{ marginTop: ".22rem", fontSize: ".9rem", fontWeight: 800, color: colors.value }}>{value}</div>
            {hint && <div style={{ marginTop: ".2rem", fontSize: ".6rem", color: "rgba(255,255,255,.34)", lineHeight: 1.35 }}>{hint}</div>}
        </div>
    );
};

const intelligenceCapabilityLabel = (value) => {
    const score = Math.max(0, Math.min(100, Number(value) || 0));
    if (score >= 85) return "Advanced";
    if (score >= 70) return "Capable";
    if (score >= 50) return "Limited";
    if (score >= 30) return "Developing";
    return "Minimal";
};

const sourceQualityLabel = (confidence, clarity, hasNetwork) => {
    const label = String(confidence || "").trim();
    if (label) return label;
    if (!hasNetwork) return "None";
    if (clarity >= .72) return "High";
    if (clarity >= .46) return "Moderate";
    return "Low";
};

const networkQualityLabel = (clarity, hasNetwork) => {
    if (!hasNetwork) return "None";
    if (clarity >= .72) return "Strong";
    if (clarity >= .46) return "Moderate";
    return "Limited";
};

const politicalKnowledgeLabel = (knowledge) => {
    if (knowledge?.level === "classified") return "Strong";
    if (knowledge?.level === "assessed") return "Limited";
    return "Public";
};

const diplomaticKnowledgeLabel = (entry, clarity, hasNetwork) => {
    if (!hasNetwork) return "Public";
    const count = Array.isArray(entry?.exchanges) ? entry.exchanges.length : 0;
    if (count >= 3 && clarity >= .6) return "Strong";
    if (count >= 1) return "Limited";
    return "Limited";
};

const officeholderLabel = (holder) => {
    if (!holder) return "";
    if (typeof holder === "string") return holder;
    return String(holder?.name || holder?.id || "").trim();
};

const PublicPoliticalPicture = ({ profile }) => {
    if (!profile) return <div style={{ color: "rgba(255,255,255,.35)", fontSize: ".7rem" }}>No structured political profile is currently available.</div>;
    const government = profile.government || {};
    const leader = officeholderLabel(profile.leader || government.headOfState || government.headOfGovernment);
    const descriptors = [profile.politicalSystem?.label || profile.politicalSystem?.type, government.form, government.ideology, ...(profile.tags || [])].filter(Boolean);
    const goals = Array.isArray(profile.goals) ? profile.goals.slice(0, 4) : [];
    return (
        <div style={{ fontSize: ".68rem", lineHeight: 1.5, color: "rgba(255,255,255,.67)" }}>
            {descriptors.length > 0 && <div>{descriptors.join(", ")}</div>}
            {leader && <div style={{ marginTop: ".2rem", color: "rgba(255,255,255,.52)" }}>Leadership: {leader}</div>}
            {government.headOfGovernment && officeholderLabel(government.headOfGovernment) !== leader && (
                <div style={{ color: "rgba(255,255,255,.45)" }}>Head of government: {officeholderLabel(government.headOfGovernment)}</div>
            )}
            {goals.length > 0 && <div style={{ marginTop: ".35rem" }}>{goals.map((goal) => <div key={goal}>- {goal}</div>)}</div>}
        </div>
    );
};

const IntelligenceCountryHeader = ({ country, subtitle = "" }) => {
    const flagUrl = useCountryFlagUrl({ code: country?.code, name: country?.name });
    return (
        <div style={{ display: "flex", alignItems: "center", gap: ".65rem", minWidth: 0 }}>
            <div style={{ width: "2.6rem", height: "1.75rem", borderRadius: 5, overflow: "hidden", background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {flagUrl ? <FlagImg url={flagUrl} alt="" width="100%" height="100%" /> : <span style={{ fontSize: "1rem" }}>🏳</span>}
            </div>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: ".95rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{country?.name || "Unknown polity"}</div>
                {subtitle && <div style={{ marginTop: ".1rem", fontSize: ".61rem", color: "rgba(255,255,255,.38)" }}>{subtitle}</div>}
            </div>
        </div>
    );
};

const IntelligenceAssessmentPanel = ({ assessment }) => {
    if (!assessment) {
        return (
            <div style={{ color: "rgba(255,255,255,.34)", fontSize: ".68rem", lineHeight: 1.5 }}>
                No private political assessment is available. Only public information is shown.
            </div>
        );
    }
    return (
        <div style={{ fontSize: ".68rem", lineHeight: 1.5, color: "rgba(255,255,255,.66)" }}>
            {assessment.summary && <div>{assessment.summary}</div>}
            {(assessment.confidence || assessment.source || assessment.gatheredAt) && (
                <div style={{ marginTop: ".35rem", color: "rgba(255,255,255,.42)", fontSize: ".61rem" }}>
                    {[assessment.confidence && `${assessment.confidence} confidence`, assessment.source, assessment.gatheredAt].filter(Boolean).join(" · ")}
                </div>
            )}
            {Array.isArray(assessment.findings) && assessment.findings.length > 0 && (
                <div style={{ marginTop: ".4rem", display: "flex", flexDirection: "column", gap: ".22rem" }}>
                    {assessment.findings.slice(0, 6).map((finding, index) => (
                        <div key={`${finding.topic || "finding"}-${index}`}>- {finding.topic ? <><strong style={{ color: "rgba(255,255,255,.78)" }}>{finding.topic}: </strong>{finding.text}</> : finding.text}</div>
                    ))}
                </div>
            )}
        </div>
    );
};


const WorkspaceTabIcon = ({ type, size = 14 }) => {
    const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
    if (type === "institutions") return <svg {...common}><path d="M3 21h18" /><path d="M5 21V10h14v11" /><path d="M4 10 12 4l8 6" /><path d="M8 13v5M12 13v5M16 13v5" /></svg>;
    if (type === "intelligence") return <svg {...common}><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
    return <svg {...common}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /><path d="M8 9h8M8 13h5" /></svg>;
};

const SpyView = ({ playerCountry, gameDate, countries, loadingCountries }) => {
    const world                       = useRuntimeState("world");
    const filedIntercepts             = useRuntimeState("intercepts", normalizeIntercepts);
    const unseen                      = useUnseenEventIds();
    const intercepts                  = useMemo(() => withoutUnseenIntercepts(filedIntercepts, unseen), [filedIntercepts, unseen]);
    const [openedAssessments, setOpenedAssessments] = useState({});
    const [open, setOpen]             = useState(null); // { target, exchange }
    const [choosing, setChoosing]     = useState(false);
    const [error, setError]           = useState("");
    const [section, setSection]       = useState("overview");
    const [countryQuery, setCountryQuery] = useState("");
    const [selectedCountry, setSelectedCountry] = useState("");
    const [expandedReport, setExpandedReport] = useState("");

    useEffect(() => { void refreshRuntimeState(["world", "intercepts"]); }, []);
    useEffect(() => { void ensureCountryAssessed(playerCountry, { reason: "intelligence workspace" }); }, [playerCountry]);

    useEffect(() => {
        let live = true;
        const openAssessments = async () => {
            const next = {};
            for (const [target, entry] of Object.entries(intercepts || {})) {
                let politicalAssessment = entry?.politicalAssessment || null;
                if (politicalAssessment && isSeal(world?.spySeal)) {
                    politicalAssessment = await openPoliticalAssessment(world.spySeal, entry.reportId, politicalAssessment);
                }
                next[target] = { ...entry, ...(politicalAssessment ? { politicalAssessment } : {}) };
            }
            if (live) setOpenedAssessments(next);
        };
        void openAssessments();
        return () => { live = false; };
    }, [intercepts, world?.spySeal]);

    const myIntel = intelligenceOf(world, playerCountry);
    const spies = activeSpies(world).filter((spy) => !spy.owner || spy.owner === playerCountry);
    const foreign = foreignSpies(world, playerCountry);
    const visibleForeign = foreign.filter((spy) => spy.status !== "active");
    const history = normalizeSpies(world?.spies).filter((spy) => (!spy.owner || spy.owner === playerCountry) && spy.status === "exposed").slice(-3);
    const readableReports = useMemo(() => documentsReadableBy(world?.reports, playerCountry).slice(0, 36), [world?.reports, playerCountry]);
    const [storyDraft, setStoryDraft] = useState({});
    const [savedFlash, setSavedFlash] = useState("");

    const sameCountry = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
    const countryByName = (name) => countries.find((country) => sameCountry(country.name, name)) || { name };
    const countryRows = useMemo(() => countries
        .filter((country) => !sameCountry(country.name, playerCountry))
        .sort((a, b) => String(a.name).localeCompare(String(b.name))), [countries, playerCountry]);

    useEffect(() => {
        if (selectedCountry && countryRows.some((country) => sameCountry(country.name, selectedCountry))) return;
        const preferred = spies[0]?.target || Object.keys(intercepts || {})[0] || countryRows[0]?.name || "";
        setSelectedCountry(preferred);
    }, [selectedCountry, countryRows, spies, intercepts]);

    const commitSpies = async (next) => {
        const fresh = await readWorldState({ force: true });
        const committed = { ...fresh, spies: next, spySeal: isSeal(fresh?.spySeal) ? fresh.spySeal : newSeal() };
        const ops = spyOperationOps(next, committed.projects, { date: gameDate, playerPolity: playerCountry });
        const toWrite = ops.length
            ? applyProjectOpsToWorld({ date: gameDate, ops, playerCountry, world: committed }).world
            : committed;
        await writeWorldState(toWrite);
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
        try {
            await commitSpies(setCoverStory(world, spy.id, storyDraft[spy.id] ?? spy.coverStory));
            setSavedFlash(spy.id);
            setTimeout(() => setSavedFlash((current) => (current === spy.id ? "" : current)), 1800);
        } catch (err) { setError(err?.message || String(err)); }
    };
    const handleDeploy = async (selected) => {
        setChoosing(false); setError("");
        const target = selected?.[0]?.name;
        try {
            const next = deploySpy(world, target, { date: gameDate, playerPolity: playerCountry });
            await commitSpies(next);
            setSelectedCountry(target || "");
            setSection("countries");
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

    const candidates = countryRows.filter((country) => !spies.some((spy) => sameCountry(spy.target, country.name)));
    const storyOf = (spy) => (storyDraft[spy.id] !== undefined ? storyDraft[spy.id] : spy.coverStory);
    const inputStyle = { width: "100%", boxSizing: "border-box", padding: "0.45rem 0.6rem", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)", color: "white", fontSize: "0.76rem", fontFamily: "sans-serif" };
    const full = spies.length >= MAX_ACTIVE_SPIES;
    const assessedEntries = Object.entries(openedAssessments).filter(([, entry]) => entry?.politicalAssessment);
    const interceptedDocuments = readableReports.filter((report) => report.interceptedBy?.some((name) => sameCountry(name, playerCountry)));
    const currentReportCount = assessedEntries.length + interceptedDocuments.length;
    const warnings = [
        ...visibleForeign.map((spy) => `${spy.owner} has a ${spy.status === "turned" ? "turned" : "detected"} agent inside ${playerCountry}.`),
        ...spies.filter((spy) => spy.suspected).map((spy) => `Source integrity concerns affect the network in ${spy.target}.`),
    ];

    const recentItems = [];
    for (const [target, entry] of assessedEntries) {
        recentItems.push({ kind: "assessment", target, title: `Political assessment: ${target}`, meta: entry.politicalAssessment?.gatheredAt || entry.gatheredAt || "", text: entry.politicalAssessment?.summary || "Political assessment updated." });
    }
    for (const [target, entry] of Object.entries(intercepts || {})) {
        for (const exchange of (entry?.exchanges || []).slice(-1)) {
            recentItems.push({ kind: "intercept", target, exchange, title: `${target} ↔ ${exchange.counterpart}`, meta: exchange.date || "", text: exchange.subject || "Intercepted diplomatic traffic" });
        }
    }
    readableReports.slice(0, 4).forEach((report) => recentItems.push({ kind: "document", report, title: report.title, meta: report.dateline || report.createdDate || "", text: report.from ? `Document from ${report.from}` : "Document on file" }));
    recentItems.sort((a, b) => String(b.meta || "").localeCompare(String(a.meta || "")));

    const filteredCountries = countryRows.filter((country) => String(country.name || "").toLowerCase().includes(countryQuery.trim().toLowerCase()));
    const selectedCountryRecord = countryByName(selectedCountry || filteredCountries[0]?.name || "");
    const selectedSpy = spies.find((spy) => sameCountry(spy.target, selectedCountryRecord?.name));
    const selectedRawEntry = intercepts[selectedCountryRecord?.name] || Object.entries(intercepts).find(([target]) => sameCountry(target, selectedCountryRecord?.name))?.[1] || null;
    const selectedClarity = selectedSpy ? signalClarity(myIntel, intelligenceOf(world, selectedSpy.target)) : 0;
    const selectedKnowledge = selectedCountryRecord?.name ? buildPlayerPoliticalKnowledgeView(world, selectedCountryRecord.name, { viewerPolity: playerCountry, intercepts: openedAssessments }) : null;
    const selectedAssessment = selectedKnowledge?.intelligence || null;
    const selectedInstitutionPortfolio = selectedCountryRecord?.name
        ? institutionPortfolioForPolity(world, selectedCountryRecord.name, { viewerPolity: playerCountry })
        : [];
    const selectedNetworkLabel = networkQualityLabel(selectedClarity, Boolean(selectedSpy));
    const selectedPoliticalLabel = politicalKnowledgeLabel(selectedKnowledge);
    const selectedDiplomaticLabel = diplomaticKnowledgeLabel(selectedRawEntry, selectedClarity, Boolean(selectedSpy));
    const selectedSourceLabel = sourceQualityLabel(selectedAssessment?.confidence, selectedClarity, Boolean(selectedSpy));

    const panel = { border: "1px solid rgba(255,255,255,.08)", borderRadius: 10, background: "rgba(255,255,255,.025)" };
    const subhead = { fontSize: ".58rem", letterSpacing: ".09em", textTransform: "uppercase", color: "rgba(255,255,255,.37)", fontWeight: 800 };
    const navItems = [["overview", "Overview"], ["countries", "Countries"], ["operations", "Operations"], ["reports", "Reports"]];

    const renderCounterintelCase = (spy) => (
        <div key={spy.id} style={{ ...panel, padding: ".65rem .7rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: ".55rem" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: ".77rem", fontWeight: 750 }}>{spy.status === "discovered" ? "🕵️ " : "🎭 "}{spy.owner}</div>
                    <div style={{ marginTop: ".12rem", fontSize: ".6rem", color: "rgba(255,255,255,.4)" }}>
                        {spy.status === "discovered" ? "agent in custody — decide what to do" : `double agent since ${spy.turnedAt || "capture"} — ${spy.owner} still trusts them`}
                    </div>
                </div>
                {spy.status === "discovered" && <button onClick={() => handleExpel(spy)} style={spyBtn(false)}>Expel</button>}
                {spy.status === "discovered" && <button onClick={() => handleTurn(spy)} style={spyBtn(true)}>{storyOf(spy) ? "Turn & plant story" : "Turn"}</button>}
            </div>
            {spy.status !== "exposed" && (
                <div style={{ marginTop: ".5rem", display: "flex", gap: ".4rem", alignItems: "center" }}>
                    <input value={storyOf(spy)} onChange={(e) => setStoryDraft((draft) => ({ ...draft, [spy.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter" && spy.status === "turned") { e.preventDefault(); handleStory(spy); } }} placeholder={spy.status === "discovered" ? "Cover story to feed them if turned (optional)" : `What your double agent tells ${spy.owner}`} style={inputStyle} />
                    {spy.status === "turned" && (() => {
                        const unchanged = storyOf(spy) === spy.coverStory;
                        const justSaved = savedFlash === spy.id;
                        return <button onClick={() => handleStory(spy)} disabled={unchanged && !justSaved} style={{ ...spyBtn(true), ...(unchanged && !justSaved ? { opacity: .45, cursor: "default" } : {}) }}>{justSaved ? "Saved ✓" : "Save"}</button>;
                    })()}
                </div>
            )}
        </div>
    );

    return (
        <>
        <Presence open={choosing}>
            <CountrySelectorModal countries={candidates} loading={loadingCountries} onStart={handleDeploy} onCancel={() => setChoosing(false)} single title="Deploy a Network" subtitle="Choose a country for a persistent HUMINT network" selectedLabel="Target" emptyLabel="No target chosen yet" confirmLabel={(n) => (n === 0 ? "Choose a target" : "Deploy the network")} />
        </Presence>
        <div data-intelligence-workspace="restored" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", gap: ".35rem", alignItems: "center", padding: ".65rem 1rem .55rem", borderBottom: "1px solid rgba(255,255,255,.06)", flexShrink: 0 }}>
                {navItems.map(([key, label]) => (
                    <button key={key} onClick={() => setSection(key)} style={{ padding: ".35rem .75rem", border: 0, borderBottom: section === key ? "2px solid #8b5cf6" : "2px solid transparent", background: "transparent", color: section === key ? "white" : "rgba(255,255,255,.46)", fontSize: ".72rem", fontWeight: 750, cursor: "pointer", fontFamily: "sans-serif" }}>{label}</button>
                ))}
            </div>

            {section === "overview" && (
                <div data-intelligence-section="overview" style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: ".8rem 1rem", display: "flex", flexDirection: "column", gap: ".75rem" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: ".55rem" }}>
                        <IntelligenceStatCard label="Service capability" value={intelligenceCapabilityLabel(myIntel)} hint="National intelligence capability" tone="purple" />
                        <IntelligenceStatCard label="Active networks" value={spies.length} hint={`${MAX_ACTIVE_SPIES - spies.length} field slots available`} tone="green" />
                        <IntelligenceStatCard label="Current reports" value={currentReportCount} hint="Latest political assessments retained" />
                        <IntelligenceStatCard label="Counterintel alerts" value={visibleForeign.length} hint="Detected or turned foreign agents" tone={visibleForeign.length ? "amber" : "neutral"} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".65rem" }}>
                        <div style={{ ...panel, padding: ".7rem .8rem" }}>
                            <div style={{ fontSize: ".75rem", fontWeight: 750 }}>Strategic warnings</div>
                            <div style={{ marginTop: ".55rem", display: "flex", flexDirection: "column", gap: ".3rem" }}>
                                {warnings.length ? warnings.slice(0, 6).map((warning) => <div key={warning} style={{ fontSize: ".65rem", lineHeight: 1.45, color: "rgba(255,255,255,.52)" }}>• {warning}</div>) : <div style={{ fontSize: ".65rem", color: "rgba(255,255,255,.34)" }}>No immediate intelligence warnings. This does not imply the absence of undiscovered activity.</div>}
                            </div>
                        </div>
                        <div style={{ ...panel, padding: ".7rem .8rem" }}>
                            <div style={{ fontSize: ".75rem", fontWeight: 750 }}>Recent intelligence</div>
                            <div style={{ marginTop: ".45rem", display: "flex", flexDirection: "column", gap: ".38rem" }}>
                                {recentItems.length ? recentItems.slice(0, 4).map((item, index) => (
                                    <button key={`${item.kind}-${item.title}-${index}`} onClick={() => { if (item.kind === "intercept") setOpen({ target: item.target, exchange: item.exchange }); else if (item.kind === "assessment") { setSelectedCountry(item.target); setSection("countries"); } else { setExpandedReport(item.report?.id || ""); setSection("reports"); } }} style={{ padding: ".42rem .5rem", borderRadius: 7, border: "1px solid rgba(255,255,255,.06)", background: "rgba(255,255,255,.02)", color: "white", cursor: "pointer", textAlign: "left", fontFamily: "sans-serif" }}>
                                        <div style={{ display: "flex", gap: ".45rem", alignItems: "baseline" }}><strong style={{ fontSize: ".65rem", flex: 1 }}>{item.title}</strong>{item.meta && <span style={{ fontSize: ".55rem", color: "rgba(255,255,255,.3)" }}>{item.meta}</span>}</div>
                                        <div style={{ marginTop: ".15rem", fontSize: ".59rem", color: "rgba(255,255,255,.4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.text}</div>
                                    </button>
                                )) : <div style={{ fontSize: ".65rem", color: "rgba(255,255,255,.34)" }}>No private reporting has been collected yet. Deploy a network to begin receiving intelligence.</div>}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {section === "countries" && (
                <div data-intelligence-section="countries" style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(16rem, .95fr) minmax(0, 1.9fr)", gap: ".65rem", padding: ".65rem" }}>
                    <div style={{ ...panel, minHeight: 0, padding: ".55rem", display: "flex", flexDirection: "column" }}>
                        <input value={countryQuery} onChange={(e) => setCountryQuery(e.target.value)} placeholder="Search countries" style={{ ...inputStyle, marginBottom: ".45rem" }} />
                        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", display: "flex", flexDirection: "column", gap: ".25rem" }}>
                            {filteredCountries.map((country) => {
                                const active = sameCountry(country.name, selectedCountryRecord?.name);
                                const network = spies.some((spy) => sameCountry(spy.target, country.name));
                                return (
                                    <button key={country.name} onClick={() => setSelectedCountry(country.name)} style={{ display: "flex", alignItems: "center", gap: ".45rem", padding: ".48rem .55rem", borderRadius: 7, border: `1px solid ${active ? "rgba(167,139,250,.32)" : "transparent"}`, background: active ? "rgba(139,92,246,.12)" : "transparent", color: "white", fontFamily: "sans-serif", textAlign: "left", cursor: "pointer" }}>
                                        <span style={{ flex: 1, minWidth: 0, fontSize: ".68rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{country.name}</span>
                                        {network && <span title="Active intelligence network" style={{ width: ".38rem", height: ".38rem", borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div style={{ ...panel, minHeight: 0, padding: ".8rem", overflowY: "auto", scrollbarWidth: "none" }}>
                        <IntelligenceCountryHeader country={selectedCountryRecord} subtitle={selectedSpy ? `Active network · since ${selectedSpy.deployedAt || "an earlier date"}` : "No active network · public sources only"} />
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: ".45rem", marginTop: ".75rem" }}>
                            <IntelligenceStatCard label="Network" value={selectedNetworkLabel} tone={selectedSpy ? "purple" : "neutral"} />
                            <IntelligenceStatCard label="Political" value={selectedPoliticalLabel} tone={selectedKnowledge?.level !== "public" ? "purple" : "neutral"} />
                            <IntelligenceStatCard label="Diplomatic" value={selectedDiplomaticLabel} tone={selectedSpy ? "purple" : "neutral"} />
                            <IntelligenceStatCard label="Source" value={selectedSourceLabel} tone={selectedSourceLabel === "Low" ? "amber" : selectedSourceLabel === "None" ? "neutral" : "green"} />
                        </div>
                        <div style={{ ...panel, padding: ".65rem .7rem", marginTop: ".65rem" }}>
                            <div style={subhead}>Public political picture</div>
                            <div style={{ marginTop: ".42rem" }}><PublicPoliticalPicture profile={selectedKnowledge?.public} /></div>
                        </div>
                        <div style={{ ...panel, padding: ".65rem .7rem", marginTop: ".55rem" }}>
                            <div style={subhead}>Institutional position</div>
                            <div style={{ marginTop: ".42rem", display: "flex", flexDirection: "column", gap: ".3rem" }}>
                                {selectedInstitutionPortfolio.length ? selectedInstitutionPortfolio.slice(0, 10).map(({ institution, member, history, cases }) => (
                                    <div key={institution.id} style={{ display: "flex", alignItems: "center", gap: ".45rem", padding: ".38rem .45rem", borderRadius: 7, background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.05)" }}>
                                        <span style={{ flex: 1, minWidth: 0, fontSize: ".62rem", color: "rgba(255,255,255,.68)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{institution.name}</span>
                                        <span style={{ fontSize: ".53rem", color: member ? "#c4b5fd" : "rgba(255,255,255,.35)", textTransform: "capitalize" }}>{member ? (member.role || member.status || "member") : "former / historical"}</span>
                                        {cases?.length ? <span style={{ fontSize: ".49rem", color: "#fde68a" }}>{cases.length} pending</span> : null}
                                        {!member && history?.length ? <span style={{ fontSize: ".49rem", color: "rgba(255,255,255,.28)" }}>{history.at(-1)?.action || "history"}</span> : null}
                                    </div>
                                )) : <div style={{ fontSize: ".62rem", color: "rgba(255,255,255,.34)" }}>No current or publicly known institutional record.</div>}
                            </div>
                        </div>
                        <div style={{ ...panel, padding: ".65rem .7rem", marginTop: ".55rem" }}>
                            <div style={subhead}>Intelligence assessment</div>
                            <div style={{ marginTop: ".42rem" }}><IntelligenceAssessmentPanel assessment={selectedAssessment} /></div>
                        </div>
                    </div>
                </div>
            )}

            {section === "operations" && (
                <div data-intelligence-section="operations" style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: ".75rem .8rem", display: "flex", flexDirection: "column", gap: ".65rem" }}>
                    <div style={{ ...panel, padding: ".55rem .7rem", background: "rgba(139,92,246,.09)", borderColor: "rgba(167,139,250,.22)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div><div style={{ fontSize: ".72rem", fontWeight: 750 }}>Field networks</div><div style={{ fontSize: ".58rem", color: "rgba(255,255,255,.35)" }}>Persistent HUMINT networks also appear as covert Projects.</div></div>
                        <div style={{ fontSize: ".7rem", fontWeight: 800 }}>{spies.length}/{MAX_ACTIVE_SPIES}</div>
                    </div>
                    {spies.length === 0 ? <div style={{ fontSize: ".68rem", color: "rgba(255,255,255,.34)", padding: ".25rem" }}>No networks are currently in the field.</div> : spies.map((spy) => (
                        <div key={spy.id} style={{ ...panel, padding: ".55rem .7rem", display: "flex", alignItems: "center", gap: ".5rem" }}>
                            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: ".76rem", fontWeight: 750 }}>{spy.target}</div><div style={{ marginTop: ".12rem", fontSize: ".59rem", color: "rgba(255,255,255,.4)" }}>since {spy.deployedAt || "an earlier date"} · network {networkQualityLabel(signalClarity(myIntel, intelligenceOf(world, spy.target)), true).toLowerCase()}{spy.suspected ? " · source integrity concern" : ""}</div></div>
                            <button onClick={() => { setSelectedCountry(spy.target); setSection("countries"); }} style={spyBtn(false)}>Dossier</button>
                            <button onClick={() => handleRecall(spy)} style={spyBtn(false)}>Recall</button>
                        </div>
                    ))}
                    {history.length > 0 && <div style={{ fontSize: ".61rem", color: "rgba(255,255,255,.34)", fontStyle: "italic" }}>{history.map((spy) => `Agent expelled by ${spy.target}${spy.exposedAt ? ` on ${spy.exposedAt}` : ""}`).join(" · ")}</div>}
                    <div style={{ ...subhead, marginTop: ".15rem" }}>Counterintelligence cases</div>
                    {visibleForeign.length ? visibleForeign.map(renderCounterintelCase) : <div style={{ ...panel, padding: ".7rem", fontSize: ".66rem", color: "rgba(255,255,255,.34)" }}>No detected foreign agents currently require action.</div>}
                    {error && <div style={{ fontSize: ".66rem", color: "#fca5a5" }}>{error}</div>}
                    <button onClick={() => setChoosing(true)} disabled={full} style={{ width: "100%", marginTop: ".1rem", padding: ".65rem", borderRadius: 8, border: "1px solid rgba(167,139,250,.35)", background: "rgba(139,92,246,.16)", color: "#e9d5ff", fontSize: ".72rem", fontWeight: 750, cursor: full ? "not-allowed" : "pointer", fontFamily: "sans-serif", opacity: full ? .5 : 1 }}>♟ Deploy a network</button>
                </div>
            )}

            {section === "reports" && (
                <div data-intelligence-section="reports" style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: ".75rem .85rem", display: "flex", flexDirection: "column", gap: ".7rem" }}>
                    <div style={subhead}>Political assessments</div>
                    {assessedEntries.length ? assessedEntries.map(([target, entry]) => (
                        <button key={`assessment-${target}`} onClick={() => { setSelectedCountry(target); setSection("countries"); }} style={{ ...panel, padding: ".6rem .7rem", color: "white", textAlign: "left", cursor: "pointer", fontFamily: "sans-serif" }}>
                            <div style={{ display: "flex", gap: ".5rem", alignItems: "baseline" }}><strong style={{ flex: 1, fontSize: ".7rem" }}>{target}</strong><span style={{ fontSize: ".57rem", color: "rgba(255,255,255,.3)" }}>{entry.politicalAssessment?.gatheredAt || entry.gatheredAt || ""}</span></div>
                            <div style={{ marginTop: ".2rem", fontSize: ".62rem", color: "rgba(255,255,255,.47)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.politicalAssessment?.summary || "Political assessment on file"}</div>
                        </button>
                    )) : <div style={{ fontSize: ".65rem", color: "rgba(255,255,255,.34)" }}>No private political assessments are currently on file.</div>}

                    <div style={{ ...subhead, marginTop: ".2rem" }}>Intercepted traffic</div>
                    {Object.values(intercepts).some((entry) => (entry?.exchanges || []).some((exchange) => !isDocumentExchange(exchange))) ? Object.entries(intercepts).flatMap(([target, entry]) => (entry.exchanges || []).filter((exchange) => !isDocumentExchange(exchange)).map((exchange) => (
                        <button key={`${target}-${exchange.id}`} onClick={() => { setOpen({ target, exchange }); void ensureCountryAssessed(target, { reason: "intercept read" }); }} style={{ ...panel, padding: ".58rem .7rem", display: "flex", alignItems: "center", gap: ".55rem", color: "white", cursor: "pointer", textAlign: "left", fontFamily: "sans-serif" }}>
                            <span aria-hidden="true" style={{ fontSize: ".9rem" }}>{isDocumentExchange(exchange) ? "📄" : "📡"}</span>
                            <span style={{ flex: 1, minWidth: 0 }}><strong style={{ display: "block", fontSize: ".69rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{target} ↔ {exchange.counterpart}</strong><span style={{ display: "block", marginTop: ".1rem", fontSize: ".59rem", color: "rgba(255,255,255,.4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{exchange.subject}{exchange.date ? ` · ${exchange.date}` : ""}</span></span>
                        </button>
                    ))) : <div style={{ fontSize: ".65rem", color: "rgba(255,255,255,.34)" }}>No intercepted diplomatic traffic is on file.</div>}

                    <div style={{ ...subhead, marginTop: ".2rem" }}>Documents on file</div>
                    {readableReports.length ? readableReports.map((report) => {
                        const openReport = expandedReport === report.id;
                        return (
                            <button key={report.id} onClick={() => setExpandedReport(openReport ? "" : report.id)} style={{ ...panel, padding: ".6rem .7rem", color: "white", cursor: "pointer", textAlign: "left", fontFamily: "sans-serif" }}>
                                <div style={{ display: "flex", gap: ".5rem", alignItems: "baseline" }}><strong style={{ flex: 1, fontSize: ".69rem" }}>{report.title}</strong><span style={{ fontSize: ".57rem", color: "rgba(255,255,255,.3)" }}>{report.dateline || report.createdDate || ""}</span></div>
                                <div style={{ marginTop: ".15rem", fontSize: ".59rem", color: "rgba(255,255,255,.4)" }}>{report.from ? `From ${report.from} · ` : ""}{report.visibleTo === null ? "published" : report.interceptedBy?.some((name) => sameCountry(name, playerCountry)) && !report.visibleTo?.some((name) => sameCountry(name, playerCountry)) ? "intercepted copy" : "held by your government"}</div>
                                {openReport && <div style={{ marginTop: ".5rem", paddingTop: ".45rem", borderTop: "1px solid rgba(255,255,255,.06)", fontSize: ".64rem", lineHeight: 1.55, color: "rgba(255,255,255,.62)", whiteSpace: "pre-wrap" }}>{report.body}</div>}
                            </button>
                        );
                    }) : <div style={{ fontSize: ".65rem", color: "rgba(255,255,255,.34)" }}>No readable government documents are currently on file.</div>}
                </div>
            )}
        </div>
        </>
    );
};

const ChatPanel = ({ isOpen, onClose, requestedCountry, requestedDraft = "", onConsumeRequest, requestedChatId = "", onConsumeRequestedChat, isGenerating = false }) => {
    // "chats" is the diplomacy the player is party to; "spy" is everyone else's.
    const [view, setView] = useState("chats");
    const [institutionFocusRequest, setInstitutionFocusRequest] = useState(null);
    // The Spy tab exists only where espionage does (the scenario's Features tab,
    // or this game's own override); a view left on it shows the diplomacy list.
    const espionageOn = useActiveFeatures().espionage?.enabled !== false;
    const currentView = view === "spy" && !espionageOn ? "chats" : view;
    const puppetMarkers = usePuppetMarkers();
    const [countries, setCountries]               = useState([]);
    const [loadingCountries, setLoadingCountries] = useState(true);
    const [playerCountry, setPlayerCountry]       = useState("your nation");
    const [gameDate, setGameDate]                 = useState("");
    const [chats, setChats]                       = useState([]);
    const [activeChat, setActiveChat]             = useState(null);
    const [visibleCouncilChatId, setVisibleCouncilChatId] = useState("");
    const [showSelector, setShowSelector]         = useState(false);
    // A letter the advisor drafted, waiting for the conversation it belongs to to
    // mount. Tied to a chat id so navigating to a DIFFERENT chat never inherits it.
    const [composerDraft, setComposerDraft]       = useState(null);
    const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
    // The threads as the player has been shown them (runtime/unseenEvents.js): a
    // thread an unseen event opened, or a letter one delivered, arrives when the
    // reveal reaches that event — and only then counts as unread. Only for
    // showing: every write below writes `chats`, the stored threads.
    const unseen = useUnseenEventIds();
    const shownChats = useMemo(() => withoutUnseenChats(chats, unseen), [chats, unseen]);
    const shownVersion = (chat) => (chat ? withoutUnseenChats([chat], unseen)[0] ?? chat : chat);
    const allOpenChats = shownChats.filter((chat) => chat.status !== "closed" && Array.isArray(chat.countries) && chat.countries.length > 0);
    // Formal institution councils have their own first-class workspace. Keep
    // them out of the ordinary Diplomacy list instead of flattening NATO/EU/etc.
    // into ad-hoc country chats, while retaining them in unread tracking.
    const openChats = allOpenChats.filter((chat) => !chat.institutionId || (chat.lifecycleInstitutionId && chat.lifecycleCaseIds?.length));

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
            writeSeen(seenTotals(allOpenChats));
            setUnreadIds(new Set());
        } else {
            setUnreadIds(new Set(allOpenChats.filter((chat) => isChatUnread(chat, seen)).map((chat) => String(chat.id))));
        }
        setDisplayOrder(sortChatsByRecency(openChats).map((chat) => String(chat.id)));
        // Deliberately NOT writing the baseline here. Opening the panel is not
        // reading your mail: seeing a row in a list is not seeing the message.
        // The baseline only advances when a chat is actually opened
        // (setChatReadState, below) or "Mark all read" is clicked, so the badge
        // survives a look at the list and clears only for what was really read.
    }, [isOpen, hasLoadedInitialData, freshSinceOpen, allOpenChats]);

    // A chat that arrives (or gains a message) while the panel sits open still
    // has to show as new — storage is the authority now that the baseline is no
    // longer wiped on open. Union-only, so it never un-flags a row mid-read, and
    // it skips the chat currently on screen, which the effect below marks read.
    useEffect(() => {
        if (!isOpen || !snapshotTakenRef.current) return;
        const seen = readSeen();
        if (!seen) return;
        const activeId = activeChat ? String(activeChat.id) : null;
        const arrived = allOpenChats
            .filter((chat) => String(chat.id) !== activeId && isChatUnread(chat, seen))
            .map((chat) => String(chat.id));
        if (arrived.length === 0) return;
        setUnreadIds((prev) => (arrived.every((id) => prev.has(id)) ? prev : new Set([...prev, ...arrived])));
    }, [isOpen, allOpenChats, activeChat]);

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
    // The list row is the thread as shown; the conversation gets the stored one,
    // which is what it writes back.
    const openChatFromList = (chat) => {
        setActiveChat(chats.find((entry) => entry.id === chat.id) ?? chat);
        setHeldUnreadId(null);
        setChatReadState(chat, true);
    };

    // The envelope in the conversation header. Marking the open chat unread has to
    // survive the effect below, so it is remembered here as well as written.
    const toggleActiveChatRead = (chat) => {
        const wasUnread = unreadIds.has(String(chat.id));
        setHeldUnreadId(wasUnread ? null : String(chat.id));
        setChatReadState(shownVersion(chat), wasUnread);
    };

    // Read as far as it is shown: a letter still waiting on the reveal is not
    // read yet, and marks the thread new when it arrives.
    const shownActiveCount = shownVersion(activeChat)?.messages?.length ?? 0;
    useEffect(() => {
        if (!activeChat) return;
        if (heldUnreadId === String(activeChat.id)) return;
        setChatReadState(shownVersion(activeChat), true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeChat?.id, shownActiveCount, heldUnreadId]);

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

    const worldSnapshot = useRuntimeState("world", (world) => world || {});
    const identity = useRuntimeState("game", selectGameIdentity);
    useEffect(() => {
        if (!isOpen) return;
        if (identity.country) setPlayerCountry(identity.country);
        if (identity.gameDate) setGameDate(identity.gameDate);
    }, [isOpen, identity]);

    // Chats created OUTSIDE this panel — a jump's diplomatic invitations, the
    // idle outreach drip — used to be invisible until a full page reload (the
    // list loaded exactly once). The store publishes the stored list while the
    // panel is open and additions are merged in; the active conversation object
    // is left alone so an in-flight exchange is never clobbered mid-reply.
    useEffect(() => {
        if (!isOpen || !hasLoadedInitialData) return;

        let cancelled = false;
        const sync = (saved) => {
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
        };

        const unsubscribe = subscribeRuntime("chat", sync);
        // Opening the panel is when the list has to be current, and a failed
        // read must not wedge it on "waiting for fresh data".
        refreshRuntimeState(["chat"]).finally(() => { if (!cancelled) setFreshSinceOpen(true); });
        return () => {
            cancelled = true;
            unsubscribe();
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

    // What the one-request turn changed beyond the messages: the event log
    // itself (the truth of the thread), the roster after a join or a departure,
    // the title, the polls, and each speaker's cross-chat cursors. The cursors
    // live in world state, so they are written there rather than on the chat.
    const handleThreadUpdate = (chatId, { events, countries, title, polls, demands, cursors, committed = false }) => {
        setChats((prev) => {
            const updated = prev.map((c) => (c.id === chatId
                ? { ...c, events, countries: countries ?? c.countries, title: title || c.title, polls: polls ?? c.polls, demands: demands ?? c.demands }
                : c));
            // Institutional one-request turns are already committed atomically
            // with their legal governance/world/event changes in gameplay.js.
            if (!committed) saveAllChats(updated);
            setActiveChat((ac) => (ac?.id === chatId ? updated.find((c) => c.id === chatId) ?? ac : ac));
            return updated;
        });
        if (!committed && cursors && Object.keys(cursors).length) void saveChatKnowledgeCursors(cursors);
        if (committed) void refreshRuntimeState(["world", "chat", "events"]);
    };

    const adoptInstitutionalResult = (result) => {
        if (Array.isArray(result?.chats)) setChats(result.chats);
        if (result?.channel) {
            setHeldUnreadId(null);
            setChatReadState(shownVersion(result.channel), true);
        }
        if (result?.createdChat) {
            setHeldUnreadId(null);
            setChatReadState(shownVersion(result.createdChat), true);
            setView("chats");
            setActiveChat(result.createdChat);
        }
        void refreshRuntimeState(["world", "chat", "events"]);
    };

    const navigateInstitution = (institutionId, section = "overview") => {
        const id = String(institutionId || "").trim();
        setActiveChat(null);
        setView("institutions");
        if (id) setInstitutionFocusRequest({ institutionId: id, section, nonce: Date.now() });
    };

    const openInstitutionCouncil = (channel, result) => {
        if (result) adoptInstitutionalResult(result);
        const resolvedChannel = result?.channel || channel || null;
        if (resolvedChannel) {
            setHeldUnreadId(null);
            setChatReadState(shownVersion(resolvedChannel), true);
        }
        const institutionId = resolvedChannel?.institutionId;
        setActiveChat(null);
        setView("institutions");
        if (institutionId) setInstitutionFocusRequest({ institutionId: String(institutionId), section: "council", nonce: Date.now() });
    };

    const openInstitutionLifecycleChat = (channel) => {
        if (!channel) return;
        setHeldUnreadId(null);
        setChatReadState(shownVersion(channel), true);
        setView("chats");
        setActiveChat(channel);
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
    const consumePending = (request, draftText = "") => {
        setShowSelector(false);
        const targetType = String(request?.targetType || "private").trim().toLowerCase();

        if (targetType === "institution-council" || targetType === "institution-lifecycle") {
            const institutionId = String(request?.institutionId || "").trim().toLowerCase();
            const caseId = String(request?.caseId || "").trim();
            const threadId = String(request?.threadId || "").trim();
            const exact = chats.find((chat) => {
                if (threadId && String(chat?.id || "") === threadId) return true;
                if (targetType === "institution-council") {
                    return String(chat?.institutionId || "").trim().toLowerCase() === institutionId
                        && !(chat?.lifecycleInstitutionId && Array.isArray(chat?.lifecycleCaseIds) && chat.lifecycleCaseIds.length);
                }
                return String(chat?.lifecycleInstitutionId || "").trim().toLowerCase() === institutionId
                    && Array.isArray(chat?.lifecycleCaseIds)
                    && chat.lifecycleCaseIds.some((id) => String(id || "").trim() === caseId);
            });
            if (exact) {
                setHeldUnreadId(null);
                setChatReadState(shownVersion(exact), true);
                if (draftText) setComposerDraft({ chatId: exact.id, text: draftText });
                if (targetType === "institution-council") {
                    setActiveChat(null);
                    setView("institutions");
                    setInstitutionFocusRequest({ institutionId: exact.institutionId, section: "council", nonce: Date.now() });
                } else {
                    setView("chats");
                    setActiveChat(exact);
                }
                return;
            }
            // Never fall through to "whatever chat has the same country". An
            // explicit institution target that cannot be resolved stays explicit.
            if (institutionId) {
                setActiveChat(null);
                setView("institutions");
                setInstitutionFocusRequest({ institutionId: request.institutionId, section: targetType === "institution-council" ? "council" : "members", nonce: Date.now() });
            }
            logDebugEvent("diplomacy", `Advisor draft target could not resolve an exact ${targetType} thread.`, {
                institutionId: request?.institutionId || "",
                caseId: request?.caseId || "",
                threadId,
            }, { problem: true });
            return;
        }

        const country = { name: String(request?.name || request?.country || "").trim(), code: request?.code || "" };
        if (!country.name) return;
        // The advisor knows a polity by name only; the flag and the nation colour
        // both key off the code, so fill it in from the loaded roster rather than
        // opening a chat wearing the fallback white flag.
        const code = country.code
            || countries.find(c => (c?.name || "").toLowerCase() === country.name.toLowerCase())?.code
            || "";
        setChats(prev => {
            const existing = prev.find(
                c => c.status !== "closed"
                    && !c.institutionId
                    && !c.lifecycleInstitutionId
                    && Array.isArray(c.countries)
                    && c.countries.length === 1
                    && (c.countries[0]?.name || "").toLowerCase() === country.name.toLowerCase(),
            );
            if (existing) {
                setView("chats");
                setActiveChat(existing);
                if (draftText) setComposerDraft({ chatId: existing.id, text: draftText });
                return prev;
            }
            const newChat = { id: Date.now(), countries: [{ name: country.name, code }], messages: [], status: "open" };
            const u = [newChat, ...prev];
            saveAllChats(u);
            setView("chats");
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
    const institutionUnreadCount = allOpenChats.filter((chat) => chat.institutionId && unreadIds.has(String(chat.id))).length;
    const chatUnreadCount = openChats.filter((chat) => unreadIds.has(String(chat.id))).length;

    const activeChatIdForWatcher = activeChat && !activeChat.institutionId
        ? String(activeChat.id)
        : visibleCouncilChatId;
    useEffect(() => {
        activeDiplomaticChatId = isOpen ? activeChatIdForWatcher : "";
        return () => {
            if (activeDiplomaticChatId === activeChatIdForWatcher) activeDiplomaticChatId = "";
        };
    }, [isOpen, activeChatIdForWatcher]);

        return (
            <>
            <MarkdownStyleInjector />
            <div style={{ position: "fixed", bottom: isOpen ? "4.25rem" : "-52rem", left: "0.5rem", width: "min(58rem, calc(100vw - 1rem))", height: "min(50rem, calc(100vh - 8rem))", minHeight: "24rem", backgroundColor: "rgba(24,24,27,0.95)", backdropFilter: "blur(8px)", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "-4px 0 24px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.06)", zIndex: 9998, overflow: "hidden", transition: "bottom 0.35s cubic-bezier(0.4,0,0.2,1),opacity 0.35s ease", opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? "auto" : "none", fontFamily: "sans-serif", color: "white", display: "flex", flexDirection: "column" }}>

            <Presence open={showSelector}><CountrySelectorModal countries={availableCountries} loading={loadingCountries} onStart={handleStartChat} onCancel={() => setShowSelector(false)} /></Presence>

            {activeChat && (!activeChat.institutionId || (activeChat.lifecycleInstitutionId && activeChat.lifecycleCaseIds?.length)) && Array.isArray(activeChat.countries) && activeChat.countries.length > 0 ? (
                <ConversationView chat={activeChat} playerCountry={playerCountry} gameDate={gameDate} world={worldSnapshot} onDelete={() => handleDeleteChat(activeChat.id)} onBack={() => activeChat.institutionId ? navigateInstitution(activeChat.institutionId, "overview") : setActiveChat(null)} onMessagesUpdate={handleMessagesUpdate} onThreadUpdate={handleThreadUpdate}
                unread={unreadIds.has(String(activeChat.id))} onToggleRead={() => toggleActiveChatRead(activeChat)}
                draft={composerDraft?.chatId === activeChat.id ? composerDraft.text : ""}
                onDraftApplied={() => setComposerDraft(null)}
                onInstitutionNavigate={(section) => { const institutionId = activeChat.institutionId || activeChat.lifecycleInstitutionId; if (institutionId) navigateInstitution(institutionId, section); }} onLifecycleResult={adoptInstitutionalResult} />
            ) : (
                <>
                <div data-diplomacy-workspace-header="modern" style={{ padding: ".7rem .85rem .65rem", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: ".75rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: ".55rem", minWidth: 0 }}>
                            <div aria-hidden="true" style={{ width: "1.65rem", height: "1.65rem", borderRadius: 7, border: "1px solid rgba(167,139,250,.35)", background: "rgba(139,92,246,.16)", color: "#ddd6fe", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><WorkspaceTabIcon type="contacts" size={15} /></div>
                            <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: ".98rem", fontWeight: 800, lineHeight: 1.1 }}>Diplomacy</div>
                                <div style={{ marginTop: ".13rem", fontSize: ".56rem", color: "rgba(255,255,255,.32)" }}>Conversations, institutions and statecraft</div>
                            </div>
                        </div>
                        <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: "1.1rem", lineHeight: 1, padding: "0.15rem 0.3rem", borderRadius: "6px" }}
                        onMouseEnter={e => { e.currentTarget.style.color = "white"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
                        onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.5)"; e.currentTarget.style.background = "none"; }}>✕</button>
                    </div>
                    <div style={{ display: "flex", gap: ".35rem", marginTop: ".55rem" }}>
                        {[
                            ["chats", "contacts", "Contacts", chatUnreadCount],
                            ["institutions", "institutions", "Institutions", institutionUnreadCount],
                            ...(espionageOn ? [["spy", "intelligence", "Intelligence", 0]] : []),
                        ].map(([key, iconType, label, count]) => (
                            <button key={key} onClick={() => setView(key)} style={{ display: "flex", alignItems: "center", gap: ".38rem", padding: ".34rem .68rem", borderRadius: "8px", fontSize: ".72rem", fontWeight: 750, cursor: "pointer", fontFamily: "sans-serif", border: "1px solid " + (currentView === key ? "rgba(167,139,250,0.45)" : "rgba(255,255,255,.07)"), background: currentView === key ? "rgba(139,92,246,0.20)" : "rgba(255,255,255,.025)", color: currentView === key ? "white" : "rgba(255,255,255,0.48)" }}>
                                <span aria-hidden="true" style={{ display: "inline-flex", opacity: .8 }}><WorkspaceTabIcon type={iconType} size={13} /></span>
                                <span>{label}</span>
                                {Number(count) > 0 && <span style={{ minWidth: "1.05rem", height: "1.05rem", padding: "0 .25rem", borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", background: currentView === key ? "rgba(255,255,255,.14)" : "rgba(96,165,250,.16)", color: currentView === key ? "#fff" : "#93c5fd", fontSize: ".57rem", fontWeight: 800 }}>{count}</span>}
                            </button>
                        ))}
                    </div>
                </div>
                {currentView === "spy" ? (
                    <SpyView playerCountry={playerCountry} gameDate={gameDate} countries={countries} loadingCountries={loadingCountries} />
                ) : currentView === "institutions" ? (
                    <InstitutionsWorkspace
                        world={worldSnapshot}
                        playerCountry={playerCountry}
                        gameDate={gameDate}
                        chats={chats}
                        unreadIds={unreadIds}
                        onAdoptResult={adoptInstitutionalResult}
                        onOpenCouncil={openInstitutionCouncil}
                        onOpenLifecycleChat={openInstitutionLifecycleChat}
                        onCouncilVisibleChange={setVisibleCouncilChatId}
                        renderCouncil={(channel) => (
                            <ConversationView
                                chat={channel}
                                playerCountry={playerCountry}
                                gameDate={gameDate}
                                world={worldSnapshot}
                                onMessagesUpdate={handleMessagesUpdate}
                                onThreadUpdate={handleThreadUpdate}
                                unread={unreadIds.has(String(channel.id))}
                                onToggleRead={() => toggleActiveChatRead(channel)}
                                draft={composerDraft?.chatId === channel.id ? composerDraft.text : ""}
                                onDraftApplied={() => setComposerDraft(null)}
                                onInstitutionNavigate={(section) => navigateInstitution(channel.institutionId, section)}
                                onLifecycleResult={adoptInstitutionalResult}
                                embeddedInstitution
                            />
                        )}
                        focusRequest={institutionFocusRequest}
                    />
                ) : (
                <>
                {/* The unread filter belongs to the Contacts list only — Intelligence
                    has no chat read/unread notion, so it sits inside this branch
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
                    {group.chats.map(chat => <ChatListItem key={chat.id} chat={chat} playerCountry={playerCountry} puppetMarkers={puppetMarkers} unread={unreadIds.has(String(chat.id))} onClick={() => openChatFromList(chat)} onDelete={() => handleDeleteChat(chat.id)} onToggleRead={() => setChatReadState(chat, unreadIds.has(String(chat.id)))} />)}
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
                const stored = provided ?? await loadAllChats({ force });
                if (cancelled || !Array.isArray(stored)) return;
                // A letter an unseen event delivered announces itself when the
                // reveal reaches that event, not when the turn is written
                // (runtime/unseenEvents.js) — the toast would say what the
                // reveal is about to show.
                const saved = withoutUnseenChats(stored, unseenEventIdsFor(await readWorldStateView().catch(() => null)));

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
        // A reveal step may uncover a letter the turn delivered.
        window.addEventListener(UNSEEN_EVENTS_CHANGED, onExternalChatUpdate);
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
            window.removeEventListener(UNSEEN_EVENTS_CHANGED, onExternalChatUpdate);
            window.removeEventListener("oh:active-game-changed", onActiveGameChanged);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, soundEnabled]);

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
        // The one subscription this component holds. A second copy of this effect
        // crept in with the notification watcher and toggled the panel a second
        // time on every request, so the diplomacy button on a country popup opened
        // the chat and closed it again in the same tick.
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
            onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
            onClick={() => setChatOpen(o => !o)}>
            <span style={{ position: "relative", display: "inline-flex" }}>
                <DiplomacyDockIcon />
                {!isOpen && (isGenerating ? (
                    // "Someone is typing" — a country may be drafting an approach.
                    // Replaces the numeric badge (rather than sitting beside it) so
                    // the icon says one thing at a time; the count returns on its
                    // own once generation ends and the next 15s poll catches it.
                    <span style={{ position: "absolute", top: "-0.55rem", right: "-0.8rem", minWidth: "1.05rem", height: "1.05rem", padding: "0 0.3rem", borderRadius: "999px", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.35)", color: "white", fontSize: "0.68rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, boxShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>
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
    // The dock grows by one button per launcher; its geometry lives in hudDock.js
    // so the Search control beside it moves with it.
    return (
        <div style={{ position: "fixed", bottom: `${DOCK_BOTTOM_REM}rem`, left: `${DOCK_LEFT_REM}rem`, height: `${DOCK_HEIGHT_REM}rem`, width: DOCK_WIDTH, gap: `${DOCK_GAP_REM}rem`, padding: "0 0.1rem", backgroundColor: "var(--oh-hud-bg)", backdropFilter: "var(--oh-hud-blur)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontFamily: "sans-serif", borderRadius: "14px", border: "1px solid var(--oh-hud-border)", boxShadow: "var(--oh-hud-shadow-soft)" }}>
        <Chat hovered={hoveredChat} setHovered={setHoveredChat} isOpen={activePanel === "chat"} onToggle={() => onTogglePanel("chat")} />
        <Actions onOpenAdvisor={onOpenAdvisor} hovered={hoveredActions} setHovered={setHoveredActions} isOpen={activePanel === "actions"} onToggle={() => onTogglePanel("actions")} />
        <Projects onOpenAdvisor={onOpenAdvisor} mapRef={mapRef} hovered={hoveredProjects} setHovered={setHoveredProjects} isOpen={activePanel === "projects"} onToggle={() => onTogglePanel("projects")} />
        </div>
    );
});

export { Toolbar, Chat, ChatPanel };
