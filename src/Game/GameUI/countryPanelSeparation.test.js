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
