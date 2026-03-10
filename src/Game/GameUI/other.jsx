import React from "react";
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

const DateWidget = ({ rightShift }) => (
    <div
    style={{
        ...baseStyle,
        top: "0.5rem",
        right: rightShift,
        height: "4rem",
        width: "18rem",
        transition: "right 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
    }}
    >
    {dayjs().format("MMMM Do, YYYY")}
    </div>
);

const Other = () => (
    <div
    style={{
        ...baseStyle,
        bottom: "0.5rem",
        left: "0.5rem",
        height: "4rem",
        width: "8.75rem",
    }}
    />
);

export { DateWidget, Other };
