/*! Open Historia — how often the map/story checks act © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/storyChecks.test.js
//
// The checks that keep the story and the map agreeing (gameplay.js
// validateGeneratedWorldChanges) work from the events' wording, so how often
// they act is the first question about them: a turn sent back costs a request,
// and a fill-in is the engine finishing what the model only told. This counts
// both, per turn and since the app opened, for the debug console's
// "story-checks" line after each turn.
//
// Import-free: the rules on plain data, tested under bare node.

export const STORY_CHECK_KINDS = Object.freeze({
  // Sent back (the strict attempt only; each is one more request).
  turnCapture: "a capture with no control change anywhere in the turn",
  turnSettlement: "a legal settlement with no transfer anywhere in the turn",
  eventCapture: "an event stating a capture with no territory change of its own",
  eventAnnexation: "an event stating an annexation with no transfer of its own",
  // Filled in on the answer that is kept.
  filledAnnexation: "annexations written from the event's words",
  filledCapture: "captures written from a formation's move",
  marched: "formations marched into land an event gave their power",
});

const SENT_BACK = ["turnCapture", "turnSettlement", "eventCapture", "eventAnnexation"];
const FILLED = ["filledAnnexation", "filledCapture", "marched"];

const zero = () => Object.fromEntries(Object.keys(STORY_CHECK_KINDS).map((kind) => [kind, 0]));
const sum = (counts, kinds) => kinds.reduce((total, kind) => total + (counts[kind] || 0), 0);

export const createStoryCheckTally = () => {
  let turn = zero();
  const total = zero();
  let turns = 0;
  return {
    // n: how many (a fill-in pass reports how many it added); unknown kinds are ignored.
    note(kind, n = 1) {
      const count = Number(n);
      if (!(kind in turn) || !Number.isFinite(count) || count <= 0) return;
      turn[kind] += count;
      total[kind] += count;
    },
    // The turn's counts and the running totals; the next turn starts from zero.
    take() {
      turns += 1;
      const taken = { turn, total: { ...total }, turns };
      turn = zero();
      return taken;
    },
  };
};

const parts = (counts, kinds) => kinds.filter((kind) => counts[kind] > 0).map((kind) => `${counts[kind]} ${STORY_CHECK_KINDS[kind]}`);

// One line for the debug console.
export const describeStoryChecks = ({ turn, total, turns }) => {
  const sentBack = sum(turn, SENT_BACK);
  const filled = sum(turn, FILLED);
  const thisTurn = sentBack || filled
    ? [sentBack ? `sent back ${sentBack}× (${parts(turn, SENT_BACK).join("; ")})` : "", filled ? `filled in ${filled} (${parts(turn, FILLED).join("; ")})` : ""].filter(Boolean).join("; ")
    : "nothing to correct";
  return `Map/story checks this turn: ${thisTurn}. Since the app opened (${turns} turn${turns === 1 ? "" : "s"}): sent back ${sum(total, SENT_BACK)}×, filled in ${sum(total, FILLED)}.`;
};
