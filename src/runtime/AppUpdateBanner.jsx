/*! Open Historia — in-app update banner © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

import { useEffect, useRef, useState } from "react";
import {
  APP_UPDATE_CHECK_INTERVAL_MS,
  APP_UPDATE_REFOCUS_THROTTLE_MS,
  describeUpdateFailure,
  isUpdateAvailable,
  isUpdateSettled,
  parseUpdateManifest,
} from "./appUpdate.js";
import { logDebugEvent } from "./debugLog.js";

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
  background: "linear-gradient(180deg, #161618, #101012)",
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
  // The main process's updater state, polled while an update is actually running.
  // Null until the player asks for one — the banner is otherwise the same as it
  // was, and a build that cannot update itself never sets this at all.
  const [progress, setProgress] = useState(null);
  const lastRefocusRef = useRef(0);

  // A second-by-second poll, but only between pressing Update and the update being
  // ready (or failing) — never while the banner is merely sitting there. `progress`
  // is null until the player presses Update, which is what keeps it idle; from then
  // on it runs until the updater settles, through every intermediate state rather
  // than only the two it happens to spend the longest in.
  const running = progress !== null && !isUpdateSettled(progress.state);
  useEffect(() => {
    if (!running) return undefined;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/app-update/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (stopped || !data?.supported) return;
        setProgress(data);
        // A failure mid-download hands the player back to the installer link, so
        // the button has to become pressable again — otherwise it sits disabled
        // reading "Opening…" while nothing is opening. The reason goes on the
        // banner (desktopStatus) and into the debug log, where a bug report can
        // carry it: the updater's message used to be stored and never shown, so
        // "0%" flipping back to "Update now" was all a player saw of a failure.
        if (data.state === "error") {
          setUpdating(false);
          logDebugEvent("update", describeUpdateFailure(data.error), { version: data.version || "" });
        }
      } catch {
        /* a missed poll changes nothing: the next one has the same answer */
      }
    };
    const timer = setInterval(tick, 1000);
    return () => { stopped = true; clearInterval(timer); };
  }, [running]);

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
        setDesktop({ auto: Boolean(data.autoUpdate), build: data.buildId, notes: data.notes || "", url: data.download });
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
      setUpdating(true);
      // The app installs the update itself: the main process downloads it and
      // swaps the installation on restart, so there is nothing for the player to
      // find in a downloads folder and run.
      if (desktop.auto && progress?.state !== "error") {
        setProgress({ state: "checking", percent: 0 });
        try {
          const res = await fetch("/api/app-update/download", { method: "POST" });
          if (res.ok) return;
        } catch {
          /* fall through to the download link below */
        }
        // The route is gone or refused — never leave the player with a button that
        // did nothing. This is the behaviour that used to be the only one.
        setProgress({ state: "error", error: "the app's update service did not answer" });
      }
      // window.open goes through the main process's window-open handler, which sends
      // it to the real browser — so the installer downloads where the player can see
      // it, and no extra bridge is needed to do it.
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
  const onRestart = async () => {
    try {
      // The app quits and reopens on the new version; the response comes back
      // before it goes, so a refusal is still visible.
      const res = await fetch("/api/app-update/restart", { method: "POST" });
      if (!res.ok) setProgress({ state: "error", error: "the downloaded update could not be started" });
    } catch {
      /* the app is already going down — nothing left to report to */
    }
  };

  const onDismiss = () => {
    setDismissed(info.build);
    try {
      localStorage.setItem(DISMISS_KEY, String(info.build));
    } catch {
      /* ignore: dismissal just won't persist across launches */
    }
  };

  // What the desktop line says depends on how far along the app's own update is.
  // "error" says why, then what the player can still do: the button falls back
  // to the installer download, and the line has to make sense of "Update now"
  // coming back after it was pressed.
  const desktopStatus = () => {
    if (!desktop.auto || progress?.state === "error") {
      if (updating) return "Opening the download…";
      const failure = progress?.state === "error" ? `${describeUpdateFailure(progress.error)} ` : "";
      return `${failure}Download the new version and run it — your games are kept.`;
    }
    if (progress?.state === "ready") return "Downloaded. Restart to finish — your games are kept.";
    if (progress?.state === "downloading") return `Downloading the update… ${progress.percent || 0}%`;
    if (progress?.state === "checking") return "Fetching the update…";
    return "Installs itself in the background — your games are kept.";
  };
  const ready = Boolean(desktop && desktop.auto && progress?.state === "ready");
  // Anything the updater is still working through, by the same rule the poll uses —
  // so a state with no percentage to show yet still reads as busy rather than
  // falling through to the button's idle label and claiming a download is opening.
  const busy = Boolean(desktop && desktop.auto && running);

  return (
    <div style={bar} role="status" aria-live="polite">
      <div style={text}>
        A new version of Open Historia is ready.
        <span style={sub} title={desktop && progress?.state === "error" ? desktopStatus() : undefined}>
          {desktop
            ? desktopStatus()
            : isWeb
            ? (updating ? "Reloading…" : "Reload to get the latest fixes. Your games are saved.")
            : updating
              ? "Downloading… open the finished download to install and reopen."
              : latest.notes || `Build ${latest.build} · tap Update to download and install.`}
        </span>
      </div>
      {ready ? (
        <button type="button" style={btn} onClick={onRestart}>
          Restart now
        </button>
      ) : isWeb || desktop || latest.apk ? (
        <button type="button" style={btn} onClick={onUpdate} disabled={updating || busy}>
          {busy
            ? `${progress.percent || 0}%`
            : updating
              ? (isWeb ? "Reloading…" : desktop ? "Opening…" : "Downloading…")
              : "Update now"}
        </button>
      ) : null}
      <button type="button" style={dismissBtn} onClick={onDismiss} aria-label="Dismiss update notice">
        ×
      </button>
    </div>
  );
}
