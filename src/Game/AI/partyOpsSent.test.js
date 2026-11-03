// Run: node --test src/Game/AI/partyOpsSent.test.js
//
// A polity's parties (impacts.partyOps) are asked for only where the world
// tracks some polity's parties: in any other game the time skip's tool is what
// it was before the Politics tab. The answer is read against the whole schema.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { GAMEPLAY_SCHEMAS, getGameplayTool, normalizeGameplayPayload, validateGameplayPayload, withPartyOps } from "./gameplaySchemas.js";

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

// "Request contains an invalid argument" (the owner's log, 2026-11-03): every skip of a WWII game was one folded
// request until the Soviet Union's parties were compiled; the next was refused by Gemini outright, asked again
// without its checks, and held for want of a request to check it with. The whole op under every event (its
// nineteen fields, the ten ideologies, the roles) is what it was sent then. It is sent as one line of changes now.
test("a party op is sent with its changes as one line, and adds little to the folded skip", async () => {
  const { foldJumpTool, withEventAudience, withFrontOrders, withSocialPosts, withWarFigures } = await import("./gameplaySchemas.js");
  const { toGeminiSchema } = await import("./geminiSchema.js");
  // (Built as the turn builds it: gameplay.js forActiveFeatures, then the posts, then folded.)
  const sent = (parties) => toGeminiSchema(foldJumpTool(withSocialPosts(withWarFigures(withFrontOrders(withPartyOps(withEventAudience(getGameplayTool("jumpForward"), false), parties))), true)).schema);
  const op = sent(true).properties.events.items.properties.impacts.properties.partyOps.items;
  assert.deepEqual(Object.keys(op.properties), ["polity", "op", "party", "changes"]);
  assert.equal(op.properties.changes.type, "string");
  assert.ok(!JSON.stringify(op).includes("Kaiserreich") && !JSON.stringify(op).includes("governing"), "no ideologies, no roles");
  const size = (schema) => JSON.stringify(schema).length;
  assert.ok(size(sent(true)) - size(sent(false)) < 500, `party ops add ${size(sent(true)) - size(sent(false))} characters`);
  // Everything a skip can be sent at once (fronts, war figures, Rostra, parties, the board) stays under what it was
  // before parties were sent (2026-11-03: 30,239 characters went through, 32,672 did not).
  assert.ok(size(sent(true)) < 30800, `the folded skip is ${size(sent(true))} characters`);
});

test("an answer that writes a party's changes as a line is read as the changes", async () => {
  const { applyPartyOps, readPartyChanges } = await import("../../runtime/politics.js");
  assert.deepEqual(readPartyChanges("leader=Léon Blum; seats = 149; Support=20%; nonsense=1; ideology: Social Democracy"), { leader: "Léon Blum", seats: 149, support: 20, ideology: "Social Democracy" });
  assert.deepEqual(readPartyChanges({ seats: 3 }), { seats: 3 });
  assert.deepEqual(readPartyChanges(null), {});
  const event = { date: "1936-01-02", title: "An election", description: "The vote is held.", impacts: { partyOps: [{ polity: "France", op: "update", party: "SFIO", changes: "seats=149; support=20" }] } };
  // (Shaped as every answer is before it is checked: gameplay.js runJsonTask.)
  const shaped = normalizeGameplayPayload("jumpForward", { events: [event], summary: "x", stopDate: "1936-01-08" });
  assert.deepEqual(shaped.events[0].impacts.partyOps[0].changes, { seats: 149, support: 20 });
  const result = validateGameplayPayload("jumpForward", shaped);
  assert.ok(!/partyOps/.test(String(result.error ?? "")), String(result.error));
  const politics = { France: { government: "Republic", parties: [{ nameEn: "SFIO", nameNative: "SFIO", abbrEn: "SFIO", abbrNative: "SFIO", role: "opposition", seats: 97, support: 15 }] } };
  const applied = applyPartyOps(politics, [{ polity: "France", op: "update", party: "SFIO", changes: "seats=149; support=20" }], { date: "1936-05-03" });
  assert.equal(applied.politics.France.parties[0].seats, 149);
});

test("a skip asked the old way keeps a request for its checks", () => {
  const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").split("\r\n").join("\n");
  assert.match(gameplay, /if \(state\.folded === undefined\) state\.folded = !foldedSkipRefused;\n[^\n]*\n[^\n]*\n  if \(!state\.folded\) state\.requests\?\.budget\?\.reserve\?\.\("review", 1\);/);
  assert.match(gameplay, /state\.folded = false;\n[^\n]*\n          state\.requests\?\.budget\?\.reserve\?\.\("review", 1\);/);
});
