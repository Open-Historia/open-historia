import assert from "node:assert/strict";
import test from "node:test";
import {
  CHIEF_ADVISOR_THREAD,
  advisorContacts,
  advisorMessagesFor,
  advisorOfficeStatus,
  archiveAdvisorContact,
  createAdvisorContact,
  politicalAdvisorOffices,
  replaceAdvisorThread,
  reviseAdvisorContact,
} from "./advisorThreads.js";

const m = (role, text, threadId) => ({ role, text, ...(threadId ? { threadId } : {}) });
const make = (entries = []) => createAdvisorContact(entries, {
  id: "advisor-marina-001", name: "Marina", title: "Finance Minister",
  personality: "Candid, fiscally cautious",
});
const world = (name, id) => ({
  politicalActors: { byPolity: { Russia: { government: {
    headOfGovernment: name ? { name, ...(id ? { id } : {}) } : null,
    headOfState: "Aleksandr Sokolov",
  } } } },
});

test("legacy single-advisor transcripts belong entirely to chief without migration or mutation", () => {
  const old = [m("user", "Hello"), m("advisor", "Mr. President"), { role: "notice", id: "paper-1", text: "Report" }];
  assert.deepEqual(advisorMessagesFor(old, CHIEF_ADVISOR_THREAD), old);
  assert.deepEqual(advisorContacts(old), []);
  assert.deepEqual(replaceAdvisorThread(old, CHIEF_ADVISOR_THREAD, old), old);
});

test("legacy notices stay in their original positions, even across no-op saves and additional messages", () => {
  const original = [
    m("user", "Question A"),
    { role: "notice", id: "n1", text: "Paper A" },
    m("advisor", "Answer A"),
    m("user", "Question B"),
    { role: "notice", id: "n2", text: "Paper B" },
    m("advisor", "Answer B"),
  ];
  assert.deepEqual(replaceAdvisorThread(original, CHIEF_ADVISOR_THREAD, original), original);
  const next = replaceAdvisorThread(original, CHIEF_ADVISOR_THREAD, [...original, m("user", "Question C")]);
  assert.deepEqual(next.slice(0, original.length), original);
  assert.equal(next.at(-1).text, "Question C");
});

test("additional advisor messages and memories never enter the chief transcript", () => {
  const all = make([m("user", "Only Orlov"), m("advisor", "Orlov reply")]);
  const saved = replaceAdvisorThread(all, "advisor-marina-001", [
    m("user", "Treasury update"), { ...m("advisor", "Marina reply"), memory: "Our discussion" },
  ]);
  assert.deepEqual(advisorMessagesFor(saved, CHIEF_ADVISOR_THREAD).map((x) => x.text), ["Only Orlov", "Orlov reply"]);
  assert.deepEqual(advisorMessagesFor(saved, "advisor-marina-001").map((x) => x.text), ["Treasury update", "Marina reply"]);
  assert.equal(advisorMessagesFor(saved, "advisor-marina-001")[1].memory, "Our discussion");
  assert.equal(advisorContacts(saved)[0].personality, "Candid, fiscally cautious");
});

test("saving one conversation preserves another contact, thread, and new canonical notices", () => {
  const initial = replaceAdvisorThread(make([m("user", "old")]), "advisor-marina-001", [m("user", "Marina")]);
  const arrived = [...initial, { role: "notice", id: "paper-2", text: "Received" }];
  const result = replaceAdvisorThread(arrived, CHIEF_ADVISOR_THREAD, [m("user", "new")]);
  assert.deepEqual(advisorMessagesFor(result, "advisor-marina-001").map((x) => x.text), ["Marina"]);
  assert.ok(result.some((x) => x.id === "paper-2"));
  assert.deepEqual(advisorMessagesFor(result, CHIEF_ADVISOR_THREAD).map((x) => x.text), ["new", "Received"]);
});

test("an undone native notice cannot be resurrected by a stale panel copy", () => {
  const stale = [m("user", "x"), { role: "notice", id: "paper-undo", text: "Undone" }];
  const result = replaceAdvisorThread([m("user", "x")], CHIEF_ADVISOR_THREAD, stale);
  assert.equal(result.some((x) => x.id === "paper-undo"), false);
});

test("archiving hides nothing and preserves the original person's identity and transcript", () => {
  const saved = replaceAdvisorThread(make(), "advisor-marina-001", [m("user", "Please assess the reserves")]);
  const retired = archiveAdvisorContact(saved, "advisor-marina-001", true);
  assert.equal(advisorContacts(retired)[0].archived, true);
  assert.equal(advisorMessagesFor(retired, "advisor-marina-001")[0].text, "Please assess the reserves");
  assert.deepEqual(archiveAdvisorContact(retired, "advisor-marina-001", false).filter((x) => x.role === "advisor-contact")[0].archived, false);
});

