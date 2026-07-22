/*! Open Historia — React error boundary (recoverable render-crash fallback) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React from "react";

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
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Render crash caught by ErrorBoundary:", error, info?.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
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
          <button type="button" style={styles.button} onClick={this.handleReload}>
            Reload
          </button>
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
  button: {
    alignSelf: "center",
    marginTop: "0.4rem",
    padding: "0.6rem 1.6rem",
    fontSize: "0.9rem",
    fontWeight: 600,
    letterSpacing: "0.08em",
    color: "#050403",
    background: "linear-gradient(90deg, #d4a820, #ffe370)",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
  },
};

export default ErrorBoundary;
