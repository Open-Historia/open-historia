/*! Open Historia — the page's zoom keys © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Pressing ctrl + "-" in the main menu shrinks the text, but ctrl + "+" does
// not increase the size - so now I'm seemingly stuck with tiny text" (a
// player, 2026-10-27). Electron's own menu zooms in on Ctrl+Plus, which on
// most keyboards is Ctrl+Shift+=, so the key everybody presses, Ctrl+=, did
// nothing while Ctrl+- zoomed out. Here every usual key does what it says:
// Ctrl (Cmd on a Mac) with = or + (main row or keypad) zooms in, with - (main
// row or keypad) zooms out, and with 0 puts it back.

const ZOOM_STEP = 0.5;
const ZOOM_LEAST = -3;
const ZOOM_MOST = 4;

// What a key press asks of the zoom: "in", "out", "reset", or "" for nothing.
const zoomKeyOf = (input) => {
  if (!input || input.type !== "keyDown" || input.alt || !(input.control || input.meta)) return "";
  const key = String(input.key ?? "");
  const code = String(input.code ?? "");
  if (key === "=" || key === "+" || code === "Equal" || code === "NumpadAdd") return "in";
  if (key === "-" || key === "_" || code === "Minus" || code === "NumpadSubtract") return "out";
  if (key === "0" || code === "Digit0" || code === "Numpad0") return "reset";
  return "";
};

// The zoom level a press leads to from `level`, within ZOOM_LEAST..ZOOM_MOST.
const nextZoomLevel = (level, asked) => {
  const now = Number.isFinite(level) ? level : 0;
  if (asked === "reset") return 0;
  const next = asked === "in" ? now + ZOOM_STEP : asked === "out" ? now - ZOOM_STEP : now;
  return Math.max(ZOOM_LEAST, Math.min(ZOOM_MOST, next));
};

// Handles the zoom keys on a window's page before anything else sees them.
const attachZoomKeys = (webContents) => {
  webContents.on("before-input-event", (event, input) => {
    const asked = zoomKeyOf(input);
    if (!asked) return;
    event.preventDefault();
    webContents.setZoomLevel(nextZoomLevel(webContents.getZoomLevel(), asked));
  });
};

module.exports = { ZOOM_LEAST, ZOOM_MOST, ZOOM_STEP, attachZoomKeys, nextZoomLevel, zoomKeyOf };
