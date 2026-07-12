/*! Open Historia - fail-safe worker-backed globe lighting (c) 2026 Nicholas Krol, MIT. */
import { buildGlobeLightingWorkerSource } from "./globeLightingPixels.js";

const MAX_RENDER_PIXELS = 180_000;
const CANVAS_STATES = new WeakMap();

const getRenderSize = (width, height) => {
  const scale = Math.min(1, Math.sqrt(MAX_RENDER_PIXELS / (width * height)));
  return {
    pixelWidth: Math.max(1, Math.floor(width * scale)),
    pixelHeight: Math.max(1, Math.floor(height * scale)),
  };
};

const dispatch = (state, payload) => {
  state.busy = true;
  state.pending = null;
  state.worker.postMessage(payload);
};

const createState = (canvas) => {
  let worker;
  let workerUrl;
  try {
    const workerSource = buildGlobeLightingWorkerSource();
    workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    worker = new Worker(workerUrl);
  } catch (error) {
    console.warn("Globe lighting worker is unavailable; continuing without surface shade.", error);
    return { failed: true };
  } finally {
    if (workerUrl) URL.revokeObjectURL(workerUrl);
  }
  const state = { worker, busy: false, pending: null, failed: false };
  worker.onmessage = ({ data }) => {
    if (CANVAS_STATES.get(canvas) !== state) return;
    state.busy = false;
    const context = canvas.getContext("2d");
    if (context && canvas.width === data.width && canvas.height === data.height) {
      context.putImageData(
        new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height),
        0,
        0,
      );
    }
    if (state.pending) dispatch(state, state.pending);
  };
  worker.onerror = (error) => {
    if (CANVAS_STATES.get(canvas) !== state) return;
    console.warn("Globe lighting worker failed; continuing without surface shade.", error);
    state.failed = true;
    state.busy = false;
    state.pending = null;
    worker.terminate();
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
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
}) => {
  if (!canvas || !matrix || !cameraPosition || !sunDirection || opacity <= 0 || width <= 0 || height <= 0) {
    releaseGlobeLighting(canvas);
    return;
  }
  const { pixelWidth, pixelHeight } = getRenderSize(width, height);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  let state = CANVAS_STATES.get(canvas);
  if (!state) {
    state = createState(canvas);
    CANVAS_STATES.set(canvas, state);
  }
  if (state.failed) return;
  const payload = {
    matrix: Array.from(matrix),
    cameraPosition: Array.from(cameraPosition),
    sunDirection: Array.from(sunDirection),
    pixelWidth,
    pixelHeight,
    opacity,
  };
  if (state.busy) state.pending = payload;
  else dispatch(state, payload);
};
