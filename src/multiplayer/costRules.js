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
// own form (ui/HostCostFields.jsx) and a player's AI set-up (GameUI/main.jsx)
// all read them here. Whole sentences, each its own: a sentence built from
// pieces could not be put in another language's order.
//
// Pure but for the settings' own bounds.

import { HOST_ANSWERS_MAX } from "./host/settings.js";

// The choices the host is offered for its number of answers a round (host/settings.js hostAnswers).
export const HOST_ANSWER_CHOICES = Object.freeze([0, 1, 2, 3, 5, 10, 20, HOST_ANSWERS_MAX]);

const hostAnswersOf = (settings) => Math.max(0, Math.trunc(Number(settings?.hostAnswers) || 0));

// The lines of the lobby's "Who pays", in order: the round, the governments
// the AI plays, and what is always each player's own.
export const costRulesOf = (settings = {}) => {
  const lines = [];
  if (settings?.payment === "cycle") {
    lines.push("Each round's AI request is made by each player's device in turn, on that player's own AI key. No key is sent: the host's computer builds the request, and the paying device only carries it to its own AI and sends back the answer.");
    lines.push("The paying player's device sees that round's whole request, every player's orders and secrets included.");
  } else {
    lines.push("The host's AI makes each round's request.");
  }
  if (settings?.replies === "own") {
    lines.push("Your own AI answers your messages to countries the AI plays, and writes the stat sheets and parties you are the first to open.");
    const most = hostAnswersOf(settings);
    lines.push(most > 0
      ? `Countries at war with you, your overlord or puppet, and institutions are answered by the host's AI, up to ${most} of your messages a round; past that, the round reads them.`
      : "Countries at war with you, your overlord or puppet, and institutions are not answered between rounds: the round reads what you write to them.");
  } else {
    lines.push("The host's AI answers messages to countries the AI plays, and writes the stat sheets and parties.");
  }
  lines.push("Your own AI answers your advisor, AI suggestions, generals and Rostra Search.");
  return lines;
};

// The lobby's word on the Game Master (decision 8: behind a visible notice).
export const gameMasterRuleOf = (settings = {}) => (settings?.cheats === "host"
  ? "The host may change the world with the Game Master. Every change is told to every player and listed here."
  : "No Game Master in this game: nobody changes the world by hand.");

// What a player's own AI is for in this game, for its AI set-up: everything
// that is never the host's, and what the host's settings leave to each player.
export const ownAiUsesOf = (settings = {}) => {
  const own = settings?.replies === "own";
  const cycle = settings?.payment === "cycle";
  if (own && cycle) return "In this shared game your own AI answers your advisor, AI suggestions, generals and Rostra Search, your messages to countries the AI plays and the stat sheets you open first, and makes the round's request when it is your turn to pay. The host's AI does none of these for you.";
  if (own) return "In this shared game your own AI answers your advisor, AI suggestions, generals and Rostra Search, your messages to countries the AI plays and the stat sheets you open first. The host's AI makes each round's request.";
  if (cycle) return "In this shared game your own AI answers your advisor, AI suggestions, generals and Rostra Search, and makes the round's request when it is your turn to pay. The host's AI answers your messages to countries the AI plays.";
  return "In this shared game the host's AI makes each round's request and answers your messages to countries the AI plays. Your own AI answers your advisor, AI suggestions, generals and Rostra Search.";
};

// Whose device pays the round, for the round bar: `payer` the country it is,
// `me` the country this player plays, `phase` the round's.
export const payerLineOf = ({ payer = "", me = "", phase = "" } = {}) => {
  if (!payer) return "";
  if (payer === me) return phase === "resolving" ? "Your device is making this round's AI request, on your own AI." : "Your device pays for this round's AI request.";
  return phase === "resolving" ? `${payer}'s device is making this round's AI request.` : `${payer}'s device pays for this round's AI request.`;
};
