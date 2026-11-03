import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jumpRetryFailureSummary } from "./jumpRetryFailureSummary.js";
import { GAMEPLAY_TOOLS, normalizeGameplayPayload, validateGameplayPayload } from "./gameplaySchemas.js";

const event = (index) => ({
  date: "2016-01-02", title: `World event ${index}`,
  description: "A historically situated development with concrete consequences.",
  tags: ["Politics"], impacts: {},
});

const firstJanuaryAttempt = () => {
  const events = Array.from({ length: 6 }, (_, index) => event(index));
  // January 2016 QA: the model wrote different scores for the same pair
  // in an unsupported nested field and its authoritative top-level ledger.
  events[1].impacts.relationUpdates =
    "Saudi Arabia~Iran~-75~hostile~~Embassy storming and diplomatic severance.";
  events[4] = {
    ...event(4), title: "Chinese stock markets trigger global sell-off",
    tags: ["Economy"], impacts: {},
    economicAccounting: {
      status: "applied",
      reason: "Trading halts affected Chinese equity prices without a typed national economic measurement.",
      exposures: [{
        polity: "China", channel: "credit", exposure: "direct",
        evidence: "Trading halts and equity contraction accompanied currency depreciation and weaker factory data.",
      }],
    },
  };
  return {
    stopDate: "2016-01-31", summary: "Several developments unfolded.",
    relationUpdates: "Saudi Arabia~Iran~-85~hostile~~Complete diplomatic rupture following embassy attack.",
    events,
  };
};

test("one corrective retry reports both independent January 2016 contract failures", () => {
  const original = firstJanuaryAttempt();
  const before = JSON.stringify(original);
  const parsed = normalizeGameplayPayload("jumpForward", original);
  const rejection = validateGameplayPayload("jumpForward", parsed);
  assert.equal(rejection.valid, false);
  assert.match(rejection.error, /events\[1\]\.impacts\.relationUpdates is not allowed/);

  const correctedPrompt = jumpRetryFailureSummary("jumpForward", parsed, rejection.error);
  assert.match(correctedPrompt, /events\[1\]\.impacts\.relationUpdates is not allowed/);
  assert.match(correctedPrompt, /ALSO correct this independently detected native Statistics error/);
  assert.match(correctedPrompt, /events\[4\]\.economicAccounting declares an applied economic change without any typed statsEffects/);
  assert.equal(JSON.stringify(original), before, "retry diagnostics never rewrite the conflicting model data");
  assert.deepEqual(parsed.events[1].impacts.relationUpdates, original.events[1].impacts.relationUpdates,
    "divergent diplomatic score must remain rejected, never silently reconcile to -85");
});

test("a valid unquantified Economy declaration needs no extra warning", () => {
  const payload = firstJanuaryAttempt();
  payload.events[4].economicAccounting.status = "unquantified";
  const verdict = validateGameplayPayload("jumpForward", payload);
  assert.match(verdict.error, /impacts\.relationUpdates is not allowed/);
  assert.equal(jumpRetryFailureSummary("jumpForward", payload, verdict.error), verdict.error);
  assert.equal(jumpRetryFailureSummary("autoJumpForward", payload, verdict.error), verdict.error);
});

test("valid non-Economy turns, GM tasks and missing payloads do not generate invented errors", () => {
  assert.equal(jumpRetryFailureSummary("jumpForward", { events: [event(0)] }, "Bad shape"), "Bad shape");
  assert.equal(jumpRetryFailureSummary("gameMaster", firstJanuaryAttempt(), "GM error"), "GM error");
  assert.equal(jumpRetryFailureSummary("jumpForward", null, "Unparseable JSON"), "Unparseable JSON");
});

test("the provider-facing jump schema names the canonical ledger and typed accounting boundary", () => {
  const tool = GAMEPLAY_TOOLS.jumpForward.schema;
  const item = tool.properties.events.items;
  assert.match(item.properties.impacts.description, /TOP-LEVEL jump ledger strings/);
  assert.equal(item.properties.impacts.properties.relationUpdates, undefined);
  assert.match(item.properties.economicAccounting.description, /applied REQUIRES this event/);
  assert.equal(item.properties.economicAccounting.required.includes("status"), true);
  assert.equal(item.properties.economicAccounting.required.includes("reason"), true);
  assert.ok(JSON.stringify(tool).length < 28200, "preserve the budgeted Gemini schema");
  const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(source, /jumpRetryFailureSummary\(taskKey, parsed, validation\.error\)/);
  assert.match(source, /Your previous structured answer failed validation/);
});

test("Iszlev regression: one corrective retry names every missing Economy declaration", () => {
  const events = Array.from({ length: 10 }, (_, index) => ({
    ...event(index),
    ...(index === 1 || index === 5 || index === 6 ? { tags: ["Economy"] } : {}),
  }));
  const candidate = { stopDate: "1991-10-18", summary: "A month passed.", events };
  const first = validateGameplayPayload("jumpForward", candidate);
  assert.equal(first.valid, false);
  assert.match(first.error, /events\[1\]\.economicAccounting/);
  const repair = jumpRetryFailureSummary("jumpForward", candidate, first.error);
  assert.match(repair, /events\[1\]\.economicAccounting/);
  assert.match(repair, /events\[5\]\.economicAccounting/);
  assert.match(repair, /events\[6\]\.economicAccounting/);
  assert.equal(candidate.events[1].economicAccounting, undefined, "no fabricated audit state");
  assert.equal(validateGameplayPayload("jumpForward", candidate).valid, false);
});
