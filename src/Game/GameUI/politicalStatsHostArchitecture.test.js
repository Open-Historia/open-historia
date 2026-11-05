import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./stats.jsx", import.meta.url), "utf8");

test("Beta custom Stats hosts a separate Political Actors knowledge projection", () => {
  assert.match(source, /buildPublicPoliticalView/);
  assert.match(source, /buildPlayerPoliticalKnowledgeView/);
  assert.match(source, /<PoliticalOverview/);
  assert.match(source, /loadStatSheetDefinition/);
  assert.doesNotMatch(source, /countryStats\s*:\s*.*politicalActors/s);
});

test("opened political intelligence crosses the gameplay lazy boundary", () => {
  const lazy = fs.readFileSync(new URL("..\/AI\/gameplayLazy.js", import.meta.url), "utf8");
  assert.match(lazy, /readOpenedIntercepts/);
});

test("Country header projects canonical power status without duplicating it into country tags", () => {
  assert.match(source, /powerTierForPolity/);
  assert.match(source, /worldSnapshot\?\.powerStatus\?\.byPolity/);
  assert.match(source, /data-power-tier={powerTier}/);
  assert.match(source, /"major-power": "Major power"/);
  assert.match(source, /"regional-power": "Regional power"/);
  assert.match(source, /"minor-power": "Minor power"/);
});
