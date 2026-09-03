import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const gameplay = fs.readFileSync(path.resolve(here, "../src/Game/AI/gameplay.js"), "utf8");
const timeline = fs.readFileSync(path.resolve(here, "../src/Game/GameUI/time.jsx"), "utf8");

test("Continuum promotes late espionage outcomes into real campaign events", () => {
  assert.match(gameplay, /importance: notice\?\.kind === "suspected" \? "minor" : "major"/);
  assert.match(gameplay, /kind: "diplomacy"/);
  assert.match(gameplay, /notable: true/);
  assert.match(gameplay, /playerRelated: true/);
  assert.match(gameplay, /source: "espionage"/);
});

test("Continuum links espionage events into the current turn history", () => {
  assert.match(gameplay, /const espionageEventIds = \[\]/);
  assert.match(gameplay, /eventIds: \[\.\.\.new Set\(\[/);
  assert.match(gameplay, /\.\.\.espionageEventIds/);
});

test("public spy exposure changes the canonical bilateral relation ledger", () => {
  assert.match(gameplay, /const espionageRelationUpdates = \[\]/);
  assert.match(gameplay, /Math\.round\(baseScore\) - 20/);
  assert.match(gameplay, /relationUpdates: effectiveRelationUpdates/);
  assert.match(gameplay, /Public exposure of \$\{owner\}'s espionage operation in \$\{target\}/);
});

test("post-turn diplomacy sees espionage relation consequences too", () => {
  const occurrences = gameplay.match(/relationUpdates: effectiveRelationUpdates/g) || [];
  assert.ok(occurrences.length >= 2, "expected both ledger merge and diplomatic initiative to use effectiveRelationUpdates");
});

test("legacy orphan espionage events are still visible in Current Events", () => {
  assert.match(timeline, /legacyEspionageEvents/);
  assert.match(timeline, /toLowerCase\(\) !== "espionage"/);
  assert.match(timeline, /allReferencedEventIds/);
});
