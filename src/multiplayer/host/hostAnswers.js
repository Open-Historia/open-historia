/*! Open Historia — what the host's AI answers for each player a round, with each player's own AI © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// With settings.replies "own" each player's own device answers for the
// governments the AI plays (client/ownReplies.js), on its own key. Some answers
// cannot be left to it: a government at war with the writer may make peace in
// its answer, an Overlord or a Puppet may make or settle a demand, and an
// institution's table, Council or hearing votes and decides. Only the host's
// own game can carry those out (a device's reply is words alone), so the
// host's AI answers them (host/gameHost.js "say", "institution").
//
// They used to be answered without limit, on the host's key, while every
// guest was told their own AI answers: a player at war could spend the host's
// requests one line at a time. Now they are a number the host sets
// (settings.hostAnswers), counted for each player in each round, and none
// unless the host says (rule 3: requests are the scarce resource, and anything
// extra is off by default). The host's own lines are its own key's either way
// and are never counted. A line past the number is still written: the round
// reads it, as it reads every conversation.
//
// Held in memory: an engine opened again mid-round counts that round afresh,
// which can only give a player the answers of one round twice, never more.
// Pure.

import { HOST_ANSWERS_MAX } from "./settings.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLocaleLowerCase();
const bounded = (value) => Math.max(0, Math.min(HOST_ANSWERS_MAX, Math.trunc(Number(value) || 0)));

export const createHostAnswers = ({ limit = 0 } = {}) => {
  let most = bounded(limit);
  // seat → { round, used }
  const used = new Map();
  const usedBy = (seat, round) => {
    const entry = used.get(fold(seat));
    return entry && entry.round === round ? entry.used : 0;
  };
  return {
    get limit() {
      return most;
    },
    setLimit(next) {
      const value = bounded(next);
      if (value === most) return false;
      most = value;
      return true;
    },
    // How many are left to `seat` in `round`.
    left: (seat, round) => Math.max(0, most - usedBy(seat, round)),
    // One answer for `seat` in `round`: false when it has had them all.
    take(seat, round) {
      const had = usedBy(seat, round);
      if (had >= most) return false;
      used.set(fold(seat), { round, used: had + 1 });
      return true;
    },
  };
};

// What a player is told when the host's AI will not answer them again this
// round: for a line (which is written all the same), and for a Council's or a
// hearing's turn (which is not held).
export const hostAnswersSpent = (limit) => (bounded(limit) > 0
  ? `The host's AI answers at most ${bounded(limit)} of your messages a round to a government that can act on them (one at war with you, your overlord or puppet, an institution). This one waits for the round, which reads it.`
  : "In this game the host's AI does not answer messages to a government that can act on them (one at war with you, your overlord or puppet, an institution) between rounds. Yours is written, and the round reads it.");
export const hostTurnsSpent = (limit) => (bounded(limit) > 0
  ? `The host's AI answers at most ${bounded(limit)} of your messages a round to a government that can act on them, and you have had them this round. Ask again next round.`
  : "In this game the host's AI holds no Council or hearing turns between rounds. The round reads the institution's business.");
