/*! Open Historia — where a note the game writes lands among the player's chats © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/chatFold.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { foldGeneratedChatsIntoStorage } from "./chatFold.js";

const germanyThread = {
  id: "chat-germany",
  countries: [{ name: "Germany" }],
  status: "open",
  messages: [{ role: "user", speaker: "France", text: "Shall we talk about coal?", time: "1950-05-01" }],
};

const invitation = (over = {}) => ({
  id: "institution-invite-ecsc-france-1950-05-09",
  countries: [{ name: "Germany" }],
  status: "open",
  source: "institution-lifecycle",
  title: "European Coal and Steel Community invitation",
  lifecycleInstitutionId: "ecsc",
  lifecycleCaseIds: ["case-invite-france"],
  messages: [{ role: "leader", speaker: "Germany", text: "Germany invites France to seek member status in the ECSC.", time: "" }],
  ...over,
});

test("an ordinary note from Germany lands in the open Germany thread", () => {
  const note = { id: "note-1", countries: [{ name: "Germany" }], messages: [{ role: "leader", speaker: "Germany", text: "Coal, then." }] };
  const chats = foldGeneratedChatsIntoStorage([germanyThread], [note], { stampTime: "1950-05-09" });
  assert.equal(chats.length, 1);
  assert.equal(chats[0].messages.length, 2);
  assert.equal(chats[0].messages[1].time, "1950-05-09");
});

test("an institution invitation is its own negotiation, not a message in the ordinary thread", () => {
  const chats = foldGeneratedChatsIntoStorage([germanyThread], [invitation()], { stampTime: "1950-05-09" });
  assert.equal(chats.length, 2);
  const negotiation = chats.find((chat) => chat.id === invitation().id);
  assert.ok(negotiation, "the negotiation tied to the case must be saved");
  assert.deepEqual(negotiation.lifecycleCaseIds, ["case-invite-france"]);
  assert.equal(negotiation.messages[0].time, "1950-05-09");
  assert.equal(chats.find((chat) => chat.id === "chat-germany").messages.length, 1, "the ordinary thread is untouched");
});

test("a negotiation that shares a case with an open one joins it and brings its other cases", () => {
  const stored = [germanyThread, { ...invitation(), messages: [{ role: "leader", speaker: "Germany", text: "First.", time: "1950-05-09" }] }];
  const next = invitation({ id: "institution-invite-ecsc-france-1950-06-01", lifecycleCaseIds: ["case-invite-france", "case-invite-france-2"], messages: [{ role: "leader", speaker: "Germany", text: "Second.", time: "1950-06-01" }] });
  const chats = foldGeneratedChatsIntoStorage(stored, [next]);
  assert.equal(chats.length, 2);
  const negotiation = chats.find((chat) => chat.lifecycleInstitutionId === "ecsc");
  assert.deepEqual(negotiation.lifecycleCaseIds, ["case-invite-france", "case-invite-france-2"]);
  assert.deepEqual(negotiation.messages.map((msg) => msg.text), ["First.", "Second."]);
});

test("two hearings at one institution keep their own chats", () => {
  // Sweden's and Finland's applications to NATO: each hearing has its own
  // case, participants and title, and must not be folded into the other's.
  const hearing = (polity, caseId) => ({
    id: `institution-accession-nato-${polity.toLowerCase()}-${caseId}`,
    countries: [{ name: "Germany" }, { name: "Norway" }, { name: polity }],
    status: "open",
    source: "institution-lifecycle",
    title: `NATO accession hearing — ${polity}`,
    institutionId: "nato",
    lifecycleInstitutionId: "nato",
    lifecycleCaseIds: [caseId],
    messages: [{ role: "leader", speaker: polity, text: `${polity} formally applies for member status in NATO.`, time: "2022-05-18" }],
  });
  const sweden = hearing("Sweden", "case-sweden");
  const finland = hearing("Finland", "case-finland");
  const stored = foldGeneratedChatsIntoStorage([sweden], [finland]);
  assert.equal(stored.length, 2);
  assert.deepEqual(stored.find((chat) => chat.id === sweden.id).lifecycleCaseIds, ["case-sweden"]);
  assert.deepEqual(stored.find((chat) => chat.id === finland.id).lifecycleCaseIds, ["case-finland"]);
  const samePass = foldGeneratedChatsIntoStorage([], [sweden, finland]);
  assert.equal(samePass.length, 2, "two hearings made in one pass stay apart too");
});

test("a negotiation handed back whole replaces its stored copy without doubling its messages", () => {
  const first = { role: "leader", speaker: "Italy", text: "Italy formally applies for member status.", time: "1950-05-09" };
  const stored = [{ ...invitation({ id: "hearing-italy", lifecycleCaseIds: ["case-a"], messages: [first] }), status: "closed" }];
  const reopened = invitation({ id: "hearing-italy", lifecycleCaseIds: ["case-a", "case-b"], messages: [first, { role: "leader", speaker: "Italy", text: "And again.", time: "1950-07-01" }] });
  const chats = foldGeneratedChatsIntoStorage(stored, [reopened]);
  assert.equal(chats.length, 1);
  assert.equal(chats[0].status, "open");
  assert.deepEqual(chats[0].lifecycleCaseIds, ["case-a", "case-b"]);
  assert.deepEqual(chats[0].messages.map((msg) => msg.text), [first.text, "And again."]);
});

test("an ordinary note never lands in a negotiation, stored or made in the same pass", () => {
  const note = { id: "note-2", countries: [{ name: "Germany" }], messages: [{ role: "leader", speaker: "Germany", text: "About the Saar." }] };
  const chats = foldGeneratedChatsIntoStorage([], [invitation(), note]);
  assert.equal(chats.length, 2);
  assert.equal(chats.find((chat) => chat.id === invitation().id).messages.length, 1);
});
