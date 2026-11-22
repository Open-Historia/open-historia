import test from "node:test";
import assert from "node:assert/strict";

import { behindGlobe, createPolityTextCustomLayer, globeSamples } from "./polityTextCustomLayer.js";
import { polityLabelVisibilityFor } from "../../../runtime/polityLabelVisibility.js";

// Just enough WebGL for the layer: every resource is a tagged object, every
// other call is a no-op, and textures bound for a draw are recorded.
const fakeGl = () => {
  const deletedTextures = new Set();
  const drawnTextures = [];
  let boundTexture = null;
  let serial = 0;
  const methods = {
    isContextLost: () => false,
    createShader: () => ({ shader: (serial += 1) }),
    getShaderParameter: () => true,
    createProgram: () => ({ program: (serial += 1) }),
    getProgramParameter: () => true,
    getUniformLocation: (_program, name) => ({ name }),
    getAttribLocation: () => 0,
    createBuffer: () => ({ buffer: (serial += 1) }),
    createTexture: () => ({ texture: (serial += 1) }),
    deleteTexture: (texture) => deletedTextures.add(texture),
    bindTexture: (_target, texture) => { boundTexture = texture; },
    drawArrays: (mode) => {
      if (mode === "TRIANGLE_STRIP" && boundTexture) drawnTextures.push(boundTexture);
    },
  };
  const gl = new Proxy(methods, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === "string" && /^[A-Z0-9_]+$/.test(key)) return key;
      return () => {};
    },
  });
  return { gl, deletedTextures, drawnTextures };
};

const fakeMap = () => ({ getZoom: () => 4, getBounds: () => null, triggerRepaint: () => {} });

// A prepared label as the layer holds it. Without a canvas it cannot be
// uploaded yet, which is how a new label still being drawn looks to render().
const entry = (owner, { uploadable = true } = {}) => ({
  record: { owner, text: owner.toUpperCase(), minZoom: 0, maxZoom: 24, priorityScale: 1 },
  mercatorBounds: null,
  ribbonVertices: new Float32Array(8),
  ribbonVertexCount: 2,
  lineVertices: new Float32Array(4),
  lineVertexCount: 2,
  raster: { canvas: uploadable ? { width: 4, height: 2 } : null },
  requestedFontPxAtZoom4: 12,
  effectiveFontPxAtZoom4: 12,
  supportLength: 1,
  baselineLength: 1,
});

const frame = new Float32Array(16);

const drawnOwners = (layer, drawnTextures) => {
  const owners = [];
  for (const texture of drawnTextures) {
    const held = [...layer._entries, ...(layer._pendingEntries ?? [])].find((item) => item.texture === texture);
    owners.push(held?.record.owner ?? "released");
  }
  return owners;
};

test("the old labels keep drawing until every visible new label is uploaded, then are released", () => {
  const { gl, deletedTextures, drawnTextures } = fakeGl();
  const old = entry("Prussia");
  const layer = createPolityTextCustomLayer({ preparedEntries: [old], debugBaseline: false });
  layer.onAdd(fakeMap(), gl);
  layer.render(gl, frame);
  assert.deepEqual(drawnOwners(layer, drawnTextures), ["Prussia"]);
  const oldTexture = old.texture;

  const fresh = entry("Germany", { uploadable: false });
  layer.replacePreparedEntries([fresh]);
  drawnTextures.length = 0;
  layer.render(gl, frame);
  assert.deepEqual(drawnOwners(layer, drawnTextures), ["Prussia"], "no gap while the new label is not drawable");
  assert.equal(deletedTextures.has(oldTexture), false);

  fresh.raster.canvas = { width: 4, height: 2 };
  drawnTextures.length = 0;
  layer.render(gl, frame);
  assert.deepEqual(drawnOwners(layer, drawnTextures), ["Germany"]);
  assert.equal(deletedTextures.has(oldTexture), true, "the replaced label's texture is freed after the swap");
  assert.deepEqual(layer._entries, [fresh]);
});

test("a layer removed before its replacement is drawn comes back with the new labels", () => {
  const { gl, drawnTextures } = fakeGl();
  const layer = createPolityTextCustomLayer({ preparedEntries: [entry("Prussia")], debugBaseline: false });
  layer.onAdd(fakeMap(), gl);
  layer.render(gl, frame);

  // A time skip publishes the new names, and the context is lost before a frame.
  const fresh = entry("Germany");
  layer.replacePreparedEntries([fresh]);
  layer.onRemove(fakeMap(), gl);

  layer.onAdd(fakeMap(), gl);
  drawnTextures.length = 0;
  layer.render(gl, frame);
  assert.deepEqual(drawnOwners(layer, drawnTextures), ["Germany"]);
  assert.deepEqual(layer._entries, [fresh]);
});

test("the layer logs nothing per label unless diagnostics are on", (t) => {
  const info = t.mock.method(console, "info", () => {});
  const { gl } = fakeGl();
  const quiet = createPolityTextCustomLayer({ preparedEntries: [entry("Prussia")], debugBaseline: false });
  quiet.onAdd(fakeMap(), gl);
  quiet.render(gl, frame);
  assert.equal(info.mock.callCount(), 0);

  const loud = createPolityTextCustomLayer({ preparedEntries: [entry("Prussia")], debugBaseline: false, diagnostics: true });
  loud.onAdd(fakeMap(), gl);
  loud.render(gl, frame);
  assert.ok(info.mock.callCount() >= 2, "onAdd, shader compile and first render log when asked");
});

