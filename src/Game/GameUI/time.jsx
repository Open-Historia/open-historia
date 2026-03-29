import React, { useState, useEffect } from "react";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
import { JSON_URLS, readJson, writeJson } from "../../runtime/assets.js";
dayjs.extend(advancedFormat);

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

const arrowButtonStyle = {
    background: "none",
    border: "none",
    color: "rgba(255,255,255,0.7)",
    cursor: "pointer",
    fontSize: "1.5rem",
    fontWeight: "900",
    width: "2rem",
    height: "2rem",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.15s ease",
    borderRadius: "6px",
    lineHeight: 1,
};

/* ── Timeline Panel ── */
const TimelinePanel = ({ isOpen, onClose, currentDate, onJump }) => {
    const jumpOptions = [
        { label: "1 week",   sublabel: dayjs(currentDate).add(7,   "day").format("M/D/YYYY"),   days: 7   },
        { label: "1 month",  sublabel: dayjs(currentDate).add(1,   "month").format("M/D/YYYY"), days: 30  },
        { label: "3 months", sublabel: dayjs(currentDate).add(3,   "month").format("M/D/YYYY"), days: 90  },
        { label: "6 months", sublabel: dayjs(currentDate).add(6,   "month").format("M/D/YYYY"), days: 180 },
        { label: "1 year",   sublabel: dayjs(currentDate).add(1,   "year").format("M/D/YYYY"),  days: 365 },
    ];

    return (
        <div style={{
            position: "fixed",
            bottom: isOpen ? "5.25rem" : "-30rem",
            left: "0.5rem",

            width: "26.25rem",
            height: "calc(100vh - 33.25rem)",

            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",
            overflowY: "auto",
            scrollbarWidth: "none",

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
        }}>
        {/* Header */}
        <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "1rem 1.25rem 0.75rem",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}>
        <div>
        <div style={{ fontWeight: 700, fontSize: "1rem" }}>Timeline</div>
        <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.45)", marginTop: "0.1rem" }}>
        from {dayjs(currentDate).format("M/D/YYYY")}
        </div>
        </div>
        <button
        onClick={onClose}
        style={{
            background: "none", border: "none",
            color: "rgba(255,255,255,0.5)", cursor: "pointer",
            fontSize: "1.1rem", lineHeight: 1,
            padding: "0.15rem 0.3rem", borderRadius: "6px",
            transition: "color 0.15s, background 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = "white"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.5)"; e.currentTarget.style.background = "none"; }}
        >✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: "1rem 1.25rem 1.25rem", display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
        {/* NOW node */}
        <div style={{
            width: "5.5rem",
            padding: "0.35rem 0",
            borderRadius: "999px",
            border: "2px solid rgba(139,92,246,0.8)",
            background: "rgba(109,40,217,0.2)",
            textAlign: "center",
            fontSize: "0.7rem",
            fontWeight: 700,
            color: "rgba(196,165,255,0.95)",
            letterSpacing: "0.04em",
        }}>
        <div>NOW</div>
        <div style={{ fontWeight: 400, color: "rgba(196,165,255,0.65)", fontSize: "0.65rem" }}>
        {dayjs(currentDate).format("M/D/YYYY")}
        </div>
        </div>

        {jumpOptions.map((opt) => (
            <React.Fragment key={opt.label}>
            <div style={{ width: "2px", height: "1.25rem", background: "rgba(139,92,246,0.4)" }} />
            <JumpNode opt={opt} onJump={onJump} onClose={onClose} />
            </React.Fragment>
        ))}
        </div>
        </div>
    );
};

const JumpNode = ({ opt, onJump, onClose }) => {
    const [hovered, setHovered] = useState(false);
    return (
        <button
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => { onJump(opt.days); }}
        style={{
            width: "12.5rem",
            padding: "0.38rem 0",
            borderRadius: "10px",
            border: hovered ? "1px solid rgba(139,92,246,0.7)" : "1px solid rgba(139,92,246,0.35)",
            background: hovered ? "rgba(109,40,217,0.35)" : "rgba(109,40,217,0.15)",
            color: "white",
            cursor: "pointer",
            textAlign: "center",
            transition: "all 0.12s ease",
            outline: "none",
        }}
        >
        <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>{opt.sublabel}</div>
        <div style={{ fontSize: "0.7rem", color: "rgba(196,165,255,0.7)" }}>{opt.label}</div>
        </button>
    );
};

/* ── DateWidget ── */
const DateWidget = ({ rightShift }) => {
    const [gameData, setGameData] = useState(null);
    const [timelineOpen, setTimelineOpen] = useState(false);

    useEffect(() => {
        readJson(JSON_URLS.game, { defaultValue: {} })
        .then((data) => setGameData(data));
    }, []);

    const changeDate = async (days) => {
        if (!gameData || days == null) return;
        const newDate = dayjs(gameData.gameDate).add(days, 'day').format("YYYY-MM-DD");
        const updated = { ...gameData, gameDate: newDate };
        try {
            await writeJson(JSON_URLS.game, updated, { pretty: true });
            setGameData(updated);
        } catch (err) {
            console.error("Failed to update game date:", err);
        }
    };

    const displayDate = gameData
    ? dayjs(gameData.gameDate).format("MMMM Do, YYYY")
    : "Loading...";

    return (
        <>
        <TimelinePanel
        isOpen={timelineOpen}
        onClose={() => setTimelineOpen(false)}
        currentDate={gameData?.gameDate ?? dayjs().format("YYYY-MM-DD")}
        onJump={(days) => changeDate(days)}
        />

        <div
        style={{
            ...baseStyle,
            top: "0.5rem",
            right: rightShift,
            height: "3.5rem",
            width: "18rem",
            transition: "right 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
            gap: "0.25rem",
            padding: "0 0.5rem",
        }}
        >
        <button
        style={arrowButtonStyle}
        onMouseEnter={e => (e.currentTarget.style.color = "white")}
        onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.6)")}
        title="Go back"
        >{"«"}</button>

        <span style={{ flex: 1, textAlign: "center", fontSize: "0.95rem", letterSpacing: "0.02em" }}>
        {displayDate}
        </span>

        <button
        style={{
            ...arrowButtonStyle,
            color: timelineOpen ? "rgba(196,165,255,0.9)" : "rgba(255,255,255,0.7)",
        }}
        onClick={() => setTimelineOpen(o => !o)}
        onMouseEnter={e => (e.currentTarget.style.color = "white")}
        onMouseLeave={e => (e.currentTarget.style.color = timelineOpen ? "rgba(196,165,255,0.9)" : "rgba(255,255,255,0.7)")}
        title="Jump forward"
        >{"»"}</button>
        </div>
        </>
    );
};

export { DateWidget };