test("fails closed on malformed, duplicate or unknown-contact mutations", () => {
  assert.throws(() => createAdvisorContact([], { id: "bad", name: "Marina", title: "Minister" }), /unique ID/);
  assert.throws(() => createAdvisorContact(make(), { id: "advisor-marina-001", name: "Other", title: "Minister" }), /already exists/);
  assert.throws(() => createAdvisorContact([], { id: "advisor-marina-002", name: "Other", title: "Minister", binding: { polity: "Russia", office: "financeMinister", name: "Other" } }), /Political World/);
  assert.throws(() => replaceAdvisorThread([], "advisor-unknown-001", [m("user", "x")]), /unknown/);
  assert.throws(() => archiveAdvisorContact([], "advisor-unknown-001"), /Unknown/);
  assert.throws(() => replaceAdvisorThread(make(), "advisor-marina-001", [m("surprise", "x")]), /valid message/);
  assert.throws(() => replaceAdvisorThread(make(), "advisor-marina-001", [m("user", "belongs to another minister", "advisor-other-001")]), /cannot be moved/);
});

test("Political World bindings resolve canonical polity aliases without duplicating officeholders", () => {
  const declared = {
    politicalActors: { byPolity: { "Russian Federation": { government: { headOfGovernment: { name: "Marina Voronina", id: "pm-17" } } } } },
  };
  const offices = politicalAdvisorOffices(declared, "Russia");
  assert.equal(offices.length, 1);
  assert.equal(offices[0].name, "Marina Voronina");
  const contact = advisorContacts(createAdvisorContact([], {
    id: "advisor-voronina-001", ...offices[0],
  }))[0];
  assert.equal(advisorOfficeStatus(contact, declared), "current");
});

test("Political World PM/head-of-state binding pins a person, never floats to the successor", () => {
  const options = politicalAdvisorOffices(world("Marina Voronina", "pm-17"), "Russia");
  assert.equal(options.length, 2);
  assert.deepEqual(options[0].binding, { polity: "Russia", office: "headOfGovernment", name: "Marina Voronina", personId: "pm-17" });
  const contact = advisorContacts(createAdvisorContact([], {
    id: "advisor-voronina-001", name: options[0].name, title: options[0].title, binding: options[0].binding,
  }))[0];
  assert.equal(advisorOfficeStatus(contact, world("Marina Voronina", "pm-17")), "current");
  assert.throws(() => reviseAdvisorContact([contact], contact.id, { name: "New PM", title: contact.title }), /canonical name/);
  assert.equal(reviseAdvisorContact([contact], contact.id, { name: contact.name, title: "Prime Minister", personality: "Assertive" })[0].personality, "Assertive");
  assert.throws(() => createAdvisorContact([], {
    id: "advisor-forged-001", name: "Other Name", title: "Prime Minister", binding: options[0].binding,
  }), /canonical name/);
  assert.equal(advisorOfficeStatus(contact, world("New PM", "pm-99")), "changed");
  assert.equal(advisorOfficeStatus(contact, world(null)), "vacant");
  assert.equal(advisorOfficeStatus(contact, {}), "unavailable");
  const legacy = { ...contact, binding: { polity: "Russia", office: "headOfGovernment", name: "Marina Voronina" } };
  assert.equal(advisorOfficeStatus(legacy, world("Marina Voronina")), "current");
  assert.equal(advisorOfficeStatus(legacy, world("New PM")), "changed");
});

// Review of #939 (2026-11-03): a personality's line breaks were folded away on save, and an officeholder with no
// name was offered under its internal id.
test("a contact keeps its personality's line breaks, and an unnamed officeholder is never offered by id", () => {
  const [contact] = advisorContacts(createAdvisorContact([], {
    id: "advisor-lines-001",
    name: "Marina",
    title: "Minister",
    personality: "Meticulous.\r\n\r\n\r\nCautious   with spending.\nWilling to disagree.",
  }));
  assert.equal(contact.personality, "Meticulous.\n\nCautious with spending.\nWilling to disagree.");
  const revised = advisorContacts(reviseAdvisorContact([contact], contact.id, { name: "Marina", title: "Minister", personality: "One.\nTwo." }))[0];
  assert.equal(revised.personality, "One.\nTwo.");

  const world = { politicalActors: { byPolity: { Testland: { polityKey: "Testland", government: { headOfState: { id: "person-0042" }, headOfGovernment: { name: "Ana Lima", id: "person-7" } } } } } };
  assert.deepEqual(politicalAdvisorOffices(world, "Testland").map((office) => office.name), ["Ana Lima"]);
  const bound = { binding: { polity: "Testland", office: "headOfState", name: "Old King", personId: "person-0001" } };
  assert.equal(advisorOfficeStatus(bound, world), "changed", "a successor known only by id is still a change");
});
