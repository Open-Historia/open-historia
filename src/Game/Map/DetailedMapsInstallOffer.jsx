/*! Open Historia — the detailed maps offered when a scenario is installed © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A scenario may name several detailed maps (docs/adr/0007). Installing it from
// the hub lists every one the player could download, with its size, the one
// the scenario starts on ticked; the others can be had later by picking them in
// Settings → Map. One detailed map, the starting one, keeps the plain offer
// (TiledBasemapOffer.jsx, atInstall).
// `offers`: { id, version, name, bytes, starting, have? } (scenarioTerrain.js
// tiledBasemapOffer, a missing map or a needed update).
import React, { useEffect, useRef, useState } from "react";
import { formatBytes, installOfficialBasemap } from "../../runtime/tiledBasemaps.js";

const panel = {
  padding: "12px 14px",
  borderRadius: 12,
  background: "rgba(14, 17, 22, 0.86)",
  border: "1px solid rgba(255,255,255,0.10)",
  color: "rgba(239,242,246,0.94)",
  fontSize: 13,
  lineHeight: 1.4,
  marginBottom: "0.9rem",
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
const keyOf = (offer) => `${offer.id}@${offer.version}`;

export default function DetailedMapsInstallOffer({ offers, onDone }) {
  const [ticked, setTicked] = useState(() => new Set(offers.filter((offer) => offer.starting).map(keyOf)));
  const [downloading, setDownloading] = useState(null); // { name, percent }
  const [error, setError] = useState("");
  const controllerRef = useRef(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const chosen = offers.filter((offer) => ticked.has(keyOf(offer)));
  const total = chosen.reduce((sum, offer) => sum + (Number(offer.bytes) || 0), 0);
  const toggle = (offer) => setTicked((current) => {
    const next = new Set(current);
    if (next.has(keyOf(offer))) next.delete(keyOf(offer));
    else next.add(keyOf(offer));
    return next;
  });

  const start = async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setError("");
    try {
      for (const offer of chosen) {
        setDownloading({ name: offer.name, percent: null });
        await installOfficialBasemap({
          id: offer.id,
          version: offer.version,
          signal: controller.signal,
          onProgress: ({ received, total: size }) => setDownloading({ name: offer.name, percent: size ? Math.round((received / size) * 100) : null }),
        });
      }
      setDownloading(null);
      onDone?.();
    } catch (caught) {
      if (caught?.name !== "AbortError") setError(caught?.message || "The download failed.");
      setDownloading(null);
    } finally {
      controllerRef.current = null;
    }
  };

  if (downloading) {
    return (
      <div role="status" aria-live="polite" style={panel}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          Downloading <span data-no-translate>{downloading.name}</span>…{downloading.percent !== null ? ` ${downloading.percent}%` : ""}
        </div>
        <button type="button" style={button} onClick={() => controllerRef.current?.abort()}>Cancel</button>
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite" style={panel}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>This scenario has detailed maps</div>
      <div style={{ opacity: 0.8, marginBottom: 10 }}>
        Large terrain maps, sharp up close. Tick the ones to download now; you can get the others later by picking them in Settings → Map. Without one, you see the drawn map under it. Each downloads once, and every scenario on it shares it.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {offers.map((offer) => (
          <label key={keyOf(offer)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={ticked.has(keyOf(offer))} onChange={() => toggle(offer)} />
            <span data-no-translate style={{ fontWeight: 600 }}>{offer.name}</span>
            <span style={{ opacity: 0.65 }}>{formatBytes(offer.bytes)}</span>
            {offer.starting && <span style={{ opacity: 0.65 }}>★ the starting map</span>}
            {offer.have ? <span style={{ opacity: 0.65 }}>an update</span> : null}
          </label>
        ))}
      </div>
      {error && <div style={{ color: "#f3a8a8", marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" style={button} onClick={() => onDone?.()}>Not now</button>
        <button
          type="button"
          disabled={!chosen.length}
          style={{ ...button, background: "rgba(96,165,250,0.28)", borderColor: "rgba(96,165,250,0.5)", opacity: chosen.length ? 1 : 0.5 }}
          onClick={start}
        >
          {total ? `Download ${formatBytes(total)}` : "Download"}
        </button>
      </div>
    </div>
  );
}
