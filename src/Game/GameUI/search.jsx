/*! Open Historia — portions (mobile search layout) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useWorldState } from "../Map/useWorldState.js";
import { focusFeature } from "../Selection/Features.jsx";
import {
  buildLocalPlaceEntries,
  dedupeGeocodedPlaces,
  formatGeocodedPlace,
  geocodedPlaceFraming,
  geocodedPlaceKind,
  getWorldPlaceIndex,
  rankGeocodedPlaces,
  searchLocalPlaces,
  subscribeWorldPlaceIndex,
} from "../../runtime/placeSearch.js";
import { BESIDE_DOCK_LEFT, DOCK_BOTTOM_REM, DOCK_BUTTON_BOTTOM, DOCK_HEIGHT_REM, DOCK_LEFT_REM } from "./hudDock.js";

// A small magnifier beside the launcher dock, not a fifth launcher: smaller
// than the dock's buttons and sitting on the same baseline as their bottoms.
// Open on a phone it becomes a full-width bar, and a finger needs the extra
// height there.
const COMPACT_SIZE = "2.4rem";
const PHONE_BAR_SIZE = "3rem";

// Photon, not Nominatim: the OSM foundation's Nominatim policy forbids client-side autocomplete outright, and it shows, since it answers "berl" with an office block in Brussels. Photon is the same data, indexed for search as you type.
const SEARCH_ENDPOINT = "https://photon.komoot.io/api/";
const SEARCH_RESULT_CACHE = new Map();
const SEARCH_DEBOUNCE_MS = 300;
const REMOTE_FETCH_LIMIT = 10;

const buildSearchParams = (query, limit) =>
  new URLSearchParams({
    q: query,
    limit: String(limit),
    lang: "en",
  });

const fetchPlaces = async (query, limit, { signal } = {}) => {
  const trimmedQuery = query.trim();
  const cacheKey = `${trimmedQuery.toLowerCase()}::${limit}`;
  if (SEARCH_RESULT_CACHE.has(cacheKey)) {
    return SEARCH_RESULT_CACHE.get(cacheKey);
  }

  const response = await fetch(`${SEARCH_ENDPOINT}?${buildSearchParams(trimmedQuery, limit)}`, { signal });
  if (!response.ok) {
    throw new Error(`Search failed: HTTP ${response.status}`);
  }
  const data = await response.json();
  const results = rankGeocodedPlaces(dedupeGeocodedPlaces(data?.features)).slice(0, limit);
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

const KIND_ICON = {
  country: ICON_GLOBE,
  region: ICON_REGION,
  settlement: ICON_CITY,
};

// The world's own places outrank the geocoder's and are worth a closer camera.
const FAMILY_ICON = { settlement: ICON_CITY, polity: ICON_GLOBE };
const LOCAL_RESULT_LIMIT = 4;
const SUGGESTION_LIMIT = 7;
const LOCAL_ZOOM = 7;
const POLITY_ZOOM = 4;
const NO_LOCAL_PLACES = [];
const NO_REMOTE_RESULTS = { query: "", results: [] };

const remoteEntry = (feature) => {
  const { primary, region } = formatGeocodedPlace(feature);
  const framing = geocodedPlaceFraming(feature);
  const properties = feature.properties ?? {};
  return {
    key: `osm:${properties.osm_type}${properties.osm_id}:${framing.lng},${framing.lat}`,
    local: false,
    icon: KIND_ICON[geocodedPlaceKind(feature)] ?? ICON_PIN,
    primary,
    region,
    ...framing,
  };
};

const localEntry = (place) => ({
  key: place.key,
  local: true,
  icon: FAMILY_ICON[place.family] ?? ICON_PIN,
  primary: place.name,
  region: place.detail,
  lng: place.lng,
  lat: place.lat,
  zoom: place.source === "polity" ? POLITY_ZOOM : LOCAL_ZOOM,
  payload: place.payload,
  lookup: place.lookup,
});

const Search = memo(({ mapRef }) => {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(null);
  const [remote, setRemote] = useState(NO_REMOTE_RESULTS);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const { markers, cityRenames, polityOverrides } = useWorldState();
  const placeIndex = useSyncExternalStore(subscribeWorldPlaceIndex, getWorldPlaceIndex, getWorldPlaceIndex);
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
      setRemote(NO_REMOTE_RESULTS);
      setSelectedIndex(-1);
      return undefined;
    }

    clearTimeout(debounceRef.current);
    searchAbortRef.current?.abort();

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbortRef.current = controller;

      try {
        const results = await fetchPlaces(query, REMOTE_FETCH_LIMIT, { signal: controller.signal });
        if (searchAbortRef.current !== controller) return;
        setRemote({ query: query.trim(), results });
        setSelectedIndex(-1);
      } catch (error) {
        if (controller.signal.aborted) return;
        setRemote({ query: query.trim(), results: [] });
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(debounceRef.current);
      searchAbortRef.current?.abort();
    };
  }, [query]);

  // All in memory already, so no network and no debounce, and only while the bar is open.
  const localPlaces = useMemo(
    () => (expanded
      ? buildLocalPlaceEntries({
        cities: placeIndex.cities,
        polities: placeIndex.polities,
        markers,
        cityRenames,
        polityOverrides,
      })
      : NO_LOCAL_PLACES),
    [expanded, placeIndex, markers, cityRenames, polityOverrides],
  );

  const suggestions = useMemo(() => {
    const typed = query.trim();
    // Same two-character floor the geocoder gets: one letter matches half a world.
    const local = typed.length < 2
      ? []
      : searchLocalPlaces(localPlaces, query, LOCAL_RESULT_LIMIT).map(localEntry);
    const named = new Set(local.map((entry) => entry.primary.toLowerCase()));

    // A geocoder round trip lands well after the keystroke that asked for it. Results for a prefix of what is typed are on their way to being right and stay, dimmed; anything else answers a search that is no longer on screen.
    const answered = remote.query.toLowerCase();
    const stale = answered !== typed.toLowerCase();
    const usable = answered && (!stale || typed.toLowerCase().startsWith(answered));

    const geocoded = usable
      ? remote.results
        .map((suggestion) => ({ ...remoteEntry(suggestion), stale }))
        .filter((entry) => !named.has(entry.primary.toLowerCase()))
      : [];

    return [...local, ...geocoded].slice(0, SUGGESTION_LIMIT);
  }, [localPlaces, query, remote]);

  const close = () => {
    clearTimeout(debounceRef.current);
    searchAbortRef.current?.abort();
    setExpanded(false);
    setQuery("");
    setStatus(null);
    setRemote(NO_REMOTE_RESULTS);
    setSelectedIndex(-1);
  };

  const flyToEntry = async (entry) => {
    if (!entry) return;

    // A renamed stock place carries only its new name; the geocoder knows the old one.
    if (!Number.isFinite(entry.lng) || !Number.isFinite(entry.lat)) {
      await flyToQuery(entry.lookup || entry.primary);
      return;
    }

    const map = mapRef?.current;
    if (map && entry.bounds) {
      map.fitBounds(entry.bounds, { padding: 80, duration: 1800, essential: true });
    } else if (map) {
      map.flyTo({
        center: [entry.lng, entry.lat],
        zoom: entry.zoom,
        duration: 1800,
        essential: true,
      });
    }

    // The popup tracks the camera, so it can open before the flight lands.
    if (entry.payload) focusFeature(entry.payload);

    close();
  };

  const flyToQuery = async (place) => {
    setStatus("loading");
    setRemote(NO_REMOTE_RESULTS);

    try {
      const [result] = await fetchPlaces(place, REMOTE_FETCH_LIMIT);
      if (!result) {
        setStatus("error");
        return;
      }

      await flyToEntry(remoteEntry(result));
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
      commit();
    }
  };

  // Enter takes the highlighted row, else the top one, but never a row still answering an older query.
  const commit = () => {
    const highlighted = selectedIndex >= 0 ? suggestions[selectedIndex] : null;
    const target = highlighted ?? (suggestions[0]?.stale ? null : suggestions[0]);
    if (target) {
      void flyToEntry(target);
    } else if (query.trim()) {
      void flyToQuery(query.trim());
    }
  };

  const hasSuggestions = expanded && suggestions.length > 0;
  const phoneBar = expanded && isMobile;
  const size = phoneBar ? PHONE_BAR_SIZE : COMPACT_SIZE;

  return (
    <div
      style={{
        position: "fixed",
        // Desktop: sits right of the launcher dock, level with the bottoms of
        // its buttons, and expands rightward. Phones: the expanded box wouldn't
        // fit there, so it opens as a full-width bar just above the dock.
        bottom: phoneBar ? `${DOCK_BOTTOM_REM + DOCK_HEIGHT_REM + 0.5}rem` : DOCK_BUTTON_BOTTOM,
        // hudDock.js derives this from the dock's launcher count, so a new
        // launcher can't end up underneath it.
        left: phoneBar ? `${DOCK_LEFT_REM}rem` : BESIDE_DOCK_LEFT,
        height: size,
        width: expanded ? (isMobile ? "calc(100vw - 1rem)" : "17rem") : size,
        overflow: "visible",
        transition: "width 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
        cursor: expanded ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        zIndex: 9999,
        borderRadius: hasSuggestions ? "0 0 10px 10px" : "10px",
        backgroundColor: "var(--oh-hud-bg)",
        backdropFilter: "var(--oh-hud-blur)",
        border: "1px solid var(--oh-hud-border)",
        boxShadow: "var(--oh-hud-shadow-soft)",
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
          height: size,
          overflow: "hidden",
        }}
      >
        <button
          onClick={expanded ? close : undefined}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            width: size,
            height: size,
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
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
            setSelectedIndex(-1);
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
              height: size,
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
            bottom: `calc(${size} - 1px)`,
            left: "-1px",
            right: "-1px",
            backgroundColor: "var(--oh-hud-bg-strong)",
            backdropFilter: "var(--oh-hud-blur)",
            borderRadius: "10px 10px 0 0",
            border: "1px solid var(--oh-hud-border)",
            borderBottom: "none",
            boxShadow: "0 -6px 16px rgba(0,0,0,0.3)",
            overflow: "hidden",
          }}
        >
          {suggestions.map((suggestion, index) => (
            <div
              key={suggestion.key}
              onMouseDown={(event) => {
                event.preventDefault();
                void flyToEntry(suggestion);
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
                opacity: suggestion.stale ? 0.5 : 1,
                borderBottom:
                  index < suggestions.length - 1
                    ? "1px solid rgba(255,255,255,0.05)"
                    : "none",
                transition: "background-color 0.1s",
              }}
            >
              <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                {suggestion.icon}
              </div>

              <div style={{ overflow: "hidden", flex: 1 }}>
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
                  {suggestion.primary}
                </div>
                {suggestion.region && (
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
                    {suggestion.region}
                  </div>
                )}
              </div>

              {suggestion.local && (
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: "0.56rem",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.45)",
                    border: "1px solid rgba(255,255,255,0.18)",
                    borderRadius: "999px",
                    padding: "1px 5px",
                  }}
                >
                  In world
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export { Search };
