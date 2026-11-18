/*! Open Historia — a shared game's institutions, run by the host: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/institutions.test.js
//
// The host founding an institution in a shared game was refused ("409"): every
// screen of a shared game is a player's, and none writes the game. Now each
// asks the host, which runs the game's own institution functions for the
// asker's country. These hold the host to that: the country is the seat's
// whatever the request names, only what the screens send gets through, and a
// thread made for a guest is the guest's.

import test from "node:test";
import assert from "node:assert/strict";
import { createInstitutionDesk, governanceCommandFor, institutionThreadRefusal, lifecycleCommandFor } from "./institutions.js";

const HOST = "Abkhazia";
const GUEST = "Russia";

test("a lifecycle command acts for the seat, with the player's authority, and carries only what the screens send", () => {
  const command = lifecycleCommandFor({
    type: "invite", institutionId: "baltic-pact", initiatedBy: "Latvia", polity: "Estonia",
    requestedStatus: "member", reason: "Neighbours", authority: "admin", sneaky: true,
  }, GUEST);
  assert.deepEqual(command, {
    type: "invite", authority: "player", institutionId: "baltic-pact", polity: "Estonia",
    requestedStatus: "member", reason: "Neighbours", initiatedBy: GUEST,
  });
  // Founding names its founder by the player alone: no founder field at all.
  const founding = lifecycleCommandFor({
    type: "found", name: "Baltic Pact", kind: "security_alliance", founder: "Latvia",
    invitees: ["Estonia", "Lithuania"], minimumFoundingMembers: "999", allowObserver: false,
  }, GUEST);
  assert.equal(founding.founder, undefined);
  assert.equal(founding.authority, "player");
  assert.deepEqual(founding.invitees, ["Estonia", "Lithuania"]);
  assert.equal(founding.minimumFoundingMembers, 64);
  assert.equal(founding.allowObserver, false);
  assert.equal(lifecycleCommandFor({ type: "Cancel Application", caseId: "c1" }, GUEST).polity, GUEST);
  assert.throws(() => lifecycleCommandFor({ type: "seize-treasury" }, GUEST), /not something a player can do/);
});

test("a governance command is only one the screens send, and it is the seat's", () => {
  assert.deepEqual(governanceCommandFor({ type: "vote", proposalId: "p1", choice: "yes", polity: "Latvia", authority: "npc" }, GUEST), {
    type: "vote", polity: GUEST, proposalId: "p1", choice: "yes", authority: "player", finalizeWhenComplete: true, implementWhenPassed: true,
  });
  assert.deepEqual(governanceCommandFor({ type: "amendment", proposalId: "p1", proposer: "Latvia", amendment: { text: "Add a clause" } }, GUEST), {
    type: "amendment", proposer: GUEST, proposalId: "p1", amendment: { text: "Add a clause" },
  });
  for (const type of ["status", "open-voting", "create", "call-vote"]) {
    assert.throws(() => governanceCommandFor({ type, proposalId: "p1" }, GUEST), /not something a player can do/, type);
  }
});

// The game's functions, recorded, over an in-memory list of threads.
const fakeGame = ({ chats = [], made = {} } = {}) => {
  const state = { chats: [...chats], calls: [] };
  const record = (name, result) => async (args) => {
    state.calls.push({ name, args });
    if (typeof result === "function") return result(args);
    return result;
  };
  state.game = {
    lifecycle: record("lifecycle", made.lifecycle ?? {}),
    negotiation: record("negotiation", made.negotiation ?? {}),
    channel: record("channel", made.channel ?? {}),
    proposal: record("proposal", made.proposal ?? {}),
    voteRequest: record("voteRequest", made.voteRequest ?? {}),
    governance: record("governance", made.governance ?? {}),
    message: record("message", made.message ?? {}),
    chatTurn: record("chatTurn", {}),
    readChats: async () => state.chats,
    updateChats: async (fn) => {
      const next = fn(state.chats);
      if (next) state.chats = next;
    },
  };
  return state;
};

test("a guest founds an institution: run for the guest, and the founding table made is the guest's", async () => {
  const state = fakeGame({ chats: [{ id: "thread-host", countries: ["Russia"] }] });
  state.game.lifecycle = async (args) => {
    state.calls.push({ name: "lifecycle", args });
    state.chats = [...state.chats, { id: "founding-1", countries: ["Estonia"] }];
    return { institution: { id: "baltic-pact" }, createdChat: { id: "founding-1" } };
  };
  const desk = createInstitutionDesk({ host: HOST, game: state.game });
  const made = await desk({ seat: GUEST, call: "lifecycle", args: { command: { type: "found", name: "Baltic Pact", invitees: ["Estonia"] } } });
  assert.deepEqual(made, { institutionId: "baltic-pact", proposalId: "", proposalStatus: "", chatId: "founding-1" });
  assert.equal(state.calls[0].args.playerCountry, GUEST);
  assert.equal(state.chats.find((chat) => chat.id === "founding-1").player, GUEST, "the founding table is the guest's");
  assert.equal(state.chats.find((chat) => chat.id === "thread-host").player, undefined, "the host's thread keeps its owner");
});

test("a thread that was there before keeps its owner, and the host's own make no owner", async () => {
  // The host's Council, which the guest now speaks in.
  const state = fakeGame({ chats: [{ id: "council-baltic", institutionId: "baltic-pact", countries: ["Russia"] }], made: { message: { channel: { id: "council-baltic" } } } });
  const desk = createInstitutionDesk({ host: HOST, game: state.game });
  await desk({ seat: GUEST, call: "message", args: { institutionId: "baltic-pact", text: "We object." } });
  assert.equal(state.chats[0].player, undefined);
  // The host founding: its table is its own, as every host thread is.
  state.game.lifecycle = async () => {
    state.chats = [...state.chats, { id: "founding-2", countries: ["Georgia"] }];
    return { institution: { id: "caucasus-forum" }, createdChat: { id: "founding-2" } };
  };
  await desk({ seat: HOST, call: "lifecycle", args: { command: { type: "found", name: "Caucasus Forum" } } });
  assert.equal(state.chats.find((chat) => chat.id === "founding-2").player, undefined);
});

test("the Council's turn says the comment first, then runs the turn the chat panel would, for the seat", async () => {
  const state = fakeGame({ made: { message: { channel: { id: "council-baltic" } }, channel: { channel: { id: "council-baltic" } } } });
  const desk = createInstitutionDesk({ host: HOST, game: state.game });
  const made = await desk({ seat: GUEST, call: "council", args: { institutionId: "baltic-pact", proposalId: "p1", kind: "vote", comment: "Vote now." } });
  assert.equal(made.chatId, "council-baltic");
  assert.deepEqual(state.calls.map((entry) => entry.name), ["message", "chatTurn"]);
  const turn = state.calls[1].args;
  assert.equal(turn.seat, GUEST);
  assert.equal(turn.formalBusinessRequested, true);
  assert.equal(turn.institutionProposalId, "p1");
  assert.equal(turn.playerMessage, "");
  await assert.rejects(desk({ seat: GUEST, call: "council", args: { institutionId: "baltic-pact" } }), /Which institution/);
});

test("a hearing is answered only for someone at it", async () => {
  const state = fakeGame({ chats: [
    { id: "hearing-1", player: GUEST, countries: ["Latvia"] },
    { id: "host-private", countries: ["Georgia"] },
  ] });
  const desk = createInstitutionDesk({ host: HOST, game: state.game });
  await desk({ seat: GUEST, call: "hearing", args: { thread: "hearing-1" } });
  assert.equal(state.calls.at(-1).args.lifecycleResponseRequested, true);
  await assert.rejects(desk({ seat: GUEST, call: "hearing", args: { thread: "host-private" } }), /not in that conversation/);
  await assert.rejects(desk({ seat: GUEST, call: "hearing", args: { thread: "nowhere" } }), /not there/);
  await assert.rejects(desk({ seat: GUEST, call: "summon-army", args: {} }), /not something a player can do/);
});

// A Council's or a hearing's turn ran outside the table's one turn at a time
// (host/gameHost.js onTable), beside an answer in the same thread: both read
// the thread as it was, minted the same line ids, and the second's lines were
// dropped as known (the gap audit of 2026-11-18, D2).
test("a Council's and a hearing's turn wait for the table's turn, and read the thread as the turn before left it", async () => {
  const state = fakeGame({
    chats: [{ id: "council-baltic", institutionId: "baltic-pact", countries: ["Latvia"], messages: [] }, { id: "hearing-1", player: GUEST, countries: ["Latvia"] }],
    made: { channel: { channel: { id: "council-baltic", messages: [] } } },
  });
  const desk = createInstitutionDesk({ host: HOST, game: state.game });
  const turns = [];
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const onTable = async (chatId, job) => {
    turns.push(chatId);
    await held;
    // What the answer before it wrote.
    state.chats = state.chats.map((chat) => (chat.id === chatId ? { ...chat, messages: [...(chat.messages ?? []), { id: "m-before", text: "Said before." }] } : chat));
    return job();
  };
  const council = desk({ seat: GUEST, call: "council", args: { institutionId: "baltic-pact", proposalId: "p1", kind: "debate" }, onTable });
  const hearing = desk({ seat: GUEST, call: "hearing", args: { thread: "hearing-1" }, onTable });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(turns, ["council-baltic", "hearing-1"], "each turn is its table's");
  assert.equal(state.calls.filter((entry) => entry.name === "chatTurn").length, 0, "nothing is asked before the table's turn");
  release();
  await Promise.all([council, hearing]);
  const asked = state.calls.filter((entry) => entry.name === "chatTurn").map((entry) => entry.args);
  assert.equal(asked.length, 2);
  for (const turn of asked) {
    assert.equal(turn.seat, GUEST);
    assert.deepEqual(turn.chat.messages.map((message) => message.id), ["m-before"], "the thread as it stands when the turn comes");
  }
});

// Any member closed or renamed an institution's Council or a hearing for every
// member (the gap audit of 2026-11-18, N6).
test("an institution's table keeps its name, its Council stays open, and a hearing closes once it is settled", () => {
  const world = (status) => ({ institutions: { byId: { "baltic-pact": {
    id: "baltic-pact", name: "Baltic Pact", status: "active", members: [{ polity: "Latvia", status: "member" }],
    lifecycleCases: { c1: { id: "c1", kind: "invitation", polity: GUEST, initiatedBy: "Latvia", status } },
  } } } });
  const council = { id: "council-baltic", institutionId: "baltic-pact" };
  const hearing = { id: "invite-1", lifecycleInstitutionId: "baltic-pact", lifecycleCaseIds: ["c1"] };
  const accession = { ...hearing, institutionId: "baltic-pact" };
  assert.match(institutionThreadRefusal(council, "rename", world("pending")), /keeps the institution's name/);
  assert.match(institutionThreadRefusal(council, "close", world("pending")), /stays open/);
  const dissolved = world("pending");
  dissolved.institutions.byId["baltic-pact"].status = "dissolved";
  assert.equal(institutionThreadRefusal(council, "close", dissolved), "", "a dissolved institution's Council is anyone's in it to put away");
  assert.match(institutionThreadRefusal(hearing, "rename", world("pending")), /keeps the institution's name/);
  assert.match(institutionThreadRefusal(hearing, "close", world("pending")), /closes once its business is settled/);
  assert.match(institutionThreadRefusal(accession, "close", world("pending-approval")), /closes once its business is settled/);
  assert.equal(institutionThreadRefusal(hearing, "close", world("rejected")), "", "settled: leaving it closes it, for everyone");
  assert.equal(institutionThreadRefusal(accession, "close", world("accepted")), "");
  // Adding is refused where it always was (host/gameHost.js); any other thread is anyone's in it to change.
  assert.equal(institutionThreadRefusal(council, "add", world("pending")), "");
  assert.equal(institutionThreadRefusal({ id: "talks" }, "rename", world("pending")), "");
  assert.equal(institutionThreadRefusal({ id: "talks" }, "close", world("pending")), "");
});
