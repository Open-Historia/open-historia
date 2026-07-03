/*! Open Historia — portions (panel sizing on small screens) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React from "react";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
import { JSON_URLS, readJson } from "../../runtime/assets.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";
import { generateActionSuggestions, refinePlayerAction } from "../AI/gameplay.js";
import {
    buildActionDisplayText,
    normalizeActionEntry,
    readActionsState,
    writeActionsState,
} from "../../runtime/gameState.js";

dayjs.extend(advancedFormat);

const ACTIONS_SPINNER_STYLE_ID = "actions-spinner-style";

const ensureSpinnerStyles = () => {
    if (typeof document === "undefined" || document.getElementById(ACTIONS_SPINNER_STYLE_ID)) {
        return;
    }

    const style = document.createElement("style");
    style.id = ACTIONS_SPINNER_STYLE_ID;
    style.textContent = `
    @keyframes actions-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    `;
    document.head.appendChild(style);
};

const SparkleIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2L13.5 9.5L21 11L13.5 12.5L12 20L10.5 12.5L3 11L10.5 9.5L12 2Z" />
    </svg>
);

const SendIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
);

const SpinnerRing = ({ size = 14, tone = "rgba(255,255,255,0.88)" }) => {
    React.useEffect(() => {
        ensureSpinnerStyles();
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
const loadActions = async () => readActionsState();

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
        onClick={onDelete}
        title="Delete action"
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
            opacity: hovered ? 1 : 0,
            padding: "0.18rem 0.3rem",
            pointerEvents: hovered ? "auto" : "none",
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
            disabled={isQueued}
            onClick={() => onQueue(action)}
            style={{
                background: isQueued ? "rgba(34,197,94,0.12)" : "rgba(109,40,217,0.12)",
                border: isQueued ? "1px solid rgba(74,222,128,0.35)" : "1px solid rgba(139,92,246,0.24)",
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

const ActionsPanel = ({ isOpen, onClose, onOpenAdvisor }) => {
    const [actions, setActions] = React.useState([]);
    const [inputValue, setInputValue] = React.useState("");
    const [country, setCountry] = React.useState("your nation");
    // Full display name for the header, never the code.
    const countryDisplayName = useCountryDisplayName(country);
    const [gameDate, setGameDate] = React.useState("the current date");
    const [suggestions, setSuggestions] = React.useState([]);
    const [queuedSuggestionIds, setQueuedSuggestionIds] = React.useState(() => new Set());
    const [hasRequestedSuggestions, setHasRequestedSuggestions] = React.useState(false);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [isImproving, setIsImproving] = React.useState(false);
    const [isSuggesting, setIsSuggesting] = React.useState(false);
    const inputRef = React.useRef(null);

    React.useEffect(() => {
        if (!isOpen) {
            return undefined;
        }

        let cancelled = false;
        setSuggestions([]);
        setHasRequestedSuggestions(false);

        loadActions().then((saved) => {
            if (!cancelled) {
                setActions(saved);
            }
        });

        const fetchGameData = () => {
            readJson(JSON_URLS.game, { defaultValue: {}, force: true })
            .then((data) => {
                if (cancelled) {
                    return;
                }

                if (data.country) {
                    setCountry(data.country);
                }

                if (data.gameDate) {
                    setGameDate(dayjs(data.gameDate).format("MMMM Do, YYYY"));
                }
            })
            .catch(() => {});
        };

        fetchGameData();
        const interval = setInterval(fetchGameData, 5000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [isOpen]);

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
        try {
            const refined = await refinePlayerAction(trimmed, { persist: false });
            const improvedText = refined?.text || buildActionDisplayText(refined) || trimmed;
            setInputValue(improvedText);
            inputRef.current?.focus();
        } catch (error) {
            console.error("Failed to improve action:", error);
        } finally {
            setIsImproving(false);
        }
    };

    const handleDelete = async (index) => {
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
            backgroundColor: "rgba(17, 24, 39, 0.95)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "16px",
            bottom: isOpen ? "4.25rem" : "-30rem",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
            color: "white",
            display: "flex",
            flexDirection: "column",
            fontFamily: "sans-serif",
            // Tall desktops keep the old size; laptops/phones get a usable 30rem
            // instead of the sliver calc(100vh - 33rem) left them.
            height: "min(calc(100vh - 9rem), max(calc(100vh - 33rem), 30rem))",
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
        onClick={onClose}
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

        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem", padding: "0.875rem 1.25rem", flex: 1, overflow: "hidden" }}>
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

        <button
        type="button"
        onClick={onOpenAdvisor}
        style={{
            background: "rgba(109, 40, 217, 0.15)",
            border: "1px solid rgba(139, 92, 246, 0.4)",
            borderRadius: "10px",
            color: "rgba(196, 165, 255, 0.95)",
            cursor: "pointer",
            fontSize: "0.82rem",
            fontWeight: 500,
            letterSpacing: "0.01em",
            padding: "0.55rem 1rem",
            transition: "background 0.15s, border-color 0.15s",
            width: "100%",
        }}
        onMouseEnter={(event) => {
            event.currentTarget.style.background = "rgba(109, 40, 217, 0.28)";
            event.currentTarget.style.borderColor = "rgba(139,92,246,0.65)";
        }}
        onMouseLeave={(event) => {
            event.currentTarget.style.background = "rgba(109, 40, 217, 0.15)";
            event.currentTarget.style.borderColor = "rgba(139,92,246,0.4)";
        }}
        >
        Help brainstorm actions
        </button>

        <button
        type="button"
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
                maxHeight: "13rem",
                overflowY: "auto",
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

        <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
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
            flex: 1,
            overflowY: "auto",
            scrollbarWidth: "none",
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
        <div style={{ alignItems: "center", display: "flex", flex: 1, position: "relative" }}>
        <input
        ref={inputRef}
        type="text"
        placeholder="Enter your action..."
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
            padding: "0.55rem 2.8rem 0.55rem 0.85rem",
            transition: "border-color 0.2s",
            width: "100%",
        }}
        onFocus={(event) => {
            event.target.style.borderColor = "rgba(139,92,246,0.5)";
        }}
        onBlur={(event) => {
            event.target.style.borderColor = "rgba(255,255,255,0.12)";
        }}
        />
        <button
        type="button"
        onClick={handleImprove}
        title="Improve action text"
        aria-label="Improve action text"
        style={{
            alignItems: "center",
            background: "none",
            border: "none",
            borderRadius: "8px",
            color: inputValue.trim() ? "rgba(196,165,255,0.78)" : "rgba(196,165,255,0.35)",
            cursor: inputValue.trim() ? "pointer" : "default",
            display: "flex",
            height: "1.8rem",
            justifyContent: "center",
            padding: 0,
            position: "absolute",
            right: "0.45rem",
            width: "1.8rem",
        }}
        >
        {isImproving ? <SpinnerRing size={14} tone="rgba(196,165,255,0.9)" /> : <SparkleIcon />}
        </button>
        </div>

        <button
        type="button"
        onClick={handleSubmit}
        disabled={!inputValue.trim() || isSubmitting || isImproving}
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
            ? "linear-gradient(145deg, rgba(109,40,217,0.4), rgba(76,29,149,0.4))"
            : hovered
            ? "linear-gradient(145deg, rgba(40,55,80,0.95), rgba(20,30,50,0.95))"
            : "linear-gradient(145deg, rgba(30,42,65,0.95), rgba(15,22,40,0.95))",
            border: hovered
            ? "1px solid rgba(255,255,255,0.2)"
            : isOpen
            ? "1px solid rgba(139,92,246,0.5)"
            : "1px solid rgba(255,255,255,0.1)",
            borderRadius: "10px",
            boxShadow: hovered
            ? "inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 8px rgba(0,0,0,0.4)"
            : "inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.3), 0 2px 6px rgba(0,0,0,0.35)",
            color: "white",
            cursor: "pointer",
            display: "flex",
            fontFamily: "sans-serif",
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
