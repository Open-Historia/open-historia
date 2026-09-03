import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nations = fs.readFileSync(path.resolve(here, "../src/Game/Map/Nations.jsx"), "utf8");

function sourceBlock(id) {
  const start = nations.indexOf(`id="${id}"`);
  assert.ok(start >= 0, `${id} must exist`);
  const end = nations.indexOf(">", start);
  return nations.slice(start, end + 1);
}

test("R5.4.5 live curved polity geometry stops tiling at z3", () => {
  const line = sourceBlock("country-live-polity-line-label-source");
  assert.match(line, /maxzoom=\{3\}/);
  assert.match(line, /buffer=\{256\}/);
});

test("R5.4.5 live point polity anchors use the same fixed z3 source grid", () => {
  const point = sourceBlock("country-live-polity-point-label-source");
  assert.match(point, /maxzoom=\{3\}/);
  assert.match(point, /buffer=\{256\}/);
});

test("R5.4.5 visual symbol layers still render through their existing camera zoom range", () => {
  assert.match(
    nations,
    /id="country-line-labels-live-world"[\s\S]*?maxzoom=\{7\.1\}/,
  );
  assert.match(
    nations,
    /id="country-line-labels-live-detail"[\s\S]*?maxzoom=\{7\.1\}/,
  );
  assert.match(
    nations,
    /id="country-labels-live-managed"[\s\S]*?maxzoom=\{7\.1\}/,
  );
});

test("R5.4.5 does not restore renderer inspection or camera-driven source mutation", () => {
  const start = nations.indexOf("const rawLivePolityPointLabelData");
  const end = nations.indexOf("const activePointLabelData", start);
  const hot = nations.slice(start, end);
  assert.doesNotMatch(hot, /\.\s*queryRenderedFeatures\s*\(/);
  assert.doesNotMatch(hot, /\.setData\s*\(/);
});
