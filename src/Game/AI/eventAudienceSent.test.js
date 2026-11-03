// Run: node --test src/Game/AI/eventAudienceSent.test.js
//
// An event's audience (who may read it, a shared game's secrets) sent just
// before its combatants had Gemini leave combatants empty on a war's battles:
// the war was dropped and no front opened (2026-10-30). It is sent only in a
// shared game, after warId and combatants; the answer is read as before.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { getGameplayTool, validateGameplayPayload, withEventAudience } from "./gameplaySchemas.js";

const eventKeys = (tool) => Object.keys(tool.schema.properties.events.items.properties);

test("a game nobody shares is sent no audience; a shared game's comes after the combatants", () => {
  const tool = getGameplayTool("jumpForward");
  assert.ok(eventKeys(tool).includes("audience"), "the stored schema keeps it");

  const alone = withEventAudience(tool, false);
  assert.ok(!eventKeys(alone).includes("audience"));
  assert.ok(eventKeys(alone).includes("combatants"));
  assert.ok(eventKeys(tool).includes("audience"), "the stored schema is not changed");

  const shared = withEventAudience(tool, true);
  const keys = eventKeys(shared);
  assert.ok(keys.indexOf("audience") > keys.indexOf("combatants"));
  assert.ok(keys.indexOf("audience") > keys.indexOf("warId"));
});

test("a tool with no events is handed back as it is", () => {
  const tool = getGameplayTool("countryStatSheet");
  assert.equal(withEventAudience(tool, false), tool);
});

test("an answer that carries an audience is still read", () => {
  const event = { date: "2016-01-02", title: "A secret meeting", description: "Envoys meet in Geneva.", audience: ["France"] };
  const result = validateGameplayPayload("jumpForward", { events: [event], summary: "x", stopDate: "2016-01-08" });
  assert.ok(!(result.errors ?? []).some((error) => /audience/.test(String(error))), JSON.stringify(result.errors));
});

test("every request's tool goes through it", () => {
  const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(source, /withEventAudience\(grouped, hostingSharedGame\(\)\)/);
});
