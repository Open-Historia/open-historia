/*! Open Historia — AI debug console (telemetry review, analytics, export). Ported from Abdulrahman Azmy's fork. */
// A full-window instrument panel over the AI engine, opened from Settings.
// Four views:
//   Generations — every AI call with model, tokens, latency and rating, and
//     the FULL system prompt, user message and raw response for review.
//   Analytics — token, latency and rating breakdowns per task.
//   Models — side-by-side model comparison from the recorded generations.
//   Export — download everything (telemetry JSON/CSV, the world state) or
//     wipe the telemetry.
// Data source: src/Game/AI/telemetry.js (IndexedDB + session buffer). The
// console is read-only over game state — analysis, never mutation. Styled
// inline like the rest of GameUI (the fork's version leaned on Tailwind and
// an icon library, neither of which this app carries).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    GENERATION_COMPLETE_EVENT,
    clearAiRecords,
    downloadFile,
    exportTelemetryCsv,
    getAiRecords,
    setGenerationRating,
} from "../AI/telemetry.js";
import { readWorldState } from "../../runtime/gameState.js";

const COLORS = {
    bg: "#0a0e11",
    panel: "#101518",
    raised: "#161b22",
    border: "#30363d",
    text: "#c9d1d9",
    muted: "#8b949e",
    accent: "#3b82f6",
    danger: "#f85149",
    gold: "#d29922",
    ok: "#3fb950",
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const TABS = [
    { id: "generations", label: "Generations" },
    { id: "analytics", label: "Analytics" },
    { id: "models", label: "Models" },
    { id: "export", label: "Export" },
];

const fmtInt = (value) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value).toLocaleString() : "—");
const fmtMs = (value) => (Number.isFinite(Number(value)) && value !== null ? `${(Number(value) / 1000).toFixed(1)}s` : "—");
const fmtTime = (ms) => {
    if (!Number.isFinite(ms)) return "—";
    const date = new Date(ms);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};
const stableKey = (value) => String(value ?? "");

const buttonStyle = {
    padding: "0.35rem 0.7rem",
    borderRadius: "8px",
    border: `1px solid ${COLORS.border}`,
    backgroundColor: "#21262d",
    color: "white",
    fontSize: "0.72rem",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
};

const primaryButtonStyle = { ...buttonStyle, backgroundColor: COLORS.accent, borderColor: COLORS.accent };

const selectStyle = {
    backgroundColor: COLORS.bg,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "6px",
    padding: "0.3rem 0.5rem",
    color: "white",
    fontSize: "0.72rem",
    fontWeight: 700,
};

const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: "0.72rem", color: COLORS.text };
const thStyle = { textAlign: "left", padding: "0.45rem 0.6rem", backgroundColor: COLORS.raised, color: COLORS.muted, fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.08em" };
const tdStyle = { padding: "0.35rem 0.6rem", borderTop: `1px solid #21262d` };
const monoTd = { ...tdStyle, fontFamily: MONO };

const Card = ({ label, value, sub, accent }) => (
    <div style={{
        flex: "1 1 150px",
        minWidth: "150px",
        padding: "0.8rem",
        borderRadius: "10px",
        border: `1px solid ${accent ? "rgba(59,130,246,0.5)" : COLORS.border}`,
        backgroundColor: accent ? "rgba(59,130,246,0.06)" : COLORS.raised,
    }}>
        <div style={{ fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: COLORS.muted, marginBottom: "0.25rem" }}>{label}</div>
        <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "white", lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: "0.66rem", color: COLORS.muted, marginTop: "0.3rem" }}>{sub}</div>}
    </div>
);

