/*! Open Historia — the ids a time skip makes from names: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/idsFromNames.test.js
//
// The ids gameplay.js makes from a name (a peace letter's message from its
// sender, a call to arms' message from its call) go by the game's one rule for
// an id made from a name (server/nameId.js). Cut to a-z and 0-9, two senders
// named in another script wrote under one message id the same turn, and the
// offer one made could be answered on the other's letter.
//
// gameplay.js cannot be loaded under bare node, so the statements are cut out
// of it and run beside the helper they now call.
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { nameId } from "../../../server/nameId.js";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

// `const name = …;` as the file writes it: to the first semicolon that ends a line.
const statementOf = (name) => {
  const match = gameplay.match(new RegExp(`^\\s*const ${name} = [\\s\\S]*?;$`, "m"));
  assert.ok(match, `gameplay.js no longer makes ${name} in one statement`);
  return match[0].trim();
};
const evaluate = (code, name, scope) => new Function(...Object.keys(scope), `${code}\nreturn ${name};`)(...Object.values(scope));

const normalizeString = (value) => String(value ?? "").trim();
const regionKey = evaluate(statementOf("regionKey"), "regionKey", { normalizeString });

test("a peace letter's message is its sender's own, as its English twin's is", () => {
  const code = statementOf("offerMessageId");
  const idFor = (speaker) => evaluate(code, "offerMessageId", { terms: {}, nextGame: { round: 9 }, letter: { speaker }, nameId, regionKey });
  assert.equal(idFor("Borduria"), "msg-peace-9-borduria", "as it always was");
  assert.equal(idFor("Côte d'Ivoire"), "msg-peace-9-cote-d-ivoire", "as it always was");
  for (const [first, second] of [["Germany", "Italy"], ["Германия", "Италия"], ["德国", "意大利"], ["ألمانيا", "إيطاليا"]]) {
    assert.notEqual(idFor(first), idFor(second), `${first}: two senders, one message`);
    assert.equal(idFor(first), idFor(` ${first} `), `${first}: spacing`);
  }
});

test("a call to arms' message is its call's own, whatever the ally is called", () => {
  const code = statementOf("messageId");
  const idFor = (id) => evaluate(code, "messageId", { call: { id }, nameId, regionKey });
  assert.equal(idFor("call:w1:aland"), "msg-call-call-w1-aland", "as it always was");
  assert.notEqual(idFor("call:w1:франция"), idFor("call:w1:германия"));
  assert.notEqual(idFor("call:война-а:x"), idFor("call:война-б:x"));
});
