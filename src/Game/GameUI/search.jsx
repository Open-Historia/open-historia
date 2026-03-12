import React, { useState, useRef, useEffect } from "react";

const Search = ({ mapRef, rightShift }) => {
    const [expanded, setExpanded] = useState(false);
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState(null);
    const [suggestions, setSuggestions] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const inputRef = useRef(null);
    const debounceRef = useRef(null);

    useEffect(() => {
        if (expanded && inputRef.current) {
            inputRef.current.focus();
        }
    }, [expanded]);

    useEffect(() => {
        if (!query.trim() || query.length < 2) {
            setSuggestions([]);
            setSelectedIndex(-1);
            return;
        }
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(async () => {
            try {
                const res = await fetch(
                    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`,
                                        { headers: { "Accept-Language": "en" } }
                );
                const data = await res.json();
                setSuggestions(data);
                setSelectedIndex(-1);
            } catch {
                setSuggestions([]);
            }
        }, 250);
        return () => clearTimeout(debounceRef.current);
    }, [query]);

    const handleToggle = () => {
        if (expanded) {
            setExpanded(false);
            setQuery("");
            setStatus(null);
            setSuggestions([]);
        } else {
            setExpanded(true);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === "Escape") {
            setExpanded(false);
            setQuery("");
            setStatus(null);
            setSuggestions([]);
        } else if (e.key === "ArrowDown") {
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

    const flyToResult = (result) => {
        const map = mapRef?.current;
        if (map) {
            map.flyTo({
                center: [parseFloat(result.lon), parseFloat(result.lat)],
                      zoom: 6,
                      duration: 1800,
                      essential: true,
            });
        }
        setStatus(null);
        setExpanded(false);
        setQuery("");
        setSuggestions([]);
    };

    const flyTo = async (place) => {
        setStatus("loading");
        setSuggestions([]);
        try {
            const res = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1`,
                                    { headers: { "Accept-Language": "en" } }
            );
            const data = await res.json();
            if (!data.length) {
                setStatus("error");
                return;
            }
            flyToResult(data[0]);
        } catch (e) {
            console.error(e);
            setStatus("error");
        }
    };

    const formatSuggestion = (s) => {
        const parts = [];
        if (s.address?.city || s.address?.town || s.address?.village) {
            parts.push(s.address.city || s.address.town || s.address.village);
        }
        if (s.address?.country) parts.push(s.address.country);
        return parts.length > 0 ? parts.join(", ") : s.display_name.split(",").slice(0, 2).join(",");
    };

    const getIcon = (s) => {
        if (s.type === "country" || s.addresstype === "country") return "country";
        if (s.type === "city" || s.addresstype === "city" || s.address?.city) return "city";
        return "pin";
    };

    const hasSuggestions = suggestions.length > 0;

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
            justifyContent: "flex-start",
            zIndex: 9999,
            borderRadius: hasSuggestions && expanded ? "0 0 12px 12px" : "12px",
            backgroundColor: "rgba(17, 24, 39, 0.9)",
            backdropFilter: "blur(4px)",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 4px 6px -1px rgba(0,0,0,0.2)",
            color: "white",
            fontFamily: "sans-serif",
        }}
        onClick={!expanded ? handleToggle : undefined}
        >
        <div style={{ display: "flex", alignItems: "center", width: "100%", height: "3rem", overflow: "hidden" }}>

        {/* Icon button */}
        <button
        onClick={expanded ? handleToggle : undefined}
        style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            width: "3rem",
            height: "3rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: status === "error" ? "#f87171" : "rgba(255,255,255,0.8)",
            transition: "color 0.2s",
            padding: 0,
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
        ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="22" y2="22" />
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
            background: "none",
            border: "none",
            outline: "none",
            color: status === "error" ? "#f87171" : "white",
            fontSize: "0.85rem",
            width: "100%",
            opacity: expanded ? 1 : 0,
            pointerEvents: expanded ? "auto" : "none",
            transition: "opacity 0.2s 0.15s",
            fontFamily: "sans-serif",
        }}
        />

        {/* Go arrow */}
        {expanded && (
            <button
            onClick={() => {
                if (selectedIndex >= 0 && suggestions[selectedIndex]) {
                    flyToResult(suggestions[selectedIndex]);
                } else if (query.trim()) {
                    flyTo(query.trim());
                }
            }}
            style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0 0.6rem",
                height: "3rem",
                color: query.trim() ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.2)",
                      display: "flex",
                      alignItems: "center",
                      flexShrink: 0,
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
        {hasSuggestions && expanded && (
            <div style={{
                position: "absolute",
                bottom: "calc(3rem - 1px)",
                                        left: "-1px",
                                        right: "-1px",
                                        backgroundColor: "rgba(17, 24, 39, 0.97)",
                                        backdropFilter: "blur(4px)",
                                        borderRadius: "12px 12px 0 0",
                                        border: "1px solid rgba(255,255,255,0.1)",
                                        borderBottom: "none",
                                        boxShadow: "0 -6px 16px rgba(0,0,0,0.3)",
                                        overflow: "hidden",
            }}>
            {suggestions.map((s, i) => {
                const icon = getIcon(s);
                return (
                    <div
                    key={s.place_id}
                    onMouseDown={(e) => { e.preventDefault(); flyToResult(s); }}
                    onMouseEnter={() => setSelectedIndex(i)}
                    style={{
                        padding: "0.5rem 0.75rem",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.6rem",
                        backgroundColor: i === selectedIndex ? "rgba(255,255,255,0.07)" : "transparent",
                        borderBottom: i < suggestions.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                        transition: "background-color 0.1s",
                    }}
                    >
                    {/* Icon badge */}
                    {/* Icon badge */}
                    <div style={{
                        width: "22px",
                        height: "22px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                    }}>
                    {icon === "country" ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                    ) : icon === "city" ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round">
                        <rect x="3" y="9" width="18" height="12" rx="1" />
                        <path d="M8 21V9M16 21V9M3 13h18M9 9V5h6v4" />
                        </svg>
                    ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round">
                        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                        <circle cx="12" cy="9" r="2.5" />
                        </svg>
                    )}
                    </div>

                    <span style={{
                        fontSize: "0.8rem",
                        color: "rgba(255,255,255,0.85)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}>
                    {formatSuggestion(s)}
                    </span>
                    </div>
                );
            })}
            </div>
        )}
        </div>
    );
};

export { Search };
