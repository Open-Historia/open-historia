/*! Open Historia — portions (drawer close/slide + mobile layout) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useState, useRef, useEffect } from "react";
import { Chart, registerables } from "chart.js";
import { sendMessage, startChat, loadHistory } from "../AI/main.jsx";
import { sendAdvisorDraftedMessage } from "../AI/gameplay.js";
import { JSON_URLS, readJson, writeJson } from "../../runtime/assets.js";
import { chatLanguageDiffersFromUi, isRtlLanguage, resolveChatLanguage } from "../../runtime/i18n.js";
import { applyProjectOps, normalizeActionEntry, readActionsState, readWorldState, writeActionsState, writeWorldState } from "../../runtime/gameState.js";
import { extractFencedJson, looksLikeProjectOps } from "./advisorBlocks.js";
import { buildMessageDrafts, splitAtBlockquotes } from "./advisorDrafts.js";
import Markdown, { MarkdownStyleInjector } from "./markdown.jsx";
import StatsPane from "./stats.jsx";

Chart.register(...registerables);

const ADVISOR_PANEL_WIDTH = "min(20rem, calc(100vw - 1rem))";

const baseStyle = {
    position: "fixed",
    backgroundColor: "rgba(17, 24, 39, 0.9)",
    backdropFilter: "blur(4px)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    fontFamily: "sans-serif",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.1)",
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.2)",
};

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

const UNIT_TYPES_ALLOWED = new Set(["infantry", "armor", "air", "naval", "artillery", "garrison"]);

const parseMessage = (rawText) => {
    const { rest: afterChart, json: chartConfig } = extractFencedJson(rawText, "chart");
    const { rest: afterActions, json: actionsRaw } = extractFencedJson(afterChart, "actions");
    const { rest: afterDrafts, json: draftsRaw } = extractFencedJson(afterActions, "senddraft");
    const { rest: afterDeploy, json: deployRaw } = extractFencedJson(afterDrafts, "deploy");
    const { rest, json: projectsRaw, truncated: projectsTruncated } = extractFencedJson(afterDeploy, "projects", { salvageTruncated: true });
    const messageDrafts = Array.isArray(draftsRaw) ? buildMessageDrafts(draftsRaw, afterActions) : null;
    // A deployment the advisor is recommending, ready to place with one click.
    // Filtered hard: a button that places a unit somewhere unusable is worse
    // than no button, so anything missing a real type or real coordinates goes.
    const deployments = Array.isArray(deployRaw)
        ? deployRaw.filter((entry) => entry
            && UNIT_TYPES_ALLOWED.has(String(entry.type ?? "").toLowerCase())
            && String(entry.name ?? "").trim()
            && Number.isFinite(Number(entry.lng)) && Number.isFinite(Number(entry.lat))
            && !(Number(entry.lng) === 0 && Number(entry.lat) === 0))
        : null;
    return {
        text: rest.trim(),
        chartConfig,
        actionsProposal: Array.isArray(actionsRaw) ? actionsRaw : null,
        messageDrafts,
        deployments: deployments && deployments.length ? deployments : null,
        projectsProposal: Array.isArray(projectsRaw) ? projectsRaw : null,
        projectsTruncated,
    };
};

// Applies the advisor's ```actions proposal to the real queue (readActionsState/
// writeActionsState — the same storage the Actions panel reads and writes) and
// reports what actually happened, so the confirmation card shows real outcomes
// rather than just echoing the model's request back. Runs ONCE, right when a
// reply arrives (see handleSend) — never at render time, since parseMessage
// above runs on every re-render and must stay a pure read.
const applyAdvisorActions = async (proposal) => {
    if (!Array.isArray(proposal) || proposal.length === 0) return null;

    const current = await readActionsState({ force: true });
    let next = [...current];
    const items = [];

    for (const raw of proposal) {
        if (!raw || typeof raw !== "object") continue;
        const id = String(raw.id ?? "").trim();

        if (raw.remove) {
            if (!id) continue;
            const before = next.length;
            next = next.filter((action) => action.id !== id);
            if (next.length < before) items.push({ change: "removed", title: raw.title || id });
            continue;
        }

        const existingIndex = id ? next.findIndex((action) => action.id === id) : -1;
        if (existingIndex !== -1) {
            const existing = next[existingIndex];
            const updated = {
                ...existing,
                ...(raw.title ? { title: String(raw.title) } : {}),
                ...(raw.text ? { text: String(raw.text) } : {}),
                ...(raw.kind === "chat" || raw.kind === "action" ? { kind: raw.kind } : {}),
            };
            next[existingIndex] = updated;
            items.push({ change: "updated", title: updated.title });
            continue;
        }

        // No id, or an id that doesn't match anything current — either a genuinely
        // new proposal, or the model referencing a stale/already-resolved id. Both
        // land as a fresh queued action rather than being silently dropped.
        const created = normalizeActionEntry({
            title: raw.title,
            text: raw.text,
            kind: raw.kind === "chat" ? "chat" : "action",
            source: "advisor",
            status: "planned",
        });
        if (created) {
            next.push(created);
            items.push({ change: "added", title: created.title });
        }
    }

    if (items.length === 0) return null;
    await writeActionsState(next);
    return items;
};

// Copy-to-clipboard, with the execCommand fallback still in place.
//
// The desktop build has no developer tools bound (no F12, no menu entry), so a
// player who hits a provider error has no way to get at what actually happened.
// navigator.clipboard needs a secure context, which the packaged app has but a
// plain-http LAN host does not — hence the textarea fallback rather than a
// silent failure.
const copyToClipboard = async (text) => {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* fall through to the legacy path */ }
    try {
        const scratch = document.createElement("textarea");
        scratch.value = text;
        scratch.setAttribute("readonly", "");
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        document.body.appendChild(scratch);
        scratch.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(scratch);
        return ok;
    } catch {
        return false;
    }
};

