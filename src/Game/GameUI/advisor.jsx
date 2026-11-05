/*! Open Historia — portions (drawer close/slide + mobile layout) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { useState, useRef, useEffect } from "react";
import { Chart, registerables } from "chart.js";
import { sendMessage, startChat, loadHistory } from "../AI/main.jsx";
import { requestDiplomaticChat } from "./chat.jsx";
import { JSON_URLS, readJson } from "../../runtime/assets.js";
import { formatReportFields, logDebugEvent } from "../../runtime/debugLog.js";
import { useFailureReportButton } from "../../runtime/saveDebugLog.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP, useTouchPrimary } from "../../runtime/mobileUi.js";
import { isComposerSendKey } from "../../runtime/composerKeys.js";
import { chatLanguageDiffersFromUi, chatTextDirection } from "../../runtime/i18n.js";
import { uiString } from "../../runtime/translator.js";
import { applyProjectOpsToWorld, mutateActionsState, mutateAdvisorState, mutateWorldState, normalizeActionEntry, readAdvisorMessages, viewAsSeen } from "../../runtime/gameState.js";
import { ADVISOR_RECIPIENT_TYPES, CHIEF_ADVISOR_THREAD, advisorContacts, advisorMessagesFor, advisorOfficeStatus, advisorRecipientType, archiveAdvisorContact, chiefAdvisorProfile, createAdvisorContact, politicalAdvisorOffices, replaceAdvisorThread, resetChiefAdvisorProfile, reviseAdvisorContact, saveChiefAdvisorProfile } from "../../runtime/advisorThreads.js";
import { getPoliticalProfile } from "../../runtime/politicalActors.js";
import StorageProblemNotice from "./storageProblemNotice.jsx";
import AdvisorRecipients from "./AdvisorRecipients.jsx";
import { describeReplyProblems, extractFencedJson, looksLikeProjectOps } from "./advisorBlocks.js";
import { actionProposalsFromReply, recordAdvisorActionReceipt } from "./advisorActionReview.js";
import { approveAdvisorAction } from "./advisorActionApproval.js";
import { applyAdvisorProjectProposal, canAdvisorApplyProjectOps } from "./advisorProjectRouting.js";
import { sentLetterDate, splitAtBlockquotes } from "./advisorDrafts.js";
import { repeatedOrder } from "../AI/playerFocus.js";
import { institutionDraftButtonLabel } from "./advisorInstitutionDrafts.js";
import { parseAdvisorReply } from "./advisorReply.js";
import { ADVISOR_SLIDE } from "./advisorSlide.js";
import Markdown, { MarkdownStyleInjector } from "./markdown.jsx";
import "./advisorDossier.css";
import { buildCatchUpNote } from "../AI/conversationCatchUp.js";
import { publicCharacterEvents } from "../AI/characterConversations.js";
import { splitAdvisorMemory, stripAdvisorMemory } from "../AI/advisorMemory.js";
import { commitWithVotingRuleBackfill } from "../AI/institutionGovernanceRetry.js";
import { gmChangesSince } from "../../runtime/gmChanges.js";
import { compareGameDates, formatGameDateReadable } from "../../runtime/gameDates.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { useUnseenEventIds } from "./useUnseenEvents.js";
import { commitInstitutionGovernanceCommand, commitInstitutionalPlayerProposal, commitInstitutionalPlayerVoteRequest } from "../../runtime/institutionalGovernance.js";
import { commitInstitutionLifecycleCommand } from "../../runtime/institutionLifecycle.js";
import { getLibraryState } from "../../runtime/library.js";
import { campaignChanged } from "../../runtime/campaignGuard.js";
import { TURN_RUNNING_NOTE, assertNoTurnRunning, isSimulationBusy } from "../AI/simulationStatus.js";
import { inSharedGame } from "../../multiplayer/client/sharedGameBridge.js";

Chart.register(...registerables);

// The drawer's width when the parent passes none; main.jsx keeps its own
// (ADVISOR_DEFAULT_WIDTH) and always passes one.
const ADVISOR_PANEL_WIDTH = "min(20rem, calc(100vw - 1rem))";

const ThinkingDots = () => {
    const [dots, setDots] = React.useState(0);
    useEffect(() => {
        const interval = setInterval(() => setDots(d => (d + 1) % 4), 500);
        return () => clearInterval(interval);
    }, []);
    return <span style={{ opacity: 0.6 }}>Thinking{".".repeat(dots)}&nbsp;</span>;
};

// extractFencedJson now lives in advisorBlocks.js so it can be unit-tested (this
// file cannot be — JSX, and it reaches maplibre-gl through assets.js).

// Taking a reply apart (its prose, and the chart, drafts, deployments and
// board edits in its fences) lives in advisorReply.js, where it is tested.

// M3C: Action blocks are saved as proposals on the reply. The player's
// explicit Proceed click is the only path to the canonical Actions writer.
// Saves the diagnostics log with this failure attached at the top, or copies
// the failure alone while logging is off (runtime/saveDebugLog.js).
const ReportButton = ({ buildIncident, tone = "rgba(255,255,255,0.2)", color = "rgba(255,255,255,0.6)" }) => {
    const { busy, label, loggingOn, onClick } = useFailureReportButton({ buildIncident, copyIdleLabel: "Copy for a bug report" });
    return (
        <button
        type="button"
        disabled={busy}
        onClick={onClick}
        title={loggingOn
            ? "Saves the diagnostics log as a file, with this error's details at the top. Attach the file to your bug report."
            : "Copies this error's details. Diagnostics logging is off — turn it on in Settings → Diagnostics to save the full log instead."}
        style={{ background: "none", border: `1px solid ${tone}`, borderRadius: "6px", color, cursor: busy ? "default" : "pointer", fontSize: "0.7rem", fontWeight: 600, padding: "0.2rem 0.5rem" }}
        >
        {label}
        </button>
    );
};

const RetryIcon = () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
    </svg>
);

// What the transport learned about a failure, as report fields — shown under
// "Show details" and attached to the saved log.
//
// Contains no API key and no endpoint host. It DOES contain model output — the
// tail of the reasoning and a few raw stream frames — because that is the part
// that actually explains a failure, and it can quote the campaign. The UI says
// so next to the details rather than letting someone post them somewhere public
// on the assumption that they are inert.
const errorReportFields = (message, diagnostics) => [
    ["Message", message],
    ...(diagnostics && typeof diagnostics === "object" ? Object.entries(diagnostics) : []),
];

// Shown under an advisor error. The message says what went wrong in plain
// English; this is the part that says WHY, in enough detail to act on.
//
// The Retry button is offered on the NEWEST error only (see the caller). Most
// advisor failures are the transport or an overloaded provider rather than
// anything about the question, and the transport already waits and retries once
// on its own before it gets here — so by this point the useful thing is a way to
// ask again without retyping, not more advice.
const AdvisorErrorDetails = ({ message, diagnostics, onRetry, retrying }) => {
    const [open, setOpen] = useState(false);
    const fields = errorReportFields(message, diagnostics);
    const hasDetail = Boolean(diagnostics && Object.keys(diagnostics).length > 0);

    return (
        <div style={{ marginTop: "0.5rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
        {onRetry && (
            <button type="button" onClick={onRetry} disabled={retrying}
            style={{ alignItems: "center", background: "rgba(239,68,68,0.14)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: "6px", color: "rgba(254,202,202,0.95)", cursor: retrying ? "default" : "pointer", display: "flex", fontSize: "0.7rem", fontWeight: 700, gap: "0.3rem", opacity: retrying ? 0.6 : 1, padding: "0.2rem 0.55rem" }}>
            <RetryIcon /> {retrying ? "Retrying…" : "Retry"}
            </button>
        )}
        <ReportButton
        buildIncident={() => ({ kind: "advisor-error", title: "Advisor reply failed", fields })}
        tone="rgba(239,68,68,0.45)"
        color="rgba(254,202,202,0.95)"
        />
        {hasDetail && (
            <button type="button" onClick={() => setOpen((value) => !value)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "6px", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "0.7rem", fontWeight: 600, padding: "0.2rem 0.5rem" }}>
            {open ? "Hide details" : "Show details"}
            </button>
        )}
        </div>
        {open && (
            <>
            <p style={{ margin: "0.4rem 0 0", fontSize: "0.64rem", lineHeight: 1.4, color: "rgba(255,255,255,0.35)" }}>
            No API key or endpoint is included. The model&apos;s own output is, so this may quote your campaign.
            </p>
            <pre data-no-translate style={{ margin: "0.35rem 0 0", padding: "0.5rem", background: "rgba(0,0,0,0.35)", borderRadius: "6px", color: "rgba(255,255,255,0.6)", fontSize: "0.64rem", lineHeight: 1.45, maxHeight: "12rem", overflow: "auto", userSelect: "text", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {formatReportFields(fields).join("\n")}
            </pre>
            </>
        )}
        </div>
    );
};

// Inline confirmation for what the advisor just did to the projects board. Same
// "advisor creates, I review" contract as the actions card below it: nothing the
// advisor changes happens silently.
const AdvisorProjectsCard = ({ items, onOpenProjects }) => {
    const counts = items.reduce((acc, item) => {
        acc[item.change] = (acc[item.change] ?? 0) + 1;
        return acc;
    }, {});
    const summary = ["opened", "updated", "completed", "closed", "deferred"]
        .filter((change) => counts[change])
        .map((change) => `${counts[change]} ${change}`)
        .join(", ");
    const verb = {
        opened: "Opened: ", updated: "Updated: ", completed: "Completed: ", closed: "Closed: ",
        deferred: "Awaiting the simulation: ",
    };

    return (
        <div style={{ marginTop: "0.75rem", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: "10px", padding: "0.65rem 0.8rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.76rem", fontWeight: 700, color: "rgba(191,219,254,0.95)" }}>🎯 Projects {summary}</span>
        {onOpenProjects && (
            <button type="button" onClick={onOpenProjects} style={{ background: "none", border: "1px solid rgba(59,130,246,0.5)", borderRadius: "6px", color: "rgba(191,219,254,0.9)", cursor: "pointer", fontSize: "0.7rem", fontWeight: 600, padding: "0.2rem 0.5rem" }}>
            Open Projects
            </button>
        )}
        </div>
        <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
        {items.map((item, index) => (
            <li key={index} data-no-translate style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
            {verb[item.change] || "Changed: "}{item.title}
            {item.change === "deferred" && (
                <span style={{ color: "rgba(252,211,77,0.9)" }}> — this one changes the world, so the next time skip enacts it</span>
            )}
            </li>
        ))}
        </ul>
        </div>
    );
};

// The other half of the receipt: what to show when the advisor plainly tried to
// change the board and the change did not land. Silence here is the worst
// outcome — the player sees a wall of JSON in the chat, the board stays empty,
// and nothing anywhere explains why. The overwhelmingly common cause is the
// reply hitting its token cap partway through a long array.
//
// "Ask for the next batch" puts this in the composer, in the interface's
// language (uiString): named, so the string catalog reads it whole.
const RETRY_PROJECTS_TEXT = "Continue putting my projects and operations on the board — the last reply was cut off. Pick up from where you stopped and skip anything already on the board. Send no more than ten, one sentence each. Only include efforts that genuinely appear in our history — if everything real is already on the board, just tell me that and add nothing.";

const AdvisorProjectsProblem = ({ kind, detail, excerpt, onRetry }) => {
    const [showExcerpt, setShowExcerpt] = useState(false);
    const message = kind === "truncated"
        ? "That reply was cut off partway through, so only the entries that arrived complete were added. Ask for the rest to continue the board."
        : kind === "truncated-empty"
            ? "That reply was cut off before a single entry finished, so nothing could be added. Ask again for a shorter batch — around ten at a time works."
            : kind === "partial"
                ? "Most of that batch went on the board. A few entries were written in a way that could not be read and were skipped — ask for those again."
                : "The advisor tried to change the board but its instructions could not be read, so nothing was applied. Asking again usually fixes it.";

    return (
        <div style={{ marginTop: "0.75rem", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: "10px", padding: "0.65rem 0.8rem" }}>
        <div style={{ fontSize: "0.76rem", fontWeight: 700, color: "rgba(253,230,138,0.95)" }}>⚠ Board not fully updated</div>
        <p style={{ margin: "0.3rem 0 0", fontSize: "0.75rem", lineHeight: 1.5, color: "rgba(255,255,255,0.75)" }}>{message}</p>
        {detail && (
            <p data-no-translate style={{ margin: "0.3rem 0 0", fontSize: "0.68rem", lineHeight: 1.45, color: "rgba(255,255,255,0.4)" }}>
            {detail}
            </p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
        {onRetry && (
            <button type="button" onClick={onRetry} style={{ background: "none", border: "1px solid rgba(245,158,11,0.5)", borderRadius: "6px", color: "rgba(253,230,138,0.95)", cursor: "pointer", fontSize: "0.7rem", fontWeight: 600, padding: "0.2rem 0.5rem" }}>
            Ask for the next batch
            </button>
        )}
        {excerpt && (
            <button type="button" onClick={() => setShowExcerpt((value) => !value)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "6px", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "0.7rem", fontWeight: 600, padding: "0.2rem 0.5rem" }}>
            {showExcerpt ? "Hide" : "Show"} what broke
            </button>
        )}
        {excerpt && (
            <ReportButton
            buildIncident={() => ({
                kind: "advisor-board",
                title: "Advisor's projects block could not be applied",
                fields: [["Problem", kind], ["Detail", detail], ["What broke", excerpt]],
            })}
            tone="rgba(245,158,11,0.5)"
            color="rgba(253,230,138,0.95)"
            />
        )}
        </div>
        {excerpt && showExcerpt && (
            <pre data-no-translate style={{ margin: "0.5rem 0 0", padding: "0.5rem", background: "rgba(0,0,0,0.35)", borderRadius: "6px", color: "rgba(255,255,255,0.6)", fontSize: "0.64rem", lineHeight: 1.45, maxHeight: "9rem", overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {excerpt}
            </pre>
        )}
        </div>
    );
};

// Historical inline confirmation for previously auto-applied Chief Actions —
// the "review" half of "advisor creates, I review": nothing here is silent.
const AdvisorActionsCard = ({ items, onOpenActions }) => {
    const counts = items.reduce((acc, item) => {
        acc[item.change] = (acc[item.change] ?? 0) + 1;
        return acc;
    }, {});
    const summary = ["added", "updated", "removed"]
        .filter((change) => counts[change])
        .map((change) => `${counts[change]} ${change}`)
        .join(", ");

    return (
        <div style={{ marginTop: "0.75rem", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "10px", padding: "0.65rem 0.8rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.76rem", fontWeight: 700, color: "#f4f4f5" }}>📋 Actions {summary}</span>
        {onOpenActions && (
            <button type="button" onClick={onOpenActions} style={{ background: "none", border: "1px solid rgba(255,255,255,0.25)", borderRadius: "6px", color: "#e4e4e7", cursor: "pointer", fontSize: "0.7rem", fontWeight: 600, padding: "0.2rem 0.5rem" }}>
            Open Actions
            </button>
        )}
        </div>
        <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
        {items.map((item, index) => (
            <li key={index} style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
            {item.change === "removed" ? "Removed: " : item.change === "updated" ? "Updated: " : "Added: "}{item.title}
            </li>
        ))}
        </ul>
        </div>
    );
};

// A proposed Action is NOT yet on the board. Only a human Proceed click may
// queue it. Each card owns its transient error/busy state; accepted receipts
// are stored on the originating message and survive campaign reload.
const AdvisorActionProposalCard = ({ proposal, receipt, onDiscuss, onProceed, onOpenActions, disabled }) => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const name = proposal.title || proposal.text || (proposal.operation === "remove" ? "Remove queued Action" : "Change queued Action");
    const label = proposal.operation === "remove" ? "Remove proposed Action"
        : proposal.operation === "edit" ? "Proposed Action change" : "Proposed Action";
    const confirmed = !!receipt;
    const proceed = async () => {
        if (busy || disabled || confirmed || !onProceed) return;
        setBusy(true);
        setError("");
        try {
            const result = await onProceed();
            if (!result?.ok) setError(result?.error || "The Action was not queued.");
        } catch (failure) {
            setError(failure?.message || "The Action was not queued.");
        } finally {
            setBusy(false);
        }
    };
    return (
        <div style={{ marginTop: "0.6rem", background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "9px", padding: "0.6rem 0.7rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
            <strong style={{ fontSize: "0.76rem" }}>📋 {label}</strong>
            <span style={{ fontSize: "0.67rem", color: confirmed ? "#86efac" : "#e4e4e7" }}>
                {confirmed ? (receipt.status === "queued" ? "Queued" : receipt.status === "updated" ? "Updated" : "Removed") : "Proposed"}
            </span>
        </div>
        <div style={{ fontSize: "0.78rem", fontWeight: 700, marginTop: "0.4rem" }} data-no-translate>{name}</div>
        {proposal.text && proposal.text !== name && (
            <div data-no-translate style={{ fontSize: "0.73rem", opacity: 0.77, marginTop: "0.3rem" }}>{proposal.text}</div>
        )}
        {proposal.targetId && (
            <div style={{ fontSize: "0.65rem", opacity: 0.55, marginTop: "0.3rem" }}>Existing Action: <span data-no-translate>{proposal.targetId}</span></div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.4rem", marginTop: "0.6rem", flexWrap: "wrap" }}>
        {confirmed ? (
            onOpenActions && <button type="button" onClick={onOpenActions} style={{ border: "1px solid rgba(255,255,255,0.22)", borderRadius: "7px", background: "transparent", color: "#e4e4e7", padding: "0.3rem 0.55rem", cursor: "pointer" }}>Open Actions</button>
        ) : (
            <>
            <button type="button" disabled={busy || disabled} onClick={onDiscuss} style={{ border: "1px solid rgba(255,255,255,0.25)", borderRadius: "7px", background: "transparent", color: "#e4e4e7", padding: "0.3rem 0.55rem", cursor: busy || disabled ? "default" : "pointer" }}>Discuss</button>
            <button type="button" disabled={busy || disabled} onClick={proceed} style={{ border: "1px solid rgba(147,197,253,0.6)", borderRadius: "7px", background: "rgba(59,130,246,0.22)", color: "#dbeafe", padding: "0.3rem 0.55rem", cursor: busy || disabled ? "default" : "pointer" }}>{busy ? "Queueing…" : proposal.operation === "remove" ? "Proceed / Remove" : "Proceed / Queue"}</button>
            </>
        )}
        </div>
        {confirmed && <div style={{ fontSize: "0.68rem", marginTop: "0.35rem", color: "rgba(255,255,255,0.65)" }}>Confirmed by Actions board. Execution still requires game-time resolution.</div>}
        {error && <div role="alert" style={{ fontSize: "0.72rem", color: "#fca5a5", marginTop: "0.4rem" }}>{error}</div>}
        </div>
    );
};

// Puts the drafted letter in the recipient's diplomacy composer. It does NOT
// send it, deliberately: the player reads it over in the chat window, edits it
// if they want, and presses send there.
//
// It used to send — writing the letter AND generating the reply in one click,
// which meant a long wait on a button that said "Sending…", and a message the
// player never got to look at before it was in front of a foreign government.
// The button is a hand-off now, so it returns immediately and there is nothing
// to fail: at worst the chat opens with the text waiting in it.
const AdvisorDraftSend = ({ draft, onDraft }) => {
    const [handedOff, setHandedOff] = useState(false);
    // The same letter already in the chat with that country (advisorDrafts.js):
    // the advisor re-drafts letters the player has sent, and nothing said so.
    const sentOn = useRuntimeState("chat", (chats) => sentLetterDate(draft, chats));
    const resetTimer = useRef(null);

    useEffect(() => () => clearTimeout(resetTimer.current), []);

    const handleClick = () => {
        onDraft();
        setHandedOff(true);
        // Back to the plain label after a moment — the draft can be handed over
        // again (the player may have cleared the composer, or want it back).
        clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setHandedOff(false), 3000);
    };

    return (
        <div>
        <button type="button" onClick={handleClick} style={{
            display: "flex", alignItems: "center", gap: "0.4rem",
            background: handedOff ? "rgba(52,211,153,0.12)" : "rgba(59,130,246,0.16)",
            border: `1px solid ${handedOff ? "rgba(52,211,153,0.4)" : "rgba(59,130,246,0.45)"}`,
            borderRadius: "8px",
            color: handedOff ? "rgba(167,243,208,0.95)" : "rgba(191,219,254,0.95)",
            cursor: "pointer",
            fontFamily: "sans-serif", fontSize: "0.76rem", fontWeight: 600, padding: "0.35rem 0.65rem",
            textAlign: "left",
        }}>
        {handedOff ? "✓ In Diplomacy — press send there" : `✉️ Draft to ${draft.targetType === "institution-council" ? `Council · ${draft.institutionId}` : draft.targetType === "institution-lifecycle" ? `hearing · ${draft.country || draft.institutionId}` : draft.country}`}
        </button>
        {sentOn && (
            <div style={{ color: "rgba(253,230,138,0.9)", fontFamily: "sans-serif", fontSize: "0.7rem", marginTop: "0.25rem" }}>
            Already sent to {draft.country}{sentOn === "earlier" ? "" : ` on ${formatGameDateReadable(sentOn) || sentOn}`}.
            </div>
        )}
        </div>
    );
};

// One recommended deployment, placed with a click. Deliberately routed through
// the SAME deployUnit the Forces panel calls, so a unit the advisor places and
// one the player places by hand are indistinguishable to the engine: both land
// as a translucent pending unit with a queued order for the AI to adjudicate.
const AdvisorDeployPlace = ({ deployment, placed, onPlace }) => {
    const [status, setStatus] = useState(placed ? "placed" : "idle");
    const [error, setError] = useState("");

    useEffect(() => { if (placed) setStatus("placed"); }, [placed]);

    const handleClick = async () => {
        if (status !== "idle") return;
        setStatus("placing");
        setError("");
        const result = await onPlace();
        setStatus(result?.ok ? "placed" : "idle");
        if (!result?.ok) setError(result?.error || "The unit could not be placed. Try again.");
    };

    const busy = status !== "idle";
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <button type="button" onClick={handleClick} disabled={busy} style={{
            display: "flex", alignItems: "center", gap: "0.4rem",
            background: status === "placed" ? "rgba(52,211,153,0.12)" : "rgba(255,255,255,0.06)",
            border: `1px solid ${status === "placed" ? "rgba(52,211,153,0.4)" : "rgba(255,255,255,0.23)"}`,
            borderRadius: "8px",
            color: status === "placed" ? "rgba(167,243,208,0.95)" : "#f4f4f5",
            cursor: busy ? "default" : "pointer",
            fontFamily: "sans-serif", fontSize: "0.76rem", fontWeight: 600, padding: "0.35rem 0.65rem",
        }}>
        {status === "placed"
            ? `✓ ${deployment.name} placed`
            : status === "placing"
                ? `Placing ${deployment.name}…`
                : `📍 Place ${deployment.name} here`}
        </button>
        {error && <span role="alert" style={{ color: "#fca5a5", fontSize: "0.7rem", lineHeight: 1.35 }}>{error}</span>}
        </div>
    );
};


// A formal institution action the Advisor recommends. The model only prepares
// this typed draft; nothing canonical happens until the human clicks here. The
// click then goes through the same native commit functions as Institutions UI,
// so current membership, lifecycle, proposal and ballot rules are revalidated.
const AdvisorInstitutionDraftAction = ({ draft, completed, onExecute }) => {
    const [status, setStatus] = useState(completed ? "completed" : "idle");
    const [error, setError] = useState("");

    useEffect(() => { if (completed) setStatus("completed"); }, [completed]);

    const handleClick = async () => {
        if (status !== "idle") return;
        setStatus("working");
        setError("");
        const result = await onExecute();
        if (result?.ok) setStatus("completed");
        else {
            setStatus("idle");
            setError(result?.error || "The institution action could not be completed.");
        }
    };

    const detail = draft.type === "table-proposal"
        ? draft.title
        : draft.type === "vote"
            ? `${draft.proposalId} · ${String(draft.choice || "").toUpperCase()}`
            : draft.type === "submit-proposal"
                ? draft.proposalId
                : `${draft.polity} · ${draft.requestedStatus}`;
    const busy = status !== "idle";

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <button type="button" onClick={handleClick} disabled={busy} title={detail} style={{
            display: "flex", alignItems: "center", gap: "0.4rem",
            background: status === "completed" ? "rgba(52,211,153,0.12)" : "rgba(245,158,11,0.13)",
            border: `1px solid ${status === "completed" ? "rgba(52,211,153,0.4)" : "rgba(245,158,11,0.42)"}`,
            borderRadius: "8px",
            color: status === "completed" ? "rgba(167,243,208,0.95)" : "rgba(253,230,138,0.95)",
            cursor: busy ? "default" : "pointer",
            fontFamily: "sans-serif", fontSize: "0.76rem", fontWeight: 600, padding: "0.35rem 0.65rem",
            textAlign: "left",
        }}>
        {status === "completed"
            ? `✓ ${institutionDraftButtonLabel(draft)}`
            : status === "working"
                ? "Applying institution action…"
                : `🏛️ ${institutionDraftButtonLabel(draft)}`}
        </button>
        {error && <span style={{ color: "#fca5a5", fontSize: "0.7rem", lineHeight: 1.35 }}>{error}</span>}
        </div>
    );
};

const CHART_COLORS = ["#60a5fa","#34d399","#f472b6","#fbbf24","#94a3b8","#f87171","#38bdf8"];

const AdvisorChart = ({ config }) => {
    const canvasRef = useRef(null);
    const chartRef  = useRef(null);
    const isCartesian     = config.type !== "pie" && config.type !== "doughnut";
    const isPieOrDoughnut = config.type === "pie"  || config.type === "doughnut";
    const isPercent       = config.options?.unit === "percent";

    const coloredConfig = {
        ...config,
        data: {
            ...config.data,
            datasets: config.data.datasets.map((ds, i) => {
                const color     = CHART_COLORS[i % CHART_COLORS.length];
                const pieColors = (config.data.labels || []).map((_, j) => CHART_COLORS[j % CHART_COLORS.length]);
                return {
                    borderColor:      isPieOrDoughnut ? undefined : color,
                    backgroundColor:  isPieOrDoughnut ? pieColors : config.type === "line" ? `${color}26` : color,
                    borderWidth: 2,
                    pointRadius:      config.type === "line" ? 3 : undefined,
                    pointHoverRadius: config.type === "line" ? 5 : undefined,
                    tension:          config.type === "line" ? 0.4 : undefined,
                    ...ds,
                };
            }),
        },
    };

    const legendItems = (() => {
        if (!coloredConfig?.data?.datasets) return [];
        if (isPieOrDoughnut) {
            const labels = coloredConfig.data.labels || [];
            const colors = coloredConfig.data.datasets[0]?.backgroundColor || [];
            return labels.map((label, i) => ({ label, color: Array.isArray(colors) ? colors[i] : CHART_COLORS[i % CHART_COLORS.length] }));
        }
        return coloredConfig.data.datasets.map((ds, i) => ({
            label: ds.label || "",
            color: Array.isArray(ds.borderColor) ? ds.borderColor[0] : ds.borderColor || CHART_COLORS[i % CHART_COLORS.length],
        }));
    })();

    useEffect(() => {
        if (!canvasRef.current) return;
        if (chartRef.current) chartRef.current.destroy();
        const ctx = canvasRef.current.getContext("2d");
        chartRef.current = new Chart(ctx, {
            ...coloredConfig,
            options: {
                ...coloredConfig.options,
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 4, bottom: 4 } },
                plugins: {
                    ...coloredConfig.options?.plugins,
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: "rgba(17,17,19,0.95)",
                                     borderColor: "rgba(255,255,255,0.12)", borderWidth: 1,
                                     titleColor: "rgba(255,255,255,0.85)", bodyColor: "rgba(255,255,255,0.6)",
                                     padding: 10, cornerRadius: 8,
                                     ...coloredConfig.options?.plugins?.tooltip,
                                     callbacks: {
                                         label: (ctx) => ` ${ctx.parsed.y ?? ctx.parsed}${isPercent ? "%" : ""}`,
                                     ...coloredConfig.options?.plugins?.tooltip?.callbacks,
                                     },
                    },
                },
                scales: isCartesian ? {
                    x: { ticks: { color: "rgba(255,255,255,0.45)", font: { size: 10, family: "sans-serif" } }, grid: { color: "rgba(255,255,255,0.06)" }, border: { color: "rgba(255,255,255,0.08)" }, ...coloredConfig.options?.scales?.x },
                                     y: { ticks: { color: "rgba(255,255,255,0.45)", font: { size: 10, family: "sans-serif" }, callback: val => `${val}${isPercent ? "%" : ""}` }, grid: { color: "rgba(255,255,255,0.06)" }, border: { color: "rgba(255,255,255,0.08)" }, ...coloredConfig.options?.scales?.y },
                } : undefined,
            },
        });
        return () => { if (chartRef.current) chartRef.current.destroy(); };
    }, [config]);

    return (
        <div style={{ marginTop: "0.75rem", width: "100%", boxSizing: "border-box" }}>
        {legendItems.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem 0.85rem", marginBottom: "0.5rem" }}>
            {legendItems.map((item, i) => (
                <span key={i} style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.72rem", color: "rgba(255,255,255,0.5)" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: item.color || "#60a5fa", flexShrink: 0 }} />
                {item.label}
                </span>
            ))}
            </div>
        )}
        <div style={{ position: "relative", width: "100%", height: "175px" }}>
        <canvas ref={canvasRef} />
        </div>
        </div>
    );
};

// The saved conversation could not be read: nothing is saved until it is, as
// the list in hand is not the player's. Module-level, like the saves that check
// it, which run from callbacks with no component state in reach; and each
// save's result goes to the panel for its "not saved" strip.
let advisorLoadFailed = false;
let onAdvisorSaveResult = null;

const saveMessages = async (messages, threadId = CHIEF_ADVISOR_THREAD, options = {}) => {
    if (advisorLoadFailed) return false;
    try {
        // The turn may be posting documents to this same file. Merge inside
        // its canonical write queue, modifying *only* this recipient's messages.
        await mutateAdvisorState((stored) => replaceAdvisorThread(stored, threadId, messages, options));
        onAdvisorSaveResult?.(true);
        return true;
    } catch (err) {
        console.error("Failed to save advisor conversation:", err);
        onAdvisorSaveResult?.(false);
        return false;
    }
};

// null when the read FAILED, never []: an empty conversation here would be
// saved over the real one by the next message.
const loadMessages = async () => {
    try {
        const saved = await readAdvisorMessages();
        advisorLoadFailed = false;
        return saved;
    } catch (err) {
        advisorLoadFailed = true;
        logDebugEvent("advisor", "The advisor conversation could not be loaded; nothing is saved until it is.", err, { problem: true });
        return null;
    }
};

// An advisor reply's prose, with each drafted letter's Send button rendered
// immediately under the letter it would send.
//
// The buttons used to be collected at the bottom of the message. In a reply that
// drafts one letter and then goes on to say three other things — or drafts two —
// that put "Send message to France" a long way from the France letter, and with
// two of them side by side there was nothing on the button to say which quote it
// belonged to. Here the pairing is positional and visible.
//
// A reply with no drafts renders as ONE markdown block, exactly as before: the
// split is only worth its cost when there is something to interleave.
// `written`: the advisor's own words, in the player's language already, so the
// interface translator leaves them alone (the draft buttons between them are
// interface, and are translated).
const AdvisorReplyBody = ({ text, drafts, onDraftMessage, written = false }) => {
    if (!drafts || drafts.length === 0) {
        return <Markdown className="advisor-markdown" written={written}>{text}</Markdown>;
    }

    const byQuote = new Map();
    drafts.forEach((draft, draftIndex) => {
        if (!Number.isInteger(draft.quoteIndex)) return;
        byQuote.set(draft.quoteIndex, [...(byQuote.get(draft.quoteIndex) ?? []), { draft, draftIndex }]);
    });

    const placed = new Set();
    const button = ({ draft, draftIndex }) => {
        placed.add(draftIndex);
        return (
            <AdvisorDraftSend
            key={`draft-${draftIndex}`}
            draft={draft}
            onDraft={() => onDraftMessage(draft)}
            />
        );
    };

    const segments = splitAtBlockquotes(text);
    const rendered = segments.map((segment, index) => (
        <React.Fragment key={index}>
        <Markdown className="advisor-markdown" written={written}>{segment.content}</Markdown>
        {segment.type === "quote" && (byQuote.get(segment.quoteIndex) ?? []).map(button)}
        </React.Fragment>
    ));

    // A draft whose quote is not in the rendered text — an older saved message
    // carrying an explicit "text" field, or a reply whose blockquote was lost to
    // a stripped fence. Never drop the button; fall back to the old position.
    const orphans = drafts
        .map((draft, draftIndex) => ({ draft, draftIndex }))
        .filter(({ draftIndex }) => !placed.has(draftIndex));

    // gap matches the 0.5rem a paragraph carries, so the interleaved blocks
    // still read as one continuous reply.
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {rendered}
        {orphans.map(button)}
        </div>
    );
};

// The moment the player is asking from: the events they have been shown and the
// date of the last of them — while a skip is being revealed, the reveal's front,
// not the end of the finished turn (runtime/unseenEvents.js, gameState.js
// viewAsSeen). The question is dated there, so the next one's catch-up picks up
// what the rest of the reveal showed.
const readSeenMoment = async (gameDate) => {
    try {
        const [events, world] = await Promise.all([
            readJson(JSON_URLS.events, { defaultValue: [] }),
            readJson(JSON_URLS.world, { defaultValue: {}, clone: false }),
        ]);
        const seen = await viewAsSeen({ world, events, game: { gameDate } });
        return { events: seen.events, world, date: seen.game?.gameDate || gameDate || "" };
    } catch {
        return { events: [], world: {}, date: gameDate || "" };
    }
};

// What the world did since the conversation last spoke (AI/conversationCatchUp.js):
// the time that passed, the newest events since, and the Game Master's changes by
// hand. A fresh conversation has nothing to catch up on — it reads the present.
// A note that cannot be built is no note: the question still goes.
const buildAdvisorCatchUp = async (messages, moment, { publicOnly = false } = {}) => {
    const previous = [...(Array.isArray(messages) ? messages : [])].reverse()
        .find((msg) => (msg.role === "user" || msg.role === "advisor") && !msg.streaming);
    if (!previous) return { text: "", label: "" };
    try {
        const { events, world, date } = moment;
        return buildCatchUpNote({
            previousDate: previous.time || "",
            currentDate: date || "",
            // Character contacts get PUBLIC timeline changes only. Private
            // Game Master edits, scoped intelligence events and receipts are
            // never injected through a system-side catch-up message.
            events: publicOnly ? publicCharacterEvents(events, { gameDate: date }) : events,
            gmChanges: publicOnly ? [] : previous.at ? gmChangesSince(world, previous.at) : [],
            // The advisor's receipt for its own last reply: a chart not drawn, a
            // block that half landed.
            replyProblems: !publicOnly && previous.role === "advisor" ? describeReplyProblems(previous) : [],
            compareDates: compareGameDates,
            formatDate: (value) => formatGameDateReadable(value),
        });
    } catch (error) {
        console.warn("[advisor] could not work out what changed since the last exchange:", error);
        return { text: "", label: "" };
    }
};

// No closure over component state, so hoisted rather than redefined on every
// AdvisorPanel render (and needed at module scope by the memoized row below).
//
// Through gameDates.js, not new Date(): "2016-01-01" parses as UTC midnight and
// toLocaleDateString shows it in local time, so every reply west of Greenwich was
// dated the day before — and a BC date not at all.
const formatAdvisorDate = (dateStr) => {
    if (!dateStr) return "";
    return formatGameDateReadable(dateStr, "MMM D, YYYY") || String(dateStr);
};

// One chat bubble, memoized. AdvisorPanel's `input` (the composer text) used to
// live in the SAME component as the whole message history, so every keystroke
// re-rendered every bubble in the conversation: re-running parseAdvisorReply's
// regex/JSON.parse over each message's full text, re-parsing every markdown
// body, and — the expensive part — handing AdvisorChart a BRAND NEW config
// object each time (parseAdvisorReply's JSON.parse always returns a fresh
// reference), which tore down and rebuilt every historical Chart.js chart on
// every keystroke. None of that scales with the length of the conversation —
// it's exactly why a long chat felt laggy while a short one didn't. Wrapped
// here, a row only re-renders when ITS OWN message object actually changes (a
// new message appended, or the streaming placeholder being replaced); memo's
// default shallow prop comparison skips everything else, including every
// keystroke in the composer below.
const AdvisorMessageRow = React.memo(({ msg, msgIndex, speakerName = "Advisor", canExecute = true, canDraft = true, canReviewActions = true, allowedUnitTypes, chatDiffers, chatDir, onOpenActions, onOpenProjects, onRetryProjects, onRetry, retrying, onDraftMessage, onDiscussAction, onProceedAction, onExecuteInstitutionDraft, onPlaceDeployment }) => {
    const { text, chartConfig, chartProblem, messageDrafts, institutionDrafts, deployments } = msg.role === "advisor"
        ? parseAdvisorReply(msg.text, { allowedUnitTypes: allowedUnitTypes ? allowedUnitTypes.split(",") : null, streaming: Boolean(msg.streaming) })
        : { text: msg.text, chartConfig: null, chartProblem: "", messageDrafts: null, institutionDrafts: null, deployments: null };
    const asWritten = msg.role === "advisor" && chatDiffers;

    return (
        <div className="oh-advisor-message-row" data-role={msg.role}>
        {/* The world moved on before this question; the advisor was told how
            (the whole note is in the tooltip). */}
        {msg.role === "user" && msg.catchUpLabel && (
            <span title={msg.catchUp} style={{ alignSelf: "center", color: "rgba(255,255,255,0.38)", fontSize: "0.66rem", marginBottom: "0.45rem" }}>
            ⏳ {msg.catchUpLabel}
            </span>
        )}
        {msg.role !== "user" && (
            <span className="oh-advisor-speaker">
            {msg.role === "error" ? "⚠️ Error" : `🧭 ${speakerName}`}
            </span>
        )}
        {/* Player-typed text stays verbatim under UI translation. */}
        <div className="oh-advisor-message-body" data-role={msg.role} data-no-translate={msg.role === "user" || asWritten ? "" : undefined} dir={asWritten ? chatDir : undefined}>
        {msg.role === "user" ? text : (
            <AdvisorReplyBody
            text={text}
            written={msg.role === "advisor"}
            drafts={canDraft ? messageDrafts : null}
            onDraftMessage={canDraft ? onDraftMessage : undefined}
            />
        )}
        {chartConfig && <AdvisorChart config={chartConfig} />}
        {/* Not while streaming: a chart still arriving is not a broken one. */}
        {chartProblem && !msg.streaming && (
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", marginTop: "0.6rem" }}>
            📉 The chart could not be drawn: {chartProblem}.
            </div>
        )}
        {msg.suggestionsNotApplied && !msg.streaming && (
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", marginTop: "0.6rem" }}>
            This official's suggested Actions or Projects were not applied. Authorize them through your chief advisor or the relevant panel.
            </div>
        )}
        {msg.actionsSummary &&<AdvisorActionsCard items={msg.actionsSummary} onOpenActions={onOpenActions} />}
        {Array.isArray(msg.actionsProblems) && msg.actionsProblems.length > 0 && (
            <div role="alert" style={{ marginTop: "0.5rem", fontSize: "0.72rem", color: "#fca5a5" }}>Some Action proposals could not be reviewed: {msg.actionsProblems.join(" ")}</div>
        )}
        {canReviewActions && Array.isArray(msg.actionProposals) && msg.actionProposals.map((proposal) => (
            <AdvisorActionProposalCard
                key={proposal.id}
                proposal={proposal}
                receipt={msg.actionReceipts?.[proposal.id]}
                onDiscuss={() => onDiscussAction(msg.id, proposal)}
                onProceed={() => onProceedAction(msg.id, proposal.id)}
                onOpenActions={onOpenActions}
                disabled={retrying}
            />
        ))}
        {msg.projectsSummary && <AdvisorProjectsCard items={msg.projectsSummary} onOpenProjects={onOpenProjects} />}
        {msg.projectsProblem && <AdvisorProjectsProblem kind={msg.projectsProblem} detail={msg.projectsDetail} excerpt={msg.projectsExcerpt} onRetry={onRetryProjects} />}
        {msg.role === "error" && <AdvisorErrorDetails message={msg.text} diagnostics={msg.diagnostics} onRetry={onRetry} retrying={retrying} />}
        {canExecute && institutionDrafts && institutionDrafts.length > 0 && (
            <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {institutionDrafts.map((draft, draftIndex) => (
                <AdvisorInstitutionDraftAction
                key={`${draft.type}:${draft.institutionId}:${draft.proposalId || draft.polity || draft.title || draftIndex}`}
                draft={draft}
                completed={!!msg.completedInstitutionDrafts?.includes(draftIndex)}
                onExecute={() => onExecuteInstitutionDraft(msgIndex, draftIndex, draft)}
                />
            ))}
            </div>
        )}
        {canExecute && deployments && deployments.length > 0 && (
            <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {/* deployment.index, not the position here: placedDeployments is
                keyed on it, and it holds when the scenario's allowed types
                hide a button (advisorBlocks.js filterAdvisorDeployments). */}
            {deployments.map((deployment) => (
                <AdvisorDeployPlace
                key={deployment.index}
                deployment={deployment}
                placed={!!msg.placedDeployments?.includes(deployment.index)}
                onPlace={() => onPlaceDeployment(msgIndex, deployment.index, deployment)}
                />
            ))}
            </div>
        )}
        </div>
        {msg.time && msg.role !== "user" && (
            <span className="oh-advisor-message-time">
            {formatAdvisorDate(msg.time)}
            </span>
        )}
        </div>
    );
});

