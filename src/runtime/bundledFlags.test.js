/*! Open Historia — the built-in flags ship with the game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/bundledFlags.test.js
//
// The built-in flags are files in public/flags/ (scripts/fetch-flags.mjs), so they
// draw offline and no flag request leaves the device; stored flags keep their
// flagcdn.com address, and bundledFlagUrl maps it where a flag is drawn.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import BUNDLED_FLAG_CODES from "./generated/bundledFlagCodes.js";
import { bundledFlagUrl, flagImageUrlFromGid, listBuiltInFlags } from "./countryFlags.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FLAGS = path.join(ROOT, "public", "flags");

test("a flagcdn SVG is drawn from the copy that shipped", () => {
  assert.equal(bundledFlagUrl("https://flagcdn.com/de.svg"), "/flags/de.svg");
  assert.equal(bundledFlagUrl(flagImageUrlFromGid("POL")), "/flags/pl.svg");
  assert.equal(bundledFlagUrl(" https://flagcdn.com/GB-ENG.svg "), "/flags/gb-eng.svg");
  assert.equal(bundledFlagUrl("http://flagcdn.com/eu.svg?v=2"), "/flags/eu.svg");
});

test("any raster size is the 160 px PNG, and a canvas always gets the PNG", () => {
  for (const url of ["https://flagcdn.com/w160/fr.png", "https://flagcdn.com/w40/fr.png", "https://flagcdn.com/h20/fr.webp", "https://flagcdn.com/256x192/fr.png", "https://flagcdn.com/fr.png"]) {
    assert.equal(bundledFlagUrl(url), "/flags/w160/fr.png", url);
  }
  assert.equal(bundledFlagUrl("https://flagcdn.com/bd.svg", { raster: true }), "/flags/w160/bd.png");
});

test("anything else is left as it is", () => {
  const upload = "data:image/png;base64,iVBORw0KGgo=";
  for (const value of [
    upload,
    "https://flagcdn.com/us-ca.svg", // the US states are not shipped
    "https://example.org/flagcdn.com/de.svg",
    "https://raw.githubusercontent.com/Open-Historia/Open-historia-scenarios/main/flags/x.png",
    "/flags/de.svg",
    "",
    null,
    undefined,
  ]) {
    assert.equal(bundledFlagUrl(value), value, String(value));
  }
});

test("every built-in flag the game can name is shipped", () => {
  const shipped = new Set(BUNDLED_FLAG_CODES);
  const missing = listBuiltInFlags().map((flag) => flag.alpha2).filter((code) => !shipped.has(code));
  assert.deepEqual(missing, []);
  for (const extra of ["eu", "un", "xk", "gb-eng", "gb-sct", "gb-wls", "gb-nir"]) assert.ok(shipped.has(extra), extra);
});

test("the files and the list agree", () => {
  const svgs = fs.readdirSync(FLAGS).filter((name) => name.endsWith(".svg")).map((name) => name.slice(0, -4)).sort();
  const pngs = fs.readdirSync(path.join(FLAGS, "w160")).filter((name) => name.endsWith(".png")).map((name) => name.slice(0, -4)).sort();
  const listed = [...BUNDLED_FLAG_CODES].sort();
  assert.deepEqual(svgs, listed, "public/flags/<code>.svg");
  assert.deepEqual(pngs, listed, "public/flags/w160/<code>.png");
  for (const code of listed) {
    const svg = fs.readFileSync(path.join(FLAGS, `${code}.svg`), "utf8");
    assert.match(svg.slice(0, 400), /<svg\b/, `${code}.svg is an SVG`);
    const png = fs.readFileSync(path.join(FLAGS, "w160", `${code}.png`));
    assert.equal(png.subarray(1, 4).toString("latin1"), "PNG", `${code}.png is a PNG`);
  }
});

// A flag image that skips bundledFlagUrl goes back to asking flagcdn.com for it:
// no flag offline, and a request with the player's address in it for every one.
test("every flag the interface draws goes through bundledFlagUrl", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".jsx")) files.push(full);
    }
  };
  walk(path.join(ROOT, "src"));
  const offenders = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/<img\b[\s\S]*?\/?>/g)) {
      const src = /\bsrc=\{([\s\S]*?)\}\s/.exec(match[0])?.[1] ?? "";
      if (/flag/i.test(src) && !src.includes("bundledFlagUrl(")) {
        offenders.push(`${path.relative(ROOT, file)}: src={${src.trim()}}`);
      }
    }
  }
  assert.deepEqual(offenders, []);

  // The sites whose variable does not say "flag".
  const expectations = {
    "src/Editor/FlagPicker.jsx": "src={bundledFlagUrl(imageUrl)}",
    "src/Game/GameUI/GameFlagPicker.jsx": "src={bundledFlagUrl(imageUrl)}",
    "src/Game/GameUI/chat.jsx": "src={bundledFlagUrl(url)}",
    "src/Game/Map/unitFlagIcons.js": "image.src = bundledFlagUrl(url, { raster: true });",
  };
  for (const [rel, needle] of Object.entries(expectations)) {
    assert.ok(fs.readFileSync(path.join(ROOT, rel), "utf8").includes(needle), `${rel} draws through bundledFlagUrl`);
  }
});
