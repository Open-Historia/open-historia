/*! Open Historia — portions (drawer close/slide + mobile layout) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Chart, registerables } from "chart.js";
import { sendMessage, startChat, loadHistory } from "../AI/main.jsx";
import { JSON_URLS, readJson, writeJson } from "../../runtime/assets.js";
import { chatLanguageDiffersFromUi, isRtlLanguage, resolveChatLanguage } from "../../runtime/i18n.js";
import { normalizeActionEntry, readActionsState, writeActionsState } from "../../runtime/gameState.js";
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

// Extracts one fenced ```<lang> block (JSON payload) from a reply and strips
// it from the remaining text — shared by the chart block and the actions
// block below, which both ride the same "prose + one machine-readable fence"
// convention.
const extractFencedJson = (text, lang) => {
    const regex = new RegExp("```" + lang + "\\s*([\\s\\S]*?)```");
    const match = text.match(regex);
    if (!match) return { rest: text, json: null };
    let json = null;
    try { json = JSON.parse(match[1].trim()); } catch { json = null; }
    return { rest: text.replace(regex, ""), json };
};

const parseMessage = (rawText) => {
    const { rest: afterChart, json: chartConfig } = extractFencedJson(rawText, "chart");
    const { rest, json: actionsRaw } = extractFencedJson(afterChart, "actions");
    return { text: rest.trim(), chartConfig, actionsProposal: Array.isArray(actionsRaw) ? actionsRaw : null };
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
const AdvisorMessageRow = React.memo(({ msg, chatDiffers, chatDir, onOpenActions }) => {
    const { text, chartConfig } = msg.role === "advisor"
        ? parseMessage(msg.text)
        : { text: msg.text, chartConfig: null };
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
            <div className="advisor-markdown"><ReactMarkdown>{text}</ReactMarkdown></div>
        )}
        {chartConfig && <AdvisorChart config={chartConfig} />}
        {msg.actionsSummary && <AdvisorActionsCard items={msg.actionsSummary} onOpenActions={onOpenActions} />}
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
const AdvisorMessageList = React.memo(({ messages, isLoading, chatDiffers, chatDir, onOpenActions, messagesEndRef, containerRef, onScroll }) => (
    <div ref={containerRef} onScroll={onScroll} style={{ padding: "0.75rem", flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "1rem", scrollbarWidth: "none" }}>
    {messages.length === 0 && (
        <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)", marginTop: 0 }}>
        No messages yet. Ask your advisor something!
        </p>
    )}

    {messages.map((msg, i) => (
        <AdvisorMessageRow key={i} msg={msg} chatDiffers={chatDiffers} chatDir={chatDir} onOpenActions={onOpenActions} />
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

const AdvisorPanel = ({ isAdvisorOpen, onClose, width, onResize, onOpenActions, requestedPrompt, onConsumeRequest }) => {
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

    const handleSend = async () => {
        const text = input.trim();
        if (!text || isLoading) return;

        const { gameDate } = await readJson(JSON_URLS.game, {
            defaultValue: { gameDate: null },
            force: true,
        }).catch(() => ({ gameDate: null }));

        const userMessage = { role: "user", text, time: gameDate };
        setInput("");
        // A fresh question re-engages auto-scroll even if the player had
        // paused it reading up through history — the pause is scoped to the
        // reply they scrolled away from, not the whole session.
        shouldAutoScrollRef.current = true;
        setMessages(prev => [...prev, userMessage]);
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
            setMessages(prev => {
                const next = prev.slice();
                const last = next[next.length - 1];
                const finalMessage = { role: "advisor", text: reply, time: gameDate, ...(actionsSummary ? { actionsSummary } : {}) };
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
                const updated = [...base, { role: "error", text: err.message, time: gameDate }];
                saveMessages(updated);
                return updated;
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

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

const markdownStyles = `
.advisor-markdown p { margin: 0 0 0.5rem 0; }
.advisor-markdown p:last-child { margin-bottom: 0; }
.advisor-markdown ul, .advisor-markdown ol { margin: 0.25rem 0 0.5rem 1.25rem; padding: 0; }
.advisor-markdown li { margin-bottom: 0.2rem; }
.advisor-markdown strong { color: rgba(255,255,255,0.95); }
.advisor-markdown em { color: rgba(255,255,255,0.75); }
.advisor-markdown code { background: rgba(0,0,0,0.3); padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.8rem; }
.advisor-markdown pre { background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 8px; overflow-x: auto; margin: 0.5rem 0; }
.advisor-markdown h1, .advisor-markdown h2, .advisor-markdown h3 { margin: 0.75rem 0 0.25rem; font-size: 0.95rem; color: rgba(255,255,255,0.9); }
.advisor-markdown blockquote { border-left: 2px solid rgba(59,130,246,0.6); margin: 0.5rem 0; padding-left: 0.75rem; color: rgba(255,255,255,0.6); }
`;

const MarkdownStyleInjector = () => {
    useEffect(() => {
        if (!document.getElementById("advisor-md-styles")) {
            const style = document.createElement("style");
            style.id = "advisor-md-styles";
            style.textContent = markdownStyles;
            document.head.appendChild(style);
        }
    }, []);
    return null;
};

export { ADVISOR_PANEL_WIDTH, AdvisorButton, AdvisorPanel };
