// Run: node --test src/Game/AI/seatAdvice.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { SEAT_ADVICE_FIELD, buildSeatAdviceDirective, mergeSeatAdvice, withSeatAdvice } from "./seatAdvice.js";
import { JUMP_FORWARD_TOOL } from "./gameplaySchemas.js";

test("the time skip's tool asks for the players' advice only when given it, and requires it then", () => {
  assert.equal(JUMP_FORWARD_TOOL.schema.properties[SEAT_ADVICE_FIELD], undefined);
  const advised = withSeatAdvice(JUMP_FORWARD_TOOL);
  assert.ok(advised.schema.properties[SEAT_ADVICE_FIELD]);
  assert.ok(advised.schema.required.includes(SEAT_ADVICE_FIELD));
  assert.equal(withSeatAdvice(advised), advised);
  const other = { name: "x", schema: { type: "object", properties: { topics: {} } } };
  assert.equal(withSeatAdvice(other), other);
});

test("the prompt names each player and keeps the advisor they have", () => {
  const text = buildSeatAdviceDirective(["Brightdale", "Westmarch"], { seatAdvice: { Brightdale: { advisor: { name: "Countess Mirelle Avanne", title: "Grand Minister" } } } });
  assert.match(text, /^- Brightdale: Countess Mirelle Avanne, Grand Minister$/m);
  assert.match(text, /^- Westmarch: no advisor yet$/m);
  assert.equal(buildSeatAdviceDirective([], {}), "");
});

test("the answer is kept per player: three orders, the first advisor named kept, nobody else's", () => {
  const first = mergeSeatAdvice({}, [
    { polity: "brightdale", advisorName: "Countess Mirelle Avanne", advisorTitle: "Grand Minister", suggestions: ["Pay the Brotherhood", "Marry the heir to Tamsk", "Fortify the eastern fords", "a fourth"] },
    { polity: "Larkmere", advisorName: "Nobody", advisorTitle: "", suggestions: ["Not a player"] },
    { polity: "Westmarch", advisorName: "Ser Odwin", advisorTitle: "Marshal", suggestions: [] },
  ], { people: ["Brightdale", "Westmarch"], round: 4 });
  assert.deepEqual(Object.keys(first), ["Brightdale"]);
  assert.deepEqual(first.Brightdale.suggestions, ["Pay the Brotherhood", "Marry the heir to Tamsk", "Fortify the eastern fords"]);
  assert.equal(first.Brightdale.round, 4);

  const next = mergeSeatAdvice(first, [{ polity: "Brightdale", advisorName: "Someone Else", advisorTitle: "Chancellor", suggestions: ["Hold a festival"] }], { people: ["Brightdale"], round: 5 });
  assert.deepEqual(next.Brightdale.advisor, { name: "Countess Mirelle Avanne", title: "Grand Minister" });
  assert.deepEqual(next.Brightdale.suggestions, ["Hold a festival"]);
});

test("a malformed piece of advice never costs the week: the answer still validates, and the advice is cleaned away", async () => {
  const { validateGameplayPayload } = await import("./gameplaySchemas.js");
  const answer = {
    events: [], stopDate: "0523-01-08", summary: "A quiet week.",
    [SEAT_ADVICE_FIELD]: [{ polity: "Brightdale", suggestions: [{ text: "x" }] }, "not even an object"],
  };
  assert.equal(validateGameplayPayload("jumpForward", answer).valid, true);
  assert.deepEqual(mergeSeatAdvice({}, answer[SEAT_ADVICE_FIELD], { people: ["Brightdale"], round: 2 }), {});
});