// The advisor flagging a paper a turn put in the government's hands
// (runtime/reportDelivery.js documentNotices): one line, the document a click
// away. Shown once the reveal reaches the event it came with; gone if the paper
// is (an undone turn).
const selectReports = (world) => (Array.isArray(world?.reports) ? world.reports : []);
const noticeHow = (notice) => (notice.channel === "intelligence"
    ? `a copy our agents took${notice.from ? ` in ${notice.from}` : ""}; they do not know we have it`
    : notice.channel === "diplomacy"
    ? `from ${notice.from || "abroad"}, filed in our correspondence with them`
    : "for our government's eyes alone");

const AdvisorDocumentNotice = ({ notice }) => {
    const reports = useRuntimeState("world", selectReports);
    const unseen = useUnseenEventIds();
    const [open, setOpen] = useState(false);
    if (unseen.has(String(notice?.eventId ?? ""))) return null;
    const report = reports.find((entry) => String(entry?.id) === String(notice?.reportId));
    if (!report) return null;
    return (
        <div style={{ alignItems: "flex-start", display: "flex", flexDirection: "column" }}>
            <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.7rem", marginBottom: "0.25rem" }}>🧭 Advisor</span>
            <div className="oh-advisor-notice">
                <div>
                    📄 A new paper on your desk: <span data-no-translate style={{ fontWeight: 800 }}>{report.title}</span>, {noticeHow(notice)}.
                </div>
                <button type="button" onClick={() => setOpen((value) => !value)} style={{ background: "none", border: "none", color: "#fde68a", cursor: "pointer", fontFamily: "inherit", fontSize: "0.74rem", fontWeight: 700, marginTop: "0.3rem", padding: 0 }}>
                    {open ? "Put it away" : "Read it"}
                </button>
                {open && (
                    <div data-no-translate style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: "0.4rem", paddingTop: "0.45rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {report.dateline ? `${report.dateline}\n\n` : ""}{report.body}
                    </div>
                )}
            </div>
            {notice.time && (
                <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.65rem", marginTop: "0.25rem" }}>{formatAdvisorDate(notice.time)}</span>
            )}
        </div>
    );
};

