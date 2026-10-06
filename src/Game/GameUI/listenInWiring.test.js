/*! Open Historia — Listen in: where the button is and what it may cost: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/listenInWiring.test.js
//
// The rules of a feed are tested where they live (runtime/listenIn.test.js,
// AI/listenInContext.test.js). These read the source of the pieces that join
// them to the game, which node cannot render: the two buttons, the Features
// switch in front of each, and the one request a feed is allowed to be.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { FEATURE_DEFINITIONS, isFeatureEnabled, resolveFeatures } from "../../../server/gameFeatures.js";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const phone = read("./ListenInPhone.jsx");
const regionCard = read("../Selection/Regions.jsx");
const countryPanel = read("../Selection/CountryPanel.jsx");
const mapScene = read("../Map/MapScene.jsx");
const gameplay = read("../AI/gameplay.js");

// The body of one top-level `export const name = …;` in a source file.
const bodyOf = (source, name) => {
  const start = source.indexOf(`export const ${name} = `);
  assert.notEqual(start, -1, `${name} is exported`);
  const end = source.indexOf("\n};\n", start);
  assert.notEqual(end, -1, `${name} has an end`);
  return source.slice(start, end);
};

test("Listen in is a feature a scenario or a game can switch off, on by default", () => {
  const definition = FEATURE_DEFINITIONS.find((entry) => entry.key === "listenIn");
  assert.ok(definition, "the Features tab lists it");
  assert.equal(definition.label, "Listen in");
  assert.match(definition.description, /one AI request/);
  assert.equal(isFeatureEnabled(resolveFeatures(null, null), "listenIn"), true);
  assert.equal(isFeatureEnabled(resolveFeatures({ listenIn: { enabled: false } }, null), "listenIn"), false);
  // A game's own choice over its scenario's.
  assert.equal(isFeatureEnabled(resolveFeatures({ listenIn: { enabled: false } }, { listenIn: { enabled: true } }), "listenIn"), true);
});

test("the phone is mounted with the map's other cards", () => {
  assert.match(mapScene, /import ListenInPhone from "\.\.\/GameUI\/ListenInPhone\.jsx";/);
  assert.match(mapScene, /<ListenInPhone \/>/);
});

test("a region's card has a Listen in button, behind the switch", () => {
  assert.match(regionCard, /const listenInOn = useActiveFeatures\(\)\.listenIn\?\.enabled !== false;/);
  const button = regionCard.match(/\{listenInOn && \(regionId \|\| controllerKey\) && \(\s*<button[\s\S]*?<\/button>\s*\)\}/);
  assert.ok(button, "the button is rendered only while the feature is on");
  assert.match(button[0], /Listen in\s*<\/button>/);
  // It names the region and whoever holds it today, not the map's baked country.
  assert.match(button[0], /openListenIn\(\{\s*regionId,\s*regionName: NAME_1,\s*polity: isUnclaimed \? "" : displayCountry,\s*polityKey: controllerKey,\s*\}\)/);
});

test("a country's panel has a Listen in button, behind the switch", () => {
  assert.match(countryPanel, /const listenInOn = useActiveFeatures\(\)\.listenIn\?\.enabled !== false;/);
  const button = countryPanel.match(/\{listenInOn && \(\s*<button[^>]*onClick=\{listenIn\}[\s\S]*?<\/button>\s*\)\}/);
  assert.ok(button, "the button is rendered only while the feature is on");
  assert.match(button[0], /Listen in\s*<\/button>/);
  assert.match(countryPanel, /const listenIn = \(\) => \{\s*openListenIn\(\{\s*polity: displayName \|\| country\.name,/);
});

test("the phone does not open, and does not stay open, while the feature is off", () => {
  assert.match(phone, /const enabled = useActiveFeatures\(\)\.listenIn\?\.enabled !== false;/);
  assert.match(phone, /_open = \(place\) => \{\s*const next = listenInPlace\(place\);\s*if \(!next \|\| !enabled\) return;/);
  assert.match(phone, /if \(!enabled\) \{\s*close\(\);/);
});

test("the phone asks through one door, and only when the rules say so", () => {
  // The request is the lazy gameplay chunk's, so the map does not carry it.
  assert.match(phone, /import \{ generateListenInFeed \} from "\.\.\/AI\/gameplayLazy\.js";/);
  assert.equal(phone.split("generateListenInFeed(").length - 1, 1, "one call site");
  // Every request is joined by key rather than started twice.
  assert.match(phone, /feedRequests\.request\(key, async \(\) => \{[\s\S]*?generateListenInFeed\(\{ place, language \}\)/);
  // The only request made without a press is the one listenInFeedView allows.
  const effects = [...phone.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[/g)].map((match) => match[1]).filter((body) => body.includes("load("));
  assert.equal(effects.length, 1, "one effect asks");
  assert.match(effects[0], /^\s*if \(shouldAsk\) load\(shown, requestKey, session\.language\);$/);
  assert.match(phone, /\{ batches, shouldAsk, waiting, canAsk, trends \} = listenInFeedView\(/);
});

test("what the model wrote is left to the player's language as it came", () => {
  // Posts, trends and a provider's error are not interface text: the page's
  // translator must not send them to the AI a second time (translator.js).
  assert.match(phone, /<article data-no-translate/);
  assert.match(phone, /<div data-no-translate style=\{\{ display: "flex", flexWrap: "wrap"/);
  assert.match(phone, /\{failure && <div data-no-translate/);
});

test("a feed is one request: no lookup functions, and nothing asked while switched off", () => {
  const body = bodyOf(gameplay, "generateListenInFeed");
  const gate = body.indexOf('if (!isActiveFeatureEnabled("listenIn")) throw');
  const firstRead = body.indexOf("readGameStateBundle(");
  assert.ok(gate !== -1 && firstRead !== -1 && gate < firstRead, "the switch is checked before anything is read");
  assert.equal(body.split("runJsonTask(").length - 1, 1, "one task call");
  assert.match(body, /runJsonTask\("listenIn", \{/);
  // The place's facts are handed over in the prompt (listenInContext.js), so
  // the model has nothing to look up and no second round to ask for.
  assert.doesNotMatch(body, /lookups/);
  assert.match(body, /listenInPlaceDetails: describeListenInPlace\(/);
});
