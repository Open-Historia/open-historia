/*! Open Historia — wars meant to end one way © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make a below average performing model for war that still acts realistically
// for scripted wars that are meant to be lost (declared by the scenario
// designer or ai if a war is meant to be won or lost by player)" and "but
// depending on player actions in war, it should be possible for the opposite
// to happen too", and then "for any war other than a scripted one made by a
// scenario designer, use the best war model there is" (the owner, 2026-10-15).
//
// A war is MEANT to end one way only where a scenario's designer said so: its
// outcomes (world.warSettings.outcomes, the Scenario Editor's Fronts tab),
// [{ winner, loser }], in any war between the two, whenever it begins. The
// story says nothing of it.
//
// On a battlefield of such a war, a side nobody plays that is meant to lose is
// led by the plainer commander (fronts/mind/planner.js PLAINER_PLANNER), and
// every other side nobody plays, in every war, by the best there is (the
// trained one, fronts/mind/trained.js).
// That is all it does. Nothing is decided: troops still take ground or do
// not, so a player who fights a war meant to be won badly can lose it, and one
// who fights a war meant to be lost well can win it.
//
// Pure, and loads in plain Node.

export const WAR_OUTCOMES_MOST = 24;

const clean = (value, most = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

// A scenario's outcomes as they are kept: [{ winner, loser }], two different countries, a pair once.
export const normalizeWarOutcomes = (value) => {
  const kept = [];
  const seen = new Set();
  for (const raw of list(value)) {
    const winner = clean(raw?.winner);
    const loser = clean(raw?.loser);
    if (!winner || !loser || fold(winner) === fold(loser)) continue;
    const key = `${fold(winner)}\u0001${fold(loser)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ winner, loser });
    if (kept.length >= WAR_OUTCOMES_MOST) break;
  }
  return kept;
};

// Of a battle's two sides ([[names], [names]]), the one the scenario's outcomes (normalizeWarOutcomes) mean to
// lose: 0, 1, or -1 for neither.
export const meantLoserOf = ({ sides = [[], []], outcomes = [] } = {}) => {
  const has = (side, name) => list(sides[side]).some((member) => fold(member) === fold(name));
  for (const rule of normalizeWarOutcomes(outcomes)) {
    for (const side of [0, 1]) if (has(side, rule.winner) && has(1 - side, rule.loser)) return 1 - side;
  }
  return -1;
};
