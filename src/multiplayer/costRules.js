/*! Open Historia — who pays for what in a shared game, in words © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Rule 10 of the map, and the owner's decisions 2, 3, 8 and 14: the lobby says
// who pays for what, and what each player's own AI is for. Before, a guest was
// told it needed no AI key at all, while its advisor, suggestions, generals and
// Search used its own key, and with each player's own AI answering ("own")
// some governments were answered on the host's key, without limit, and nobody
// was told (the gap audit of 2026-11-18).
//
// One place for the words, from the game's settings as the host's lobby
// states them (host/settings.js): the lobby (ui/GameRules.jsx), the host's
// own form (ui/HostCostFields.jsx), the round's rules (ui/SharedGameOverlay.jsx)
// and a player's AI set-up (GameUI/main.jsx) all read them here. Whole
// sentences, each its own: a sentence built from pieces could not be put in
// another language's order.
//
// Pure but for the settings' own bounds.

import { DEFAULT_SETTINGS, HOST_ANSWERS_MAX } from "./host/settings.js";

// The choices the host is offered for its number of answers a round (host/settings.js hostAnswers).
export const HOST_ANSWER_CHOICES = Object.freeze([0, 1, 2, 3, 5, 10, 20, HOST_ANSWERS_MAX]);

const hostAnswersOf = (settings) => Math.max(0, Math.trunc(Number(settings?.hostAnswers) || 0));
// The choices the host is offered for its number of answers a round with its own AI answering (`answersPerRound`).
export const ANSWERS_PER_ROUND_CHOICES = Object.freeze([0, 5, 10, 20, HOST_ANSWERS_MAX]);
const answersPerRoundOf = (settings) => Math.max(0, Math.trunc(Number(settings?.answersPerRound ?? DEFAULT_SETTINGS.answersPerRound) || 0));

// What the paying player's device can do with a round, in the owner's words
// when he chose it (decision 14: "that round's payer sees every player's orders
// and secrets and could alter the outcome; it is to be a host setting that says
// so in the lobby"). Its answer is the round's: the host's engine applies it.
export const PAYER_SEES_AND_CHANGES = "The paying player's device sees that round's whole request, every player's orders and secrets included, and could change what happens in that round.";

// The lines of the lobby's "Who pays", in order: the round, the governments
// the AI plays, and what is always each player's own. `host`: the one reading
// is the host, whose own messages are always its own AI's.
export const costRulesOf = (settings = {}, { host = false } = {}) => {
  const lines = [];
  if (settings?.payment === "cycle") {
    lines.push("Each round's AI request is made by each player's device in turn, on that player's own AI key. No key is sent: the host's computer builds the request, and the paying device carries it to its own AI and sends back the answer.");
    lines.push(PAYER_SEES_AND_CHANGES);
    lines.push("A player whose device has no AI that can make a round's request is passed over until it has one.");
  } else {
    lines.push("The host's AI makes each round's request.");
  }
  if (settings?.replies === "own") {
    lines.push("Your own AI answers your messages to countries the AI plays, and writes the stat sheets, parties and military figures you are the first to open.");
    // What a device writes stands for everyone (the review of 2026-11-18, security S6).
    lines.push("The figures a player's device writes for a country the AI plays stand for every player. Your own country's figures, and those of a country at war with you, are written by the host's AI.");
    // A reading is left once, to the first who asks (host/gameHost.js leaveReading,
    // the review's cost 7); and the host's AI reads nothing by itself
    // (runtime/sharedReadings.js, cost 6): what the war needs is the round's.
    lines.push("A sheet, parties or military figures of a country the AI plays are written once, by the device of the first player to open them: a player who opens them meanwhile sees them once they are written.");
    lines.push("The host's AI reads no figures by itself: what the war needs of a country nobody has opened is written in the round's own request.");
    const most = hostAnswersOf(settings);
    if (host) {
      lines.push("As the host, your messages to every country the AI plays are answered by your own AI.");
    } else {
      lines.push(most > 0
        ? `Countries at war with you, your overlord or puppet, institutions and a conversation with a vote open are answered by the host's AI, up to ${most} of your messages a round; past that, the round reads them.`
        : "Countries at war with you, your overlord or puppet, institutions and a conversation with a vote open are not answered between rounds: the round reads what you write to them.");
    }
  } else {
    // A number the host sets (host/settings.js answersPerRound; rule 10).
    const most = answersPerRoundOf(settings);
    lines.push(most > 0
      ? `The host's AI answers up to ${most} of your messages a round to countries the AI plays, Councils and hearings included; past that, the round reads them. It writes the stat sheets, parties and military figures.`
      : "The host's AI answers no messages between rounds: the round reads what you write to countries the AI plays. It writes the stat sheets, parties and military figures.");
    // As in single player (runtime/sharedReadings.js): after each round, the
    // figures of countries at war nobody has read, as background requests.
    lines.push("After each round it also reads, by itself, the figures the war needs of countries at war whose figures nobody has read.");
  }
  lines.push("Your own AI answers your advisor and its report, AI suggestions, Plan it and Improve on your projects, Assess progress on your goal, your generals and Rostra Search.");
  return lines;
};

// For the AI set-up of a guest whose list holds only its own Agent: why it is
// asked (an Agent answers only what its player starts: providerConfig.js
// entryServesCall). Its own sentence after ownAiUsesOf's, so each is translated whole.
export const OWN_AGENT_LINE = "Your own Agent answers only what you start yourself and answer with /answer; for the rest, set up an AI with an API key or a server of your own.";

// What a player's own AI is for in this game, for its AI set-up: everything
// that is never the host's, and what the host's settings leave to each player.
export const ownAiUsesOf = (settings = {}) => {
  const own = settings?.replies === "own";
  const cycle = settings?.payment === "cycle";
  if (own && cycle) return "In this shared game your own AI answers your advisor and its report, AI suggestions, Plan it and Improve on your projects, Assess progress on your goal, your generals and Rostra Search; your messages to countries the AI plays; the stat sheets, parties and military figures you open first; and it makes the round's request when it is your turn to pay.";
  if (own) return "In this shared game your own AI answers your advisor and its report, AI suggestions, Plan it and Improve on your projects, Assess progress on your goal, your generals and Rostra Search; your messages to countries the AI plays; and the stat sheets, parties and military figures you open first. The host's AI makes each round's request.";
  if (cycle) return "In this shared game your own AI answers your advisor and its report, AI suggestions, Plan it and Improve on your projects, Assess progress on your goal, your generals and Rostra Search, and makes the round's request when it is your turn to pay. The host's AI answers your messages to countries the AI plays.";
  return "In this shared game the host's AI makes each round's request and answers your messages to countries the AI plays. Your own AI answers your advisor and its report, AI suggestions, Plan it and Improve on your projects, Assess progress on your goal, your generals and Rostra Search.";
};

// Whose device pays the round, for the round bar: `payer` the country it is,
// `me` the country this player plays, `phase` the round's.
export const payerLineOf = ({ payer = "", me = "", phase = "" } = {}) => {
  if (!payer) return "";
  if (payer === me) return phase === "resolving" ? "Your device is making this round's AI request, on your own AI." : "Your device pays for this round's AI request.";
  return phase === "resolving" ? `${payer}'s device is making this round's AI request.` : `${payer}'s device pays for this round's AI request.`;
};
