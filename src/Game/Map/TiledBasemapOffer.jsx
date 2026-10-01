/*! Open Historia — offer to download a scenario's Tiled Basemap © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Shown over the map when the scenario names a Tiled Basemap the player does not
// have (docs/adr/0005-tiled-basemaps-stream-to-disk.md). The map meanwhile shows
// the scenario's painted fallback, so nothing waits on this: it is an offer, with
// progress and a way to cancel. When the download lands, the map switches to the
// relief by itself (useCustomBackground listens for it).
// The hub shows the same offer as part of installing a scenario (`atInstall`),
// in its own words and in the flow of the page, so most players never see the
// banner over the map at all.
import React, { useEffect, useRef, useState } from "react";
import { formatBytes, installTiledBasemap } from "../../runtime/tiledBasemaps.js";

const panel = {
  position: "absolute",
  top: 14,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 6,
  width: 340,
  maxWidth: "calc(100vw - 32px)",
  padding: "12px 14px",
  borderRadius: 12,
  background: "rgba(14, 17, 22, 0.86)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow: "0 12px 36px rgba(0,0,0,0.28)",
  color: "rgba(239,242,246,0.94)",
  fontSize: 13,
  lineHeight: 1.4,
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
};
const button = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.10)",
  color: "inherit",
  fontSize: 12.5,
  cursor: "pointer",
};

const atInstallPanel = {
  ...panel,
  position: "static",
  transform: "none",
  width: "auto",
  maxWidth: "none",
  marginBottom: "0.9rem",
  boxShadow: "none",
};

export default function TiledBasemapOffer({ basemap, atInstall = false, onDone, onDismiss }) {
  const [phase, setPhase] = useState("offer"); // offer | downloading | failed | dismissed
  const [progress, setProgress] = useState({ received: 0, total: basemap?.bytes || null });
  const [error, setError] = useState("");
  const controllerRef = useRef(null);

  // Leaving (another scenario, or the Basemap arrived) stops a download in
  // flight. World.jsx keys this on the Basemap's hash, so a different one
  // starts over with fresh state.
  useEffect(() => () => controllerRef.current?.abort(), []);

  if (!basemap || phase === "dismissed") return null;
  const name = basemap.name || "its detailed map";
  const size = formatBytes(basemap.bytes);

  const start = async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase("downloading");
    setError("");
    try {
      await installTiledBasemap({
        url: basemap.hubUrl,
        name: basemap.name,
        expectedHash: basemap.hash,
        signal: controller.signal,
        onProgress: (next) => setProgress((prev) => ({ received: next.received, total: next.total || prev.total })),
      });
      // The map switches to the relief on its own; this banner goes with it.
      // The hub, which has no map to switch, is told instead.
      onDone?.();
    } catch (caught) {
      if (caught?.name === "AbortError") {
        setPhase("offer");
        return;
      }
      setError(caught?.message || "The download failed.");
      setPhase("failed");
    }
  };

  const percent = progress.total ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : null;

  return (
    <div role="status" aria-live="polite" style={atInstall ? atInstallPanel : panel}>
      {phase === "downloading" ? (
        <>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Downloading {name}…</div>
          <div style={{ height: 4, borderRadius: 999, background: "rgba(255,255,255,0.10)", overflow: "hidden", marginBottom: 8 }}>
            <div style={{ height: "100%", width: `${percent ?? 8}%`, borderRadius: 999, background: "rgba(226,232,240,0.86)", transition: "width 200ms ease-out" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ opacity: 0.75 }}>
              {formatBytes(progress.received) || "0 KB"}{progress.total ? ` of ${formatBytes(progress.total)}` : ""}
            </span>
            <button type="button" style={button} onClick={() => controllerRef.current?.abort()}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {atInstall ? "This scenario comes with a detailed terrain map" : "This scenario's detailed map isn't downloaded"}
          </div>
          <div style={{ opacity: 0.8, marginBottom: basemap.hubUrl ? 10 : 6 }}>
            {atInstall
              ? `Download "${name}"${size ? ` (${size})` : ""} now to see the terrain up close. It downloads once and every scenario on this map shares it. Without it the scenario plays on its painted map, and you can download it later from the map.`
              : basemap.hubUrl
              ? `You're seeing its painted map. Download "${name}"${size ? ` (${size})` : ""} to see the terrain up close. It downloads once and every scenario on this map shares it.`
              : `You're seeing its painted map. "${name}" isn't linked to a download; ask the scenario's author, or look for it in the Basemaps tab of the community hub.`}
          </div>
          {phase === "failed" && <div style={{ color: "#f3a8a8", marginBottom: 8 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" style={button} onClick={() => { setPhase("dismissed"); onDismiss?.(); }}>Not now</button>
            {basemap.hubUrl && (
              <button type="button" style={{ ...button, background: "rgba(96,165,250,0.28)", borderColor: "rgba(96,165,250,0.5)" }} onClick={start}>
                {phase === "failed" ? "Try again" : `Download${size ? ` ${size}` : ""}`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
