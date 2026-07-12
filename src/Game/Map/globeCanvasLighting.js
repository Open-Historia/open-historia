/*! Open Historia - frame-synced worker-backed globe lighting (c) 2026 Nicholas Krol, MIT. */
import {
  buildGlobeLightingWorkerSource,
  renderGlobeLightingPixels,
} from "./globeLightingPixels.js";

const REFINED_RENDER_PIXELS = 180_000;
const INTERACTIVE_RENDER_PIXELS = 48_000;
const CANVAS_STATES = new WeakMap();

const getRenderSize = (width, height, maxPixels) => {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  return {
    pixelWidth: Math.max(1, Math.floor(width * scale)),
    pixelHeight: Math.max(1, Math.floor(height * scale)),
  };
};

const paintPixels = (canvas, pixels, width, height) => {
  const context = canvas.getContext("2d");
  if (!context) return;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.putImageData(new ImageData(pixels, width, height), 0, 0);
};

const dispatch = (state, payload) => {
  state.busy = true;
  state.pending = null;
  state.active = payload;
  state.worker.postMessage(payload);
};

const createState = (canvas) => {
  const state = {
    worker: null,
    busy: false,
    pending: null,
    active: null,
    failed: false,
    latestRequestId: 0,
    interactivePixels: null,
  };
  let workerUrl;
  try {
    workerUrl = URL.createObjectURL(new Blob(
      [buildGlobeLightingWorkerSource()],
      { type: "text/javascript" },
    ));
    state.worker = new Worker(workerUrl);
  } catch (error) {
    console.warn("Globe lighting worker is unavailable; using synchronous shade.", error);
    state.failed = true;
    return state;
  } finally {
    if (workerUrl) URL.revokeObjectURL(workerUrl);
  }

  state.worker.onmessage = ({ data }) => {
    if (CANVAS_STATES.get(canvas) !== state) return;
    state.busy = false;
    state.active = null;
    if (data.requestId === state.latestRequestId) {
      paintPixels(
        canvas,
        new Uint8ClampedArray(data.pixels),
        data.width,
        data.height,
      );
    }
    if (state.pending) dispatch(state, state.pending);
  };
  state.worker.onerror = (error) => {
    if (CANVAS_STATES.get(canvas) !== state) return;
    console.warn("Globe lighting worker failed; using synchronous shade.", error);
    const fallbackCandidate = state.pending ?? state.active;
    const fallbackPayload = fallbackCandidate?.requestId === state.latestRequestId
      ? fallbackCandidate
      : null;
    state.failed = true;
    state.busy = false;
    state.pending = null;
    state.active = null;
    state.worker?.terminate();
    state.worker = null;
    if (fallbackPayload) {
      const scale = Math.min(1, Math.sqrt(
        INTERACTIVE_RENDER_PIXELS
        / (fallbackPayload.pixelWidth * fallbackPayload.pixelHeight),
      ));
      const pixelWidth = Math.max(1, Math.floor(fallbackPayload.pixelWidth * scale));
      const pixelHeight = Math.max(1, Math.floor(fallbackPayload.pixelHeight * scale));
      state.interactivePixels = renderGlobeLightingPixels({
        ...fallbackPayload,
        pixelWidth,
        pixelHeight,
        outputPixels: state.interactivePixels,
      });
      paintPixels(canvas, state.interactivePixels, pixelWidth, pixelHeight);
    }
  };
  return state;
};

export const releaseGlobeLighting = (canvas) => {
  if (!canvas) return;
  const state = CANVAS_STATES.get(canvas);
  state?.worker?.terminate();
  CANVAS_STATES.delete(canvas);
  canvas.width = 1;
  canvas.height = 1;
};

export const drawGlobeLighting = ({
  canvas,
  matrix,
  cameraPosition,
  sunDirection,
  width,
  height,
  opacity,
  immediate = false,
}) => {
  if (!canvas || !matrix || !cameraPosition || !sunDirection || opacity <= 0 || width <= 0 || height <= 0) {
    releaseGlobeLighting(canvas);
    return;
  }

  let state = CANVAS_STATES.get(canvas);
  if (!state) {
    state = createState(canvas);
    CANVAS_STATES.set(canvas, state);
  }
  const requestId = ++state.latestRequestId;
  const synchronous = immediate || state.failed;
  const { pixelWidth, pixelHeight } = getRenderSize(
    width,
    height,
    synchronous ? INTERACTIVE_RENDER_PIXELS : REFINED_RENDER_PIXELS,
  );
  const payload = {
    matrix: Array.from(matrix),
    cameraPosition: Array.from(cameraPosition),
    sunDirection: Array.from(sunDirection),
    pixelWidth,
    pixelHeight,
    opacity,
    requestId,
  };

  if (synchronous) {
    state.pending = null;
    state.interactivePixels = renderGlobeLightingPixels({
      ...payload,
      outputPixels: state.interactivePixels,
    });
    paintPixels(canvas, state.interactivePixels, pixelWidth, pixelHeight);
    return;
  }

  if (state.busy) state.pending = payload;
  else dispatch(state, payload);
};
