import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Chart, registerables } from "chart.js";
import { sendMessage, startChat, loadHistory } from "../AI/main.jsx";
import { JSON_URLS, readJson, writeJson } from "../../runtime/assets.js";

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

const parseMessage = (rawText) => {
    const chartRegex = /```chart\s*([\s\S]*?)```/;
    const match = rawText.match(chartRegex);
    if (!match) return { text: rawText, chartConfig: null };
    let chartConfig = null;
    try { chartConfig = JSON.parse(match[1].trim()); } catch { chartConfig = null; }
    return { text: rawText.replace(chartRegex, "").trim(), chartConfig };
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

const AdvisorPanel = ({ isAdvisorOpen, onClose }) => {
    const [messages, setMessages]   = useState([]);
    const [input, setInput]         = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef            = useRef(null);
    const [hasOpened, setHasOpened] = useState(isAdvisorOpen);
    const [hasBootstrapped, setHasBootstrapped] = useState(false);

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
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSend = async () => {
        const text = input.trim();
        if (!text || isLoading) return;

        const { gameDate } = await readJson(JSON_URLS.game, {
            defaultValue: { gameDate: null },
            force: true,
        }).catch(() => ({ gameDate: null }));

        const userMessage = { role: "user", text, time: gameDate };
        setInput("");
        setMessages(prev => [...prev, userMessage]);
        setIsLoading(true);

        try {
            const reply = await sendMessage(text);  // uses advisor prompt automatically
            const advisorMessage = { role: "advisor", text: reply, time: gameDate };
            setMessages(prev => {
                const updated = [...prev, advisorMessage];
                saveMessages(updated);
                return updated;
            });
        } catch (err) {
            const errorMessage = { role: "error", text: err.message, time: gameDate };
            setMessages(prev => {
                const updated = [...prev, errorMessage];
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

    const formatDate = (dateStr) => {
        if (!dateStr) return "";
        return new Date(dateStr).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
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
            width: ADVISOR_PANEL_WIDTH, height: "calc(100vh - 64px)",
            backgroundColor: "rgba(17, 24, 39, 0.95)", backdropFilter: "blur(8px)",
            zIndex: 9998, borderLeft: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.4)",
            transition: "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
            display: "flex", flexDirection: "column",
            color: "white", fontFamily: "sans-serif", overflow: "hidden",
        }}>
        {/* Header */}
        <div style={{ padding: "1.5rem 1.25rem 1rem", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span style={{ fontSize: "1.5rem" }}>🧭</span>
        <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, flex: 1 }}>Advisor</h2>
        <button
        onClick={async () => { setMessages([]); startChat(); await saveMessages([]); }}
        title="Clear chat"
        style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "1.5rem", lineHeight: 1, padding: 0, display: "flex", alignItems: "center" }}
        >🗑</button>
        {/* On phones the panel slides over the 🧭 launcher, making it
            untappable — this ✕ is the way out. */}
        {onClose && (
            <button
            onClick={onClose}
            title="Close advisor"
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: "1.35rem", lineHeight: 1, padding: "0 0 0 0.35rem", display: "flex", alignItems: "center" }}
            >✕</button>
        )}
        </div>

        {/* Messages */}
        <div style={{ padding: "0.75rem", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "1rem", scrollbarWidth: "none" }}>
        {messages.length === 0 && (
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)", marginTop: 0 }}>
            No messages yet. Ask your advisor something!
            </p>
        )}

        {messages.map((msg, i) => {
            const { text, chartConfig } = msg.role === "advisor"
            ? parseMessage(msg.text)
            : { text: msg.text, chartConfig: null };
            return (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                {msg.role !== "user" && (
                    <span style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)", marginBottom: "0.25rem" }}>
                    {msg.role === "error" ? "⚠️ Error" : "🧭 Advisor"}
                    </span>
                )}
                <div style={{
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
                </div>
                {msg.time && msg.role !== "user" && (
                    <span style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.3)", marginTop: "0.25rem" }}>
                    {formatDate(msg.time)}
                    </span>
                )}
                </div>
            );
        })}

        {isLoading && (
            <div style={{ display: "flex", alignItems: "flex-start", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)" }}>🧭 Advisor</span>
            <div style={{ padding: "0.6rem 0.85rem", borderRadius: "12px 12px 12px 4px", backgroundColor: "rgba(255,255,255,0.08)", fontSize: "0.85rem" }}>
            <ThinkingDots />
            </div>
            </div>
        )}
        <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: "1rem", borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <textarea
        placeholder="Ask your advisor..."
        rows={1} value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={e => { e.target.style.height = "auto"; }}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "10px", color: "white", fontSize: "0.875rem", padding: "0.6rem 0.75rem", resize: "none", outline: "none", fontFamily: "sans-serif", lineHeight: "1.5", overflowY: "hidden", transition: "border-color 0.2s" }}
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