// The plane the map gave for a view of the Atlantic at 23W, read from a running game.
const ATLANTIC_VIEW = [-0.4029, 0, 0.9152, -0.4115];
const ribbonAt = (longitude, latitude) => {
  const x = (longitude + 180) / 360;
  const y = 0.5 - Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360)) / (Math.PI * 2);
  return new Float32Array([x - 0.01, y, 0, 0, x, y, 0.5, 0, x + 0.01, y, 1, 0]);
};

test("a label on the far side of the globe is not drawn, and one in view is", () => {
  assert.equal(behindGlobe(globeSamples(ribbonAt(134, -25)), ATLANTIC_VIEW), true, "Australia, from over the Atlantic");
  assert.equal(behindGlobe(globeSamples(ribbonAt(-23, 0)), ATLANTIC_VIEW), false, "the middle of the view");
  assert.equal(behindGlobe(globeSamples(ribbonAt(-14, 14)), ATLANTIC_VIEW), false, "Dakar");
});

test("the rim is left to the shader, and a label reaching back over the horizon stays", () => {
  const horizon = Math.acos(0.4115) * (180 / Math.PI);
  assert.equal(behindGlobe(globeSamples(ribbonAt(-23 + horizon, 0)), ATLANTIC_VIEW), false, "on the horizon");
  const reaching = new Float32Array([...ribbonAt(134, -25), ...ribbonAt(-23, 0)]);
  assert.equal(behindGlobe(globeSamples(reaching), ATLANTIC_VIEW), false);
});

test("nothing is held back on a flat map, where the plane is zero, or for a label with no shape", () => {
  assert.equal(behindGlobe(globeSamples(ribbonAt(134, -25)), [0, 0, 0, 0]), false);
  assert.equal(behindGlobe([], ATLANTIC_VIEW), false);
});

test("N029: adjust the close-zoom cutoff live without replacing the existing PTR texture or geometry", () => {
  const { gl, deletedTextures, drawnTextures } = fakeGl();
  const label = entry("Bulgaria");
  label.record.maxZoom = 6.2;
  label.record.fadeOutStartZoom = 5;
  let zoom = 4;
  let visibility = polityLabelVisibilityFor("");
  let reads = 0;
  const layer = createPolityTextCustomLayer({
    preparedEntries: [label], debugBaseline: false,
    getVisibility: () => { reads += 1; return visibility; },
  });
  layer.onAdd({ ...fakeMap(), getZoom: () => zoom }, gl);
  const frameOwners = () => {
    drawnTextures.length = 0;
    const before = reads;
    layer.render(gl, frame);
    assert.equal(reads, before + 1, "one shared policy read per draw frame");
    return drawnOwners(layer, drawnTextures);
  };
  assert.deepEqual(frameOwners(), ["Bulgaria"]);
  const texture = label.texture;
  const ribbon = label.ribbonBuffer;
  zoom = 7;
  assert.deepEqual(frameOwners(), []);
  visibility = polityLabelVisibilityFor(9);
  assert.deepEqual(frameOwners(), ["Bulgaria"], "the same prepared label reappears at close zoom");
  assert.equal(label.texture, texture);
  assert.equal(label.ribbonBuffer, ribbon);
  assert.equal(deletedTextures.has(texture), false);
  assert.equal(label.record.maxZoom, 6.2, "canonical record was not changed");
  zoom = 9;
  assert.deepEqual(frameOwners(), []);
  zoom = 4.8;
  visibility = polityLabelVisibilityFor(5);
  assert.deepEqual(frameOwners(), ["Bulgaria"]);
  zoom = 5;
  assert.deepEqual(frameOwners(), []);
  visibility = polityLabelVisibilityFor(6.2);
  assert.deepEqual(frameOwners(), ["Bulgaria"], "reset restores the existing renderer's default");
});

test("N029: pending atomic PTR replacements use the same live visibility as accepted entries", () => {
  const { gl, drawnTextures } = fakeGl();
  const old = entry("Bulgaria");
  const next = entry("New Bulgaria", { uploadable: false });
  const layer = createPolityTextCustomLayer({
    preparedEntries: [old], debugBaseline: false,
    getVisibility: () => polityLabelVisibilityFor(9),
  });
  layer.onAdd({ ...fakeMap(), getZoom: () => 7 }, gl);
  old.record.maxZoom = next.record.maxZoom = 6.2;
  layer.render(gl, frame);
  layer.replacePreparedEntries([next]);
  drawnTextures.length = 0;
  layer.render(gl, frame);
  assert.deepEqual(drawnOwners(layer, drawnTextures), ["Bulgaria"], "do not swap until the new now-visible label uploads");
  next.raster.canvas = { width: 4, height: 2 };
  drawnTextures.length = 0;
  layer.render(gl, frame);
  assert.deepEqual(drawnOwners(layer, drawnTextures), ["New Bulgaria"]);
});