const CopyButton = ({ text, label = "Copy for a bug report", tone = "rgba(255,255,255,0.2)", color = "rgba(255,255,255,0.6)" }) => {
    const [state, setState] = useState("idle");
    return (
        <button
        type="button"
        onClick={async () => {
            setState(await copyToClipboard(text) ? "copied" : "failed");
            setTimeout(() => setState("idle"), 2000);
        }}
        style={{ background: "none", border: `1px solid ${tone}`, borderRadius: "6px", color, cursor: "pointer", fontSize: "0.7rem", fontWeight: 600, padding: "0.2rem 0.5rem" }}
        >
        {state === "copied" ? "✓ Copied" : state === "failed" ? "Copy failed — select the text below" : label}
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

// The pasteable report.
//
// Contains no API key and no endpoint host. It DOES contain model output — the
// tail of the reasoning and a few raw stream frames — because that is the part
// that actually explains a failure, and it can quote the campaign. The UI says
// so next to the button rather than letting someone paste it somewhere public
// on the assumption that it is inert.
const formatErrorReport = (message, diagnostics) => {
    const lines = ["Open Historia — advisor error", "", `Message: ${message}`];
    if (diagnostics && typeof diagnostics === "object") {
        lines.push("");
        for (const [key, value] of Object.entries(diagnostics)) {
            if (value === "" || value === null || value === undefined) continue;
            if (Array.isArray(value)) {
                if (value.length === 0) continue;
                lines.push(`${key}:`);
                for (const entry of value) lines.push(`  ${String(entry)}`);
                continue;
            }
            const text = String(value);
            lines.push(text.includes("\n") ? `${key}:\n${text}` : `${key}: ${text}`);
        }
    }
    return lines.join("\n");
};

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
    const report = formatErrorReport(message, diagnostics);
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
        <CopyButton text={report} tone="rgba(239,68,68,0.45)" color="rgba(254,202,202,0.95)" />
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
            {report}
            </pre>
            </>
        )}
        </div>
    );
};

// Applies the advisor's ```projects proposal to the real board (world.projects,
// the same field events write through impacts.projectOps) and reports what
// actually happened, so the confirmation card shows real outcomes rather than
// echoing the model's request back. Runs ONCE, right when a reply arrives (see
// handleSend) — never at render time, since parseMessage runs on every re-render
// and must stay a pure read.
//
// The read-modify-write spreads the WHOLE world back. A shallow patch here would
// drop polityOverrides / regionOwnershipOverrides / ownerCodes and blank the map
// — the same trap saveGame documents in libraryBar.jsx.
const applyAdvisorProjects = async (proposal, gameDate) => {
    if (!Array.isArray(proposal) || proposal.length === 0) return null;

    const world = await readWorldState({ force: true });
    const before = new Map(world.projects.map((project) => [project.id, project]));

    // applyProjectOps normalizes defensively, so the raw parsed ops are fine
    // here; it also drops anything aimed at a project that does not exist.
    const next = applyProjectOps(world.projects, proposal, { date: String(gameDate || "") });

    const items = [];
    for (const project of next) {
        const previous = before.get(project.id);
        if (!previous) {
            items.push({ change: "opened", title: project.name });
        } else if (previous.updatedAt !== project.updatedAt) {
            items.push({
                change: project.status === "complete" && previous.status !== "complete" ? "completed" : "updated",
                title: project.name,
            });
        }
    }
    for (const project of world.projects) {
        if (!next.some((entry) => entry.id === project.id)) {
            items.push({ change: "closed", title: project.name });
        }
    }
    if (items.length === 0) return null;
    await writeWorldState({ ...world, projects: next });
    return items;
};

