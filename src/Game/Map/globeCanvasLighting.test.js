/*! Open Historia — globe lighting: who shades which frame, and the reused buffer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

import { buildGlobeLightingWorkerSource } from "./globeLightingPixels.js";

// The page side needs a Worker, ImageData and a 2D canvas; node has none, so
// stand-ins record what the module asks of them.
class FakeWorker {
  static instances = [];
  constructor() {
    this.posted = [];
    FakeWorker.instances.push(this);
  }
  postMessage(message, transfer = []) {
    this.posted.push({ message, transfer });
  }
  terminate() {
    this.terminated = true;
  }
}
globalThis.Worker = FakeWorker;
globalThis.ImageData = class {
  constructor(data, width, height) {
    assert.equal(data.length, width * height * 4, "ImageData size");
    this.data = data;
    this.width = width;
    this.height = height;
  }
};

const { drawGlobeLighting, releaseGlobeLighting } = await import("./globeCanvasLighting.js");

const makeCanvas = () => {
  const canvas = { width: 1, height: 1, painted: [] };
  canvas.getContext = () => ({ putImageData: (image) => canvas.painted.push(image) });
  return canvas;
};

// A camera three radii out looking at the globe; the numbers only have to be
// a valid, invertible frame.
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const frame = (canvas, extra = {}) => ({
  canvas,
  matrix: IDENTITY,
  cameraPosition: [0, 0, 3],
  sunDirection: [0, 0, 1],
  width: 1000,
  height: 800,
  opacity: 1,
  ...extra,
});

const workerFor = (canvas, draw) => {
  const before = FakeWorker.instances.length;
  draw();
  assert.equal(FakeWorker.instances.length, before + 1, "one worker per canvas");
  return FakeWorker.instances.at(-1);
};

test("an auto-rotation frame goes to the worker at the interactive size", () => {
  const canvas = makeCanvas();
  const worker = workerFor(canvas, () => drawGlobeLighting(frame(canvas, { interactive: true })));
  assert.equal(canvas.painted.length, 0, "nothing shaded on the main thread");
  assert.equal(worker.posted.length, 1);
  const { pixelWidth, pixelHeight } = worker.posted[0].message;
  assert.ok(pixelWidth * pixelHeight <= 48_000, `${pixelWidth}x${pixelHeight}`);
  releaseGlobeLighting(canvas);
});

test("a still globe is refined in the worker", () => {
  const canvas = makeCanvas();
  const worker = workerFor(canvas, () => drawGlobeLighting(frame(canvas)));
  const { pixelWidth, pixelHeight } = worker.posted[0].message;
  assert.ok(pixelWidth * pixelHeight > 48_000 && pixelWidth * pixelHeight <= 180_000);
  releaseGlobeLighting(canvas);
});

test("a camera the player is moving is shaded inline, the same frame", () => {
  const canvas = makeCanvas();
  const worker = workerFor(canvas, () => drawGlobeLighting(frame(canvas, { immediate: true, interactive: true })));
  assert.equal(worker.posted.length, 0);
  assert.equal(canvas.painted.length, 1);
  assert.ok(canvas.painted[0].width * canvas.painted[0].height <= 48_000);
  releaseGlobeLighting(canvas);
});

test("the worker's answer comes back to it as the next frame's buffer", () => {
  const canvas = makeCanvas();
  const worker = workerFor(canvas, () => drawGlobeLighting(frame(canvas, { interactive: true })));
  const first = worker.posted[0];
  assert.equal(first.message.outputBuffer, undefined, "nothing to hand back yet");
  const buffer = new ArrayBuffer(first.message.pixelWidth * first.message.pixelHeight * 4);
  worker.onmessage({
    data: { pixels: buffer, width: first.message.pixelWidth, height: first.message.pixelHeight, requestId: first.message.requestId },
  });
  assert.equal(canvas.painted.length, 1, "the answer is painted");

  drawGlobeLighting(frame(canvas, { interactive: true }));
  const second = worker.posted[1];
  assert.equal(second.message.outputBuffer, buffer);
  assert.deepEqual(second.transfer, [buffer], "transferred, not copied");

  // While the worker is busy, a newer frame waits and takes no buffer.
  drawGlobeLighting(frame(canvas, { interactive: true }));
  assert.equal(worker.posted.length, 2);
  releaseGlobeLighting(canvas);
});

test("the worker shades into the buffer it was handed", () => {
  const self = {};
  new Function("self", buildGlobeLightingWorkerSource())(self);
  const posted = [];
  self.postMessage = (message, transfer) => posted.push({ message, transfer });
  const request = {
    matrix: IDENTITY,
    cameraPosition: [0, 0, 3],
    sunDirection: [0, 0, 1],
    pixelWidth: 40,
    pixelHeight: 30,
    opacity: 1,
    requestId: 7,
  };

  const outputBuffer = new ArrayBuffer(40 * 30 * 4);
  self.onmessage({ data: { ...request, outputBuffer } });
  assert.equal(posted[0].message.pixels, outputBuffer);
  assert.equal(posted[0].message.requestId, 7);

  // A buffer of the wrong size (the window was resized) is replaced.
  const stale = new ArrayBuffer(16);
  self.onmessage({ data: { ...request, outputBuffer: stale } });
  assert.notEqual(posted[1].message.pixels, stale);
  assert.equal(posted[1].message.pixels.byteLength, 40 * 30 * 4);

  self.onmessage({ data: request });
  assert.equal(posted[2].message.pixels.byteLength, 40 * 30 * 4);
});
