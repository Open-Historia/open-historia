/*! Open Historia — portions (mobile country/date row) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { memo, useEffect, useState } from "react";
import { JSON_URLS, readJson } from "../../runtime/assets.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
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
const Other = memo(function Other({ topOffset = "0.5rem" }) {
    const [country, setCountry] = useState(null);
    const isMobile = useIsMobile();
    useEffect(() => {
        readJson(JSON_URLS.game, { defaultValue: {} })
        .then((data) => setCountry(data.country))
        .catch((err) => console.error("Failed to load game.json:", err));
    }, []);
    // On phones the country name renders inside the date widget instead —
    // this pill and the date widget would overlap on a portrait screen.
    if (isMobile || !country) return null;
    return (
        <div
        style={{
            ...baseStyle,
            top: topOffset,
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