const Bar = ({ label, value, max, right }) => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.2rem 0" }}>
        <div style={{ width: "10rem", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.72rem", fontWeight: 700, color: COLORS.text }} title={label}>{label || "—"}</div>
        <div style={{ flex: 1, height: "1rem", backgroundColor: COLORS.bg, borderRadius: "4px", overflow: "hidden", border: `1px solid ${COLORS.border}` }}>
            <div style={{ height: "100%", background: "linear-gradient(90deg, #2563eb, #60a5fa)", width: max > 0 ? `${Math.max(2, Math.round((value / max) * 100))}%` : "0%" }} />
        </div>
        <div style={{ width: "7rem", flexShrink: 0, textAlign: "right", fontSize: "0.72rem", fontWeight: 700, color: COLORS.muted, fontFamily: MONO }}>{right ?? fmtInt(value)}</div>
    </div>
);

const RatingWidget = ({ rating, onRate }) => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.15rem" }}>
        {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
            <button
                key={value}
                type="button"
                onClick={() => onRate(value)}
                title={`Rate ${value}/10`}
                style={{
                    ...buttonStyle,
                    padding: "0.15rem 0.35rem",
                    fontSize: "0.68rem",
                    color: rating >= value ? COLORS.gold : COLORS.muted,
                    backgroundColor: rating >= value ? "rgba(210,153,34,0.15)" : "#21262d",
                }}
            >
                {value}
            </button>
        ))}
        <span style={{ marginLeft: "0.4rem", fontSize: "0.66rem", fontWeight: 700, color: COLORS.muted, fontFamily: MONO }}>{rating ? `${rating}/10` : "unrated"}</span>
    </div>
);

const CopyButton = ({ text }) => {
    const [copied, setCopied] = useState(false);
    if (!text) return null;
    return (
        <button
            type="button"
            style={{ ...buttonStyle, padding: "0.15rem 0.5rem", fontSize: "0.66rem" }}
            title="Copy to clipboard"
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                } catch { /* clipboard unavailable */ }
            }}
        >
            {copied ? "Copied" : "Copy"}
        </button>
    );
};

