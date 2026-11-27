/*! Open Historia — the host's word that a request waits for the round © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every change a player asks for is one entry of the host's one queue
// (host/worldQueue.js), and the round being resolved is an entry too: one that
// holds the queue for as long as the time skip takes, a minute or more. A
// request asked meanwhile is applied straight after the round, and answered
// then.
//
// The page did not know that. Each screen gave its requests a deadline of its
// own (30 seconds for an institution's business, two minutes for a vote, five
// for a stat sheet), blind to the round, and when it ran out the screen said
// "The host did not answer." and forgot the request, which the host then
// applied when the round landed. A player told their founding failed founded it
// again: a second institution, a second vote refused with a reason that
// contradicted the first message (the review of 2026-11-18, door 1). Two clocks,
// one of them blind.
//
// So the host says it, at once, of every request alike: this one is taken and
// waits for the round being resolved ({ t: "held", id }, game/messages.js). The
// page then waits for its answer however long the round takes, with no deadline
// of its own (client/gameClient.js), and its screens say what it waits for. The
// host's word is said:
//
//   - when a request arrives while a round is being resolved, whatever it asks:
//     an entry of the queue waits behind the round, and so does what a request
//     that asks the AI first writes (a stat sheet under the game's own lock, an
//     institution's business through the queue);
//   - and when a round begins to be resolved while a request that asks the AI
//     first is still being answered (`thinking`): what it writes will wait.
//
// A request the host answers at once whatever is being applied (the round's own
// state, a view seen, a paying device's answer: gameHost.js AT_ONCE) is never
// held. Each request is told once; one sent again after a reconnect, still
// held, is told again on the connection it came back on.
//
// Runtime-free: `tell(device, message)` sends a word to every connection of a
// device, and the host's tests drive it as the engine does.

const keyOf = (device, id) => `${device}\n${id}`;

export const createRequestWaits = ({ tell = () => {}, thinking = new Set() } = {}) => {
  // device+id → { device, id, t, held }: the requests being answered now.
  const open = new Map();
  const hold = (entry) => {
    entry.held = true;
    tell(entry.device, { t: "held", id: entry.id });
  };
  return {
    // A request taken. `resolving`: a round is being resolved now.
    begin({ device, id, t, resolving = false }) {
      if (!device || !id) return;
      const entry = { device, id, t: String(t || ""), held: false };
      open.set(keyOf(device, id), entry);
      if (resolving) hold(entry);
    },
    // The same request again (sent again after a reconnect), still being
    // answered: told again that it is held, if it is.
    again(device, id) {
      const entry = open.get(keyOf(device, id));
      if (entry?.held) tell(device, { t: "held", id });
    },
    // A round began to be resolved: what the requests still thinking write
    // waits for it.
    roundBegan() {
      for (const entry of open.values()) if (!entry.held && thinking.has(entry.t)) hold(entry);
    },
    // A request answered.
    end(device, id) {
      open.delete(keyOf(device, id));
    },
    // How many are held now (for the host's tests and log).
    get held() {
      return [...open.values()].filter((entry) => entry.held).length;
    },
  };
};
