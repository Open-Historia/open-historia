import test from "node:test";
import assert from "node:assert/strict";

import { createPolityTextCustomLayer } from "./polityTextCustomLayer.js";

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