const Section = ({ title, right, children }) => (
    <div style={{ marginBottom: "1.4rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <h3 style={{ margin: 0, fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "#60a5fa" }}>{title}</h3>
            {right}
        </div>
        {children}
    </div>
);

const PreBlock = ({ title, text, emptyText = "(empty)" }) => {
    const [expanded, setExpanded] = useState(false);
    const content = typeof text === "string" && text ? text : "";
    return (
        <div style={{ marginBottom: "0.8rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                <span style={{ fontSize: "0.64rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: COLORS.muted }}>
                    {title} · {content ? `${content.length.toLocaleString()} chars` : "—"}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    {content.length > 4000 && (
                        <button type="button" onClick={() => setExpanded((current) => !current)} style={{ ...buttonStyle, padding: "0.15rem 0.5rem", fontSize: "0.66rem" }}>
                            {expanded ? "Collapse" : "Expand"}
                        </button>
                    )}
                    <CopyButton text={content} />
                </div>
            </div>
            {content ? (
                <pre style={{
                    margin: 0,
                    fontFamily: MONO,
                    fontSize: "0.66rem",
                    lineHeight: 1.5,
                    color: COLORS.text,
                    backgroundColor: COLORS.bg,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: "8px",
                    padding: "0.6rem",
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: expanded ? "60vh" : "10rem",
                }}>
                    {content}
                </pre>
            ) : (
                <div style={{ fontSize: "0.7rem", color: COLORS.muted, fontStyle: "italic" }}>{emptyText}</div>
            )}
        </div>
    );
};

// --- Generations tab ------------------------------------------------------------

const statusColor = (record) => (record.ok === false ? COLORS.danger : record.ok === true ? COLORS.ok : COLORS.muted);

const GenerationRow = ({ record, selected, onSelect }) => (
    <button
        type="button"
        onClick={() => onSelect(record.id)}
        style={{
            width: "100%",
            textAlign: "left",
            padding: "0.45rem 0.7rem",
            border: "none",
            borderBottom: "1px solid #21262d",
            backgroundColor: selected ? "rgba(59,130,246,0.12)" : "transparent",
            color: COLORS.text,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.7rem",
        }}
    >
        <span style={{ width: "0.4rem", height: "0.4rem", borderRadius: "50%", flexShrink: 0, backgroundColor: statusColor(record) }} />
        <span style={{ width: "7.5rem", flexShrink: 0, color: COLORS.muted, fontFamily: MONO }}>{fmtTime(record.startedAt)}</span>
        <span style={{ width: "9rem", flexShrink: 0, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {record.taskKey || "direct"}{record.batch ? " (batch)" : ""}{record.maxAttempts > 1 ? ` #${record.attempt}` : ""}
        </span>
        <span style={{ flex: 1, minWidth: 0, color: COLORS.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={record.model}>{record.model || "unknown model"}</span>
        <span style={{ width: "8rem", flexShrink: 0, textAlign: "right", color: COLORS.muted, fontFamily: MONO }}>
            {record.usage ? `↑${fmtInt(record.usage.promptTokens)} ↓${fmtInt(record.usage.outputTokens)}` : "no usage"}
        </span>
        <span style={{ width: "3.5rem", flexShrink: 0, textAlign: "right", color: COLORS.muted, fontFamily: MONO }}>{fmtMs(record.latencyMs)}</span>
        <span style={{ width: "2.8rem", flexShrink: 0, textAlign: "right", color: COLORS.gold, fontFamily: MONO }}>{record.rating ? `${record.rating}/10` : ""}</span>
    </button>
);

const SUMMARY_FIELDS = [
    ["eventCount", "events"],
    ["regionTransferCount", "transfers"],
    ["controlOpCount", "control ops"],
    ["polityChangeCount", "polity changes"],
    ["unitOpCount", "unit ops"],
    ["warUpdateCount", "war updates"],
    ["relationUpdateCount", "relation updates"],
    ["storylineUpdateCount", "storylines"],
    ["chatCount", "chats"],
];

const GenerationDetail = ({ record, onRate }) => {
    if (!record) {
        return (
            <div style={{ padding: "1.5rem", textAlign: "center", color: COLORS.muted, fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Select a generation to inspect it
            </div>
        );
    }
    const usage = record.usage ?? {};
    return (
        <div style={{ padding: "0.9rem", overflow: "auto", height: "100%", boxSizing: "border-box" }}>
            <div style={{ marginBottom: "0.7rem" }}>
                <div style={{ fontSize: "0.9rem", fontWeight: 800, color: "white" }}>{record.taskKey || "direct"}</div>
                <div style={{ fontSize: "0.66rem", color: COLORS.muted, fontFamily: MONO }}>
                    {fmtTime(record.startedAt)} · {record.provider || "?"} · {record.model || "?"} · attempt {record.attempt}/{record.maxAttempts}
                    {record.batch ? " · batch" : ""}
                    {Number.isFinite(record.staticPrefixEnd) && record.staticPrefixEnd > 0 ? ` · cacheable prefix ${fmtInt(record.staticPrefixEnd)} chars` : ""}
                </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.9rem" }}>
                <Card label="Tokens in" value={fmtInt(usage.promptTokens)} sub={usage.cachedTokens ? `${fmtInt(usage.cachedTokens)} from cache` : undefined} />
                <Card label="Tokens out" value={fmtInt(usage.outputTokens)} sub={usage.thinkingTokens ? `${fmtInt(usage.thinkingTokens)} thinking` : undefined} />
                <Card label="Latency" value={fmtMs(record.latencyMs)} sub={Number.isFinite(record.firstByteMs) ? `first byte ${fmtMs(record.firstByteMs)}` : undefined} />
                <Card
                    label="Status"
                    value={record.ok === false ? "Failed" : record.ok === true ? "OK" : "Pending"}
                    sub={record.error ? "call error" : record.validationError ? "rejected by validation" : record.simulatedDays != null ? `${record.simulatedDays}d simulated` : undefined}
                />
            </div>

            {record.parsedSummary && (
                <div style={{ marginBottom: "0.9rem", padding: "0.6rem", borderRadius: "8px", backgroundColor: COLORS.raised, border: `1px solid ${COLORS.border}`, display: "flex", flexWrap: "wrap", gap: "0.3rem 1rem", fontSize: "0.7rem", color: COLORS.text }}>
                    {SUMMARY_FIELDS.filter(([key]) => record.parsedSummary[key]).map(([key, label]) => (
                        <span key={key}>{label}: <b>{record.parsedSummary[key]}</b></span>
                    ))}
                    {record.parsedSummary.stopDate && <span>stop: <b style={{ fontFamily: MONO }}>{record.parsedSummary.stopDate}</b></span>}
                </div>
            )}

            {record.validationError && (
                <div style={{ marginBottom: "0.9rem", padding: "0.6rem", borderRadius: "8px", backgroundColor: "rgba(73,2,2,0.6)", border: "1px solid rgba(248,81,73,0.4)", color: "#ff7b72", fontSize: "0.7rem", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "10rem", overflow: "auto" }}>
                    <div style={{ fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.25rem" }}>Validation failure</div>
                    {record.validationError}
                </div>
            )}
            {record.error && (
                <div style={{ marginBottom: "0.9rem", padding: "0.6rem", borderRadius: "8px", backgroundColor: "rgba(73,2,2,0.6)", border: "1px solid rgba(248,81,73,0.4)", color: "#ff7b72", fontSize: "0.7rem" }}>
                    <div style={{ fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.25rem" }}>Call error</div>
                    {record.error}
                </div>
            )}

            <Section title="Human satisfaction">
                <RatingWidget rating={record.rating ?? 0} onRate={(rating) => onRate(record.id, rating)} />
            </Section>

            <Section title="Prompt & response">
                <PreBlock title="System prompt" text={record.systemPrompt} emptyText="(not captured for this record)" />
                <PreBlock title="User message" text={record.userMessage} />
                <PreBlock title="Raw response" text={record.rawResponse} emptyText="(not captured — a tool call carries its answer as structured input)" />
            </Section>
        </div>
    );
};

// --- Aggregation helpers ----------------------------------------------------------

const emptyRow = (label) => ({
    label,
    calls: 0,
    failed: 0,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    latencySum: 0,
    latencyN: 0,
    ratingSum: 0,
    ratingN: 0,
});

const addRecordToRow = (row, record) => {
    row.calls += 1;
    if (record.ok === false) row.failed += 1;
    if (record.usage) {
        row.tokensIn += record.usage.promptTokens ?? 0;
        row.tokensOut += record.usage.outputTokens ?? 0;
        row.cacheRead += record.usage.cachedTokens ?? 0;
    }
    if (Number.isFinite(record.latencyMs)) { row.latencySum += record.latencyMs; row.latencyN += 1; }
    if (Number.isFinite(record.rating)) { row.ratingSum += record.rating; row.ratingN += 1; }
};

const RowsTable = ({ rows, firstHeader }) => (
    <div style={{ borderRadius: "10px", border: `1px solid ${COLORS.border}`, overflow: "auto" }}>
        <table style={tableStyle}>
            <thead>
                <tr>
                    <th style={thStyle}>{firstHeader}</th>
                    <th style={thStyle}>Calls</th>
                    <th style={thStyle}>Failed</th>
                    <th style={thStyle}>Tokens in</th>
                    <th style={thStyle}>Tokens out</th>
                    <th style={thStyle}>Cache read</th>
                    <th style={thStyle}>Avg latency</th>
                    <th style={thStyle}>Avg rating</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((row) => (
                    <tr key={row.label}>
                        <td style={{ ...tdStyle, fontWeight: 700, maxWidth: "16rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.label}>{row.label}</td>
                        <td style={monoTd}>{row.calls}</td>
                        <td style={monoTd}>{row.failed || ""}</td>
                        <td style={monoTd}>{fmtInt(row.tokensIn)}</td>
                        <td style={monoTd}>{fmtInt(row.tokensOut)}</td>
                        <td style={monoTd}>{fmtInt(row.cacheRead)}</td>
                        <td style={monoTd}>{row.latencyN ? fmtMs(row.latencySum / row.latencyN) : "—"}</td>
                        <td style={monoTd}>{row.ratingN ? (row.ratingSum / row.ratingN).toFixed(1) : "—"}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

// --- Main component --------------------------------------------------------------

export const DebugConsole = ({ open, onClose }) => {
    const [activeTab, setActiveTab] = useState("generations");
    const [records, setRecords] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [taskFilter, setTaskFilter] = useState("all");
    const [modelFilter, setModelFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [search, setSearch] = useState("");

    const refresh = useCallback(async () => {
        try {
            setRecords(await getAiRecords());
        } catch { /* keep whatever we have */ }
    }, []);

    useEffect(() => {
        if (!open) return undefined;
        let cancelled = false;
        getAiRecords()
            .then((loaded) => { if (!cancelled) setRecords(loaded); })
            .catch(() => {});
        const handler = () => { refresh(); };
        window.addEventListener(GENERATION_COMPLETE_EVENT, handler);
        return () => {
            cancelled = true;
            window.removeEventListener(GENERATION_COMPLETE_EVENT, handler);
        };
    }, [open, refresh]);

    const models = useMemo(() => [...new Set(records.map((record) => record.model).filter(Boolean))].sort(), [records]);
    const tasks = useMemo(() => [...new Set(records.map((record) => record.taskKey).filter(Boolean))].sort(), [records]);

    const filtered = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return [...records]
            .reverse() // newest first
            .filter((record) => {
                if (taskFilter !== "all" && stableKey(record.taskKey) !== taskFilter) return false;
                if (modelFilter && stableKey(record.model) !== modelFilter) return false;
                if (statusFilter === "ok" && record.ok !== true) return false;
                if (statusFilter === "failed" && record.ok !== false) return false;
                if (needle) {
                    const haystack = `${record.taskKey} ${record.model} ${record.systemPrompt ?? ""} ${record.rawResponse ?? ""} ${record.validationError ?? ""}`.toLowerCase();
                    if (!haystack.includes(needle)) return false;
                }
                return true;
            })
            .slice(0, 200);
    }, [records, taskFilter, modelFilter, statusFilter, search]);

    const selected = filtered.find((record) => record.id === selectedId) ?? null;

    const analytics = useMemo(() => {
        const byTask = new Map();
        for (const record of records) {
            const label = stableKey(record.taskKey) || "direct";
            const row = byTask.get(label) ?? emptyRow(label);
            addRecordToRow(row, record);
            byTask.set(label, row);
        }
        return [...byTask.values()].sort((a, b) => b.tokensIn - a.tokensIn);
    }, [records]);
    const maxTokensByTask = Math.max(1, ...analytics.map((entry) => entry.tokensIn));

    const modelRows = useMemo(() => {
        const byModel = new Map();
        for (const record of records) {
            const label = stableKey(record.model) || "(unknown)";
            const row = byModel.get(label) ?? emptyRow(label);
            addRecordToRow(row, record);
            byModel.set(label, row);
        }
        return [...byModel.values()].sort((a, b) => b.calls - a.calls);
    }, [records]);

    const totals = useMemo(() => {
        let tokensIn = 0;
        let tokensOut = 0;
        let cacheRead = 0;
        let latencyN = 0;
        let latencySum = 0;
        let failed = 0;
        let ratingSum = 0;
        let ratingN = 0;
        let simulatedDays = 0;
        for (const record of records) {
            if (record.usage) {
                tokensIn += record.usage.promptTokens ?? 0;
                tokensOut += record.usage.outputTokens ?? 0;
                cacheRead += record.usage.cachedTokens ?? 0;
            }
            if (record.ok === false) failed += 1;
            if (Number.isFinite(record.latencyMs)) { latencySum += record.latencyMs; latencyN += 1; }
            if (Number.isFinite(record.rating)) { ratingSum += record.rating; ratingN += 1; }
            if (Number.isFinite(record.simulatedDays) && record.ok === true) simulatedDays += record.simulatedDays;
        }
        return {
            tokensIn,
            tokensOut,
            cacheRead,
            failed,
            avgLatency: latencyN ? latencySum / latencyN : null,
            avgRating: ratingN ? ratingSum / ratingN : null,
            ratingN,
            simulatedDays,
        };
    }, [records]);

    if (!open) return null;

    const handleRate = async (recordId, rating) => {
        await setGenerationRating(recordId, rating);
        refresh();
    };
    const handleExportJson = async () => {
        downloadFile(`oh-debug-telemetry-${Date.now()}.json`, JSON.stringify(await getAiRecords(), null, 2));
    };
    const handleExportCsv = async () => {
        downloadFile(`oh-debug-telemetry-${Date.now()}.csv`, exportTelemetryCsv(await getAiRecords()), "text/csv");
    };
    const handleExportWorld = async () => {
        const state = await readWorldState({ force: true });
        downloadFile(`oh-world-state-${Date.now()}.json`, JSON.stringify(state, null, 2));
    };
    const handleClear = async () => {
        if (!window.confirm("Delete ALL recorded AI generations? This cannot be undone.")) return;
        await clearAiRecords();
        setSelectedId(null);
        refresh();
    };

    const emptyNote = (text) => <div style={{ color: COLORS.muted, fontSize: "0.72rem", fontStyle: "italic" }}>{text}</div>;

    return (
        <div style={{ position: "fixed", inset: 0, zIndex: 10001, backgroundColor: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", boxSizing: "border-box", fontFamily: "sans-serif" }}>
            <div style={{ width: "100%", height: "100%", maxWidth: "1600px", backgroundColor: COLORS.bg, border: `2px solid ${COLORS.border}`, borderRadius: "14px", boxShadow: "0 0 80px rgba(0,0,0,0.9)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.6rem 1rem", backgroundColor: COLORS.raised, borderBottom: `2px solid ${COLORS.border}`, flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
                        <span style={{ fontSize: "0.8rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "white" }}>AI debug console</span>
                        <span style={{ fontSize: "0.66rem", fontWeight: 700, color: COLORS.muted, backgroundColor: COLORS.bg, border: `1px solid ${COLORS.border}`, padding: "0.1rem 0.5rem", borderRadius: "6px", fontFamily: MONO }}>
                            {records.length} generation{records.length === 1 ? "" : "s"}
                        </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <button type="button" onClick={refresh} title="Refresh" style={buttonStyle}>Refresh</button>
                        <button type="button" onClick={onClose} title="Close" style={buttonStyle}>✕ Close</button>
                    </div>
                </div>

                <div style={{ display: "flex", gap: "0.25rem", padding: "0.4rem 0.8rem", backgroundColor: COLORS.panel, borderBottom: `1px solid ${COLORS.border}`, overflowX: "auto", flexShrink: 0 }}>
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                ...buttonStyle,
                                border: "none",
                                backgroundColor: activeTab === tab.id ? COLORS.accent : "transparent",
                                color: activeTab === tab.id ? "white" : COLORS.muted,
                                textTransform: "uppercase",
                                letterSpacing: "0.08em",
                            }}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
                    {activeTab === "generations" && (
                        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem", padding: "0.4rem 0.8rem", backgroundColor: COLORS.bg, borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0 }}>
                                <select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)} style={selectStyle}>
                                    <option value="all">All tasks</option>
                                    {tasks.map((task) => <option key={task} value={task}>{task}</option>)}
                                </select>
                                <select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} style={{ ...selectStyle, maxWidth: "14rem" }}>
                                    <option value="">All models</option>
                                    {models.map((model) => <option key={model} value={model}>{model}</option>)}
                                </select>
                                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={selectStyle}>
                                    <option value="all">All statuses</option>
                                    <option value="ok">OK</option>
                                    <option value="failed">Failed</option>
                                </select>
                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Search prompts and responses…"
                                    style={{ ...selectStyle, flex: 1, minWidth: "10rem", fontWeight: 400 }}
                                />
                            </div>
                            <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
                                <div style={{ display: "flex", flexDirection: "column", borderRight: `1px solid ${COLORS.border}`, width: selected ? "46%" : "100%", minWidth: 0 }}>
                                    <div style={{ flex: 1, overflow: "auto" }}>
                                        {filtered.length === 0 ? (
                                            <div style={{ padding: "2rem", textAlign: "center", color: COLORS.muted, fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                                                No generations recorded yet — play a turn, then come back.
                                            </div>
                                        ) : (
                                            <>
                                                <div style={{ padding: "0.25rem 0.7rem", fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: COLORS.muted, borderBottom: "1px solid #21262d", backgroundColor: COLORS.bg }}>
                                                    {filtered.length} shown (newest first)
                                                </div>
                                                {filtered.map((record) => (
                                                    <GenerationRow key={record.id} record={record} selected={selected?.id === record.id} onSelect={setSelectedId} />
                                                ))}
                                            </>
                                        )}
                                    </div>
                                </div>
                                {selected && (
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <GenerationDetail record={selected} onRate={handleRate} />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === "analytics" && (
                        <div style={{ height: "100%", overflow: "auto", padding: "1rem", boxSizing: "border-box" }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginBottom: "1.4rem" }}>
                                <Card label="Generations" value={fmtInt(records.length)} />
                                <Card label="Failed" value={fmtInt(totals.failed)} sub={`${records.length ? Math.round(100 * totals.failed / records.length) : 0}% of calls`} />
                                <Card label="Tokens in" value={fmtInt(totals.tokensIn)} sub={totals.cacheRead ? `${fmtInt(totals.cacheRead)} from cache` : undefined} />
                                <Card label="Tokens out" value={fmtInt(totals.tokensOut)} />
                                <Card label="Avg latency" value={fmtMs(totals.avgLatency)} />
                                <Card label="Avg rating" value={totals.avgRating != null ? `${totals.avgRating.toFixed(1)}/10` : "—"} sub={`${totals.ratingN} rated`} />
                                <Card label="Simulated time" value={totals.simulatedDays ? `${fmtInt(totals.simulatedDays)}d` : "—"} sub="in-game days generated" />
                            </div>
                            <Section title="Token usage by task">
                                {analytics.length === 0 ? emptyNote("No data yet.") : analytics.map((entry) => (
                                    <Bar key={entry.label} label={entry.label} value={entry.tokensIn} max={maxTokensByTask} right={`${fmtInt(entry.tokensIn)} in`} />
                                ))}
                            </Section>
                            <Section title="Calls by task">
                                {analytics.length === 0 ? emptyNote("No data yet.") : <RowsTable rows={analytics} firstHeader="Task" />}
                            </Section>
                        </div>
                    )}

                    {activeTab === "models" && (
                        <div style={{ height: "100%", overflow: "auto", padding: "1rem", boxSizing: "border-box" }}>
                            <Section title="Model comparison (from recorded generations)">
                                {models.length === 0 ? emptyNote("No data yet — run a few turns first.") : <RowsTable rows={modelRows} firstHeader="Model" />}
                                <div style={{ fontSize: "0.66rem", color: COLORS.muted, marginTop: "0.5rem" }}>
                                    Compare models by running the same tasks with different per-task overrides (Settings → provider → Per-task models).
                                </div>
                            </Section>
                        </div>
                    )}

                    {activeTab === "export" && (
                        <div style={{ height: "100%", overflow: "auto", padding: "1rem", boxSizing: "border-box" }}>
                            <Section title="Export recorded data">
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
                                    <button type="button" onClick={handleExportJson} style={primaryButtonStyle}>All generations (JSON, raw prompts)</button>
                                    <button type="button" onClick={handleExportCsv} style={buttonStyle}>Summary (CSV)</button>
                                    <button type="button" onClick={handleExportWorld} style={buttonStyle}>World state (JSON)</button>
                                    <button type="button" onClick={handleClear} style={{ ...buttonStyle, color: "#ff7b72" }}>Clear all telemetry</button>
                                </div>
                                <div style={{ fontSize: "0.66rem", color: COLORS.muted, marginTop: "0.7rem", lineHeight: 1.5 }}>
                                    The JSON export carries every recorded generation at full fidelity — system prompt, user message, raw
                                    response, token usage, model, latency, validation errors and ratings. The CSV is a flat per-call summary.
                                    Prompts contain campaign text only; API keys never enter a record.
                                </div>
                            </Section>
                            <Section title="Storage">
                                <div style={{ fontSize: "0.7rem", color: COLORS.text, fontFamily: MONO }}>
                                    {records.length} generation record(s) retained (200 persisted across sessions, 500 within this session).
                                </div>
                            </Section>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DebugConsole;
