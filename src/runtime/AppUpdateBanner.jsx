/*! Open Historia — in-app update banner © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

import { useEffect, useRef, useState } from "react";
import {
  APP_UPDATE_CHECK_INTERVAL_MS,
  APP_UPDATE_REFOCUS_THROTTLE_MS,
  LAUNCH_UPDATE_KEY,
  describeUpdateFailure,
  desktopUpdateProgressIsStale,
  desktopUpdateProgressMatchesBuild,
  isUpdateAvailable,
  isUpdateSettled,
  parseUpdateManifest,
  recordLaunchUpdateAttempt,
  shouldUpdateAtLaunch,
} from "./appUpdate.js";
import { logDebugEvent, setDebugLogContext } from "./debugLog.js";
import { desktopBuildLabel } from "./buildLabel.js";
import { canInstallUpdates, cancelUpdateDownload, installUpdate } from "./native/appInstaller.js";
import {
  APP_UPDATE_MANUAL_CHECK_EVENT,
  publishAppUpdateCheckResult,
} from "./appUpdateManualCheck.js";

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

// Launch attempts per build (appUpdate.js shouldUpdateAtLaunch). Storage that
// throws (a private window, blocked site data) reads as no attempts, so the
// update still happens; it just is not counted.
const readLaunchRecord = () => {
  try {
    return localStorage.getItem(LAUNCH_UPDATE_KEY);
  } catch {
    return null;
  }
};
const noteLaunchAttempt = (build) => {
  try {
    localStorage.setItem(LAUNCH_UPDATE_KEY, recordLaunchUpdateAttempt(readLaunchRecord(), build));
  } catch {
    /* not counted: see readLaunchRecord */
  }
};

// The website's update: onto the new bundle by reloading. Bundle filenames are
// content-hashed, so re-fetching the shell is all it takes to land on the new
// code. Ask the service worker to update first: it caches nothing (it passes
// every request through), but an old registration can still be the controller
// for this page.
//
// Deliberately NOT clearing Cache Storage. The big map archives live there
// (open-historia-preload-*, ~160MB of PMTiles); wiping them would turn a code
// update into a full map re-download, which is exactly what that cache exists to
// avoid. Nothing in it is version-specific. Best-effort: never block the reload.
const reloadOntoNewBuild = async () => {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.update().catch(() => {})));
    }
  } catch {
    /* ignore — reload anyway */
  }
  window.location.reload();
};

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
// The update that runs as the game opens covers the start screen, as the
// desktop's setup window does, with the same colours.
const cover = {
  position: "fixed",
  inset: 0,
  zIndex: 10070,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  paddingTop: "max(1rem, env(safe-area-inset-top))",
  paddingRight: "max(1rem, env(safe-area-inset-right))",
  paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
  paddingLeft: "max(1rem, env(safe-area-inset-left))",
  background: "#131315",
  color: "#f4ead0",
  font: "400 0.9rem/1.5 system-ui, sans-serif",
};
const coverCard = { width: "100%", maxWidth: "26rem" };
const coverTitle = { margin: "0 0 0.4rem", fontSize: "1.15rem", fontWeight: 700 };
const coverText = { margin: 0, color: "rgba(244,234,208,0.62)", fontSize: "0.86rem" };
const track = { height: "10px", margin: "1.3rem 0 0.6rem", borderRadius: "99px", overflow: "hidden", background: "rgba(244,234,208,0.12)", border: "1px solid rgba(212,175,55,0.3)" };
const fill = { display: "block", height: "100%", borderRadius: "99px", background: "linear-gradient(180deg, #d4af37, #b8901f)", transition: "width 250ms" };
const coverPct = { fontWeight: 700, fontSize: "0.86rem" };
const quietBtn = { ...btn, marginTop: "1rem", color: "#f4ead0", background: "transparent", border: "1px solid rgba(212,175,55,0.3)" };

