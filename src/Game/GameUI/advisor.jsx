import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { sendMessage, startChat, loadHistory } from "../AI/main.jsx";

const ADVISOR_PANEL_WIDTH = "20rem";

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
    return (
        <span style={{ opacity: 0.6 }}>
        Thinking{".".repeat(dots)}&nbsp;
        </span>
    );
};

const AdvisorButton = ({ isAdvisorOpen, rightShift, onToggle }) => (
    <button
    onClick={onToggle}
    style={{
        ...baseStyle,
        bottom: "0.5rem",
        right: rightShift,
        height: "4rem",
        width: "4rem",
        cursor: "pointer",
        fontSize: "1.5rem",
        transition: "right 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
    }}
    >
    🧭
    </button>
);

const saveMessages = async (messages) => {
    await fetch('/saves/save0/storage/advisor.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
    });
};

const loadMessages = async () => {
    try {
        const res = await fetch('/saves/save0/storage/advisor.json');
        if (!res.ok) return [];
        return await res.json();
    } catch {
        return [];
    }
};

const AdvisorPanel = ({ isAdvisorOpen }) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef(null);

    useEffect(() => {
        loadMessages().then((saved) => {
            if (saved.length > 0) {
                setMessages(saved);
                loadHistory(saved);
            } else {
                startChat();
            }
        });
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSend = async () => {
        const text = input.trim();
        if (!text || isLoading) return;

        const { gameDate } = await fetch('/saves/save0/game.json').then(res => res.json());

        const userMessage = { role: "user", text, time: gameDate };

        setInput("");
        setMessages((prev) => [...prev, userMessage]);
        setIsLoading(true);

        try {
            const reply = await sendMessage(text);
            const advisorMessage = { role: "advisor", text: reply, time: gameDate };
            setMessages((prev) => {
                const updated = [...prev, advisorMessage];
                saveMessages(updated);
                return updated;
            });
        } catch (err) {
            const errorMessage = { role: "error", text: err.message, time: gameDate };
            setMessages((prev) => {
                const updated = [...prev, errorMessage];
                saveMessages(updated);
                return updated;
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return "";
        const date = new Date(dateStr);
        return date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
    };

    return (
        <>
        <MarkdownStyleInjector />
        <div
        style={{
            position: "fixed",
            top: 0,
            right: isAdvisorOpen ? 0 : `calc(-${ADVISOR_PANEL_WIDTH} - 1rem)`,
            width: ADVISOR_PANEL_WIDTH,
            height: "100vh",
            backgroundColor: "rgba(17, 24, 39, 0.95)",
            backdropFilter: "blur(8px)",
            zIndex: 9998,
            borderLeft: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.4)",
            transition: "right 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
            display: "flex",
            flexDirection: "column",
            color: "white",
            fontFamily: "sans-serif",
            overflow: "hidden",
        }}
        >
        {/* Panel Header */}
        <div
        style={{
            padding: "1.5rem 1.25rem 1rem",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
        }}
        >
        <span style={{ fontSize: "1.5rem" }}>🧭</span>
        <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, flex: 1 }}>
        Advisor
        </h2>
        <button
        onClick={async () => {
            setMessages([]);
            startChat();
            await saveMessages([]);
        }}
        title="Clear chat"
        style={{
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.4)",
            cursor: "pointer",
            fontSize: "1.5rem",
            lineHeight: 1,
            padding: 0,
            display: "flex",
            alignItems: "center",
        }}
        >
        🗑
        </button>
        </div>

        {/* Messages */}
        <div style={{ padding: "1.25rem", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "1rem" }}>
        {messages.length === 0 && (
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)", marginTop: 0 }}>
            No messages yet. Ask your advisor something!
            </p>
        )}
        {messages.map((msg, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
            {msg.role !== "user" && (
                <span style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)", marginBottom: "0.25rem" }}>
                {msg.role === "error" ? "⚠️ Error" : "🧭 Advisor"}
                </span>
            )}
            <div
            style={{
                maxWidth: "90%",
                padding: "0.6rem 0.85rem",
                borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                backgroundColor:
                msg.role === "user"
                ? "#3b82f6"
                : msg.role === "error"
                ? "rgba(239,68,68,0.2)"
                : "rgba(255,255,255,0.08)",
                                   fontSize: "0.85rem",
                                   lineHeight: "1.5",
                                   whiteSpace: "pre-wrap",
                                   wordBreak: "break-word",
                                   border: msg.role === "error" ? "1px solid rgba(239,68,68,0.3)" : "none",
            }}
            >
            {msg.role === "user" ? msg.text : <div className="advisor-markdown"><ReactMarkdown>{msg.text}</ReactMarkdown></div>}
            </div>
            {msg.time && msg.role !== "user" && (
                <span style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.3)", marginTop: "0.25rem" }}>
                {formatDate(msg.time)}
                </span>
            )}
            </div>
        ))}
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

        {/* Input Area */}
        <div
        style={{
            padding: "1rem",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
        }}
        >
        <textarea
        placeholder="Ask your advisor..."
        rows={1}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={(e) => {
            e.target.style.height = "auto";
        }}
        style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.2)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "10px",
            color: "white",
            fontSize: "0.875rem",
            padding: "0.6rem 0.75rem",
            resize: "none",
            outline: "none",
            fontFamily: "sans-serif",
            lineHeight: "1.5",
            overflowY: "hidden",
            transition: "border-color 0.2s",
        }}
        onFocus={(e) => (e.target.style.borderColor = "rgba(59,130,246,0.6)")}
        onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.15)")}
        />
        <button
        onClick={handleSend}
        disabled={isLoading || !input.trim()}
        style={{
            backgroundColor: isLoading || !input.trim() ? "rgba(59,130,246,0.4)" : "#3b82f6",
            border: "none",
            borderRadius: "10px",
            width: "2.5rem",
            height: "2.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
            flexShrink: 0,
            fontSize: "1rem",
            transition: "background-color 0.2s",
        }}
        onMouseEnter={(e) => { if (!isLoading && input.trim()) e.currentTarget.style.backgroundColor = "#2563eb"; }}
        onMouseLeave={(e) => { if (!isLoading && input.trim()) e.currentTarget.style.backgroundColor = "#3b82f6"; }}
        >
        🚀
        </button>
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
        const el = document.getElementById("advisor-md-styles");
        if (!el) {
            const style = document.createElement("style");
            style.id = "advisor-md-styles";
            style.textContent = markdownStyles;
            document.head.appendChild(style);
        }
    }, []);
    return null;
};

export { ADVISOR_PANEL_WIDTH, AdvisorButton, AdvisorPanel };
