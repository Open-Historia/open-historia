/*! Open Historia — portions (panel sizing on small screens) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React from "react";
import { APP_HEIGHT, useCanHover, useTouchPrimary } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
import { logDebugEvent } from "../../runtime/debugLog.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";
import { generateActionSuggestions, refinePlayerAction } from "../AI/gameplayLazy.js";
import { revertUnitOrder } from "../Map/unitsController.js";
import {
    buildActionDisplayText,
    normalizeActionEntry,
    readWorldState,
    writeActionsState,
    writeWorldState,
} from "../../runtime/gameState.js";
import { PLAYER_GOAL_MAX_CHARS, playerGoalOf, withPlayerGoal } from "../../runtime/playerGoal.js";
import { isSimulationBusy } from "../AI/simulationStatus.js";
import { formatGameDateReadable } from "../../runtime/gameDates.js";
import { refreshRuntimeState, subscribeRuntime } from "../../runtime/runtimeStore.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";

dayjs.extend(advancedFormat);

// The only fields this panel reads, so nothing else in game.json re-renders it.
const selectGameHeader = (game) => ({
    country: game?.country || "",
    gameDate: game?.gameDate || "",
    round: Number(game?.round) || 0,
});

const ACTIONS_STYLE_ID = "actions-style";

const ensureActionsStyles = () => {
    if (typeof document === "undefined" || document.getElementById(ACTIONS_STYLE_ID)) {
        return;
    }

    const style = document.createElement("style");
    style.id = ACTIONS_STYLE_ID;
    style.textContent = `
    @keyframes actions-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .actions-composer {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }

    .actions-composer::-webkit-scrollbar {
        display: none;
    }
    `;
    document.head.appendChild(style);
};

const SparkleIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2L13.5 9.5L21 11L13.5 12.5L12 20L10.5 12.5L3 11L10.5 9.5L12 2Z" />
    </svg>
);

const StopIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
);

const SendIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
);

const SpinnerRing = ({ size = 14, tone = "rgba(255,255,255,0.88)" }) => {
    React.useEffect(() => {
        ensureActionsStyles();
    }, []);

    return (
        <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ animation: "actions-spin 0.7s linear infinite" }}
        >
        <circle cx="12" cy="12" r="8" stroke="rgba(255,255,255,0.2)" strokeWidth="2.2" />
        <path d="M12 4a8 8 0 0 1 8 8" stroke={tone} strokeWidth="2.2" strokeLinecap="round" />
        </svg>
    );
};

const saveActions = async (actions) => writeActionsState(actions);

const createManualAction = (input) =>
normalizeActionEntry({
    kind: "action",
    rawInput: input,
    source: "manual",
    status: "planned",
    text: input,
    title: input,
});

const normalizeSuggestionAction = (action) =>
normalizeActionEntry({
    ...action,
    source: "suggested",
    status: "planned",
});

const ActionItem = ({ action, onDelete }) => {
    const [hovered, setHovered] = React.useState(false);
    // The ✕ appears with the pointer over the row. Nothing hovers on a touch
    // screen, so there it is always shown, or an order could never be deleted.
    const canHover = useCanHover();
    const showDelete = hovered || !canHover;
    const normalized = normalizeActionEntry(action);

    if (!normalized) {
        return null;
    }

    const label = buildActionDisplayText(normalized);
    const showTitle = normalized.title && normalized.title !== label;

    return (
        <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
            alignItems: "center",
            backgroundColor: hovered ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "10px",
            color: "rgba(255,255,255,0.85)",
            display: "flex",
            gap: "0.5rem",
            justifyContent: "space-between",
            lineHeight: "1.75",
            padding: "0.55rem 0.85rem",
            transition: "background 0.15s",
        }}
        >
        <div style={{ flex: 1, minWidth: 0 }}>
        {showTitle && (
            <div style={{ color: "rgba(255,255,255,0.95)", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.15rem" }}>
            {normalized.title}
            </div>
        )}
        <div style={{ color: "rgba(255,255,255,0.82)", fontSize: "0.82rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {label}
        </div>
        <div
        style={{
            color: "rgba(255,255,255,0.38)",
            fontSize: "0.68rem",
            letterSpacing: "0.06em",
            marginTop: "0.25rem",
            textTransform: "uppercase",
        }}
        >
        {normalized.kind} • {normalized.status}
        </div>
        </div>
        <button
        type="button"
        className="oh-tap"
        onClick={onDelete}
        title="Delete action"
        aria-label="Delete action"
        style={{
            alignItems: "center",
            background: hovered ? "rgba(239,68,68,0.1)" : "none",
            border: "none",
            borderRadius: "6px",
            color: hovered ? "rgba(239,68,68,0.95)" : "rgba(239,68,68,0.8)",
            cursor: "pointer",
            display: "flex",
            flexShrink: 0,
            fontSize: "1rem",
            lineHeight: 1,
            opacity: showDelete ? 1 : 0,
            padding: "0.18rem 0.3rem",
            pointerEvents: showDelete ? "auto" : "none",
            transition: "opacity 0.15s, color 0.15s, background 0.15s",
        }}
        >
        {"\u2715"}
        </button>
        </div>
    );
};

const SuggestionCard = ({ topic, onQueue, queuedIds }) => (
    <div
    style={{
        background: "rgba(255,255,255,0.04)",
                                                border: "1px solid rgba(255,255,255,0.08)",
                                                borderRadius: "12px",
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: "0.55rem",
                                                padding: "0.7rem 0.8rem",
    }}
    >
    <div>
    <div style={{ color: "rgba(255,255,255,0.94)", fontSize: "0.8rem", fontWeight: 700 }}>{topic.title}</div>
    <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.76rem", lineHeight: "1.5", marginTop: "0.2rem" }}>
    {topic.description}
    </div>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
    {topic.actions.map((action) => {
        const isQueued = queuedIds?.has(action.id);
        return (
            <button
            key={action.id}
            type="button"
            className="oh-tap-row"
            disabled={isQueued}
            onClick={() => onQueue(action)}
            style={{
                background: isQueued ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.04)",
                border: isQueued ? "1px solid rgba(74,222,128,0.35)" : "1px solid rgba(255,255,255,0.12)",
                borderRadius: "10px",
                color: "rgba(255,255,255,0.9)",
                cursor: isQueued ? "default" : "pointer",
                fontFamily: "sans-serif",
                padding: "0.55rem 0.7rem",
                textAlign: "left",
            }}
            >
            <div style={{ fontSize: "0.76rem", fontWeight: 700 }}>
            {isQueued ? `✓ Queued — ${action.title}` : action.title}
            </div>
            <div style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.74rem", lineHeight: "1.45", marginTop: "0.18rem" }}>
            {action.text}
            </div>
            </button>
        );
    })}
    </div>
    </div>
);

// Whether a turn is running, for the controls a turn's own world write would
// overwrite. The flag is a synchronous counter (simulationStatus.js), so it is
// polled while the panel is open, as the HUD polls it.
const TURN_POLL_MS = 800;

const useTurnRunning = (active) => {
    const [running, setRunning] = React.useState(() => isSimulationBusy());
    React.useEffect(() => {
        if (!active) return undefined;
        setRunning(isSimulationBusy());
        const timer = window.setInterval(() => setRunning(isSimulationBusy()), TURN_POLL_MS);
        return () => window.clearInterval(timer);
    }, [active]);
    return running;
};

const goalButtonStyle = (enabled, tone = "neutral") => ({
    background: tone === "primary" ? (enabled ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.07)") : "none",
    border: tone === "primary" ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.14)",
    borderRadius: "8px",
    color: enabled ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
    cursor: enabled ? "pointer" : "not-allowed",
    fontFamily: "sans-serif",
    fontSize: "0.74rem",
    fontWeight: 600,
    padding: "0.3rem 0.7rem",
});

// The player's standing goal (runtime/playerGoal.js): the direction behind the
// orders. The advisor, the time skip and the suggestions are told it; a foreign
// leader never is. Locked while a turn runs, because the turn writes the world
// it lives in.
const StandingGoal = ({ country, round, gameDate, isOpen }) => {
    const goal = useRuntimeState("world", (world) => playerGoalOf(world, country), country);
    const turnRunning = useTurnRunning(isOpen);
    const [editing, setEditing] = React.useState(false);
    const [draft, setDraft] = React.useState("");
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState("");
    const draftRef = React.useRef(null);

    React.useEffect(() => {
        if (!isOpen) {
            setEditing(false);
            setError("");
        }
    }, [isOpen]);

    React.useEffect(() => {
        if (editing) draftRef.current?.focus();
    }, [editing]);

    if (!country) return null;

    const lockedNote = "A turn is running. The goal can be changed once it ends.";

    const startEditing = () => {
        if (turnRunning) return;
        setDraft(goal);
        setError("");
        setEditing(true);
    };

    const save = async (text) => {
        if (saving) return;
        if (isSimulationBusy()) {
            setError(lockedNote);
            return;
        }
        setSaving(true);
        setError("");
        try {
            const current = await readWorldState({ force: true });
            await writeWorldState(withPlayerGoal(current, country, text, { round, date: gameDate }));
            const wording = String(text || "").trim();
            logDebugEvent("action", wording ? `Standing goal set: ${wording}` : "Standing goal cleared");
            setEditing(false);
        } catch (saveError) {
            console.error("Failed to save the standing goal:", saveError);
            setError("The goal could not be saved. Try again.");
        } finally {
            setSaving(false);
        }
    };

    const canSave = !saving && !turnRunning && draft.trim() !== goal;

    const handleKeyDown = (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (canSave) void save(draft);
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setEditing(false);
            setError("");
        }
    };

    const label = (
        <span style={{ color: "rgba(255,255,255,0.9)", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        Standing goal
        </span>
    );

    if (editing) {
        return (
            <div style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: "10px", display: "flex", flexDirection: "column", gap: "0.45rem", padding: "0.6rem 0.75rem" }}>
            {label}
            <textarea
            ref={draftRef}
            className="actions-composer"
            aria-label="Standing goal"
            maxLength={PLAYER_GOAL_MAX_CHARS}
            placeholder="What is your government steering toward? e.g. Keep out of the war and grow the economy"
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            style={{
                background: "rgba(0,0,0,0.25)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "8px",
                boxSizing: "border-box",
                color: "white",
                fontFamily: "sans-serif",
                fontSize: "0.8rem",
                lineHeight: "1.45",
                outline: "none",
                padding: "0.5rem 0.65rem",
                resize: "vertical",
                width: "100%",
            }}
            />
            <div style={{ alignItems: "center", display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
            {goal && (
                <button type="button" className="oh-tap-row" disabled={saving || turnRunning} onClick={() => void save("")} style={{ ...goalButtonStyle(!saving && !turnRunning), marginRight: "auto" }}>
                Clear goal
                </button>
            )}
            <button type="button" className="oh-tap-row" onClick={() => { setEditing(false); setError(""); }} style={goalButtonStyle(true)}>
            Cancel
            </button>
            <button type="button" className="oh-tap-row" disabled={!canSave} onClick={() => void save(draft)} style={goalButtonStyle(canSave, "primary")}>
            {saving ? "Saving…" : "Save"}
            </button>
            </div>
            {(error || turnRunning) && (
                <span style={{ color: "rgba(253,186,116,0.9)", fontSize: "0.72rem" }}>{error || lockedNote}</span>
            )}
            </div>
        );
    }

    if (!goal) {
        return (
            <button
            type="button"
            className="oh-tap-row"
            disabled={turnRunning}
            onClick={startEditing}
            title={turnRunning ? lockedNote : "Your advisor, the time skip and the AI suggestions steer by it. Foreign leaders never see it."}
            style={{
                background: "none",
                border: "1px dashed rgba(255,255,255,0.2)",
                borderRadius: "10px",
                color: turnRunning ? "rgba(255,255,255,0.45)" : "#e4e4e7",
                cursor: turnRunning ? "not-allowed" : "pointer",
                fontFamily: "sans-serif",
                fontSize: "0.78rem",
                padding: "0.5rem 0.9rem",
                textAlign: "left",
                width: "100%",
            }}
            >
            {"\u{1F3AF} Set a standing goal"}
            <span style={{ color: "rgba(255,255,255,0.45)", display: "block", fontSize: "0.72rem", marginTop: "0.15rem" }}>
            What your government is steering toward. Your advisor and the simulation keep it in mind; foreign leaders never see it.
            </span>
            </button>
        );
    }

    return (
        <div style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "10px", display: "flex", flexDirection: "column", gap: "0.3rem", padding: "0.55rem 0.75rem" }}>
        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
        {label}
        <button
        type="button"
        className="oh-tap"
        disabled={turnRunning}
        onClick={startEditing}
        title={turnRunning ? lockedNote : "Change or clear the goal"}
        style={{ background: "none", border: "none", color: turnRunning ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.28)", cursor: turnRunning ? "not-allowed" : "pointer", fontFamily: "sans-serif", fontSize: "0.74rem", padding: 0 }}
        >
        Edit
        </button>
        </div>
        <span title={goal} style={{ color: "rgba(255,255,255,0.82)", display: "-webkit-box", fontSize: "0.8rem", lineHeight: "1.45", overflow: "hidden", WebkitBoxOrient: "vertical", WebkitLineClamp: 3 }}>
        {"\u{1F3AF} "}{goal}
        </span>
        </div>
    );
};

const ActionsPanel = ({ isOpen, onClose, onOpenAdvisor }) => {
    const [actions, setActions] = React.useState([]);
    const [inputValue, setInputValue] = React.useState("");
    const game = useRuntimeState("game", selectGameHeader);
    const country = game.country || "your nation";
    // Full display name for the header, never the code.
    const countryDisplayName = useCountryDisplayName(country);
    const gameDate = game.gameDate
        ? formatGameDateReadable(game.gameDate, "MMMM Do, YYYY") || dayjs(game.gameDate).format("MMMM Do, YYYY")
        : "the current date";
    const [suggestions, setSuggestions] = React.useState([]);
    const [queuedSuggestionIds, setQueuedSuggestionIds] = React.useState(() => new Set());
    const [hasRequestedSuggestions, setHasRequestedSuggestions] = React.useState(false);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [isImproving, setIsImproving] = React.useState(false);
    // Holds the in-flight improve's AbortController so the button can stop it,
    // the same shape as the timeline jump's cancel (time.jsx jumpAbortRef).
    const improveAbortRef = React.useRef(null);
    const [isSuggesting, setIsSuggesting] = React.useState(false);
    const inputRef = React.useRef(null);
    const lastRoundRef = React.useRef(null);
    const isMobile = useIsMobile();
    const isTouch = useTouchPrimary();
    // On a phone, either way up, the body scrolls as one. With only the orders
    // list scrolling, everything above it kept its full height and the list got
    // what was left: on a short screen, with suggestions showing, nothing.
    const scrollAsOne = isMobile || isTouch;

    React.useEffect(() => {
        if (!isOpen) {
            return undefined;
        }

        let cancelled = false;
        ensureActionsStyles();
        setSuggestions([]);
        setHasRequestedSuggestions(false);

        // Actions created/edited from OUTSIDE this panel (the advisor, chatting in
        // its own drawer) used to be invisible here until the panel was closed and
        // reopened. The store publishes those writes. Signature-gated so a
        // republish with no real change doesn't reset hover state on every row.
        const actionsSignature = (list) => list.map((a) => `${a.id}:${a.title}:${a.text}:${a.status}`).join("|");
        const unsubscribe = subscribeRuntime("actions", (saved) => {
            if (cancelled || !Array.isArray(saved)) return;
            setActions((prev) => (actionsSignature(saved) === actionsSignature(prev) ? prev : saved));
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [isOpen]);

    // After a jump, applySimulationResult re-marks last round's actions
    // "resolved" (submittedActions filters those out). The first value only
    // seeds the ref; a freshly queued next-turn action is already persisted, so
    // the reload keeps it.
    React.useEffect(() => {
        if (!isOpen || !game.round) return;
        if (lastRoundRef.current !== null && game.round !== lastRoundRef.current) {
            void refreshRuntimeState(["actions"]);
        }
        lastRoundRef.current = game.round;
    }, [isOpen, game.round]);

    const persistActions = async (nextActions) => {
        setActions(nextActions);
        try {
            await saveActions(nextActions);
        } catch (error) {
            console.error("Failed to save actions:", error);
        }
    };

    const submittedActions = React.useMemo(
        () =>
        actions
        .map((action, index) => ({
            normalized: normalizeActionEntry(action, index),
                                 originalIndex: index,
        }))
        .filter(({ normalized }) => normalized?.status === "planned"),
                                           [actions],
    );

    const handleSubmit = async () => {
        const trimmed = inputValue.trim();
        if (!trimmed || isSubmitting || isImproving) {
            return;
        }

        const nextAction = createManualAction(trimmed);
        if (!nextAction) {
            return;
        }

        setIsSubmitting(true);
        try {
            await persistActions([...actions, nextAction]);
            // What the player told their country to do is half of "the series of
            // events they did" — a turn that goes wrong usually goes wrong
            // BECAUSE of an order, and the diagnostics log is unreadable without
            // them. The text is short and the player wrote it, so it goes in
            // whole rather than as a length.
            logDebugEvent("action", `Order queued: ${nextAction.title || nextAction.text || "(untitled)"}`, {
                queued: actions.length + 1,
            });
            setInputValue("");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleImprove = async () => {
        const trimmed = inputValue.trim();
        if (!trimmed || isImproving || isSubmitting) {
            return;
        }

        setIsImproving(true);
        const controller = new AbortController();
        improveAbortRef.current = controller;
        try {
            const refined = await refinePlayerAction(trimmed, { persist: false, signal: controller.signal });
            const improvedText = refined?.text || buildActionDisplayText(refined) || trimmed;
            setInputValue(improvedText);
            inputRef.current?.focus();
        } catch (error) {
            // Stopping on purpose is not a failure, and it must leave the text the
            // player typed exactly as it was.
            if (error?.name !== "AbortError") {
                console.error("Failed to improve action:", error);
            }
        } finally {
            improveAbortRef.current = null;
            setIsImproving(false);
        }
    };

    const handleStopImprove = () => {
        improveAbortRef.current?.abort(new DOMException("Improve cancelled.", "AbortError"));
    };

    const handleDelete = async (index) => {
        const removed = actions[index];
        // Deleting a queued troop order also undoes what it did to the map —
        // otherwise a manual move/deploy stays in place while the AI is never
        // told about it (#368). Only planned orders carry a revert; anything
        // already resolved by a jump keeps its outcome.
        if (removed?.unitRevert && (removed.status ?? "planned") === "planned") {
            try {
                await revertUnitOrder(removed.unitRevert);
            } catch (error) {
                console.warn("[actions] could not revert the unit order:", error);
            }
        }
        logDebugEvent("action", `Order removed: ${removed?.title || removed?.text || "(untitled)"}`, {
            reverted: Boolean(removed?.unitRevert && (removed.status ?? "planned") === "planned"),
        });
        await persistActions(actions.filter((_, actionIndex) => actionIndex !== index));
    };

    const handleQueueSuggestion = async (action) => {
        const queuedAction = normalizeSuggestionAction(action);
        if (!queuedAction) {
            // Malformed AI suggestion — say so instead of doing nothing.
            console.warn("[actions] suggestion could not be queued (no usable text):", action);
            return;
        }

        await persistActions([...actions, queuedAction]);
        logDebugEvent("action", `Suggested order queued: ${queuedAction.title || queuedAction.text || "(untitled)"}`);
        // Visible click feedback: the suggestion button flips to "✓ Queued".
        setQueuedSuggestionIds((previous) => new Set(previous).add(action.id));
    };

    const refreshSuggestions = async () => {
        if (isSuggesting) {
            return;
        }

        setHasRequestedSuggestions(true);
        setIsSuggesting(true);
        try {
            const topics = await generateActionSuggestions({ force: true });
            setSuggestions(topics);
            setQueuedSuggestionIds(new Set());
        } catch (error) {
            console.error("Failed to generate suggestions:", error);
            setSuggestions([]);
        } finally {
            setIsSuggesting(false);
        }
    };

    const handleKeyDown = (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSubmit();
        }
    };

    const suggestionButtonLabel = hasRequestedSuggestions
    ? (isSuggesting ? "Refreshing AI suggestions..." : "Refresh AI suggestions")
    : (isSuggesting ? "Loading AI suggestions..." : "Get AI suggestions");

    return (
        <div
        style={{
            backdropFilter: "blur(8px)",
            backgroundColor: "rgba(24, 24, 27, 0.95)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "16px",
            bottom: isOpen ? "4.25rem" : "-30rem",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
            color: "white",
            display: "flex",
            flexDirection: "column",
            fontFamily: "sans-serif",
            // Grow to use the height a taller screen offers (leaving ~16rem for the
            // top bar), never dropping below a usable 30rem floor for laptops/phones,
            // and never past the 9rem the top UI needs (so it can't overflow up).
            height: `min(calc(${APP_HEIGHT} - 9rem), max(calc(${APP_HEIGHT} - 16rem), 30rem))`,
            minHeight: "10rem",
            left: "0rem",
            maxWidth: "calc(100vw - 1rem)",
            opacity: isOpen ? 1 : 0,
            overflow: "hidden",
            pointerEvents: isOpen ? "auto" : "none",
            position: "fixed",
            transition: "bottom 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease",
            width: "26.25rem",
            zIndex: 9998,
        }}
        >
        <div
        style={{
            alignItems: "center",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            display: "flex",
            justifyContent: "space-between",
            padding: "1rem 1.25rem 0.75rem",
        }}
        >
        <span style={{ fontSize: "1rem", fontWeight: 700, letterSpacing: "0.01em" }}>Actions</span>
        <button
        type="button"
        className="oh-tap"
        onClick={onClose}
        aria-label="Close actions"
        style={{
            background: "none",
            border: "none",
            borderRadius: "6px",
            color: "rgba(255,255,255,0.5)",
            cursor: "pointer",
            fontSize: "1.1rem",
            lineHeight: 1,
            padding: "0.15rem 0.3rem",
            transition: "color 0.15s, background 0.15s",
        }}
        onMouseEnter={(event) => {
            event.currentTarget.style.color = "white";
            event.currentTarget.style.background = "rgba(255,255,255,0.08)";
        }}
        onMouseLeave={(event) => {
            event.currentTarget.style.color = "rgba(255,255,255,0.5)";
            event.currentTarget.style.background = "none";
        }}
        >
        {"\u2715"}
        </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem", padding: "0.875rem 1.25rem", flex: 1, minHeight: 0, ...(scrollAsOne ? { overflowY: "auto", scrollbarWidth: "none" } : { overflow: "hidden" }) }}>
        <p
        style={{
            color: "rgba(255,255,255,0.75)",
            fontSize: "0.82rem",
            lineHeight: "1.55",
            margin: 0,
        }}
        >
        Submit actions for {countryDisplayName} for {gameDate}. Your actions will affect how the game world responds.
        </p>

        <StandingGoal country={game.country} round={game.round} gameDate={game.gameDate} isOpen={isOpen} />

        <button
        type="button"
        className="oh-tap-row"
        // Opens the Advisor primed with a starter message (in its input box, not
        // auto-sent) rather than blank — the advisor can create/edit/remove
        // queued actions right from that conversation (see advisor.jsx), so this
        // is the more direct route into the same plan-the-turn workflow the AI
        // suggestions above offer.
        onClick={() => onOpenAdvisor("Let's brainstorm a plan of concrete actions for this round. Ask me what I'm trying to accomplish, then propose specific ones we can queue.")}
        style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "10px",
            color: "#e4e4e7",
            cursor: "pointer",
            fontSize: "0.82rem",
            fontWeight: 500,
            letterSpacing: "0.01em",
            padding: "0.55rem 1rem",
            transition: "background 0.15s, border-color 0.15s",
            width: "100%",
        }}
        onMouseEnter={(event) => {
            event.currentTarget.style.background = "rgba(255,255,255,0.1)";
            event.currentTarget.style.borderColor = "rgba(255,255,255,0.28)";
        }}
        onMouseLeave={(event) => {
            event.currentTarget.style.background = "rgba(255,255,255,0.05)";
            event.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
        }}
        >
        Help brainstorm actions
        </button>

        <button
        type="button"
        className="oh-tap-row"
        onClick={refreshSuggestions}
        style={{
            alignItems: "center",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "10px",
            color: "rgba(255,255,255,0.82)",
            cursor: "pointer",
            display: "flex",
            fontSize: "0.8rem",
            gap: "0.5rem",
            justifyContent: "center",
            padding: "0.52rem 1rem",
            transition: "background 0.15s, border-color 0.15s",
            width: "100%",
        }}
        onMouseEnter={(event) => {
            event.currentTarget.style.background = "rgba(255,255,255,0.09)";
            event.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
        }}
        onMouseLeave={(event) => {
            event.currentTarget.style.background = "rgba(255,255,255,0.05)";
            event.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
        }}
        >
        {isSuggesting && <SpinnerRing size={14} />}
        <span>{suggestionButtonLabel}</span>
        </button>

        {(hasRequestedSuggestions || isSuggesting || suggestions.length > 0) && (
            <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                // Uncapped when the whole body scrolls: a box that scrolls on
                // its own inside one that scrolls catches the thumb halfway.
                ...(scrollAsOne ? { flexShrink: 0 } : { maxHeight: "13rem", overflowY: "auto" }),
                scrollbarWidth: "none",
            }}
            >
            {hasRequestedSuggestions && !isSuggesting && suggestions.length === 0 && (
                <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.78rem", fontStyle: "italic", margin: 0 }}>
                No AI suggestions generated yet.
                </p>
            )}
            {suggestions.map((topic) => (
                <SuggestionCard key={topic.id} topic={topic} onQueue={handleQueueSuggestion} queuedIds={queuedSuggestionIds} />
            ))}
            </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", ...(scrollAsOne ? { flexShrink: 0 } : { flex: 1, overflow: "hidden" }) }}>
        <p
        style={{
            color: "rgba(255,255,255,0.9)",
            fontSize: "0.78rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            margin: "0 0 0.5rem 0",
            textTransform: "uppercase",
        }}
        >
        Your Submitted Actions
        </p>

        <div
        style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",
            ...(scrollAsOne ? null : { flex: 1, overflowY: "auto", scrollbarWidth: "none" }),
        }}
        >
        {submittedActions.length === 0 && (
            <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.8rem", fontStyle: "italic", margin: 0 }}>
            No actions submitted yet.
            </p>
        )}
        {submittedActions.map(({ normalized, originalIndex }) => (
            <ActionItem key={normalized.id || originalIndex} action={normalized} onDelete={() => handleDelete(originalIndex)} />
        ))}
        </div>
        </div>
        </div>

        <div
        style={{
            alignItems: "center",
            backgroundColor: "rgba(0,0,0,0.2)",
            borderTop: "1px solid rgba(255,255,255,0.07)",
            display: "flex",
            gap: "0.5rem",
            padding: "0.75rem 1rem",
        }}
        >
        <div style={{ alignItems: "stretch", display: "flex", flex: 1, position: "relative" }}>
        <textarea
        ref={inputRef}
        className="actions-composer"
        // A phone's keyboard has no Shift+Enter to speak of.
        placeholder={isTouch ? "Enter your action…" : "Enter your action…  (Shift+Enter for a new line)"}
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
        onKeyDown={handleKeyDown}
        style={{
            background: "rgba(0,0,0,0.2)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "10px",
            boxSizing: "border-box",
            color: "white",
            fontFamily: "sans-serif",
            fontSize: "0.82rem",
            outline: "none",
            // Room on the right for the Improve button, bigger on a touch screen.
            padding: isTouch ? "0.7rem 3rem 0.7rem 0.85rem" : "0.7rem 2.8rem 0.7rem 0.85rem",
            resize: "vertical",
            transition: "border-color 0.2s",
            minHeight: "3rem",
            lineHeight: "1.45",
            overflowY: "auto",
            width: "100%",
        }}
        onFocus={(event) => {
            event.target.style.borderColor = "rgba(255,255,255,0.25)";
        }}
        onBlur={(event) => {
            event.target.style.borderColor = "rgba(255,255,255,0.12)";
        }}
        />
        <button
        type="button"
        className="oh-tap"
        onClick={isImproving ? handleStopImprove : handleImprove}
        title={isImproving ? "Stop generating" : "Improve action text"}
        aria-label={isImproving ? "Stop generating" : "Improve action text"}
        style={{
            alignItems: "center",
            background: "none",
            border: "none",
            borderRadius: "8px",
            color: isImproving || inputValue.trim() ? "#e4e4e7" : "rgba(255,255,255,0.45)",
            cursor: isImproving || inputValue.trim() ? "pointer" : "default",
            display: "flex",
            height: "1.8rem",
            justifyContent: "center",
            padding: 0,
            position: "absolute",
            // Finger-sized on a touch screen (.oh-tap), and tucked into the
            // corner so it stays inside the box at its smallest.
            right: isTouch ? "0.125rem" : "0.45rem",
            top: isTouch ? "0.125rem" : "0.55rem",
            width: "1.8rem",
        }}
        >
        {isImproving ? <StopIcon /> : <SparkleIcon />}
        </button>
        </div>

        <button
        type="button"
        className="oh-tap"
        onClick={handleSubmit}
        disabled={!inputValue.trim() || isSubmitting || isImproving}
        aria-label="Submit action"
        style={{
            alignItems: "center",
            background: inputValue.trim() && !isSubmitting && !isImproving ? "#3b82f6" : "rgba(59,130,246,0.3)",
            border: "none",
            borderRadius: "10px",
            color: "white",
            cursor: inputValue.trim() && !isSubmitting && !isImproving ? "pointer" : "not-allowed",
            display: "flex",
            flexShrink: 0,
            height: "2.2rem",
            justifyContent: "center",
            transition: "background 0.15s",
            width: "2.2rem",
        }}
        onMouseEnter={(event) => {
            if (inputValue.trim() && !isSubmitting && !isImproving) {
                event.currentTarget.style.background = "#2563eb";
            }
        }}
        onMouseLeave={(event) => {
            if (inputValue.trim() && !isSubmitting && !isImproving) {
                event.currentTarget.style.background = "#3b82f6";
            }
        }}
        >
        {isSubmitting ? <SpinnerRing size={14} /> : <SendIcon />}
        </button>
        </div>
        </div>
    );
};

const Actions = ({ onOpenAdvisor, hovered, setHovered, isOpen, onToggle }) => {
    const [hasOpened, setHasOpened] = React.useState(false);

    React.useEffect(() => {
        if (isOpen) {
            setHasOpened(true);
        }
    }, [isOpen]);

    return (
        <>
        {hasOpened && (
            <ActionsPanel
            isOpen={isOpen}
            onClose={onToggle}
            onOpenAdvisor={onOpenAdvisor}
            />
        )}
        <button
        type="button"
        title="Actions"
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
        <SparkleIcon />
        </button>
        </>
    );
};

export { Actions };
