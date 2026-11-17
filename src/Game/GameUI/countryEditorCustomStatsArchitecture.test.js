/*! Open Historia - Country Editor Stats V2 wiring regression. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./cheats.jsx",import.meta.url),"utf8");

test("Country Editor loads the authoritative scenario Stats definition alongside canonical country data",()=>{
  assert.match(source,/loadStatSheetDefinition\(\)/);
  assert.match(source,/readWorldState\(\{ force: true \}\),\s*readGameData\(\{ force: true \}\),/);
  assert.match(source,/\.then\(\(\[world, gameData, colors, statsRead\]\) =>/);
  assert.match(source,/countryCustomStatFormFromSheet\(\{ sheet, definition: statsDefinition, liveIntelligence \}\)/);
});

test("scenario-defined Stats have a distinct edit surface; component-only guard applies only to standard Stats",()=>{
  assert.match(source, /hasCustomStatDefinition \? \(/);
  assert.match(source, /data-country-editor-custom-stats="true"/);
  assert.match(source, /\) : !hasComponentBaseline \? \(/);
  assert.match(source,/baseline\?\.statsDefinition\?\.custom === true/);
  assert.match(source,/\(baseline\?\.statsDefinition\?\.sections \|\| \[\]\)\.map\(\(section\)/);
});

test("custom saves go through the native sparse stat merge, with live intelligence recorded separately",()=>{
  assert.match(source,/countryCustomStatEditFromForm\(\{/);
  assert.match(source,/hasCustomStatDefinition \? customEdit\.patch : hasComponentBaseline/);
  assert.match(source,/nextSheet = applyCountryStatPatchToWorld\(world, target, patch\)/);
  assert.match(source,/\[target\]: customEdit\.intelligenceRating/);
  assert.match(source,/if \(ratedNow !== Number\.isFinite\(baseline\?\.liveIntelligence\)/);
  assert.match(source,/Number\(world\.intelligence\[target\]\) !== baseline\.liveIntelligence/,
    "a concurrent change to an existing rated intelligence value must fail closed, not just a change in its presence");
  assert.match(source,/Any hidden population\/economy backend not explicitly edited remains unchanged/);
});

test("Stats-definition fetch errors cannot lock users out of identity and Political World editing",()=>{
  assert.match(source,/loadStatSheetDefinition\(\)\.then\(/);
  assert.match(source,/statsError: statsRead\.error/);
  assert.match(source,/baseline\?\.statsError \? \(/);
  assert.match(source,/national-stat edits are disabled until the scenario Stats definition can be loaded/);
  assert.match(source,/baseline\?\.statsDefinition\?\.custom === false && Boolean\(baseline\?\.componentCount\)/);
});

test("pre-existing Political World editing remains independent and standard Stats retain their component path",()=>{
  assert.match(source,/const politicsChanged = editorStateChanged\(politicsForm, baseline\?\.politics\)/);
  assert.match(source,/const nextPoliticalActor = politicsChanged \? applyPoliticalEditorStateToWorld/);
  assert.match(source,/countryStatPatchFromForm\(\{\s*form: changed\.has\("gdpB"\)/);
  assert.match(source,/changed, politicalActor: nextPoliticalActor,/);
  assert.match(source,/fromDisplayCurrency\(Number\(form\.gdpB\) \* 1e9, baseline\.economicDisplayCurrency\)/,
    "the standard GDP editor must convert changed display amounts to the shared canonical unit");
});
