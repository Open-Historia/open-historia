/*! Open Historia — Rostra's looks: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/rostraLooks.test.js
//
// "make it so rostra can be themed as a phone, newspaper, scroll, and a stone
// tablet selected by the scenario designer in features" (the owner, 2026-11-10).
//
// The panel is drawn as the page draws it: social.jsx bundled with esbuild and
// rendered by react-dom/server, once in each look the Social media feature can
// give it, with a feed of two posts.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { FEATURE_DEFINITIONS, ROSTRA_LOOKS, featureDefaults, resolveFeatures, rostraLookOf } from "../../../server/gameFeatures.js";
import { ROSTRA_LOOK_VARS, RS } from "./rostraLooks.js";

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const { buildSync } = require("esbuild");
const { renderToStaticMarkup } = require("react-dom/server");
const { createElement: h } = require("react");

let phoneScreen = false;
if (!("window" in globalThis)) {
  globalThis.window = {
    matchMedia: (query) => ({ matches: phoneScreen && /max-width|pointer: coarse|hover: none/.test(query), addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    setTimeout,
    location: { origin: "http://localhost", href: "http://localhost/", protocol: "http:", hostname: "localhost" },
  };
}
if (!("localStorage" in globalThis)) {
  const store = new Map();
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key), clear: () => store.clear() };
}

const loaded = (() => {
  const { outputFiles } = buildSync({
    stdin: {
      contents: [
        'export { SocialPanel } from "./src/Game/GameUI/social.jsx";',
        'export { setActiveFeatures } from "./src/runtime/gameFeatures.js";',
        'export { primeRuntimeValue } from "./src/runtime/runtimeStore.js";',
      ].join("\n"),
      resolveDir: ROOT,
      loader: "js",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    loader: { ".js": "jsx", ".jsx": "jsx" },
    jsx: "automatic",
    define: { "import.meta.env": JSON.stringify({ BASE_URL: "/", MODE: "test" }) },
    external: ["react", "react-dom"],
    logLevel: "error",
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputFiles[0].text)(require, module, module.exports);
  return module.exports;
})();
const { SocialPanel, setActiveFeatures, primeRuntimeValue } = loaded;

const post = (id, fields = {}) => ({ id, author: "Ana Lima", role: "Columnist", country: "", text: `Post ${id}`, date: "1914-07-02", round: 2, kind: "voice", ...fields });
primeRuntimeValue("game", { country: "Kingdom of Serbia", gameDate: "1914-07-03", round: 3 });
primeRuntimeValue("world", { socialFeed: [post("p1"), post("p2", { author: "Nikola Pašić", role: "Prime Minister", country: "Kingdom of Serbia", text: "We will answer Vienna with dignity." })] });

const render = (look) => {
  setActiveFeatures({ socialMedia: { enabled: true, look } }, null);
  return renderToStaticMarkup(h(SocialPanel, { isOpen: true, onClose: () => {}, onSeen: () => {} }));
};

test("the scenario's author picks the look in the Social media feature; a phone unless one is picked", () => {
  const social = FEATURE_DEFINITIONS.find((definition) => definition.key === "socialMedia");
  const look = social.settings.find((setting) => setting.key === "look");
  assert.equal(look.type, "choice");
  assert.deepEqual(look.options.map((option) => [option.value, option.label]), [["phone", "Phone"], ["newspaper", "Newspaper"], ["scroll", "Scroll"], ["tablet", "Stone tablet"]]);
  assert.deepEqual([...ROSTRA_LOOKS], look.options.map((option) => option.value));
  assert.equal(featureDefaults().socialMedia.look, "phone");
  assert.equal(rostraLookOf(resolveFeatures(null, null)), "phone");
  assert.equal(rostraLookOf(resolveFeatures({ socialMedia: { look: "scroll" } }, null)), "scroll");
  // A look this build does not know is the phone, never a broken panel.
  assert.equal(rostraLookOf(resolveFeatures({ socialMedia: { look: "hologram" } }, null)), "phone");
});

test("every look gives every colour and face the panel reads", () => {
  const names = Object.keys(ROSTRA_LOOK_VARS.phone);
  for (const look of ROSTRA_LOOKS) assert.deepEqual(Object.keys(ROSTRA_LOOK_VARS[look]), names, look);
  for (const value of Object.values(RS)) assert.match(value, /^var\(--rs-[a-z-]+, .+\)$/);
  // No gradients and no purple, in any look.
  const source = ["rostraLooks.js", "social.jsx", "rostraSearch.jsx", "rostraRefresh.jsx"].map((file) => fs.readFileSync(new URL(`./${file}`, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(source, /gradient\(/);
  assert.doesNotMatch(source, /#(?:7c3aed|8b5cf6|a855f7|9333ea)|purple|violet/i);
});

test("each look is drawn in its own frame, with the same posts", () => {
  phoneScreen = false;
  const drawn = Object.fromEntries(ROSTRA_LOOKS.map((look) => [look, render(look)]));
  for (const look of ROSTRA_LOOKS) {
    const html = drawn[look];
    assert.match(html, new RegExp(`data-rostra-look="${look}"`));
    assert.match(html, new RegExp(`--rs-screen:${ROSTRA_LOOK_VARS[look]["--rs-screen"]}`), look);
    assert.match(html, /We will answer Vienna with dignity\./);
    assert.match(html, /Post p1/);
  }
  // Only the phone has a status bar, side buttons and a home bar; only the scroll its two rolls.
  const phoneOnly = (html) => html.includes("width:6.6rem");
  assert.equal(phoneOnly(drawn.phone), true);
  for (const look of ["newspaper", "scroll", "tablet"]) assert.equal(phoneOnly(drawn[look]), false, look);
  const rolls = (html) => (html.match(/background:#b98a4b/g) ?? []).length;
  assert.deepEqual(ROSTRA_LOOKS.map((look) => rolls(drawn[look])), [0, 0, 2, 0]);
  // The tablet's arched top; the newspaper's double rule.
  assert.match(drawn.tablet, /border-radius:10rem 10rem 1rem 1rem/);
  assert.match(drawn.newspaper, /border:3px double/);
});

test("on a phone screen there is no frame: the look's paper fills the panel", () => {
  phoneScreen = true;
  try {
    for (const look of ["newspaper", "scroll", "tablet"]) {
      const html = render(look);
      assert.match(html, /background-color:var\(--rs-screen, #0b0b0d\)/, look);
      assert.doesNotMatch(html, /background:#b98a4b/);
      assert.doesNotMatch(html, /border-radius:10rem/);
    }
    assert.match(render("phone"), /background-color:rgba\(11, 11, 13, 0\.97\)/);
  } finally {
    phoneScreen = false;
  }
});
