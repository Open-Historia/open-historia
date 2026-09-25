import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, name), "utf8");

test("Advisor no longer owns the Stats/Country panel", () => {
  const advisor = read("advisor.jsx");
  assert.doesNotMatch(advisor, /import\s+StatsPane\s+from/);
  assert.doesNotMatch(advisor, /label="Stats"/);
  assert.match(advisor, /Advisor is its own system/);
});

test("standalone player flag opens an independent country drawer", () => {
  const main = read("main.jsx");
  const other = read("other.jsx");
  const panel = read("countryPanel.jsx");
  assert.match(main, /isCountryOpen/);
  assert.match(main, /LazyCountryPanel/);
  assert.match(main, /setIsAdvisorOpen\(false\);\s*setIsCountryOpen/);
  assert.match(other, /height: "4rem"/);
  assert.match(other, /width: "4rem"/);
  assert.match(other, /Open .* country panel/);
  assert.match(panel, /<StatsPane active=\{open\}/);
  assert.match(panel, />Country</);
});

test("Country Editor visibly exposes the canonical PWv2 editor surface", () => {
  const cheats = read("cheats.jsx");
  assert.match(cheats, /Political World v2/);
  assert.match(cheats, /Government & political system/);
  assert.match(cheats, /Strategic outlook · goals, fears, ambitions, pressure/);
  assert.match(cheats, /Parties \/ political entities/);
  assert.match(cheats, /Power blocs \/ non-party actors/);
  assert.match(cheats, /applyPoliticalEditorStateToWorld/);
});

test("Country pane follows committed region selections through a stable runtime event", () => {
  const stats = read("stats.jsx");
  const regions = read("../Selection/Regions.jsx");
  assert.match(regions, /REGION_SELECTED_EVENT = "oh:region-selected"/);
  assert.match(regions, /dispatchEvent\(new CustomEvent\(REGION_SELECTED_EVENT, \{ detail: props \}\)\)/);
  assert.match(stats, /window\.addEventListener\(REGION_SELECTED_EVENT, onRegionSelected\)/);
  assert.match(stats, /window\.removeEventListener\(REGION_SELECTED_EVENT, onRegionSelected\)/);
  assert.match(stats, /const rawCountry = ownerName \|\| cleanText\(props\.COUNTRY\) \|\| COUNTRY_NAMES\[gid0\] \|\| gid0/);
});

test("Country Diplomacy presents Puppet relationships through the shared visibility boundary", () => {
  const stats = read("stats.jsx");
  assert.match(stats, /livePuppetsFor, puppetKindLabel, puppetSummaryFor/);
  assert.match(stats, /viewerPolity=\{player\.code\}/);
  assert.match(stats, />Subordination</);
  assert.match(stats, />Subordinate states</);
  assert.doesNotMatch(stats, /world\.puppets/);
  assert.doesNotMatch(stats, /row\.loyalty\b(?!Band)/);
});
