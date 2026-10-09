import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const library = fs.readFileSync(new URL("../GameUI/libraryBar.jsx", import.meta.url), "utf8");
const provider = fs.readFileSync(new URL("./providerConfig.js", import.meta.url), "utf8");

test("CP28 keeps latest Beta as the AI host and layers political authoring onto it", () => {
  assert.match(gameplay, /requestLedger|turnReview|applicationReceipt|stream/i, "latest Beta request/review/receipt/streaming architecture stays present");
  assert.match(library, /InstitutionAuthoringPanel/);
  assert.match(library, /PoliticalWorldGenerationPanel/);
  assert.match(provider, /key: "politicalWorldGeneration"/);
  assert.match(provider, /key: "politicalWorldVerification"/);
});

test("CP28 does not restore the retired standalone World Engine orchestration", () => {
  assert.doesNotMatch(gameplay, /worldEngine\/timelineTurn|runWorldEngineTimelineTurn|worldComposition\/compositionProvider/);
  assert.doesNotMatch(library, /roundZeroStartupGate|useRoundZeroStartup/);
});
