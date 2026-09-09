/*! Open Historia — in-app update banner © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

import { useEffect, useRef, useState } from "react";
import {
  APP_UPDATE_CHECK_INTERVAL_MS,
  APP_UPDATE_REFOCUS_THROTTLE_MS,
  isUpdateAvailable,
  parseUpdateManifest,
} from "./appUpdate.js";

// Stamped into the native app build by the APK workflow (VITE_APP_BUILD / _TRACK).
// Desktop and dev builds have no stamp, so the banner is a no-op there.
const APP_BUILD = Number(import.meta.env.VITE_APP_BUILD);
const APP_TRACK = String(import.meta.env.VITE_APP_TRACK || "stable");
// Stamped into the WEB build by vite.config (WEB_BUILD_ID), which writes the same id
// to version.json beside the bundle. The website has no on-device server and so no
// /api/app-update; it compares its own baked id against that file instead.
const WEB_BUILD = String(import.meta.env.VITE_WEB_BUILD || "");
const VERSION_URL = `${import.meta.env.BASE_URL || "/"}version.json`;
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
  // Two shapes of "an update exists", one banner. The native app asks its on-device
  // server for the release manifest and updates by downloading an APK; the website
  // compares its baked build id against the deployed version.json and updates by
  // reloading onto the new bundle. Desktop/dev carry neither stamp and no-op.
  const isApp = Number.isFinite(APP_BUILD) && APP_BUILD > 0;
  // The desktop app is an ordinary localhost page, so it cannot tell it is inside
  // the app on its own. Its server answers /api/app-update with a `current` build,
  // and only that server does — so the reply itself is the signal. Nothing is added
  // to the window for this: a preload on the game window is what broke the app
  // before.
  const [desktop, setDesktop] = useState(null);
  const isWeb = !isApp && WEB_BUILD !== "";
  const supported = isApp || isWeb || Boolean(desktop);
  const [latest, setLatest] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      const stored = localStorage.getItem(DISMISS_KEY);
      // App builds compare numerically ("is this newer than what I dismissed"); web
      // ids are opaque and compare by equality, so keep the raw string for them.
      return isWeb ? String(stored ?? "") : Number(stored) || 0;
    } catch {
      return isWeb ? "" : 0;
    }
  });
  const [updating, setUpdating] = useState(false);
  const lastRefocusRef = useRef(0);

  useEffect(() => {
    if (isApp || isWeb) return undefined;
    let dropped = false;
    const probe = async () => {
      try {
        const res = await fetch("/api/app-update?track=desktop", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        // `current` present = this is the desktop app. Any DIFFERENCE is an update:
        // the ids are opaque, so a rollback counts just as much as a newer build.
        if (dropped || !data?.current || !data?.buildId || !data?.download) return;
        if (data.buildId === data.current) return;
        setDesktop({ build: data.buildId, notes: data.notes || "", url: data.download });
      } catch {
        /* fail open: no banner */
      }
    };
    probe();
    const timer = setInterval(probe, APP_UPDATE_CHECK_INTERVAL_MS);
    return () => { dropped = true; clearInterval(timer); };
  }, [isApp, isWeb]);

  useEffect(() => {
    if (!supported) return undefined;
    let cancelled = false;
    const check = async () => {
      try {
        if (isWeb) {
          // no-store, or the browser hands back the very file we are trying to
          // notice a change in.
          const res = await fetch(VERSION_URL, { cache: "no-store", signal: AbortSignal.timeout(6000) });
          if (!res.ok) return;
          const deployed = String((await res.json())?.build ?? "");
          // Any DIFFERENCE means the deploy moved on. Not a > comparison: the ids are
          // opaque, and a rollback is just as much "not what you are running".
          if (!cancelled && deployed && deployed !== WEB_BUILD) setLatest({ build: deployed, web: true });
          return;
        }
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
  }, [supported, isWeb]);

  if (!supported) return null;
  const info = desktop ?? latest;
  if (desktop ? false : isWeb ? !latest : !isUpdateAvailable(APP_BUILD, latest)) return null;
  if (desktop && String(dismissed) === String(desktop.build)) return null;
  // Web ids are opaque strings, so dismissal is an equality check rather than "<=".
  if (!desktop && (isWeb ? String(dismissed) === String(latest.build) : latest.build <= dismissed)) return null;

  const onUpdate = async () => {
    if (desktop) {
      // window.open goes through the main process's window-open handler, which sends
      // it to the real browser — so the installer downloads where the player can see
      // it, and no extra bridge is needed to do it.
      setUpdating(true);
      window.open(desktop.url, "_blank", "noopener");
      return;
    }
    if (isWeb) {
      setUpdating(true);
      // Bundle filenames are content-hashed, so re-fetching the shell is all it takes
      // to land on the new code. Ask the service worker to update first: it caches
      // nothing (it passes every request through), but an old registration can still
      // be the controller for this page.
      //
      // Deliberately NOT clearing Cache Storage. The big map archives live there
      // (open-historia-preload-*, ~160MB of PMTiles); wiping them would turn a code
      // update into a full map re-download, which is exactly what that cache exists to
      // avoid. Nothing in it is version-specific. Best-effort: never block the reload.
      try {
        if ("serviceWorker" in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.update().catch(() => {})));
        }
      } catch {
        /* ignore — reload anyway */
      }
      window.location.reload();
      return;
    }
    if (!latest.apk) return;
    setUpdating(true);
    // Downloads the new APK; Android then prompts to install it and reopen the app.
    window.location.href = latest.apk;
  };
  const onDismiss = () => {
    setDismissed(info.build);
    try {
      localStorage.setItem(DISMISS_KEY, String(info.build));
    } catch {
      /* ignore: dismissal just won't persist across launches */
    }
  };

  return (
    <div style={bar} role="status" aria-live="polite">
      <div style={text}>
        A new version of Open Historia is ready.
        <span style={sub}>
          {desktop
            ? (updating ? "Opening the download…" : "Download the new version and run it — your games are kept.")
            : isWeb
            ? (updating ? "Reloading…" : "Reload to get the latest fixes. Your games are saved.")
            : updating
              ? "Downloading… open the finished download to install and reopen."
              : latest.notes || `Build ${latest.build} · tap Update to download and install.`}
        </span>
      </div>
      {isWeb || desktop || latest.apk ? (
        <button type="button" style={btn} onClick={onUpdate} disabled={updating}>
          {updating ? (isWeb ? "Reloading…" : desktop ? "Opening…" : "Downloading…") : "Update now"}
        </button>
      ) : null}
      <button type="button" style={dismissBtn} onClick={onDismiss} aria-label="Dismiss update notice">
        ×
      </button>
    </div>
  );
}
