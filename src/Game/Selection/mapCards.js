/*! Open Historia — what the map's selection cards share © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The region, unit and feature cards (Regions.jsx, Units.jsx, Features.jsx)
// each point at a spot on the map. All but the hook is pure, so it runs in node
// tests.

import { useEffect, useState } from "react";

const toRad = (deg) => (deg * Math.PI) / 180;

export const isGlobeProjection = (map) => {
  try {
    return map?.getProjection?.()?.type === "globe";
  } catch {
    return false;
  }
};

// Whether a point is on the far side of the globe from the view's centre.
export const isBehindGlobe = (center, lngLat) => {
  const lat1 = toRad(center.lat);
  const lat2 = toRad(lngLat.lat);
  const dLng = toRad(lngLat.lng - center.lng);
  return Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLng) < 0;
};

const onScreen = (map, point) => {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const container = map.getContainer?.();
  const width = container?.clientWidth;
  const height = container?.clientHeight;
  if (!(width > 0 && height > 0)) return { x: point.x, y: point.y };
  if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) return null;
  return { x: point.x, y: point.y };
};

// The spot on screen a card points at, or null while there is none: behind the
// globe, or off the edge of the screen. The horizon test belongs to the globe
// alone. It used to run on the flat map too, the default view, where a zoomed-out
// window shows far more than half the world round: a place more than 90 degrees
// of longitude from the centre (Japan, with the view on Africa) opened no card
// until the player panned towards it. The flat map repeats the world side by
// side, so a copy a whole turn east or west may be the one on screen.
export const cardScreenPoint = (map, lngLat) => {
  const lng = Number(lngLat?.lng);
  const lat = Number(lngLat?.lat);
  if (!map || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (isGlobeProjection(map)) {
    const center = map.getCenter();
    if (center && isBehindGlobe(center, { lng, lat })) return null;
    return onScreen(map, map.project({ lng, lat }));
  }
  for (const shift of [0, 360, -360]) {
    const point = onScreen(map, map.project({ lng: lng + shift, lat }));
    if (point) return point;
  }
  return null;
};

// Whether a click landed on the place whose card is already open, which closes
// it; any other place replaces it. Names are not identities: two structures
// called "Naval Base", two towns of one name, a drawn map's many "New Region"s.
const SAME_SPOT_DEGREES = 1e-5;
const cleanId = (value) => String(value ?? "").trim();

export const isSameFeatureSelection = (current, next) => {
  if (!current || !next || current.source !== next.source) return false;
  const currentId = cleanId(current.id);
  const nextId = cleanId(next.id);
  if (currentId && nextId) return currentId === nextId;
  // A city carries no id: its name at its own spot.
  return current.name === next.name
    && Math.abs(Number(current.lng) - Number(next.lng)) <= SAME_SPOT_DEGREES
    && Math.abs(Number(current.lat) - Number(next.lat)) <= SAME_SPOT_DEGREES;
};

export const isSameRegionSelection = (current, next) => {
  if (!current || !next) return false;
  const currentId = cleanId(current.GID_1);
  const nextId = cleanId(next.GID_1);
  if (currentId && nextId) return currentId === nextId;
  return current.COUNTRY === next.COUNTRY && current.NAME_1 === next.NAME_1;
};

// A card's spot on screen, followed as the camera moves (once a frame at most).
// null while `active` is off (a phone's sheet follows no point) or the spot is
// not on screen.
export const useCardScreenPos = (map, anchor, active = true) => {
  const [screenPos, setScreenPos] = useState(null);
  const lng = anchor?.lng;
  const lat = anchor?.lat;

  useEffect(() => {
    if (!map || !active || !Number.isFinite(lng) || !Number.isFinite(lat)) {
      setScreenPos(null);
      return undefined;
    }

    const update = () => {
      const point = cardScreenPoint(map, { lng, lat });
      setScreenPos((prev) => {
        if (!point) return null;
        if (prev && Math.abs(prev.x - point.x) < 0.5 && Math.abs(prev.y - point.y) < 0.5) return prev;
        return point;
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
  }, [map, active, lng, lat]);

  return screenPos;
};
