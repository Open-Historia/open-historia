// How the advisor drawer slides open and shut. The HUD beside it (the date
// widget, flag badge and advisor button, placed by main.jsx) slides with this
// same duration and easing over the same distance, so the two move as one.
// Its own module so main.jsx can share it without loading the lazy advisor chunk.
export const ADVISOR_SLIDE = "0.35s cubic-bezier(0.4, 0, 0.2, 1)";
