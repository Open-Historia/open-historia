import React from "react";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
import { JSON_URLS, readJson, writeJson } from "../../runtime/assets.js";
dayjs.extend(advancedFormat);

const SparkleIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L13.5 9.5L21 11L13.5 12.5L12 20L10.5 12.5L3 11L10.5 9.5L12 2Z"/>
    </svg>
);

const SendIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
    </svg>
);

const saveActions = async (actions) => {
    try {
        await writeJson(JSON_URLS.actions, actions);
    } catch (err) {
        console.error("Failed to save actions:", err);
    }
};

const loadActions = async () => {
    try {
        return await readJson(JSON_URLS.actions, { defaultValue: [] });
    } catch {
        return [];
    }
};

const ActionItem = ({ action, onDelete }) => {
    const [hovered, setHovered] = React.useState(false);

    return (
        <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
            padding: "0.55rem 0.85rem",
            borderRadius: "10px",
            backgroundColor: hovered ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.07)",
            color: "rgba(255,255,255,0.85)",
            lineHeight: "1.75",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",
            transition: "background 0.15s",
        }}
        >
        <span style={{ flex: 1, fontSize: "0.82rem" }}>{action}</span>
        <button
        onClick={onDelete}
        title="Delete action"
        style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0.1rem 0.2rem",
            borderRadius: "6px",
            color: "rgba(239,68,68,0.8)",
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            fontSize: "0.9rem",
            lineHeight: 1,
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? "auto" : "none",
            transition: "opacity 0.15s, color 0.15s, background 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = "rgba(239,68,68,0.95)"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "rgba(239,68,68,0.8)"; e.currentTarget.style.background = "none"; }}
        >
        🗑
        </button>
        </div>
    );
};

