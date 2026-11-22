/*! Open Historia — portions (panel sizing on small screens) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React from "react";
import { APP_HEIGHT, APP_HEIGHT_VAR, useCanHover, useTouchPrimary } from "../../runtime/mobileUi.js";
import { isComposerSendKey } from "../../runtime/composerKeys.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
import { logDebugEvent } from "../../runtime/debugLog.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";
import { assessGoalProgress, generateActionSuggestions, refinePlayerAction } from "../AI/gameplayLazy.js";
import { revertUnitOrder } from "../Map/unitsController.js";
import {
    buildActionDisplayText,
    normalizeActionEntry,
    mutateActionsState,
    readWorldState,
    writeWorldState,
} from "../../runtime/gameState.js";
import { PLAYER_GOAL_MAX_CHARS, playerGoalEntryOf, playerGoalOf, withPlayerGoal } from "../../runtime/playerGoal.js";
import { TURN_RUNNING_NOTE, isSimulationBusy } from "../AI/simulationStatus.js";
import { useTurnRunning } from "./useTurnRunning.js";
import { formatGameDateReadable } from "../../runtime/gameDates.js";
import { refreshRuntimeState, subscribeRuntime } from "../../runtime/runtimeStore.js";
import { inSharedGame, requestFromHost, sharedRoundPhase, subscribeSharedGameRole } from "../../multiplayer/client/sharedGameBridge.js";
import { orderRequestFor, rewordRequestFor } from "../../multiplayer/client/sharedOrders.js";
import { ORDER_MAX_CHARS, ORDER_TITLE_MAX } from "../../multiplayer/game/messages.js";
import { ORDER_GONE_NOTE, hasOwnTitle, orderEditBlock, queueOrderIn, removeOrderFrom, rewordOrderIn } from "../../runtime/actionEdit.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { uiString } from "../../runtime/translator.js";
import { useFailureReportButton } from "../../runtime/saveDebugLog.js";
import { queuedActionIds, seatAdviceKey, selectSavedSuggestions, suggestionsFellBack } from "./actionSuggestions.js";
import { refusedOrdersKey } from "./overdueOrders.js";
import { filedFateLabel } from "../../runtime/filedEvents.js";
import { ProjectsBoard, ProjectsTabIcon } from "./projects.jsx";
import { isKnownToPlayer, isProjectOpen } from "../../runtime/projects.js";
import {
    PANEL_HEIGHT_VAR,
    actionsLayoutReducer,
    clampPanelHeight,
    initialActionsLayout,
    keyedPanelHeight,
    openSectionOf,
    panelHeightCss,
    readGoalOpen,
    readPanelHeight,
    writeGoalOpen,
    writePanelHeight,
} from "./actionsPanelLayout.js";

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

// A change to the queue on this device, decided on the list as it is stored
// when it is written, in the game's one write order (runtime/actionEdit.js:
// never a whole list saved from what the panel last drew). `change(stored)`
// returns { next, outcome, ... }; resolves to that once written.
const commitActions = async (change) => {
    let result = { next: null, outcome: "" };
    await mutateActionsState((stored) => {
        result = change(Array.isArray(stored) ? stored : []);
        return result.next;
    });
    return result;
};

// Saves the diagnostics log with an AI failure attached at the top, or copies
// the failure alone while logging is off (runtime/saveDebugLog.js), as the
// advisor's report button does.
const FailureReportButton = ({ buildIncident }) => {
    const { busy, label, loggingOn, onClick } = useFailureReportButton({ buildIncident, copyIdleLabel: "Copy for a bug report" });
    return (
        <button
        type="button"
        className="oh-tap-row"
        disabled={busy}
        onClick={onClick}
        title={loggingOn
            ? "Saves the diagnostics log as a file, with this error's details at the top. Attach the file to your bug report."
            : "Copies this error's details. Diagnostics logging is off — turn it on in Settings → Diagnostics to save the full log instead."}
        style={{ background: "none", border: "1px solid rgba(251,191,36,0.3)", borderRadius: "6px", color: "#fde68a", cursor: busy ? "default" : "pointer", flexShrink: 0, fontSize: "0.7rem", fontWeight: 600, padding: "0.2rem 0.5rem" }}
        >
        {label}
        </button>
    );
};

// An amber line saying an AI answer is not the model's, with the report button
// when there is something to report.
const AiFailureNote = ({ children, incident }) => (
    <div role="status" style={{ alignItems: "center", color: "rgba(253,186,116,0.9)", display: "flex", flexWrap: "wrap", fontSize: "0.72rem", gap: "0.4rem", lineHeight: "1.45" }}>
    <span style={{ flex: "1 1 12rem", minWidth: 0 }}>{children}</span>
    {incident && <FailureReportButton buildIncident={() => incident} />}
    </div>
);

const aiFailureIncident = (kind, title, { reason = "", rawResponse = "" } = {}) => ({
    kind,
    title,
    fields: [
        ["Failure reason", reason || "(unknown)"],
        ...(rawResponse ? [["Raw model response", rawResponse]] : []),
    ],
});

// What the panel says when the queue could not be written.
const ORDER_NOT_SAVED = "Your order could not be saved, so the next time skip would not see it. Try again.";
const ORDER_NOT_REMOVED = "The order could not be removed, so the next time skip would still carry it out. Try again.";
const ORDER_NOT_CHANGED = "The order could not be changed, so the next time skip would carry out its old words. Try again.";
const ORDER_GONE = ORDER_GONE_NOTE;

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

// A queued troop order whose deletion undoes what it did to the map (#368).
const movesUnit = (action) => Boolean(action?.unitRevert) && (action.status ?? "planned") === "planned";

const PencilIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
);

// The order's fields as the editor shows them: its words always, a title of
// its own (an AI suggestion's, the advisor's) when it has one, and the opening
// line of a conversation it opens. A typed order's title is only its words cut
// short, and follows them (runtime/actionEdit.js).
const editDraftOf = (action) => ({
    title: hasOwnTitle(action) ? action.title : "",
    text: action.text || "",
    chatStarter: action.kind === "chat" ? action.chatStarter || "" : "",
});

const EDIT_FIELD_STYLE = {
    background: "var(--oh-ui-overlay-strong, rgba(0,0,0,0.2))",
    border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.15))",
    borderRadius: "8px",
    boxSizing: "border-box",
    color: "white",
    fontFamily: "sans-serif",
    fontSize: "0.82rem",
    lineHeight: "1.45",
    outline: "none",
    padding: "0.5rem 0.65rem",
    width: "100%",
};

const EDIT_LABEL_STYLE = { color: "rgba(255,255,255,0.5)", fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" };

const focusField = (event) => {
    event.target.style.borderColor = "var(--oh-ui-focus, rgba(255,255,255,0.25))";
};
const blurField = (event) => {
    event.target.style.borderColor = "var(--oh-ui-line, rgba(255,255,255,0.15))";
};

// The order, opened in place to be given other words: Save (or Enter, as in
// the composer) keeps them in the same order, Cancel (or Esc) leaves it as it
// was. `onSave(fields)` answers "" when it was kept, or why not.
const ActionEditor = ({ action, blocked, sharedGame, onSave, onCancel }) => {
    const [draft, setDraft] = React.useState(() => editDraftOf(action));
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState("");
    const textRef = React.useRef(null);
    const isTouch = useTouchPrimary();
    const original = React.useMemo(() => editDraftOf(action), [action]);
    const hasTitle = Boolean(original.title);
    const hasOpening = Boolean(original.chatStarter);

    React.useEffect(() => {
        const field = textRef.current;
        if (!field) return;
        field.focus();
        const end = field.value.length;
        field.setSelectionRange?.(end, end);
    }, []);

    const filled = draft.text.trim() && (!hasTitle || draft.title.trim()) && (!hasOpening || draft.chatStarter.trim());
    const changed = ["title", "text", "chatStarter"].some((key) => draft[key].trim() !== original[key].trim());
    const canSave = Boolean(filled) && !saving && !blocked;

    const save = async () => {
        if (!canSave) return;
        if (!changed) {
            onCancel();
            return;
        }
        setSaving(true);
        setError("");
        let refusal = "";
        try {
            refusal = await onSave({
                text: draft.text.trim(),
                ...(hasTitle ? { title: draft.title.trim() } : {}),
                ...(hasOpening ? { chatStarter: draft.chatStarter.trim() } : {}),
            });
        } catch (saveError) {
            console.error("Failed to edit the order:", saveError);
            refusal = ORDER_NOT_CHANGED;
        } finally {
            setSaving(false);
        }
        if (refusal) setError(refusal);
        else onCancel();
    };

    const cancel = () => {
        setError("");
        onCancel();
    };

    // Enter saves as it sends in the composer (Shift+Enter, or any Enter on a
    // touch screen, is a new line); a one-line field has no new line to make.
    const handleKeyDown = (event, { multiline = true } = {}) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
            return;
        }
        if (isComposerSendKey(event, { touch: multiline && isTouch })) {
            event.preventDefault();
            void save();
        }
    };

    const field = (key, label, { multiline = true, rows = 3, maxLength, ref } = {}) => {
        const Tag = multiline ? "textarea" : "input";
        return (
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {(hasTitle || hasOpening) && <span style={EDIT_LABEL_STYLE}>{label}</span>}
            <Tag
            ref={ref}
            className={multiline ? "actions-composer" : undefined}
            aria-label={label}
            {...(multiline ? { rows, enterKeyHint: "enter" } : { type: "text", enterKeyHint: "done" })}
            maxLength={maxLength}
            value={draft[key]}
            disabled={saving}
            onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
            onKeyDown={(event) => handleKeyDown(event, { multiline })}
            onFocus={focusField}
            onBlur={blurField}
            style={{ ...EDIT_FIELD_STYLE, ...(multiline ? { minHeight: "3rem", resize: "vertical" } : {}) }}
            />
            </label>
        );
    };

    const note = error || blocked;
    return (
        <div
        data-action-editing="true"
        style={{
            background: "var(--oh-ui-overlay-card, rgba(255,255,255,0.08))",
            border: "1px solid var(--oh-ui-accent, rgba(255,255,255,0.18))",
            borderRadius: "10px",
            display: "flex",
            flexDirection: "column",
            gap: "0.45rem",
            padding: "0.6rem 0.75rem",
        }}
        >
        {hasTitle && field("title", "Title", { multiline: false, maxLength: sharedGame ? ORDER_TITLE_MAX : undefined })}
        {field("text", "Order", { ref: textRef, maxLength: sharedGame ? ORDER_MAX_CHARS : undefined })}
        {hasOpening && field("chatStarter", "Opening line", { rows: 2, maxLength: sharedGame ? ORDER_MAX_CHARS : undefined })}
        <div style={{ alignItems: "center", display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
        <button type="button" className="oh-tap-row" onClick={cancel} style={goalButtonStyle(true)}>
        Cancel
        </button>
        <button type="button" className="oh-tap-row" disabled={!canSave} onClick={() => void save()} style={goalButtonStyle(canSave, "primary")}>
        {saving ? "Saving…" : "Save"}
        </button>
        </div>
        {note && (
            <span role="status" style={{ color: "rgba(253,186,116,0.9)", fontSize: "0.72rem", lineHeight: "1.45" }}>{note}</span>
        )}
        </div>
    );
};

// locked: an order that moved a unit on the map (unitRevert) cannot be deleted
// while a turn runs, because deleting it moves the unit back, and the turn's
// world write would put the unit where it was. Other orders can: the turn reads
// the queue again before it writes it.
// `editBlock`: why the order cannot be edited now (runtime/actionEdit.js
// orderEditBlock), or "". Editing it changes the same order, by its id, in its
// place (`onEdit(fields)`, which answers "" or why it was not kept).
// `refusal`: { fate, note } when the last time skip wrote an event for this
// order and the engine kept it off the timeline (overdueOrders.js).
const ActionItem = ({ action, onDelete, onEdit, editBlock = "", sharedGame = false, locked = false, refusal = null }) => {
    const [hovered, setHovered] = React.useState(false);
    const [editing, setEditing] = React.useState(false);
    // The ✎ and ✕ appear with the pointer over the row. Nothing hovers on a
    // touch screen, so there they are always shown, or an order could never
    // be edited or deleted.
    const canHover = useCanHover();
    const showControls = hovered || !canHover;
    const normalized = normalizeActionEntry(action);

    if (!normalized) {
        return null;
    }

    if (editing) {
        return (
            <ActionEditor
            action={normalized}
            blocked={editBlock}
            sharedGame={sharedGame}
            onSave={onEdit}
            onCancel={() => setEditing(false)}
            />
        );
    }

    const label = buildActionDisplayText(normalized);
    const showTitle = normalized.title && normalized.title !== label;
    const controlStyle = {
        alignItems: "center",
        border: "none",
        borderRadius: "6px",
        display: "flex",
        flexShrink: 0,
        lineHeight: 1,
        opacity: showControls ? 1 : 0,
        pointerEvents: showControls ? "auto" : "none",
        transition: "opacity 0.15s, color 0.15s, background 0.15s",
    };

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
        {/* The player's own order, as typed: never the interface's to translate. */}
        {showTitle && (
            <div data-no-translate style={{ color: "rgba(255,255,255,0.95)", fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.15rem" }}>
            {normalized.title}
            </div>
        )}
        <div data-no-translate style={{ color: "rgba(255,255,255,0.82)", fontSize: "0.82rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
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
        {/* Carried over unanswered (AI/playerFocus.js settleOrders): said, with
            why its event was refused when it was, and the ✕ withdraws it. */}
        {normalized.overdue && (
            <div style={{ color: "rgba(253,186,116,0.9)", fontSize: "0.7rem", lineHeight: "1.45", marginTop: "0.25rem" }}>
            <div>Overdue: the last time skip gave this order no outcome. The next one answers it first.</div>
            {refusal?.note && <div>{`${filedFateLabel(refusal.fate)}: ${refusal.note}`}</div>}
            </div>
        )}
        </div>
        <div style={{ alignItems: "center", display: "flex", flexShrink: 0, gap: "0.15rem" }}>
        <button
        type="button"
        className="oh-tap"
        data-action-edit="true"
        onClick={() => {
            if (!editBlock) setEditing(true);
        }}
        disabled={Boolean(editBlock)}
        title={editBlock || "Edit action"}
        aria-label="Edit action"
        style={{
            ...controlStyle,
            background: hovered && !editBlock ? "var(--oh-ui-hover, rgba(255,255,255,0.08))" : "none",
            color: editBlock ? "rgba(255,255,255,0.18)" : hovered ? "var(--oh-ui-accent, #2bc1f3)" : "rgba(255,255,255,0.6)",
            cursor: editBlock ? "not-allowed" : "pointer",
            padding: "0.22rem 0.3rem",
        }}
        >
        <PencilIcon />
        </button>
        <button
        type="button"
        className="oh-tap"
        onClick={onDelete}
        disabled={locked}
        title={locked ? TURN_RUNNING_NOTE : "Delete action"}
        aria-label="Delete action"
        style={{
            ...controlStyle,
            background: hovered && !locked ? "rgba(239,68,68,0.1)" : "none",
            color: locked ? "rgba(255,255,255,0.18)" : hovered ? "rgba(239,68,68,0.95)" : "rgba(239,68,68,0.8)",
            cursor: locked ? "not-allowed" : "pointer",
            fontSize: "1rem",
            padding: "0.18rem 0.3rem",
        }}
        >
        {"✕"}
        </button>
        </div>
        </div>
    );
};

// The caret of every collapsible part of the panel (the two lists and the
// standing goal), so the three read as one family.
const SectionCaret = ({ open }) => (
    <span aria-hidden="true" style={{ color: "rgba(255,255,255,0.5)", display: "inline-block", flexShrink: 0, fontSize: "0.7rem", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>{"\u25B6"}</span>
);

const SECTION_TITLE_STYLE = { fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" };

const SectionHeader = ({ title, count, open, onToggle }) => (
    <button
    type="button"
    className="oh-tap-row"
    aria-expanded={open}
    onClick={onToggle}
    style={{
        alignItems: "center",
        background: "none",
        border: "none",
        color: "rgba(255,255,255,0.9)",
        cursor: "pointer",
        display: "flex",
        flexShrink: 0,
        gap: "0.5rem",
        padding: "0.3rem 0",
        textAlign: "left",
        width: "100%",
    }}
    >
    <SectionCaret open={open} />
    <span style={{ ...SECTION_TITLE_STYLE, flex: 1 }}>{title}</span>
    <span data-no-translate style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem" }}>{count}</span>
    </button>
);

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
        // An order that is one sentence (an advisor's, actionSuggestions.js
        // seatAdviceTopic) is its own title: said once.
        const title = action.title && action.title !== action.text ? action.title : "";
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
            {(title || isQueued) && (
                <div style={{ fontSize: "0.76rem", fontWeight: 700 }}>
                {isQueued ? (title ? `✓ Queued — ${title}` : "✓ Queued") : title}
                </div>
            )}
            <div style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.74rem", lineHeight: "1.45", marginTop: "0.18rem" }}>
            {action.text}
            </div>
            </button>
        );
    })}
    </div>
    </div>
);

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