// Inline confirmation for what the advisor just did to the projects board. Same
// "advisor creates, I review" contract as the actions card below it: nothing the
// advisor changes happens silently.
const AdvisorProjectsCard = ({ items, onOpenProjects }) => {
    const counts = items.reduce((acc, item) => {
        acc[item.change] = (acc[item.change] ?? 0) + 1;
        return acc;
    }, {});
    const summary = ["opened", "updated", "completed", "closed"]
        .filter((change) => counts[change])
        .map((change) => `${counts[change]} ${change}`)
        .join(", ");
    const verb = { opened: "Opened: ", updated: "Updated: ", completed: "Completed: ", closed: "Closed: " };

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
            <CopyButton
            text={formatErrorReport("projects block could not be applied", { detail, excerpt })}
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

// Inline confirmation for what the advisor just did to the Actions queue —
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
        <div style={{ marginTop: "0.75rem", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.3)", borderRadius: "10px", padding: "0.65rem 0.8rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.76rem", fontWeight: 700, color: "rgba(216,196,255,0.95)" }}>📋 Actions {summary}</span>
        {onOpenActions && (
            <button type="button" onClick={onOpenActions} style={{ background: "none", border: "1px solid rgba(139,92,246,0.5)", borderRadius: "6px", color: "rgba(216,196,255,0.9)", cursor: "pointer", fontSize: "0.7rem", fontWeight: 600, padding: "0.2rem 0.5rem" }}>
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

// One drafted message's send button. Local status state so a click shows
// "Sending…" then "✓ Sent" immediately without waiting on a parent re-render;
// `sent` (persisted on the message itself, see AdvisorPanel's handleSendDraft)
// is what survives a reload — the local state just tracks an in-flight click.
const AdvisorDraftSend = ({ draft, sent, onSend }) => {
    const [status, setStatus] = useState(sent ? "sent" : "idle");
    const [error, setError] = useState("");

    useEffect(() => { if (sent) setStatus("sent"); }, [sent]);

    const handleClick = async () => {
        if (status === "sending" || status === "sent") return;
        setStatus("sending");
        setError("");
        const result = await onSend();
        if (result?.ok) setStatus("sent");
        else {
            setStatus("error");
            setError(result?.error || "Failed to send.");
        }
    };

    const busy = status === "sending" || status === "sent";
    return (
        <div>
        <button type="button" onClick={handleClick} disabled={busy} style={{
            display: "flex", alignItems: "center", gap: "0.4rem",
            background: status === "sent" ? "rgba(52,211,153,0.12)" : "rgba(59,130,246,0.16)",
            border: `1px solid ${status === "sent" ? "rgba(52,211,153,0.4)" : "rgba(59,130,246,0.45)"}`,
            borderRadius: "8px",
            color: status === "sent" ? "rgba(167,243,208,0.95)" : "rgba(191,219,254,0.95)",
            cursor: busy ? "default" : "pointer",
            fontFamily: "sans-serif", fontSize: "0.76rem", fontWeight: 600, padding: "0.35rem 0.65rem",
        }}>
        {status === "sent" ? `✓ Sent to ${draft.country}` : status === "sending" ? `Sending to ${draft.country}…` : `✉️ Send message to ${draft.country}`}
        </button>
        {status === "error" && <div style={{ fontSize: "0.7rem", color: "rgba(248,113,113,0.85)", marginTop: "0.3rem" }}>{error}</div>}
        </div>
    );
};

// One recommended deployment, placed with a click. Deliberately routed through
// the SAME deployUnit the Forces panel calls, so a unit the advisor places and
// one the player places by hand are indistinguishable to the engine: both land
// as a translucent pending unit with a queued order for the AI to adjudicate.
const AdvisorDeployPlace = ({ deployment, placed, onPlace }) => {
    const [status, setStatus] = useState(placed ? "placed" : "idle");

    useEffect(() => { if (placed) setStatus("placed"); }, [placed]);

    const handleClick = async () => {
        if (status !== "idle") return;
        setStatus("placing");
        const result = await onPlace();
        setStatus(result?.ok ? "placed" : "idle");
    };

    const busy = status !== "idle";
    return (
        <button type="button" onClick={handleClick} disabled={busy} style={{
            display: "flex", alignItems: "center", gap: "0.4rem",
            background: status === "placed" ? "rgba(52,211,153,0.12)" : "rgba(139,92,246,0.16)",
            border: `1px solid ${status === "placed" ? "rgba(52,211,153,0.4)" : "rgba(139,92,246,0.45)"}`,
            borderRadius: "8px",
            color: status === "placed" ? "rgba(167,243,208,0.95)" : "rgba(216,196,255,0.95)",
            cursor: busy ? "default" : "pointer",
            fontFamily: "sans-serif", fontSize: "0.76rem", fontWeight: 600, padding: "0.35rem 0.65rem",
        }}>
        {status === "placed"
            ? `✓ ${deployment.name} placed`
            : status === "placing"
                ? `Placing ${deployment.name}…`
                : `📍 Place ${deployment.name} here`}
        </button>
    );
};

const CHART_COLORS = ["#60a5fa","#34d399","#f472b6","#fbbf24","#a78bfa","#f87171","#38bdf8"];

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
                        backgroundColor: "rgba(10,15,28,0.95)",
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

const AdvisorButton = ({ isAdvisorOpen, rightShift, onToggle }) => (
    <button onClick={onToggle} style={{
        ...baseStyle,
        bottom: "0.5rem", right: rightShift,
        height: "4rem", width: "4rem",
        cursor: "pointer", fontSize: "1.5rem",
        transition: "right 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
    }}>🧭</button>
);

const saveMessages = async (messages) => {
    try {
        await writeJson(JSON_URLS.advisor, messages);
    } catch (err) { console.error("Failed to save messages:", err); }
};

const loadMessages = async () => {
    try {
        return await readJson(JSON_URLS.advisor, { defaultValue: [] });
    } catch { return []; }
};

const TabButton = ({ icon, label, active, onClick }) => (
    <button
    onClick={onClick}
    style={{
        alignItems: "center",
        background: "none",
        border: "none",
        borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
        color: active ? "white" : "rgba(255,255,255,0.55)",
        cursor: "pointer",
        display: "flex",
        fontFamily: "sans-serif",
        fontSize: "0.88rem",
        fontWeight: active ? 700 : 500,
        gap: "0.4rem",
        padding: "0.9rem 0.85rem",
    }}
    >
    <span style={{ fontSize: "1rem" }}>{icon}</span> {label}
    </button>
);

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
const AdvisorReplyBody = ({ text, drafts, sentDrafts, onSendDraft }) => {
    if (!drafts || drafts.length === 0) {
        return <Markdown className="advisor-markdown">{text}</Markdown>;
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
            sent={!!sentDrafts?.includes(draftIndex)}
            onSend={() => onSendDraft(draftIndex, draft)}
            />
        );
    };

    const segments = splitAtBlockquotes(text);
    const rendered = segments.map((segment, index) => (
        <React.Fragment key={index}>
        <Markdown className="advisor-markdown">{segment.content}</Markdown>
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

// No closure over component state, so hoisted rather than redefined on every
// AdvisorPanel render (and needed at module scope by the memoized row below).
const formatAdvisorDate = (dateStr) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
};

// One chat bubble, memoized. AdvisorPanel's `input` (the composer text) used to
// live in the SAME component as the whole message history, so every keystroke
// re-rendered every bubble in the conversation: re-running parseMessage's
// regex/JSON.parse over each message's full text, re-parsing every markdown
// body, and — the expensive part — handing AdvisorChart a BRAND NEW config
// object each time (parseMessage's JSON.parse always returns a fresh
// reference), which tore down and rebuilt every historical Chart.js chart on
// every keystroke. None of that scales with the length of the conversation —
// it's exactly why a long chat felt laggy while a short one didn't. Wrapped
// here, a row only re-renders when ITS OWN message object actually changes (a
// new message appended, or the streaming placeholder being replaced); memo's
// default shallow prop comparison skips everything else, including every
// keystroke in the composer below.
const AdvisorMessageRow = React.memo(({ msg, msgIndex, chatDiffers, chatDir, onOpenActions, onOpenProjects, onRetryProjects, onRetry, retrying, onSendDraft, onPlaceDeployment }) => {
    const { text, chartConfig, messageDrafts, deployments } = msg.role === "advisor"
        ? parseMessage(msg.text)
        : { text: msg.text, chartConfig: null, messageDrafts: null, deployments: null };
    const asWritten = msg.role === "advisor" && chatDiffers;

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
        {msg.role !== "user" && (
            <span style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)", marginBottom: "0.25rem" }}>
            {msg.role === "error" ? "⚠️ Error" : "🧭 Advisor"}
            </span>
        )}
        {/* Player-typed text stays verbatim under UI translation. */}
        <div data-no-translate={msg.role === "user" || asWritten ? "" : undefined} dir={asWritten ? chatDir : undefined} style={{
            maxWidth: "90%", width: chartConfig ? "90%" : undefined,
            padding: "0.6rem 0.85rem",
            borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
            backgroundColor: msg.role === "user" ? "#3b82f6" : msg.role === "error" ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.08)",
            fontSize: "0.85rem", lineHeight: "1.5", whiteSpace: "pre-wrap", wordBreak: "break-word",
            border: msg.role === "error" ? "1px solid rgba(239,68,68,0.3)" : "none",
            boxSizing: "border-box",
        }}>
        {msg.role === "user" ? text : (
            <AdvisorReplyBody
            text={text}
            drafts={messageDrafts}
            sentDrafts={msg.sentDrafts}
            onSendDraft={(draftIndex, draft) => onSendDraft(msgIndex, draftIndex, draft)}
            />
        )}
        {chartConfig && <AdvisorChart config={chartConfig} />}
        {msg.actionsSummary && <AdvisorActionsCard items={msg.actionsSummary} onOpenActions={onOpenActions} />}
        {msg.projectsSummary && <AdvisorProjectsCard items={msg.projectsSummary} onOpenProjects={onOpenProjects} />}
        {msg.projectsProblem && <AdvisorProjectsProblem kind={msg.projectsProblem} detail={msg.projectsDetail} excerpt={msg.projectsExcerpt} onRetry={onRetryProjects} />}
        {msg.role === "error" && <AdvisorErrorDetails message={msg.text} diagnostics={msg.diagnostics} onRetry={onRetry} retrying={retrying} />}
        {deployments && deployments.length > 0 && (
            <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {deployments.map((deployment, deployIndex) => (
                <AdvisorDeployPlace
                key={deployIndex}
                deployment={deployment}
                placed={!!msg.placedDeployments?.includes(deployIndex)}
                onPlace={() => onPlaceDeployment(msgIndex, deployIndex, deployment)}
                />
            ))}
            </div>
        )}
        </div>
        {msg.time && msg.role !== "user" && (
            <span style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.3)", marginTop: "0.25rem" }}>
            {formatAdvisorDate(msg.time)}
            </span>
        )}
        </div>
    );
});

// The whole scrollable history, also memoized as a unit — so a keystroke in
// the composer (state that lives in AdvisorPanel, outside this component)
// never even reaches AdvisorMessageRow's own per-row check above.
const AdvisorMessageList = React.memo(({ messages, isLoading, chatDiffers, chatDir, onOpenActions, onOpenProjects, onRetryProjects, onRetry, retrying, onSendDraft, onPlaceDeployment, messagesEndRef, containerRef, onScroll }) => (
    <div ref={containerRef} onScroll={onScroll} style={{ padding: "0.75rem", flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "1rem", scrollbarWidth: "none" }}>
    {messages.length === 0 && (
        <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)", marginTop: 0 }}>
        No messages yet. Ask your advisor something!
        </p>
    )}

    {/* The retry is offered on the LAST message only, and only when it is the
        error: retrying anything older would re-ask a question the conversation
        has already moved past. */}
    {messages.map((msg, i) => (
        <AdvisorMessageRow key={i} msg={msg} msgIndex={i} chatDiffers={chatDiffers} chatDir={chatDir} onOpenActions={onOpenActions} onOpenProjects={onOpenProjects} onRetryProjects={onRetryProjects} onSendDraft={onSendDraft} onPlaceDeployment={onPlaceDeployment}
        onRetry={i === messages.length - 1 && msg.role === "error" ? onRetry : undefined} retrying={retrying} />
    ))}

    {isLoading && !(messages[messages.length - 1]?.role === "advisor" && messages[messages.length - 1]?.streaming) && (
        <div style={{ display: "flex", alignItems: "flex-start", flexDirection: "column", gap: "0.25rem" }}>
        <span style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)" }}>🧭 Advisor</span>
        <div style={{ padding: "0.6rem 0.85rem", borderRadius: "12px 12px 12px 4px", backgroundColor: "rgba(255,255,255,0.08)", fontSize: "0.85rem" }}>
        <ThinkingDots />
        </div>
        </div>
    )}
    <div ref={messagesEndRef} />
    </div>
));

