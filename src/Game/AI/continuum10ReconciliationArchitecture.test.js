import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const read = (relativePath) => readFileSync(resolve(root, relativePath), "utf8");

test("Continuum-10 keeps Beta host mechanics while layering Political World authority", () => {
  const integrity = read("src/Game/AI/nativeWorldIntegrity.js");
  const bindIndex = integrity.indexOf("bindWorldEventAuthorityRefs(eventWrapper");
  const agencyIndex = integrity.indexOf("eventAgencyAuthorityReason(event", bindIndex);
  const screenIndex = integrity.indexOf("singleEventScreenVerdict(event", agencyIndex);
  assert.ok(bindIndex >= 0, "world events still bind exact authority references");
  assert.ok(agencyIndex > bindIndex, "player-agency validation runs after authority binding");
  assert.ok(screenIndex > agencyIndex, "Beta timeline screening still runs after authority validation");

  const gameState = read("src/runtime/gameState.js");
  assert.match(gameState, /publishJsonWriteBatch/);
  assert.match(gameState, /withMapClaims/);
  assert.match(gameState, /normalizeFiledEvents/);

  const worldDirector = read("src/Game/AI/nativeWorldDirector.js");
  assert.match(worldDirector, /ignoreActor:\s*gameCountry/);
});

test("Continuum-10 Advisor keeps streaming safety and institution draft actions together", () => {
  const advisor = read("src/Game/GameUI/advisor.jsx");
  assert.match(advisor, /extractFencedJson\(afterDrafts, "institutiondraft", \{ streaming \}\)/);
  assert.match(advisor, /parseMessage\(msg\.text, \{ streaming: Boolean\(msg\.streaming\) \}\)/);
  assert.match(advisor, /onExecuteInstitutionDraft/);
});

test("Continuum-10 map keeps Beta offline behavior and Alpha Midnight Terrain", () => {
  const world = read("src/Game/Map/World.jsx");
  assert.match(world, /useBrowserOnline/);
  assert.match(world, /if \(offline\)/);
  assert.match(world, /midnight-terrain/);

  const picker = read("src/Game/GameUI/CountryPickerMap.jsx");
  assert.match(picker, /isBrowserOnline/);
  assert.match(picker, /autoFocus=\{!touchFirst\b/);
});

test("Continuum-10 prompt merge does not duplicate the localization import", () => {
  const prompts = read("src/Game/AI/gameplayPrompts.js");
  const importMatches = prompts.match(/from "\.\.\/\.\.\/runtime\/promptTranslations\.js";/g) || [];
  assert.equal(importMatches.length, 1);
});
