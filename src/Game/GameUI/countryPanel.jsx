/*! Open Historia — standalone country panel */
import React, { useCallback, useState } from "react";
import StatsPane from "./stats.jsx";
import { ADVISOR_SLIDE } from "./advisorSlide.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";

const COUNTRY_PANEL_WIDTH = "min(20rem, calc(100vw - 1rem))";

const CountryPanel = ({ open, onClose, width, onResize, onResizeEnd }) => {
  const [isResizing, setIsResizing] = useState(false);
  const [handleHover, setHandleHover] = useState(false);
  const isMobile = useIsMobile();

  const handleResizeStart = useCallback((event) => {
    if (typeof onResize !== "function") return;
    event.preventDefault();
    const target = event.currentTarget;
    try { target.setPointerCapture(event.pointerId); } catch { /* optional */ }
    setIsResizing(true);
    const onMove = (moveEvent) => onResize(window.innerWidth - moveEvent.clientX);
    const onUp = () => {
      setIsResizing(false);
      onResizeEnd?.();
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }, [onResize, onResizeEnd]);

  return (
    <div style={{
      position: "fixed",
      bottom: 0,
      right: 0,
      transform: open ? "translateX(0)" : "translateX(100%)",
      width: width || COUNTRY_PANEL_WIDTH,
      height: "100vh",
      backgroundColor: "rgba(24, 24, 27, 0.95)",
      backdropFilter: "blur(8px)",
      zIndex: isMobile ? 10040 : 9997,
      borderLeft: "1px solid rgba(255,255,255,0.1)",
      boxShadow: open ? "-4px 0 24px rgba(0,0,0,0.4)" : "none",
      transition: `transform ${ADVISOR_SLIDE}, box-shadow ${ADVISOR_SLIDE}`,
      display: "flex",
      flexDirection: "column",
      color: "white",
      fontFamily: "sans-serif",
      overflow: "hidden",
    }}>
      {typeof onResize === "function" && (
        <div
          onPointerDown={handleResizeStart}
          onPointerEnter={() => setHandleHover(true)}
          onPointerLeave={() => setHandleHover(false)}
          title="Drag to resize"
          style={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: "10px",
            cursor: "ew-resize", zIndex: 30, touchAction: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div style={{
            width: "3px", height: "42px", borderRadius: "2px",
            backgroundColor: isResizing
              ? "rgba(96,165,250,0.95)"
              : handleHover ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.22)",
            transition: "background-color 0.15s",
          }} />
        </div>
      )}

      <div style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", gap: "0.5rem", padding: "0.78rem 0.75rem" }}>
        <span aria-hidden="true" style={{ fontSize: "1rem" }}>🏳</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "0.9rem", fontWeight: 800 }}>Country</div>
          <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.6rem", marginTop: "0.1rem" }}>Politics, diplomacy and national statistics</div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onClose}
          title="Close country panel"
          aria-label="Close country panel"
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: "1.35rem", lineHeight: 1, padding: "0 0 0 0.5rem", display: "flex", alignItems: "center" }}
        >✕</button>
      </div>

      <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0 }}>
        <StatsPane active={open} />
      </div>
    </div>
  );
};

export { CountryPanel };
