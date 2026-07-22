/*! Open Historia — in-app update banner © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

import { useEffect, useRef, useState } from "react";
import {
  APP_UPDATE_CHECK_INTERVAL_MS,
  APP_UPDATE_REFOCUS_THROTTLE_MS,
  isUpdateAvailable,
  parseUpdateManifest,
} from "./appUpdate.js";

// Stamped into the native app build by the APK workflow (VITE_APP_BUILD / _TRACK).
// Web, desktop and dev builds have no stamp, so the banner is a no-op there.
const APP_BUILD = Number(import.meta.env.VITE_APP_BUILD);
const APP_TRACK = String(import.meta.env.VITE_APP_TRACK || "stable");
const DISMISS_KEY = "oh-update-dismissed-build";

const bar = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 10060,
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  padding: "0.55rem max(0.9rem, env(safe-area-inset-left)) 0.55rem max(0.9rem, env(safe-area-inset-right))",
  paddingTop: "max(0.55rem, env(safe-area-inset-top))",
  background: "linear-gradient(180deg, #12172b, #0d1122)",
  borderBottom: "1px solid rgba(212,175,55,0.35)",
  color: "#f4ead0",
  font: "600 0.85rem/1.3 system-ui, sans-serif",
  boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
};
const text = { flex: 1, minWidth: 0 };
const sub = { display: "block", fontWeight: 400, fontSize: "0.72rem", color: "rgba(244,234,208,0.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const btn = {
  flex: "0 0 auto",
  background: "linear-gradient(180deg, #d4af37, #b8901f)",
  border: "1px solid rgba(212,175,55,0.6)",
  borderRadius: "9px",
  color: "#1a1206",
  cursor: "pointer",
  font: "700 0.82rem system-ui, sans-serif",
  padding: "0.45rem 0.9rem",
};
const dismissBtn = {
  flex: "0 0 auto",
  background: "transparent",
  border: "none",
  color: "rgba(244,234,208,0.6)",
  cursor: "pointer",
  fontSize: "1.1rem",
  lineHeight: 1,
  padding: "0.2rem 0.35rem",
};

export default function AppUpdateBanner() {
  // Only native app builds carry a numeric build stamp; everything else no-ops.
  const supported = Number.isFinite(APP_BUILD) && APP_BUILD > 0;
  const [latest, setLatest] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return Number(localStorage.getItem(DISMISS_KEY)) || 0;
    } catch {
      return 0;
    }
  });
  const [updating, setUpdating] = useState(false);
  const lastRefocusRef = useRef(0);

  useEffect(() => {
    if (!supported) return undefined;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`/api/app-update?track=${encodeURIComponent(APP_TRACK)}`, {
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return;
        const manifest = parseUpdateManifest(await res.json());
        if (!cancelled && manifest) setLatest(manifest);
      } catch {
        /* fail-open: a failed check simply shows no banner */
      }
    };
    check();
    const interval = setInterval(check, APP_UPDATE_CHECK_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefocusRef.current < APP_UPDATE_REFOCUS_THROTTLE_MS) return;
      lastRefocusRef.current = now;
      check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [supported]);

  if (!supported) return null;
  if (!isUpdateAvailable(APP_BUILD, latest)) return null;
  if (latest.build <= dismissed) return null;

  const onUpdate = () => {
    if (!latest.apk) return;
    setUpdating(true);
    // Downloads the new APK; Android then prompts to install it and reopen the app.
    window.location.href = latest.apk;
  };
  const onDismiss = () => {
    setDismissed(latest.build);
    try {
      localStorage.setItem(DISMISS_KEY, String(latest.build));
    } catch {
      /* ignore: dismissal just won't persist across launches */
    }
  };

  return (
    <div style={bar} role="status" aria-live="polite">
      <div style={text}>
        A new version of Open Historia is ready.
        <span style={sub}>
          {updating
            ? "Downloading… open the finished download to install and reopen."
            : latest.notes || `Build ${latest.build} · tap Update to download and install.`}
        </span>
      </div>
      {latest.apk ? (
        <button type="button" style={btn} onClick={onUpdate} disabled={updating}>
          {updating ? "Downloading…" : "Update now"}
        </button>
      ) : null}
      <button type="button" style={dismissBtn} onClick={onDismiss} aria-label="Dismiss update notice">
        ×
      </button>
    </div>
  );
}