export default function AppUpdateBanner() {
  // Two shapes of "an update exists", one banner. The native app asks its on-device
  // server for the release manifest and updates by downloading an APK; the website
  // compares its baked build id against the deployed version.json and updates by
  // reloading onto the new bundle. Desktop/dev carry neither stamp and no-op.
  //
  // Opening the game installs a waiting update; the banner is for one found while
  // the game is open. The desktop installs it before its window opens
  // (electron/launchUpdate.cjs). Here the first check after the page opens does
  // it: the website reloads onto the new bundle, and the app downloads the APK
  // and opens Android's installer, under a cover with a progress bar.
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
  // Which release-manifest build this updater attempt was started for. The release
  // manifest uses an opaque CI build id while electron-updater reports a semver, so
  // the renderer owns this association explicitly.
  const [progressBuild, setProgressBuild] = useState("");
  const [manualCheckToken, setManualCheckToken] = useState(0);
  // The Android app's own download from the banner's button: null, or
  // { stage: "downloading" | "installing" | "error", percent, error }.
  const [appProgress, setAppProgress] = useState(null);
  // The update running as the game opens: null, or { stage: "reloading" } on the
  // website, { stage: "downloading" | "installing", build, percent } in the app.
  const [launch, setLaunch] = useState(null);
  const lastRefocusRef = useRef(0);
  const openedAtRef = useRef(Date.now());
  // No check has answered yet: the next answer is the one "opening the game" gets.
  const firstCheckRef = useRef(true);
  const desktopStatusReadRef = useRef(false);
  const desktopBuild = String(desktop?.build || "");
  const progressMatchesDesktop = desktopUpdateProgressMatchesBuild(progressBuild, desktopBuild);

  // Settings does not duplicate any updater/network logic. It emits this command;
  // changing the token makes the same automatic probes below run immediately.
  useEffect(() => {
    const onManualCheck = () => setManualCheckToken((value) => value + 1);
    window.addEventListener(APP_UPDATE_MANUAL_CHECK_EVENT, onManualCheck);
    return () => window.removeEventListener(APP_UPDATE_MANUAL_CHECK_EVENT, onManualCheck);
  }, []);

  const revealManuallyFoundUpdate = () => {
    setDismissed(isWeb ? "" : 0);
    try { localStorage.removeItem(DISMISS_KEY); } catch { /* a dismissed banner can still reappear this session */ }
  };

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
    const probe = async ({ manual = false } = {}) => {
      try {
        const res = await fetch("/api/app-update?track=desktop", { cache: "no-store" });
        if (!res.ok) {
          if (manual) publishAppUpdateCheckResult({ status: "error" });
          return;
        }
        const data = await res.json();
        // `current` present = this is the desktop app, and it is the build the
        // Logging file names (only the server knows it).
        if (!dropped && data?.current) setDebugLogContext({ build: desktopBuildLabel(data.current) });
        // Any DIFFERENCE is an update: the ids are opaque, so a rollback counts
        // just as much as a newer build.
        if (dropped) return;
        if (!data?.current) {
          if (manual) publishAppUpdateCheckResult({ status: "unsupported" });
          return;
        }
        if (!data?.buildId || !data?.download) {
          if (manual) publishAppUpdateCheckResult({ status: "error" });
          return;
        }
        if (data.buildId === data.current) {
          setDesktop(null);
          if (manual) publishAppUpdateCheckResult({ status: "current", build: data.current });
          return;
        }
        setDesktop({ auto: Boolean(data.autoUpdate), build: data.buildId, notes: data.notes || "", url: data.download });
        if (manual) {
          revealManuallyFoundUpdate();
          publishAppUpdateCheckResult({ status: "available", build: data.buildId });
        }
        // A player who chose "Open the game now" while the update downloaded at
        // launch: the download carries on in the main process, and the banner
        // picks it up where it is (downloading, or ready to restart into). Not
        // "available": a launch check that timed out can still find the update
        // afterwards, with nothing downloading it, and the poll would wait on it
        // for ever.
        if (data.autoUpdate && !desktopStatusReadRef.current) {
          desktopStatusReadRef.current = true;
          const status = await fetch("/api/app-update/status", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
          if (!dropped && status?.supported && ["downloading", "ready"].includes(status.state)) {
            setProgress((current) => current ?? status);
            // That download is of the release this reply names. Without the
            // association it would read as an attempt for no build, never
            // match the one on offer, and "Restart now" would not come up.
            setProgressBuild((current) => current || String(data.buildId));
          }
        }
      } catch {
        if (manual) publishAppUpdateCheckResult({ status: "error" });
        /* automatic checks fail open: no banner */
      }
    };
    probe({ manual: manualCheckToken > 0 });
    const timer = setInterval(() => probe(), APP_UPDATE_CHECK_INTERVAL_MS);
    return () => { dropped = true; clearInterval(timer); };
  }, [isApp, isWeb, manualCheckToken]);

  // A newer release can be published after an older one has downloaded but before
  // the player applies it. Never let that old settled state turn into "Restart now"
  // for the new release. Keep an in-flight attempt alive; once it settles, discard
  // its stale renderer state and offer the newly-advertised build normally.
  useEffect(() => {
    if (!desktopUpdateProgressIsStale(progressBuild, desktopBuild, progress?.state)) return;
    setProgress(null);
    setProgressBuild("");
    setUpdating(false);
  }, [desktopBuild, progress?.state, progressBuild]);

  // The app's download, from the cover as the game opens or from the banner's
  // button. Resolves once Android's installer is on screen.
  const runAppInstall = async (manifest, atLaunch) => {
    const report = atLaunch ? setLaunch : setAppProgress;
    report({ stage: "downloading", build: manifest.build, percent: 0 });
    try {
      await installUpdate(manifest.apk, {
        build: manifest.build,
        onProgress: (percent) => report((current) => (current?.stage === "downloading" ? { ...current, percent } : current)),
      });
      if (atLaunch) noteLaunchAttempt(manifest.build);
      report((current) => (current ? { ...current, stage: "installing", percent: 100 } : current));
    } catch (error) {
      const reason = String(error?.message || error || "");
      const cancelled = reason === "cancelled";
      if (!cancelled) logDebugEvent("update", describeUpdateFailure(reason), { build: manifest.build });
      if (atLaunch) {
        // The banner offers it instead; a failure counts against the build, the
        // player choosing to play now does not.
        if (!cancelled) noteLaunchAttempt(manifest.build);
        setLaunch(null);
      } else {
        setAppProgress(cancelled ? null : { stage: "error", error: reason });
      }
    }
  };

  useEffect(() => {
    if (!supported) return undefined;
    let cancelled = false;
    const check = async ({ manual = false } = {}) => {
      try {
        if (isWeb) {
          // no-store, or the browser hands back the very file we are trying to
          // notice a change in.
          const res = await fetch(VERSION_URL, { cache: "no-store", signal: AbortSignal.timeout(6000) });
          if (!res.ok) {
            if (manual) publishAppUpdateCheckResult({ status: "error" });
            return;
          }
          const deployed = String((await res.json())?.build ?? "");
          if (cancelled) return;
          const firstCheck = firstCheckRef.current;
          firstCheckRef.current = false;
          // Any DIFFERENCE means the deploy moved on. Not a > comparison: the ids are
          // opaque, and a rollback is just as much "not what you are running".
          if (!deployed || deployed === WEB_BUILD) {
            if (manual) publishAppUpdateCheckResult({ status: deployed ? "current" : "error", build: deployed });
            return;
          }
          // Settings hears of the update whichever way it is then taken, and a
          // banner dismissed for this build comes back.
          if (manual) {
            revealManuallyFoundUpdate();
            publishAppUpdateCheckResult({ status: "available", build: deployed });
          }
          if (shouldUpdateAtLaunch({ firstCheck, elapsedMs: Date.now() - openedAtRef.current, build: deployed, stored: readLaunchRecord() })) {
            noteLaunchAttempt(deployed);
            setLaunch({ stage: "reloading" });
            reloadOntoNewBuild();
            return;
          }
          setLatest({ build: deployed, web: true });
          return;
        }
        const res = await fetch(`/api/app-update?track=${encodeURIComponent(APP_TRACK)}`, {
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) {
          if (manual) publishAppUpdateCheckResult({ status: "error" });
          return;
        }
        const manifest = parseUpdateManifest(await res.json());
        if (cancelled) return;
        const firstCheck = firstCheckRef.current;
        firstCheckRef.current = false;
        if (manual) {
          if (isUpdateAvailable(APP_BUILD, manifest)) {
            revealManuallyFoundUpdate();
            publishAppUpdateCheckResult({ status: "available", build: manifest.build });
          } else {
            publishAppUpdateCheckResult({ status: manifest ? "current" : "error", build: manifest?.build });
          }
        }
        if (!manifest) return;
        setLatest(manifest);
        if (
          isApp
          && manifest.apk
          && isUpdateAvailable(APP_BUILD, manifest)
          && canInstallUpdates()
          && shouldUpdateAtLaunch({ firstCheck, elapsedMs: Date.now() - openedAtRef.current, build: manifest.build, stored: readLaunchRecord() })
        ) {
          runAppInstall(manifest, true);
        }
      } catch {
        if (manual) publishAppUpdateCheckResult({ status: "error" });
        /* automatic checks fail open: no banner */
      }
    };
    // Desktop has its own manifest shape and reports the manual result from the
    // desktop probe above. Native/web use this path.
    check({ manual: manualCheckToken > 0 && (isApp || isWeb) });
    const interval = setInterval(() => check(), APP_UPDATE_CHECK_INTERVAL_MS);
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
    // runAppInstall only ever reads its arguments and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, isApp, isWeb, manualCheckToken]);

  // Android's installer is up. Installing the update ends this app; coming back
  // to it means the player closed the installer, and the banner takes over.
  const awaitingInstaller = launch?.stage === "installing" || appProgress?.stage === "installing";
  useEffect(() => {
    if (!awaitingInstaller) return undefined;
    let left = document.visibilityState === "hidden";
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        left = true;
        return;
      }
      if (!left) return;
      setLaunch(null);
      setAppProgress(null);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [awaitingInstaller]);

  if (launch) {
    const playNow = () => {
      setLaunch(null);
      cancelUpdateDownload();
    };
    return (
      <div style={cover} role="dialog" aria-modal="true" aria-live="polite">
        <div style={coverCard}>
          <h2 style={coverTitle}>Updating Open Historia</h2>
          {launch.stage === "reloading" ? (
            <p style={coverText}>Loading the new version…</p>
          ) : launch.stage === "installing" ? (
            <>
              <p style={coverText}>Android is asking to install the update. When it is done, open the game again — your games are kept.</p>
              <p style={{ ...coverText, marginTop: "0.5rem" }}>The first time, Android asks you to allow installs from Open Historia: allow it, then go back.</p>
              <button type="button" className="oh-tap-row" style={quietBtn} onClick={() => setLaunch(null)}>
                Back to the game
              </button>
            </>
          ) : (
            <>
              <p style={coverText}>A new version is downloading. Android then asks you to install it — your games are kept.</p>
              <div style={track}>
                <i style={{ ...fill, width: `${launch.percent || 0}%` }} />
              </div>
              <span style={coverPct}>{`Downloading the update… ${launch.percent || 0}%`}</span>
              <div>
                <button type="button" className="oh-tap-row" style={quietBtn} onClick={playNow}>
                  Not now
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

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
        setProgressBuild(desktopBuild);
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
      await reloadOntoNewBuild();
      return;
    }
    if (!latest.apk) return;
    // The app downloads it and opens Android's installer itself; after a failure
    // (and in a shell without the plugin) the button falls back to the phone's
    // browser, which downloads it for the player to open.
    if (canInstallUpdates() && appProgress?.stage !== "error") {
      runAppInstall(latest, false);
      return;
    }
    setUpdating(true);
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
    if (progress?.state === "ready" && progressMatchesDesktop) return "Downloaded. Restart to finish — your games are kept.";
    if (progress?.state === "ready") return "A newer update is available. Download it before restarting.";
    if (progress?.state === "downloading") return `Downloading the update… ${progress.percent || 0}%`;
    if (progress?.state === "checking" || progress?.state === "available") return "Fetching the update…";
    return "Installs itself in the background — your games are kept.";
  };
  // The same for the Android app's own download.
  const appStatus = () => {
    if (appProgress?.stage === "downloading") return `Downloading the update… ${appProgress.percent || 0}%`;
    if (appProgress?.stage === "installing") return "Android is asking to install it — your games are kept.";
    if (appProgress?.stage === "error") return `${describeUpdateFailure(appProgress.error)} Tap Update now to download it in your browser instead.`;
    if (updating) return "Downloading… open the finished download to install and reopen.";
    return latest.notes || `Build ${latest.build} · tap Update to download and install.`;
  };
  const ready = Boolean(desktop && desktop.auto && progress?.state === "ready" && progressMatchesDesktop);
  // Anything the updater is still working through, by the same rule the poll uses —
  // so a state with no percentage to show yet still reads as busy rather than
  // falling through to the button's idle label and claiming a download is opening.
  const busy = Boolean(desktop && desktop.auto && running);
  const appBusy = appProgress?.stage === "downloading" || appProgress?.stage === "installing";

  return (
    <div style={bar} role="status" aria-live="polite">
      <div style={text}>
        A new version of Open Historia is ready.
        <span style={sub} title={(desktop && progress?.state === "error") || appProgress?.stage === "error" ? (desktop ? desktopStatus() : appStatus()) : undefined}>
          {desktop
            ? desktopStatus()
            : isWeb
            ? (updating ? "Reloading…" : "Reload to get the latest fixes. Your games are saved.")
            : appStatus()}
        </span>
      </div>
      {ready ? (
        <button type="button" className="oh-tap-row" style={btn} onClick={onRestart}>
          Restart now
        </button>
      ) : isWeb || desktop || latest.apk ? (
        <button type="button" className="oh-tap-row" style={btn} onClick={onUpdate} disabled={updating || busy || appBusy}>
          {busy
            ? `${progress.percent || 0}%`
            : appBusy
              ? `${appProgress.percent || 0}%`
              : updating
                ? (isWeb ? "Reloading…" : desktop ? "Opening…" : "Downloading…")
                : "Update now"}
        </button>
      ) : null}
      <button type="button" className="oh-tap" style={dismissBtn} onClick={onDismiss} aria-label="Dismiss update notice">
        ×
      </button>
    </div>
  );
}
