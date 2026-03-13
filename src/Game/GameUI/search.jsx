import React, { useState, useRef, useEffect } from "react";

// ─── Nominatim result → display label ───────────────────────────────────────
const formatSuggestion = (s) => {
    const a = s.address || {};

    // Primary name: prefer explicit English name, then Nominatim-translated address fields
    const primary =
    s.namedetails?.["name:en"] ||
    a.amenity || a.tourism || a.leisure ||
    a.suburb || a.neighbourhood ||
    a.city || a.town || a.village || a.municipality ||
    a.county ||
    s.display_name.split(",")[0].trim();

    // Secondary context: state + country, or just country
    const region = [a.state || a.region, a.country].filter(Boolean).join(", ");

    return { primary, region };
};

// Deduplicate by primary+region combo
const dedup = (results) => {
    const seen = new Set();
    return results.filter((s) => {
        const { primary, region } = formatSuggestion(s);
        const key = `${primary}|${region}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

// ─── Icons ───────────────────────────────────────────────────────────────────
const ICON_GLOBE = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
);
const ICON_CITY = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="9" width="18" height="12" rx="1" />
    <path d="M8 21V9M16 21V9M3 13h18M9 9V5h6v4" />
    </svg>
);
const ICON_PIN = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2" strokeLinecap="round">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
    <circle cx="12" cy="9" r="2.5" />
    </svg>
);
const ICON_REGION = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2" strokeLinecap="round">
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
    </svg>
);

const getIcon = (s) => {
    const type = s.type || s.addresstype || "";
    const cls  = s.class || "";
    if (type === "country" || s.addresstype === "country") return ICON_GLOBE;
    if (["state", "region", "province"].includes(type)) return ICON_REGION;
    if (["city", "town", "village", "municipality", "borough"].includes(type)) return ICON_CITY;
    if (cls === "place") return ICON_CITY;
    return ICON_PIN;
};

// ─── Component ────────────────────────────────────────────────────────────────
const Search = ({ mapRef, rightShift }) => {
    const [expanded, setExpanded]       = useState(false);
    const [query, setQuery]             = useState("");
    const [status, setStatus]           = useState(null); // null | "loading" | "error"
    const [suggestions, setSuggestions] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const inputRef   = useRef(null);
    const debounceRef = useRef(null);

    useEffect(() => {
        if (expanded && inputRef.current) inputRef.current.focus();
    }, [expanded]);

        // ── Autocomplete fetch ──────────────────────────────────────────────────
        useEffect(() => {
            if (!query.trim() || query.length < 2) {
                setSuggestions([]);
                setSelectedIndex(-1);
                return;
            }
            clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(async () => {
                try {
                    const params = new URLSearchParams({
                        q: query,
                        format: "json",
                            limit: 8,
                            addressdetails: 1,
                            namedetails: 1,
                            "accept-language": "en",
                            "accept_language": "en",   // some Nominatim versions use underscore
                    });
                    const res  = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
                        headers: { "Accept-Language": "en, *;q=0.5" },
                    });
                    const data = await res.json();

                    // Deduplicate and cap at 5
                    setSuggestions(dedup(data).slice(0, 5));
                    setSelectedIndex(-1);
                } catch {
                    setSuggestions([]);
                }
            }, 200);
            return () => clearTimeout(debounceRef.current);
        }, [query]);

        // ── Helpers ─────────────────────────────────────────────────────────────
        const close = () => {
            setExpanded(false);
            setQuery("");
            setStatus(null);
            setSuggestions([]);
            setSelectedIndex(-1);
        };

        const flyToResult = (result) => {
            const map = mapRef?.current;
            if (map) {
                map.flyTo({
                    center: [parseFloat(result.lon), parseFloat(result.lat)],
                          zoom: 5,
                          duration: 1800,
                          essential: true,
                });
            }
            close();
        };

        const flyTo = async (place) => {
            setStatus("loading");
            setSuggestions([]);
            try {
                const res  = await fetch(
                    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1&addressdetails=1&namedetails=1&accept-language=en`,
                                         { headers: { "Accept-Language": "en, *;q=0.5" } }
                );
                const data = await res.json();
                if (!data.length) { setStatus("error"); return; }
                flyToResult(data[0]);
            } catch {
                setStatus("error");
            }
        };

        const handleKeyDown = (e) => {
            if (e.key === "Escape") { close(); return; }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((i) => Math.max(i - 1, -1));
            } else if (e.key === "Enter") {
                if (selectedIndex >= 0 && suggestions[selectedIndex]) {
                    flyToResult(suggestions[selectedIndex]);
                } else if (query.trim()) {
                    flyTo(query.trim());
                }
            }
        };

        const commit = () => {
            if (selectedIndex >= 0 && suggestions[selectedIndex]) {
                flyToResult(suggestions[selectedIndex]);
            } else if (query.trim()) {
                flyTo(query.trim());
            }
        };

        // ── Render ───────────────────────────────────────────────────────────────
        const hasSuggestions = expanded && suggestions.length > 0;

        return (
            <div
            style={{
                position: "fixed",
                bottom: "1rem",
                left: "9.8rem",
                height: "3rem",
                width: expanded ? "17rem" : "3rem",
                overflow: "visible",
                transition: "width 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
                cursor: expanded ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                zIndex: 9999,
                borderRadius: hasSuggestions ? "0 0 12px 12px" : "12px",
                backgroundColor: "rgba(17, 24, 39, 0.9)",
                backdropFilter: "blur(4px)",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 4px 6px -1px rgba(0,0,0,0.2)",
                color: "white",
                fontFamily: "sans-serif",
            }}
            onClick={!expanded ? () => setExpanded(true) : undefined}
            >
            <div style={{ display: "flex", alignItems: "center", width: "100%", height: "3rem", overflow: "hidden" }}>

            {/* Toggle / close button */}
            <button
            onClick={expanded ? close : undefined}
            style={{
                background: "none", border: "none", cursor: "pointer",
                width: "3rem", height: "3rem",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, padding: 0,
                color: status === "error" ? "#f87171" : "rgba(255,255,255,0.8)",
                transition: "color 0.2s",
            }}
            title={expanded ? "Close" : "Search place"}
            >
            {status === "loading" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
                </path>
                </svg>
            ) : expanded ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="22" y2="22" />
                </svg>
            )}
            </button>

            {/* Input */}
            <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setStatus(null); }}
            onKeyDown={handleKeyDown}
            placeholder={status === "error" ? "Place not found…" : "Search place…"}
            style={{
                background: "none", border: "none", outline: "none",
                color: status === "error" ? "#f87171" : "white",
                fontSize: "0.85rem", width: "100%",
                opacity: expanded ? 1 : 0,
                pointerEvents: expanded ? "auto" : "none",
                transition: "opacity 0.2s 0.15s",
                fontFamily: "sans-serif",
            }}
            />

            {/* Go arrow */}
            {expanded && (
                <button
                onClick={commit}
                style={{
                    background: "none", border: "none", cursor: "pointer",
                    padding: "0 0.6rem", height: "3rem",
                    color: query.trim() ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.2)",
                          display: "flex", alignItems: "center", flexShrink: 0,
                          transition: "color 0.2s",
                }}
                title="Go"
                >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
                </svg>
                </button>
            )}
            </div>

            {/* Dropdown */}
            {hasSuggestions && (
                <div style={{
                    position: "absolute",
                    bottom: "calc(3rem - 1px)",
                                left: "-1px", right: "-1px",
                                backgroundColor: "rgba(17, 24, 39, 0.97)",
                                backdropFilter: "blur(4px)",
                                borderRadius: "12px 12px 0 0",
                                border: "1px solid rgba(255,255,255,0.1)",
                                borderBottom: "none",
                                boxShadow: "0 -6px 16px rgba(0,0,0,0.3)",
                                overflow: "hidden",
                }}>
                {suggestions.map((s, i) => {
                    const { primary, region } = formatSuggestion(s);
                    return (
                        <div
                        key={s.place_id}
                        onMouseDown={(e) => { e.preventDefault(); flyToResult(s); }}
                        onMouseEnter={() => setSelectedIndex(i)}
                        style={{
                            padding: "0.45rem 0.75rem",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.55rem",
                            backgroundColor: i === selectedIndex ? "rgba(255,255,255,0.08)" : "transparent",
                            borderBottom: i < suggestions.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                            transition: "background-color 0.1s",
                        }}
                        >
                        <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                        {getIcon(s)}
                        </div>

                        {/* Two-line label */}
                        <div style={{ overflow: "hidden" }}>
                        <div style={{
                            fontSize: "0.82rem",
                            color: "rgba(255,255,255,0.9)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            lineHeight: 1.3,
                        }}>
                        {primary}
                        </div>
                        {region && (
                            <div style={{
                                fontSize: "0.72rem",
                                color: "rgba(255,255,255,0.4)",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    lineHeight: 1.3,
                            }}>
                            {region}
                            </div>
                        )}
                        </div>
                        </div>
                    );
                })}
                </div>
            )}
            </div>
        );
};

export { Search };
