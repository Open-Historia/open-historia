/*! Open Historia — what a file picker offers, per build: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fileAccept.test.js
//
// The user (2026-09-24): "make sure you can import on android". Android's
// picker filters by MIME type, and only by types it can name, so inside the app
// a data file's input offers every file (acceptFor) and the importer judges the
// bytes; a list of images only keeps its filter.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { acceptFor, isImageOnlyAccept } from "./fileAccept.js";
import { FLAG_ACCEPT } from "../Editor/flagImage.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("a list of images only is recognised as one", () => {
  assert.equal(isImageOnlyAccept("image/png,image/jpeg,image/webp,image/gif,image/svg+xml"), true);
  assert.equal(isImageOnlyAccept(".avif,.gif,.jpeg,.jpg,.png,.webp"), true);
  assert.equal(isImageOnlyAccept(".bmp,.png,.jpg,.jpeg,.webp,image/bmp,image/png,image/jpeg,image/webp"), true);
  assert.equal(isImageOnlyAccept(FLAG_ACCEPT), true);
  assert.equal(isImageOnlyAccept(".zip,application/zip"), false);
  assert.equal(isImageOnlyAccept(".pmtiles"), false);
  assert.equal(isImageOnlyAccept(".geojson,.json,.kml,.png"), false, "a map upload that also takes images is not an image list");
  assert.equal(isImageOnlyAccept(""), false);
});

test("inside the app a data file's picker offers every file; in a browser nothing changes", () => {
  for (const accept of [".zip,application/zip", ".json,application/json,.zip,application/zip", ".pmtiles", ".csv,text/csv"]) {
    assert.equal(acceptFor(accept, { native: true }), undefined, `${accept} is not filtered in the app`);
    assert.equal(acceptFor(accept, { native: false }), accept, `${accept} still filters in a browser`);
  }
  assert.equal(acceptFor("image/png,image/jpeg", { native: true }), "image/png,image/jpeg", "images keep the gallery");
});

test("without the Android bridge the lists are left exactly as written", () => {
  assert.equal(acceptFor(".zip,application/zip"), ".zip,application/zip");
});

// Every <input type="file"> in the game and the Workshop: a literal accept list
// must be images only, and anything else must go through acceptFor, or a file an
// import in a browser accepts is not even listed by the picker on a phone.
test("no data-file input in the app filters the Android picker by itself", () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.jsx$/.test(entry.name) ? [full] : [];
  });
  // The expression of accept={…}, read to its balancing brace.
  const expressionAt = (text, open) => {
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
      if (text[index] === "{") depth += 1;
      if (text[index] === "}" && --depth === 0) return text.slice(open + 1, index).trim();
    }
    return "";
  };
  // Constants that hold images only (checked below), so they may stay bare.
  const IMAGE_CONSTANTS = new Set(["ACCEPT", "FLAG_ACCEPT"]);
  const offenders = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/accept=("([^"]*)"|\{)/g)) {
      const where = path.relative(SRC, file);
      if (match[2] !== undefined) {
        if (!isImageOnlyAccept(match[2])) offenders.push(`${where}: accept="${match[2]}"`);
        continue;
      }
      const expression = expressionAt(text, match.index + "accept=".length);
      if (!expression.startsWith("acceptFor(") && !IMAGE_CONSTANTS.has(expression)) offenders.push(`${where}: accept={${expression}}`);
    }
  }
  assert.deepEqual(offenders, []);
  assert.equal(isImageOnlyAccept(readFileSync(path.join(SRC, "Game", "GameUI", "GameFlagPicker.jsx"), "utf8").match(/const ACCEPT = "([^"]*)"/)[1]), true);
});
