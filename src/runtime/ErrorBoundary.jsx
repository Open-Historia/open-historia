/*! Open Historia — React error boundary (recoverable render-crash fallback) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React from "react";
import { buildRenderCrashIncident, flushDebugLog, logDebugEvent, withConsoleCaptureMuted } from "./debugLog.js";
import { useFailureReportButton } from "./saveDebugLog.js";

// The crash screen's report button, as every other failure has one
// (runtime/saveDebugLog.js): Save the log with the crash attached, or, with
// logging off, copy the crash on its own. A component of its own because the
// boundary is a class and the button is a hook.
const CrashReportButton = ({ error, componentStack }) => {
  const report = useFailureReportButton({
    buildIncident: () => buildRenderCrashIncident(error, componentStack),
    copyIdleLabel: "📋 Copy crash details",
  });
  return (
    <button
      type="button"
      style={styles.secondaryButton}
      disabled={report.busy}
      onClick={report.onClick}
      title={report.loggingOn
        ? "Saves the diagnostics log as a file, with this crash's full details at the top. Attach the file to your bug report."
        : "Copies this crash's details. Diagnostics logging is off — turn it on in Settings → Diagnostics to save the full log instead."}
    >
      {report.label}
    </button>
  );
};

// Catches render/lifecycle/constructor throws in the map, game UI and panels so a
// crash shows a recoverable fallback (with a Reload) instead of React unmounting the
// whole tree to a blank white page. Caveat: an error boundary only catches errors
// thrown by its DESCENDANTS during render — not in its own render, not in event
// handlers, and not in async/promise/rAF code (much of the map runs in effects, not
// render). It is wrapped around <GameApp/> in App.jsx so it also covers GameApp's
// own render.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    // componentStack arrives with componentDidCatch, after the error: kept
    // whole for the report button, which the log entry below is not.
    this.state = { error: null, componentStack: "" };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // For a developer with DevTools open, and kept out of the diagnostics log:
    // the crash entry below is the log's one record of it, so it is not read as
    // two crashes.
    withConsoleCaptureMuted(() => console.error("Render crash caught by ErrorBoundary:", error, info?.componentStack));
    // A render crash is the one entry a reader should never have to hunt for,
    // so it gets its own category — the first frames of the error's own stack,
    // which say where it threw, and of the component stack, which name the
    // panel that blew up. Both whole go in the report the Save button makes.
    const componentStack = String(info?.componentStack || "");
    logDebugEvent("crash", "Render crash caught by the error boundary.", {
      error: `${error?.name || "Error"}: ${error?.message || String(error)}`,
      stack: String(error?.stack || "").trim().split("\n").slice(1, 4).map((line) => line.trim()).join(" <- "),
      componentStack: componentStack.trim().split("\n").slice(0, 4).join(" <- "),
    });
    this.setState({ componentStack });
    // Written out now rather than on the debounce: the player's next move is the
    // Reload button below, and the whole point of persisting the log is that it
    // survives that.
    flushDebugLog();
  }

  handleReload = () => {
    flushDebugLog();
    window.location.reload();
  };

  render() {
    const { componentStack, error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={styles.shell} role="alert">
        <div style={styles.card}>
          <div style={styles.title}>Something went wrong</div>
          <div style={styles.body}>
            The world view hit an unexpected error and had to stop. Your saved games
            are safe — reloading usually recovers.
          </div>
          {error?.message ? <pre style={styles.detail}>{String(error.message)}</pre> : null}
          <div style={styles.actions}>
            <button type="button" style={styles.button} onClick={this.handleReload}>
              Reload
            </button>
            <CrashReportButton error={error} componentStack={componentStack} />
          </div>
        </div>
      </div>
    );
  }
}

// Inline styles so the fallback renders even if the stylesheet failed to load;
// mirrors the loading screen's dark/gold palette. Fixed + very high z-index so it
// covers the map and all in-game overlays.
const styles = {
  shell: {
    position: "fixed",
    inset: 0,
    zIndex: 100000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6vw",
    background: "#050403",
    color: "#f2e8cc",
    fontFamily: "Georgia, 'EB Garamond', serif",
  },
  card: {
    maxWidth: "30rem",
    width: "100%",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  title: {
    fontSize: "clamp(1.3rem, 3vw, 1.8rem)",
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "#f0cc40",
  },
  body: {
    fontSize: "0.95rem",
    lineHeight: 1.5,
    color: "rgba(215,190,140,0.85)",
  },
  detail: {
    maxHeight: "8rem",
    overflow: "auto",
    textAlign: "left",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.75rem",
    color: "rgba(230,185,120,0.7)",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(210,165,55,0.25)",
    borderRadius: "6px",
    padding: "0.6rem 0.75rem",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  actions: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "0.6rem",
    justifyContent: "center",
    marginTop: "0.4rem",
  },
  button: {
    padding: "0.6rem 1.6rem",
    fontSize: "0.9rem",
    fontWeight: 600,
    letterSpacing: "0.08em",
    color: "#050403",
    background: "#e8c040",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
  },
  secondaryButton: {
    padding: "0.6rem 1.1rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "#f2e8cc",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(210,165,55,0.4)",
    borderRadius: "6px",
    cursor: "pointer",
  },
};

export default ErrorBoundary;
