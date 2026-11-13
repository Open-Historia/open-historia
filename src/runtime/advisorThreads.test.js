import assert from "node:assert/strict";
import test from "node:test";
import {
  CHIEF_ADVISOR_THREAD,
  ADVISOR_RECIPIENT_TYPES,
  advisorRecipientType,
  assertAdvisorRecipientCanReply,
  advisorRecipientForReply,
  chiefAdvisorProfile,
  saveChiefAdvisorProfile,
  resetChiefAdvisorProfile,
  advisorContacts,
  advisorMessagesFor,
  advisorOfficeStatus,
  archiveAdvisorContact,
  createAdvisorContact,
  politicalAdvisorOffices,
  replaceAdvisorThread,
  reviseAdvisorContact,
  withSavedActionReceipts,
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

test("chief identity defaults to the unchanged legacy single-advisor conversation", () => {
  const legacy = [
    { role: "user", text: "Keep the original transcript" },
    { role: "notice", id: "paper-1", text: "Cabinet briefing" },
    { role: "advisor", text: "Understood, Mr. President", memory: "Existing memory" },
  ];
  assert.equal(chiefAdvisorProfile(legacy), null);
  assert.deepEqual(resetChiefAdvisorProfile(legacy), legacy);
  const customized = saveChiefAdvisorProfile(legacy, {
    name: "Dmitri Orlov", title: "Chief Advisor", personality: "Strict and candid.",
  });
  assert.deepEqual(advisorMessagesFor(customized, CHIEF_ADVISOR_THREAD), legacy);
  assert.deepEqual(chiefAdvisorProfile(customized), {
    role: "advisor-chief-profile", name: "Dmitri Orlov", title: "Chief Advisor", personality: "Strict and candid.",
  });
  const restored = resetChiefAdvisorProfile(customized);
  assert.deepEqual(restored, legacy);
});

test("editing the chief profile never touches other recipients or their messages", () => {
  const original = replaceAdvisorThread(make([{ role: "user", text: "Chief discussion" }]), "advisor-marina-001", [
    { role: "user", text: "Private treasury discussion" },
  ]);
  const changed = saveChiefAdvisorProfile(original, {
    name: "Graf Friedrich von Rabenfeld", title: "Royal Advisor", personality: "Blunt and pragmatic",
  });
  const edited = saveChiefAdvisorProfile(changed, {
    name: "Graf Friedrich von Rabenfeld", title: "Royal Advisor", personality: "Formal and decisive",
  });
  assert.equal(edited.filter((entry) => entry.role === "advisor-chief-profile").length, 1);
  assert.equal(chiefAdvisorProfile(edited).personality, "Formal and decisive");
  assert.deepEqual(resetChiefAdvisorProfile(edited), original);
  assert.deepEqual(advisorContacts(edited), advisorContacts(original));
  assert.deepEqual(advisorMessagesFor(edited, "advisor-marina-001"), advisorMessagesFor(original, "advisor-marina-001"));
});

test("chief customization survives later message saves and preserves interleaved native notices", () => {
  const initial = make([
    { role: "user", text: "Old question" },
    { role: "notice", id: "paper-18", text: "Delivered briefing" },
    { role: "advisor", text: "Old reply" },
  ]);
  const profiled = saveChiefAdvisorProfile(initial, {
    name: "Dmitri Orlov", title: "Chief Advisor", personality: "Candid",
  });
  const afterChief = replaceAdvisorThread(profiled, CHIEF_ADVISOR_THREAD, [
    ...advisorMessagesFor(profiled, CHIEF_ADVISOR_THREAD),
    { role: "user", text: "New question" },
  ]);
  assert.equal(chiefAdvisorProfile(afterChief).name, "Dmitri Orlov");
  assert.equal(afterChief.filter((entry) => entry.role === "notice").length, 1);
  const afterMinister = replaceAdvisorThread(afterChief, "advisor-marina-001", [
    { role: "user", text: "Treasury question" },
  ]);
  assert.deepEqual(chiefAdvisorProfile(afterMinister), chiefAdvisorProfile(profiled));
  assert.equal(advisorMessagesFor(afterMinister, CHIEF_ADVISOR_THREAD).filter((entry) => entry.role === "user").length, 2);
  assert.equal(afterMinister.find((entry) => entry.role === "notice").id, "paper-18");
});

test("chief profile validation rejects invalid empty identity or invalid profile length", () => {
  assert.throws(() => saveChiefAdvisorProfile([], { name: " ", title: "Advisor", personality: "" }), /name and position/);
  assert.throws(() => saveChiefAdvisorProfile([], { name: "Dmitri", title: " ", personality: "" }), /name and position/);
  assert.throws(() => saveChiefAdvisorProfile([], { name: "Dmitri", title: "Advisor", personality: "x".repeat(1201) }), /1200/);
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

test("legacy contacts default to Advisor/Minister without rewriting saved profiles or history", () => {
  const legacy = [
    { role: "user", text: "Chief's established conversation" },
    { role: "advisor-contact", id: "advisor-minister-legacy", name: "Viktor", title: "Finance Minister", personality: "Skeptical", archived: false },
    { role: "user", threadId: "advisor-minister-legacy", text: "Private finance discussion" },
  ];
  const saved = structuredClone(legacy);
  const contact = advisorContacts(legacy)[0];
  assert.equal(advisorRecipientType(contact), ADVISOR_RECIPIENT_TYPES.MINISTER);
  assert.equal(Object.hasOwn(contact, "recipientType"), false);
  assert.doesNotThrow(() => assertAdvisorRecipientCanReply(contact.id, contact));
  assert.deepEqual(replaceAdvisorThread(legacy, CHIEF_ADVISOR_THREAD, advisorMessagesFor(legacy)), legacy);
  assert.deepEqual(legacy, saved);
});

test("manually created historical and faction characters retain their distinct recipient types", () => {
  for (const [type, name, title, id] of [
    [ADVISOR_RECIPIENT_TYPES.FOREIGN_OFFICIAL, "Wilhelm II", "German Emperor", "advisor-wilhelm-1912"],
    [ADVISOR_RECIPIENT_TYPES.CIVILIAN, "Nadezhda", "Russian revolutionary organizer", "advisor-nadezhda-1912"],
    [ADVISOR_RECIPIENT_TYPES.OTHER_CHARACTER, "Representatives of the movement", "Revolutionary delegation", "advisor-movement-1912"],
  ]) {
    const created = createAdvisorContact([], { id, name, title, personality: "Independent judgment", recipientType: type });
    const profile = advisorContacts(created)[0];
    assert.equal(advisorRecipientType(profile), type);
    assert.equal(profile.binding, undefined);
    assert.doesNotThrow(() => assertAdvisorRecipientCanReply(id, profile));
    const withHistory = replaceAdvisorThread(created, id, [m("user", "Hello")]);
    const edited = reviseAdvisorContact(withHistory, id, { name, title, personality: "Persistent identity", recipientType: type });
    assert.equal(advisorRecipientType(advisorContacts(edited)[0]), type);
    const restored = archiveAdvisorContact(archiveAdvisorContact(edited, id, true), id, false);
    assert.equal(advisorRecipientType(advisorContacts(restored)[0]), type);
    assert.deepEqual(advisorMessagesFor(restored, id).map((entry) => entry.text), ["Hello"]);
  }
});

test("a contact with conversation history cannot be reclassified into a different knowledge domain", () => {
  const minister = make();
  const id = "advisor-marina-001";
  const withHistory = replaceAdvisorThread(minister, id, [m("user", "Confidential treasury schedule")]);
  assert.throws(() => reviseAdvisorContact(withHistory, id, {
    name: "Marina", title: "Finance Minister", recipientType: ADVISOR_RECIPIENT_TYPES.CIVILIAN, personality: "",
  }), /conversation history/);
  assert.equal(advisorRecipientType(advisorContacts(withHistory)[0]), ADVISOR_RECIPIENT_TYPES.MINISTER);
  assert.deepEqual(advisorMessagesFor(withHistory, id).map((entry) => entry.text), ["Confidential treasury schedule"]);
  const beforeSpeaking = reviseAdvisorContact(minister, id, {
    name: "Marina", title: "Finance Minister", recipientType: ADVISOR_RECIPIENT_TYPES.CIVILIAN, personality: "",
  });
  assert.equal(advisorRecipientType(advisorContacts(beforeSpeaking)[0]), ADVISOR_RECIPIENT_TYPES.CIVILIAN);
});

test("recipient types fail closed: invalid types, wrong thread, unsupported conversations and forged bindings", () => {
  assert.equal(advisorRecipientType({ recipientType: "unknown" }), null);
  assert.equal(advisorRecipientType({ recipientType: "" }), null);
  assert.throws(() => createAdvisorContact([], {
    id: "advisor-bad-type-01", name: "Someone", title: "Someone", recipientType: "foreign-official-ish",
  }), /recipient type/);
  assert.throws(() => createAdvisorContact([], {
    id: "advisor-foreign-01", name: "Wilhelm II", title: "Emperor", recipientType: ADVISOR_RECIPIENT_TYPES.FOREIGN_OFFICIAL,
    binding: { polity: "Germany", office: "headOfState", name: "Wilhelm II" },
  }), /Political World.*Advisor/);
  const office = politicalAdvisorOffices(world("Marina Voronina", "pm-17"), "Russia")[0];
  const bound = advisorContacts(createAdvisorContact([], { id: "advisor-bound-001", ...office }))[0];
  assert.throws(() => reviseAdvisorContact([bound], bound.id, {
    name: bound.name, title: bound.title, recipientType: ADVISOR_RECIPIENT_TYPES.CIVILIAN,
  }), /Political World.*Advisor/);
  assert.throws(() => assertAdvisorRecipientCanReply("advisor-wrong-001", bound), /identity mismatch/);
  assert.throws(() => assertAdvisorRecipientCanReply("advisor-missing-001", null), /not available/);
  assert.throws(() => assertAdvisorRecipientCanReply(CHIEF_ADVISOR_THREAD, bound), /chief advisor/);
  assert.doesNotThrow(() => assertAdvisorRecipientCanReply(CHIEF_ADVISOR_THREAD, null));
  assert.throws(() => assertAdvisorRecipientCanReply("advisor-missing-001", {
    id: "advisor-missing-001", recipientType: "bogus",
  }), /unsupported/);
});

test("the AI resolves the canonical recipient rather than accepting a forged or stale profile", () => {
  const saved = createAdvisorContact([], {
    id: "advisor-foreign-001", name: "George V", title: "British monarch",
    recipientType: ADVISOR_RECIPIENT_TYPES.FOREIGN_OFFICIAL,
  });
  const stored = advisorContacts(saved)[0];
  assert.deepEqual(advisorRecipientForReply(saved, stored.id, stored), stored);
  assert.throws(() => advisorRecipientForReply(saved, stored.id, { ...stored, recipientType: ADVISOR_RECIPIENT_TYPES.MINISTER }), /changed or unavailable/);
  assert.throws(() => advisorRecipientForReply(saved, stored.id, { ...stored, name: "Wilhelm II" }), /changed or unavailable/);
  assert.throws(() => advisorRecipientForReply([], stored.id, stored), /changed or unavailable/);
  const retired = archiveAdvisorContact(saved, stored.id, true);
  assert.throws(() => advisorRecipientForReply(retired, stored.id, stored), /retired/);
  assert.equal(advisorRecipientForReply(saved, CHIEF_ADVISOR_THREAD, null), null);
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

// The Russia-campaign regression: the canonical receipt was committed while
// React still held a stale transcript without that acknowledgement.
const verifiedProposal = {
  id: "proposal-0", actionId: "action-advisor-reply-verified001-0",
  operation: "create", kind: "action", title: "Certify", text: "Verify certification",
};
const verifiedReply = {
  role: "advisor", id: "advisor-reply-verified001", text: "Proposed",
  actionProposals: [verifiedProposal],
};
const verifiedReceipt = { status: "queued", actionId: verifiedProposal.actionId, title: verifiedProposal.title };

test("stale chief transcript saves retain previously acknowledged native Action receipts", () => {
  const receiptSaved = { ...verifiedReply, actionReceipts: { [verifiedProposal.id]: verifiedReceipt } };
  const stored = [
    m("user", "Do it"),
    { role: "notice", id: "report-preserved", text: "Still delivered" },
    receiptSaved,
  ];
  const snapshot = [m("user", "Do it"), verifiedReply, m("user", "One more request")];
  const next = replaceAdvisorThread(stored, CHIEF_ADVISOR_THREAD, snapshot);
  assert.deepEqual(advisorMessagesFor(next).find((entry) => entry.id === verifiedReply.id).actionReceipts?.[verifiedProposal.id], verifiedReceipt);
  assert.equal(advisorMessagesFor(next).at(-1).text, "One more request");
  assert.equal(next[1].id, "report-preserved", "native notices retain their canonical position");
  assert.equal(stored[2], receiptSaved, "canonical input must not be mutated");
  assert.equal(verifiedReply.actionReceipts, undefined, "incoming UI snapshot remains unchanged");
  const repeated = replaceAdvisorThread(next, CHIEF_ADVISOR_THREAD, snapshot);
  assert.deepEqual(repeated, next, "repeated stale saves must not erase the receipt");
});

test("recipient-scoped saves preserve the newest cancelled/requeued receipt over a stale UI snapshot", () => {
  const saved = make([{ ...verifiedReply, text: "Chief-only reply" }]);
  const minister = { ...verifiedReply, id: "advisor-reply-minister001" };
  const queued = { ...verifiedReceipt, actionId: verifiedProposal.actionId, status: "queued" };
  const acknowledged = replaceAdvisorThread(saved, "advisor-marina-001", [minister]);
  const canonical = acknowledged.map((entry) => entry.id === minister.id
    ? { ...entry, actionReceipts: { "proposal-0": { ...queued, status: "cancelled" } } }
    : entry);
  const stale = [{ ...minister, actionReceipts: { "proposal-0": queued } }];
  const next = replaceAdvisorThread(canonical, "advisor-marina-001", stale);
  assert.equal(advisorMessagesFor(next, "advisor-marina-001")[0].actionReceipts["proposal-0"].status, "cancelled");
  assert.equal(advisorMessagesFor(next)[0].actionReceipts, undefined, "the chief thread is untouched");
  assert.deepEqual(advisorContacts(next), advisorContacts(canonical));
});

test("a stale thread snapshot cannot erase an entire acknowledged reply, but explicit clear still can", () => {
  const approved = { ...verifiedReply, actionReceipts: { "proposal-0": verifiedReceipt } };
  const persisted = [m("user", "First"), approved, m("user", "Second")];
  const stale = [m("user", "First"), m("user", "Second"), m("user", "New question")];
  const retained = replaceAdvisorThread(persisted, CHIEF_ADVISOR_THREAD, stale);
  const replies = retained.filter((entry) => entry.id === verifiedReply.id);
  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0].actionReceipts["proposal-0"], verifiedReceipt);
  assert.equal(retained.at(-1).text, "New question");
  assert.deepEqual(replaceAdvisorThread(persisted, CHIEF_ADVISOR_THREAD, [], { clearNotices: true }), []);
});

test("generic conversation saves cannot forge, retarget, duplicate or change Action receipts", () => {
  const canonical = [{ ...verifiedReply, actionReceipts: { "proposal-0": verifiedReceipt } }];
  const staleWithoutReceipt = { ...verifiedReply, actionReceipts: undefined };
  assert.deepEqual(replaceAdvisorThread(canonical, CHIEF_ADVISOR_THREAD, [staleWithoutReceipt])[0].actionReceipts, canonical[0].actionReceipts);
  // A receipt the save carries and the saved reply lacks is not written, and the rest of the conversation still is.
  const forged = replaceAdvisorThread([verifiedReply], CHIEF_ADVISOR_THREAD, [canonical[0], { role: "user", text: "and the rest" }]);
  assert.equal(forged[0].actionReceipts, undefined);
  assert.equal(forged[1].text, "and the rest");
  const extra = replaceAdvisorThread(canonical, CHIEF_ADVISOR_THREAD, [{ ...canonical[0], actionReceipts: { ...canonical[0].actionReceipts, "proposal-1": verifiedReceipt } }]);
  assert.deepEqual(extra[0].actionReceipts, canonical[0].actionReceipts);
  assert.throws(() => replaceAdvisorThread(canonical, CHIEF_ADVISOR_THREAD, [
    { ...verifiedReply, actionProposals: [{ ...verifiedProposal, actionId: "action-substituted" }] },
  ]), /proposal.*identity|receipt.*identity/i);
  assert.throws(() => replaceAdvisorThread(canonical, CHIEF_ADVISOR_THREAD, [
    verifiedReply, verifiedReply,
  ]), /duplicate.*Advisor.*message/i);
  assert.throws(() => replaceAdvisorThread([...canonical, canonical[0]], CHIEF_ADVISOR_THREAD, [verifiedReply]), /duplicate.*Advisor.*message/i);
});

// The root of the 13 failed saves: an Undo put the saved conversation back to before an approval while the panel
// kept the receipt. The panel now takes each reply's receipts from the file whenever it changes.
test("the panel's copy takes its Action receipts from the saved conversation", () => {
  const approved = { ...verifiedReply, actionReceipts: { "proposal-0": verifiedReceipt } };
  const note = { role: "user", text: "Do it" };
  // Undone: the file lost the receipt, so the panel's copy loses it too, and nothing else changes.
  const undone = withSavedActionReceipts([note, approved], [note, verifiedReply]);
  assert.equal(undone[1].actionReceipts, undefined);
  assert.equal(undone[0], note);
  // Approved elsewhere: the file has it, so the panel's copy gains it.
  assert.deepEqual(withSavedActionReceipts([verifiedReply], [approved])[0].actionReceipts, approved.actionReceipts);
  // Already the same, or a reply still streaming: the copy itself comes back.
  const same = [approved];
  assert.equal(withSavedActionReceipts(same, [approved]), same);
  const streaming = [{ ...approved, streaming: true }];
  assert.equal(withSavedActionReceipts(streaming, []), streaming);
  // And a save of the synced copy goes through.
  assert.equal(replaceAdvisorThread([note, verifiedReply], CHIEF_ADVISOR_THREAD, undone)[1].actionReceipts, undefined);
});
