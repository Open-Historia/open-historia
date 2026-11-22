/*!
 * OpenHistoria Map Editor - purpose-built, themeable OpenLayers zoom control.
 * Only the editor replaces the stock Zoom control; map pickers keep their own.
 */
import Control from "ol/control/Control.js";
import { easeOut } from "ol/easing.js";
import { nextEditorZoom, EDITOR_ZOOM_STEP_BREAK, EDITOR_FINE_ZOOM_STEP } from "./editorZoomSteps.js";

export const createEditorZoomControl = () => {
  const element = document.createElement("div");
  element.className = "ol-zoom ol-unselectable ol-control oh-editor-zoom-control";

  const makeButton = (className, label, title) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.setAttribute("aria-label", title);
    button.title = title;
    return button;
  };

  const zoomIn = makeButton("ol-zoom-in", "+", "Zoom in");
  const zoomOut = makeButton("ol-zoom-out", "−", "Zoom out");
  const readout = document.createElement("div");
  readout.className = "oh-editor-zoom-readout";
  readout.setAttribute("aria-label", "Editor zoom level");
  readout.title = `Map view zoom (maximum 24). At zoom ${EDITOR_ZOOM_STEP_BREAK} and above, each step is ${EDITOR_FINE_ZOOM_STEP} zoom levels.`;
  const value = document.createElement("span");
  value.className = "oh-editor-zoom-value";
  const caption = document.createElement("span");
  caption.className = "oh-editor-zoom-caption";
  caption.textContent = "ZOOM / 24";
  readout.append(value, caption);

  element.append(zoomIn, readout, zoomOut);
  const control = new Control({ element });

  const update = (level) => {
    value.textContent = Number.isFinite(level) ? `Z ${level.toFixed(1)}` : "Z --";
    // The native View enforces the bounds; this is affordance feedback only.
    zoomIn.disabled = Number.isFinite(level) && level >= 24 - 1e-8;
    zoomOut.disabled = Number.isFinite(level) && level <= 1 + 1e-8;
    zoomIn.title = level >= EDITOR_ZOOM_STEP_BREAK
      ? `Zoom in (+${EDITOR_FINE_ZOOM_STEP} levels)`
      : "Zoom in (+1 level)";
    zoomOut.title = level > EDITOR_ZOOM_STEP_BREAK
      ? `Zoom out (up to ${EDITOR_FINE_ZOOM_STEP} levels)`
      : "Zoom out (-1 level)";
  };

  const animate = (direction) => {
    const view = control.getMap()?.getView();
    const level = view?.getZoom();
    if (!Number.isFinite(level)) return;
    const target = nextEditorZoom(level, direction);
    if (Math.abs(target - level) < 1e-7) return;
    if (view.getAnimating()) view.cancelAnimations();
    view.animate({ zoom: target, duration: 170, easing: easeOut });
  };
  const clickIn = (event) => { event.preventDefault(); animate(1); };
  const clickOut = (event) => { event.preventDefault(); animate(-1); };
  zoomIn.addEventListener("click", clickIn);
  zoomOut.addEventListener("click", clickOut);

  return {
    control,
    update,
    dispose: () => {
      zoomIn.removeEventListener("click", clickIn);
      zoomOut.removeEventListener("click", clickOut);
      control.setMap(null);
    },
  };
};
