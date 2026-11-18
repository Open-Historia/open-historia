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

import { HOST_ANSWERS_MAX } from "./host/settings.js";

// The choices the host is offered for its number of answers a round (host/settings.js hostAnswers).
export const HOST_ANSWER_CHOICES = Object.freeze([0, 1, 2, 3, 5, 10, 20, HOST_ANSWERS_MAX]);

const hostAnswersOf = (settings) => Math.max(0, Math.trunc(Number(settings?.hostAnswers) || 0));

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
    const most = hostAnswersOf(settings);
    if (host) {
      lines.push("As the host, your messages to every country the AI plays are answered by your own AI.");
    } else {
      lines.push(most > 0
        ? `Countries at war with you, your overlord or puppet, institutions and a conversation with a vote open are answered by the host's AI, up to ${most} of your messages a round; past that, the round reads them.`
        : "Countries at war with you, your overlord or puppet, institutions and a conversation with a vote open are not answered between rounds: the round reads what you write to them.");
    }
  } else {
    lines.push("The host's AI answers messages to countries the AI plays, and writes the stat sheets, parties and military figures.");
  }
  lines.push("Your own AI answers your advisor and its report, AI suggestions, Plan it and Improve on your projects, Assess progress on your goal, your generals and Rostra Search.");
  return lines;
};

// With players taking turns to pay: who takes a turn, and who cannot yet
// (game/messages.js SEAT `pays`), and for this player, why theirs is passed
// over. `seats`: the lobby's.
export const payersLinesOf = (settings = {}, seats = []) => {
  if (settings?.payment !== "cycle") return [];
  const listed = (Array.isArray(seats) ? seats : []).filter((seat) => seat && seat.status !== "watching" && seat.held === true);
  const paying = listed.filter((seat) => seat.pays === true).map((seat) => seat.country);
  const passed = listed.filter((seat) => seat.pays === false).map((seat) => seat.country);
  const lines = [];
  if (paying.length) lines.push(`Paying in turn: ${paying.join(", ")}.`);
  if (passed.length) lines.push(`Passed over until their device has an AI that can make a round's request: ${passed.join(", ")}.`);
  if (listed.some((seat) => seat.you === true && seat.pays === false)) {
    lines.push("Your device has no AI that can make a round's request now, so your turn to pay is passed over. Set one up under Settings, AI.");
  }
  return lines;
};

// What decides a round's cost and its wait, as the round's rules say it
// (game/messages.js lobby `rules`, host/hostRules.js): on the host's AI, its
// own settings' count; on the paying player's, that player's own settings
// decide (Game/AI/roundCarrier.js carriedSkipRules). Both wait on a silent AI
// for the host's "Limit AI generation", which the paying device's word that its
// model is at work puts off, as an answer arriving does on the host's own.
export const roundCostLinesOf = (rules = null, settings = {}) => {
  if (!rules) return [];
  const cycle = settings?.payment === "cycle";
  const requests = Math.max(1, Math.trunc(Number(rules.requests) || 1));
  const most = Math.max(requests, Math.trunc(Number(rules.most) || requests));
  const lines = [];
  if (cycle) {
    lines.push("Each round is one request to the paying player's AI; that player's own AI settings decide whether it may make more, to look things up or to write a long round in segments.");
  } else if (most > requests) {
    lines.push(requests === 1
      ? `Each round is one request to the host's AI, up to ${most} when it looks things up.`
      : `Each round is ${requests} requests to the host's AI, up to ${most} when it looks things up.`);
  } else {
    lines.push(requests === 1 ? "Each round is one request to the host's AI." : `Each round is ${requests} requests to the host's AI.`);
  }
  lines.push("When an institution's members vote, the round makes one request more.");
  if (rules.stallMinutes) lines.push(`A round whose AI is silent for ${rules.stallMinutes} minutes fails, and the host can run it again.`);
  else lines.push(cycle ? "A round waits for the paying player's AI as long as it takes, and the host can cancel it." : "A round waits for the host's AI as long as it takes, and the host can cancel it.");
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
