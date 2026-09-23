import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isBrowserOnline, subscribeToNetworkStatus } from "./networkStatus.js";

const withGlobals = (globals, run) => {
  const saved = {};
  for (const key of Object.keys(globals)) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value: globals[key], configurable: true, writable: true });
  }
  try {
    return run();
  } finally {
    for (const key of Object.keys(globals)) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  }
};

test("online unless the browser says there is no network at all", () => {
  withGlobals({ navigator: { onLine: true } }, () => assert.equal(isBrowserOnline(), true));
  withGlobals({ navigator: { onLine: false } }, () => assert.equal(isBrowserOnline(), false));
  // Nothing to ask (a server render, a worker without the property): online.
  withGlobals({ navigator: {} }, () => assert.equal(isBrowserOnline(), true));
});

test("subscribing listens for both online and offline, and unsubscribing stops both", () => {
  const listeners = new Map();
  const fakeWindow = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
  };
  withGlobals({ window: fakeWindow }, () => {
    const listener = () => {};
    const unsubscribe = subscribeToNetworkStatus(listener);
    assert.deepEqual([...listeners.keys()].sort(), ["offline", "online"]);
    unsubscribe();
    assert.equal(listeners.size, 0);
  });
});

test("offline, the map draws the bundled relief and asks no remote tile server", () => {
  const world = fs.readFileSync(new URL("../Game/Map/World.jsx", import.meta.url), "utf8");
  assert.match(world, /const OFFLINE_RELIEF_TILES = "\/offline-relief\/\{z\}\/\{y\}\/\{x\}\.jpg";/);
  const branch = world.slice(world.indexOf("  if (offline) {"), world.indexOf("// The scenario's basemap is the basemap"));
  assert.match(branch, /"offline-relief": \{/);
  assert.doesNotMatch(branch, /arcgis|amazonaws|terrain-source|ohbase/, "the offline style names no remote source");
  assert.match(world, /buildWorldStyle\(\s*effectiveBasemap,[\s\S]*?terrainEnabled,\s*!online,\s*\)/);
  // A connectivity change remounts the map, as a basemap change does: swapped in
  // place, the style diff dropped the political layers the React tree had added.
  assert.match(world, /const connectivityKey = online \? "" : ":offline";/);
  assert.match(world, /: `\$\{basemapRenderKey\}\$\{connectivityKey\}`;/);
  // Every tile the style can ask for below its maxzoom is in the bundle.
  for (let z = 0; z <= 3; z += 1) {
    for (let y = 0; y < 2 ** z; y += 1) {
      for (let x = 0; x < 2 ** z; x += 1) {
        const tile = new URL(`../../public/offline-relief/${z}/${y}/${x}.jpg`, import.meta.url);
        const head = fs.readFileSync(tile).subarray(0, 2);
        assert.deepEqual([...head], [0xff, 0xd8], `${z}/${y}/${x}.jpg is a JPEG`);
      }
    }
  }
});

test("offline, the startup preload does not warm remote textures", () => {
  const preload = fs.readFileSync(new URL("./preload.js", import.meta.url), "utf8");
  const textures = preload.slice(preload.indexOf('id: "textures"'), preload.indexOf('id: "countries"'));
  assert.match(textures, /if \(!isBrowserOnline\(\)\) return undefined;[\s\S]*warmRemoteResources\(/);
});

test("the loading screen's fonts come from the bundle, not Google", () => {
  const screen = fs.readFileSync(new URL("./StartupScreen.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(screen, /fonts\.googleapis|fonts\.gstatic/);
  assert.match(screen, /import "\.\.\/assets\/fonts\/fonts\.css";/);
  const css = fs.readFileSync(new URL("../assets/fonts/fonts.css", import.meta.url), "utf8");
  const files = [...css.matchAll(/url\(\.\/([^)]+\.woff2)\)/g)].map((m) => m[1]);
  assert.equal(files.length, 10);
  for (const file of files) {
    const head = fs.readFileSync(new URL(`../assets/fonts/${file}`, import.meta.url)).subarray(0, 4).toString("latin1");
    assert.equal(head, "wOF2", `${file} is a woff2 font`);
  }
});
