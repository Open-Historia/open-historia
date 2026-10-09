import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./cheats.jsx", import.meta.url), "utf8");

test("Country Editor renders the full canonical Political World trait catalog including unspecified values", () => {
  assert.match(source, /data-political-trait-catalog="true"/);
  assert.match(source, /POLITICAL_TRAIT_REGISTRY\.map/);
  assert.match(source, /Blank means <strong>not specified<\/strong>, not 0/);
  assert.match(source, /placeholder="unset"/);
  assert.match(source, /changeTrait\(trait\.key/);
  assert.doesNotMatch(source, /Identity, Political World v2/);
  assert.doesNotMatch(source, /editorSectionLabelStyle}>Political World v2/);
});

test("Country Editor preserves raw structured trait and perception editing", () => {
  assert.match(source, /data-political-structured-json="true"/);
  assert.match(source, /Advanced structured traits & perceptions/);
  assert.match(source, /Traits JSON/);
  assert.match(source, /Perceptions JSON/);
  assert.match(source, /changeTraitsJson/);
});

test("Political Debug exposes actor, decision capsule, derived disposition and copy actions", () => {
  assert.match(source, /data-political-debug="true"/);
  assert.match(source, /Political Debug · prove what the simulator sees/);
  assert.match(source, /Copy full Political World JSON/);
  assert.match(source, /Copy decision capsule/);
  assert.match(source, /Copy numeric\/debug snapshot/);
  assert.match(source, /Behavioral disposition · derived now/);
  assert.match(source, /Political decision context · debug/);
});
