import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GAME_MASTER_MODES, GM_AUTO_MODE,
  validateGameMasterModeSelection } from "./gameMasterAutoMode.js";
import { decodeGameMasterTransportPayload } from "./gameplaySchemas.js";

const auto = (selectedMode, request, countryStatPatches = []) => validateGameMasterModeSelection({
  requestedMode: "auto", selectedMode, request, countryStatPatches,
});

test("Auto must resolve to a real native GM mode before preview; it cannot be applied as auto", () => {
  assert.equal(GM_AUTO_MODE, "auto");
  assert.deepEqual(GAME_MASTER_MODES, ["direct", "exact-event", "world-intervention"]);
  for (const mode of ["exact-event", "world-intervention"]) {
    assert.equal(auto(mode, "Trigger a nationwide financial panic and record it as an ongoing crisis"), "");
  }
  for (const mode of ["auto", "freeform", "", "DIRECTLY"]) {
    assert.match(auto(mode, "Make Germany collapse financially"), /Auto must choose/);
  }
});

test("Auto only routes to Direct when the request explicitly describes a canonical correction", () => {
  for (const request of [
    "Correct Germany's GDP baseline to €170 billion.",
    "Set Germany's population to 70,000,000.",
    "Change Germany's unemployment to 8%.",
    "Update France's relation score to +40.",
    "Administrative correction: set the leader to Nicholas II.",
  ]) assert.equal(auto("direct", request), "", request);
  for (const request of [
    "On 31 March a commercial bank collapses; create an ongoing banking panic.",
    "Make Germany suffer a 30% GDP collapse due to bank failures.",
    "The Chancellor announces a naval expansion programme.",
    "Cause a debt crisis and financial instability in Germany.",
    "Set the banking system to collapse, causing GDP losses.",
    "Set the banks to fail and German GDP to collapse.",
    "Fix the banking system: GDP should fall after the panic.",
    "Create a new country called the North Sea Federation.",
  ]) assert.match(auto("direct", request), /cannot authorize Direct mode/, request);
  assert.equal(validateGameMasterModeSelection({
    requestedMode: "direct", selectedMode: "direct",
    request: "Trigger a German crisis",
  }), "", "a deliberate manual Direct selection retains existing authority");
  assert.match(validateGameMasterModeSelection({
    requestedMode: "exact-event", selectedMode: "world-intervention",
    request: "A single treaty is signed",
  }), /must remain/, "manual mode is never silently overridden");
});

test("Auto narrative routing cannot smuggle an administrative Stats rewrite", () => {
  const patches = [{ country: "Germany", patch: { gdp: 700000000000 } }];
  assert.match(auto("world-intervention", "A Berlin bank fails and a prolonged recession begins", patches),
    /cannot include administrative Stats baseline patches/);
  assert.match(auto("exact-event", "A bank fails in Berlin on 3 January", patches),
    /cannot include administrative Stats baseline patches/);
  assert.equal(auto("direct", "Correct Germany's GDP to 700000000000", patches), "");
  assert.equal(validateGameMasterModeSelection({
    requestedMode: "world-intervention",
    selectedMode: "world-intervention",
    request: "A banking crisis begins",
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