// Notices a turn posted while the panel held its conversation (gameplay.js
// postDocumentNotices), and those an undo took back, merged in from the file —
// never the other way — so the panel's next save keeps them.
const mergeNotices = (current, stored) => {
    const storedNotices = (Array.isArray(stored) ? stored : []).filter((message) => message?.role === "notice");
    const storedIds = new Set(storedNotices.map((message) => message.id));
    const kept = current.filter((message) => message?.role !== "notice" || storedIds.has(message.id));
    const present = new Set(kept.filter((message) => message?.role === "notice").map((message) => message.id));
    const added = storedNotices.filter((message) => !present.has(message.id));
    if (!added.length && kept.length === current.length) return current;
    // A reply still streaming stays last: the panel finds it there.
    const last = kept.at(-1);
    return last?.streaming ? [...kept.slice(0, -1), ...added, last] : [...kept, ...added];
};

// A long conversation renders its recent tail first; older messages come in
// on demand, as a diplomacy thread's do (chat.jsx). advisor.json is never
// trimmed, and every reply shown runs the parse and the markdown renderer and
// mounts a Chart.js canvas per chart, so drawing it all made the drawer slow to
// open in a long campaign.
const ADVISOR_INITIAL_RENDER_WINDOW = 12;
const ADVISOR_RENDER_WINDOW_STEP = 20;

