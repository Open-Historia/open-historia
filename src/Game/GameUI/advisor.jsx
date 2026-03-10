import React from "react";

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

const AdvisorPanel = ({ isAdvisorOpen }) => (
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
    <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>
    Advisor
    </h2>
    </div>

    {/* Panel Content */}
    <div style={{ padding: "1.25rem", flex: 1, overflowY: "auto" }}>
    <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)", marginTop: 0 }}>
    No messages yet. Ask your advisor something!
    </p>
    </div>

    {/* Text Input Area */}
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
    onInput={(e) => {
        e.target.style.height = "auto";
    }}
    style={{
        flex: 1,
        backgroundColor: "rgba(255,255,255,0.07)",
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
    style={{
        backgroundColor: "#3b82f6",
        border: "none",
        borderRadius: "10px",
        width: "2.5rem",
        height: "2.5rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
        fontSize: "1rem",
        transition: "background-color 0.2s",
    }}
    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#2563eb")}
    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#3b82f6")}
    >
    🚀
    </button>

    </div>
    </div>
);

export { ADVISOR_PANEL_WIDTH, AdvisorButton, AdvisorPanel };
