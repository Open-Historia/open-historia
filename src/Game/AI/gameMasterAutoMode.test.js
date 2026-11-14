import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GAME_MASTER_MODES, GM_AUTO_MODE,
  validateGameMasterModeSelection } from "./gameMasterAutoMode.js";
import { decodeGameMasterTransportPayload } from "./gameplaySchemas.js";

// Auto's Direct used to be refused unless the request held an English
// correction phrase ("set ... GDP ... to 70"): a request in any other language
// could never be routed to Direct, and an English one worded differently was
// refused too. The model's choice stands; the administrator sees the
// transaction in the preview and applies it or not.
const auto = (selectedMode, countryStatPatches = []) => validateGameMasterModeSelection({
  requestedMode: "auto", selectedMode, countryStatPatches,
});

test("Auto must resolve to a real native GM mode before preview; it cannot be applied as auto", () => {
  assert.equal(GM_AUTO_MODE, "auto");
  assert.deepEqual(GAME_MASTER_MODES, ["direct", "exact-event", "world-intervention"]);
  for (const mode of ["exact-event", "world-intervention"]) {
    assert.equal(auto(mode), "");
  }
  for (const mode of ["auto", "freeform", "", "DIRECTLY"]) {
    assert.match(auto(mode), /Auto must choose/);
  }
});

test("Auto may route to Direct, whatever the request says and in whatever language: the preview is the consent", () => {
  assert.equal(auto("direct"), "");
  assert.equal(auto("direct", [{ country: "Germany", patch: { gdp: 170000000000 } }]), "");
  assert.equal(validateGameMasterModeSelection({
    requestedMode: "direct", selectedMode: "direct",
  }), "", "a deliberate manual Direct selection retains existing authority");
  assert.match(validateGameMasterModeSelection({
    requestedMode: "exact-event", selectedMode: "world-intervention",
  }), /must remain/, "manual mode is never silently overridden");
  // No request text is read at all, so a request and its translation are
  // routed alike.
  const source = readFileSync(new URL("./gameMasterAutoMode.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /authorizesAutoDirect/);
  assert.match(source, /validateGameMasterModeSelection = \(\{ requestedMode, selectedMode, countryStatPatches \} = \{\}\)/);
});

test("Auto narrative routing cannot smuggle an administrative Stats rewrite", () => {
  const patches = [{ country: "Germany", patch: { gdp: 700000000000 } }];
  assert.match(auto("world-intervention", patches),
    /cannot include administrative Stats baseline patches/);
  assert.match(auto("exact-event", patches),
    /cannot include administrative Stats baseline patches/);
  assert.equal(auto("direct", patches), "");
  assert.equal(validateGameMasterModeSelection({
    requestedMode: "world-intervention",
    selectedMode: "world-intervention",
    countryStatPatches: patches,
  }), "", "manual mode authority is not retroactively changed");
});

test("the shallow GM provider transport preserves optional Auto routing explanation", () => {
  const fields = {
    mode: "world-intervention",
    modeReason: "An ongoing banking crisis needs persistent world state.",
    summary: "A bank collapses and panic spreads.",
    eventsJson: "[]",
    territorialScopesJson: "[]",
    countryStatPatchesJson: "[]",
    storylineUpdatesJson: "[]",
    warUpdatesJson: "[]",
    relationUpdatesJson: "[]",
    agreementUpdatesJson: "[]",
    puppetUpdatesJson: "[]",
    diplomaticOutreachJson: "[]",
  };
  const result = decodeGameMasterTransportPayload(fields);
  assert.equal(result.error, "");
  assert.equal(result.payload.mode, "world-intervention");
  assert.equal(result.payload.modeReason, fields.modeReason);
  assert.deepEqual(result.payload.countryStatPatches, []);
});

test("Auto is selected in one normal GM request and recorded in its preview, never forwarded to Apply", () => {
  const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const prompt = readFileSync(new URL("./gameplayPrompts.js", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../GameUI/cheats.jsx", import.meta.url), "utf8");
  assert.match(source, /mode = GM_AUTO_MODE/);
  assert.match(source, /const effectiveMode = selectedMode === GM_AUTO_MODE/);
  assert.match(source, /requestedMode: selectedMode/);
  assert.match(source, /validateGameMasterModeSelection\(\{/);
  assert.match(source, /mode: effectiveMode/);
  assert.match(source, /if \(!GAME_MASTER_MODE_SET\.has\(mode\)\)/,
    "Apply only recognizes the three actual native transaction modes");
  assert.match(prompt, /auto: This is the player's routing preference/);
  assert.match(panel, /useState\("auto"\)/);
  assert.match(panel, /Auto mode selected:/);
});
