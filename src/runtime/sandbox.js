/*! Open Historia — sandbox mode © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/sandbox.test.js
//
// Sandbox mode is a per-game switch (game.sandbox) for playing the world rather
// than one country in it:
//   - an order may be given for ANY polity ("as France"), and the turn treats
//     it as that government's own decision;
//   - Write event and GM command sit beside the order box;
//   - observer (game.observer, only with sandbox): the player leads no one.
//     game.country is kept, because the map, the Stats pane and a hundred other
//     places read it as "the country in focus"; it is simply no longer the
//     player's, and the turn simulates it like every other power.
//
// Single player only: in a shared game one person steering every country would
// steer the other players' too. The engine hosting a shared game ignores the
// switches (a sandbox save opened to friends plays as an ordinary game), and
// the panels grey them out on a host's or a guest's page.
//
// Pure rules on plain data, tested under bare node; humanPolities.js is the
// one import, for whether this engine is hosting a shared game.

import { hostingSharedGame } from "./humanPolities.js";

const asText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const isSandbox = (game) => game?.sandbox === true && !hostingSharedGame();
export const isObserver = (game) => isSandbox(game) && game?.observer === true;

// The polity an order is given for: its own actor, else the player's country.
// An observer's order with no actor belongs to nobody, and is not sent.
export const actorOf = (action, game) => asText(action?.actor) || (isObserver(game) ? "" : asText(game?.country));

// The game with sandbox switched on or off. Observer needs sandbox, so turning
// sandbox off turns observer off too.
export const withSandbox = (game, { sandbox, observer } = {}) => {
  const nextSandbox = sandbox ?? game?.sandbox === true;
  return { ...game, sandbox: nextSandbox, observer: nextSandbox ? (observer ?? game?.observer === true) : false };
};

// What every turn is told, LAST in its prompt so it outranks the player-centred
// rules above it. "" outside sandbox.
export const describeSandboxForSimulation = (game) => {
  if (!isSandbox(game)) return "";
  const country = asText(game?.country);
  const orders = "The player may give orders for ANY polity; each such order is marked (as <polity>) in the order list. "
    + "An order marked (as X) is X's own government's decision: carry it out as X's sovereign act, authorised exactly as the player's own orders are, "
    + "with the same rules for consent, means and plausible outcomes. Cite its id in actionIds like any other order. "
    + "An order marked (decree) is the game master's decree: it happens as written, in an event with the operations that make it real; how it happens is yours to tell, whether it happens is not. "
    + "An order without that mark is an attempt, and its outcome is yours to judge, however it is worded.";
  if (isObserver(game)) {
    return "[Sandbox Mode — Observer]\n"
      + "No polity is human-controlled in this game. The player watches the world and intervenes from outside it. "
      + `${country ? `${country} is not the player's polity: simulate it like every other power, its major decisions included. ` : ""}`
      + "Every rule above that protects the player's polity, reserves decisions for it, centres events on it or speaks of 'the player's polity' does not apply: give every power its own initiative. "
      + orders;
  }
  return "[Sandbox Mode]\n"
    + `The player leads ${country || "their polity"} and may also steer other polities. ${orders} `
    + `The rules that reserve decisions for ${country || "the player's polity"} still apply to it; a polity the player has not ordered this turn acts on its own initiative as usual.`;
};

// What Improve action text (the descriptionToAction task) is told in sandbox
// mode. A decree is what HAPPENS, not a government's attempt to make it happen:
// "student lead movement topples corrupt Vučić's government" became "Provide
// covert backing to the opposition ... to topple the Vučić government", a
// foreign power funding a hope. An attempt is what the acting polity does, its
// outcome left to the turn.
export const describeSandboxForRefine = (game, actor = "", { decree = true } = {}) => {
  if (!isSandbox(game)) return "";
  const as = asText(actor);
  if (!decree) {
    return as
      ? `[Sandbox Mode]\nThis order is given as ${as}: write it as ${as}'s own decision and what its government does to carry it out, with ${as} as the subject. Its outcome is for the simulation to decide.`
      : "";
  }
  return "[Sandbox Mode]\n"
    + "The player is directing the world as its game master, not petitioning as a government. "
    + (as
      ? `This order is given as ${as}: write it as ${as}'s own decision and its execution, with ${as} as the subject. `
      : "Write the order as a statement of what happens, in the present tense, with the actors who do it as the subjects. ")
    + "Keep the outcome the player wrote as the outcome, stated as a fact: never turn it into another power funding, backing, supporting or encouraging it, "
    + "and never hedge it (\"aims to\", \"seeks to\", \"in an effort to\", \"in order to\"). Add detail about HOW it happens, never doubt about WHETHER it does. "
    + "Example: \"student lead movement topples corrupt Vučić's government\" becomes \"The student-led democratic opposition in Serbia mobilises voters, exposes corruption and wins a decisive electoral victory, peacefully toppling the Vučić government.\"";
};

// The advisor's stance in observer mode: a neutral analyst, not a minister.
export const describeSandboxForAdvisor = (game) => (isObserver(game)
  ? "[Sandbox Mode — Observer]\nThe player leads no country in this game; they watch the world and steer any polity they choose. "
    + "Speak as an impartial analyst of world affairs, not as a minister of any government, and advise on whatever polity they ask about."
  : "");
