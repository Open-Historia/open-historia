import React, { memo, useEffect, useState } from "react";
import { JSON_URLS, readJson } from "../../runtime/assets.js";
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
const Other = memo(function Other() {
    const [country, setCountry] = useState(null);
    useEffect(() => {
        readJson(JSON_URLS.game, { defaultValue: {} })
        .then((data) => setCountry(data.country))
        .catch((err) => console.error("Failed to load game.json:", err));
    }, []);
    if (!country) return null;
    return (
        <div
        style={{
            ...baseStyle,
            top: "0.5rem",
            left: "4.75rem",
            height: "2.75rem",
            width: "16rem",
            boxSizing: "border-box",
        }}
        >
        <span
        style={{
            fontSize: "15px",
            fontWeight: "700",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        }}
        >
        {country}
        </span>
        </div>
    );
});
export { Other };