const AdvisorPanel = ({ isAdvisorOpen, mapRef, onClose, width, onResize, onOpenActions, onOpenProjects, requestedPrompt, onConsumeRequest }) => {
    const [messages, setMessages]   = useState([]);
    const [input, setInput]         = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef            = useRef(null);
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
    const runTurnRef                = useRef(null);
    const handleMessagesScroll = React.useCallback(() => {
        const el = messagesContainerRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        shouldAutoScrollRef.current = distanceFromBottom < 60;
    }, []);
    const [hasOpened, setHasOpened] = useState(isAdvisorOpen);
    const [hasBootstrapped, setHasBootstrapped] = useState(false);
    const [activeTab, setActiveTab] = useState("advisor");
    const inputRef = useRef(null);
    const [isResizing, setIsResizing] = useState(false);
    const [handleHover, setHandleHover] = useState(false);

    // Drag the drawer's left edge to resize it. The panel is docked right, so the
    // new width is simply (viewport width − pointer x); the parent (main.jsx) clamps
    // and persists it. Pointer capture keeps the drag alive if the cursor leaves the
    // 10px handle. Works for mouse, touch and pen.
    const handleResizeStart = React.useCallback((e) => {
        if (typeof onResize !== "function") return;
        e.preventDefault();
        const target = e.currentTarget;
        try { target.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
        setIsResizing(true);
        const onMove = (ev) => onResize(window.innerWidth - ev.clientX);
        const onUp = () => {
            setIsResizing(false);
            target.removeEventListener("pointermove", onMove);
            target.removeEventListener("pointerup", onUp);
            target.removeEventListener("pointercancel", onUp);
        };
        target.addEventListener("pointermove", onMove);
        target.addEventListener("pointerup", onUp);
        target.addEventListener("pointercancel", onUp);
    }, [onResize]);
    // A reply already in the chat language must skip the UI translator, which
    // would render it back into the interface language.
    const chatDiffers = chatLanguageDiffersFromUi();
    const chatDir = chatDiffers && isRtlLanguage(resolveChatLanguage()) ? "rtl" : undefined;

    useEffect(() => {
        if (isAdvisorOpen) setHasOpened(true);
    }, [isAdvisorOpen]);

    useEffect(() => {
        if (!isAdvisorOpen || hasBootstrapped) return;
        let cancelled = false;
        loadMessages().then((saved) => {
            if (cancelled) return;
            if (saved.length > 0) {
                setMessages(saved);
                loadHistory(saved);   // restore advisor history — no prompt arg = advisor mode
            } else {
                startChat();          // fresh start — no prompt arg = advisor mode
            }
            setHasBootstrapped(true);
        });
        return () => { cancelled = true; };
    }, [hasBootstrapped, isAdvisorOpen]);

    useEffect(() => {
        if (!shouldAutoScrollRef.current) return;
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // A starter message from outside (the Actions panel's "Help brainstorm
    // actions" button) lands in the input box, not auto-sent — the player still
    // reviews/edits it before it becomes a real message. Waits for bootstrap so
    // it never races the history-load effect above into stomping on a restored
    // draft-less session.
    useEffect(() => {
        if (!requestedPrompt || !hasBootstrapped) return;
        setInput(requestedPrompt);
        onConsumeRequest?.();
        inputRef.current?.focus();
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

    // One turn with the advisor, from either entry point: the composer
    // (handleSend) or the Retry button on a failed turn (handleRetryTurn).
    //
    // `replaceTrailingError` is what makes a retry a retry rather than a second
    // question: the failed attempt's error bubble is dropped and the player's
    // original question stays where it is, so the transcript reads as one
    // exchange. sendMessage pops its own history entry when a call throws (see
    // main.jsx), so the model never sees the question twice either.
    const runTurn = async (text, { replaceTrailingError = false } = {}) => {
        if (!text || isLoading) return;

        const { gameDate } = await readJson(JSON_URLS.game, {
            defaultValue: { gameDate: null },
            force: true,
        }).catch(() => ({ gameDate: null }));

        // A fresh question re-engages auto-scroll even if the player had
        // paused it reading up through history — the pause is scoped to the
        // reply they scrolled away from, not the whole session.
        shouldAutoScrollRef.current = true;
        setMessages(prev => (replaceTrailingError
            ? (prev[prev.length - 1]?.role === "error" ? prev.slice(0, -1) : prev.slice())
            : [...prev, { role: "user", text, time: gameDate }]));
        setIsLoading(true);

        // Streaming: the ThinkingDots show until the first token, then a live
        // advisor bubble fills as tokens arrive. It carries a `streaming` flag so
        // it can be found and finalised; intermediate text is NOT persisted.
        const showStreaming = (fullText) => setMessages(prev => {
            const next = prev.slice();
            const last = next[next.length - 1];
            if (last && last.role === "advisor" && last.streaming) {
                next[next.length - 1] = { ...last, text: fullText };
            } else {
                next.push({ role: "advisor", text: fullText, time: gameDate, streaming: true });
            }
            return next;
        });

        try {
            const reply = await sendMessage(text, { onChunk: (_delta, full) => showStreaming(full) });
            // Apply any ```actions proposal in the reply to the real queue BEFORE
            // finalising the message, so the confirmation card that renders with it
            // reflects what actually happened — not a re-derivation done later at
            // render time (which can't know what the queue looked like when this
            // reply arrived).
            const { json: actionsProposal } = extractFencedJson(reply, "actions");
            const actionsSummary = await applyAdvisorActions(actionsProposal).catch((error) => {
                console.error("Failed to apply advisor-proposed actions:", error);
                return null;
            });
            // Same one-shot treatment for the projects board, with truncation
            // salvage: a full backfill of a long campaign is the one block big
            // enough to be cut off mid-array by the reply token cap.
            const { json: projectsProposal, truncated: projectsTruncated, reason: projectsReason,
                dropped: projectsDropped, excerpt: projectsExcerpt } =
                extractFencedJson(reply, "projects", { salvageTruncated: true });
            const projectsSummary = await applyAdvisorProjects(projectsProposal, gameDate).catch((error) => {
                console.error("Failed to apply advisor-proposed projects:", error);
                return null;
            });
            // Every way this can fail used to look identical to the player: a wall
            // of JSON in the chat and a board that never moved. If the model
            // plainly tried and nothing landed, say so and offer the retry.
            // "Some of it landed" is its own outcome, and the most common one now
            // that a single malformed entry no longer costs the batch.
            const projectsProblem = projectsSummary
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
            setMessages(prev => {
                const next = prev.slice();
                const last = next[next.length - 1];
                const finalMessage = { role: "advisor", text: reply, time: gameDate, ...(actionsSummary ? { actionsSummary } : {}), ...(projectsSummary ? { projectsSummary } : {}), ...(projectsProblem ? { projectsProblem } : {}), ...(projectsDetail ? { projectsDetail } : {}), ...(projectsExcerptText ? { projectsExcerpt: projectsExcerptText } : {}) };
                // Finalise the streaming bubble, or append the full reply if the
                // provider never streamed a chunk.
                if (last && last.role === "advisor" && last.streaming) {
                    next[next.length - 1] = finalMessage;
                } else {
                    next.push(finalMessage);
                }
                saveMessages(next);
                return next;
            });
        } catch (err) {
            setMessages(prev => {
                const last = prev[prev.length - 1];
                const base = last && last.role === "advisor" && last.streaming ? prev.slice(0, -1) : prev.slice();
                // Keep whatever the transport managed to learn about the failure,
                // so the Copy button still works after a reload.
                const updated = [...base, {
                    role: "error",
                    text: err.message,
                    time: gameDate,
                    ...(err?.diagnostics ? { diagnostics: err.diagnostics } : {}),
                }];
                saveMessages(updated);
                return updated;
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSend = () => {
        const text = input.trim();
        if (!text || isLoading) return;
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
    useEffect(() => { runTurnRef.current = runTurn; });

    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    // Sends one drafted message (see ADVISOR_MESSAGE_DRAFT_DIRECTIVE in main.jsx)
    // straight to its country's diplomatic chat, then marks it sent on the
    // ADVISOR message itself (not just local UI state) so the button stays
    // "✓ Sent" across a reload instead of reappearing clickable. A stable
    // reference (no deps) so it never breaks AdvisorMessageList's memoization —
    // see the comment on that component for why that matters.
    // Puts the follow-up in the composer rather than sending it: the player may
    // want to narrow what they are asking for, and this file has never auto-sent
    // anything on the player's behalf (see the requestedPrompt effect above).
    const handleRetryProjects = React.useCallback(() => {
        setInput("Continue putting my projects and operations on the board — the last reply was cut off. "
            + "Pick up from where you stopped and skip anything already on the board. Send no more than ten, "
            + "one sentence each. Only include efforts that genuinely appear in our history — if everything real "
            + "is already on the board, just tell me that and add nothing.");
        inputRef.current?.focus();
    }, []);

    const handleSendDraft = React.useCallback(async (msgIndex, draftIndex, draft) => {
        try {
            const { chat } = await sendAdvisorDraftedMessage({ countryName: draft.country, text: draft.text });
            setMessages((prev) => {
                const next = prev.slice();
                const target = next[msgIndex];
                if (!target) return prev;
                next[msgIndex] = { ...target, sentDrafts: [...(target.sentDrafts || []), draftIndex] };
                saveMessages(next);
                return next;
            });
            return { ok: true, chatId: chat?.id };
        } catch (err) {
            return { ok: false, error: err.message || "Failed to send message." };
        }
    }, []);

    // Places one deployment the advisor recommended, through the very same
    // deployUnit the Forces panel uses — so it lands as a pending unit with a
    // queued order for the AI to adjudicate, exactly like a hand-placed one, and
    // then flies the map there so the player sees it. Marked on the ADVISOR
    // message (not local state) so the button stays "✓ placed" across a reload.
    // Stable reference, for the same memoization reason as handleSendDraft.
    const handlePlaceDeployment = React.useCallback(async (msgIndex, deployIndex, deployment) => {
        try {
            const { deployUnit } = await import("../Map/unitsController.js");
            await deployUnit({
                type: String(deployment.type).toLowerCase(),
                strength: Math.max(1, Math.min(100, Number(deployment.strength) || 100)),
                name: String(deployment.name).trim(),
                composition: String(deployment.composition ?? "").trim(),
                lng: Number(deployment.lng),
                lat: Number(deployment.lat),
            });
            mapRef?.current?.getMap?.()?.flyTo?.({
                center: [Number(deployment.lng), Number(deployment.lat)],
                zoom: 4.5,
            });
            setMessages((prev) => {
                const next = prev.slice();
                const target = next[msgIndex];
                if (!target) return prev;
                next[msgIndex] = {
                    ...target,
                    placedDeployments: [...(target.placedDeployments || []), deployIndex],
                };
                saveMessages(next);
                return next;
            });
            return { ok: true };
        } catch (err) {
            console.warn("[advisor] could not place the recommended deployment:", err);
            return { ok: false };
        }
    }, [mapRef]);

    if (!hasOpened) return null;

    return (
        <>
        <MarkdownStyleInjector />
        <div style={{
            position: "fixed", bottom: 0, right: 0,
            // Slide via transform: the old right: calc(-min(...) - 1rem) was
            // INVALID CSS (a min() can't be negated like that), so the closed
            // position was silently dropped and the drawer never slid away.
            transform: isAdvisorOpen ? "translateX(0)" : "translateX(calc(100% + 2rem))",
            // Full height now the in-game top bar is gone — it used to stop 64px
            // (the old BAR_HEIGHT) short of the top to clear it. Anchored bottom: 0
            // above, so height: 100vh reaches the top edge.
            width: typeof width === "number" ? `${width}px` : ADVISOR_PANEL_WIDTH, height: "100vh",
            backgroundColor: "rgba(17, 24, 39, 0.95)", backdropFilter: "blur(8px)",
            // Above every HUD button/panel (toolbar 9999, forces 10000,
            // library panels 10031) so nothing covers the open drawer on
            // phones; below the editor (10050) and server-down (10060) overlays.
            zIndex: 10040, borderLeft: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.4)",
            transition: "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
            display: "flex", flexDirection: "column",
            color: "white", fontFamily: "sans-serif", overflow: "hidden",
        }}>
        {/* Drag the left edge to resize the drawer (main.jsx clamps + persists). */}
        {typeof onResize === "function" && (
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
        {/* Header: tabs to flip between the advisor chat and national stats. */}
        <div style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", padding: "0 0.75rem 0 0.35rem" }}>
        <TabButton icon="🧭" label="Advisor" active={activeTab === "advisor"} onClick={() => setActiveTab("advisor")} />
        <TabButton icon="📊" label="Stats" active={activeTab === "stats"} onClick={() => setActiveTab("stats")} />
        <div style={{ flex: 1 }} />
        {activeTab === "advisor" && (
            <button
            onClick={async () => { setMessages([]); startChat(); await saveMessages([]); }}
            title="Clear chat"
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "1.35rem", lineHeight: 1, padding: 0, display: "flex", alignItems: "center" }}
            >🗑</button>
        )}
        {/* On phones the panel slides over the 🧭 launcher, making it
            untappable — this ✕ is the way out. */}
        {onClose && (
            <button
            onClick={onClose}
            title="Close advisor"
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: "1.35rem", lineHeight: 1, padding: "0 0 0 0.5rem", display: "flex", alignItems: "center" }}
            >✕</button>
        )}
        </div>

        {/* National stats pane — kept mounted so flipping tabs is instant. */}
        <div style={{ display: activeTab === "stats" ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0 }}>
        <StatsPane active={isAdvisorOpen && activeTab === "stats"} />
        </div>

        <div style={{ display: activeTab === "advisor" ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0 }}>
        {/* Messages — memoized as its own component so typing below (state that
            lives in AdvisorPanel) doesn't re-render the whole history on every
            keystroke. See AdvisorMessageRow's comment for why that mattered. */}
        <AdvisorMessageList
        messages={messages}
        isLoading={isLoading}
        chatDiffers={chatDiffers}
        chatDir={chatDir}
        onOpenActions={onOpenActions}
        onOpenProjects={onOpenProjects}
        onRetryProjects={handleRetryProjects}
        onRetry={handleRetryTurn}
        retrying={isLoading}
        onSendDraft={handleSendDraft}
        onPlaceDeployment={handlePlaceDeployment}
        messagesEndRef={messagesEndRef}
        containerRef={messagesContainerRef}
        onScroll={handleMessagesScroll}
        />

        {/* Input */}
        <div style={{ padding: "1rem", borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <textarea
        ref={inputRef}
        placeholder="Ask your advisor…  (Shift+Enter for a new line)"
        rows={1} value={input}
        onChange={e => {
            setInput(e.target.value);
            resizeTextarea();
        }}
        onKeyDown={handleKeyDown}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "10px", color: "white", fontSize: "0.875rem", padding: "0.6rem 0.75rem", resize: "none", outline: "none", fontFamily: "sans-serif", lineHeight: "1.5", overflowY: "auto", scrollbarWidth: "none", transition: "border-color 0.2s" }}
        onFocus={e => e.target.style.borderColor = "rgba(59,130,246,0.6)"}
        onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.15)"}
        />
        <button
        onClick={handleSend} disabled={isLoading || !input.trim()}
        style={{ backgroundColor: isLoading || !input.trim() ? "rgba(59,130,246,0.4)" : "#3b82f6", border: "none", borderRadius: "10px", width: "2.5rem", height: "2.5rem", display: "flex", alignItems: "center", justifyContent: "center", cursor: isLoading || !input.trim() ? "not-allowed" : "pointer", flexShrink: 0, fontSize: "1rem", transition: "background-color 0.2s" }}
        onMouseEnter={e => { if (!isLoading && input.trim()) e.currentTarget.style.backgroundColor = "#2563eb"; }}
        onMouseLeave={e => { if (!isLoading && input.trim()) e.currentTarget.style.backgroundColor = "#3b82f6"; }}
        >🚀</button>
        </div>
        </div>
        </div>
        </>
    );
};

export { ADVISOR_PANEL_WIDTH, AdvisorButton, AdvisorPanel };
