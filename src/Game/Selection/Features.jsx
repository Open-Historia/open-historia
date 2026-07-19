/*! Open Historia — map feature (city/structure) selection UI © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";
import { useWorldState } from "../Map/useWorldState.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";

let _setSelection = null;
let _currentSelection = null;
let _dismiss = null;

// Called by the map click dispatcher (Nations.jsx) when a city or a built
// structure (world.markers) is clicked. The payload is everything the popup
// shows — cities are stateless tile features, so it all rides the click:
// { source: "city"|"marker", id?, name, kind?, population?, capital?, tier?, lng, lat }
export const onFeatureSelected = (payload) => {
  if (!_setSelection || !payload?.name) return;

  const isSame =
    _currentSelection &&
    _currentSelection.name === payload.name &&
    _currentSelection.source === payload.source;
  if (isSame) {
    _dismiss?.();
    return;
  }
  if (_currentSelection) _dismiss?.();
  _setSelection(payload);
};

// Called when another selection (unit, region, empty space) takes over.
export const dismissFeaturePopup = () => {
  if (_currentSelection) _dismiss?.();
};

// DOM-side emoji per kind (the on-map glyphs are font-limited; the popup isn't).
const KIND_EMOJI = [
  [/city|town|settlement|metropolis|capital/, "🏙"],
  [/military base|army base|fort|fortress|barracks|garrison|outpost|citadel|castle/, "🏰"],
  [/bunker|shelter/, "🛡"],
  [/missile|silo|launch/, "🚀"],
  [/embassy|consulate/, "🏛"],
  [/port|harbor|harbour|naval/, "⚓"],
  [/airbase|airfield|airport|air base/, "✈"],
  [/nuclear|reactor|plant|power/, "⚡"],
  [/factory|industrial|refinery|mine/, "🏭"],
  [/radar|listening|intelligence|spy/, "📡"],
  [/monument|memorial|shrine|temple|cathedral|mosque/, "🗿"],
];

const emojiForKind = (kind) => {
  const normalized = String(kind || "").toLowerCase();
  for (const [pattern, emoji] of KIND_EMOJI) {
    if (pattern.test(normalized)) return emoji;
  }
  return "📍";
};

const titleCase = (value) =>
  String(value || "")
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");

const TIER_LABEL = { 1: "Town", 2: "City", 3: "Major city", 4: "Capital" };

const ANIM_ID = "feature-popup-anims";
if (typeof document !== "undefined" && !document.getElementById(ANIM_ID)) {
  const style = document.createElement("style");
  style.id = ANIM_ID;
  style.textContent = `
  @keyframes featurePopupFadeIn {
    from { opacity: 0; transform: translateY(calc(-100% + 10px)); }
    to   { opacity: 1; transform: translateY(-100%); }
  }
  @keyframes featurePopupFadeOut {
    from { opacity: 1; transform: translateY(-100%); }
    to   { opacity: 0; transform: translateY(calc(-100% + 10px)); }
  }`;
  document.head.appendChild(style);
}

const DetailRow = ({ label, value }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", fontSize: "11px", color: "rgba(255,255,255,0.6)", marginTop: "3px" }}>
    <span style={{ flexShrink: 0 }}>{label}</span>
    <span style={{ color: "rgba(255,255,255,0.9)", textAlign: "right", wordBreak: "break-word" }}>{value}</span>
  </div>
);

const FeaturePopup = () => {
  const [selection, setSelection] = useState(null);
  const [screenPos, setScreenPos] = useState(null);
  const [animKey, setAnimKey] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const { current: map } = useMap();
  const { markers } = useWorldState();

  _setSelection = (value) => {
    _currentSelection = value;
    setDismissing(false);
    setSelection(value);
    if (value !== null) setAnimKey((key) => key + 1);
  };

  _dismiss = () => setDismissing(true);

  // A selected structure tracks live world state: rebuilt-in-place markers
  // refresh the popup, a destroyed one closes it. Cities are static.
  const liveMarker = selection?.source === "marker"
    ? markers.find((marker) => marker.id === selection.id) ?? null
    : null;

  useEffect(() => {
    if (selection?.source === "marker" && !liveMarker) _dismiss?.();
  }, [selection, liveMarker]);

  const handleAnimationEnd = (e) => {
    if (e.animationName !== "featurePopupFadeOut") return;
    _currentSelection = null;
    setSelection(null);
    setDismissing(false);
  };

  useEffect(() => {
    if (!map || !selection) {
      setScreenPos(null);
      return undefined;
    }

    const update = () => {
      const center = map.getCenter();
      const toRad = (deg) => (deg * Math.PI) / 180;
      const anchor = { lng: selection.lng, lat: selection.lat };
      const lat1 = toRad(center.lat);
      const lat2 = toRad(anchor.lat);
      const dLng = toRad(anchor.lng - center.lng);
      const cosAngle =
        Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLng);

      // On the globe, points around the horizon have no meaningful screen spot.
      if (cosAngle < 0) {
        setScreenPos(null);
        return;
      }

      const point = map.project(anchor);
      setScreenPos((prev) => {
        if (prev && Math.abs(prev.x - point.x) < 0.5 && Math.abs(prev.y - point.y) < 0.5) {
          return prev;
        }
        return { x: point.x, y: point.y };
      });
    };

    let frameId = 0;
    const scheduleUpdate = () => {
      if (frameId) return;
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        update();
      });
    };

    update();
    map.on("move", scheduleUpdate);
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      map.off("move", scheduleUpdate);
    };
  }, [map, selection]);

  // Hook order must not depend on the selection — called before any return.
  const ownerName = useCountryDisplayName(liveMarker?.ownerCode || selection?.ownerCode || "");

  if (!selection || !screenPos) return null;

  const feature = liveMarker
    ? { ...selection, ...liveMarker }
    : selection;

  const isCity = selection.source === "city";
  const kind = isCity
    ? (feature.capital === "primary" ? "Capital city" : TIER_LABEL[feature.tier] || "City")
    : titleCase(feature.kind || "Landmark");
  const population = Number(feature.population);

  const POPUP_WIDTH = 220;

  return createPortal(
    <div
      key={animKey}
      onAnimationEnd={handleAnimationEnd}
      style={{
        position: "fixed",
        left: screenPos.x - POPUP_WIDTH / 2,
        top: screenPos.y - 14,
        width: `${POPUP_WIDTH}px`,
        zIndex: 21,
        pointerEvents: dismissing ? "none" : "auto",
        animation: dismissing
          ? "featurePopupFadeOut 0.18s cubic-bezier(0.4, 0, 1, 1) both"
          : "featurePopupFadeIn 0.22s cubic-bezier(0.22, 1, 0.36, 1) both",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(17, 24, 39, 0.96)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          borderRadius: "12px",
          overflow: "hidden",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.12)",
          color: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "10px 12px 8px" }}>
          <span style={{ fontSize: "1.5rem", lineHeight: 1 }}>
            {isCity ? (feature.capital === "primary" ? "⭐" : "🏙") : emojiForKind(feature.kind)}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: "13px", wordBreak: "break-word" }}>{feature.name}</div>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>
              Map Feature · {kind}
            </div>
          </div>
          <button
            onClick={() => _dismiss?.()}
            style={{
              background: "rgba(17,24,39,0.7)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "6px",
              width: "20px",
              height: "20px",
              cursor: "pointer",
              color: "rgba(255,255,255,0.5)",
              fontSize: "11px",
              padding: 0,
              flexShrink: 0,
            }}
          >
            {"✕"}
          </button>
        </div>

        <div style={{ padding: "0 12px 10px" }}>
          {ownerName ? <DetailRow label="Owner" value={ownerName} /> : null}
          {Number.isFinite(population) && population > 0 ? (
            <DetailRow label="Population" value={population.toLocaleString()} />
          ) : null}
          {feature.foundedAt ? <DetailRow label="Founded" value={feature.foundedAt} /> : null}
          <DetailRow label="Location" value={`${feature.lat.toFixed(2)}, ${feature.lng.toFixed(2)}`} />
          {feature.note ? (
            <div style={{ marginTop: "8px", fontSize: "11px", lineHeight: 1.45, color: "rgba(255,255,255,0.75)" }}>
              {feature.note}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default FeaturePopup;
