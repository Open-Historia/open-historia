import React, { memo, useEffect, useRef, useState } from "react";

const SEARCH_HEADERS = { "Accept-Language": "en, *;q=0.5" };
const SEARCH_RESULT_CACHE = new Map();

const formatSuggestion = (suggestion) => {
  const address = suggestion.address || {};

  const primary =
    suggestion.namedetails?.["name:en"] ||
    address.amenity ||
    address.tourism ||
    address.leisure ||
    address.suburb ||
    address.neighbourhood ||
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.county ||
    suggestion.display_name.split(",")[0].trim();

  const region = [address.state || address.region, address.country]
    .filter(Boolean)
    .join(", ");

  return { primary, region };
};

const dedup = (results) => {
  const seen = new Set();
  return results.filter((suggestion) => {
    const { primary, region } = formatSuggestion(suggestion);
    const key = `${primary}|${region}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const buildSearchParams = (query, limit) =>
  new URLSearchParams({
    q: query,
    format: "json",
    limit: String(limit),
    addressdetails: "1",
    namedetails: "1",
    "accept-language": "en",
    accept_language: "en",
  });

const fetchPlaces = async (query, limit, { signal } = {}) => {
  const trimmedQuery = query.trim();
  const cacheKey = `${trimmedQuery.toLowerCase()}::${limit}`;
  if (SEARCH_RESULT_CACHE.has(cacheKey)) {
    return SEARCH_RESULT_CACHE.get(cacheKey);
  }

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${buildSearchParams(trimmedQuery, limit)}`,
    { headers: SEARCH_HEADERS, signal },
  );
  if (!response.ok) {
    throw new Error(`Search failed: HTTP ${response.status}`);
  }
  const data = await response.json();
  const results = dedup(data).slice(0, limit);
  SEARCH_RESULT_CACHE.set(cacheKey, results);
  return results;
};

const ICON_GLOBE = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="rgba(255,255,255,0.45)"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const ICON_CITY = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="rgba(255,255,255,0.45)"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <rect x="3" y="9" width="18" height="12" rx="1" />
    <path d="M8 21V9M16 21V9M3 13h18M9 9V5h6v4" />
  </svg>
);

const ICON_PIN = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="rgba(255,255,255,0.45)"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
    <circle cx="12" cy="9" r="2.5" />
  </svg>
);

const ICON_REGION = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="rgba(255,255,255,0.45)"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
  </svg>
);

const getIcon = (suggestion) => {
  const type = suggestion.type || suggestion.addresstype || "";
  const kind = suggestion.class || "";
  if (type === "country" || suggestion.addresstype === "country") return ICON_GLOBE;
  if (["state", "region", "province"].includes(type)) return ICON_REGION;
  if (["city", "town", "village", "municipality", "borough"].includes(type)) return ICON_CITY;
  if (kind === "place") return ICON_CITY;
  return ICON_PIN;
};

const Search = memo(({ mapRef }) => {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const searchAbortRef = useRef(null);

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      clearTimeout(debounceRef.current);
      searchAbortRef.current?.abort();
      setSuggestions([]);
      setSelectedIndex(-1);
      return undefined;
    }

    clearTimeout(debounceRef.current);
    searchAbortRef.current?.abort();

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbortRef.current = controller;

      try {
        const results = await fetchPlaces(query, 5, { signal: controller.signal });
        if (searchAbortRef.current !== controller) return;
        setSuggestions(results);
        setSelectedIndex(-1);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSuggestions([]);
      }
    }, 200);

    return () => {
      clearTimeout(debounceRef.current);
      searchAbortRef.current?.abort();
    };
  }, [query]);

  const close = () => {
    clearTimeout(debounceRef.current);
    searchAbortRef.current?.abort();
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
        center: [Number.parseFloat(result.lon), Number.parseFloat(result.lat)],
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
      const [result] = await fetchPlaces(place, 1);
      if (!result) {
        setStatus("error");
        return;
      }

      flyToResult(result);
    } catch {
      setStatus("error");
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      close();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, suggestions.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, -1));
      return;
    }

    if (event.key === "Enter") {
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          height: "3rem",
          overflow: "hidden",
        }}
      >
        <button
          onClick={expanded ? close : undefined}
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
            padding: 0,
            color: status === "error" ? "#f87171" : "rgba(255,255,255,0.8)",
            transition: "color 0.2s",
          }}
          title={expanded ? "Close" : "Search place"}
        >
          {status === "loading" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round">
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0 12 12"
                  to="360 12 12"
                  dur="0.8s"
                  repeatCount="indefinite"
                />
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

        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setStatus(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={status === "error" ? "Place not found..." : "Search place..."}
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

        {expanded && (
          <button
            onClick={commit}
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

      {hasSuggestions && (
        <div
          style={{
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
          }}
        >
          {suggestions.map((suggestion, index) => {
            const { primary, region } = formatSuggestion(suggestion);

            return (
              <div
                key={suggestion.place_id}
                onMouseDown={(event) => {
                  event.preventDefault();
                  flyToResult(suggestion);
                }}
                onMouseEnter={() => setSelectedIndex(index)}
                style={{
                  padding: "0.45rem 0.75rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.55rem",
                  backgroundColor:
                    index === selectedIndex ? "rgba(255,255,255,0.08)" : "transparent",
                  borderBottom:
                    index < suggestions.length - 1
                      ? "1px solid rgba(255,255,255,0.05)"
                      : "none",
                  transition: "background-color 0.1s",
                }}
              >
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                  {getIcon(suggestion)}
                </div>

                <div style={{ overflow: "hidden" }}>
                  <div
                    style={{
                      fontSize: "0.82rem",
                      color: "rgba(255,255,255,0.9)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      lineHeight: 1.3,
                    }}
                  >
                    {primary}
                  </div>
                  {region && (
                    <div
                      style={{
                        fontSize: "0.72rem",
                        color: "rgba(255,255,255,0.4)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        lineHeight: 1.3,
                      }}
                    >
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
});

export { Search };