// The whole scrollable history, also memoized as a unit — so a keystroke in
// the composer (state that lives in AdvisorPanel, outside this component)
// never even reaches AdvisorMessageRow's own per-row check above.
//
// Only the last `visibleLimit` messages are drawn. `i` stays the index into
// the WHOLE transcript: placedDeployments and completedInstitutionDrafts are
// written back through it.
const AdvisorMessageList = React.memo(({ messages, visibleLimit, onShowEarlier, isLoading, speakerName = "Advisor", emptyMessage = "No messages yet. Ask your advisor something!", canExecute = true, canDraft = true, canReviewActions = true, allowedUnitTypes, chatDiffers, chatDir, onOpenActions, onOpenProjects, onRetryProjects, onRetry, retrying, onDraftMessage, onDiscussAction, onProceedAction, onExecuteInstitutionDraft, onPlaceDeployment, messagesEndRef, containerRef, onScroll }) => (
    <div className="oh-advisor-messages" ref={containerRef} onScroll={onScroll}>
    {messages.length === 0 && (
        <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)", marginTop: 0 }}>
        {emptyMessage}
        </p>
    )}

    {messages.length > visibleLimit && (
        <button
            type="button"
            className="oh-tap-row oh-advisor-message-history"
            onClick={onShowEarlier}
        >
            {Math.min(messages.length - visibleLimit, ADVISOR_RENDER_WINDOW_STEP) === 1
                ? "Show 1 earlier message"
                : `Show ${Math.min(messages.length - visibleLimit, ADVISOR_RENDER_WINDOW_STEP)} earlier messages`}
        </button>
    )}

    {/* The retry is offered on the LAST message only, and only when it is the
        error: retrying anything older would re-ask a question the conversation
        has already moved past. */}
    {messages.map((msg, i) => (i < messages.length - visibleLimit ? null : msg.role === "notice"
        ? <AdvisorDocumentNotice key={msg.id || i} notice={msg} />
        : (
        <AdvisorMessageRow key={i} msg={msg} msgIndex={i} speakerName={speakerName} canExecute={canExecute} canDraft={canDraft} canReviewActions={canReviewActions} allowedUnitTypes={allowedUnitTypes} chatDiffers={chatDiffers} chatDir={chatDir} onOpenActions={onOpenActions} onOpenProjects={onOpenProjects} onRetryProjects={onRetryProjects} onDraftMessage={onDraftMessage} onDiscussAction={onDiscussAction} onProceedAction={onProceedAction} onExecuteInstitutionDraft={onExecuteInstitutionDraft} onPlaceDeployment={onPlaceDeployment}
        onRetry={i === messages.length - 1 && msg.role === "error" ? onRetry : undefined} retrying={retrying} />
    )))}

    {isLoading && !(messages[messages.length - 1]?.role === "advisor" && messages[messages.length - 1]?.streaming) && (
        <div style={{ display: "flex", alignItems: "flex-start", flexDirection: "column", gap: "0.25rem" }}>
        <span style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)" }}>🧭 {speakerName}</span>
        <div className="oh-advisor-thinking">
        <ThinkingDots />
        </div>
        </div>
    )}
    <div ref={messagesEndRef} />
    </div>
));

// The scenario's deployable troop types (world.allowedUnitTypes), joined into
// one string: a primitive, so the memoized rows re-render only when the list
// itself changes. "" means every type is allowed.
const selectAllowedUnitTypes = (world) => (Array.isArray(world?.allowedUnitTypes) ? world.allowedUnitTypes.join(",") : "");

