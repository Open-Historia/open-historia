import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GAME_MASTER_SCHEMA, GAME_MASTER_TRANSPORT_SCHEMA,
  gameMasterEventTransportStatsContract, decodeGameMasterTransportPayload,
  validateGameplayPayload,
} from "./gameplaySchemas.js";
import { gameMasterRetryFeedback } from "./gameMasterRetryFeedback.js";

const transport = (statsEffects) => ({
  mode: "world-intervention", summary: "A national economic event is proposed.",
  eventsJson: JSON.stringify([{
    date: "2016-01-03", title: "Refinery interruptions",
    description: "A documented refining outage disrupts fuel production.",
    impacts: { polityChanges: [{
      operation: "update", code: "United States", statsEffects,
    }] },
  }]),
  territorialScopesJson: "[]", countryStatPatchesJson: "[]",
  storylineUpdatesJson: "[]", warUpdatesJson: "[]", relationUpdatesJson: "[]",
  agreementUpdatesJson: "[]", puppetUpdatesJson: "[]", diplomaticOutreachJson: "[]",
});

test("provider-visible eventsJson guidance is derived from authoritative native cause and type schema", () => {
  const native = GAME_MASTER_SCHEMA.properties.events.items.properties.impacts.properties
    .polityChanges.items.properties.statsEffects;
  assert.equal(native.type, "object");
  assert.deepEqual(native.properties.gdpCause.enum,
    ["production", "destruction", "trade", "policy"]);
  const guidance = gameMasterEventTransportStatsContract();
  assert.match(guidance, /one OBJECT per polity change/);
  for (const option of native.properties.gdpCause.enum) assert.ok(guidance.includes('"' + option + '"'));
  assert.ok(GAME_MASTER_TRANSPORT_SCHEMA.properties.eventsJson.description.includes(guidance));
  assert.equal(GAME_MASTER_TRANSPORT_SCHEMA.properties.eventsJson.type, "string",
    "keep deliberately shallow provider schema, not a nested Gemini function contract");
});

test("invalid refinery gdpCause remains rejected and the one retry receives canonical allowed categories", () => {
  const model = transport({
    annualRealGrowthDelta: -0.15, durationDays: 30, gdpCause: "disruption",
    reason: "A refinery outage reduces fuel output over the month.",
  });
  const { payload, error } = decodeGameMasterTransportPayload(model);
  assert.equal(error, "");
  const validation = validateGameplayPayload("gameMaster", payload);
  assert.equal(validation.valid, false);
  assert.match(validation.error, /\.statsEffects\.gdpCause must be one of/);
  const feedback = gameMasterRetryFeedback("gameMaster", validation.error);
  assert.match(feedback, /"production", "destruction", "trade", "policy"/);
  assert.match(feedback, /causal category that actually matches/);
  assert.equal(model.eventsJson, transport(JSON.parse(model.eventsJson)[0].impacts.polityChanges[0].statsEffects).eventsJson,
    "neither parser nor feedback rewrites the provider's invalid cause");
});

test("array-shaped statsEffects remains invalid; corrective feedback keeps the proposed effect", () => {
  const model = transport([{ annualRealGrowthDelta: -0.15, durationDays: 30,
    gdpCause: "production", reason: "Outage." }]);
  const { payload, error } = decodeGameMasterTransportPayload(model);
  assert.equal(error, "");
  const validation = validateGameplayPayload("gameMaster", payload);
  assert.equal(validation.valid, false);
  assert.match(validation.error, /\.statsEffects must be object; received array/);
  const feedback = gameMasterRetryFeedback("gameMaster", validation.error);
  assert.match(feedback, /ONE object for each polityChanges entry/);
  assert.match(feedback, /Do not discard a supported effect/);
  assert.ok(Array.isArray(payload.events[0].impacts.polityChanges[0].statsEffects),
    "invalid array must not be silently flattened, removed or accepted");
});

test("invalid eventsJson gets a syntax-only corrective instruction, never silent deletion", () => {
  const model = { ...transport({}), eventsJson: '[{"date":"2016-01-03",INVALID]' };
  const decoded = decodeGameMasterTransportPayload(model);
  assert.equal(decoded.payload, null);
  assert.match(decoded.error, /\$\.eventsJson must contain valid JSON array text/);
  const feedback = gameMasterRetryFeedback("gameMaster", decoded.error);
  assert.match(feedback, /Preserve the other ledger array strings and causal event indexes/);
  assert.equal(model.eventsJson, '[{"date":"2016-01-03",INVALID]');
});

test("unrelated tasks and errors do not gain GM repair instructions", () => {
  const error = "$.events[1].date is required.";
  assert.equal(gameMasterRetryFeedback("gameMaster", error), error);
  assert.equal(gameMasterRetryFeedback("jumpForward", "$.events[0].impacts.polityChanges[0].statsEffects must be object; received array."),
    "$.events[0].impacts.polityChanges[0].statsEffects must be object; received array.");
  assert.equal(gameMasterRetryFeedback("gameMaster", ""), "");
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(gameplay, /gameMasterRetryFeedback\(taskKey, jumpRetryFailureSummary\(taskKey, parsed, validation\.error\)\)/);
  assert.match(gameplay, /taskKey !== "gameMaster"/,
    "GM keeps its no-salvage boundary on the last chance");
});
