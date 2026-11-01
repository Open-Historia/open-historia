/*! Open Historia — a shared game's institutions, run by the host for each player © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A player's screen in a shared game writes nothing to the game: its
// Institutions screen, its threads and its advisor ask the host instead (the
// "institution" request, game/messages.js), and this runs what they ask with
// the game's own institution functions (runtime/institution*.js), in the
// host's engine window, for the asking seat's country. The host founding an
// institution was refused before this: its own screen is a player's screen
// too, and its write came back "409".
//
// The country is never the asker's to name. Every call is run with the seat's
// country as the player, every command carries the player's authority (the
// game's own rules then refuse a player acting for another government), and
// the fields that say who acts are the seat's whatever the request said.
// Only what the screens send is taken: a command type outside these lists, or
// a field that is not one of them, never reaches the game.
//
// A thread one of these makes for a guest is the guest's (chat.player): one
// with no owner is the host's (host/projection.js threadOwner), and a guest's
// founding table would otherwise reach nobody but the host.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const same = (a, b) => clean(a).toLocaleLowerCase() === clean(b).toLocaleLowerCase();
const text = (value, max = 600) => clean(value).slice(0, max);
const names = (value, max = 24) => list(value).map((entry) => text(entry, 120)).filter(Boolean).slice(0, max);
const count = (value, low, high, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(low, Math.min(high, Math.round(number))) : fallback;
};

// The lifecycle commands a player's screen sends (InstitutionsWorkspace.jsx,
// chat.jsx, advisor.jsx), each with the fields it may carry and the one that
// names who acts, which is the seat's. "found" names its founder by the
// player alone.
const LIFECYCLE = Object.freeze({
  found: { actor: "", fields: ["name", "shortName", "kind", "politicalCharacter", "votingRule", "accessionMode", "withdrawalMode", "expulsionMode", "dissolutionMode", "charterNote"], lists: ["purpose", "geographicScope", "primaryThreatModel", "invitees"], numbers: { minimumFoundingMembers: [1, 64, 2], withdrawalNoticeDays: [0, 3650, 0] }, flags: ["allowObserver"] },
  apply: { actor: "polity", fields: ["institutionId", "requestedStatus", "reason"] },
  invite: { actor: "initiatedBy", fields: ["institutionId", "polity", "requestedStatus", "reason"] },
  respond: { actor: "actorPolity", fields: ["institutionId", "caseId", "decision", "reason"] },
  retract: { actor: "initiatedBy", fields: ["institutionId", "caseId"] },
  "cancel-application": { actor: "polity", fields: ["institutionId", "caseId", "reason"] },
  withdraw: { actor: "polity", fields: ["institutionId", "reason"] },
  expel: { actor: "initiatedBy", fields: ["institutionId", "polity", "reason"] },
  suspend: { actor: "initiatedBy", fields: ["institutionId", "polity", "reason"] },
  reinstate: { actor: "initiatedBy", fields: ["institutionId", "polity", "reason"] },
  dissolve: { actor: "initiatedBy", fields: ["institutionId", "reason"] },
});

// The governance commands a player's screen sends, and the field naming who
// acts. Everything else the governance core does (statuses, opening a vote)
// is the institution's own rules', never a request's.
const GOVERNANCE = Object.freeze({
  vote: { actor: "polity", fields: ["proposalId", "choice", "reason"] },
  amendment: { actor: "proposer", fields: ["proposalId"] },
  "amendment-status": { actor: "requester", fields: ["proposalId", "amendmentId", "status"] },
});

const typeOf = (command) => clean(command?.type).toLowerCase().replace(/[\s_]+/g, "-");

// A lifecycle command as the game takes it from this seat, or a refusal.
export const lifecycleCommandFor = (command, seat) => {
  const type = typeOf(command);
  const shape = LIFECYCLE[type];
  if (!shape) throw new Error("That is not something a player can do to an institution.");
  const out = { type, authority: "player" };
  for (const field of shape.fields ?? []) if (command?.[field] !== undefined) out[field] = text(command[field], field === "charterNote" || field === "reason" ? 600 : 160);
  for (const field of shape.lists ?? []) if (command?.[field] !== undefined) out[field] = names(command[field]);
  for (const [field, [low, high, fallback]] of Object.entries(shape.numbers ?? {})) if (command?.[field] !== undefined) out[field] = count(command[field], low, high, fallback);
  for (const field of shape.flags ?? []) if (command?.[field] !== undefined) out[field] = command[field] !== false;
  if (shape.actor) out[shape.actor] = seat;
  return out;
};

// A governance command as the game takes it from this seat, or a refusal.
export const governanceCommandFor = (command, seat) => {
  const type = typeOf(command);
  const shape = GOVERNANCE[type];
  if (!shape) throw new Error("That is not something a player can do in an institution.");
  const out = { type, [shape.actor]: seat };
  for (const field of shape.fields) if (command?.[field] !== undefined) out[field] = text(command[field], 160);
  if (type === "vote") Object.assign(out, { authority: "player", finalizeWhenComplete: true, implementWhenPassed: true });
  if (type === "amendment") out.amendment = { text: text(command?.amendment?.text ?? command?.text, 1200) };
  return out;
};

const idOf = (value) => text(value, 160);

// `game`: the game's own functions, passed in (host/engineMain.js) so this is
// testable without them:
//   lifecycle, negotiation, channel, proposal, voteRequest, governance,
//   message, chatTurn({ chat, seat, ...flags }), readChats(), updateChats(fn)
// Resolves { institutionId, proposalId, proposalStatus, chatId }.
// `host` is the host's own country, or a function giving it as it is now.
export const createInstitutionDesk = ({ host: hostOf = "", game }) => {
  const host = () => (typeof hostOf === "function" ? hostOf() : hostOf);
  // A thread this call made, for a guest: the guest's. Only the one the call
  // names, and only if it was not there before it: a thread anyone else made
  // meanwhile, or the host's own Council the guest now speaks in, keeps its owner.
  const ownership = async (seat, before, chatId) => {
    if (!chatId || same(seat, host()) || before.has(chatId)) return;
    await game.updateChats((chats) => {
      let changed = false;
      const next = list(chats).map((chat) => {
        if (clean(chat?.id) !== chatId || clean(chat?.player)) return chat;
        changed = true;
        return { ...chat, player: seat };
      });
      return changed ? next : null;
    });
  };
  const chatIds = async () => new Set(list(await game.readChats()).map((chat) => clean(chat?.id)).filter(Boolean));
  const threadFor = async (seat, threadId) => {
    const chat = list(await game.readChats()).find((entry) => clean(entry?.id) === threadId);
    if (!chat) throw new Error("That conversation is not there.");
    const owner = clean(chat.player) || host();
    const member = list(chat.countries).some((entry) => same(typeof entry === "object" && entry ? entry.name ?? entry.code : entry, seat));
    if (!same(owner, seat) && !member) throw new Error("You are not in that conversation.");
    return chat;
  };

  const calls = {
    lifecycle: async (seat, { command }) => {
      const result = await game.lifecycle({ playerCountry: seat, command: lifecycleCommandFor(command, seat) });
      return {
        institutionId: idOf(result?.institution?.id || command?.institutionId),
        proposalId: idOf(result?.proposal?.id),
        proposalStatus: idOf(result?.proposal?.status),
        chatId: idOf(result?.createdChat?.id),
      };
    },
    negotiation: async (seat, { institutionId, caseIds }) => {
      const result = await game.negotiation({ playerCountry: seat, institutionId: idOf(institutionId), caseIds: names(caseIds, 24) });
      return { institutionId: idOf(institutionId), chatId: idOf(result?.channel?.id) };
    },
    channel: async (seat, { institutionId }) => {
      const result = await game.channel({ playerCountry: seat, institutionId: idOf(institutionId) });
      return { institutionId: idOf(institutionId), chatId: idOf(result?.channel?.id) };
    },
    proposal: async (seat, { institutionId, proposal }) => {
      const title = text(proposal?.title, 200);
      if (!title) throw new Error("A proposal needs a title.");
      // The kind of proposal by name (the advisor tables more than resolutions);
      // the institution's charter decides whether this player may table it.
      const kind = /^[a-z][a-z-]{0,39}$/.test(clean(proposal?.type)) ? clean(proposal.type) : "resolution";
      const result = await game.proposal({ playerCountry: seat, institutionId: idOf(institutionId), proposal: { type: kind, title, summary: text(proposal?.summary, 1200) } });
      return { institutionId: idOf(institutionId), proposalId: idOf(result?.proposal?.id), proposalStatus: idOf(result?.proposal?.status) };
    },
    voteRequest: async (seat, { institutionId, proposalId }) => {
      const result = await game.voteRequest({ playerCountry: seat, institutionId: idOf(institutionId), proposalId: idOf(proposalId) });
      return { institutionId: idOf(institutionId), proposalId: idOf(result?.proposal?.id || proposalId), proposalStatus: idOf(result?.proposal?.status) };
    },
    governance: async (seat, { institutionId, command }) => {
      const result = await game.governance({ playerCountry: seat, institutionId: idOf(institutionId), command: governanceCommandFor(command, seat) });
      return { institutionId: idOf(institutionId), proposalId: idOf(result?.proposal?.id || command?.proposalId), proposalStatus: idOf(result?.proposal?.status) };
    },
    message: async (seat, { institutionId, text: said }) => {
      const line = text(said, 2000);
      if (!line) throw new Error("A message needs words.");
      const result = await game.message({ playerCountry: seat, institutionId: idOf(institutionId), text: line });
      return { institutionId: idOf(institutionId), chatId: idOf(result?.channel?.id) };
    },
    // The Council's turn on a proposal (chat.jsx runInstitutionCouncilTurn), on
    // the host's AI key: the player's comment said into the Council first.
    council: async (seat, { institutionId, proposalId, kind, comment }) => {
      const id = idOf(institutionId);
      const proposal = idOf(proposalId);
      if (!id || !proposal) throw new Error("Which institution, and which proposal?");
      const mode = kind === "vote" ? "vote" : kind === "amendment" ? "amendment" : "debate";
      const line = text(comment, 2000);
      const opened = line
        ? await game.message({ playerCountry: seat, institutionId: id, text: line })
        : await game.channel({ playerCountry: seat, institutionId: id });
      const chat = opened?.channel;
      if (!chat?.id) throw new Error("The Council could not be opened.");
      await game.chatTurn({
        chat, seat,
        playerMessage: mode === "amendment" ? line : "",
        institutionDebateRequested: mode === "debate",
        institutionProposalId: proposal,
        formalBusinessRequested: mode === "vote",
        formalBusinessInteractive: mode === "vote",
      });
      return { institutionId: id, proposalId: proposal, chatId: idOf(chat.id) };
    },
    // The governments at a hearing answering it (chat.jsx "Request response").
    hearing: async (seat, { thread }) => {
      const chat = await threadFor(seat, idOf(thread));
      await game.chatTurn({ chat, seat, playerMessage: "", lifecycleResponseRequested: true });
      return { chatId: idOf(chat.id) };
    },
  };

  return async ({ seat, call, args = {} }) => {
    const run = calls[call];
    if (!run) throw new Error("That is not something a player can do to an institution.");
    const before = await chatIds();
    const made = await run(clean(seat), args && typeof args === "object" ? args : {});
    await ownership(clean(seat), before, made.chatId);
    return made;
  };
};