const AdvisorPanel = ({ isAdvisorOpen, mapRef, onClose, width, onResize, onResizeEnd, onOpenActions, onOpenProjects, requestedPrompt, onConsumeRequest }) => {
    const [messages, setMessages]   = useState([]);
    const [input, setInput]         = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [contacts, setContacts] = useState([]);
    const [chiefProfile, setChiefProfile] = useState(null);
    const [activeThreadId, setActiveThreadId] = useState(CHIEF_ADVISOR_THREAD);
    const activeThreadIdRef = useRef(CHIEF_ADVISOR_THREAD);
    const contactDraftsRef = useRef(new Map());
    const threadSwitchingRef = useRef(false);
    const contactMutationRef = useRef(false);
    const [contactsBusy, setContactsBusy] = useState(false);
    const sideEffectPendingRef = useRef(0);
    const [sideEffectsBusy, setSideEffectsBusy] = useState(false);
    const playerPolity = useRuntimeState("game", (game) => String(game?.country || ""));
    // Only the player's government, as text: the whole world re-rendered this panel on every write a turn made.
    const governmentText = useRuntimeState("world", (world) => JSON.stringify(getPoliticalProfile(world || {}, playerPolity)?.government ?? null), playerPolity);
    const politicalWorld = React.useMemo(() => {
        const government = JSON.parse(governmentText);
        return government ? { politicalActors: { byPolity: { [playerPolity]: { polityKey: playerPolity, government } } } } : {};
    }, [governmentText, playerPolity]);
    const offices = React.useMemo(() => politicalAdvisorOffices(politicalWorld, playerPolity), [politicalWorld, playerPolity]);
    const selectedContact = contacts.find((contact) => contact.id === activeThreadId) || null;
    const recipientUnavailableReason = selectedContact?.archived
        ? "This contact is retired — restore to reply"
        : selectedContact && !advisorRecipientType(selectedContact)
            ? "Unsupported recipient type — cannot open conversation"
            : "";
    const recipientLocked = Boolean(recipientUnavailableReason);
    const messagesEndRef            = useRef(null);
    const [visibleMessageLimit, setVisibleMessageLimit] = useState(ADVISOR_INITIAL_RENDER_WINDOW);
    const handleShowEarlier = React.useCallback(() => {
        setVisibleMessageLimit((current) => current + ADVISOR_RENDER_WINDOW_STEP);
    }, []);
    const allowedUnitTypes          = useRuntimeState("world", selectAllowedUnitTypes);
    // The scrollable history div, and whether it should be kept pinned to the
    // bottom as new content (streaming tokens, a new reply) arrives. Starts
    // true (a fresh reply should follow); flips false the moment the player
    // scrolls away from the bottom, so a still-streaming reply doesn't yank
    // them back down while they're reading up through the history. Reset to
    // true on the NEXT message the player sends — the pause is scoped to
    // "while I'm reading this one", not permanent.
    const messagesContainerRef      = useRef(null);
    const shouldAutoScrollRef       = useRef(true);
    // The transcript and the current runTurn, readable from a stable callback
    // (handleRetryTurn) without making that callback depend on either.
    const messagesRef               = useRef(messages);
    // Maintain the transcript ref synchronously. Streaming and canonical writes
    // must not depend on React flushing a queued functional state updater.
    const updateMessages = React.useCallback((change) => {
        const next = typeof change === "function" ? change(messagesRef.current) : change;
        messagesRef.current = next;
        setMessages(next);
        return next;
    }, []);
    const runTurnRef                = useRef(null);
    const turnInFlightRef           = useRef(false);
    const handleMessagesScroll = React.useCallback(() => {
        const el = messagesContainerRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        shouldAutoScrollRef.current = distanceFromBottom < 60;
    }, []);
    const [hasOpened, setHasOpened] = useState(isAdvisorOpen);
    const [hasBootstrapped, setHasBootstrapped] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);
    const [storageRetrying, setStorageRetrying] = useState(false);
    useEffect(() => {
        onAdvisorSaveResult = (ok) => setSaveFailed(!ok);
        return () => { onAdvisorSaveResult = null; };
    }, []);
    const inputRef = useRef(null);
    const [isResizing, setIsResizing] = useState(false);
    const [handleHover, setHandleHover] = useState(false);
    const isMobile = useIsMobile();
    // On a touch screen the 🗑 sits a thumb's width from the ✕, and one stray
    // tap would wipe the whole conversation, so there the first tap only asks
    // (the way deleting a chat does, chat.jsx). A mouse keeps the one click.
    const isTouch = useTouchPrimary();
    const [confirmingClear, setConfirmingClear] = useState(false);
    useEffect(() => {
        if (!confirmingClear) return undefined;
        const timer = setTimeout(() => setConfirmingClear(false), 4000);
        return () => clearTimeout(timer);
    }, [confirmingClear]);
    // On a phone the advisor is the whole screen, and whatever it hands the
    // player to would open underneath it: it steps aside for the Diplomacy
    // composer (handleDraftMessage), as it does for Actions and Projects
    // (main.jsx).
    const stepAsideRef = useRef(null);
    stepAsideRef.current = isMobile ? onClose : null;

    // Drag the drawer's left edge to resize it. The panel is docked right, so the
    // new width is simply (viewport width − pointer x); the parent (main.jsx) clamps
    // it, and persists it when told the drag is over. Pointer capture keeps the drag
    // alive if the cursor leaves the 10px handle. Works for mouse, touch and pen.
    const handleResizeStart = React.useCallback((e) => {
        if (typeof onResize !== "function") return;
        e.preventDefault();
        const target = e.currentTarget;
        try { target.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
        setIsResizing(true);
        const onMove = (ev) => onResize(window.innerWidth - ev.clientX);
        const onUp = () => {
            setIsResizing(false);
            onResizeEnd?.();
            target.removeEventListener("pointermove", onMove);
            target.removeEventListener("pointerup", onUp);
            target.removeEventListener("pointercancel", onUp);
        };
        target.addEventListener("pointermove", onMove);
        target.addEventListener("pointerup", onUp);
        target.addEventListener("pointercancel", onUp);
    }, [onResize, onResizeEnd]);
    // A reply already in the chat language must skip the UI translator, which
    // would render it back into the interface language.
    const chatDiffers = chatLanguageDiffersFromUi();
    const chatDir = chatTextDirection();

    useEffect(() => {
        if (isAdvisorOpen) setHasOpened(true);
    }, [isAdvisorOpen]);

    useEffect(() => {
        if (!isAdvisorOpen || hasBootstrapped) return;
        let cancelled = false;
        loadMessages().then((saved) => {
            if (cancelled) return;
            if (saved === null) {
                setLoadFailed(true);
            } else {
                setContacts(advisorContacts(saved));
                setChiefProfile(chiefAdvisorProfile(saved));
                const chiefMessages = advisorMessagesFor(saved, CHIEF_ADVISOR_THREAD);
                updateMessages(chiefMessages);
                loadHistory(chiefMessages, CHIEF_ADVISOR_THREAD);
            }
            setHasBootstrapped(true);
        });
        return () => { cancelled = true; };
    }, [hasBootstrapped, isAdvisorOpen, updateMessages]);

    // A turn flags new papers in the file while the panel holds the conversation
    // (and an undo takes them back): merge them in (mergeNotices), so they show
    // and the panel's next save keeps them. Before the panel has loaded, the load
    // itself brings them.
    useEffect(() => {
        if (!hasBootstrapped) return undefined;
        const onRuntimeUpdate = (event) => {
            if (event?.detail?.url !== JSON_URLS.advisor) return;
            setContacts(advisorContacts(event.detail.value));
            setChiefProfile(chiefAdvisorProfile(event.detail.value));
            if (activeThreadIdRef.current === CHIEF_ADVISOR_THREAD) {
                updateMessages((prev) => mergeNotices(prev, advisorMessagesFor(event.detail.value, CHIEF_ADVISOR_THREAD)));
            }
        };
        window.addEventListener("oh:runtime-json-updated", onRuntimeUpdate);
        return () => window.removeEventListener("oh:runtime-json-updated", onRuntimeUpdate);
    }, [hasBootstrapped, updateMessages]);

    useEffect(() => {
        if (!shouldAutoScrollRef.current) return;
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // A starter message from outside (the Actions panel's "Help brainstorm
    // actions" button, a project card's "Ask advisor") lands in the input box,
    // not auto-sent — the player still reviews/edits it before it becomes a real
    // message. Waits for bootstrap so it never races the history-load effect
    // above into stomping on a restored draft-less session.
    //
    // APPENDED, never assigned over. This was setInput(requestedPrompt), so a
    // half-typed question was destroyed by pressing a button somewhere else in
    // the HUD — and the player's own words are the one thing in this panel that
    // cannot be got back. Two prompts stacked in the composer read oddly for a
    // moment; deleting the one you did not want is a keystroke, retyping the one
    // you did is not.
    useEffect(() => {
        if (!requestedPrompt || !hasBootstrapped) return;
        setInput((current) => {
            const typed = current.trim();
            if (!typed) return requestedPrompt;
            // Already sitting there (they pressed the same button twice): leave
            // the composer exactly as it is rather than stuttering the prompt.
            if (typed.includes(requestedPrompt.trim())) return current;
            return `${current.replace(/\s+$/, "")}\n\n${requestedPrompt}`;
        });
        onConsumeRequest?.();
        const el = inputRef.current;
        el?.focus();
        // Caret at the end, on the text that was just added.
        if (el) el.selectionStart = el.selectionEnd = el.value.length;
    }, [requestedPrompt, hasBootstrapped, onConsumeRequest]);

    const resizeTextarea = React.useCallback(() => {
        const el = inputRef.current;
        if (!el) {
            return;
        }

        el.style.height = "0";
        el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
    }, []);

    React.useEffect(() => {
        resizeTextarea();
    }, [input, resizeTextarea]);

    // Recipient navigation does not replace the campaign's chief advisor.
    // Every contact has its own saved transcript and model history. Switching
    // while a reply is in flight is forbidden: its streaming UI and write receipt
    // must reach the conversation it was asked in.
    const selectRecipient = async (id) => {
        if (!hasBootstrapped || loadFailed || turnInFlightRef.current || sideEffectPendingRef.current || threadSwitchingRef.current) return;
        if (activeThreadIdRef.current === id) return;
        threadSwitchingRef.current = true;
        try {
            const saved = await readAdvisorMessages({ force: true });
            if (id !== CHIEF_ADVISOR_THREAD && !advisorContacts(saved).some((contact) => contact.id === id)) {
                throw new Error("The selected Advisor recipient no longer exists.");
            }
            contactDraftsRef.current.set(activeThreadIdRef.current, input);
            const selectedMessages = advisorMessagesFor(saved, id);
            activeThreadIdRef.current = id;
            setActiveThreadId(id);
            setContacts(advisorContacts(saved));
            setChiefProfile(chiefAdvisorProfile(saved));
            updateMessages(selectedMessages);
            setInput(contactDraftsRef.current.get(id) || "");
            setVisibleMessageLimit(ADVISOR_INITIAL_RENDER_WINDOW);
            loadHistory(selectedMessages, id);
            shouldAutoScrollRef.current = true;
        } catch (error) {
            setLoadFailed(true);
            logDebugEvent("advisor", "Advisor contact could not be selected.", error, { problem: true });
        } finally {
            threadSwitchingRef.current = false;
        }
    };

    const createRecipient = async (draft) => {
        if (turnInFlightRef.current || sideEffectPendingRef.current || contactMutationRef.current || threadSwitchingRef.current || loadFailed || saveFailed) throw new Error("Cannot add a recipient while the Advisor is busy.");
        contactMutationRef.current = true;
        setContactsBusy(true);
        const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "")
            || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 15)}`;
        const id = `advisor-${random}`;
        try {
            await mutateAdvisorState((all) => createAdvisorContact(all, { ...draft, id }));
            setContacts(advisorContacts(await readAdvisorMessages({ force: true })));
        } finally {
            contactMutationRef.current = false;
            setContactsBusy(false);
        }
        await selectRecipient(id);
    };

    const reviseRecipient = async (id, draft) => {
        if (turnInFlightRef.current || sideEffectPendingRef.current || contactMutationRef.current || threadSwitchingRef.current || loadFailed || saveFailed) throw new Error("Cannot edit a recipient while the Advisor is busy.");
        contactMutationRef.current = true;
        setContactsBusy(true);
        try {
            await mutateAdvisorState((all) => reviseAdvisorContact(all, id, draft));
            setContacts(advisorContacts(await readAdvisorMessages({ force: true })));
        } finally {
            contactMutationRef.current = false;
            setContactsBusy(false);
        }
    };

    const saveChiefProfile = async (draft) => {
        if (turnInFlightRef.current || sideEffectPendingRef.current || contactMutationRef.current || threadSwitchingRef.current || loadFailed || saveFailed) throw new Error("Cannot edit the chief advisor while the Advisor is busy.");
        contactMutationRef.current = true;
        setContactsBusy(true);
        try {
            await mutateAdvisorState((all) => saveChiefAdvisorProfile(all, draft));
            setChiefProfile(chiefAdvisorProfile(await readAdvisorMessages({ force: true })));
        } finally {
            contactMutationRef.current = false;
            setContactsBusy(false);
        }
    };

    const restoreChiefProfile = async () => {
        if (turnInFlightRef.current || sideEffectPendingRef.current || contactMutationRef.current || threadSwitchingRef.current || loadFailed || saveFailed) throw new Error("Cannot restore the chief advisor while the Advisor is busy.");
        contactMutationRef.current = true;
        setContactsBusy(true);
        try {
            await mutateAdvisorState((all) => resetChiefAdvisorProfile(all));
            setChiefProfile(chiefAdvisorProfile(await readAdvisorMessages({ force: true })));
        } finally {
            contactMutationRef.current = false;
            setContactsBusy(false);
        }
    };

    const retireRecipient = async (id, archived) => {
        if (turnInFlightRef.current || sideEffectPendingRef.current || contactMutationRef.current || threadSwitchingRef.current || loadFailed || saveFailed) throw new Error("Cannot retire a recipient while the Advisor is busy.");
        contactMutationRef.current = true;
        setContactsBusy(true);
        try {
            await mutateAdvisorState((all) => archiveAdvisorContact(all, id, archived));
            setContacts(advisorContacts(await readAdvisorMessages({ force: true })));
        } finally {
            contactMutationRef.current = false;
            setContactsBusy(false);
        }
        if (archived && activeThreadIdRef.current === id) await selectRecipient(CHIEF_ADVISOR_THREAD);
    };

    // One turn with the advisor, from either entry point: the composer
    // (handleSend) or the Retry button on a failed turn (handleRetryTurn).
    //
    // `replaceTrailingError` is what makes a retry a retry rather than a second
    // question: the failed attempt's error bubble is dropped and the player's
    // original question stays where it is, so the transcript reads as one
    // exchange. sendMessage pops its own history entry when a call throws (see
    // main.jsx), so the model never sees the question twice either.
    //
    // One turn at a time, checked through a ref: `isLoading` is this render's
    // value and was set only after the awaits below, so a quick double-click on
    // Retry sent the question twice, spending two requests, doubling the
    // reply and queueing its actions twice.
    const runTurn = async (text, options) => {
        if (!text || !hasBootstrapped || loadFailed || saveFailed || turnInFlightRef.current || sideEffectPendingRef.current || contactMutationRef.current || threadSwitchingRef.current || recipientLocked) return;
        turnInFlightRef.current = true;
        setIsLoading(true);
        try {
            await askAdvisor(text, options);
        } finally {
            turnInFlightRef.current = false;
            setIsLoading(false);
        }
    };

    const askAdvisor = async (text, { replaceTrailingError = false } = {}) => {
        const threadId = activeThreadIdRef.current;
        const recipient = threadId === CHIEF_ADVISOR_THREAD ? null
            : contacts.find((contact) => contact.id === threadId && !contact.archived);
        if (threadId !== CHIEF_ADVISOR_THREAD && !recipient) throw new Error("This recipient is unavailable.");
        // The campaign the question is asked in. Its orders, projects and
        // transcript are written through endpoints that follow the open
        // campaign, so a reply that lands after a switch writes nothing.
        const campaignId = String(getLibraryState()?.activeGameId || "").trim();
        const leftCampaign = () => campaignChanged(campaignId, getLibraryState()?.activeGameId);

        // `round` rides along with the date for applyAdvisorProjects — see its
        // comment for why a project update without one reads as stale.
        const { gameDate, round: gameRound } = await readJson(JSON_URLS.game, {
            defaultValue: { gameDate: null, round: 0 },
            force: true,
        }).catch(() => ({ gameDate: null, round: 0 }));

        // Written once, for a new question, and kept on it; a retry sends the
        // note its question was first sent with.
        const askedBefore = replaceTrailingError
            ? [...messagesRef.current].reverse().find((msg) => msg.role === "user")
            : null;
        const moment = await readSeenMoment(gameDate);
        const askedOn = moment.date || gameDate;
        const catchUp = replaceTrailingError
            ? { text: askedBefore?.catchUp || "", label: askedBefore?.catchUpLabel || "" }
            : await buildAdvisorCatchUp(messagesRef.current, moment, {
                publicOnly: Boolean(recipient && advisorRecipientType(recipient) !== ADVISOR_RECIPIENT_TYPES.MINISTER),
            });

        // A fresh question re-engages auto-scroll even if the player had
        // paused it reading up through history — the pause is scoped to the
        // reply they scrolled away from, not the whole session.
        shouldAutoScrollRef.current = true;
        updateMessages(prev => (replaceTrailingError
            ? (prev[prev.length - 1]?.role === "error" ? prev.slice(0, -1) : prev.slice())
            : [...prev, {
                role: "user",
                text,
                time: askedOn,
                // When it was asked, by the clock: the next question's catch-up
                // counts the Game Master's changes from here.
                at: new Date().toISOString(),
                ...(catchUp.text ? { catchUp: catchUp.text, catchUpLabel: catchUp.label } : {}),
            }]));
        // Streaming: the ThinkingDots show until the first token, then a live
        // advisor bubble fills as tokens arrive. It carries a `streaming` flag so
        // it can be found and finalised; intermediate text is NOT persisted.
        const showStreaming = (fullText) => updateMessages(prev => {
            const next = prev.slice();
            const last = next[next.length - 1];
            if (last && last.role === "advisor" && last.streaming) {
                next[next.length - 1] = { ...last, text: stripAdvisorMemory(fullText) };
            } else {
                next.push({ role: "advisor", text: stripAdvisorMemory(fullText), time: askedOn, streaming: true });
            }
            return next;
        });

        try {
            const raw = await sendMessage(text, { threadId, recipient, onChunk: (_delta, full) => showStreaming(full), catchUp: catchUp.text });
            if (leftCampaign()) {
                logDebugEvent("advisor", "Advisor reply dropped: the campaign was switched while it was being written, so none of its orders or projects were applied.");
                return;
            }
            // The hidden ADVISOR_MEMORY line (AI/advisorMemory.js) is kept on the
            // message, never in its text: loadHistory sends the newest one ahead
            // of the history after a reload.
            const { reply, memory } = splitAdvisorMemory(raw);
            // No reply is authority to write an Action. Persist one durable
            // message-bound proposal per valid fenced op, then wait for Proceed.
            const replyId = `advisor-reply-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`}`;
            // Parse once for BOTH the displayed text and persisted proposals.
            // A provider may emit multiple fenced Action arrays; each must be
            // reviewable, with none silently left as raw JSON in the message.
            const { actionsProposal, actionBlockProblems, chartProblem, draftProblems, institutionDraftProblems, deployProblems } = parseAdvisorReply(reply, {
                allowedUnitTypes: Array.isArray(moment.world?.allowedUnitTypes) ? moment.world.allowedUnitTypes : null,
            });
            const { proposals: actionProposals, problems: invalidProposals } =
                (threadId === CHIEF_ADVISOR_THREAD || advisorRecipientType(recipient) === ADVISOR_RECIPIENT_TYPES.MINISTER)
                    ? actionProposalsFromReply(actionsProposal, replyId)
                    : { proposals: [], problems: [] };
            const actionsProblems = [...actionBlockProblems, ...invalidProposals];
            // Same one-shot treatment for the projects board, with truncation
            // salvage: a full backfill of a long campaign is the one block big
            // enough to be cut off mid-array by the reply token cap.
            const { json: projectsProposal, truncated: projectsTruncated, reason: projectsReason,
                dropped: projectsDropped, excerpt: projectsExcerpt } =
                extractFencedJson(reply, "projects", { salvageTruncated: true });
            const canApplyProjects = canAdvisorApplyProjectOps(threadId, recipient);
            const projectsSummary = canApplyProjects
                ? await applyAdvisorProjectProposal({
                    proposal: projectsProposal,
                    gameDate,
                    round: gameRound,
                    mutateWorldState,
                    applyProjectOpsToWorld,
                }).catch((error) => {
                    console.error("Failed to apply advisor-proposed projects:", error);
                    return null;
                }) : null;
            // Every way this can fail used to look identical to the player: a wall
            // of JSON in the chat and a board that never moved. If the model
            // plainly tried and nothing landed, say so and offer the retry.
            // "Some of it landed" is its own outcome, and the most common one now
            // that a single malformed entry no longer costs the batch.
            const projectsProblem = !canApplyProjects ? ""
                : projectsSummary
                    ? (projectsTruncated ? "truncated" : (projectsDropped > 0 ? "partial" : ""))
                    : (looksLikeProjectOps(reply) ? (projectsTruncated ? "truncated-empty" : "unusable") : "");
            // "None of the ops applied" is a distinct failure from "we could not
            // read them": the block parsed fine and every op named a project that
            // does not exist. Telling them apart is the difference between "ask
            // again" and "it is trying to update something that was never opened".
            const projectsDetail = projectsProblem === "partial"
                ? `${projectsDropped} entr${projectsDropped === 1 ? "y was" : "ies were"} malformed and skipped.`
                : projectsProblem === "unusable"
                    ? (projectsReason || "every entry referred to a project that is not on the board")
                    : "";
            // The desktop build has no developer tools bound, so the text that
            // actually broke has to reach the screen or it is unreportable.
            const projectsExcerptText = (projectsProblem === "unusable" || projectsProblem === "partial")
                ? projectsExcerpt
                : "";
            // What the reply DID, next to the reply itself in the log. A block
            // the advisor clearly sent and the board never showed is the most
            // common complaint on this path, and it has three quite different
            // causes — the fence was never found, it parsed and applied nothing,
            // or it applied and the panel is stale. Only this line tells them
            // apart, and it is logged whether or not anything went wrong so the
            // "it worked, the player looked at the wrong panel" case is on the
            // record too.
            logDebugEvent("advisor", "Advisor reply blocks reviewed.", {
                actionsBlock: actionsProposal ? `${Array.isArray(actionsProposal) ? actionsProposal.length : 1} op(s)` : "(none in the reply)",
                actionsProposed: `${actionProposals.length} pending review (zero auto-queued)`,
                projectsBlock: projectsProposal ? `${Array.isArray(projectsProposal) ? projectsProposal.length : 1} op(s)` : "(none in the reply)",
                projectsApplied: projectsSummary ? `${projectsSummary.length} change(s)` : "nothing",
                projectsProblem: projectsProblem || "(none)",
                projectsDetail: projectsDetail || "",
                projectsExcerpt: projectsExcerptText || "",
            }, { verbose: true });
            const next = updateMessages(prev => {
                const next = prev.slice();
                const last = next[next.length - 1];
                const actionSuggestionsBlocked = threadId !== CHIEF_ADVISOR_THREAD && advisorRecipientType(recipient) !== ADVISOR_RECIPIENT_TYPES.MINISTER && actionsProposal;
                const projectsNotApplied = !canApplyProjects && projectsProposal;
                // Keep the upstream localization fix: the notice is UI metadata, not part of the
                // reply text or the future model context. Ordinary Action proposals stay reviewable.
                const suggestionsNotApplied = Boolean(actionSuggestionsBlocked || projectsNotApplied);
                const finalMessage = { id: replyId, role: "advisor", text: reply, time: askedOn, at: new Date().toISOString(), ...(suggestionsNotApplied ? { suggestionsNotApplied: true } : {}), ...(memory ? { memory } : {}), ...(chartProblem ? { chartProblem } : {}), ...(actionsProblems.length ? { actionsProblems } : {}), ...(actionProposals.length ? { actionProposals } : {}), ...(draftProblems.length ? { draftProblems } : {}), ...(institutionDraftProblems.length ? { institutionDraftProblems } : {}), ...(deployProblems.length ? { deployProblems } : {}), ...(projectsSummary ? { projectsSummary } : {}), ...(projectsProblem ? { projectsProblem } : {}), ...(projectsDetail ? { projectsDetail } : {}), ...(projectsExcerptText ? { projectsExcerpt: projectsExcerptText } : {}) };
                // Finalise the streaming bubble, or append the full reply if the
                // provider never streamed a chunk.
                if (last && last.role === "advisor" && last.streaming) {
                    next[next.length - 1] = finalMessage;
                } else {
                    next.push(finalMessage);
                }
                return next;
            });
            await saveMessages(next, threadId);
        } catch (err) {
            if (leftCampaign()) return;
            const updated = updateMessages(prev => {
                const last = prev[prev.length - 1];
                const base = last && last.role === "advisor" && last.streaming ? prev.slice(0, -1) : prev.slice();
                // Keep whatever the transport managed to learn about the failure,
                // so the report button still has it after a reload.
                const updated = [...base, {
                    role: "error",
                    text: err.message,
                    time: askedOn,
                    ...(err?.diagnostics ? { diagnostics: err.diagnostics } : {}),
                }];
                return updated;
            });
            await saveMessages(updated, threadId);
        }
    };

    const handleSend = () => {
        const text = input.trim();
        if (!text || !hasBootstrapped || loadFailed || saveFailed || turnInFlightRef.current || sideEffectPendingRef.current || contactMutationRef.current || threadSwitchingRef.current || recipientLocked) return;
        setInput("");
        return runTurn(text);
    };

    // Asks the last question again. Reads the transcript through a ref and calls
    // runTurn through one, so this stays a stable reference across renders —
    // AdvisorMessageList is memoized on its props, and a callback that changed
    // identity every message would re-render the whole history each time (see
    // AdvisorMessageRow's comment).
    const handleRetryTurn = React.useCallback(() => {
        const lastQuestion = [...messagesRef.current].reverse().find((msg) => msg.role === "user")?.text;
        if (!lastQuestion) return;
        runTurnRef.current?.(lastQuestion, { replaceTrailingError: true });
    }, []);

    useEffect(() => { messagesRef.current = messages; }, [messages]);

    // Retry for a conversation that could not be read: once it is, what was
    // said meanwhile (kept here, unsaved) follows it and is saved with it.
    const retryLoad = async () => {
        setStorageRetrying(true);
        try {
            const saved = await loadMessages();
            if (saved === null) return;
            setLoadFailed(false);
            // Not the notices: a turn's arrive in the file and were merged in
            // here (mergeNotices), so the stored copy already holds them.
            const threadId = activeThreadIdRef.current;
            const savedThread = advisorMessagesFor(saved, threadId);
            const storedIds = new Set(savedThread.map((message) => message?.id).filter(Boolean));
            const said = messagesRef.current.filter((message) => !(message?.id && storedIds.has(message.id)));
            const merged = [...savedThread, ...said];
            setContacts(advisorContacts(saved));
            setChiefProfile(chiefAdvisorProfile(saved));
            updateMessages(merged);
            loadHistory(merged, threadId);
            if (said.length) await saveMessages(merged, threadId);
        } finally {
            setStorageRetrying(false);
        }
    };

    // Retry for a save that failed: the conversation as it stands now.
    const retrySave = async () => {
        setStorageRetrying(true);
        try {
            await saveMessages(messagesRef.current, activeThreadIdRef.current);
        } finally {
            setStorageRetrying(false);
        }
    };
    useEffect(() => { runTurnRef.current = runTurn; });

    const handleKeyDown = (e) => {
        if (isComposerSendKey(e, { touch: isTouch })) { e.preventDefault(); handleSend(); }
    };

    // "Ask for the next batch" under a projects block that was cut off. A
    // stable reference (no deps) so it never breaks AdvisorMessageList's
    // memoization — see the comment on that component for why that matters.
    // Puts the follow-up in the composer rather than sending it: the player may
    // want to narrow what they are asking for, and this file has never auto-sent
    // anything on the player's behalf (see the requestedPrompt effect above).
    const handleRetryProjects = React.useCallback(() => {
        setInput(uiString(RETRY_PROJECTS_TEXT));
        inputRef.current?.focus();
    }, []);

    // Discuss is a local composer handoff: it neither sends a message nor
    // writes an Action. Preserve any draft the player was already typing.
    const handleDiscussAction = React.useCallback((_messageId, proposal) => {
        if (turnInFlightRef.current || sideEffectPendingRef.current || threadSwitchingRef.current) return;
        const subject = String(proposal?.title || proposal?.text || "this Action").trim().slice(0, 240);
        const prompt = `Let's discuss the proposed Action "${subject}" before I authorize it.`;
        setInput((current) => current.trim() ? `${current.replace(/\s+$/, "")}\n\n${prompt}` : prompt);
        inputRef.current?.focus();
    }, []);

    // Canonical approval: re-fetch the stored message and recipient, then
    // re-plan against the latest queue IN its existing canonical write queue.
    // An already-saved Action ID is idempotent after a click retry/reload.
    const handleProceedAction = React.useCallback(async (messageId, proposalId) => {
        if (turnInFlightRef.current || sideEffectPendingRef.current || threadSwitchingRef.current || advisorLoadFailed) {
            return { ok: false, error: "The Advisor is busy. Try again when the current operation finishes." };
        }
        const threadId = activeThreadIdRef.current;
        const campaignId = String(getLibraryState()?.activeGameId || "").trim();
        sideEffectPendingRef.current += 1;
        setSideEffectsBusy(true);
        try {
            assertNoTurnRunning();
            const { round } = await readJson(JSON_URLS.game, { defaultValue: { round: 0 }, force: true });
            if (campaignChanged(campaignId, getLibraryState()?.activeGameId)) {
                throw new Error("The campaign changed before the Action could be queued.");
            }
            const receipt = await approveAdvisorAction({
                threadId, messageId, proposalId,
                readAdvisorMessages, mutateActionsState, mutateAdvisorState,
                normalizeAction: normalizeActionEntry,
                repeatOf: (queue, title) => repeatedOrder(queue, title, { round: Number(round) || 0 }),
                sharedGame: inSharedGame(),
                assertReady: assertNoTurnRunning,
            });
            if (campaignChanged(campaignId, getLibraryState()?.activeGameId)) {
                throw new Error("The campaign changed while the Action was being reviewed. Reopen the correct game.");
            }
            updateMessages((previous) => recordAdvisorActionReceipt(previous, threadId, messageId, proposalId, receipt));
            logDebugEvent("advisor", `Player confirmed Advisor Action proposal ${proposalId}: ${receipt.status}.`, {
                messageId, actionId: receipt.actionId,
            }, { verbose: true });
            return { ok: true };
        } catch (error) {
            console.warn("[advisor] the Action proposal was not fully confirmed:", error);
            return { ok: false, error: `${error?.message || String(error)} If a write succeeded before an error, retrying uses the same Action ID.` };
        } finally {
            sideEffectPendingRef.current -= 1;
            if (!sideEffectPendingRef.current) setSideEffectsBusy(false);
        }
    }, [updateMessages]);

    // Hands the drafted letter to the diplomacy panel: opens (or reuses) the
    // chat with that country and drops the text in its composer, where the
    // player sends it themselves. Nothing is written to the transcript here, so
    // there is no state to persist and nothing that can half-succeed.
    const handleDraftMessage = React.useCallback((draft) => {
        // The letter as the advisor wrote it. What is eventually SENT is logged
        // separately by the diplomacy path (AI/main.jsx), after whatever the
        // player edited in the composer — and the pair is the only way to answer
        // "the advisor drafted one thing and something else went out".
        const target = draft.targetType === "institution-council"
            ? { targetType: "institution-council", institutionId: draft.institutionId, threadId: draft.threadId || "", name: draft.country || draft.institutionId }
            : draft.targetType === "institution-lifecycle"
                ? { targetType: "institution-lifecycle", institutionId: draft.institutionId, caseId: draft.caseId, threadId: draft.threadId || "", name: draft.country || draft.institutionId }
                : { targetType: "private", country: draft.country, name: draft.country };
        const destination = target.targetType === "private"
            ? draft.country
            : `${target.targetType === "institution-council" ? "Council" : "hearing"} ${draft.institutionId}${draft.caseId ? ` / ${draft.caseId}` : ""}`;
        logDebugEvent("advisor", `Draft handed to the Diplomacy composer for ${destination}.`, draft.text, { verbose: true });
        requestDiplomaticChat(target, { draft: draft.text });
        stepAsideRef.current?.();
    }, []);

    // Executes one typed formal institution draft ONLY after the human clicks
    // its button. This is the player-authority boundary: the Advisor may prepare
    // the operation, but these native commit seams re-read and revalidate the
    // current institution before any canonical mutation is published.
    const handleExecuteInstitutionDraft = React.useCallback(async (msgIndex, draftIndex, draft) => {
        if (activeThreadIdRef.current !== CHIEF_ADVISOR_THREAD) {
            return { ok: false, error: "Additional officials advise only. Authorize an institutional action through the appropriate game panel." };
        }
        sideEffectPendingRef.current += 1;
        setSideEffectsBusy(true);
        const threadId = activeThreadIdRef.current;
        try {
            // The institution lives in the world a running turn writes back.
            assertNoTurnRunning();
            const game = await readJson(JSON_URLS.game, {
                defaultValue: { gameDate: "", country: "" },
                force: true,
            });
            const playerCountry = String(game?.country || "").trim();
            const date = String(game?.gameDate || "").trim();
            const expectedGameId = String(getLibraryState()?.activeGameId || "").trim();
            if (!playerCountry) throw new Error("No player polity is active.");

            if (draft.type === "table-proposal") {
                await commitInstitutionalPlayerProposal({
                    institutionId: draft.institutionId,
                    playerCountry,
                    date,
                    expectedGameId,
                    proposal: {
                        type: draft.proposalType || "resolution",
                        title: draft.title,
                        summary: draft.summary || "",
                    },
                });
            } else if (draft.type === "submit-proposal") {
                await commitWithVotingRuleBackfill(() => commitInstitutionalPlayerVoteRequest({
                    institutionId: draft.institutionId,
                    proposalId: draft.proposalId,
                    playerCountry,
                    date,
                    expectedGameId,
                }), { institutionId: draft.institutionId, proposalId: draft.proposalId, expectedGameId });
            } else if (draft.type === "vote") {
                await commitInstitutionGovernanceCommand({
                    institutionId: draft.institutionId,
                    playerCountry,
                    date,
                    expectedGameId,
                    command: {
                        type: "vote",
                        proposalId: draft.proposalId,
                        polity: playerCountry,
                        choice: draft.choice,
                        reason: draft.reason || "",
                        authority: "player",
                        finalizeWhenComplete: true,
                        implementWhenPassed: true,
                    },
                });
            } else if (draft.type === "invite") {
                await commitInstitutionLifecycleCommand({
                    playerCountry,
                    date,
                    expectedGameId,
                    command: {
                        type: "invite",
                        institutionId: draft.institutionId,
                        initiatedBy: playerCountry,
                        polity: draft.polity,
                        requestedStatus: draft.requestedStatus || "member",
                        reason: draft.reason || "",
                        authority: "player",
                    },
                });
            } else {
                throw new Error(`Unsupported Advisor institution draft ${draft.type || "<blank>"}.`);
            }

            logDebugEvent("advisor", `Player confirmed Advisor institution action: ${draft.type}.`, JSON.stringify(draft), { verbose: true });
            const next = updateMessages((prev) => {
                const next = prev.slice();
                const target = next[msgIndex];
                if (!target) return prev;
                const completed = new Set(target.completedInstitutionDrafts || []);
                completed.add(draftIndex);
                next[msgIndex] = { ...target, completedInstitutionDrafts: [...completed] };
                return next;
            });
            await saveMessages(next, threadId);
            return { ok: true };
        } catch (err) {
            console.warn("[advisor] could not execute the recommended institution action:", err);
            return { ok: false, error: err?.message || String(err) };
        } finally {
            sideEffectPendingRef.current -= 1;
            if (!sideEffectPendingRef.current) setSideEffectsBusy(false);
        }
    }, [updateMessages]);

    // Places one deployment the advisor recommended, through the very same
    // deployUnit the Forces panel uses — so it lands as a pending unit with a
    // queued order for the AI to adjudicate, exactly like a hand-placed one, and
    // then flies the map there so the player sees it. Marked on the ADVISOR
    // message (not local state) so the button stays "✓ placed" across a reload.
    // Stable reference, for the same memoization reason as handleDraftMessage.
    const handlePlaceDeployment = React.useCallback(async (msgIndex, deployIndex, deployment) => {
        if (activeThreadIdRef.current !== CHIEF_ADVISOR_THREAD) {
            return { ok: false, error: "Additional officials advise only. Authorize a deployment through the Forces panel." };
        }
        sideEffectPendingRef.current += 1;
        setSideEffectsBusy(true);
        const threadId = activeThreadIdRef.current;
        try {
            const { deployUnit } = await import("../Map/unitsController.js");
            // Null: nothing was placed, as a turn is running or the scenario
            // does not allow that troop type (unitsController.js).
            const placed = await deployUnit({
                type: String(deployment.type).toLowerCase(),
                strength: Math.max(1, Math.min(100, Number(deployment.strength) || 100)),
                name: String(deployment.name).trim(),
                composition: String(deployment.composition ?? "").trim(),
                lng: Number(deployment.lng),
                lat: Number(deployment.lat),
            });
            if (placed === null) {
                if (isSimulationBusy()) return { ok: false, error: TURN_RUNNING_NOTE };
                throw new Error("This scenario does not allow that troop type, so the unit was not placed.");
            }
            // Not saved: no flight to a unit that is not there, no "placed" mark.
            if (!placed?.ok) return { ok: false, error: placed?.error };
            mapRef?.current?.getMap?.()?.flyTo?.({
                center: [Number(deployment.lng), Number(deployment.lat)],
                zoom: 4.5,
            });
            const next = updateMessages((prev) => {
                const next = prev.slice();
                const target = next[msgIndex];
                if (!target) return prev;
                next[msgIndex] = {
                    ...target,
                    placedDeployments: [...(target.placedDeployments || []), deployIndex],
                };
                return next;
            });
            await saveMessages(next, threadId);
            return { ok: true };
        } catch (err) {
            console.warn("[advisor] could not place the recommended deployment:", err);
            return { ok: false, error: err?.message || String(err) };
        } finally {
            sideEffectPendingRef.current -= 1;
            if (!sideEffectPendingRef.current) setSideEffectsBusy(false);
        }
    }, [mapRef, updateMessages]);

    if (!hasOpened) return null;

    return (
        <>
        <MarkdownStyleInjector />
        <div className="oh-advisor-drawer" style={{
            // Pinned to the top and the bottom rather than given a height. 100vh
            // is the height a phone shows with its address bar HIDDEN, so while
            // the bar showed, a 100vh drawer anchored at the bottom ran off the
            // top of the screen and took its ✕ with it. Top and bottom together
            // are always exactly the screen.
            position: "fixed", top: 0, bottom: 0, right: 0,
            // Slide via transform: the old right: calc(-min(...) - 1rem) was
            // INVALID CSS (a min() can't be negated like that), so the closed
            // position was silently dropped and the drawer never slid away.
            // Closed, it sits exactly its own width off-screen: the HUD beside it
            // slides that same distance (main.jsx), so they move as one. The
            // shadow, which would show past the edge, fades out with it instead.
            transform: isAdvisorOpen ? "translateX(0)" : "translateX(100%)",
            // Phones: the whole screen, clear of the notch and the home
            // indicator, with nothing riding beside it (main.jsx leaves the HUD
            // where it is). Desktop: a drawer the player can drag wider; on a
            // notched phone held sideways it grows by the right-hand inset and
            // pads it, so its content keeps its width clear of the notch (every
            // inset is 0 on a desktop).
            ...(isMobile
                ? { left: 0, paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM, paddingLeft: SAFE_LEFT, paddingRight: SAFE_RIGHT, boxSizing: "border-box" }
                : { width: `calc(${width || ADVISOR_PANEL_WIDTH} + ${SAFE_RIGHT})`, paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM, paddingRight: SAFE_RIGHT, boxSizing: "border-box", borderLeft: "1px solid rgba(255,255,255,0.1)" }),
            backdropFilter: "blur(8px)",
            // Phones: above every HUD button/panel (toolbar 9999, forces 10000,
            // library panels 10031) so nothing covers the full-screen sheet;
            // below the editor (10050) and server-down (10060) overlays.
            // Desktop: the drawer can be dragged wide, so it sits under every
            // HUD button, panel and menu (9998 and up: Actions, Projects,
            // diplomacy chat, timeline panels, settings) and over only the map
            // and the session pill (9996).
            zIndex: isMobile ? 10040 : 9997,
            boxShadow: isAdvisorOpen ? "-4px 0 24px rgba(0,0,0,0.4)" : "none",
            transition: `transform ${ADVISOR_SLIDE}, box-shadow ${ADVISOR_SLIDE}`,
            display: "flex", flexDirection: "column",
            color: "white", fontFamily: "sans-serif", overflow: "hidden",
        }}>
        {/* Drag the left edge to resize the drawer (main.jsx clamps + persists).
            Not on a phone, where it is the whole screen. */}
        {typeof onResize === "function" && !isMobile && (
            <div
                onPointerDown={handleResizeStart}
                onPointerEnter={() => setHandleHover(true)}
                onPointerLeave={() => setHandleHover(false)}
                title="Drag to resize"
                style={{
                    position: "absolute", left: 0, top: 0, bottom: 0, width: "10px",
                    cursor: "ew-resize", zIndex: 30, touchAction: "none",
                    display: "flex", alignItems: "center", justifyContent: "center",
                }}
            >
                <div style={{
                    width: "3px", height: "42px", borderRadius: "2px",
                    backgroundColor: isResizing
                        ? "rgba(96,165,250,0.95)"
                        : handleHover ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.22)",
                    transition: "background-color 0.15s",
                }} />
            </div>
        )}
        {/* Advisor is its own system. Country/Stats lives in the separate flag drawer. */}
        <div className="oh-advisor-header">
        <span className="oh-advisor-header-mark" aria-hidden="true">◇</span>
        <span className="oh-advisor-header-title">Advisor</span>
        <div style={{ flex: 1 }} />
        <button
        className="oh-tap"
        onClick={async () => {
            if (!hasBootstrapped || loadFailed || saveFailed || contactMutationRef.current || turnInFlightRef.current || sideEffectPendingRef.current || threadSwitchingRef.current) return;
            if (isTouch && !confirmingClear) { setConfirmingClear(true); return; }
            setConfirmingClear(false);
            const threadId = activeThreadIdRef.current;
            threadSwitchingRef.current = true;
            try {
                updateMessages([]);
                startChat(threadId);
                await saveMessages([], threadId, { clearNotices: true });
            } finally {
                threadSwitchingRef.current = false;
            }
        }}
        disabled={!hasBootstrapped || loadFailed || isLoading || sideEffectsBusy}
        title={confirmingClear ? "Tap again to clear the chat" : "Clear chat"}
        aria-label={confirmingClear ? "Confirm clearing the chat" : "Clear chat"}
        style={confirmingClear
            ? { background: "rgba(239,68,68,0.18)", border: "1px solid rgba(239,68,68,0.55)", borderRadius: "8px", color: "#fca5a5", cursor: "pointer", fontFamily: "sans-serif", fontSize: "0.8rem", fontWeight: 600, lineHeight: 1, padding: "0 0.6rem", display: "flex", alignItems: "center" }
            : { background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "1.35rem", lineHeight: 1, padding: 0, display: "flex", alignItems: "center" }}
        >{confirmingClear ? "Clear?" : "🗑"}</button>
        {/* The way out. On a phone the advisor is the whole screen and this ✕
            (or Back) is all that closes it, so it is finger-sized there. */}
        {onClose && (
            <button
            className="oh-tap"
            onClick={onClose}
            title="Close advisor"
            aria-label="Close advisor"
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: "1.35rem", lineHeight: 1, padding: "0 0 0 0.5rem", display: "flex", alignItems: "center" }}
            >✕</button>
        )}
        </div>

        <AdvisorRecipients
            contacts={contacts}
            activeId={activeThreadId}
            chiefProfile={chiefProfile}
            offices={offices}
            statusOf={(contact) => advisorOfficeStatus(contact, politicalWorld)}
            busy={!hasBootstrapped || isLoading || contactsBusy || sideEffectsBusy || saveFailed || storageRetrying || threadSwitchingRef.current || loadFailed}
            onSelect={selectRecipient}
            onCreate={createRecipient}
            onRevise={reviseRecipient}
            onArchive={retireRecipient}
            onSaveChief={saveChiefProfile}
            onResetChief={restoreChiefProfile}
        />

        {loadFailed ? (
            <StorageProblemNotice title="Could not load your conversation with the advisor." detail="Nothing new is saved until it loads." onRetry={retryLoad} retrying={storageRetrying} retryIcon={<RetryIcon />} />
        ) : saveFailed ? (
            <StorageProblemNotice title="Your latest messages were not saved." detail="They are kept here until a save works." onRetry={retrySave} retrying={storageRetrying} retryIcon={<RetryIcon />} />
        ) : null}

        <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0 }}>
        {/* Messages — memoized as its own component so typing below (state that
            lives in AdvisorPanel) doesn't re-render the whole history on every
            keystroke. See AdvisorMessageRow's comment for why that mattered. */}
        <AdvisorMessageList
        messages={messages}
        speakerName={selectedContact?.name || chiefProfile?.name || "Advisor"}
        emptyMessage={selectedContact && advisorRecipientType(selectedContact) !== ADVISOR_RECIPIENT_TYPES.MINISTER ? "No messages yet. Start your conversation." : "No messages yet. Ask your advisor something!"}
        canExecute={activeThreadId === CHIEF_ADVISOR_THREAD}
        canDraft={activeThreadId === CHIEF_ADVISOR_THREAD || advisorRecipientType(selectedContact) === ADVISOR_RECIPIENT_TYPES.MINISTER}
        canReviewActions={!recipientLocked && (activeThreadId === CHIEF_ADVISOR_THREAD || advisorRecipientType(selectedContact) === ADVISOR_RECIPIENT_TYPES.MINISTER)}
        visibleLimit={visibleMessageLimit}
        onShowEarlier={handleShowEarlier}
        isLoading={isLoading}
        allowedUnitTypes={allowedUnitTypes}
        chatDiffers={chatDiffers}
        chatDir={chatDir}
        onOpenActions={onOpenActions}
        onOpenProjects={onOpenProjects}
        onRetryProjects={handleRetryProjects}
        onRetry={handleRetryTurn}
        retrying={isLoading}
        onDraftMessage={handleDraftMessage}
        onDiscussAction={handleDiscussAction}
        onProceedAction={handleProceedAction}
        onExecuteInstitutionDraft={handleExecuteInstitutionDraft}
        onPlaceDeployment={handlePlaceDeployment}
        messagesEndRef={messagesEndRef}
        containerRef={messagesContainerRef}
        onScroll={handleMessagesScroll}
        />

        {/* Input */}
        <div className="oh-advisor-composer">
        <textarea
        className="oh-advisor-composer-input"
        ref={inputRef}
        // A phone's keyboard has no Shift+Enter to speak of.
        placeholder={recipientUnavailableReason || (selectedContact ? `Message ${selectedContact.name}…` : chiefProfile ? `Message ${chiefProfile.name}…` : isTouch ? "Ask your advisor…" : "Ask your advisor…  (Shift+Enter for a new line)")}
        rows={1} value={input}
        disabled={recipientLocked}
        enterKeyHint="enter"
        onChange={e => {
            setInput(e.target.value);
            resizeTextarea();
        }}
        onKeyDown={handleKeyDown}

        />
        <button
        type="button"
        className="oh-advisor-send"
        aria-label="Send message"
        title="Send message"
        onClick={handleSend}
        disabled={isLoading || recipientLocked || !hasBootstrapped || loadFailed || saveFailed || !input.trim()}
        >
          <svg aria-hidden="true" focusable="false" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5m-7 7 7-7 7 7" />
          </svg>
        </button>
        </div>
        </div>
        </div>
        </>
    );
};

export { AdvisorPanel };