// How far the goal has come (gameplay.js assessGoalProgress): read on demand,
// since every reading is a request, and marked when a turn has passed since.
const GoalProgress = ({ country, round, turnRunning }) => {
    const stored = useRuntimeState("world", (world) => JSON.stringify(playerGoalEntryOf(world, country)?.progress ?? null), country);
    const progress = React.useMemo(() => JSON.parse(stored || "null"), [stored]);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const [open, setOpen] = React.useState(false);

    const assess = async () => {
        if (busy || turnRunning) return;
        setBusy(true);
        setError("");
        try {
            const reading = await assessGoalProgress();
            logDebugEvent("action", `Goal progress assessed: ${reading?.progress ?? "?"}/100`);
        } catch (assessError) {
            console.error("Failed to assess goal progress:", assessError);
            setError(String(assessError?.message || "The goal could not be assessed. Try again."));
        } finally {
            setBusy(false);
        }
    };

    const muted = { color: "rgba(255,255,255,0.55)", fontSize: "0.72rem" };
    if (!progress) {
        return (
            <div style={{ alignItems: "center", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
            <span style={muted}>{error || "How far has it come?"}</span>
            <button type="button" className="oh-tap-row" disabled={busy || turnRunning} onClick={() => void assess()} style={goalButtonStyle(!busy && !turnRunning)}>
            {busy ? "Assessing…" : "Assess progress"}
            </button>
            </div>
        );
    }

    const change = Number.isFinite(progress.previous) ? progress.progress - progress.previous : 0;
    const stale = progress.round && round && round > progress.round;
    const list = (title, items) => items.length > 0 && (
        <div>
        <span style={{ ...muted, fontWeight: 700 }}>{title}</span>
        <ul style={{ color: "rgba(255,255,255,0.78)", fontSize: "0.74rem", lineHeight: "1.45", margin: "0.15rem 0 0", paddingLeft: "1.1rem" }}>
        {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
        </div>
    );
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        <div style={{ alignItems: "center", display: "flex", gap: "0.5rem" }}>
        <div role="progressbar" aria-label="Goal progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.progress}
        style={{ background: "rgba(255,255,255,0.1)", borderRadius: "999px", flex: 1, height: "6px", overflow: "hidden" }}>
        <div style={{ background: "#7dd3fc", height: "100%", width: `${progress.progress}%` }} />
        </div>
        <span style={{ color: "rgba(255,255,255,0.9)", fontSize: "0.76rem", fontWeight: 700 }}>{progress.progress}%</span>
        {change !== 0 && <span style={{ color: change > 0 ? "#86efac" : "#fca5a5", fontSize: "0.72rem" }}>{change > 0 ? `+${change}` : change}</span>}
        <button type="button" className="oh-tap" disabled={busy || turnRunning} onClick={() => void assess()}
        title={turnRunning ? "A turn is running." : "Assess again"} aria-label="Assess progress again"
        style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", cursor: busy || turnRunning ? "not-allowed" : "pointer", fontSize: "0.8rem", padding: 0 }}>
        {busy ? "…" : "↻"}
        </button>
        </div>
        <button type="button" className="oh-tap" onClick={() => setOpen((value) => !value)} aria-expanded={open}
        style={{ background: "none", border: "none", color: "rgba(255,255,255,0.78)", cursor: "pointer", fontSize: "0.74rem", lineHeight: "1.45", padding: 0, textAlign: "left" }}>
        {progress.summary}
        </button>
        {open && (
            <>
            {list("Reached", progress.achieved)}
            {list("In the way", progress.obstacles)}
            {list("Next steps", progress.nextSteps)}
            </>
        )}
        <span style={muted}>
        {error || `As of ${progress.asOf || "an earlier turn"}${stale ? " — a turn has passed since; ↻ to update" : ""}. ${open ? "" : "Click the summary for details."}`}
        </span>
        </div>
    );
};

// The player's standing goal (runtime/playerGoal.js): the direction behind the
// orders. The advisor, the time skip and the suggestions are told it; a foreign
// leader never is. Locked while a turn runs, because the turn writes the world
// it lives in.
//
// `open` and `onToggle`: the card minimizes to its header row (the goal on one
// line and how far it has come), and the panel minimizes it whenever one of
// the order lists opens (actionsPanelLayout.js). Writing the goal always shows
// the whole card.
const StandingGoal = ({ country, round, gameDate, isOpen, open = true, onToggle }) => {
    const goal = useRuntimeState("world", (world) => playerGoalOf(world, country), country);
    const percent = useRuntimeState("world", (world) => {
        const value = Number(playerGoalEntryOf(world, country)?.progress?.progress);
        return Number.isFinite(value) ? value : null;
    }, country);
    const turnRunning = useTurnRunning(isOpen);
    const [editing, setEditing] = React.useState(false);
    const [draft, setDraft] = React.useState("");
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState("");
    const draftRef = React.useRef(null);
    const isTouch = useTouchPrimary();

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
            // In a shared game the host keeps the goal: it is asked to.
            // Its refusal is said here in the host's words: it was replaced by
            // "could not be saved. Try again." whatever the host said.
            if (inSharedGame()) {
                const answer = await requestFromHost("goal", { text: String(text || "").trim() });
                if (!answer.ok) {
                    setError(answer.error || "The goal could not be saved. Try again.");
                    return;
                }
                setEditing(false);
                return;
            }
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
        if (isComposerSendKey(event, { touch: isTouch })) {
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
            <div style={{ background: "var(--oh-ui-overlay-card, rgba(255,255,255,0.08))", border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.18))", borderRadius: "10px", display: "flex", flexDirection: "column", gap: "0.45rem", padding: "0.6rem 0.75rem" }}>
            {label}
            <textarea
            ref={draftRef}
            className="actions-composer"
            aria-label="Standing goal"
            maxLength={PLAYER_GOAL_MAX_CHARS}
            placeholder="What is your government steering toward? e.g. Keep out of the war and grow the economy"
            rows={2}
            value={draft}
            enterKeyHint="enter"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            style={{
                background: "var(--oh-ui-bg, rgba(0,0,0,0.25))",
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
            </button>
        );
    }

    return (
        <div style={{ background: "var(--oh-ui-overlay-card, rgba(255,255,255,0.08))", border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.15))", borderRadius: "10px", display: "flex", flexDirection: "column", flexShrink: 0, gap: "0.3rem", padding: open ? "0.55rem 0.75rem" : "0.35rem 0.75rem" }}>
        <div style={{ alignItems: "center", display: "flex", gap: "0.5rem" }}>
        {/* The header row, the whole of the card when it is minimized. */}
        <button
        type="button"
        className="oh-tap-row"
        aria-expanded={open}
        onClick={onToggle}
        title={open ? undefined : goal}
        style={{ alignItems: "center", background: "none", border: "none", color: "rgba(255,255,255,0.9)", cursor: "pointer", display: "flex", flex: 1, fontFamily: "sans-serif", gap: "0.5rem", minWidth: 0, padding: "0.15rem 0", textAlign: "left" }}
        >
        <SectionCaret open={open} />
        <span style={{ ...SECTION_TITLE_STYLE, flexShrink: 0 }}>Standing goal</span>
        {!open && (
            <span data-no-translate style={{ color: "rgba(255,255,255,0.72)", flex: 1, fontSize: "0.76rem", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{goal}</span>
        )}
        {!open && percent !== null && (
            <span data-no-translate style={{ color: "rgba(255,255,255,0.6)", flexShrink: 0, fontSize: "0.72rem", fontWeight: 700, marginLeft: "auto" }}>{`${percent}%`}</span>
        )}
        </button>
        <button
        type="button"
        className="oh-tap"
        disabled={turnRunning}
        onClick={startEditing}
        title={turnRunning ? lockedNote : "Change or clear the goal"}
        style={{ background: "none", border: "none", color: turnRunning ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.28)", cursor: turnRunning ? "not-allowed" : "pointer", flexShrink: 0, fontFamily: "sans-serif", fontSize: "0.74rem", padding: 0 }}
        >
        Edit
        </button>
        </div>
        {open && (
            <>
            <span title={goal} style={{ color: "rgba(255,255,255,0.82)", display: "-webkit-box", fontSize: "0.8rem", lineHeight: "1.45", overflow: "hidden", WebkitBoxOrient: "vertical", WebkitLineClamp: 3 }}>
            {"\u{1F3AF} "}{goal}
            </span>
            <GoalProgress country={country} round={round} turnRunning={turnRunning} />
            </>
        )}
        </div>
    );
};

// The panel's two tabs: the orders for this round, and the Projects &
// Operations board (projects.jsx), which had a launcher of its own until
// 2026-11-02: "on beta add the projects menu as a tab in the actions menu" (the
// owner). The tab strip is the diplomacy panel's (chat.jsx).
const ACTIONS_TABS = [
    ["actions", "Actions"],
    ["projects", "Projects"],
];

// The tab counts the open projects the player can see: other countries run
// their own now, and a covert one nobody has found must not show even as a number.
const NO_PROJECTS = [];
const selectProjects = (world) => (Array.isArray(world?.projects) ? world.projects : NO_PROJECTS);

const OrdersTabIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z" />
    <path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" />
    </svg>
);

const browserStorage = () => {
    try {
        return typeof window === "undefined" ? null : window.localStorage;
    } catch {
        return null;
    }
};

// The visible height (mobileUi.js APP_HEIGHT, which follows a phone's address
// bar and keyboard) and the root font size, in px, for the drag.
const screenMetrics = () => {
    if (typeof window === "undefined") return { viewport: 800, rem: 16 };
    const root = document.documentElement;
    const rem = parseFloat(getComputedStyle(root).fontSize) || 16;
    const viewport = parseFloat(root.style.getPropertyValue(APP_HEIGHT_VAR)) || window.innerHeight || 800;
    return { viewport, rem };
};

// The panel's top edge, the one that is free: the panel stands on the dock at
// the bottom of the screen, on a phone too. Drag it (mouse, finger or pen), or
// focus it and use the arrow keys (Shift for bigger steps, Home and End for the
// smallest and the tallest); a double-click or Enter gives back the default
// height. The grip is the advisor's and the country panel's edge (advisor.jsx),
// turned on its side. Pointer capture keeps the drag alive off the thin strip.
const PanelResizeHandle = ({ panelRef, height, onCommit, touch, shown = true }) => {
    const [dragging, setDragging] = React.useState(false);
    const [hover, setHover] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    const currentHeight = () => panelRef.current?.clientHeight || 0;

    const handlePointerDown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const target = event.currentTarget;
        try { target.setPointerCapture(event.pointerId); } catch { /* optional */ }
        const startY = event.clientY;
        const startHeight = currentHeight();
        const metrics = screenMetrics();
        let latest = null;
        setDragging(true);
        // Straight onto the panel while the pointer moves, and into React (and
        // storage) once, when it lets go.
        const onMove = (moveEvent) => {
            latest = clampPanelHeight(startHeight + (startY - moveEvent.clientY), metrics);
            panelRef.current?.style.setProperty(PANEL_HEIGHT_VAR, `${latest}px`);
        };
        const onUp = () => {
            setDragging(false);
            target.removeEventListener("pointermove", onMove);
            target.removeEventListener("pointerup", onUp);
            target.removeEventListener("pointercancel", onUp);
            if (latest !== null) onCommit(latest);
        };
        target.addEventListener("pointermove", onMove);
        target.addEventListener("pointerup", onUp);
        target.addEventListener("pointercancel", onUp);
    };

    const handleKeyDown = (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            onCommit(null);
            return;
        }
        const next = keyedPanelHeight(event.key, { current: currentHeight(), shift: event.shiftKey, ...screenMetrics() });
        if (next === null) return;
        event.preventDefault();
        onCommit(next);
    };

    const lit = dragging || focused;
    return (
        <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the Actions panel"
        aria-valuenow={height ?? undefined}
        tabIndex={shown ? 0 : -1}
        title="Drag to resize. Double-click for the default height."
        onPointerDown={handlePointerDown}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onDoubleClick={() => onCommit(null)}
        onKeyDown={handleKeyDown}
        // Lit for the keyboard's focus, not for the click that starts a drag.
        onFocus={(event) => {
            let keyboard = true;
            try { keyboard = event.currentTarget.matches(":focus-visible"); } catch { /* older engine: show it */ }
            setFocused(keyboard);
        }}
        onBlur={() => setFocused(false)}
        style={{
            alignItems: "center",
            cursor: "ns-resize",
            display: "flex",
            height: touch ? "10px" : "8px",
            justifyContent: "center",
            left: 0,
            outline: "none",
            position: "absolute",
            right: 0,
            top: 0,
            touchAction: "none",
            zIndex: 30,
        }}
        >
        <div style={{
            backgroundColor: lit ? "var(--oh-ui-accent, #2bc1f3)" : hover ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.22)",
            borderRadius: "2px",
            height: "3px",
            transition: "background-color 0.15s",
            width: "42px",
        }} />
        </div>
    );
};

// `requestedTab`: { tab } from outside (the advisor's board card opens the
// Projects tab); a new object each time, so the same tab can be asked for twice.
const ActionsPanel = ({ isOpen, onClose, onOpenAdvisor, mapRef, requestedTab = null }) => {
    const [tab, setTab] = React.useState("actions");
    // The board is drawn from the first time its tab is opened and then kept,
    // so its search and its ticked tags survive a look at the orders.
    const [boardOpened, setBoardOpened] = React.useState(false);
    const boardProjects = useRuntimeState("world", selectProjects);
    React.useEffect(() => {
        if (requestedTab?.tab === "actions" || requestedTab?.tab === "projects") setTab(requestedTab.tab);
    }, [requestedTab]);
    React.useEffect(() => {
        if (tab === "projects") setBoardOpened(true);
    }, [tab]);
    const [actions, setActions] = React.useState([]);
    const [inputValue, setInputValue] = React.useState("");
    const game = useRuntimeState("game", selectGameHeader);
    const country = game.country || "your nation";
    const projectCount = React.useMemo(
        () => boardProjects.filter((project) => isProjectOpen(project) && isKnownToPlayer(project, game.country)).length,
        [boardProjects, game.country],
    );
    // Full display name for the header, never the code.
    const countryDisplayName = useCountryDisplayName(country);
    const gameDate = game.gameDate
        ? formatGameDateReadable(game.gameDate, "MMMM Do, YYYY") || dayjs(game.gameDate).format("MMMM Do, YYYY")
        : "the current date";
    // The suggestions the game saved on the world (a time skip clears them), so
    // reopening the panel shows them again without spending a request.
    const suggestions = useRuntimeState("world", selectSavedSuggestions);
    // And in a shared game, the orders the round's own time skip brought from
    // this player's advisor, which cost nothing (actionSuggestions.js
    // seatAdviceTopic): first, as one more card.
    const sharedGame = inSharedGame();
    const adviceKey = useRuntimeState(
        "world",
        (world) => (sharedGame ? seatAdviceKey(world, game.country, game.round) : "null"),
        `${sharedGame}|${game.country}|${game.round}`,
    );
    const advice = React.useMemo(() => JSON.parse(adviceKey || "null"), [adviceKey]);
    const shownSuggestions = React.useMemo(() => (advice ? [advice, ...suggestions] : suggestions), [advice, suggestions]);
    const [hasRequestedSuggestions, setHasRequestedSuggestions] = React.useState(false);
    // Why the last press of the suggestions button got no list at all, and, when
    // it got the canned one instead, what the AI did (for the report button).
    const [suggestionError, setSuggestionError] = React.useState("");
    const [suggestionFallback, setSuggestionFallback] = React.useState(null);
    // Why the last Improve left the text as typed: { reason, rawResponse }.
    const [improveFailure, setImproveFailure] = React.useState(null);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const turnRunning = useTurnRunning(isOpen);
    // The host's round's phase in a shared game, which says whether an order
    // can be edited now (runtime/actionEdit.js orderEditBlock).
    const roundPhase = React.useSyncExternalStore(subscribeSharedGameRole, sharedRoundPhase, sharedRoundPhase);
    // Why the last change to the queue was not saved, until one is.
    const [saveError, setSaveError] = React.useState("");
    const [isImproving, setIsImproving] = React.useState(false);
    // Holds the in-flight improve's AbortController so the button can stop it,
    // the same shape as the timeline jump's cancel (time.jsx jumpAbortRef).
    const improveAbortRef = React.useRef(null);
    const [isSuggesting, setIsSuggesting] = React.useState(false);
    // Which order list is open, and whether the standing goal card is: one
    // state, because opening a list minimizes the card (actionsPanelLayout.js).
    // The card's state is kept for the next opening of the panel.
    const [layout, dispatchLayout] = React.useReducer(actionsLayoutReducer, undefined, () => initialActionsLayout(readGoalOpen(browserStorage())));
    React.useEffect(() => {
        writeGoalOpen(browserStorage(), layout.goalOpen);
    }, [layout.goalOpen]);
    const showSuggested = hasRequestedSuggestions || isSuggesting || shownSuggestions.length > 0;
    // The height the player dragged the panel to (null: the default), kept too.
    const panelRef = React.useRef(null);
    const [panelHeight, setPanelHeight] = React.useState(() => readPanelHeight(browserStorage()));
    const commitPanelHeight = React.useCallback((px) => {
        setPanelHeight(px);
        writePanelHeight(browserStorage(), px);
    }, []);
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
        setHasRequestedSuggestions(false);
        setSuggestionError("");
        setSaveError("");

        // Actions created/edited from OUTSIDE this panel (the advisor, chatting in
        // its own drawer) used to be invisible here until the panel was closed and
        // reopened. The store publishes those writes. Signature-gated so a
        // republish with no real change doesn't reset hover state on every row.
        // (Overdue too: a skip that answers an order leaves the rest as they
        // were in every other way, and the mark is what changed.)
        // (And an opening line, which an edit may change alone.)
        const actionsSignature = (list) => list.map((a) => `${a.id}:${a.title}:${a.text}:${a.chatStarter || ""}:${a.status}:${a.overdue === true ? "overdue" : ""}`).join("|");
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

    // Makes one change to the stored queue (commitActions) and answers what it
    // did, or null when it was not made (and why is said). The panel shows the
    // new list only once it is written: the time skip reads actions.json, not
    // this panel, so an order shown as queued but never written would be
    // dropped without a word. Nothing is put back from this closure on a
    // failure: the change was decided on what is stored, and the panel's list
    // follows the store.
    const persistChange = async (change, failureNote = ORDER_NOT_SAVED) => {
        let result;
        try {
            result = await commitActions(change);
        } catch (error) {
            console.error("Failed to save actions:", error);
            setSaveError(failureNote);
            return null;
        }
        if (result.outcome) {
            setSaveError(result.outcome);
            return null;
        }
        if (result.next) setActions(result.next);
        setSaveError("");
        return result;
    };

    // A card's order already in the queue shows as queued, restored cards too.
    const queuedSuggestionIds = React.useMemo(() => queuedActionIds(actions), [actions]);
    // Why the last skip's event for an overdue order was refused, by its id.
    const refusedKey = useRuntimeState("world", refusedOrdersKey);
    const refusedOrders = React.useMemo(() => JSON.parse(refusedKey || "{}"), [refusedKey]);

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
        dispatchLayout({ type: "open", section: "submitted", showSuggested });

        const nextAction = createManualAction(trimmed);
        if (!nextAction) {
            return;
        }

        setIsSubmitting(true);
        try {
            // In a shared game an order is the host's to queue; its answer comes
            // back in the next view.
            if (inSharedGame()) {
                const answer = await requestFromHost("order", orderRequestFor(nextAction, trimmed));
                // Refused: the order stays in the box, and the host's reason is said.
                if (!answer.ok) {
                    setSaveError(answer.error || ORDER_NOT_SAVED);
                    return;
                }
                setSaveError("");
                logDebugEvent("action", `Order sent to the host: ${nextAction.title || nextAction.text || "(untitled)"}`);
                setInputValue("");
                return;
            }
            // Not saved: the order stays in the box to try again.
            if (!(await persistChange((stored) => queueOrderIn(stored, nextAction)))) return;
            // What the player told their country to do is half of "the series of
            // events they did" — a turn that goes wrong usually goes wrong
            // BECAUSE of an order, and the diagnostics log is unreadable without
            // them. The text is short and the player wrote it, so it goes in
            // whole rather than as a length.
            logDebugEvent("action", `Order queued: ${nextAction.title || nextAction.text || "(untitled)"}`, {
                queued: actions.length + 1,
            });
            setInputValue("");
            setImproveFailure(null);
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
        setImproveFailure(null);
        const controller = new AbortController();
        improveAbortRef.current = controller;
        try {
            const refined = await refinePlayerAction(trimmed, { persist: false, signal: controller.signal });
            // The canned template is no improvement on what the player wrote:
            // their text stays, and the panel says the AI failed.
            if (refined?.source === "fallback") {
                setImproveFailure({ reason: refined.fallbackReason, rawResponse: refined.rawResponse });
                return;
            }
            const improvedText = refined?.action?.text || buildActionDisplayText(refined?.action) || trimmed;
            setInputValue(improvedText);
            inputRef.current?.focus();
        } catch (error) {
            // Stopping on purpose is not a failure, and it must leave the text the
            // player typed exactly as it was.
            if (error?.name !== "AbortError") {
                console.error("Failed to improve action:", error);
                setImproveFailure({ reason: error?.message || String(error) });
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
        let removed = actions[index];
        if (inSharedGame()) {
            const answer = await requestFromHost("unorder", { order: String(removed?.id || "") });
            setSaveError(answer.ok ? "" : answer.error || ORDER_NOT_REMOVED);
            return;
        }
        if (movesUnit(removed) && isSimulationBusy()) return;
        // Removed from the queue first: undoing the unit's move while the order
        // stays in actions.json would leave the skip acting on a move the map no
        // longer shows. By its id, and decided on the order as stored: whether
        // its move is undone follows what it is now (a skip may have carried it
        // out since the panel drew it).
        const done = await persistChange((stored) => {
            const taken = removeOrderFrom(stored, removed?.id);
            if (taken.removed && movesUnit(taken.removed) && isSimulationBusy()) return { next: null, outcome: TURN_RUNNING_NOTE };
            return taken;
        }, ORDER_NOT_REMOVED);
        if (!done) return;
        removed = done.removed;
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
    };

    // An order given other words, in its place and by its id: never deleted and
    // queued again, so it keeps its id, its place in the queue and whatever it
    // carries (a troop order's way back on the map, whom a conversation it opens
    // invites). In a shared game the host changes it, through the same door an
    // order is queued by ("reword", as the advisor's approved edits go), and
    // only while the round takes changes. Answers "" when kept, or why not.
    const handleEdit = async (id, fields) => {
        const current = actions.find((action) => String(action?.id || "") === String(id || ""));
        if (!current) return ORDER_GONE;
        const shared = inSharedGame();
        const block = orderEditBlock(current, { turnRunning: isSimulationBusy(), sharedGame: shared, roundPhase: sharedRoundPhase() });
        if (block) return block;
        if (shared) {
            const request = rewordRequestFor(current, fields);
            if (!request) return ORDER_GONE;
            const answer = await requestFromHost("reword", request);
            if (!answer.ok) return answer.error || ORDER_NOT_CHANGED;
            logDebugEvent("action", `Order edit sent to the host: ${fields?.title || fields?.text || "(untitled)"}`);
            return "";
        }
        // By its id, on the order as stored when it is written, and only if it
        // may still be changed then (a skip may have begun, or carried it out).
        let result;
        try {
            result = await commitActions((stored) => rewordOrderIn(stored, id, fields, { turnRunning: isSimulationBusy() }));
        } catch (error) {
            console.error("Failed to save the edited order:", error);
            return ORDER_NOT_CHANGED;
        }
        if (result.outcome) return result.outcome;
        if (!result.next) return "";
        setActions(result.next);
        setSaveError("");
        logDebugEvent("action", `Order edited: ${result.edited?.title || result.edited?.text || "(untitled)"}`);
        return "";
    };

    const handleQueueSuggestion = async (action) => {
        const queuedAction = normalizeSuggestionAction(action);
        if (!queuedAction) {
            // Malformed AI suggestion — say so instead of doing nothing.
            console.warn("[actions] suggestion could not be queued (no usable text):", action);
            return;
        }

        if (inSharedGame()) {
            // By the card's own id, so the card says it is queued and a second
            // press queues nothing more.
            const answer = await requestFromHost("order", orderRequestFor(queuedAction));
            setSaveError(answer.ok ? "" : answer.error || ORDER_NOT_SAVED);
            if (!answer.ok) return;
        } else if (!(await persistChange((stored) => queueOrderIn(stored, queuedAction)))) {
            // Not saved: the card stays unqueued, so it can be tried again.
            return;
        }
        // Visible click feedback: the suggestion button flips to "✓ Queued"
        // (queuedSuggestionIds, from the saved queue).
        logDebugEvent("action", `Suggested order queued: ${queuedAction.title || queuedAction.text || "(untitled)"}`);
    };

    const refreshSuggestions = async () => {
        if (isSuggesting) {
            return;
        }

        setHasRequestedSuggestions(true);
        dispatchLayout({ type: "open", section: "suggested", showSuggested });
        setIsSuggesting(true);
        setSuggestionError("");
        try {
            // Saved on the world, which is where the list above reads it from.
            const result = await generateActionSuggestions({ force: true });
            setSuggestionFallback(result?.source === "fallback"
                ? { reason: result.fallbackReason, rawResponse: result.rawResponse }
                : null);
        } catch (error) {
            console.error("Failed to generate suggestions:", error);
            setSuggestionError(error?.message || String(error));
        } finally {
            setIsSuggesting(false);
        }
    };

    const handleKeyDown = (event) => {
        if (isComposerSendKey(event, { touch: isTouch })) {
            event.preventDefault();
            handleSubmit();
        }
    };

    // One name whatever it is doing: the spinner beside it says it is working.
    const suggestionButtonLabel = "AI Suggestions";

    return (
        <div
        ref={panelRef}
        style={{
            backdropFilter: "blur(8px)",
            backgroundColor: "var(--oh-ui-bg, rgba(24, 24, 27, 0.95))",
            border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.1))",
            borderRadius: "16px",
            bottom: isOpen ? "4.25rem" : "-30rem",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
            color: "white",
            display: "flex",
            flexDirection: "column",
            fontFamily: "sans-serif",
            // By default, grow to use the height a taller screen offers (leaving
            // ~16rem for the top bar), never dropping below a usable 30rem floor
            // for laptops/phones. Dragged by its top edge, between 20rem and the
            // screen's height. Never past the 9rem the top UI needs (so it can't
            // overflow up) either way (actionsPanelLayout.js panelHeightCss). In
            // a variable, which the Projects tab sizes its tag menu by.
            [PANEL_HEIGHT_VAR]: panelHeightCss(panelHeight, APP_HEIGHT),
            height: `var(${PANEL_HEIGHT_VAR})`,
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
        <PanelResizeHandle panelRef={panelRef} height={panelHeight} onCommit={commitPanelHeight} touch={isTouch} shown={isOpen} />
        <div
        style={{
            alignItems: "center",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            display: "flex",
            gap: "0.5rem",
            justifyContent: "space-between",
            padding: isTouch ? "0.6rem 0.9rem 0.55rem" : "0.8rem 1rem 0.65rem",
        }}
        >
        <div role="tablist" style={{ display: "flex", gap: ".35rem", minWidth: 0, overflowX: "auto", scrollbarWidth: "none" }}>
        {ACTIONS_TABS.map(([key, label]) => {
            const active = tab === key;
            return (
                <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                className="oh-tap-row"
                onClick={() => setTab(key)}
                style={{ alignItems: "center", background: active ? "var(--oh-ui-active, var(--oh-grey-selected))" : "rgba(255,255,255,.025)", border: "1px solid " + (active ? "var(--oh-ui-accent, var(--oh-grey-border-strong))" : "rgba(255,255,255,.07)"), borderRadius: "8px", color: active ? "white" : "rgba(255,255,255,0.48)", cursor: "pointer", display: "flex", flex: "0 0 auto", fontFamily: "sans-serif", fontSize: ".8rem", fontWeight: 750, gap: ".38rem", padding: isTouch ? ".3rem .62rem" : ".36rem .74rem", whiteSpace: "nowrap" }}
                >
                <span aria-hidden="true" style={{ display: "inline-flex", opacity: .8 }}>{key === "projects" ? <ProjectsTabIcon /> : <OrdersTabIcon />}</span>
                <span>{label}</span>
                {key === "projects" && projectCount > 0 && (
                    <span data-no-translate style={{ alignItems: "center", background: active ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.08)", borderRadius: 999, color: active ? "#fff" : "rgba(255,255,255,0.6)", display: "inline-flex", fontSize: ".57rem", fontWeight: 800, height: "1.05rem", justifyContent: "center", minWidth: "1.05rem", padding: "0 .25rem" }}>{projectCount}</span>
                )}
                </button>
            );
        })}
        </div>
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

        {/* The Projects & Operations board, under the same header (projects.jsx). */}
        {boardOpened && (
            <div style={{ display: tab === "projects" ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0 }}>
            <ProjectsBoard isOpen={isOpen && tab === "projects"} onOpenAdvisor={onOpenAdvisor} mapRef={mapRef} />
            </div>
        )}

        {tab === "actions" && (
        <>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem", padding: "0.875rem 1.25rem", flex: 1, minHeight: 0, ...(scrollAsOne ? { overflowY: "auto", scrollbarWidth: "none" } : { overflow: "hidden" }) }}>

        <StandingGoal country={game.country} round={game.round} gameDate={game.gameDate} isOpen={isOpen} open={layout.goalOpen} onToggle={() => dispatchLayout({ type: "goal" })} />

        {/* Brainstorm and AI Suggestions side by side, to leave the room to the
            submitted actions (the owner, 2026-10-14). */}
        <div style={{ display: "flex", flexShrink: 0, gap: "0.5rem" }}>
        <button
        type="button"
        className="oh-tap-row"
        // Opens the Advisor primed with a starter message (in its input box, not
        // auto-sent) rather than blank — the advisor can create/edit/remove
        // queued actions right from that conversation (see advisor.jsx), so this
        // is the more direct route into the same plan-the-turn workflow the AI
        // suggestions above offer.
        onClick={() => onOpenAdvisor(uiString("Let's brainstorm a plan of concrete actions for this round. Ask me what I'm trying to accomplish, then propose specific ones we can queue."))}
        style={{
            background: "var(--oh-ui-overlay-card, rgba(255,255,255,0.05))",
            border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.2))",
            borderRadius: "10px",
            color: "#e4e4e7",
            cursor: "pointer",
            fontSize: "0.82rem",
            fontWeight: 500,
            letterSpacing: "0.01em",
            padding: "0.55rem 1rem",
            transition: "background 0.15s, border-color 0.15s",
            flex: "1 1 0",
            minWidth: 0,
        }}
        onMouseEnter={(event) => {
            event.currentTarget.style.background = "var(--oh-ui-hover, rgba(255,255,255,0.1))";
            event.currentTarget.style.borderColor = "var(--oh-ui-accent, rgba(255,255,255,0.28))";
        }}
        onMouseLeave={(event) => {
            event.currentTarget.style.background = "var(--oh-ui-overlay-card, rgba(255,255,255,0.05))";
            event.currentTarget.style.borderColor = "var(--oh-ui-line, rgba(255,255,255,0.2))";
        }}
        >
        Brainstorm
        </button>

        <button
        type="button"
        className="oh-tap-row"
        onClick={refreshSuggestions}
        style={{
            alignItems: "center",
            background: "var(--oh-ui-overlay-card, rgba(255,255,255,0.05))",
            border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.12))",
            borderRadius: "10px",
            color: "rgba(255,255,255,0.82)",
            cursor: "pointer",
            display: "flex",
            fontSize: "0.8rem",
            gap: "0.5rem",
            justifyContent: "center",
            padding: "0.52rem 1rem",
            transition: "background 0.15s, border-color 0.15s",
            flex: "1 1 0",
            minWidth: 0,
        }}
        onMouseEnter={(event) => {
            event.currentTarget.style.background = "var(--oh-ui-hover, rgba(255,255,255,0.09))";
            event.currentTarget.style.borderColor = "var(--oh-ui-accent, rgba(255,255,255,0.18))";
        }}
        onMouseLeave={(event) => {
            event.currentTarget.style.background = "var(--oh-ui-overlay-card, rgba(255,255,255,0.05))";
            event.currentTarget.style.borderColor = "var(--oh-ui-line, rgba(255,255,255,0.12))";
        }}
        >
        {isSuggesting && <SpinnerRing size={14} />}
        <span>{suggestionButtonLabel}</span>
        </button>
        </div>

        {(() => {
            const suggestedOpen = openSectionOf(layout.section, showSuggested) === "suggested";
            const submittedOpen = !suggestedOpen;
            const sectionStyle = (open) => ({
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                ...(scrollAsOne ? { flexShrink: 0 } : open ? { flex: 1, overflow: "hidden" } : { flexShrink: 0 }),
            });
            const listStyle = {
                display: "flex",
                flexDirection: "column",
                gap: "0.4rem",
                ...(scrollAsOne ? null : { flex: 1, minHeight: 0, overflowY: "auto", scrollbarWidth: "none" }),
            };
            return (
                <>
                {showSuggested && (
                    <div style={sectionStyle(suggestedOpen)}>
                    <SectionHeader title="Suggested Actions" count={shownSuggestions.length} open={suggestedOpen} onToggle={() => dispatchLayout({ type: "toggle", showSuggested })} />
                    {suggestedOpen && (
                        <div style={{ ...listStyle, gap: "0.5rem" }}>
                        {suggestionError && !isSuggesting && (
                            <AiFailureNote incident={aiFailureIncident("suggestions-error", "AI suggestions failed", { reason: suggestionError })}>
                            {`The AI suggestions could not be generated: ${suggestionError}`}
                            </AiFailureNote>
                        )}
                        {!suggestionError && hasRequestedSuggestions && !isSuggesting && suggestions.length === 0 && (
                            <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.78rem", fontStyle: "italic", margin: 0 }}>
                            No AI suggestions generated yet.
                            </p>
                        )}
                        {suggestionsFellBack(suggestions) && !isSuggesting && (
                            <AiFailureNote incident={suggestionFallback ? aiFailureIncident("suggestions-fallback", "AI suggestions fell back", suggestionFallback) : null}>
                            The AI gave no usable suggestions, so these are generic ones.
                            </AiFailureNote>
                        )}
                        {shownSuggestions.map((topic) => (
                            <SuggestionCard key={topic.id} topic={topic} onQueue={handleQueueSuggestion} queuedIds={queuedSuggestionIds} />
                        ))}
                        </div>
                    )}
                    </div>
                )}

                <div style={sectionStyle(submittedOpen)}>
                {showSuggested ? (
                    <SectionHeader title="Your Submitted Actions" count={submittedActions.length} open={submittedOpen} onToggle={() => dispatchLayout({ type: "toggle", showSuggested })} />
                ) : (
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
                )}
                {submittedOpen && (
                    <div style={listStyle}>
                    {submittedActions.length === 0 && (
                        <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.8rem", fontStyle: "italic", margin: 0 }}>
                        No actions submitted yet.
                        </p>
                    )}
                    {submittedActions.map(({ normalized, originalIndex }) => (
                        <ActionItem
                        key={normalized.id || originalIndex}
                        action={normalized}
                        refusal={refusedOrders[normalized.id] ?? null}
                        locked={turnRunning && movesUnit(normalized)}
                        editBlock={orderEditBlock(normalized, { turnRunning, sharedGame, roundPhase })}
                        sharedGame={sharedGame}
                        onEdit={(fields) => handleEdit(normalized.id, fields)}
                        onDelete={() => handleDelete(originalIndex)}
                        />
                    ))}
                    </div>
                )}
                </div>
                </>
            );
        })()}
        </div>

        {improveFailure && (
            <div style={{ padding: "0 1.25rem 0.5rem" }}>
            <AiFailureNote incident={aiFailureIncident("improve-failed", "Improve action failed", improveFailure)}>
            {improveFailure.reason
                ? `Improve failed, so your text was left as you wrote it: ${improveFailure.reason}`
                : "Improve failed, so your text was left as you wrote it."}
            </AiFailureNote>
            </div>
        )}

        {saveError && (
            <div role="alert" style={{ color: "rgba(253,186,116,0.9)", fontSize: "0.72rem", lineHeight: "1.45", padding: "0 1.25rem 0.5rem" }}>
            {saveError}
            </div>
        )}

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
        // In a shared game an order is held to what the host's request takes
        // (game/messages.js), the box and the request alike; single player's
        // are free text.
        maxLength={sharedGame ? ORDER_MAX_CHARS : undefined}
        value={inputValue}
        enterKeyHint="enter"
        onChange={(event) => setInputValue(event.target.value)}
        onKeyDown={handleKeyDown}
        style={{
            background: "var(--oh-ui-overlay-strong, rgba(0,0,0,0.2))",
            border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.15))",
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
            event.target.style.borderColor = "var(--oh-ui-focus, rgba(255,255,255,0.25))";
        }}
        onBlur={(event) => {
            event.target.style.borderColor = "var(--oh-ui-line, rgba(255,255,255,0.12))";
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
            color: isImproving || inputValue.trim() ? "var(--oh-ui-accent, #e4e4e7)" : "rgba(255,255,255,0.45)",
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
        {sharedGame && inputValue.length > ORDER_MAX_CHARS * 0.8 ? (
            <span aria-live="polite" style={{ bottom: "0.2rem", color: inputValue.length > ORDER_MAX_CHARS ? "#fca5a5" : "rgba(255,255,255,0.45)", fontSize: "0.55rem", pointerEvents: "none", position: "absolute", right: "0.4rem" }}>
            {`${inputValue.length}/${ORDER_MAX_CHARS}`}
            </span>
        ) : null}
        </div>

        <button
        type="button"
        className="oh-tap"
        onClick={handleSubmit}
        disabled={!inputValue.trim() || isSubmitting || isImproving}
        aria-label="Submit action"
        style={{
            alignItems: "center",
            background: inputValue.trim() && !isSubmitting && !isImproving ? "var(--oh-ui-active, #3b82f6)" : "var(--oh-ui-overlay-card, rgba(59,130,246,0.3))",
            border: "none",
            boxShadow: "inset 0 0 0 1px var(--oh-ui-accent, transparent)",
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
                event.currentTarget.style.background = "var(--oh-ui-hover, #2563eb)";
            }
        }}
        onMouseLeave={(event) => {
            if (inputValue.trim() && !isSubmitting && !isImproving) {
                event.currentTarget.style.background = "var(--oh-ui-active, #3b82f6)";
            }
        }}
        >
        {isSubmitting ? <SpinnerRing size={14} /> : <SendIcon />}
        </button>
        </div>
        </>
        )}
        </div>
    );
};

const Actions = ({ onOpenAdvisor, mapRef, requestedTab = null, hovered, setHovered, isOpen, onToggle }) => {
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
            mapRef={mapRef}
            requestedTab={requestedTab}
            />
        )}
        <button
        type="button"
        title="Actions and Projects"
        style={{
            alignItems: "center",
            background: isOpen
            ? "var(--oh-ui-glass-active, rgba(59,130,246,0.16))"
            : hovered
            ? "var(--oh-ui-glass-hover, rgba(255,255,255,0.08))"
            : "var(--oh-ui-glass-chip, rgba(255,255,255,0.04))",
            border: isOpen ? "1px solid var(--oh-ui-glass-active-line, rgba(96,165,250,0.34))" : "1px solid var(--oh-ui-glass-line, rgba(255,255,255,0.1))",
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
