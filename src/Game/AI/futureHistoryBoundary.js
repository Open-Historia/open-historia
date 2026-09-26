/*! Open Historia — real history as the default for a time skip
 *
 * The jump templates say it in general (defaultPrompts.json, [Real History Is
 * the Default]): a game set in our history follows real history wherever the
 * game has not changed things. This block adds what only the save knows — when
 * this game began and where this jump starts.
 *
 * Beta and alpha also read the scenario's canon (Scenario Canon v2) here, for
 * worlds that split from ours before the game began or never shared it; this
 * branch has no scenario canon, so every game is read as one set in our
 * history, and an alternate or fictional scenario says so in its own briefing,
 * which the template already covers.
 */

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const resolveStartDate = (game = {}, fallbackDate = "") => clean(
  game?.startDate || game?.startingDate || game?.startingRoundDate || fallbackDate,
);

export const buildRealHistoryDirective = ({ game = {}, originDate = "", fallbackDate = "" } = {}) => {
  const start = resolveStartDate(game, fallbackDate);
  const origin = clean(originDate || game?.gameDate || start);
  const began = start
    ? `This game began on ${start}${origin && origin !== start ? `, and this jump starts on ${origin}` : ""}.`
    : "";
  return [
    "[This Game and Real History]",
    `${began} Real history up to that date is this world's past, and from then on it stays the default for everything the game has not changed: the real events of this period happen, with their real people, places, dates and numbers, unless something in this game has changed their causes. What the game has changed so far is in the event history, the records and the map. A scenario whose briefing sets it in another history or a world of its own follows that instead.`.trim(),
  ].join("\n");
};
