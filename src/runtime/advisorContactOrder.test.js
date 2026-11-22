import assert from "node:assert/strict";
import test from "node:test";
import {
  advisorContacts, advisorMessagesFor, createAdvisorContact,
  reorderAdvisorContact, replaceAdvisorThread,
} from "./advisorThreads.js";

const contact = (entries, id, name) => createAdvisorContact(entries, { id, name, title: "Minister" });
const make = () => {
  let rows = [{ role: "user", text: "Original chief message" }];
  rows = contact(rows, "advisor-first-001", "First");
  rows.push({ role: "advisor", threadId: "advisor-first-001", id: "reply-1", text: "Private reply" });
  rows.push({ role: "notice", id: "paper-1", text: "Canonical paper" });
  rows = contact(rows, "advisor-second-001", "Second");
  rows.push({ role: "advisor-chief-profile", name: "Chief", title: "Chief", personality: "" });
  rows = contact(rows, "advisor-third-001", "Third");
  return rows;
};

test("reordering contact slots preserves every noncontact record and recipient identity", () => {
  const source = make();
  const noncontact = source.filter((item) => item.role !== "advisor-contact");
  const result = reorderAdvisorContact(source, "advisor-third-001", "advisor-first-001");
  assert.deepEqual(advisorContacts(result).map((item) => item.name), ["Third", "First", "Second"]);
  assert.deepEqual(result.filter((item) => item.role !== "advisor-contact"), noncontact);
  assert.deepEqual(advisorMessagesFor(result, "advisor-first-001"), advisorMessagesFor(source, "advisor-first-001"));
  assert.deepEqual(source, make(), "input must not mutate");
  const saved = replaceAdvisorThread(result, "advisor-first-001", advisorMessagesFor(result, "advisor-first-001"));
  assert.deepEqual(advisorContacts(saved).map((item) => item.name), ["Third", "First", "Second"]);
});

test("unknown and duplicate contact records fail closed without modifying state", () => {
  const source = make();
  assert.throws(() => reorderAdvisorContact(source, "advisor-other-001", "advisor-first-001"), /unknown|duplicate/);
  assert.throws(() => reorderAdvisorContact(source, "advisor-first-001", "advisor-other-001"), /unknown|duplicate/);
  assert.throws(() => reorderAdvisorContact([...source, source.find((item) => item.id === "advisor-first-001")], "advisor-first-001", "advisor-second-001"), /unknown|duplicate/);
  assert.equal(reorderAdvisorContact(source, "advisor-first-001", "advisor-first-001"), source);
});
