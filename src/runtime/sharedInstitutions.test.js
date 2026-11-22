/*! Open Historia — a shared game's institutions, asked of the host: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/sharedInstitutions.test.js
//
// What a screen gets back when the host did its institution business: the
// shape of the game's own results, with the thread the host made once the
// page holds it, or the host's reason.

import test from "node:test";
import assert from "node:assert/strict";
import { askHostForInstitution } from "./sharedInstitutions.js";
import { setSharedRequester } from "../multiplayer/client/sharedGameBridge.js";

test.afterEach(() => setSharedRequester(null));

test("the host's ids become the result the screens read, with the thread once the view has it", async () => {
  const asked = [];
  setSharedRequester(async (...args) => {
    asked.push(args);
    return { ok: true, result: { institutionId: "baltic-pact", proposalId: "p1", proposalStatus: "voting", chatId: "founding-1" } };
  });
  let reads = 0;
  const readChats = async () => {
    reads += 1;
    return reads < 3 ? [] : [{ id: "founding-1", countries: ["Estonia"] }];
  };
  const result = await askHostForInstitution("lifecycle", { command: { type: "found", name: "Baltic Pact" } }, { readChats, waitMs: 5000 });
  // Asked with no deadline of its own: the host's answer is waited for, a round being resolved or not.
  assert.deepEqual(asked, [["institution", { call: "lifecycle", args: { command: { type: "found", name: "Baltic Pact" } } }]]);
  assert.deepEqual(result.institution, { id: "baltic-pact" });
  assert.deepEqual(result.proposal, { id: "p1", status: "voting" });
  assert.equal(result.createdChat.id, "founding-1");
  assert.equal(result.channel, result.createdChat);
  assert.equal(reads, 3, "it waited for the view with the thread");
});

test("no thread made: nothing is waited for; a thread that never comes is not opened", async () => {
  setSharedRequester(async () => ({ ok: true, result: { institutionId: "baltic-pact" } }));
  let reads = 0;
  const none = await askHostForInstitution("governance", {}, { readChats: async () => { reads += 1; return []; } });
  assert.equal(reads, 0);
  assert.equal(none.createdChat, null);
  setSharedRequester(async () => ({ ok: true, result: { chatId: "never" } }));
  const late = await askHostForInstitution("channel", {}, { readChats: async () => [], waitMs: 300 });
  assert.equal(late.channel, null);
});

test("the host's refusal is the error, in its own words", async () => {
  setSharedRequester(async () => ({ ok: false, error: "Institution Baltic Pact already exists." }));
  await assert.rejects(askHostForInstitution("lifecycle", {}), /already exists/);
  setSharedRequester(null);
  await assert.rejects(askHostForInstitution("lifecycle", {}), /Not in a shared game/);
});