const ActionsPanel = ({ isOpen, onClose, onOpenAdvisor }) => {
    const [actions, setActions] = React.useState([]);
    const [inputValue, setInputValue] = React.useState("");
    const [country, setCountry] = React.useState("your nation");
    const [gameDate, setGameDate] = React.useState("the current date");
    const inputRef = React.useRef(null);

    React.useEffect(() => {
        if (!isOpen) return;

        let cancelled = false;
        loadActions().then((saved) => {
            if (!cancelled && saved.length > 0) setActions(saved);
        });

        const fetchGameData = () => {
            readJson(JSON_URLS.game, { defaultValue: {}, force: true })
            .then((data) => {
                if (cancelled) return;
                if (data.country) setCountry(data.country);
                if (data.gameDate) setGameDate(dayjs(data.gameDate).format("MMMM Do, YYYY"));
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

    const handleSubmit = () => {
        const trimmed = inputValue.trim();
        if (!trimmed) return;
        setActions(prev => {
            const updated = [...prev, trimmed];
            saveActions(updated);
            return updated;
        });
        setInputValue("");
    };

    const handleDelete = (index) => {
        setActions(prev => {
            const updated = prev.filter((_, j) => j !== index);
            saveActions(updated);
            return updated;
        });
    };

    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <div
        style={{
            position: "fixed",
            bottom: isOpen ? "4.25rem" : "-30rem",
            left: "0rem",
            width: "26.25rem",
            maxWidth: "calc(100vw - 1rem)",
            backgroundColor: "rgba(17, 24, 39, 0.95)",
            backdropFilter: "blur(8px)",
            borderRadius: "16px",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
            zIndex: 9998,
            overflow: "hidden",
            transition: "bottom 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease",
            opacity: isOpen ? 1 : 0,
            pointerEvents: isOpen ? "auto" : "none",
            fontFamily: "sans-serif",
            color: "white",
            display: "flex",
            flexDirection: "column",
        }}
        >
        {/* Header */}
        <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "1rem 1.25rem 0.75rem",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}>
        <span style={{ fontWeight: 700, fontSize: "1rem", letterSpacing: "0.01em" }}>
        Actions
        </span>
        <button
        onClick={onClose}
        style={{
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.5)",
            cursor: "pointer",
            fontSize: "1.1rem",
            lineHeight: 1,
            padding: "0.15rem 0.3rem",
            borderRadius: "6px",
            transition: "color 0.15s, background 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = "white"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.5)"; e.currentTarget.style.background = "none"; }}
        >
        ✕
        </button>
        </div>

        {/* Body */}
        <div style={{ padding: "0.875rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
        <p style={{
            margin: 0,
            fontSize: "0.82rem",
            lineHeight: "1.55",
            color: "rgba(255,255,255,0.75)",
        }}>
        Submit actions for {country} for {gameDate}. Your actions will affect how the game world responds.
        </p>

        <button
        style={{
            width: "100%",
            padding: "0.55rem 1rem",
            borderRadius: "10px",
            border: "1px solid rgba(139, 92, 246, 0.4)",
            background: "rgba(109, 40, 217, 0.15)",
            color: "rgba(196, 165, 255, 0.95)",
            fontSize: "0.82rem",
            fontWeight: 500,
            cursor: "pointer",
            transition: "background 0.15s, border-color 0.15s",
            letterSpacing: "0.01em",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(109, 40, 217, 0.28)"; e.currentTarget.style.borderColor = "rgba(139,92,246,0.65)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(109, 40, 217, 0.15)"; e.currentTarget.style.borderColor = "rgba(139,92,246,0.4)"; }}
        onClick={onOpenAdvisor}
        >
        Help brainstorm actions
        </button>

        <div>
        <p style={{
            margin: "0 0 0.5rem 0",
            fontSize: "0.78rem",
            fontWeight: 700,
            color: "rgba(255,255,255,0.9)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
        }}>
        Your Submitted Actions
        </p>

        <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",
            height: "calc(100vh - 50rem)",
            overflowY: "auto",
            scrollbarWidth: "none",
        }}>
        {actions.length === 0 && (
            <p style={{ margin: 0, fontSize: "0.8rem", color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>
            No actions submitted yet.
            </p>
        )}
        {actions.map((action, i) => (
            <ActionItem
            key={i}
            action={action}
            onDelete={() => handleDelete(i)}
            />
        ))}
        </div>
        </div>
        </div>

        {/* Input bar */}
        <div style={{
            padding: "0.75rem 1rem",
            borderTop: "1px solid rgba(255,255,255,0.07)",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            backgroundColor: "rgba(0,0,0,0.2)",
        }}>
        <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center" }}>
        <input
        ref={inputRef}
        type="text"
        placeholder="Enter your action..."
        value={inputValue}
        onChange={e => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        style={{
            width: "100%",
            padding: "0.55rem 2.5rem 0.55rem 0.85rem",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(0,0,0,0.2)",
            color: "white",
            fontSize: "0.82rem",
            outline: "none",
            boxSizing: "border-box",
            fontFamily: "sans-serif",
            transition: "border-color 0.2s",
        }}
        onFocus={e => e.target.style.borderColor = "rgba(139,92,246,0.5)"}
        onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.12)"}
        />
        <span style={{
            position: "absolute",
            right: "0.6rem",
            color: "rgba(196,165,255,0.6)",
            display: "flex",
            pointerEvents: "none",
        }}>
        <SparkleIcon />
        </span>
        </div>

        <button
        onClick={handleSubmit}
        disabled={!inputValue.trim()}
        style={{
            width: "2.2rem",
            height: "2.2rem",
            borderRadius: "10px",
            border: "none",
            background: inputValue.trim() ? "#3b82f6" : "rgba(59,130,246,0.3)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: inputValue.trim() ? "pointer" : "not-allowed",
            flexShrink: 0,
            transition: "background 0.15s",
        }}
        onMouseEnter={e => { if (inputValue.trim()) e.currentTarget.style.background = "#2563eb"; }}
        onMouseLeave={e => { if (inputValue.trim()) e.currentTarget.style.background = "#3b82f6"; }}
        >
        <SendIcon />
        </button>
        </div>
        </div>
    );
};

const Actions = ({ onOpenAdvisor, hovered, setHovered, isActive }) => {
    const [actionsOpen, setActionsOpen] = React.useState(false);
    const [hasOpened, setHasOpened] = React.useState(false);

    React.useEffect(() => {
        if (actionsOpen) setHasOpened(true);
    }, [actionsOpen]);

    return (
        <>
        {hasOpened && <ActionsPanel
        isOpen={actionsOpen}
        onClose={() => setActionsOpen(false)}
        onOpenAdvisor={onOpenAdvisor}
        />}
        <button
        title="Action"
        style={{
            width: "3.3rem",
            height: "3.3rem",
            borderRadius: "10px",
            border: hovered
            ? "1px solid rgba(255,255,255,0.2)"
            : actionsOpen
            ? "1px solid rgba(139,92,246,0.5)"
            : "1px solid rgba(255,255,255,0.1)",
            background: actionsOpen
            ? "linear-gradient(145deg, rgba(109,40,217,0.4), rgba(76,29,149,0.4))"
            : hovered
            ? "linear-gradient(145deg, rgba(40,55,80,0.95), rgba(20,30,50,0.95))"
            : "linear-gradient(145deg, rgba(30,42,65,0.95), rgba(15,22,40,0.95))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "all 0.12s ease",
            boxShadow: hovered
            ? "inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 8px rgba(0,0,0,0.4)"
            : "inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.3), 0 2px 6px rgba(0,0,0,0.35)",
            fontSize: "1.2rem",
            outline: "none",
            transform: hovered ? "translateY(-1px)" : "translateY(0)",
            color: "white",
            fontFamily: "sans-serif",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => setActionsOpen(o => !o)}
        >
        ⚡
        </button>
        </>
    );
};

export { Actions };
