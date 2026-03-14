import React, { useState, useEffect } from "react";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
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

const DateWidget = ({ rightShift }) => {
    const [gameData, setGameData] = useState(null);

    useEffect(() => {
        fetch('/saves/save0/game.json')
        .then(res => res.json())
        .then(data => setGameData(data));
    }, []);

    const changeDate = async (delta) => {
        if (!gameData) return;
        const newDate = dayjs(gameData.gameDate).add(delta, 'day').format("YYYY-MM-DD");
        const updated = { ...gameData, gameDate: newDate };
        await fetch('/saves/save0/game.json', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated, null, 2),
        });
        setGameData(updated);
    };

    const displayDate = gameData
    ? dayjs(gameData.gameDate).format("MMMM Do, YYYY")
    : "Loading...";

    return (
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
        >
        {"«"}
        </button>
        <span style={{ flex: 1, textAlign: "center", fontSize: "0.95rem", letterSpacing: "0.02em" }}>
        {displayDate}
        </span>
        <button
        style={arrowButtonStyle}
        onClick={() => changeDate(30)}
        onMouseEnter={e => (e.currentTarget.style.color = "white")}
        onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.6)")}
        title="Go forward"
        >
        {"»"}
        </button>
        </div>
    );
};
export { DateWidget };
