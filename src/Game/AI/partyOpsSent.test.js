// Run: node --test src/Game/AI/partyOpsSent.test.js
//
// A polity's parties (impacts.partyOps) are asked for only where the world
// tracks some polity's parties: in any other game the time skip's tool is what
// it was before the Politics tab. The answer is read against the whole schema.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { GAMEPLAY_SCHEMAS, getGameplayTool, validateGameplayPayload, withPartyOps } from "./gameplaySchemas.js";

const impactKeys = (tool) => Object.keys(tool.schema.properties.events.items.properties.impacts.properties);

test("a game that tracks no parties is sent no partyOps", () => {
  const tool = getGameplayTool("jumpForward");
  assert.ok(!impactKeys(tool).includes("partyOps"));
  assert.ok(!JSON.stringify(tool.schema).includes("partyOps"));
});

test("a game that tracks parties is sent them, after every other impact", () => {
  const keys = impactKeys(withPartyOps(getGameplayTool("jumpForward"), true));
  assert.equal(keys.at(-1), "partyOps");
});

test("an answer that changes parties is still read", () => {
  assert.ok(JSON.stringify(GAMEPLAY_SCHEMAS.jumpForward).includes("partyOps"));
  const event = { date: "1936-01-02", title: "An election", description: "The vote is held.", impacts: { partyOps: [{ polity: "France", op: "update", party: "SFIO", changes: { seats: 149 } }] } };
  const result = validateGameplayPayload("jumpForward", { events: [event], summary: "x", stopDate: "1936-01-08" });
  assert.ok(!(result.errors ?? []).some((error) => /partyOps/.test(String(error)) && /not allowed/.test(String(error))), JSON.stringify(result.errors));
});

test("the turn's tool asks for parties only where they are tracked", () => {
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(gameplay, /withPartyOps\(withEventAudience\(grouped, hostingSharedGame\(\)\), parties\)/);
  assert.equal((gameplay.match(/\{ parties: Boolean\(variables\?\.partiesTracked\) \}/g) ?? []).length, 2);
  const context = fs.readFileSync(new URL("./promptContext.js", import.meta.url), "utf8");
  assert.match(context, /result\.partiesTracked = "yes"/);
});
