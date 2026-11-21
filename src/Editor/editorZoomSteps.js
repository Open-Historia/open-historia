/*!
 * OpenHistoria Map Editor - progressive view zoom contract.
 * Map zoom is logarithmic: +1 doubles linear magnification.
 */
export const EDITOR_ZOOM_STEP_BREAK = 6;
export const EDITOR_FINE_ZOOM_STEP = 0.63;
export const EDITOR_COARSE_ZOOM_STEP = 1;
export const EDITOR_WHEEL_UNITS_PER_NOTCH = 100;

export const editorZoomStep = (level) =>
  Number.isFinite(level) && level >= EDITOR_ZOOM_STEP_BREAK
    ? EDITOR_FINE_ZOOM_STEP
    : EDITOR_COARSE_ZOOM_STEP;

// Map zoom to a monotonic "wheel notch" position so + then - restores
// the original view even when a click crosses the Z6 threshold.
const toSteps = (level) =>
  level <= EDITOR_ZOOM_STEP_BREAK
    ? level / EDITOR_COARSE_ZOOM_STEP
    : EDITOR_ZOOM_STEP_BREAK / EDITOR_COARSE_ZOOM_STEP +
      (level - EDITOR_ZOOM_STEP_BREAK) / EDITOR_FINE_ZOOM_STEP;
const fromSteps = (steps) => {
  const coarse = EDITOR_ZOOM_STEP_BREAK / EDITOR_COARSE_ZOOM_STEP;
  return steps <= coarse
    ? steps * EDITOR_COARSE_ZOOM_STEP
    : EDITOR_ZOOM_STEP_BREAK + (steps - coarse) * EDITOR_FINE_ZOOM_STEP;
};

export const nextEditorZoom = (level, direction, min = 1, max = 24) => {
  if (!Number.isFinite(level) || !Number.isFinite(direction) || !direction) return level;
  const target = fromSteps(toSteps(level) + Math.sign(direction));
  return Math.min(max, Math.max(min, Math.round(target * 1e6) / 1e6));
};
