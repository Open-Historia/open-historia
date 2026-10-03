/*! Open Historia — this game's detailed map, in Settings → Map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// For a game whose scenario names a detailed map (docs/adr/0005, 0006): whether
// the player has it, and a Download or Update button. Someone who said "Not now"
// to the offer when they installed the scenario, or over the map, finds it here.
import React, { useEffect, useRef, useState } from "react";
import {
  fetchOfficialBasemaps,
  findOfficialBasemap,
  findOfficialEntry,
  findTiledBasemap,
  formatBytes,
  installOfficialBasemap,
  subscribeTiledBasemaps,
} from "../../runtime/tiledBasemaps.js";
import { scenarioTiledBasemap, tiledBasemapOffer } from "./scenarioTerrain.js";
import { useWorldBackground } from "./useWorldState.js";

const button = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.10)",
  color: "inherit",
  fontSize: 12.5,
  cursor: "pointer",
};

export default function ScenarioDetailedMapSetting({ labelStyle, helperStyle, fieldGroupStyle }) {
  const { background } = useWorldBackground();
  const named = scenarioTiledBasemap(background);
  const namedKey = named ? JSON.stringify(named) : "";
  const [state, setState] = useState(null); // { installed, offer }
  const [progress, setProgress] = useState(null); // null | { percent }
  const [error, setError] = useState("");
  const [libraryVersion, setLibraryVersion] = useState(0);
  const controllerRef = useRef(null);

  useEffect(() => subscribeTiledBasemaps(() => setLibraryVersion((v) => v + 1)), []);
  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    if (!named || import.meta.env.VITE_OH_WEB) return undefined;
    let cancelled = false;
    (async () => {
      const installed = named.id ? await findOfficialBasemap(named.id) : await findTiledBasemap(named.hash);
      const officialId = named.id || installed?.official?.id;
      const official = officialId ? findOfficialEntry(await fetchOfficialBasemaps(), officialId) : null;
      if (cancelled) return;
      const { missing, update } = tiledBasemapOffer({ named, installed, official });
      setState({ installed, offer: missing || update });
    })();
    return () => { cancelled = true; };
    // namedKey stands in for `named`, which is rebuilt on every render.
  }, [namedKey, libraryVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!named) return null;

  const start = async () => {
    const offer = state?.offer;
    if (!offer?.id || !offer.version) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError("");
    setProgress({ percent: null });
    try {
      await installOfficialBasemap({
        id: offer.id,
        version: offer.version,
        signal: controller.signal,
        onProgress: ({ received, total }) => setProgress({ percent: total ? Math.round((received / total) * 100) : null }),
      });
    } catch (caught) {
      if (caught?.name !== "AbortError") setError(caught?.message || "The download failed.");
    } finally {
      controllerRef.current = null;
      setProgress(null);
    }
  };

  const name = state?.offer?.name || state?.installed?.name || named.name || "This scenario's detailed map";
  const offer = state?.offer;
  const size = formatBytes(offer?.bytes);
  let status;
  let action = null;
  if (import.meta.env.VITE_OH_WEB) {
    status = "This version of the game shows the scenario's basic map. Detailed maps need the desktop app.";
  } else if (!state) {
    status = "Checking…";
  } else if (progress) {
    status = `Downloading… ${progress.percent !== null ? `${progress.percent}%` : ""}`;
    action = <button type="button" style={button} onClick={() => controllerRef.current?.abort()}>Cancel</button>;
  } else if (offer?.have) {
    status = `You have version ${offer.have}. Version ${offer.version}${size ? ` (${size})` : ""} is available and replaces it.`;
    action = <button type="button" style={button} onClick={start}>Update{size ? ` ${size}` : ""}</button>;
  } else if (offer?.withdrawn) {
    status = "No longer available. You're playing on the basic map.";
  } else if (offer?.unofficial) {
    status = "Not on the official list, so it can't be downloaded. You're playing on the basic map.";
  } else if (offer?.unavailable) {
    status = "Not available right now (the official list couldn't be reached). You're playing on the basic map.";
  } else if (offer) {
    status = `Not downloaded. You're playing on the basic map.`;
    action = <button type="button" style={button} onClick={start}>Download{size ? ` ${size}` : ""}</button>;
  } else {
    status = `✓ Downloaded${state.installed?.official ? ` (version ${state.installed.official.version})` : ""}.`;
  }

  return (
    <div style={fieldGroupStyle}>
      <div style={labelStyle}>This game&apos;s detailed map</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 14rem", fontSize: "0.85rem" }}>
          <strong>{name}</strong>
          <div style={{ opacity: 0.8 }}>{status}</div>
          {error && <div style={{ color: "#f3a8a8" }}>{error}</div>}
        </div>
        {action}
      </div>
      <div style={helperStyle}>It downloads once, and every scenario on this map shares it.</div>
    </div>
  );
}
